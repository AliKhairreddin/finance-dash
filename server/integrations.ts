import crypto from "node:crypto";
import type {
  AccountBalance,
  CreateInvoicePayload,
  IntegrationStatus,
  Invoice,
  RevenuePartner,
  RevenueRun,
  Transaction
} from "../shared/types";
import { calculateTuneHourOffset } from "../shared/revenue";
import type { RevenuePeriod } from "../shared/revenue";

const slashBaseUrl = process.env.SLASH_BASE_URL || "https://api.slash.com";
const meritApiBaseUrl = process.env.MERIT_API_BASE_URL || "https://aktiva.merit.ee/api";
const meritGetInvoicesPath = process.env.MERIT_GET_INVOICES_PATH || "/v1/getinvoices";
const meritCreateInvoicePath = process.env.MERIT_CREATE_INVOICE_PATH || "/v2/sendinvoice";
const amexApiBaseUrl = process.env.AMEX_API_BASE_URL;
const amexTokenUrl = process.env.AMEX_TOKEN_URL;
const amexAccountPathTemplate = process.env.AMEX_ACCOUNT_PATH_TEMPLATE;
const amexTransactionsPathTemplate = process.env.AMEX_TRANSACTIONS_PATH_TEMPLATE;
const wiseBaseUrl =
  process.env.WISE_ENVIRONMENT === "sandbox"
    ? "https://api.wise-sandbox.com"
    : "https://api.wise.com";
const revolutBaseUrl =
  process.env.REVOLUT_ENVIRONMENT === "sandbox"
    ? "https://sandbox-b2b.revolut.com/api/1.0"
    : "https://b2b.revolut.com/api/1.0";
const revolutClientAssertionType = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";

function meritWritesEnabled(): boolean {
  return process.env.MERIT_WRITES_ENABLED === "true";
}

