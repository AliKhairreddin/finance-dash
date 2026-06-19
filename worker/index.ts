import type {
  AccountBalance,
  CreateInvoicePayload,
  CreateProviderPayload,
  DashboardSnapshot,
  DataSource,
  IntegrationStatus,
  Invoice,
  MatchTransactionPayload,
  Provider,
  Transaction
} from "../shared/types";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { calculateMetrics } from "../server/calculations";
import { enrichTransactions, learnAlias } from "../server/matching";
import {
  seededAccounts,
  seededAsOf,
  seededInvestments,
  seededInvoices,
  seededOpenBalances,
  seededPayables,
  seededProviders,
  seededReceivables,
  seededTransactions
} from "../server/mockData";

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

interface KVNamespace {
  get<T = unknown>(key: string, type: "json"): Promise<T | null>;
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
}

interface Env {
  ASSETS: Fetcher;
  FINANCE_KV?: KVNamespace;
  CONVEX_URL?: string;
  WISE_API_TOKEN?: string;
  WISE_PROFILE_ID?: string;
  WISE_BALANCE_IDS?: string;
  WISE_ENVIRONMENT?: string;
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
}

interface PersistedState {
  providers: Provider[];
  invoices: Invoice[];
}

const stateKey = "finance-dashboard-state";
const wiseBaseUrlByEnvironment = {
  production: "https://api.wise.com",
  sandbox: "https://api.wise-sandbox.com"
};
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

