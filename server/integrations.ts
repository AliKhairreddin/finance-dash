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
  const tuneNeeds = ["KISSTERRA_TUNE_NETWORK_ID", "KISSTERRA_TUNE_API_KEY"].filter((name) => !process.env[name]);

  return [
    {
      id: "wise",
      label: "Wise",
      configured: wiseNeeds.length === 0,
      mode: wiseNeeds.length === 0 ? "live" : "partial",
      message:
        wiseNeeds.length === 0
          ? "Ready to pull balances, statements, and transaction activity."
          : "Wise rows stay empty until API token, profile, and balance IDs are configured.",
      needs: wiseNeeds
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
      id: "merit",
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
      id: "tune",
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

export async function fetchWiseActivity(): Promise<{ accounts: AccountBalance[]; transactions: Transaction[] }> {
  const token = process.env.WISE_API_TOKEN;
  const profileId = process.env.WISE_PROFILE_ID;
  const balancePairs = process.env.WISE_BALANCE_IDS;
  if (!token || !profileId || !balancePairs) return { accounts: [], transactions: [] };

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