export function assertMeritWriteConfiguration(): void {
  if (!meritWritesEnabled()) {
    throw new Error("Merit invoice sending is disabled by the deployment safety switch.");
  }

  const missing = ["MERIT_API_ID", "MERIT_API_KEY", "MERIT_DEFAULT_TAX_ID"].filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Merit invoice sending is missing ${missing.join(", ")}.`);
  }
}

export interface WiseActivityResult {
  accounts: AccountBalance[];
  transactions: Transaction[];
  statementIssues: string[];
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

function emptyWiseActivity(statementIssues: string[] = []): WiseActivityResult {
  return { accounts: [], transactions: [], statementIssues };
}

export function wiseStatementIssue(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown Wise statement error";
  if (/^403\b/.test(message)) {
    return "Wise denied live statement API access for this business profile. Upload Wise statement CSVs from Wise instead.";
  }
  if (/^401\b/.test(message)) {
    return "Wise rejected the API token. Refresh the Wise token and update WISE_API_TOKEN.";
  }
  return `Wise statement fetch failed: ${message.replace(/\s+/g, " ").slice(0, 240)}`;
}

export function summarizeWiseStatementIssues(issues: string[]): string | undefined {
  if (issues.length === 0) return undefined;
  const uniqueIssues = [...new Set(issues)];
  const suffix = issues.length > 1 ? ` ${issues.length} configured balances were affected.` : "";
  return `${uniqueIssues[0]}${suffix}`;
}

function requiredRevenueEnvNames(revenuePartners: RevenuePartner[]): string[] {
  const names = new Set<string>();
  for (const partner of revenuePartners.filter((item) => item.enabled)) {
    names.add(partner.networkIdEnv);
    names.add(partner.apiKeyEnv);
  }
  return [...names].filter(Boolean).sort();
}

export function getIntegrationStatus(wiseIssue?: string, revenuePartners: RevenuePartner[] = []): IntegrationStatus[] {
  const wiseNeeds = ["WISE_API_TOKEN", "WISE_PROFILE_ID"].filter((name) => !process.env[name]);
  if (!process.env.WISE_BALANCE_IDS) wiseNeeds.push("WISE_BALANCE_IDS");
  const activeWiseIssue = wiseNeeds.length === 0 ? wiseIssue : undefined;

  const revolutNeeds = ["REVOLUT_REFRESH_TOKEN", "REVOLUT_CLIENT_ASSERTION_JWT"].filter((name) => !process.env[name]);
  const slashNeeds = ["SLASH_API_KEY"].filter((name) => !process.env[name]);
  const amexNeeds = [
    "AMEX_TOKEN_URL",
    "AMEX_API_BASE_URL",
    "AMEX_CLIENT_ID",
    "AMEX_CLIENT_SECRET",
    "AMEX_REFRESH_TOKEN",
    "AMEX_ACCOUNT_IDS",
    "AMEX_ACCOUNT_PATH_TEMPLATE",
    "AMEX_TRANSACTIONS_PATH_TEMPLATE"
  ].filter((name) => !process.env[name]);
  const meritNeeds = ["MERIT_API_ID", "MERIT_API_KEY"].filter((name) => !process.env[name]);
  const meritWriteEnabled = meritWritesEnabled();
  const revenueEnvNames = requiredRevenueEnvNames(revenuePartners);
  const tuneNeeds = revenueEnvNames.filter((name) => !process.env[name]);
  const enabledRevenuePartnerCount = revenuePartners.filter((partner) => partner.enabled).length;

  return [
    {
      id: "wise",
      label: "Wise",
      configured: wiseNeeds.length === 0,
      mode: wiseNeeds.length === 0 && !activeWiseIssue ? "live" : "partial",
      message:
        activeWiseIssue ??
        (wiseNeeds.length === 0
          ? "Ready to pull balances, statements, and transaction activity."
          : "Wise rows stay empty until API token, profile, and balance IDs are configured."),
      needs: wiseNeeds,
      issue: activeWiseIssue
    },
    {
      id: "revolut",
      label: "Revolut",
      configured: revolutNeeds.length === 0,
      mode: revolutNeeds.length === 0 ? "live" : "partial",
      message:
        revolutNeeds.length === 0
          ? "Ready to mint a Business API access token and pull accounts plus transaction activity."
          : "Revolut rows stay empty until the refresh token and client assertion JWT are configured.",
      needs: revolutNeeds
    },
    {
      id: "slash",
      label: "Slash",
      configured: slashNeeds.length === 0,
      mode: slashNeeds.length === 0 ? "live" : "partial",
      message:
        slashNeeds.length === 0
          ? "Ready to pull accounts, card activity, and transactions."
          : "Slash rows stay empty until API access is configured.",
      needs: slashNeeds
    },
    {
      id: "amex",
      label: "Amex",
      configured: amexNeeds.length === 0,
      mode: amexNeeds.length === 0 ? "live" : "partial",
      message:
        amexNeeds.length === 0
          ? "Ready to mint an Amex access token and pull card balances plus transaction activity."
          : "Amex rows stay empty until OAuth credentials, account IDs, and approved API paths are configured.",
      needs: amexNeeds
    },
    {
      id: "merit",
      label: "Merit",
      configured: meritNeeds.length === 0,
      mode: meritNeeds.length === 0 ? "live" : "partial",
      message:
        meritNeeds.length === 0
          ? meritWriteEnabled
            ? "Merit invoice reads are connected. Explicitly confirmed invoice sending is enabled."
            : "Merit invoice reads are connected. Invoice sending is disabled by the deployment safety switch."
          : "Add the Merit API ID and API key to enable read-only invoice sync.",
      needs: meritNeeds,
      writeEnabled: meritWriteEnabled
    },
    {
      id: "tune",
      label: "Partner revenue",
      configured: enabledRevenuePartnerCount > 0 && tuneNeeds.length === 0,
      mode: enabledRevenuePartnerCount > 0 && tuneNeeds.length === 0 ? "live" : "partial",
      message:
        enabledRevenuePartnerCount === 0
          ? "Enable at least one team revenue stream before pulling TUNE/HasOffers revenue."
          : tuneNeeds.length === 0
            ? "Ready to pull team-attributed partner revenue from TUNE/HasOffers. Invoice creation is a separate explicit action."
            : "Partner revenue stays empty until each enabled stream has its TUNE network ID and API key configured.",
      needs: tuneNeeds
    }
  ];
}

export async function fetchWiseActivity(): Promise<WiseActivityResult> {
  const token = process.env.WISE_API_TOKEN;
  const profileId = process.env.WISE_PROFILE_ID;
  const balancePairs = process.env.WISE_BALANCE_IDS;
  if (!token || !profileId || !balancePairs) return emptyWiseActivity();

  const intervalEnd = new Date().toISOString();
  const intervalStart = new Date(Date.now() - 1000 * 60 * 60 * 24 * 45).toISOString();
  const balances = balancePairs.split(",").map((pair) => {
    const [id, currency = "USD"] = pair.trim().split(":");
    return { id: id.trim(), currency: currency.trim() };
  });
  const selectedBalanceIds = new Set(balances.map((balance) => balance.id));

  const accounts = await fetchJson<
    Array<{
      id: number;
      currency: string;
      amount?: { value?: number; currency?: string };
      modificationTime?: string;
      visible?: boolean;
    }>
  >(`${wiseBaseUrl}/v4/profiles/${profileId}/balances?types=STANDARD,SAVINGS`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  }).then((wiseBalances) =>
    wiseBalances
      .filter((balance) => balance.visible !== false)
      .filter((balance) => selectedBalanceIds.has(String(balance.id)))
      .map((balance) => ({
        id: `wise-${balance.id}`,
        name: `Wise ${balance.currency}`,
        source: "wise" as const,
        balance: balance.amount?.value ?? 0,
        currency: balance.amount?.currency ?? balance.currency,
        updatedAt: balance.modificationTime ?? new Date().toISOString(),
        status: "live" as const
      }))
  );

  const transactions: Transaction[] = [];
  const statementIssues: string[] = [];
  for (const balance of balances) {
    const params = new URLSearchParams({
      currency: balance.currency,
      intervalStart,
      intervalEnd,
      type: "COMPACT",
      statementLocale: "en"
    });
    const statement = await fetchJson<{
      transactions?: Array<{
        date?: string;
        type?: string;
        details?: { description?: string; senderName?: string; recipientName?: string; referenceNumber?: string };
        amount?: { value?: number; currency?: string };
      }>;
    }>(`${wiseBaseUrl}/v1/profiles/${profileId}/balance-statements/${balance.id}/statement.json?${params}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-External-Correlation-Id": crypto.randomUUID()
      }
    }).catch((error: unknown) => {
      statementIssues.push(wiseStatementIssue(error));
      console.warn(
        `Wise statement fetch failed for balance ${balance.id}: ${error instanceof Error ? error.message : "Unknown Wise statement error"}`
      );
      return { transactions: [] };
    });

    for (const [index, activity] of (statement.transactions ?? []).entries()) {
      const value = activity.amount?.value ?? 0;
      const counterparty = activity.details?.senderName || activity.details?.recipientName || activity.details?.description || "Wise activity";
      transactions.push({
        id: `wise-${balance.id}-${activity.details?.referenceNumber ?? index}`,
        source: "wise",
        accountName: `Wise ${balance.currency}`,
        date: (activity.date ?? new Date().toISOString()).slice(0, 10),
        description: activity.details?.description ?? activity.type ?? "Wise transaction",
        rawName: counterparty,
        counterparty,
        amount: Math.abs(value),
        currency: activity.amount?.currency ?? balance.currency,
        direction: value >= 0 ? "in" : "out",
        status: "posted",
        category: activity.type ?? "Wise"
      });
    }
  }

  return { accounts, transactions, statementIssues };
}

