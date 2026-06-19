import crypto from "node:crypto";
import type { AccountBalance, CreateInvoicePayload, IntegrationStatus, Invoice, Transaction } from "../shared/types";

const slashBaseUrl = process.env.SLASH_BASE_URL || "https://api.slash.com";
const quickBooksApiBase =
  process.env.QUICKBOOKS_ENVIRONMENT === "production"
    ? "https://quickbooks.api.intuit.com"
    : "https://sandbox-quickbooks.api.intuit.com";
const wiseBaseUrl =
  process.env.WISE_ENVIRONMENT === "production"
    ? "https://api.wise.com"
    : "https://api.wise-sandbox.com";

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export function getIntegrationStatus(): IntegrationStatus[] {
  const wiseNeeds = ["WISE_API_TOKEN", "WISE_PROFILE_ID"].filter((name) => !process.env[name]);
  if (!process.env.WISE_BALANCE_IDS) wiseNeeds.push("WISE_BALANCE_IDS");

  const slashNeeds = ["SLASH_API_KEY"].filter((name) => !process.env[name]);

  const hasQuickBooksAccess = Boolean(process.env.QUICKBOOKS_ACCESS_TOKEN && process.env.QUICKBOOKS_REALM_ID);
  const hasQuickBooksRefresh = Boolean(
    process.env.QUICKBOOKS_CLIENT_ID &&
      process.env.QUICKBOOKS_CLIENT_SECRET &&
      process.env.QUICKBOOKS_REFRESH_TOKEN &&
      process.env.QUICKBOOKS_REALM_ID
  );
  const quickBooksNeeds = hasQuickBooksAccess || hasQuickBooksRefresh
    ? []
    : ["QUICKBOOKS_CLIENT_ID", "QUICKBOOKS_CLIENT_SECRET", "QUICKBOOKS_REFRESH_TOKEN", "QUICKBOOKS_REALM_ID"];

  const meritNeeds = ["MERIT_API_BASE_URL", "MERIT_API_KEY"].filter((name) => !process.env[name]);

  return [
    {
      id: "wise",
      label: "Wise",
      configured: wiseNeeds.length === 0,
      mode: wiseNeeds.length === 0 ? "live" : "mock",
      message:
        wiseNeeds.length === 0
          ? "Ready to pull balances, statements, and transaction activity."
          : "Using seeded Wise balances and transactions until credentials are added.",
      needs: wiseNeeds
    },
    {
      id: "slash",
      label: "Slash",
      configured: slashNeeds.length === 0,
      mode: slashNeeds.length === 0 ? "live" : "mock",
      message:
        slashNeeds.length === 0
          ? "Ready to pull accounts, virtual accounts, card groups, and transactions."
          : "Using seeded Slash account and card activity until beta API access is added.",
      needs: slashNeeds
    },
    {
      id: "quickbooks",
      label: "QuickBooks",
      configured: quickBooksNeeds.length === 0,
      mode: quickBooksNeeds.length === 0 ? "live" : "mock",
      message:
        quickBooksNeeds.length === 0
          ? "Ready to query customers/invoices and create invoices."
          : "Invoice creation is simulated until OAuth credentials or an access token are added.",
      needs: quickBooksNeeds
    },
    {
      id: "merit",
      label: "Merit",
      configured: meritNeeds.length === 0,
      mode: meritNeeds.length === 0 ? "partial" : "mock",
      message:
        meritNeeds.length === 0
          ? "Generic Merit connector configured. Confirm the exact product and schema before live writes."
          : "Merit is ambiguous, so this connector stays optional until the exact API is confirmed.",
      needs: meritNeeds
    }
  ];
}

