import crypto from "node:crypto";
import type { AccountBalance, CreateInvoicePayload, IntegrationStatus, Invoice, Transaction } from "../shared/types";

const slashBaseUrl = process.env.SLASH_BASE_URL || "https://api.slash.com";
const meritApiBaseUrl = process.env.MERIT_API_BASE_URL || "https://aktiva.merit.ee/api";
const meritGetInvoicesPath = process.env.MERIT_GET_INVOICES_PATH || "/v1/getinvoices";
const meritCreateInvoicePath = process.env.MERIT_CREATE_INVOICE_PATH || "/v2/sendinvoice";
const wiseBaseUrl =
  process.env.WISE_ENVIRONMENT === "sandbox"
    ? "https://api.wise-sandbox.com"
    : "https://api.wise.com";

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
  const meritNeeds = ["MERIT_API_ID", "MERIT_API_KEY", "MERIT_DEFAULT_TAX_ID"].filter((name) => !process.env[name]);

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
          ? "Ready to pull accounts, card activity, and transactions."
          : "Using seeded Slash account and card activity until beta API access is added.",
      needs: slashNeeds
    },
    {
      id: "merit",
      label: "Merit",
      configured: meritNeeds.length === 0,
      mode: meritNeeds.length === 0 ? "live" : "mock",
      message:
        meritNeeds.length === 0
          ? "Ready to pull Merit invoices and create new Merit invoices. Local paid status never updates Merit."
          : "Using seeded invoices until Merit API credentials and default tax configuration are added.",
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

export async function createMeritInvoice(payload: CreateInvoicePayload): Promise<Invoice | undefined> {
  const taxId = process.env.MERIT_DEFAULT_TAX_ID;
  if (!process.env.MERIT_API_ID || !process.env.MERIT_API_KEY || !taxId) return undefined;

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