function mergeById<T extends { id: string }>(seeded: T[], persisted?: T[]): T[] {
  const map = new Map(seeded.map((item) => [item.id, item]));
  for (const item of persisted ?? []) {
    map.set(item.id, item);
  }
  return [...map.values()];
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
      return { id, currency };
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

function parseStatementDate(value: string | undefined): string {
  return (value ?? new Date().toISOString()).slice(0, 10);
}

async function fetchWiseActivity(env: Env): Promise<{ accounts: AccountBalance[]; transactions: Transaction[] }> {
  if (!env.WISE_API_TOKEN || !env.WISE_PROFILE_ID || !env.WISE_BALANCE_IDS) {
    return { accounts: [], transactions: [] };
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
  >(`${baseUrl}/v4/profiles/${env.WISE_PROFILE_ID}/balances?types=STANDARD`, {
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

function mergeLiveAccounts(liveWiseAccounts: AccountBalance[], liveSlashAccounts: AccountBalance[]): AccountBalance[] {
  const omittedSources = new Set([
    ...(liveWiseAccounts.length > 0 ? ["wise"] : []),
    ...(liveSlashAccounts.length > 0 ? ["slash"] : [])
  ]);
  return [...seededAccounts.filter((account) => !omittedSources.has(account.source)), ...liveWiseAccounts, ...liveSlashAccounts];
}

async function fetchInvoiceForLocalUpdate(env: Env, invoiceId: string): Promise<Invoice | undefined> {
  return (await fetchMeritInvoices(env).catch(() => [])).find((invoice) => invoice.id === invoiceId);
}

async function fetchTransactionForMatch(env: Env, transactionId: string): Promise<Transaction | undefined> {
  const seeded = seededTransactions.find((transaction) => transaction.id === transactionId);
  if (seeded) return seeded;

  const [wise, slash] = await Promise.all([
    fetchWiseActivity(env).catch(() => ({ accounts: [], transactions: [] })),
    fetchSlashActivity(env).catch(() => ({ accounts: [], transactions: [] }))
  ]);
  return [...wise.transactions, ...slash.transactions].find((transaction) => transaction.id === transactionId);
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

async function loadPersisted(env: Env): Promise<PersistedState> {
  const convex = getConvexClient(env);
  const convexState = convex ? await convex.query(api.dashboard.getState, {}).catch(() => null) : null;
  const stored = convexState ?? (await env.FINANCE_KV?.get<Partial<PersistedState>>(stateKey, "json"));

  return {
    providers: mergeById(seededProviders, stored?.providers),
    invoices: mergeById(seededInvoices, stored?.invoices)
  };
}

async function savePersisted(env: Env, state: PersistedState): Promise<void> {
  const convex = getConvexClient(env);
  if (convex) {
    await convex.mutation(api.dashboard.saveState, state).catch(() => undefined);
  }
  await env.FINANCE_KV?.put(stateKey, JSON.stringify(state));
}

function integrationStatus(env: Env): IntegrationStatus[] {
  const wiseNeeds = ["WISE_API_TOKEN", "WISE_PROFILE_ID"].filter((name) => !env[name as keyof Env]);
  if (!env.WISE_BALANCE_IDS) wiseNeeds.push("WISE_BALANCE_IDS");

  const slashNeeds = ["SLASH_API_KEY"].filter((name) => !env[name as keyof Env]);

  const meritNeeds = ["MERIT_API_ID", "MERIT_API_KEY", "MERIT_DEFAULT_TAX_ID"].filter((name) => !env[name as keyof Env]);

  return [
    {
      id: "wise" as DataSource,
      label: "Wise",
      configured: wiseNeeds.length === 0,
      mode: wiseNeeds.length === 0 ? "live" : "mock",
      message:
        wiseNeeds.length === 0
          ? "Credentials are present. Live Wise sync can be enabled for statements."
          : "Using seeded Wise balances and transactions until credentials are added.",
      needs: wiseNeeds
    },
    {
      id: "slash" as DataSource,
      label: "Slash",
      configured: slashNeeds.length === 0,
      mode: slashNeeds.length === 0 ? "live" : "mock",
      message:
        slashNeeds.length === 0
          ? "Slash API key is present."
          : "Using seeded Slash account and card activity until beta API access is added.",
      needs: slashNeeds
    },
    {
      id: "merit" as DataSource,
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

async function getSnapshot(env: Env): Promise<DashboardSnapshot> {
  const state = await loadPersisted(env);
  const [wise, slash, liveMeritInvoices] = await Promise.all([
    fetchWiseActivity(env).catch(() => ({ accounts: [], transactions: [] })),
    fetchSlashActivity(env).catch(() => ({ accounts: [], transactions: [] })),
    fetchMeritInvoices(env).catch(() => [])
  ]);
  const accounts = mergeLiveAccounts(wise.accounts, slash.accounts);
  const invoices = mergeById(liveMeritInvoices, state.invoices);
  const rawTransactions = mergeById(seededTransactions, [...wise.transactions, ...slash.transactions]);
  const transactions = enrichTransactions(
    rawTransactions.map((transaction) => {
      const invoice = invoices.find((item) => item.transactionId === transaction.id);
      return invoice
        ? { ...transaction, matchedInvoiceId: invoice.id, matchedProviderId: invoice.providerId ?? transaction.matchedProviderId }
        : transaction;
    }),
    state.providers
  );

  return {
    asOf: seededAsOf,
    accounts,
    receivables: seededReceivables,
    openBalances: seededOpenBalances,
    payables: seededPayables,
    investments: seededInvestments,
    providers: state.providers,
    transactions,
    invoices,
    integrationStatus: integrationStatus(env),
    metrics: calculateMetrics(accounts, seededReceivables, seededOpenBalances, seededPayables, seededInvestments),
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

async function matchTransaction(env: Env, payload: MatchTransactionPayload) {
  const state = await loadPersisted(env);
  const transaction = await fetchTransactionForMatch(env, payload.transactionId);
  const provider = state.providers.find((item) => item.id === payload.providerId);
  if (!transaction || !provider) {
    throw new Error("Provider or transaction not found");
  }
  if (payload.rememberAlias) {
    state.providers = state.providers.map((item) =>
      item.id === provider.id ? learnAlias(item, transaction.rawName) : item
    );
    await savePersisted(env, state);
  }
  return {
    ...transaction,
    matchedProviderId: payload.providerId,
    matchedInvoiceId: payload.invoiceId,
    confidence: 1,
    matchReason: "Manual match"
  };
}

async function createInvoice(env: Env, payload: CreateInvoicePayload): Promise<Invoice> {
  if (!payload.customerName?.trim() || !payload.amount || !payload.dueDate) {
    throw new Error("customerName, amount, and dueDate are required");
  }
  const state = await loadPersisted(env);
  const invoice: Invoice =
    (await createMeritInvoice(env, payload)) ?? {
      id: `mock-invoice-${crypto.randomUUID()}`,
      providerId: payload.providerId,
      customerName: payload.customerName,
      amount: payload.amount,
      currency: payload.currency,
      status: "draft",
      approvalStatus: "pending",
      paidLocally: false,
      meritPaid: false,
      dueDate: payload.dueDate,
      source: "mock",
      description: payload.description,
      transactionId: payload.transactionId,
      createdAt: new Date().toISOString()
    };
  state.invoices = [invoice, ...state.invoices];
  await savePersisted(env, state);
  return invoice;
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

    if (url.pathname === "/api/providers" && request.method === "POST") {
      return json(await createProvider(env, (await request.json()) as CreateProviderPayload), { status: 201 });
    }

    if (url.pathname === "/api/matches" && request.method === "POST") {
      return json(await matchTransaction(env, (await request.json()) as MatchTransactionPayload));
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
  }
};
