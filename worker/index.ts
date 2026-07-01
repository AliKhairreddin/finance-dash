import type {
  AccountBalance,
  AiPromptPayload,
  AssignTransactionTeamPayload,
  CreateInvoicePayload,
  CreateProviderPayload,
  DashboardSnapshot,
  DataSource,
  ImportWiseStatementPayload,
  ImportWiseStatementResult,
  ImportWiseStatementSummary,
  IntegrationStatus,
  Invoice,
  MatchTransactionPayload,
  Provider,
  RevenuePartner,
  RevenueRun,
  SaveAiSettingsPayload,
  StoredAiSettings,
  SyncRevenuePayload,
  Team,
  TransactionTeamAssignment,
  Transaction,
  UpdateProviderPayload,
  UpdateRevenuePartnerPayload,
  WiseStatementImport
} from "../shared/types";
import { defaultAiSettings, publicAiSettings, runOpenRouterPrompt } from "../shared/ai";
import { calculateInvoiceDueDate, calculateRevenueMetrics, calculateTuneHourOffset, resolveRevenuePeriod } from "../shared/revenue";
import type { RevenuePeriod } from "../shared/revenue";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { calculateMetrics } from "../server/calculations";
import { enrichTransactions, learnAliases } from "../server/matching";

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

interface Env {
  ASSETS: Fetcher;
  CONVEX_URL?: string;
  WISE_API_TOKEN?: string;
  WISE_PROFILE_ID?: string;
  WISE_BALANCE_IDS?: string;
  WISE_ENVIRONMENT?: string;
  REVOLUT_REFRESH_TOKEN?: string;
  REVOLUT_CLIENT_ASSERTION_JWT?: string;
  REVOLUT_ENVIRONMENT?: string;
  SLASH_API_KEY?: string;
  SLASH_LEGAL_ENTITY_ID?: string;
  SLASH_BASE_URL?: string;
  MERIT_API_ID?: string;
  MERIT_API_BASE_URL?: string;
  MERIT_GET_INVOICES_PATH?: string;
  MERIT_CREATE_INVOICE_PATH?: string;
  MERIT_API_KEY?: string;
  MERIT_DEFAULT_TAX_ID?: string;
  MERIT_DEFAULT_ITEM_CODE?: string;
  MERIT_DEFAULT_COUNTRY_CODE?: string;
  REVENUE_TIMEZONE?: string;
  KISSTERRA_TUNE_NETWORK_ID?: string;
  KISSTERRA_TUNE_API_KEY?: string;
  KISSTERRA_TUNE_API_BASE_URL?: string;
  PUBLIC_APP_URL?: string;
}

interface PersistedState {
  providers: Provider[];
  invoices: Invoice[];
  teams: Team[];
  revenuePartners: RevenuePartner[];
  transactionTeamAssignments: TransactionTeamAssignment[];
  wiseStatementTransactions: Transaction[];
  wiseStatementImports: WiseStatementImport[];
  revenueRuns: RevenueRun[];
  aiSettings?: StoredAiSettings;
}

interface WiseActivityResult {
  accounts: AccountBalance[];
  transactions: Transaction[];
  statementIssues: string[];
}

const wiseBaseUrlByEnvironment = {
  production: "https://api.wise.com",
  sandbox: "https://api.wise-sandbox.com"
};
const revolutBaseUrlByEnvironment = {
  production: "https://b2b.revolut.com/api/1.0",
  sandbox: "https://sandbox-b2b.revolut.com/api/1.0"
};
const revolutClientAssertionType = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
const defaultMeritApiBaseUrl = "https://aktiva.merit.ee/api";
const defaultSlashBaseUrl = "https://api.slash.com";
const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      ...jsonHeaders,
      ...init?.headers
    }
  });
}

function mergeById<T extends { id: string }>(initial: T[], incoming?: T[]): T[] {
  const map = new Map(initial.map((item) => [item.id, item]));
  for (const item of incoming ?? []) {
    map.set(item.id, item);
  }
  return [...map.values()];
}

function normalizedTransactionText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function wiseStatementTransactionKey(transaction: Transaction): string {
  const sourceId = transaction.id.match(/^wise-(?:csv|pdf)-[^-]+-(.+)$/)?.[1];
  if (sourceId) return `${transaction.currency}:${sourceId}`;

  return [
    transaction.date,
    transaction.currency,
    transaction.direction,
    transaction.amount.toFixed(2),
    normalizedTransactionText(transaction.counterparty),
    normalizedTransactionText(transaction.description)
  ].join("|");
}

function mergeWiseStatementTransactions(initial: Transaction[], incoming: Transaction[]): Transaction[] {
  const map = new Map<string, Transaction>();
  for (const transaction of [...initial, ...incoming]) {
    map.set(wiseStatementTransactionKey(transaction), transaction);
  }
  return [...map.values()];
}