export async function fetchWiseActivity(): Promise<{ accounts: AccountBalance[]; transactions: Transaction[] }> {
  const token = process.env.WISE_API_TOKEN;
  const profileId = process.env.WISE_PROFILE_ID;
  const balancePairs = process.env.WISE_BALANCE_IDS;
  if (!token || !profileId || !balancePairs) return { accounts: [], transactions: [] };

  const intervalEnd = new Date().toISOString();
  const intervalStart = new Date(Date.now() - 1000 * 60 * 60 * 24 * 45).toISOString();
  const balances = balancePairs.split(",").map((pair) => {
    const [id, currency = "USD"] = pair.trim().split(":");
    return { id, currency };
  });
  const selectedBalanceIds = new Set(balances.map((balance) => balance.id));

  const transactions: Transaction[] = [];
  const accounts = await fetchJson<
    Array<{
      id: number;
      currency: string;
      amount?: { value?: number; currency?: string };
      modificationTime?: string;
      visible?: boolean;
    }>
  >(`${wiseBaseUrl}/v4/profiles/${profileId}/balances?types=STANDARD`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  }).then((wiseBalances) => {
    return wiseBalances
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
      }));
  });

  for (const balance of balances) {
    const params = new URLSearchParams({
      currency: balance.currency,
      intervalStart,
      intervalEnd,
      type: "COMPACT",
      statementLocale: "en"
    });
    const statement = await fetchJson<{
      endOfStatementBalance?: { value?: number; currency?: string };
      transactions?: Array<{
        date?: string;
        type?: string;
        details?: { description?: string; senderName?: string; recipientName?: string; referenceNumber?: string };
        amount?: { value?: number; currency?: string };
        totalFees?: { value?: number };
      }>;
    }>(`${wiseBaseUrl}/v1/profiles/${profileId}/balance-statements/${balance.id}/statement.json?${params}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-External-Correlation-Id": crypto.randomUUID()
      }
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

async function refreshQuickBooksToken(): Promise<string | undefined> {
  if (process.env.QUICKBOOKS_ACCESS_TOKEN) return process.env.QUICKBOOKS_ACCESS_TOKEN;
  const { QUICKBOOKS_CLIENT_ID, QUICKBOOKS_CLIENT_SECRET, QUICKBOOKS_REFRESH_TOKEN } = process.env;
  if (!QUICKBOOKS_CLIENT_ID || !QUICKBOOKS_CLIENT_SECRET || !QUICKBOOKS_REFRESH_TOKEN) return undefined;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: QUICKBOOKS_REFRESH_TOKEN
  });
  const token = Buffer.from(`${QUICKBOOKS_CLIENT_ID}:${QUICKBOOKS_CLIENT_SECRET}`).toString("base64");
  const response = await fetchJson<{ access_token: string }>("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: {
      Authorization: `Basic ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body
  });
  return response.access_token;
}

export async function createQuickBooksInvoice(payload: CreateInvoicePayload): Promise<Invoice | undefined> {
  const realmId = process.env.QUICKBOOKS_REALM_ID;
  const accessToken = await refreshQuickBooksToken();
  if (!realmId || !accessToken) return undefined;

  const itemValue = process.env.QUICKBOOKS_INCOME_ITEM_ID || "1";
  const itemName = process.env.QUICKBOOKS_INCOME_ITEM_NAME || "Services";
  const requestBody = {
    Line: [
      {
        DetailType: "SalesItemLineDetail",
        Amount: payload.amount,
        Description: payload.description,
        SalesItemLineDetail: {
          ItemRef: {
            name: itemName,
            value: itemValue
          }
        }
      }
    ],
    CustomerRef: {
      name: payload.customerName,
      value: payload.providerId || "1"
    },
    DueDate: payload.dueDate
  };

  const response = await fetchJson<{ Invoice?: { Id?: string; DocNumber?: string; TotalAmt?: number } }>(
    `${quickBooksApiBase}/v3/company/${realmId}/invoice?minorversion=75`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody)
    }
  );

  return {
    id: `qbo-${response.Invoice?.Id ?? crypto.randomUUID()}`,
    providerId: payload.providerId,
    customerName: payload.customerName,
    amount: response.Invoice?.TotalAmt ?? payload.amount,
    currency: payload.currency,
    status: "created",
    dueDate: payload.dueDate,
    source: "quickbooks",
    externalId: response.Invoice?.Id,
    description: payload.description,
    transactionId: payload.transactionId,
    createdAt: new Date().toISOString()
  };
}