async function fetchRevolutAccessToken(): Promise<string | undefined> {
  const refreshToken = process.env.REVOLUT_REFRESH_TOKEN;
  const clientAssertion = process.env.REVOLUT_CLIENT_ASSERTION_JWT;
  if (!refreshToken || !clientAssertion) return undefined;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_assertion_type: revolutClientAssertionType,
    client_assertion: clientAssertion
  });

  const response = await fetchJson<{ access_token?: string }>(`${revolutBaseUrl}/auth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!response.access_token) {
    throw new Error("Revolut token response did not include access_token");
  }
  return response.access_token;
}

function revolutStatus(state: string | undefined): Transaction["status"] {
  return state === "created" || state === "pending" ? "pending" : "posted";
}

function revolutCounterparty(
  activity: {
    type?: string;
    request_id?: string;
    reference?: string;
    merchant?: { name?: string };
    card?: { first_name?: string; last_name?: string };
  },
  leg: { counterparty?: { description?: string } }
): string {
  const cardholder = [activity.card?.first_name, activity.card?.last_name].filter(Boolean).join(" ").trim();
  return (
    activity.merchant?.name ||
    leg.counterparty?.description ||
    activity.reference ||
    cardholder ||
    activity.request_id ||
    activity.type ||
    "Revolut transaction"
  );
}

export async function fetchRevolutActivity(): Promise<{ accounts: AccountBalance[]; transactions: Transaction[] }> {
  const accessToken = await fetchRevolutAccessToken();
  if (!accessToken) return { accounts: [], transactions: [] };

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json"
  };
  const intervalEnd = new Date().toISOString();
  const intervalStart = new Date(Date.now() - 1000 * 60 * 60 * 24 * 45).toISOString();
  const params = new URLSearchParams({
    from: intervalStart,
    to: intervalEnd,
    count: "1000"
  });

  const [revolutAccounts, revolutTransactions] = await Promise.all([
    fetchJson<
      Array<{
        id: string;
        name?: string;
        balance: number;
        currency: string;
        state: string;
        updated_at: string;
        created_at: string;
      }>
    >(`${revolutBaseUrl}/accounts`, { headers }),
    fetchJson<
      Array<{
        id: string;
        type: string;
        request_id?: string;
        state: string;
        created_at: string;
        completed_at?: string;
        reference?: string;
        merchant?: { name?: string; category_code?: string };
        card?: { first_name?: string; last_name?: string; card_number?: string };
        legs: Array<{
          leg_id?: string;
          amount: number;
          currency: string;
          account_id: string;
          counterparty?: { description?: string; account_type?: string };
        }>;
      }>
    >(`${revolutBaseUrl}/transactions?${params.toString()}`, { headers })
  ]);

  const accountById = new Map(revolutAccounts.map((account) => [account.id, account]));
  const accounts: AccountBalance[] = revolutAccounts.map((account) => ({
    id: `revolut-${account.id}`,
    name: account.name || `Revolut ${account.currency}`,
    source: "revolut",
    balance: account.balance,
    currency: account.currency,
    updatedAt: account.updated_at || account.created_at,
    status: "live"
  }));

  const transactions: Transaction[] = [];
  for (const activity of revolutTransactions) {
    for (const [index, leg] of activity.legs.entries()) {
      const account = accountById.get(leg.account_id);
      const counterparty = revolutCounterparty(activity, leg);
      transactions.push({
        id: `revolut-${activity.id}-${leg.leg_id ?? index}`,
        source: "revolut",
        accountName: account?.name || `Revolut ${leg.currency}`,
        date: (activity.completed_at || activity.created_at || new Date().toISOString()).slice(0, 10),
        description: activity.reference || activity.type || counterparty,
        rawName: counterparty,
        counterparty,
        amount: Math.abs(leg.amount),
        currency: leg.currency,
        direction: leg.amount >= 0 ? "in" : "out",
        status: revolutStatus(activity.state),
        category: activity.merchant?.category_code || activity.type || "Revolut"
      });
    }
  }

  return { accounts, transactions };
}

export async function fetchSlashActivity(): Promise<{ accounts: AccountBalance[]; transactions: Transaction[] }> {
  const apiKey = process.env.SLASH_API_KEY;
  if (!apiKey) return { accounts: [], transactions: [] };

  const headers: Record<string, string> = { "X-API-Key": apiKey };
  if (process.env.SLASH_LEGAL_ENTITY_ID) {
    headers["x-legal-entity"] = process.env.SLASH_LEGAL_ENTITY_ID;
  }

  const [accountsResponse, transactionsResponse] = await Promise.all([
    fetchJson<{ items?: Array<{ id: string; name?: string; balance?: { amountCents?: number } }> }>(
      `${slashBaseUrl}/account`,
      { headers }
    ),
    fetchJson<{
      items?: Array<{
        id: string;
        createdAt?: string;
        description?: string;
        merchant?: { name?: string };
        amountCents?: number;
        currency?: string;
        status?: string;
        category?: string;
      }>;
    }>(`${slashBaseUrl}/transaction?filter:from_date=${Date.now() - 1000 * 60 * 60 * 24 * 45}`, { headers })
  ]);

  const accounts: AccountBalance[] = (accountsResponse.items ?? []).map((account) => ({
    id: `slash-${account.id}`,
    name: account.name ?? `Slash ${account.id}`,
    source: "slash",
    balance: (account.balance?.amountCents ?? 0) / 100,
    currency: "USD",
    updatedAt: new Date().toISOString(),
    status: "live"
  }));

  const transactions: Transaction[] = (transactionsResponse.items ?? []).map((item) => {
    const signedAmount = (item.amountCents ?? 0) / 100;
    const counterparty = item.merchant?.name || item.description || "Slash transaction";
    return {
      id: `slash-${item.id}`,
      source: "slash",
      accountName: "Slash",
      date: (item.createdAt ?? new Date().toISOString()).slice(0, 10),
      description: item.description ?? counterparty,
      rawName: counterparty,
      counterparty,
      amount: Math.abs(signedAmount),
      currency: item.currency ?? "USD",
      direction: signedAmount >= 0 ? "in" : "out",
      status: item.status === "pending" ? "pending" : "posted",
      category: item.category ?? "Slash"
    };
  });

  return { accounts, transactions };
}

type AmexAccountConfig = {
  id: string;
  name: string;
  currency: string;
};

function parseAmexAccountConfigs(value?: string): AmexAccountConfig[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => {
      const [id, name, currency = "USD"] = item.trim().split(":");
      const accountId = id?.trim();
      return accountId
        ? {
            id: accountId,
            name: name?.trim() || `Amex ${accountId}`,
            currency: currency.trim() || "USD"
          }
        : undefined;
    })
    .filter((item): item is AmexAccountConfig => Boolean(item));
}

async function fetchAmexAccessToken(): Promise<string | undefined> {
  if (!amexTokenUrl || !process.env.AMEX_CLIENT_ID || !process.env.AMEX_CLIENT_SECRET || !process.env.AMEX_REFRESH_TOKEN) {
    return undefined;
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: process.env.AMEX_REFRESH_TOKEN,
    client_id: process.env.AMEX_CLIENT_ID,
    client_secret: process.env.AMEX_CLIENT_SECRET
  });

  const response = await fetchJson<{ access_token?: string }>(amexTokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body
  });

  if (!response.access_token) {
    throw new Error("Amex token response did not include access_token");
  }
  return response.access_token;
}

function amexEndpoint(template: string, accountId: string, query?: URLSearchParams): string {
  if (!amexApiBaseUrl) throw new Error("AMEX_API_BASE_URL is not configured");
  const path = template.replaceAll("{accountId}", encodeURIComponent(accountId));
  const separator = path.startsWith("/") ? "" : "/";
  const suffix = query ? `?${query.toString()}` : "";
  return `${amexApiBaseUrl.replace(/\/+$/, "")}${separator}${path}${suffix}`;
}

function amexString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function amexMoneyValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (isRecord(value)) {
    return amexMoneyValue(value.value ?? value.amount ?? value.amountValue);
  }
  return undefined;
}

function amexCurrency(value: unknown, fallback: string): string {
  if (isRecord(value)) {
    return amexString(value.currency, value.currencyCode, value.isoCurrencyCode) ?? fallback;
  }
  return fallback;
}

function amexRecords(payload: unknown, primaryKey: string): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];
  const rows = payload[primaryKey] ?? payload.items ?? payload.data;
  return Array.isArray(rows) ? rows.filter(isRecord) : [];
}

function amexStatus(value: unknown): Transaction["status"] {
  const status = amexString(value)?.toLowerCase();
  return status === "pending" || status === "authorized" || status === "authorization" ? "pending" : "posted";
}

function normalizeAmexAccount(payload: unknown, config: AmexAccountConfig): AccountBalance {
  const account = isRecord(payload) ? payload : {};
  const balanceValue = amexMoneyValue(account.currentBalance ?? account.balance ?? account.outstandingBalance ?? account.statementBalance) ?? 0;
  const currency = amexCurrency(account.currentBalance ?? account.balance ?? account.outstandingBalance ?? account.statementBalance, config.currency);
  const name = amexString(account.name, account.displayName, account.productName, account.lastFive, account.last4) ?? config.name;
  return {
    id: `amex-${config.id}`,
    name,
    source: "amex",
    balance: balanceValue === 0 ? 0 : -Math.abs(balanceValue),
    currency,
    updatedAt: amexString(account.updatedAt, account.lastUpdatedAt, account.asOfDate) ?? new Date().toISOString(),
    status: "live"
  };
}

function normalizeAmexTransactions(payload: unknown, config: AmexAccountConfig): Transaction[] {
  return amexRecords(payload, "transactions").map((item, index) => {
    const rawAmount = amexMoneyValue(item.amount ?? item.transactionAmount ?? item.billingAmount ?? item.totalAmount) ?? 0;
    const status = amexStatus(item.status ?? item.transactionStatus);
    const category = amexString(item.category, item.categoryCode, item.industry, item.merchantCategory) ?? "Amex";
    const type = amexString(item.type, item.transactionType, item.kind)?.toLowerCase() ?? "";
    const merchant = isRecord(item.merchant) ? item.merchant : {};
    const counterparty =
      amexString(merchant.name, item.merchantName, item.description, item.memo, item.reference) ?? "Amex transaction";
    const transactionId = amexString(item.id, item.transactionId, item.reference, item.authorizationCode) ?? `${config.id}-${index}`;
    const isCredit = rawAmount < 0 || /refund|rebate|cashback|credit|reversal/.test(type);
    return {
      id: `amex-${config.id}-${transactionId}`,
      source: "amex",
      accountName: config.name,
      date: (amexString(item.postedDate, item.transactionDate, item.date, item.authorizationDate) ?? new Date().toISOString()).slice(0, 10),
      description: amexString(item.description, item.memo, item.reference, counterparty) ?? counterparty,
      rawName: counterparty,
      counterparty,
      amount: Math.abs(rawAmount),
      currency: amexCurrency(item.amount ?? item.transactionAmount ?? item.billingAmount ?? item.totalAmount, config.currency),
      direction: isCredit ? "in" : "out",
      status,
      category,
      ...(amexString(item.cardHolderName, item.cardMemberName, item.employeeName) ? { cardHolderName: amexString(item.cardHolderName, item.cardMemberName, item.employeeName) } : {})
    };
  });
}

export async function fetchAmexActivity(): Promise<{ accounts: AccountBalance[]; transactions: Transaction[] }> {
  const accountConfigs = parseAmexAccountConfigs(process.env.AMEX_ACCOUNT_IDS);
  const accessToken = await fetchAmexAccessToken();
  if (!accessToken || !amexApiBaseUrl || !amexAccountPathTemplate || !amexTransactionsPathTemplate || accountConfigs.length === 0) {
    return { accounts: [], transactions: [] };
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json"
  };
  const intervalEnd = new Date().toISOString().slice(0, 10);
  const intervalStart = new Date(Date.now() - 1000 * 60 * 60 * 24 * 45).toISOString().slice(0, 10);
  const accountResults = await Promise.all(
    accountConfigs.map(async (config) => {
      const transactionParams = new URLSearchParams({ from: intervalStart, to: intervalEnd });
      const [account, transactions] = await Promise.all([
        fetchJson<unknown>(amexEndpoint(amexAccountPathTemplate, config.id), { headers }),
        fetchJson<unknown>(amexEndpoint(amexTransactionsPathTemplate, config.id, transactionParams), { headers })
      ]);
      return {
        account: normalizeAmexAccount(account, config),
        transactions: normalizeAmexTransactions(transactions, config)
      };
    })
  );

  return {
    accounts: accountResults.map((result) => result.account),
    transactions: accountResults.flatMap((result) => result.transactions)
  };
}

function meritTimestamp(): string {
  return new Date().toISOString().replace(/\D/g, "").slice(0, 14);
}

function meritDate(value: string): string {
  return value.replace(/\D/g, "").slice(0, 8);
}

function meritUrl(path: string, body: string): string {
  const apiId = process.env.MERIT_API_ID;
  const apiKey = process.env.MERIT_API_KEY;
  if (!apiId || !apiKey) {
    throw new Error("Merit API credentials are not configured");
  }

  const timestamp = meritTimestamp();
  const signature = crypto
    .createHmac("sha256", Buffer.from(apiKey, "ascii"))
    .update(Buffer.from(`${apiId}${timestamp}${body}`, "utf8"))
    .digest("base64");
  const params = new URLSearchParams({ apiId, timestamp, signature });
  return `${meritApiBaseUrl}${path}?${params.toString()}`;
}

async function fetchMeritJson<T>(path: string, payload: unknown): Promise<T> {
  const body = JSON.stringify(payload);
  return fetchJson<T>(meritUrl(path, body), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body
  });
}

export async function fetchMeritInvoices(): Promise<Invoice[]> {
  if (!process.env.MERIT_API_ID || !process.env.MERIT_API_KEY) return [];

  const periodEnd = new Date();
  const periodStart = new Date(Date.now() - 1000 * 60 * 60 * 24 * 89);
  const response = await fetchMeritJson<
    Array<{
      SIHId?: string;
      InvoiceNo?: string;
      CustomerName?: string;
      DueDate?: string;
      CurrencyCode?: string;
      TotalSum?: number;
      TotalAmount?: number;
      Paid?: boolean;
    }>
  >(meritGetInvoicesPath, {
    Periodstart: meritDate(periodStart.toISOString()),
    PeriodEnd: meritDate(periodEnd.toISOString()),
    UnPaid: false
  });

  return response.map((invoice) => ({
    id: `merit-${invoice.SIHId ?? invoice.InvoiceNo ?? crypto.randomUUID()}`,
    documentType: "sales_invoice" as const,
    customerName: invoice.CustomerName ?? "Merit invoice",
    amount: invoice.TotalSum ?? invoice.TotalAmount ?? 0,
    currency: invoice.CurrencyCode ?? "USD",
    status: invoice.Paid ? "paid" : "open",
    approvalStatus: "approved",
    paidLocally: false,
    meritPaid: Boolean(invoice.Paid),
    dueDate: invoice.DueDate ? String(invoice.DueDate) : new Date().toISOString().slice(0, 10),
    source: "merit",
    externalId: invoice.SIHId ?? invoice.InvoiceNo,
    description: `Merit invoice ${invoice.InvoiceNo ?? invoice.SIHId ?? ""}`.trim(),
    createdAt: new Date().toISOString()
  }));
}

export async function createMeritInvoice(payload: CreateInvoicePayload): Promise<Invoice> {
  assertMeritWriteConfiguration();
  const taxId = process.env.MERIT_DEFAULT_TAX_ID!;

  const invoiceNo = `FD-${Date.now()}`;
  const response = await fetchMeritJson<{ Id?: string; InvoiceId?: string; SIHId?: string; InvoiceNo?: string }>(meritCreateInvoicePath, {
    Customer: {
      Name: payload.customerName,
      NotTDCustomer: true,
      CountryCode: process.env.MERIT_DEFAULT_COUNTRY_CODE || "CA"
    },
    AccountingDoc: 1,
    DocDate: meritDate(new Date().toISOString()),
    DueDate: meritDate(payload.dueDate),
    InvoiceNo: invoiceNo,
    CurrencyCode: payload.currency,
    InvoiceRow: [
      {
        Item: {
          Code: process.env.MERIT_DEFAULT_ITEM_CODE || "SERVICES",
          Description: payload.description.slice(0, 150),
          Type: 2
        },
        Quantity: 1,
        Price: payload.amount,
        TaxId: taxId
      }
    ],
    TaxAmount: [
      {
        TaxId: taxId,
        Amount: 0
      }
    ],
    TotalAmount: payload.amount,
    Hcomment: "Created from finance dashboard. Payment status is managed by accounting in Merit."
  });

  return {
    id: `merit-${response.InvoiceId ?? response.SIHId ?? response.Id ?? crypto.randomUUID()}`,
    providerId: payload.providerId,
    documentType: payload.documentType,
    customerName: payload.customerName,
    amount: payload.amount,
    currency: payload.currency,
    status: "created",
    approvalStatus: "pending",
    paidLocally: false,
    meritPaid: false,
    dueDate: payload.dueDate,
    source: "merit",
    externalId: response.InvoiceId ?? response.SIHId ?? response.Id ?? response.InvoiceNo ?? invoiceNo,
    description: payload.description,
    transactionId: payload.transactionId,
    createdAt: new Date().toISOString()
  };
}

export async function fetchTuneRevenue(partner: RevenuePartner, period: RevenuePeriod): Promise<RevenueRun> {
  const networkId = process.env[partner.networkIdEnv];
  const apiKey = process.env[partner.apiKeyEnv];
  const now = new Date().toISOString();

  if (!networkId || !apiKey) {
    throw new Error(`Missing ${[partner.networkIdEnv, partner.apiKeyEnv].filter((name) => !process.env[name]).join(", ")}`);
  }

  const apiBaseUrl = process.env[partner.apiBaseUrlEnv ?? ""] || `https://${networkId}.api.hasoffers.com/Apiv3/json`;
  const hourOffset = calculateTuneHourOffset(period.timezone, partner.networkTimezone, period.periodStart);
  const params = new URLSearchParams({
    Target: "Affiliate_Report",
    Method: "getStats",
    api_key: apiKey,
    totals: "1",
    currency: partner.currency,
    data_start: period.periodStart,
    data_end: period.periodEnd,
    hour_offset: String(hourOffset)
  });
  params.append("fields[0]", "Stat.date");
  params.append("fields[1]", "Stat.payout");
  params.append("fields[2]", "Stat.conversions");
  params.append("fields[3]", "Stat.clicks");
  params.append("filters[Stat.date][conditional]", "BETWEEN");
  params.append("filters[Stat.date][values][0]", period.periodStart);
  params.append("filters[Stat.date][values][1]", period.periodEnd);

  const response = await fetchJson<{
    response?: {
      status?: number;
      data?: unknown;
      errorMessage?: string | null;
      errors?: unknown[];
    };
  }>(`${apiBaseUrl}?${params.toString()}`, {
    headers: {
      Accept: "application/json"
    }
  });

  if (response.response?.status === 0) {
    throw new Error(response.response.errorMessage || "TUNE revenue request failed");
  }

  const rows = normalizeTuneRows(response.response?.data);
  const totals = rows.reduce<{ revenue: number; clicks: number; conversions: number }>(
    (sum, row) => ({
      revenue: sum.revenue + tuneNumber(row, "payout"),
      clicks: sum.clicks + tuneNumber(row, "clicks"),
      conversions: sum.conversions + tuneNumber(row, "conversions")
    }),
    { revenue: 0, clicks: 0, conversions: 0 }
  );

  return {
    id: `revenue-${partner.id}-${period.periodStart}-${period.periodEnd}`,
    partnerId: partner.id,
    partnerName: partner.name,
    providerId: partner.providerId,
    ...(partner.teamId ? { teamId: partner.teamId } : {}),
    revenueCategory: partner.revenueCategory,
    source: "tune",
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    timezone: period.timezone,
    revenue: Number(totals.revenue.toFixed(2)),
    currency: partner.currency,
    clicks: totals.clicks,
    conversions: totals.conversions,
    status: "pulled",
    createdAt: now
  };
}

function normalizeTuneRows(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) return data.filter(isRecord);
  if (isRecord(data)) {
    if (Array.isArray(data.data)) return data.data.filter(isRecord);
    if (Array.isArray(data.Data)) return data.Data.filter(isRecord);
  }
  return [];
}

function tuneNumber(row: Record<string, unknown>, field: "payout" | "clicks" | "conversions"): number {
  const stat = isRecord(row.Stat) ? row.Stat : {};
  const value = stat[field] ?? row[`Stat.${field}`] ?? row[field];
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