function summarizeWiseStatementImport(existing: Transaction[], incoming: Transaction[]): ImportWiseStatementSummary {
  const existingKeys = new Set(existing.map((transaction) => wiseStatementTransactionKey(transaction)));
  const incomingKeys = new Set<string>();
  let newTransactions = 0;
  let duplicateTransactions = 0;

  for (const transaction of incoming) {
    const key = wiseStatementTransactionKey(transaction);
    if (existingKeys.has(key) || incomingKeys.has(key)) {
      duplicateTransactions += 1;
    } else {
      newTransactions += 1;
      incomingKeys.add(key);
    }
  }

  return {
    processedTransactions: incoming.length,
    newTransactions,
    duplicateTransactions
  };
}

function realInvoices(invoices?: Invoice[]): Invoice[] {
  return (invoices ?? []).filter(
    (invoice) => invoice.source !== "mock" && !invoice.id.startsWith("mock-invoice-") && invoice.externalId !== "seed-open-invoices"
  );
}

function realRevenueRuns(runs?: RevenueRun[]): RevenueRun[] {
  return (runs ?? []).filter((run) => run.status !== "mock");
}

function bankAliasNames(transaction: Transaction): string[] {
  return [transaction.rawName, transaction.counterparty].filter(Boolean);
}

function getConvexClient(env: Env): ConvexHttpClient | null {
  return env.CONVEX_URL ? new ConvexHttpClient(env.CONVEX_URL) : null;
}

function parseWiseBalanceIds(value: string | undefined): Set<string> {
  return new Set(parseWiseBalancePairs(value).map((balance) => balance.id));
}

