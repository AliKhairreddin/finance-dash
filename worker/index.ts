import type {
  AccountBalance,
  CreateInvoicePayload,
  CreateProviderPayload,
  DashboardSnapshot,
  DataSource,
  IntegrationStatus,
  Invoice,
  MatchTransactionPayload,
  Provider
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
  QUICKBOOKS_CLIENT_ID?: string;
  QUICKBOOKS_CLIENT_SECRET?: string;
  QUICKBOOKS_REFRESH_TOKEN?: string;
  QUICKBOOKS_ACCESS_TOKEN?: string;
  QUICKBOOKS_REALM_ID?: string;
  QUICKBOOKS_ENVIRONMENT?: string;
  QUICKBOOKS_INCOME_ITEM_ID?: string;
  QUICKBOOKS_INCOME_ITEM_NAME?: string;
  MERIT_API_BASE_URL?: string;
  MERIT_API_KEY?: string;
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
  if (!value) return new Set();
  return new Set(
    value
      .split(",")
      .map((pair) => pair.trim().split(":")[0])
      .filter(Boolean)
  );
}

function mergeLiveWiseAccounts(liveWiseAccounts: AccountBalance[]): AccountBalance[] {
  if (liveWiseAccounts.length === 0) return seededAccounts;
  return [...seededAccounts.filter((account) => account.source !== "wise"), ...liveWiseAccounts];
}

async function fetchWiseAccounts(env: Env): Promise<AccountBalance[]> {
  if (!env.WISE_API_TOKEN || !env.WISE_PROFILE_ID || !env.WISE_BALANCE_IDS) return [];

  const wiseBaseUrl =
    env.WISE_ENVIRONMENT === "sandbox" ? wiseBaseUrlByEnvironment.sandbox : wiseBaseUrlByEnvironment.production;
  const selectedBalanceIds = parseWiseBalanceIds(env.WISE_BALANCE_IDS);
  const response = await fetch(`${wiseBaseUrl}/v4/profiles/${env.WISE_PROFILE_ID}/balances?types=STANDARD`, {
    headers: {
      Authorization: `Bearer ${env.WISE_API_TOKEN}`
    }
  });

  if (!response.ok) {
    throw new Error(`Wise balance sync failed: ${response.status} ${response.statusText}`);
  }

  const balances = (await response.json()) as Array<{
    id: number;
    currency: string;
    amount?: { value?: number; currency?: string };
    modificationTime?: string;
    visible?: boolean;
  }>;

  return balances
    .filter((balance) => balance.visible !== false)
    .filter((balance) => selectedBalanceIds.size === 0 || selectedBalanceIds.has(String(balance.id)))
    .map((balance) => ({
      id: `wise-${balance.id}`,
      name: `Wise ${balance.currency}`,
      source: "wise",
      balance: balance.amount?.value ?? 0,
      currency: balance.amount?.currency ?? balance.currency,
      updatedAt: balance.modificationTime ?? new Date().toISOString(),
      status: "live"
    }));
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

  const hasQuickBooksAccess = Boolean(env.QUICKBOOKS_ACCESS_TOKEN && env.QUICKBOOKS_REALM_ID);
  const hasQuickBooksRefresh = Boolean(
    env.QUICKBOOKS_CLIENT_ID &&
      env.QUICKBOOKS_CLIENT_SECRET &&
      env.QUICKBOOKS_REFRESH_TOKEN &&
      env.QUICKBOOKS_REALM_ID
  );
  const quickBooksNeeds =
    hasQuickBooksAccess || hasQuickBooksRefresh
      ? []
      : ["QUICKBOOKS_CLIENT_ID", "QUICKBOOKS_CLIENT_SECRET", "QUICKBOOKS_REFRESH_TOKEN", "QUICKBOOKS_REALM_ID"];

  const meritNeeds = ["MERIT_API_BASE_URL", "MERIT_API_KEY"].filter((name) => !env[name as keyof Env]);

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
      id: "quickbooks" as DataSource,
      label: "QuickBooks",
      configured: quickBooksNeeds.length === 0,
      mode: quickBooksNeeds.length === 0 ? "live" : "mock",
      message:
        quickBooksNeeds.length === 0
          ? "QuickBooks OAuth credentials are present."
          : "Invoice creation is simulated until QuickBooks credentials are added.",
      needs: quickBooksNeeds
    },
    {
      id: "merit" as DataSource,
      label: "Merit",
      configured: meritNeeds.length === 0,
      mode: meritNeeds.length === 0 ? "partial" : "mock",
      message:
        meritNeeds.length === 0
          ? "Generic Merit connector variables are present."
          : "Merit remains optional until the exact product/API is confirmed.",
      needs: meritNeeds
    }
  ];
}

async function getSnapshot(env: Env): Promise<DashboardSnapshot> {
  const state = await loadPersisted(env);
  const liveWiseAccounts = await fetchWiseAccounts(env).catch(() => []);
  const accounts = mergeLiveWiseAccounts(liveWiseAccounts);
  const transactions = enrichTransactions(
    seededTransactions.map((transaction) => {
      const invoice = state.invoices.find((item) => item.transactionId === transaction.id);
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
    invoices: state.invoices,
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
  const transaction = seededTransactions.find((item) => item.id === payload.transactionId);
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
  const invoice: Invoice = {
    id: `mock-invoice-${crypto.randomUUID()}`,
    providerId: payload.providerId,
    customerName: payload.customerName,
    amount: payload.amount,
    currency: payload.currency,
    status: "draft",
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