function parseWiseBalancePairs(value: string | undefined): Array<{ id: string; currency: string }> {
  if (!value) return [];
  return value
    .split(",")
    .map((pair) => {
      const [id, currency = "USD"] = pair.trim().split(":");
      return { id: id.trim(), currency: currency.trim() };
    })
    .filter((balance) => balance.id);
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

function wiseBaseUrl(env: Env): string {
  return env.WISE_ENVIRONMENT === "sandbox" ? wiseBaseUrlByEnvironment.sandbox : wiseBaseUrlByEnvironment.production;
}

function revolutBaseUrl(env: Env): string {
  return env.REVOLUT_ENVIRONMENT === "sandbox" ? revolutBaseUrlByEnvironment.sandbox : revolutBaseUrlByEnvironment.production;
}

function parseStatementDate(value: string | undefined): string {
  return (value ?? new Date().toISOString()).slice(0, 10);
}

function emptyWiseActivity(statementIssues: string[] = []): WiseActivityResult {
  return { accounts: [], transactions: [], statementIssues };
}

function wiseStatementIssue(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown Wise statement error";
  if (/^403\b/.test(message)) {
    return "Wise denied live statement API access for this business profile. Upload Wise statement CSVs from Wise instead.";
  }
  if (/^401\b/.test(message)) {
    return "Wise rejected the API token. Refresh the Wise token and update WISE_API_TOKEN.";
  }
  return `Wise statement fetch failed: ${message.replace(/\s+/g, " ").slice(0, 240)}`;
}

function summarizeWiseStatementIssues(issues: string[]): string | undefined {
  if (issues.length === 0) return undefined;
  const uniqueIssues = [...new Set(issues)];
  const suffix = issues.length > 1 ? ` ${issues.length} configured balances were affected.` : "";
  return `${uniqueIssues[0]}${suffix}`;
}

async function fetchWiseActivity(env: Env): Promise<WiseActivityResult> {
  if (!env.WISE_API_TOKEN || !env.WISE_PROFILE_ID || !env.WISE_BALANCE_IDS) {
    return emptyWiseActivity();
  }

  const balances = parseWiseBalancePairs(env.WISE_BALANCE_IDS);
  const selectedBalanceIds = parseWiseBalanceIds(env.WISE_BALANCE_IDS);
  const baseUrl = wiseBaseUrl(env);
  const intervalEnd = new Date().toISOString();
  const intervalStart = new Date(Date.now() - 1000 * 60 * 60 * 24 * 45).toISOString();

  const wiseBalances = await fetchJson<
    Array<{
      id: number;
      currency: string;
      amount?: { value?: number; currency?: string };
      modificationTime?: string;
      visible?: boolean;
    }>
  >(`${baseUrl}/v4/profiles/${env.WISE_PROFILE_ID}/balances?types=STANDARD,SAVINGS`, {
    headers: {
      Authorization: `Bearer ${env.WISE_API_TOKEN}`
    }
  });

  const accounts = wiseBalances
    .filter((balance) => balance.visible !== false)
    .filter((balance) => selectedBalanceIds.size === 0 || selectedBalanceIds.has(String(balance.id)))
    .map((balance) => ({
      id: `wise-${balance.id}`,
      name: `Wise ${balance.currency}`,
      source: "wise" as const,
      balance: balance.amount?.value ?? 0,
      currency: balance.amount?.currency ?? balance.currency,
      updatedAt: balance.modificationTime ?? new Date().toISOString(),
      status: "live" as const
    }));

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
    }>(`${baseUrl}/v1/profiles/${env.WISE_PROFILE_ID}/balance-statements/${balance.id}/statement.json?${params}`, {
      headers: {
        Authorization: `Bearer ${env.WISE_API_TOKEN}`,
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
        date: parseStatementDate(activity.date),
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

async function fetchRevolutAccessToken(env: Env): Promise<string | undefined> {
  if (!env.REVOLUT_REFRESH_TOKEN || !env.REVOLUT_CLIENT_ASSERTION_JWT) return undefined;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: env.REVOLUT_REFRESH_TOKEN,
    client_assertion_type: revolutClientAssertionType,
    client_assertion: env.REVOLUT_CLIENT_ASSERTION_JWT
  });

  const response = await fetchJson<{ access_token?: string }>(`${revolutBaseUrl(env)}/auth/token`, {
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

async function fetchRevolutActivity(env: Env): Promise<{ accounts: AccountBalance[]; transactions: Transaction[] }> {
  const accessToken = await fetchRevolutAccessToken(env);
  if (!accessToken) return { accounts: [], transactions: [] };

  const baseUrl = revolutBaseUrl(env);
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
    >(`${baseUrl}/accounts`, { headers }),
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
    >(`${baseUrl}/transactions?${params.toString()}`, { headers })
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
        date: parseStatementDate(activity.completed_at || activity.created_at),
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

async function fetchSlashActivity(env: Env): Promise<{ accounts: AccountBalance[]; transactions: Transaction[] }> {
  if (!env.SLASH_API_KEY) return { accounts: [], transactions: [] };

  const headers: Record<string, string> = { "X-API-Key": env.SLASH_API_KEY };
  if (env.SLASH_LEGAL_ENTITY_ID) {
    headers["x-legal-entity"] = env.SLASH_LEGAL_ENTITY_ID;
  }

  const slashBaseUrl = env.SLASH_BASE_URL || defaultSlashBaseUrl;
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
      date: parseStatementDate(item.createdAt),
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

function mergeLiveAccounts(...accountGroups: AccountBalance[][]): AccountBalance[] {
  return accountGroups.flat();
}

async function fetchInvoiceForLocalUpdate(env: Env, invoiceId: string): Promise<Invoice | undefined> {
  return (await fetchMeritInvoices(env).catch(() => [])).find((invoice) => invoice.id === invoiceId);
}

async function fetchTransactionForUpdate(env: Env, transactionId: string): Promise<Transaction | undefined> {
  const [wise, revolut, slash] = await Promise.all([
    fetchWiseActivity(env).catch((error: unknown) => emptyWiseActivity([wiseStatementIssue(error)])),
    fetchRevolutActivity(env).catch(() => ({ accounts: [], transactions: [] })),
    fetchSlashActivity(env).catch(() => ({ accounts: [], transactions: [] }))
  ]);
  return [...wise.transactions, ...revolut.transactions, ...slash.transactions].find((transaction) => transaction.id === transactionId);
}

async function fetchTransactionForMatch(env: Env, transactionId: string): Promise<Transaction | undefined> {
  return fetchTransactionForUpdate(env, transactionId);
}

function meritTimestamp(): string {
  return new Date().toISOString().replace(/\D/g, "").slice(0, 14);
}

function meritDate(value: string): string {
  return value.replace(/\D/g, "").slice(0, 8);
}

function base64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

async function meritUrl(env: Env, path: string, body: string): Promise<string> {
  if (!env.MERIT_API_ID || !env.MERIT_API_KEY) {
    throw new Error("Merit API credentials are not configured");
  }

  const timestamp = meritTimestamp();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.MERIT_API_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = base64(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${env.MERIT_API_ID}${timestamp}${body}`)));
  const params = new URLSearchParams({ apiId: env.MERIT_API_ID, timestamp, signature });
  return `${env.MERIT_API_BASE_URL || defaultMeritApiBaseUrl}${path}?${params.toString()}`;
}

async function fetchMeritJson<T>(env: Env, path: string, payload: unknown): Promise<T> {
  const body = JSON.stringify(payload);
  const response = await fetch(await meritUrl(env, path, body), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Merit API failed: ${response.status} ${response.statusText}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

async function fetchMeritInvoices(env: Env): Promise<Invoice[]> {
  if (!env.MERIT_API_ID || !env.MERIT_API_KEY) return [];

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
  >(env, env.MERIT_GET_INVOICES_PATH || "/v1/getinvoices", {
    Periodstart: meritDate(periodStart.toISOString()),
    PeriodEnd: meritDate(periodEnd.toISOString()),
    UnPaid: false
  });

  return response.map((invoice) => ({
    id: `merit-${invoice.SIHId ?? invoice.InvoiceNo ?? crypto.randomUUID()}`,
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

async function createMeritInvoice(env: Env, payload: CreateInvoicePayload): Promise<Invoice | undefined> {
  if (!env.MERIT_API_ID || !env.MERIT_API_KEY || !env.MERIT_DEFAULT_TAX_ID) return undefined;

  const invoiceNo = `FD-${Date.now()}`;
  const response = await fetchMeritJson<{ Id?: string; InvoiceId?: string; SIHId?: string; InvoiceNo?: string }>(
    env,
    env.MERIT_CREATE_INVOICE_PATH || "/v2/sendinvoice",
    {
      Customer: {
        Name: payload.customerName,
        NotTDCustomer: true,
        CountryCode: env.MERIT_DEFAULT_COUNTRY_CODE || "CA"
      },
      AccountingDoc: 1,
      DocDate: meritDate(new Date().toISOString()),
      DueDate: meritDate(payload.dueDate),
      InvoiceNo: invoiceNo,
      CurrencyCode: payload.currency,
      InvoiceRow: [
        {
          Item: {
            Code: env.MERIT_DEFAULT_ITEM_CODE || "SERVICES",
            Description: payload.description.slice(0, 150),
            Type: 2
          },
          Quantity: 1,
          Price: payload.amount,
          TaxId: env.MERIT_DEFAULT_TAX_ID
        }
      ],
      TaxAmount: [
        {
          TaxId: env.MERIT_DEFAULT_TAX_ID,
          Amount: 0
        }
      ],
      TotalAmount: payload.amount,
      Hcomment: "Created from finance dashboard. Payment status is managed by accounting in Merit."
    }
  );

  return {
    id: `merit-${response.InvoiceId ?? response.SIHId ?? response.Id ?? crypto.randomUUID()}`,
    providerId: payload.providerId,
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

async function fetchTuneRevenue(env: Env, partner: RevenuePartner, period: RevenuePeriod): Promise<RevenueRun> {
  const networkId = envString(env, partner.networkIdEnv);
  const apiKey = envString(env, partner.apiKeyEnv);
  const now = new Date().toISOString();

  if (!networkId || !apiKey) {
    throw new Error(`Missing ${[partner.networkIdEnv, partner.apiKeyEnv].filter((name) => !envString(env, name)).join(", ")}`);
  }

  const apiBaseUrl = envString(env, partner.apiBaseUrlEnv) || `https://${networkId}.api.hasoffers.com/Apiv3/json`;
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

function envString(env: Env, name?: string): string | undefined {
  if (!name) return undefined;
  const value = env[name as keyof Env];
  return typeof value === "string" && value.trim() ? value : undefined;
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

async function loadPersisted(env: Env): Promise<PersistedState> {
  const convex = getConvexClient(env);
  const stored = convex ? await convex.query(api.dashboard.getState, {}).catch(() => null) : null;

  return {
    providers: stored?.providers ?? [],
    invoices: realInvoices(stored?.invoices),
    teams: stored?.teams ?? [],
    revenuePartners: stored?.revenuePartners ?? [],
    transactionTeamAssignments: stored?.transactionTeamAssignments ?? [],
    wiseStatementTransactions: stored?.wiseStatementTransactions ?? [],
    wiseStatementImports: stored?.wiseStatementImports ?? [],
    revenueRuns: realRevenueRuns(stored?.revenueRuns),
    aiSettings: stored?.aiSettings ?? { ...defaultAiSettings }
  };
}

async function savePersisted(env: Env, state: PersistedState): Promise<void> {
  const convex = getConvexClient(env);
  if (!convex) {
    throw new Error("CONVEX_URL is not configured");
  }
  await convex.mutation(api.dashboard.saveState, state);
}

function integrationStatus(env: Env, wiseActivity?: WiseActivityResult): IntegrationStatus[] {
  const wiseNeeds = ["WISE_API_TOKEN", "WISE_PROFILE_ID"].filter((name) => !env[name as keyof Env]);
  if (!env.WISE_BALANCE_IDS) wiseNeeds.push("WISE_BALANCE_IDS");
  const wiseIssue = wiseNeeds.length === 0 ? summarizeWiseStatementIssues(wiseActivity?.statementIssues ?? []) : undefined;

  const revolutNeeds = ["REVOLUT_REFRESH_TOKEN", "REVOLUT_CLIENT_ASSERTION_JWT"].filter((name) => !env[name as keyof Env]);
  const slashNeeds = ["SLASH_API_KEY"].filter((name) => !env[name as keyof Env]);

  const meritNeeds = ["MERIT_API_ID", "MERIT_API_KEY", "MERIT_DEFAULT_TAX_ID"].filter((name) => !env[name as keyof Env]);
  const tuneNeeds = ["KISSTERRA_TUNE_NETWORK_ID", "KISSTERRA_TUNE_API_KEY"].filter((name) => !env[name as keyof Env]);

  return [
    {
      id: "wise" as DataSource,
      label: "Wise",
      configured: wiseNeeds.length === 0,
      mode: wiseNeeds.length === 0 && !wiseIssue ? "live" : "partial",
      message:
        wiseIssue ??
        (wiseNeeds.length === 0
          ? "Credentials are present. Live Wise sync can be enabled for statements."
          : "Wise rows stay empty until API token, profile, and balance IDs are configured."),
      needs: wiseNeeds,
      issue: wiseIssue
    },
    {
      id: "revolut" as DataSource,
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
      id: "slash" as DataSource,
      label: "Slash",
      configured: slashNeeds.length === 0,
      mode: slashNeeds.length === 0 ? "live" : "partial",
      message:
        slashNeeds.length === 0
          ? "Slash API key is present."
          : "Slash rows stay empty until API access is configured.",
      needs: slashNeeds
    },
    {
      id: "merit" as DataSource,
      label: "Merit",
      configured: meritNeeds.length === 0,
      mode: meritNeeds.length === 0 ? "live" : "partial",
      message:
        meritNeeds.length === 0
          ? "Ready to pull Merit invoices and create new Merit invoices. Local paid status never updates Merit."
          : "Merit invoices stay empty until API credentials and default tax configuration are added.",
      needs: meritNeeds
    },
    {
      id: "tune" as DataSource,
      label: "Partner revenue",
      configured: tuneNeeds.length === 0,
      mode: tuneNeeds.length === 0 ? "live" : "partial",
      message:
        tuneNeeds.length === 0
          ? "Ready to pull partner revenue from TUNE/HasOffers and generate Merit invoices."
          : "Partner revenue stays empty until the TUNE network ID and API key are configured.",
      needs: tuneNeeds
    }
  ];
}

function applyTeamAssignments(rows: Transaction[], assignments: TransactionTeamAssignment[]): Transaction[] {
  const teamByTransaction = new Map(assignments.map((assignment) => [assignment.transactionId, assignment.teamId]));
  return rows.map((transaction) => {
    const teamId = teamByTransaction.get(transaction.id);
    return teamId ? { ...transaction, teamId } : transaction;
  });
}

function wiseImportId(payload: ImportWiseStatementPayload): string {
  return `wise-import-${payload.balanceId}-${payload.currency}-${payload.periodStart}-${payload.periodEnd}`;
}

function normalizeImportedWiseTransactions(payload: ImportWiseStatementPayload): Transaction[] {
  return payload.transactions
    .filter((transaction) => transaction.id && transaction.date && Number.isFinite(transaction.amount))
    .map((transaction) => ({
      id: transaction.id,
      source: "wise" as const,
      accountName: transaction.accountName || `Wise ${payload.currency}`,
      date: transaction.date,
      description: transaction.description || transaction.counterparty || "Wise statement transaction",
      rawName: transaction.rawName || transaction.counterparty || transaction.description || "Wise statement transaction",
      counterparty: transaction.counterparty || transaction.rawName || transaction.description || "Wise statement transaction",
      amount: Math.abs(transaction.amount),
      currency: payload.currency,
      direction: transaction.direction,
      status: "posted" as const,
      category: transaction.category || "Wise"
    }));
}

async function importWiseStatement(env: Env, payload: ImportWiseStatementPayload): Promise<ImportWiseStatementResult> {
  if (!payload.balanceId || !payload.currency || !payload.periodStart || !payload.periodEnd || !payload.fileName) {
    throw new Error("balanceId, currency, periodStart, periodEnd, and fileName are required");
  }
  const state = await loadPersisted(env);
  const importedTransactions = normalizeImportedWiseTransactions(payload);
  const summary = summarizeWiseStatementImport(state.wiseStatementTransactions, importedTransactions);
  const importedAt = new Date().toISOString();
  const importRecord: WiseStatementImport = {
    id: wiseImportId(payload),
    balanceId: payload.balanceId,
    currency: payload.currency,
    periodStart: payload.periodStart,
    periodEnd: payload.periodEnd,
    fileName: payload.fileName,
    transactionCount: importedTransactions.length,
    importedAt
  };

  state.wiseStatementTransactions = mergeWiseStatementTransactions(state.wiseStatementTransactions, importedTransactions).sort((left, right) =>
    right.date.localeCompare(left.date)
  );
  state.wiseStatementImports = [importRecord, ...state.wiseStatementImports.filter((item) => item.id !== importRecord.id)].sort((left, right) =>
    right.importedAt.localeCompare(left.importedAt)
  );
  await savePersisted(env, state);
  return {
    dashboard: await getSnapshot(env),
    summary
  };
}

async function getSnapshot(env: Env): Promise<DashboardSnapshot> {
  const state = await loadPersisted(env);
  const [wise, revolut, slash, liveMeritInvoices] = await Promise.all([
    fetchWiseActivity(env).catch((error: unknown) => emptyWiseActivity([wiseStatementIssue(error)])),
    fetchRevolutActivity(env).catch(() => ({ accounts: [], transactions: [] })),
    fetchSlashActivity(env).catch(() => ({ accounts: [], transactions: [] })),
    fetchMeritInvoices(env).catch(() => [])
  ]);
  const accounts = mergeLiveAccounts(wise.accounts, revolut.accounts, slash.accounts);
  const invoices = realInvoices(mergeById(liveMeritInvoices, state.invoices));
  const rawTransactions = mergeById(state.wiseStatementTransactions, [...wise.transactions, ...revolut.transactions, ...slash.transactions]);
  const transactions = enrichTransactions(
    applyTeamAssignments(
      rawTransactions.map((transaction) => {
        const invoice = invoices.find((item) => item.transactionId === transaction.id);
        return invoice
          ? { ...transaction, matchedInvoiceId: invoice.id, matchedProviderId: invoice.providerId ?? transaction.matchedProviderId }
          : transaction;
      }),
      state.transactionTeamAssignments
    ),
    state.providers
  );

  return {
    asOf: new Date().toISOString(),
    accounts,
    receivables: [],
    openBalances: [],
    payables: [],
    investments: [],
    providers: state.providers,
    teams: state.teams,
    revenuePartners: state.revenuePartners,
    revenueRuns: state.revenueRuns,
    revenueMetrics: calculateRevenueMetrics(state.revenuePartners, state.revenueRuns),
    aiSettings: publicAiSettings(state.aiSettings ?? { ...defaultAiSettings }),
    transactions,
    invoices,
    wiseStatementImports: state.wiseStatementImports,
    integrationStatus: integrationStatus(env, wise),
    metrics: calculateMetrics(accounts, [], [], [], []),
    lastSync: new Date().toISOString()
  };
}

async function createProvider(env: Env, payload: CreateProviderPayload): Promise<Provider> {
  if (!payload.name?.trim()) {
    throw new Error("Provider name is required");
  }
  const state = await loadPersisted(env);
  const provider: Provider = {
    id: `provider-${crypto.randomUUID()}`,
    name: payload.name.trim(),
    type: payload.type,
    category: payload.category.trim() || "Uncategorized",
    aliases: payload.aliases.map((alias) => alias.trim()).filter(Boolean),
    source: "manual",
    createdAt: new Date().toISOString()
  };
  state.providers = [...state.providers, provider];
  await savePersisted(env, state);
  return provider;
}

async function updateProvider(env: Env, providerId: string, payload: UpdateProviderPayload): Promise<Provider> {
  if (!payload.name?.trim()) {
    throw new Error("Provider name is required");
  }
  const state = await loadPersisted(env);
  let updated: Provider | undefined;
  state.providers = state.providers.map((provider) => {
    if (provider.id !== providerId) return provider;
    updated = {
      ...provider,
      name: payload.name.trim(),
      type: payload.type,
      category: payload.category.trim() || "Uncategorized",
      aliases: payload.aliases.map((alias) => alias.trim()).filter(Boolean),
      defaultAccount: payload.defaultAccount?.trim() || undefined
    };
    return updated;
  });
  if (!updated) throw new Error("Provider not found");
  await savePersisted(env, state);
  return updated;
}

async function updateRevenuePartner(env: Env, partnerId: string, payload: UpdateRevenuePartnerPayload): Promise<RevenuePartner> {
  if (!payload.name?.trim() || !payload.networkIdEnv?.trim() || !payload.apiKeyEnv?.trim()) {
    throw new Error("name, networkIdEnv, and apiKeyEnv are required");
  }
  const state = await loadPersisted(env);
  let updated: RevenuePartner | undefined;
  state.revenuePartners = state.revenuePartners.map((partner) => {
    if (partner.id !== partnerId) return partner;
    updated = {
      ...partner,
      name: payload.name.trim(),
      affiliateId: payload.affiliateId.trim(),
      externalId: payload.externalId?.trim() || undefined,
      currency: payload.currency.trim() || "USD",
      timezone: payload.timezone,
      networkTimezone: payload.networkTimezone,
      networkIdEnv: payload.networkIdEnv.trim(),
      apiKeyEnv: payload.apiKeyEnv.trim(),
      apiBaseUrlEnv: payload.apiBaseUrlEnv?.trim() || undefined,
      meritCustomerName: payload.meritCustomerName?.trim() || undefined,
      invoiceDueDays: payload.invoiceDueDays,
      enabled: payload.enabled
    };
    return updated;
  });
  if (!updated) throw new Error("Revenue partner not found");
  await savePersisted(env, state);
  return updated;
}

async function saveAiSettings(env: Env, payload: SaveAiSettingsPayload): Promise<DashboardSnapshot> {
  const model = payload.model.trim();
  if (!model) throw new Error("OpenRouter model is required");

  const state = await loadPersisted(env);
  const nextKey = payload.clearApiKey ? undefined : payload.openRouterApiKey?.trim() || state.aiSettings?.openRouterApiKey;
  state.aiSettings = {
    provider: "openrouter",
    model,
    openRouterApiKey: nextKey,
    updatedAt: new Date().toISOString()
  };
  await savePersisted(env, state);
  return getSnapshot(env);
}

async function runAiPrompt(env: Env, payload: AiPromptPayload) {
  const state = await loadPersisted(env);
  return runOpenRouterPrompt(state.aiSettings ?? { ...defaultAiSettings }, payload, env.PUBLIC_APP_URL);
}

async function matchTransaction(env: Env, payload: MatchTransactionPayload) {
  const state = await loadPersisted(env);
  const transaction = await fetchTransactionForMatch(env, payload.transactionId);
  const provider = state.providers.find((item) => item.id === payload.providerId);
  if (!transaction || !provider) {
    throw new Error("Provider or transaction not found");
  }
  if (payload.rememberAlias) {
    state.providers = state.providers.map((item) =>
      item.id === provider.id ? learnAliases(item, bankAliasNames(transaction)) : item
    );
    await savePersisted(env, state);
  }
  return {
    ...transaction,
    teamId: state.transactionTeamAssignments.find((assignment) => assignment.transactionId === transaction.id)?.teamId,
    matchedProviderId: payload.providerId,
    matchedInvoiceId: payload.invoiceId,
    confidence: 1,
    matchReason: "Manual match"
  };
}

async function assignTransactionTeam(env: Env, payload: AssignTransactionTeamPayload): Promise<Transaction> {
  const state = await loadPersisted(env);
  const transaction = await fetchTransactionForUpdate(env, payload.transactionId);
  if (!transaction) {
    throw new Error("Transaction not found");
  }
  if (payload.teamId && !state.teams.some((team) => team.id === payload.teamId)) {
    throw new Error("Team not found");
  }

  state.transactionTeamAssignments = state.transactionTeamAssignments.filter(
    (assignment) => assignment.transactionId !== payload.transactionId
  );
  if (payload.teamId) {
    state.transactionTeamAssignments = [
      { transactionId: payload.transactionId, teamId: payload.teamId, updatedAt: new Date().toISOString() },
      ...state.transactionTeamAssignments
    ];
  }

  await savePersisted(env, state);
  return {
    ...transaction,
    teamId: payload.teamId
  };
}

async function createInvoice(env: Env, payload: CreateInvoicePayload): Promise<Invoice> {
  if (!payload.customerName?.trim() || !payload.amount || !payload.dueDate) {
    throw new Error("customerName, amount, and dueDate are required");
  }
  const state = await loadPersisted(env);
  const invoice = await createMeritInvoice(env, payload);
  if (!invoice) {
    throw new Error("Merit API credentials are not configured; invoice was not created.");
  }
  if (payload.transactionId && payload.providerId) {
    const transaction = await fetchTransactionForUpdate(env, payload.transactionId);
    if (transaction) {
      state.providers = state.providers.map((provider) =>
        provider.id === payload.providerId ? learnAliases(provider, bankAliasNames(transaction)) : provider
      );
    }
  }
  state.invoices = [invoice, ...state.invoices];
  await savePersisted(env, state);
  return invoice;
}

async function syncRevenue(env: Env, payload: SyncRevenuePayload = {}): Promise<DashboardSnapshot> {
  const state = await loadPersisted(env);
  const selectedPartners = state.revenuePartners.filter((partner) => partner.enabled && (!payload.partnerId || partner.id === payload.partnerId));
  if (selectedPartners.length === 0) {
    throw new Error("No revenue partner found for this sync");
  }

  const nextRuns: RevenueRun[] = [];
  for (const partner of selectedPartners) {
    const period = resolveRevenuePeriod({
      periodPreset: payload.periodPreset,
      periodStart: payload.periodStart,
      periodEnd: payload.periodEnd,
      timezone: payload.timezone || partner.timezone || env.REVENUE_TIMEZONE || "UTC"
    });
    const existingInvoicedRun = state.revenueRuns.find(
      (run) =>
        run.partnerId === partner.id &&
        run.periodStart === period.periodStart &&
        run.periodEnd === period.periodEnd &&
        run.status === "invoiced"
    );

    try {
      let run = await fetchTuneRevenue(env, partner, period);
      if (payload.createInvoices && existingInvoicedRun) {
        run = {
          ...run,
          status: "skipped",
          invoiceId: existingInvoicedRun.invoiceId,
          externalInvoiceId: existingInvoicedRun.externalInvoiceId,
          error: "Invoice already exists for this partner and period"
        };
      } else if (payload.createInvoices && run.revenue > 0 && run.status === "pulled") {
        const invoice = await createMeritInvoice(env, {
          customerName: partner.meritCustomerName || partner.name,
          amount: run.revenue,
          currency: run.currency,
          dueDate: calculateInvoiceDueDate(period.periodEnd, partner.invoiceDueDays),
          description: `${partner.name} revenue for ${period.periodStart} to ${period.periodEnd} (${period.timezone})`
        });

        if (invoice) {
          state.invoices = [invoice, ...state.invoices.filter((item) => item.id !== invoice.id)];
          run = {
            ...run,
            status: "invoiced",
            invoiceId: invoice.id,
            externalInvoiceId: invoice.externalId
          };
        } else {
          run = {
            ...run,
            status: "pulled",
            error: "Revenue pulled, but Merit invoice credentials are not configured"
          };
        }
      }
      nextRuns.push(run);
    } catch (error) {
      nextRuns.push({
        id: `revenue-${partner.id}-${period.periodStart}-${period.periodEnd}-${Date.now()}`,
        partnerId: partner.id,
        partnerName: partner.name,
        source: "tune",
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        timezone: period.timezone,
        revenue: 0,
        currency: partner.currency,
        status: "failed",
        error: error instanceof Error ? error.message : "Revenue sync failed",
        createdAt: new Date().toISOString()
      });
    }
  }

  const nextRunIds = new Set(nextRuns.map((run) => run.id));
  state.revenueRuns = [...nextRuns, ...state.revenueRuns.filter((run) => !nextRunIds.has(run.id))].slice(0, 250);
  await savePersisted(env, state);
  return getSnapshot(env);
}

async function setInvoiceApproval(env: Env, invoiceId: string, approvalStatus: "approved" | "denied"): Promise<Invoice> {
  const state = await loadPersisted(env);
  let updated: Invoice | undefined;
  state.invoices = state.invoices.map((invoice) => {
    if (invoice.id !== invoiceId) return invoice;
    updated = { ...invoice, approvalStatus };
    return updated;
  });
  if (!updated) {
    const liveInvoice = await fetchInvoiceForLocalUpdate(env, invoiceId);
    if (!liveInvoice) throw new Error("Invoice not found");
    updated = { ...liveInvoice, approvalStatus };
    state.invoices = [updated, ...state.invoices];
  }
  await savePersisted(env, state);
  return updated;
}

async function markInvoicePaidLocally(env: Env, invoiceId: string): Promise<Invoice> {
  const state = await loadPersisted(env);
  let updated: Invoice | undefined;
  state.invoices = state.invoices.map((invoice) => {
    if (invoice.id !== invoiceId) return invoice;
    updated = { ...invoice, paidLocally: true, paidLocallyAt: new Date().toISOString() };
    return updated;
  });
  if (!updated) {
    const liveInvoice = await fetchInvoiceForLocalUpdate(env, invoiceId);
    if (!liveInvoice) throw new Error("Invoice not found");
    updated = { ...liveInvoice, paidLocally: true, paidLocallyAt: new Date().toISOString() };
    state.invoices = [updated, ...state.invoices];
  }
  await savePersisted(env, state);
  return updated;
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  try {
    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "finance-dash-worker", time: new Date().toISOString() });
    }

    if (url.pathname === "/api/dashboard" && request.method === "GET") {
      return json(await getSnapshot(env));
    }

    if (url.pathname === "/api/sync" && request.method === "POST") {
      return json(await getSnapshot(env));
    }

    if (url.pathname === "/api/wise/import-statement" && request.method === "POST") {
      return json(await importWiseStatement(env, (await request.json()) as ImportWiseStatementPayload));
    }

    if (url.pathname === "/api/revenue/sync" && request.method === "POST") {
      return json(await syncRevenue(env, (await request.json()) as SyncRevenuePayload));
    }

    if (url.pathname === "/api/providers" && request.method === "POST") {
      return json(await createProvider(env, (await request.json()) as CreateProviderPayload), { status: 201 });
    }

    const providerMatch = url.pathname.match(/^\/api\/providers\/([^/]+)$/);
    if (providerMatch && request.method === "PUT") {
      return json(await updateProvider(env, providerMatch[1], (await request.json()) as UpdateProviderPayload));
    }

    const revenuePartnerMatch = url.pathname.match(/^\/api\/revenue-partners\/([^/]+)$/);
    if (revenuePartnerMatch && request.method === "PUT") {
      return json(await updateRevenuePartner(env, revenuePartnerMatch[1], (await request.json()) as UpdateRevenuePartnerPayload));
    }

    if (url.pathname === "/api/settings/ai" && request.method === "POST") {
      return json(await saveAiSettings(env, (await request.json()) as SaveAiSettingsPayload));
    }

    if (url.pathname === "/api/ai/prompt" && request.method === "POST") {
      return json(await runAiPrompt(env, (await request.json()) as AiPromptPayload));
    }

    if (url.pathname === "/api/matches" && request.method === "POST") {
      return json(await matchTransaction(env, (await request.json()) as MatchTransactionPayload));
    }

    const teamMatch = url.pathname.match(/^\/api\/transactions\/([^/]+)\/team$/);
    if (teamMatch && request.method === "POST") {
      const body = (await request.json()) as { teamId?: string | null };
      return json(await assignTransactionTeam(env, { transactionId: teamMatch[1], teamId: body.teamId || undefined }));
    }

    if (url.pathname === "/api/invoices" && request.method === "POST") {
      return json(await createInvoice(env, (await request.json()) as CreateInvoicePayload), { status: 201 });
    }

    const approvalMatch = url.pathname.match(/^\/api\/invoices\/([^/]+)\/approval$/);
    if (approvalMatch && request.method === "POST") {
      const body = (await request.json()) as { approvalStatus?: "approved" | "denied" };
      if (body.approvalStatus !== "approved" && body.approvalStatus !== "denied") {
        return json({ message: "approvalStatus must be approved or denied" }, { status: 400 });
      }
      return json(await setInvoiceApproval(env, approvalMatch[1], body.approvalStatus));
    }

    const localPaidMatch = url.pathname.match(/^\/api\/invoices\/([^/]+)\/local-paid$/);
    if (localPaidMatch && request.method === "POST") {
      return json(await markInvoicePaidLocally(env, localPaidMatch[1]));
    }

    return json({ message: "Not found" }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown server error";
    return json({ message }, { status: 500 });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env);
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await syncRevenue(env, {
      periodPreset: "last-week",
      timezone: env.REVENUE_TIMEZONE || "UTC",
      createInvoices: true
    });
  }
};
