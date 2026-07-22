import type {
  WorkerEnv as Env,
  WorkerExportedHandler,
  WorkerScheduledController as ScheduledController
} from "../worker-configuration";
import type {
  AccountBalance,
  AiPromptPayload,
  AssignTransactionTeamPayload,
  AssignWiseCardHolderTeamPayload,
  AutomationRun,
  AutoCategorizeTransactionsPayload,
  AutoCategorizeTransactionsResult,
  CreateHoldingPayload,
  CreateInvoicePayload,
  CreateProviderPayload,
  CreateRevenuePartnerPayload,
  CreateTeamPayload,
  DashboardSnapshot,
  DataSource,
  FxRate,
  Holding,
  ImportWiseStatementPayload,
  ImportWiseStatementResult,
  ImportWiseStatementSummary,
  IntegrationStatus,
  Invoice,
  MeritTax,
  MatchTransactionPayload,
  PaymentAllocation,
  PersistedAiSettings,
  ProfitDistributionAdjustment,
  Provider,
  RecordInvoicePaymentPayload,
  RevenueAccrual,
  RevenuePartner,
  RevenueRun,
  SaveProfitDistributionAdjustmentPayload,
  SaveAiSettingsPayload,
  SendInvoicesPayload,
  SendInvoicesResult,
  StoredAiSettings,
  SyncRevenuePayload,
  Team,
  TransactionTeamAssignment,
  Transaction,
  TransactionCategoryRule,
  UpdateProviderPayload,
  UpdateHoldingPayload,
  UpdateInvoicePayload,
  UpdateTransactionCategoryPayload,
  UpdateRevenuePartnerPayload,
  WiseCardHolderTeamAssignment,
  WiseStatementImport
} from "../shared/types";
import { defaultAiSettings, publicAiSettings, runOpenRouterPrompt, runOpenRouterTransactionCategorization } from "../shared/ai";
import { canonicalTeamId, canonicalTeamName } from "../shared/business";
import {
  isReviewOnlyTransactionCategory,
  isTransactionCategoryForDirection,
  transactionBusinessCategory
} from "../shared/categories";
import { deleteProviderReferences } from "../shared/providerDeletion";
import {
  calculateRevenueMetrics,
  calculateTuneHourOffset,
  mergeRevenuePartnerDirectory,
  resolveRevenuePeriod
} from "../shared/revenue";
import type { RevenuePeriod } from "../shared/revenue";
import {
  applyPaymentState,
  buildRevenueDraft,
  calculateApproximateUsdTotals,
  calculateInvoicePredictions,
  currentMonthAccrualPeriod,
  currentWeekAccrualPeriod,
  incomeAutomationTimezone,
  invoiceOutstanding,
  isClosedBillingPeriod,
  isLiquidAccountBalance,
  isLebanonIncomeAutomationTime,
  mergeFxRates,
  previousCalendarMonth,
  previousCompletedWeek,
  pruneSupersededAccrualRun,
  reconcileExactInvoicePayments
} from "../shared/income";
import {
  calculateProfitDistribution,
  profitDistributionAdjustmentFromPayload,
  shouldKeepProfitDistributionAdjustment
} from "../shared/distribution";
import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { api } from "../convex/_generated/api";
import { calculateMetrics } from "../server/calculations";
import {
  enrichTransactions,
  learnAliases,
  learnCategoryAliases,
  mergeWiseCardHolderTeamAssignments,
  mergeProviderDirectory,
  mergeTeamDirectory,
  normalizeCardHolderName,
  normalizeName,
  providerMatchesTransactionDirection,
  providerTypeForTransactionDirection,
  semanticCategorizeTransaction,
  semanticMatchThreshold,
  transactionAliasCandidates,
  uniqueProviderTags
} from "../server/matching";

interface PersistedState {
  revision: string | null;
  providers: Provider[];
  invoices: Invoice[];
  teams: Team[];
  transactionCategoryRules: TransactionCategoryRule[];
  revenuePartners: RevenuePartner[];
  transactionTeamAssignments: TransactionTeamAssignment[];
  wiseCardHolderTeamAssignments: WiseCardHolderTeamAssignment[];
  wiseStatementTransactions: Transaction[];
  wiseStatementImports: WiseStatementImport[];
  revenueRuns: RevenueRun[];
  revenueAccruals: RevenueAccrual[];
  paymentAllocations: PaymentAllocation[];
  holdings: Holding[];
  fxRates: FxRate[];
  fxTrackedAssets: string[];
  automationRuns: AutomationRun[];
  profitDistributionAdjustments: ProfitDistributionAdjustment[];
  aiSettings?: PersistedAiSettings;
}

class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
  }
}

function cleanOptional(value?: string): string | undefined {
  return value?.trim() || undefined;
}

function cleanOptionalNumber(value?: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function calendarMonthEnd(periodStart: string): string {
  const [year, month] = periodStart.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function openAccrualPeriodEnd(partner: RevenuePartner, run: RevenueRun, now = new Date()): string | undefined {
  if (run.status !== "pulled") return undefined;
  if (partner.billingCadence === "weekly") {
    const currentWeek = currentWeekAccrualPeriod(now, partner.billingTimezone);
    return run.periodStart === currentWeek.periodStart &&
      run.periodEnd >= run.periodStart &&
      run.periodEnd <= currentWeek.accruedThrough
      ? currentWeek.periodEnd
      : undefined;
  }
  const currentMonth = resolveRevenuePeriod({ periodPreset: "this-month", timezone: partner.billingTimezone, now });
  return run.periodStart === currentMonth.periodStart &&
    run.periodEnd >= run.periodStart &&
    run.periodEnd <= currentMonth.periodEnd
    ? calendarMonthEnd(run.periodStart)
    : undefined;
}

function isEnvironmentVariableName(value: string | undefined): boolean {
  return Boolean(value && /^[A-Z][A-Z0-9_]*$/.test(value));
}

function isValidTimezone(value: string | undefined): boolean {
  if (!value?.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

function meritWritesEnabled(env: Env): boolean {
  return env.MERIT_WRITES_ENABLED === "true";
}

function assertMeritWriteConfiguration(env: Env): void {
  if (!meritWritesEnabled(env)) {
    throw new ApiError(409, "Merit invoice sending is disabled by the deployment safety switch.");
  }

  const missing = ["MERIT_API_ID", "MERIT_API_KEY"].filter((name) => !env[name as keyof Env]);
  if (missing.length > 0) {
    throw new ApiError(503, `Merit invoice sending is missing ${missing.join(", ")}.`);
  }
}

function companyDetails(payload: CreateProviderPayload | UpdateProviderPayload): Pick<
  Provider,
  | "defaultAccount"
  | "legalName"
  | "email"
  | "country"
  | "address"
  | "taxId"
  | "defaultCurrency"
  | "paymentTermsDays"
  | "meritCustomerId"
  | "meritSupplierId"
> {
  return {
    defaultAccount: cleanOptional(payload.defaultAccount),
    legalName: cleanOptional(payload.legalName),
    email: cleanOptional(payload.email),
    country: cleanOptional(payload.country),
    address: cleanOptional(payload.address),
    taxId: cleanOptional(payload.taxId),
    defaultCurrency: cleanOptional(payload.defaultCurrency),
    paymentTermsDays: cleanOptionalNumber(payload.paymentTermsDays),
    meritCustomerId: cleanOptional(payload.meritCustomerId),
    meritSupplierId: cleanOptional(payload.meritSupplierId)
  };
}

function providerType(payload: CreateProviderPayload | UpdateProviderPayload): Provider["type"] {
  if (payload.type !== "client" && payload.type !== "supplier") {
    throw new Error("Company relationship must be client or supplier");
  }
  return payload.type;
}

function providerTypeForInvoiceDocument(documentType: CreateInvoicePayload["documentType"]): Provider["type"] {
  return documentType === "sales_invoice" ? "client" : "supplier";
}

function providerTags(payload: CreateProviderPayload | UpdateProviderPayload): string[] {
  return uniqueProviderTags(Array.isArray(payload.tags) ? payload.tags : []);
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
const defaultCoinbaseExchangeRatesUrl = "https://api.coinbase.com/v2/exchange-rates";
const defaultMeritDeliverInvoicePath = "/v2/sendinvoicebyemail";
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

export function mergeInvoices(liveInvoices: Invoice[], persistedInvoices: Invoice[]): Invoice[] {
  const invoiceKey = (invoice: Invoice): string => invoice.externalId ? `external:${invoice.externalId}` : `id:${invoice.id}`;
  const map = new Map(liveInvoices.map((invoice) => [invoiceKey(invoice), invoice]));
  for (const invoice of persistedInvoices) {
    const key = invoiceKey(invoice);
    const live = map.get(key);
    map.set(key, live ? { ...invoice, meritStatus: live.meritStatus } : invoice);
  }
  return [...map.values()];
}

function normalizedTransactionText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function wiseStatementTransactionKey(transaction: Transaction): string {
  const sourceId = transaction.id.match(/^wise-(?:csv|pdf)-[^-]+-(.+)$/)?.[1];
  if (sourceId) return `${transaction.currency}:${sourceId}`;
  if (transaction.id) return `id:${transaction.id}`;

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
  for (const transaction of initial) {
    map.set(wiseStatementTransactionKey(transaction), transaction);
  }
  for (const transaction of incoming) {
    const key = wiseStatementTransactionKey(transaction);
    const existing = map.get(key);
    map.set(key, existing ? mergeBankTransaction(existing, transaction) : transaction);
  }
  return [...map.values()];
}

function mergeBankTransaction(existing: Transaction, fresh: Transaction): Transaction {
  return {
    ...existing,
    ...fresh,
    category: existing.category,
    matchedProviderId: existing.matchedProviderId ?? fresh.matchedProviderId,
    matchedInvoiceId: existing.matchedInvoiceId ?? fresh.matchedInvoiceId,
    teamId: existing.teamId ?? fresh.teamId,
    confidence: existing.confidence ?? fresh.confidence,
    matchReason: existing.matchReason ?? fresh.matchReason
  };
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

function normalizedTeamAssignments(rows?: TransactionTeamAssignment[]): TransactionTeamAssignment[] {
  return (rows ?? []).map((assignment) => ({
    ...assignment,
    teamId: canonicalTeamId(assignment.teamId)
  }));
}

function bankAliasNames(transaction: Transaction): string[] {
  return transactionAliasCandidates(transaction);
}

function getConvexClient(env: Env): ConvexHttpClient {
  const url = env.CONVEX_URL?.trim();
  if (!url) throw new ApiError(503, "Dashboard storage is not configured");
  return new ConvexHttpClient(url);
}

function getConvexServiceToken(env: Env): string {
  const token = env.CONVEX_SERVICE_TOKEN?.trim();
  if (!token) throw new ApiError(503, "Dashboard storage authentication is not configured");
  return token;
}

async function getManagementReportDashboard(env: Env): Promise<unknown> {
  const convex = getConvexClient(env);
  const serviceToken = getConvexServiceToken(env);
  try {
    return await convex.query(api.managementReport.getDashboard, { serviceToken });
  } catch (error) {
    throw new ApiError(503, "Management report storage is temporarily unavailable", { cause: error });
  }
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

function meritConnectionIssue(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown Merit API error";
  if (/\b401\b/.test(message)) {
    return "Merit rejected API access (401). Confirm this company has Merit API access on its plan and that these credentials belong to it.";
  }
  if (/\b400\b/.test(message)) {
    return "Merit rejected the API credentials (400). Regenerate the API ID and key in Merit, then update both Worker secrets.";
  }
  return `Merit read failed: ${message.replace(/\s+/g, " ").slice(0, 180)}`;
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
      console.warn(JSON.stringify({
        event: "wise_statement_fetch_failed",
        balanceId: balance.id,
        error: error instanceof Error ? error.message : "Unknown Wise statement error"
      }));
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

async function fetchAmexAccessToken(env: Env): Promise<string | undefined> {
  if (!env.AMEX_TOKEN_URL || !env.AMEX_CLIENT_ID || !env.AMEX_CLIENT_SECRET || !env.AMEX_REFRESH_TOKEN) return undefined;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: env.AMEX_REFRESH_TOKEN,
    client_id: env.AMEX_CLIENT_ID,
    client_secret: env.AMEX_CLIENT_SECRET
  });

  const response = await fetchJson<{ access_token?: string }>(env.AMEX_TOKEN_URL, {
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

function amexEndpoint(env: Env, template: string, accountId: string, query?: URLSearchParams): string {
  if (!env.AMEX_API_BASE_URL) throw new Error("AMEX_API_BASE_URL is not configured");
  const path = template.replaceAll("{accountId}", encodeURIComponent(accountId));
  const separator = path.startsWith("/") ? "" : "/";
  const suffix = query ? `?${query.toString()}` : "";
  return `${env.AMEX_API_BASE_URL.replace(/\/+$/, "")}${separator}${path}${suffix}`;
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
    const cardHolderName = amexString(item.cardHolderName, item.cardMemberName, item.employeeName);
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
      ...(cardHolderName ? { cardHolderName } : {})
    };
  });
}

async function fetchAmexActivity(env: Env): Promise<{ accounts: AccountBalance[]; transactions: Transaction[] }> {
  const accountConfigs = parseAmexAccountConfigs(env.AMEX_ACCOUNT_IDS);
  const accessToken = await fetchAmexAccessToken(env);
  if (
    !accessToken ||
    !env.AMEX_API_BASE_URL ||
    !env.AMEX_ACCOUNT_PATH_TEMPLATE ||
    !env.AMEX_TRANSACTIONS_PATH_TEMPLATE ||
    accountConfigs.length === 0
  ) {
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
        fetchJson<unknown>(amexEndpoint(env, env.AMEX_ACCOUNT_PATH_TEMPLATE!, config.id), { headers }),
        fetchJson<unknown>(amexEndpoint(env, env.AMEX_TRANSACTIONS_PATH_TEMPLATE!, config.id, transactionParams), { headers })
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

function mergeLiveAccounts(...accountGroups: AccountBalance[][]): AccountBalance[] {
  return accountGroups.flat();
}

function findPersistedTransaction(state: PersistedState, transactionId: string): Transaction | undefined {
  return state.wiseStatementTransactions.find((transaction) => transaction.id === transactionId);
}

function updatePersistedTransaction(state: PersistedState, updated: Transaction): boolean {
  let stored = false;
  state.wiseStatementTransactions = state.wiseStatementTransactions.map((transaction) => {
    if (transaction.id !== updated.id) return transaction;
    stored = true;
    return { ...transaction, ...updated };
  });
  return stored;
}

async function fetchTransactionForUpdate(env: Env, transactionId: string, state?: PersistedState): Promise<Transaction | undefined> {
  if (state) {
    const persisted = findPersistedTransaction(state, transactionId);
    if (persisted) return persisted;
  }

  const [wise, revolut, slash, amex] = await Promise.all([
    fetchWiseActivity(env).catch((error: unknown) => emptyWiseActivity([wiseStatementIssue(error)])),
    fetchRevolutActivity(env).catch(() => ({ accounts: [], transactions: [] })),
    fetchSlashActivity(env).catch(() => ({ accounts: [], transactions: [] })),
    fetchAmexActivity(env).catch(() => ({ accounts: [], transactions: [] }))
  ]);
  return [...wise.transactions, ...revolut.transactions, ...slash.transactions, ...amex.transactions].find(
    (transaction) => transaction.id === transactionId
  );
}

async function fetchTransactionForMatch(env: Env, transactionId: string, state: PersistedState): Promise<Transaction | undefined> {
  return fetchTransactionForUpdate(env, transactionId, state);
}

function meritTimestamp(): string {
  return new Date().toISOString().replace(/\D/g, "").slice(0, 14);
}

function meritDate(value: string): string {
  return value.replace(/\D/g, "").slice(0, 8);
}

function meritIsoDate(value: unknown, fallback: string): string {
  const compact = typeof value === "string" || typeof value === "number" ? String(value).replace(/\D/g, "").slice(0, 8) : "";
  return compact.length === 8 ? `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}` : fallback;
}

function meritItemCode(env: Env, tax: MeritTax, itemCode?: string): string {
  const prefix = (itemCode || env.MERIT_DEFAULT_ITEM_CODE || "SERVICES").replace(/[^A-Za-z0-9]/g, "").slice(0, 8) || "SERVICES";
  const taxCode = tax.code.replace(/[^A-Za-z0-9]/g, "").slice(0, 11) || String(tax.taxPct).replace(/\D/g, "");
  return `${prefix}-${taxCode}`.slice(0, 20);
}

function meritCountryCode(providerCountry: string | undefined, configuredDefault: string | undefined): string {
  for (const candidate of [providerCountry, configuredDefault]) {
    const normalized = candidate?.trim().toUpperCase();
    if (normalized && /^[A-Z]{2}$/.test(normalized)) return normalized;
  }
  return "CA";
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
      InvoiceDate?: string;
      DocumentDate?: string;
      DocDate?: string;
      CurrencyCode?: string;
      TotalSum?: number;
      TotalAmount?: number;
      Paid?: boolean;
    }>
  >(env, env.MERIT_GET_INVOICES_PATH || "/v1/getinvoices", {
    PeriodStart: meritDate(periodStart.toISOString()),
    PeriodEnd: meritDate(periodEnd.toISOString()),
    UnPaid: false
  });

  const fetchedAt = new Date().toISOString();
  return response.flatMap((invoice) => {
    const externalId = invoice.SIHId ?? invoice.InvoiceNo;
    if (!externalId) return [];
    const issueDate = meritIsoDate(invoice.DocumentDate ?? invoice.InvoiceDate ?? invoice.DocDate, fetchedAt.slice(0, 10));
    return [{
    id: `merit-${externalId}`,
    documentType: "sales_invoice" as const,
    origin: "merit" as const,
    customerName: invoice.CustomerName ?? "Merit invoice",
    amount: invoice.TotalSum ?? invoice.TotalAmount ?? 0,
    currency: invoice.CurrencyCode ?? "USD",
    status: "open" as const,
    meritStatus: invoice.Paid ? ("paid" as const) : ("open" as const),
    meritDeliveryStatus: "saved" as const,
    invoiceNumber: invoice.InvoiceNo ?? externalId,
    issueDate,
    dueDate: meritIsoDate(invoice.DueDate, fetchedAt.slice(0, 10)),
    source: "merit" as const,
    externalId,
    description: `Merit invoice ${invoice.InvoiceNo ?? invoice.SIHId ?? ""}`.trim(),
    revenueRunIds: [],
    createdAt: `${issueDate}T00:00:00.000Z`,
    updatedAt: `${issueDate}T00:00:00.000Z`
  }];
  });
}

async function fetchMeritTaxes(env: Env): Promise<MeritTax[]> {
  if (!env.MERIT_API_ID || !env.MERIT_API_KEY) return [];

  const response = await fetchMeritJson<
    Array<{
      Id?: string;
      Code?: string;
      Name?: string;
      NameEN?: string;
      TaxPct?: number;
    }>
  >(env, "/v1/gettaxes", {});

  return response
    .filter((tax) => tax.Id && Number.isFinite(Number(tax.TaxPct)))
    .map((tax) => ({
      id: tax.Id!,
      code: tax.Code?.trim() || "VAT",
      name: tax.NameEN?.trim() || tax.Name?.trim() || tax.Code?.trim() || "Merit tax",
      taxPct: Number(tax.TaxPct)
    }))
    .sort((left, right) => left.taxPct - right.taxPct || left.name.localeCompare(right.name));
}

export async function createMeritInvoice(
  env: Env,
  payload: CreateInvoicePayload,
  tax: MeritTax,
  itemCode?: string,
  provider?: Provider,
  requestedInvoiceNumber?: string
): Promise<Invoice> {
  assertMeritWriteConfiguration(env);
  const taxAmount = Number(((payload.amount * tax.taxPct) / 100).toFixed(2));

  const issueDate = payload.issueDate ?? new Date().toISOString().slice(0, 10);
  const invoiceNo = requestedInvoiceNumber || `FD-${Date.now()}`;
  const providerEmail = provider?.email?.trim();
  const response = await fetchMeritJson<{ Id?: string; InvoiceId?: string; SIHId?: string; InvoiceNo?: string }>(
    env,
    env.MERIT_CREATE_INVOICE_PATH || "/v2/sendinvoice",
    {
      Customer: provider?.meritCustomerId
        ? { Id: provider.meritCustomerId }
        : {
            Name: provider?.legalName?.trim() || payload.customerName,
            NotTDCustomer: true,
            CountryCode: meritCountryCode(provider?.country, env.MERIT_DEFAULT_COUNTRY_CODE),
            ...(providerEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(providerEmail) ? { Email: providerEmail } : {}),
            ...(provider?.address?.trim() ? { Address: provider.address.trim() } : {})
          },
      AccountingDoc: 1,
      DocDate: meritDate(issueDate),
      DueDate: meritDate(payload.dueDate),
      InvoiceNo: invoiceNo,
      CurrencyCode: payload.currency,
      InvoiceRow: [
        {
          Item: {
            Code: meritItemCode(env, tax, itemCode),
            Description: payload.description.slice(0, 150),
            Type: 2
          },
          Quantity: 1,
          Price: payload.amount,
          TaxId: tax.id
        }
      ],
      TaxAmount: [
        {
          TaxId: tax.id,
          Amount: taxAmount
        }
      ],
      TotalAmount: payload.amount,
      Hcomment: "Created from finance dashboard. Paid status is managed locally in finance dashboard and is not written back to Merit."
    }
  );

  const createdAt = new Date().toISOString();
  const externalId = response.SIHId ?? response.InvoiceId ?? response.Id;
  if (!externalId) {
    throw new ApiError(502, "Merit accepted the invoice request without returning a stable invoice ID; review Merit before retrying");
  }
  return {
    id: `merit-${externalId}`,
    providerId: payload.providerId,
    documentType: payload.documentType,
    origin: "manual",
    customerName: payload.customerName,
    amount: payload.amount,
    currency: payload.currency,
    status: "open",
    meritStatus: "open",
    meritDeliveryStatus: "saved",
    invoiceNumber: response.InvoiceNo ?? invoiceNo,
    issueDate,
    dueDate: payload.dueDate,
    source: "merit",
    externalId,
    description: payload.description,
    transactionId: payload.transactionId,
    revenueRunIds: [],
    periodStart: payload.periodStart,
    periodEnd: payload.periodEnd,
    taxId: tax.id,
    createdAt,
    updatedAt: createdAt
  };
}

export async function deliverMeritInvoice(env: Env, externalId: string): Promise<void> {
  assertMeritWriteConfiguration(env);
  await fetchMeritJson<Record<string, unknown>>(
    env,
    env.MERIT_DELIVER_INVOICE_PATH || defaultMeritDeliverInvoicePath,
    { Id: externalId, DelivNote: false }
  );
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
  params.append("filters[Affiliate.id][conditional]", "EQUAL_TO");
  params.append("filters[Affiliate.id][values][0]", partner.affiliateId);
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
  const serviceToken = getConvexServiceToken(env);
  const stored = await (async () => {
    try {
      return await convex.query(api.dashboard.getState, { serviceToken });
    } catch (error) {
      throw new ApiError(503, "Dashboard storage is temporarily unavailable", { cause: error });
    }
  })();

  return {
    revision: stored?.updatedAt ?? null,
    providers: mergeProviderDirectory(stored?.providers ?? []),
    invoices: stored?.invoices ?? [],
    teams: mergeTeamDirectory(stored?.teams ?? []),
    transactionCategoryRules: stored?.transactionCategoryRules ?? [],
    revenuePartners: mergeRevenuePartnerDirectory(stored?.revenuePartners ?? []),
    transactionTeamAssignments: normalizedTeamAssignments(stored?.transactionTeamAssignments),
    wiseCardHolderTeamAssignments: mergeWiseCardHolderTeamAssignments(stored?.wiseCardHolderTeamAssignments ?? []),
    wiseStatementTransactions: stored?.wiseStatementTransactions ?? [],
    wiseStatementImports: stored?.wiseStatementImports ?? [],
    revenueRuns: stored?.revenueRuns ?? [],
    revenueAccruals: stored?.revenueAccruals ?? [],
    paymentAllocations: stored?.paymentAllocations ?? [],
    holdings: stored?.holdings ?? [],
    fxRates: stored?.fxRates ?? [],
    fxTrackedAssets: stored?.fxTrackedAssets ?? [],
    automationRuns: stored?.automationRuns ?? [],
    profitDistributionAdjustments: stored?.profitDistributionAdjustments ?? [],
    aiSettings: stored?.aiSettings ?? { ...defaultAiSettings }
  };
}

async function savePersisted(env: Env, state: PersistedState): Promise<void> {
  const convex = getConvexClient(env);
  const serviceToken = getConvexServiceToken(env);
  const { revision, ...dashboardState } = state;
  try {
    const result = await convex.mutation(api.dashboard.saveState, {
      ...dashboardState,
      serviceToken,
      expectedUpdatedAt: revision
    });
    state.revision = result.updatedAt;
  } catch (error) {
    if (error instanceof ConvexError && isRecord(error.data) && error.data.code === "STATE_CONFLICT") {
      throw new ApiError(409, "Dashboard data changed while this update was saving. Retry the action.", { cause: error });
    }
    throw new ApiError(503, "Dashboard storage is temporarily unavailable", { cause: error });
  }
}

async function reserveIncomeAutomation(env: Env, run: AutomationRun): Promise<boolean> {
  const convex = getConvexClient(env);
  const serviceToken = getConvexServiceToken(env);
  try {
    const result = await convex.mutation(api.dashboard.reserveIncomeAutomation, {
      serviceToken,
      run,
      staleBefore: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    });
    return result.reserved;
  } catch (error) {
    throw new ApiError(503, "Dashboard storage is temporarily unavailable", { cause: error });
  }
}

async function reserveInvoiceCreation(env: Env, invoiceId: string, reservedAt: string): Promise<boolean> {
  const convex = getConvexClient(env);
  const serviceToken = getConvexServiceToken(env);
  try {
    const result = await convex.mutation(api.dashboard.reserveInvoiceCreation, {
      serviceToken,
      invoiceId,
      reservedAt
    });
    return result.reserved;
  } catch (error) {
    throw new ApiError(503, "Dashboard storage is temporarily unavailable", { cause: error });
  }
}

async function finalizeInvoiceCreation(env: Env, invoice: Invoice): Promise<void> {
  const convex = getConvexClient(env);
  const serviceToken = getConvexServiceToken(env);
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await convex.mutation(api.dashboard.finalizeInvoiceCreation, { serviceToken, invoice });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw new ApiError(503, "Dashboard storage is temporarily unavailable", { cause: lastError });
}

function runtimeAiSettings(env: Env, settings?: PersistedAiSettings): StoredAiSettings {
  return {
    ...(settings ?? defaultAiSettings),
    openRouterApiKey: env.OPENROUTER_API_KEY?.trim() || undefined
  };
}

function requiredRevenueEnvNames(revenuePartners: RevenuePartner[]): string[] {
  const names = new Set<string>();
  for (const partner of revenuePartners.filter((item) => item.enabled)) {
    names.add(partner.networkIdEnv);
    names.add(partner.apiKeyEnv);
  }
  return [...names].filter(Boolean).sort();
}

function integrationStatus(
  env: Env,
  wiseActivity?: WiseActivityResult,
  revenuePartners: RevenuePartner[] = [],
  meritIssue?: string,
  bankIssues: Partial<Record<"revolut" | "slash" | "amex", string>> = {},
  fxRates: FxRate[] = [],
  missingFxAssets: string[] = [],
  staleFxAssets: string[] = []
): IntegrationStatus[] {
  const wiseNeeds = ["WISE_API_TOKEN", "WISE_PROFILE_ID"].filter((name) => !env[name as keyof Env]);
  if (!env.WISE_BALANCE_IDS) wiseNeeds.push("WISE_BALANCE_IDS");
  const wiseIssue = wiseNeeds.length === 0 ? summarizeWiseStatementIssues(wiseActivity?.statementIssues ?? []) : undefined;

  const revolutNeeds = ["REVOLUT_REFRESH_TOKEN", "REVOLUT_CLIENT_ASSERTION_JWT"].filter((name) => !env[name as keyof Env]);
  const slashNeeds = ["SLASH_API_KEY"].filter((name) => !env[name as keyof Env]);
  const amexNeeds = [
    "AMEX_TOKEN_URL",
    "AMEX_API_BASE_URL",
    "AMEX_CLIENT_ID",
    "AMEX_CLIENT_SECRET",
    "AMEX_REFRESH_TOKEN",
    "AMEX_ACCOUNT_IDS",
    "AMEX_ACCOUNT_PATH_TEMPLATE",
    "AMEX_TRANSACTIONS_PATH_TEMPLATE"
  ].filter((name) => !env[name as keyof Env]);

  const meritNeeds = ["MERIT_API_ID", "MERIT_API_KEY"].filter((name) => !env[name as keyof Env]);
  const meritWriteEnabled = meritWritesEnabled(env) && meritNeeds.length === 0;
  const revenueEnvNames = requiredRevenueEnvNames(revenuePartners);
  const tuneNeeds = revenueEnvNames.filter((name) => !envString(env, name));
  const enabledRevenuePartnerCount = revenuePartners.filter((partner) => partner.enabled).length;

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
      mode: revolutNeeds.length === 0 && !bankIssues.revolut ? "live" : "partial",
      message:
        bankIssues.revolut ?? (revolutNeeds.length === 0
          ? "Ready to mint a Business API access token and pull accounts plus transaction activity."
          : "Revolut rows stay empty until the refresh token and client assertion JWT are configured."),
      needs: revolutNeeds,
      issue: bankIssues.revolut
    },
    {
      id: "slash" as DataSource,
      label: "Slash",
      configured: slashNeeds.length === 0,
      mode: slashNeeds.length === 0 && !bankIssues.slash ? "live" : "partial",
      message:
        bankIssues.slash ?? (slashNeeds.length === 0
          ? "Slash API key is present."
          : "Slash rows stay empty until API access is configured."),
      needs: slashNeeds,
      issue: bankIssues.slash
    },
    {
      id: "amex" as DataSource,
      label: "Amex",
      configured: amexNeeds.length === 0,
      mode: amexNeeds.length === 0 && !bankIssues.amex ? "live" : "partial",
      message:
        bankIssues.amex ?? (amexNeeds.length === 0
          ? "Ready to mint an Amex access token and pull card balances plus transaction activity."
          : "Amex rows stay empty until OAuth credentials, account IDs, and approved API paths are configured."),
      needs: amexNeeds,
      issue: bankIssues.amex
    },
    {
      id: "merit" as DataSource,
      label: "Merit",
      configured: meritNeeds.length === 0,
      mode: meritNeeds.length === 0 && !meritIssue ? "live" : "partial",
      message:
        meritNeeds.length === 0
          ? meritIssue ??
            (meritWriteEnabled
              ? "Merit invoice reads are connected. Explicitly confirmed invoice sending is enabled."
              : "Merit invoice reads are connected. Invoice sending is disabled by the deployment safety switch.")
          : "Add the Merit API ID and API key to enable read-only invoice sync.",
      needs: meritNeeds,
      issue: meritNeeds.length === 0 ? meritIssue : undefined,
      writeEnabled: meritWriteEnabled
    },
    {
      id: "tune" as DataSource,
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
    },
    {
      id: "coinbase",
      label: "Coinbase rates",
      configured: true,
      mode: missingFxAssets.length === 0 && staleFxAssets.length === 0 ? "live" : "partial",
      message:
        missingFxAssets.length > 0
          ? `USD totals exclude assets without a Coinbase quote: ${missingFxAssets.join(", ")}.`
          : staleFxAssets.length > 0
          ? `Using last-known approximate rates for: ${staleFxAssets.join(", ")}.`
          : fxRates.length > 0
          ? `Approximate USD rates were refreshed at ${fxRates.reduce((oldest, rate) => rate.asOf < oldest ? rate.asOf : oldest, fxRates[0].asOf)}.`
          : "All liquid balances are already in USD, so no conversion quote is required.",
      needs: []
    }
  ];
}

function applyTeamAssignments(
  rows: Transaction[],
  assignments: TransactionTeamAssignment[],
  cardHolderAssignments: WiseCardHolderTeamAssignment[]
): Transaction[] {
  const teamByTransaction = new Map(assignments.map((assignment) => [assignment.transactionId, assignment.teamId]));
  const teamByCardHolder = new Map(
    cardHolderAssignments.map((assignment) => [normalizeCardHolderName(assignment.cardHolderName), assignment.teamId])
  );
  return rows.map((transaction) => {
    const teamId =
      teamByTransaction.get(transaction.id) ??
      (transaction.cardHolderName ? teamByCardHolder.get(normalizeCardHolderName(transaction.cardHolderName)) : undefined) ??
      transaction.teamId;
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
      category: transactionBusinessCategory(transaction.category || "Wise"),
      ...(transaction.cardHolderName ? { cardHolderName: transaction.cardHolderName.trim() } : {})
    }));
}

async function importWiseStatement(env: Env, payload: ImportWiseStatementPayload): Promise<ImportWiseStatementResult> {
  if (!payload.balanceId || !payload.currency || !payload.periodStart || !payload.periodEnd || !payload.fileName) {
    throw new Error("balanceId, currency, periodStart, periodEnd, and fileName are required");
  }
  let state = await loadPersisted(env);
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
  await autoCategorizeState(env, state, {
    transactionIds: importedTransactions.map((transaction) => transaction.id),
    useAi: true
  });
  const reconciliation = reconcileExactInvoicePayments({
    invoices: state.invoices,
    transactions: state.wiseStatementTransactions,
    allocations: state.paymentAllocations,
    providers: state.providers
  });
  state.invoices = reconciliation.invoices;
  state.paymentAllocations = reconciliation.allocations;
  state.wiseStatementTransactions = reconciliation.transactions;
  await savePersisted(env, state);
  return {
    dashboard: await getSnapshot(env),
    summary
  };
}

async function getSnapshot(env: Env, options: { refreshFxRates?: boolean } = {}): Promise<DashboardSnapshot> {
  const state = await loadPersisted(env);
  const bankIssues: Partial<Record<"revolut" | "slash" | "amex", string>> = {};
  const bankIssue = (label: string, error: unknown): string => {
    const message = error instanceof Error ? error.message : String(error);
    return `${label} balance sync failed: ${message.slice(0, 240)}`;
  };
  const [wise, revolut, slash, amex, meritResults] = await Promise.all([
    fetchWiseActivity(env).catch((error: unknown) => emptyWiseActivity([wiseStatementIssue(error)])),
    fetchRevolutActivity(env).catch((error: unknown) => {
      bankIssues.revolut = bankIssue("Revolut", error);
      return { accounts: [], transactions: [] };
    }),
    fetchSlashActivity(env).catch((error: unknown) => {
      bankIssues.slash = bankIssue("Slash", error);
      return { accounts: [], transactions: [] };
    }),
    fetchAmexActivity(env).catch((error: unknown) => {
      bankIssues.amex = bankIssue("Amex", error);
      return { accounts: [], transactions: [] };
    }),
    Promise.allSettled([fetchMeritInvoices(env), fetchMeritTaxes(env)])
  ]);
  const [meritInvoicesResult, meritTaxesResult] = meritResults;
  const liveMeritInvoices = meritInvoicesResult.status === "fulfilled" ? meritInvoicesResult.value : [];
  const meritTaxes = meritTaxesResult.status === "fulfilled" ? meritTaxesResult.value : [];
  const meritIssue =
    meritInvoicesResult.status === "rejected"
      ? meritConnectionIssue(meritInvoicesResult.reason)
      : meritTaxesResult.status === "rejected"
        ? meritConnectionIssue(meritTaxesResult.reason)
        : undefined;
  const accounts = mergeLiveAccounts(wise.accounts, revolut.accounts, slash.accounts, amex.accounts);
  const trackedAssetsBefore = state.fxTrackedAssets.join("|");
  state.fxTrackedAssets = [...new Set([
    ...state.fxTrackedAssets,
    ...state.fxRates.map((rate) => rate.asset),
    ...accounts.filter(isLiquidAccountBalance).map((account) => account.currency),
    ...state.holdings.map((holding) => holding.asset)
  ].map((asset) => asset.trim().toUpperCase()).filter(Boolean))].sort();
  const fxAssetInventoryChanged = state.fxTrackedAssets.join("|") !== trackedAssetsBefore;
  let fxRatesRefreshed = false;
  if (options.refreshFxRates) {
    await updateCurrentFxRates(env, state, accounts);
    fxRatesRefreshed = true;
  }
  const invoicesBeforeReconciliation = mergeInvoices(liveMeritInvoices, state.invoices);
  const persistedTransactionsBeforeSync = state.wiseStatementTransactions;
  const rawTransactions = mergeWiseStatementTransactions(state.wiseStatementTransactions, [
    ...wise.transactions,
    ...revolut.transactions,
    ...slash.transactions,
    ...amex.transactions
  ]).sort((left, right) => right.date.localeCompare(left.date));
  const enrichedTransactions = enrichTransactions(
    applyTeamAssignments(
      rawTransactions.map((transaction) => {
        const invoice = invoicesBeforeReconciliation.find((item) => item.transactionId === transaction.id);
        return invoice
          ? { ...transaction, matchedInvoiceId: invoice.id, matchedProviderId: invoice.providerId ?? transaction.matchedProviderId }
          : transaction;
      }),
      state.transactionTeamAssignments,
      state.wiseCardHolderTeamAssignments
    ),
    state.providers,
    state.transactionCategoryRules
  );
  const reconciliation = reconcileExactInvoicePayments({
    invoices: invoicesBeforeReconciliation,
    transactions: enrichedTransactions,
    allocations: state.paymentAllocations,
    providers: state.providers
  });
  const bankStateChanged = JSON.stringify(rawTransactions) !== JSON.stringify(persistedTransactionsBeforeSync);
  const invoiceStateChanged = JSON.stringify(invoicesBeforeReconciliation) !== JSON.stringify(state.invoices);
  if (reconciliation.matched > 0 || bankStateChanged || invoiceStateChanged || fxRatesRefreshed || fxAssetInventoryChanged) {
    state.invoices = reconciliation.invoices;
    state.paymentAllocations = reconciliation.allocations;
    state.wiseStatementTransactions = reconciliation.transactions;
    await savePersisted(env, state);
  }
  const invoices = reconciliation.invoices;
  const transactions = reconciliation.transactions;
  const approximateUsdTotals = calculateApproximateUsdTotals(accounts, state.holdings, state.fxRates);

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
    revenueAccruals: state.revenueAccruals,
    revenueMetrics: calculateRevenueMetrics(state.revenuePartners, state.revenueRuns),
    aiSettings: publicAiSettings(runtimeAiSettings(env, state.aiSettings)),
    transactions,
    invoices,
    paymentAllocations: reconciliation.allocations,
    invoicePredictions: calculateInvoicePredictions(invoices, reconciliation.allocations),
    holdings: state.holdings,
    fxRates: state.fxRates,
    approximateUsdTotals,
    automationRuns: state.automationRuns,
    meritTaxes,
    transactionCategoryRules: state.transactionCategoryRules,
    wiseCardHolderTeamAssignments: state.wiseCardHolderTeamAssignments,
    wiseStatementImports: state.wiseStatementImports,
    integrationStatus: integrationStatus(
      env,
      wise,
      state.revenuePartners,
      meritIssue,
      bankIssues,
      state.fxRates,
      approximateUsdTotals.excludedAssets,
      approximateUsdTotals.staleAssets
    ),
    metrics: calculateMetrics(accounts, [], [], [], []),
    profitDistribution: calculateProfitDistribution(transactions, state.profitDistributionAdjustments),
    lastSync: new Date().toISOString()
  };
}

async function createProvider(env: Env, payload: CreateProviderPayload): Promise<Provider> {
  if (!payload.name?.trim()) {
    throw new Error("Company name is required");
  }
  const state = await loadPersisted(env);
  const provider: Provider = {
    id: `provider-${crypto.randomUUID()}`,
    name: payload.name.trim(),
    type: providerType(payload),
    tags: providerTags(payload),
    aliases: payload.aliases.map((alias) => alias.trim()).filter(Boolean),
    ...companyDetails(payload),
    source: "manual",
    createdAt: new Date().toISOString()
  };
  state.providers = mergeProviderDirectory([...state.providers, provider]);
  await savePersisted(env, state);
  return provider;
}

async function updateProvider(env: Env, providerId: string, payload: UpdateProviderPayload): Promise<Provider> {
  if (!payload.name?.trim()) {
    throw new Error("Company name is required");
  }
  const state = await loadPersisted(env);
  let updated: Provider | undefined;
  state.providers = state.providers.map((provider) => {
    if (provider.id !== providerId) return provider;
    updated = {
      ...provider,
      name: payload.name.trim(),
      type: providerType(payload),
      tags: providerTags(payload),
      aliases: payload.aliases.map((alias) => alias.trim()).filter(Boolean),
      ...companyDetails(payload)
    };
    return updated;
  });
  if (!updated) throw new Error("Provider not found");
  state.providers = mergeProviderDirectory(state.providers);
  await savePersisted(env, state);
  return updated;
}

async function deleteProvider(env: Env, providerId: string): Promise<Provider> {
  const state = await loadPersisted(env);
  const deletion = deleteProviderReferences(
    {
      providers: state.providers,
      invoices: state.invoices,
      revenuePartners: state.revenuePartners,
      revenueRuns: state.revenueRuns,
      transactions: state.wiseStatementTransactions,
      wiseStatementTransactions: state.wiseStatementTransactions
    },
    providerId
  );
  if (!deletion) throw new ApiError(404, "Company not found");

  state.providers = deletion.providers;
  state.invoices = deletion.invoices;
  state.revenuePartners = deletion.revenuePartners;
  state.revenueRuns = deletion.revenueRuns;
  state.wiseStatementTransactions = deletion.wiseStatementTransactions;
  await savePersisted(env, state);
  return deletion.deletedProvider;
}

async function updateRevenuePartner(env: Env, partnerId: string, payload: UpdateRevenuePartnerPayload): Promise<RevenuePartner> {
  if (
    !payload.name?.trim() ||
    !payload.providerId?.trim() ||
    !payload.revenueCategory?.trim() ||
    !payload.affiliateId?.trim() ||
    !payload.currency?.trim() ||
    !payload.timezone?.trim() ||
    !payload.networkTimezone?.trim() ||
    !isEnvironmentVariableName(payload.networkIdEnv) ||
    !isEnvironmentVariableName(payload.apiKeyEnv) ||
    (Boolean(payload.apiBaseUrlEnv?.trim()) && !isEnvironmentVariableName(payload.apiBaseUrlEnv)) ||
    !isValidTimezone(payload.timezone) ||
    !isValidTimezone(payload.networkTimezone) ||
    !isValidTimezone(payload.billingTimezone) ||
    !Number.isFinite(payload.invoiceDueDays) ||
    payload.invoiceDueDays < 0 ||
    (payload.billingCadence !== "weekly" && payload.billingCadence !== "monthly")
  ) {
    throw new Error("Revenue rule fields are invalid; API environment names must be uppercase and timezones must be valid IANA names");
  }
  const state = await loadPersisted(env);
  const selectedProvider = state.providers.find((provider) => provider.id === payload.providerId);
  if (!selectedProvider || selectedProvider.type !== "client") throw new Error("Revenue rules require a client company");
  if (payload.teamId && !state.teams.some((team) => team.id === payload.teamId)) {
    throw new Error("Revenue partner team not found");
  }
  const revenueCategory = transactionBusinessCategory(payload.revenueCategory);
  if (!isTransactionCategoryForDirection(revenueCategory, "in")) {
    throw new Error(`Category "${revenueCategory}" is not valid for money in`);
  }
  let updated: RevenuePartner | undefined;
  state.revenuePartners = state.revenuePartners.map((partner) => {
    if (partner.id !== partnerId) return partner;
    const nextPartner: RevenuePartner = {
      ...partner,
      name: payload.name.trim(),
      providerId: payload.providerId,
      revenueCategory,
      affiliateId: payload.affiliateId.trim(),
      externalId: payload.externalId?.trim() || undefined,
      currency: payload.currency.trim().toUpperCase(),
      timezone: payload.timezone.trim(),
      networkTimezone: payload.networkTimezone.trim(),
      networkIdEnv: payload.networkIdEnv.trim(),
      apiKeyEnv: payload.apiKeyEnv.trim(),
      apiBaseUrlEnv: payload.apiBaseUrlEnv?.trim() || undefined,
      meritCustomerName: payload.meritCustomerName?.trim() || undefined,
      invoiceDueDays: payload.invoiceDueDays,
      billingCadence: payload.billingCadence,
      billingTimezone: payload.billingTimezone.trim(),
      autoDraft: payload.autoDraft,
      defaultMeritTaxId: payload.defaultMeritTaxId?.trim() || undefined,
      defaultMeritItemCode: payload.defaultMeritItemCode?.trim() || undefined,
      enabled: payload.enabled
    };
    if (payload.teamId) {
      nextPartner.teamId = payload.teamId;
    } else {
      delete nextPartner.teamId;
    }
    updated = nextPartner;
    return updated;
  });
  if (!updated) throw new Error("Revenue partner not found");
  state.revenuePartners = mergeRevenuePartnerDirectory(state.revenuePartners);
  await savePersisted(env, state);
  return updated;
}

async function createRevenuePartner(env: Env, payload: CreateRevenuePartnerPayload): Promise<RevenuePartner> {
  if (
    !payload.name?.trim() ||
    !payload.providerId?.trim() ||
    !payload.revenueCategory?.trim() ||
    !payload.affiliateId?.trim() ||
    !payload.currency?.trim() ||
    !payload.timezone?.trim() ||
    !payload.networkTimezone?.trim() ||
    !isEnvironmentVariableName(payload.networkIdEnv) ||
    !isEnvironmentVariableName(payload.apiKeyEnv) ||
    (Boolean(payload.apiBaseUrlEnv?.trim()) && !isEnvironmentVariableName(payload.apiBaseUrlEnv)) ||
    !isValidTimezone(payload.timezone) ||
    !isValidTimezone(payload.networkTimezone) ||
    !isValidTimezone(payload.billingTimezone) ||
    !Number.isFinite(payload.invoiceDueDays) ||
    payload.invoiceDueDays < 0 ||
    (payload.billingCadence !== "weekly" && payload.billingCadence !== "monthly")
  ) {
    throw new ApiError(400, "name, client, revenue category, affiliate ID, API environment names, cadence, and billing timezone are required");
  }
  const state = await loadPersisted(env);
  const provider = state.providers.find((item) => item.id === payload.providerId);
  if (!provider || provider.type !== "client") throw new ApiError(400, "Revenue rules require a client company");
  if (payload.teamId && !state.teams.some((team) => team.id === payload.teamId)) {
    throw new ApiError(400, "Revenue rule team not found");
  }
  const revenueCategory = transactionBusinessCategory(payload.revenueCategory);
  if (!isTransactionCategoryForDirection(revenueCategory, "in")) {
    throw new ApiError(400, `Category "${revenueCategory}" is not valid for money in`);
  }
  const partner: RevenuePartner = {
    id: `revenue-rule-${crypto.randomUUID()}`,
    providerId: provider.id,
    teamId: cleanOptional(payload.teamId),
    name: payload.name.trim(),
    revenueCategory,
    source: "tune",
    affiliateId: payload.affiliateId.trim(),
    externalId: cleanOptional(payload.externalId),
    currency: payload.currency.trim().toUpperCase() || "USD",
    timezone: payload.timezone.trim(),
    networkTimezone: payload.networkTimezone.trim(),
    networkIdEnv: payload.networkIdEnv.trim(),
    apiKeyEnv: payload.apiKeyEnv.trim(),
    apiBaseUrlEnv: cleanOptional(payload.apiBaseUrlEnv),
    meritCustomerName: cleanOptional(payload.meritCustomerName),
    invoiceDueDays: payload.invoiceDueDays,
    billingCadence: payload.billingCadence,
    billingTimezone: payload.billingTimezone.trim(),
    autoDraft: payload.autoDraft,
    defaultMeritTaxId: cleanOptional(payload.defaultMeritTaxId),
    defaultMeritItemCode: cleanOptional(payload.defaultMeritItemCode),
    enabled: payload.enabled,
    createdAt: new Date().toISOString()
  };
  state.revenuePartners = mergeRevenuePartnerDirectory([...state.revenuePartners, partner]);
  await savePersisted(env, state);
  return partner;
}

async function deleteRevenuePartner(env: Env, partnerId: string): Promise<RevenuePartner> {
  const state = await loadPersisted(env);
  const deleted = state.revenuePartners.find((partner) => partner.id === partnerId);
  if (!deleted) throw new ApiError(404, "Revenue partner not found");
  state.revenuePartners = state.revenuePartners.filter((partner) => partner.id !== partnerId);
  await savePersisted(env, state);
  return deleted;
}

async function saveAiSettings(env: Env, payload: SaveAiSettingsPayload): Promise<DashboardSnapshot> {
  const model = payload.model.trim();
  if (!model) throw new Error("OpenRouter model is required");

  const state = await loadPersisted(env);
  state.aiSettings = {
    provider: "openrouter",
    model,
    updatedAt: new Date().toISOString()
  };
  await savePersisted(env, state);
  return getSnapshot(env);
}

async function runAiPrompt(env: Env, payload: AiPromptPayload) {
  const state = await loadPersisted(env);
  return runOpenRouterPrompt(runtimeAiSettings(env, state.aiSettings), payload, env.PUBLIC_APP_URL);
}

function transactionCategoryNeedsReview(transaction: Transaction): boolean {
  return isReviewOnlyTransactionCategory(transaction.category);
}

function transactionNeedsCategorization(transaction: Transaction): boolean {
  const needsIncomingCompany = transaction.direction === "in" && !transaction.matchedProviderId;
  const hasLowIncomingCompanyConfidence =
    transaction.direction === "in" && Boolean(transaction.matchedProviderId) && (transaction.confidence ?? 0) < semanticMatchThreshold;
  return transactionCategoryNeedsReview(transaction) || needsIncomingCompany || hasLowIncomingCompanyConfidence;
}

async function autoCategorizeState(
  env: Env,
  state: PersistedState,
  payload: AutoCategorizeTransactionsPayload = {}
): Promise<Omit<AutoCategorizeTransactionsResult, "dashboard">> {
  state.providers = mergeProviderDirectory(state.providers);
  const targetIds = payload.transactionIds?.length ? new Set(payload.transactionIds) : undefined;
  let semanticMatches = 0;
  let categorizedOnly = 0;
  let reviewed = 0;

  state.wiseStatementTransactions = state.wiseStatementTransactions.map((transaction) => {
    if (targetIds && !targetIds.has(transaction.id)) return transaction;
    if (!transactionNeedsCategorization(transaction)) return transaction;
    reviewed += 1;
    const categorized = semanticCategorizeTransaction(transaction, state.providers, state.transactionCategoryRules);
    if (categorized.matchedProviderId && categorized.matchedProviderId !== transaction.matchedProviderId) {
      semanticMatches += 1;
    }
    if (!categorized.matchedProviderId && categorized.category !== transaction.category) {
      categorizedOnly += 1;
    }
    return categorized;
  });

  let aiMatches = 0;
  const activeAiSettings = runtimeAiSettings(env, state.aiSettings);
  const shouldUseAi = payload.useAi !== false && Boolean(activeAiSettings.openRouterApiKey);
  const remaining = state.wiseStatementTransactions.filter((transaction) => {
    if (targetIds && !targetIds.has(transaction.id)) return false;
    return transactionNeedsCategorization(transaction);
  });

  if (shouldUseAi && remaining.length > 0) {
    const aiResults = await runOpenRouterTransactionCategorization(
      activeAiSettings,
      remaining,
      state.providers,
      env.PUBLIC_APP_URL
    );
    for (const aiResult of aiResults) {
      if (aiResult.confidence < 0.72) continue;
      const transaction = findPersistedTransaction(state, aiResult.transactionId);
      if (!transaction) continue;
      const provider = aiResult.providerId ? state.providers.find((item) => item.id === aiResult.providerId) : undefined;
      const matchedProvider = provider && providerMatchesTransactionDirection(transaction, provider) ? provider : undefined;
      const updated: Transaction = {
        ...transaction,
        matchedProviderId: matchedProvider?.id ?? transaction.matchedProviderId,
        category: aiResult.category ?? transaction.category,
        confidence: aiResult.confidence,
        matchReason: `AI: ${aiResult.reason}`
      };
      if (!updatePersistedTransaction(state, updated)) continue;
      if (updated.matchedProviderId) {
        aiMatches += 1;
        state.providers = state.providers.map((item) =>
          item.id === updated.matchedProviderId ? learnAliases(item, bankAliasNames(transaction)) : item
        );
      } else {
        categorizedOnly += 1;
      }
    }
  }

  return { semanticMatches, aiMatches, categorizedOnly, reviewed };
}

async function autoCategorizeTransactions(
  env: Env,
  payload: AutoCategorizeTransactionsPayload = {}
): Promise<AutoCategorizeTransactionsResult> {
  const state = await loadPersisted(env);
  const summary = await autoCategorizeState(env, state, payload);
  await savePersisted(env, state);
  return {
    dashboard: await getSnapshot(env),
    ...summary
  };
}

async function matchTransaction(env: Env, payload: MatchTransactionPayload) {
  const state = await loadPersisted(env);
  const transaction = await fetchTransactionForMatch(env, payload.transactionId, state);
  const provider = state.providers.find((item) => item.id === payload.providerId);
  if (!transaction || !provider) {
    throw new Error("Company or transaction not found");
  }
  if (!providerMatchesTransactionDirection(transaction, provider)) {
    throw new Error(`Money-${transaction.direction} transactions can only be matched to ${providerTypeForTransactionDirection(transaction.direction)}s`);
  }
  const matchedTransaction: Transaction = {
    ...transaction,
    matchedProviderId: payload.providerId,
    matchedInvoiceId: payload.invoiceId,
    confidence: 1,
    matchReason: "Approved company match"
  };
  if (payload.rememberAlias) {
    state.providers = state.providers.map((item) =>
      item.id === provider.id ? learnAliases(item, bankAliasNames(transaction)) : item
    );
  }
  updatePersistedTransaction(state, matchedTransaction);
  await savePersisted(env, state);
  return enrichTransactions(
    [
      {
        ...matchedTransaction,
        teamId: state.transactionTeamAssignments.find((assignment) => assignment.transactionId === transaction.id)?.teamId,
      }
    ],
    state.providers,
    state.transactionCategoryRules
  )[0];
}

async function updateTransactionCategory(env: Env, payload: UpdateTransactionCategoryPayload): Promise<Transaction> {
  const state = await loadPersisted(env);
  const transaction = await fetchTransactionForUpdate(env, payload.transactionId, state);
  if (!transaction) {
    throw new Error("Transaction not found");
  }

  const category = transactionBusinessCategory(payload.category);
  if (!isTransactionCategoryForDirection(category, transaction.direction)) {
    throw new Error(`Category "${category}" is not valid for money ${transaction.direction === "in" ? "in" : "out"}`);
  }
  const updated: Transaction = {
    ...transaction,
    category,
    matchReason: "Manual category"
  };
  updatePersistedTransaction(state, updated);

  if (payload.rememberAlias) {
    state.transactionCategoryRules = learnCategoryAliases(state.transactionCategoryRules, transaction, category);
  }

  await savePersisted(env, state);
  return enrichTransactions([updated], state.providers, state.transactionCategoryRules)[0];
}

async function saveProfitDistributionAdjustment(
  env: Env,
  payload: SaveProfitDistributionAdjustmentPayload
): Promise<DashboardSnapshot> {
  const state = await loadPersisted(env);
  const adjustment = profitDistributionAdjustmentFromPayload(payload, new Date().toISOString());
  state.profitDistributionAdjustments = state.profitDistributionAdjustments.filter((item) => item.id !== adjustment.id);
  if (shouldKeepProfitDistributionAdjustment(adjustment)) {
    state.profitDistributionAdjustments = [adjustment, ...state.profitDistributionAdjustments];
  }
  await savePersisted(env, state);
  return getSnapshot(env);
}

async function assignTransactionTeam(env: Env, payload: AssignTransactionTeamPayload): Promise<Transaction> {
  const state = await loadPersisted(env);
  const transaction = await fetchTransactionForUpdate(env, payload.transactionId, state);
  const teamId = payload.teamId ? canonicalTeamId(payload.teamId) : undefined;
  if (!transaction) {
    throw new Error("Transaction not found");
  }
  if (teamId && !state.teams.some((team) => team.id === teamId)) {
    throw new Error("Team not found");
  }

  state.transactionTeamAssignments = state.transactionTeamAssignments.filter(
    (assignment) => assignment.transactionId !== payload.transactionId
  );
  if (teamId) {
    state.transactionTeamAssignments = [
      { transactionId: payload.transactionId, teamId, updatedAt: new Date().toISOString() },
      ...state.transactionTeamAssignments
    ];
  }

  await savePersisted(env, state);
  return {
    ...transaction,
    teamId
  };
}

async function assignWiseCardHolderTeam(env: Env, payload: AssignWiseCardHolderTeamPayload): Promise<DashboardSnapshot> {
  const state = await loadPersisted(env);
  const cardHolderName = payload.cardHolderName.trim().replace(/\s+/g, " ");
  const teamId = canonicalTeamId(payload.teamId);
  if (!cardHolderName) {
    throw new Error("Card holder name is required");
  }
  if (!state.teams.some((team) => team.id === teamId)) {
    throw new Error("Team not found");
  }

  state.wiseCardHolderTeamAssignments = mergeWiseCardHolderTeamAssignments([
    ...state.wiseCardHolderTeamAssignments.filter(
      (assignment) => normalizeCardHolderName(assignment.cardHolderName) !== normalizeCardHolderName(cardHolderName)
    ),
    { cardHolderName, teamId, updatedAt: new Date().toISOString() }
  ]);

  await savePersisted(env, state);
  return getSnapshot(env);
}

async function createTeam(env: Env, payload: CreateTeamPayload): Promise<Team> {
  const name = canonicalTeamName(payload.name.trim());
  if (!name) {
    throw new Error("Team name is required");
  }

  const state = await loadPersisted(env);
  if (state.teams.some((team) => normalizeName(team.name) === normalizeName(name))) {
    throw new Error("Team already exists");
  }

  const team: Team = {
    id: `team-${crypto.randomUUID()}`,
    name,
    createdAt: new Date().toISOString()
  };
  state.teams = mergeTeamDirectory([...state.teams, team]);
  await savePersisted(env, state);
  return team;
}

async function createInvoice(env: Env, payload: CreateInvoicePayload): Promise<Invoice> {
  if (
    !payload.customerName?.trim() ||
    !Number.isFinite(payload.amount) ||
    payload.amount <= 0 ||
    !payload.currency?.trim() ||
    !payload.dueDate ||
    (payload.documentType !== "sales_invoice" && payload.documentType !== "supplier_bill")
  ) {
    throw new Error("customerName, amount, dueDate, and documentType are required");
  }
  const state = await loadPersisted(env);
  const selectedProvider = payload.providerId ? state.providers.find((provider) => provider.id === payload.providerId) : undefined;
  if (payload.providerId && !selectedProvider) {
    throw new Error("Company not found");
  }
  if (selectedProvider && selectedProvider.type !== providerTypeForInvoiceDocument(payload.documentType)) {
    throw new Error(
      `${payload.documentType === "sales_invoice" ? "Sales invoice" : "Supplier bill"} requires a ${providerTypeForInvoiceDocument(payload.documentType)}`
    );
  }
  const createdAt = new Date().toISOString();
  const issueDate = payload.issueDate || createdAt.slice(0, 10);
  const invoice: Invoice = {
    id: `local-${payload.documentType}-${crypto.randomUUID()}`,
    providerId: payload.providerId,
    documentType: payload.documentType,
    origin: "manual",
    customerName: payload.customerName.trim(),
    amount: payload.amount,
    currency: payload.currency.trim().toUpperCase(),
    status: "draft",
    meritDeliveryStatus: "not-sent",
    invoiceNumber: `FD-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    issueDate,
    dueDate: payload.dueDate,
    source: "manual",
    description: payload.description.trim(),
    transactionId: payload.transactionId,
    revenueRunIds: [],
    periodStart: cleanOptional(payload.periodStart),
    periodEnd: cleanOptional(payload.periodEnd),
    taxId: cleanOptional(payload.taxId),
    createdAt,
    updatedAt: createdAt
  };
  if (payload.transactionId && selectedProvider) {
    const transaction = await fetchTransactionForUpdate(env, payload.transactionId, state);
    if (transaction) {
      state.providers = state.providers.map((provider) =>
        provider.id === selectedProvider.id ? learnAliases(provider, bankAliasNames(transaction)) : provider
      );
      const provider = state.providers.find((item) => item.id === selectedProvider.id);
      if (provider) {
        updatePersistedTransaction(state, {
          ...transaction,
          matchedProviderId: selectedProvider.id,
          matchedInvoiceId: invoice.id,
          confidence: 1,
          matchReason: payload.documentType === "sales_invoice" ? "Sales invoice draft created" : "Supplier bill draft created"
        });
      }
    }
  }
  state.invoices = [invoice, ...state.invoices];
  await savePersisted(env, state);
  return invoice;
}

async function updateInvoice(env: Env, invoiceId: string, payload: UpdateInvoicePayload): Promise<Invoice> {
  if (
    !payload.customerName?.trim() ||
    !Number.isFinite(payload.amount) ||
    payload.amount <= 0 ||
    !payload.currency?.trim() ||
    !payload.issueDate ||
    !payload.dueDate
  ) {
    throw new ApiError(400, "customerName, positive amount, currency, issueDate, and dueDate are required");
  }
  const state = await loadPersisted(env);
  const invoice = state.invoices.find((item) => item.id === invoiceId);
  if (!invoice) throw new ApiError(404, "Invoice not found");
  if (invoice.status !== "draft" || invoice.externalId) {
    throw new ApiError(409, "Only local drafts that have not been saved to Merit can be edited");
  }
  const provider = payload.providerId ? state.providers.find((item) => item.id === payload.providerId) : undefined;
  if (payload.providerId && !provider) throw new ApiError(400, "Company not found");
  if (provider && provider.type !== providerTypeForInvoiceDocument(invoice.documentType)) {
    throw new ApiError(400, `${invoice.documentType === "sales_invoice" ? "Sales invoice" : "Supplier bill"} requires a ${providerTypeForInvoiceDocument(invoice.documentType)}`);
  }
  const { meritCreationReservedAt: _reservation, sendError: _sendError, ...editableInvoice } = invoice;
  const updated: Invoice = {
    ...editableInvoice,
    providerId: payload.providerId,
    customerName: payload.customerName.trim(),
    amount: payload.amount,
    currency: payload.currency.trim().toUpperCase(),
    issueDate: payload.issueDate,
    dueDate: payload.dueDate,
    description: payload.description.trim(),
    taxId: cleanOptional(payload.taxId),
    periodStart: cleanOptional(payload.periodStart),
    periodEnd: cleanOptional(payload.periodEnd),
    updatedAt: new Date().toISOString()
  };
  state.invoices = state.invoices.map((item) => item.id === invoiceId ? updated : item);
  await savePersisted(env, state);
  return updated;
}

async function syncRevenue(env: Env, payload: SyncRevenuePayload = {}): Promise<DashboardSnapshot> {
  const initialState = await loadPersisted(env);
  const selectedPartners = initialState.revenuePartners.filter(
    (partner) =>
      partner.enabled &&
      (!payload.partnerId || partner.id === payload.partnerId) &&
      (!payload.teamId || partner.teamId === payload.teamId) &&
      (!payload.partnerLevelOnly || !partner.teamId)
  );
  if (selectedPartners.length === 0) {
    throw new Error("No revenue partner found for this sync");
  }

  const nextRuns: RevenueRun[] = [];
  for (const partner of selectedPartners) {
    const period = resolveRevenuePeriod({
      periodPreset: payload.periodPreset,
      periodStart: payload.periodStart,
      periodEnd: payload.periodEnd,
      timezone:
        payload.timezone ||
        (payload.periodPreset === "this-week" ? partner.billingTimezone : partner.timezone) ||
        env.REVENUE_TIMEZONE ||
        "UTC"
    });

    try {
      const run: RevenueRun = {
        ...(await fetchTuneRevenue(env, partner, period)),
        ...(partner.teamId
          ? { teamName: initialState.teams.find((team) => team.id === partner.teamId)?.name ?? partner.teamId }
          : {})
      };
      nextRuns.push(run);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      nextRuns.push({
        id: `revenue-${partner.id}-${period.periodStart}-${period.periodEnd}-${Date.now()}`,
        partnerId: partner.id,
        partnerName: partner.name,
        providerId: partner.providerId,
        ...(partner.teamId
          ? {
              teamId: partner.teamId,
              teamName: initialState.teams.find((team) => team.id === partner.teamId)?.name ?? partner.teamId
            }
          : {}),
        revenueCategory: partner.revenueCategory,
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

  if (nextRuns.length > 0) {
    const latestState = await loadPersisted(env);
    const protectedRunIds = new Set(
      latestState.revenueRuns
        .filter((run) => run.status === "drafted" || run.status === "invoicing" || run.status === "invoiced")
        .map((run) => run.id)
    );
    const safeNextRuns = nextRuns.filter((run) => !protectedRunIds.has(run.id));
    const acceptedNextRuns: RevenueRun[] = [];
    for (const run of safeNextRuns) {
      const partner = latestState.revenuePartners.find((item) => item.id === run.partnerId);
      if (!partner || run.status === "failed") {
        acceptedNextRuns.push(run);
        continue;
      }
      if (isClosedBillingPeriod(partner, run)) {
        removeClosedRevenueAccrual(latestState, partner, run);
        acceptedNextRuns.push(run);
        continue;
      }
      const accrualPeriodEnd = openAccrualPeriodEnd(partner, run);
      if (!accrualPeriodEnd) {
        acceptedNextRuns.push(run);
        continue;
      }
      if (upsertRevenueAccrual(latestState, {
        id: `revenue-accrual-${partner.id}-${run.periodStart}-${accrualPeriodEnd}`,
        partnerId: partner.id,
        providerId: partner.providerId,
        partnerName: partner.name,
        billingCadence: partner.billingCadence,
        periodStart: run.periodStart,
        periodEnd: accrualPeriodEnd,
        accruedThrough: run.periodEnd,
        amount: run.revenue,
        currency: run.currency,
        status: "accruing",
        revenueRunId: run.id,
        updatedAt: run.createdAt
      })) {
        acceptedNextRuns.push(run);
      }
    }
    const nextRunIds = new Set(acceptedNextRuns.map((run) => run.id));
    latestState.revenueRuns = [...acceptedNextRuns, ...latestState.revenueRuns.filter((run) => !nextRunIds.has(run.id))].slice(0, 250);
    await savePersisted(env, latestState);
  }
  return getSnapshot(env);
}

async function draftRevenueRun(env: Env, runId: string): Promise<Invoice> {
  const state = await loadPersisted(env);
  const run = state.revenueRuns.find((item) => item.id === runId);
  if (!run) throw new ApiError(404, "Revenue run not found");
  if (run.status !== "pulled" || run.revenue <= 0) {
    throw new ApiError(409, "Only a positive pulled revenue period can be drafted");
  }
  const partner = state.revenuePartners.find((item) => item.id === run.partnerId);
  if (!partner) throw new ApiError(409, "Revenue rule no longer exists");
  if (!isClosedBillingPeriod(partner, run)) throw new ApiError(409, "Revenue period is not closed yet");
  const existing = state.invoices.find(
    (invoice) => invoice.billingRuleId === partner.id && invoice.periodStart === run.periodStart && invoice.periodEnd === run.periodEnd
  );
  if (existing) return existing;
  const draft = buildRevenueDraft({ ...partner, autoDraft: true }, run);
  state.invoices = [draft, ...state.invoices];
  upsertRevenueRun(state, { ...run, status: "drafted", invoiceId: draft.id });
  if (partner.billingCadence === "monthly") {
    upsertRevenueAccrual(state, {
      id: `revenue-accrual-${partner.id}-${run.periodStart}-${run.periodEnd}`,
      partnerId: partner.id,
      providerId: partner.providerId,
      partnerName: partner.name,
      billingCadence: "monthly",
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      accruedThrough: run.periodEnd,
      amount: run.revenue,
      currency: run.currency,
      status: "drafted",
      revenueRunId: run.id,
      invoiceId: draft.id,
      updatedAt: draft.updatedAt
    });
  } else {
    removeClosedRevenueAccrual(state, partner, run);
  }
  await savePersisted(env, state);
  return draft;
}

function replaceInvoice(state: PersistedState, updated: Invoice): void {
  state.invoices = state.invoices.map((invoice) => invoice.id === updated.id ? updated : invoice);
}

async function sendInvoices(env: Env, payload: SendInvoicesPayload): Promise<SendInvoicesResult> {
  if (payload.confirmation !== "SEND_TO_MERIT") {
    throw new ApiError(400, "Explicit SEND_TO_MERIT confirmation is required");
  }
  if (payload.mode !== "save" && payload.mode !== "deliver") throw new ApiError(400, "mode must be save or deliver");
  const invoiceIds = [...new Set(payload.invoiceIds?.filter((id) => typeof id === "string" && id.trim()))];
  if (invoiceIds.length === 0) throw new ApiError(400, "Select at least one invoice");
  assertMeritWriteConfiguration(env);

  let state = await loadPersisted(env);
  const outcomes: SendInvoicesResult["outcomes"] = [];
  let meritTaxes: MeritTax[] | undefined;

  for (const invoiceId of invoiceIds) {
    let current = state.invoices.find((invoice) => invoice.id === invoiceId);
    if (!current) {
      outcomes.push({ invoiceId, status: "failed", message: "Invoice not found" });
      continue;
    }
    if (current.documentType !== "sales_invoice") {
      outcomes.push({ invoiceId, status: "failed", message: "Only sales invoices can be sent to Merit" });
      continue;
    }
    if (current.status === "paid") {
      outcomes.push({ invoiceId, status: "failed", message: "Paid invoices cannot be sent" });
      continue;
    }

    if (!current.externalId) {
      const reservedAt = new Date().toISOString();
      if (!(await reserveInvoiceCreation(env, current.id, reservedAt))) {
        state = await loadPersisted(env);
        current = state.invoices.find((invoice) => invoice.id === invoiceId);
        if (!current?.externalId) {
          outcomes.push({
            invoiceId,
            status: "failed",
            message: current?.meritCreationReservedAt
              ? `Merit creation reserved at ${current.meritCreationReservedAt}. Check Merit, then edit the draft before retrying.`
              : current?.sendError
                ? `${current.sendError} Edit the draft after reviewing Merit before retrying.`
              : "Merit invoice creation is already in progress"
          });
          continue;
        }
      }
    }

    if (!current.externalId) {
      state = await loadPersisted(env);
      current = state.invoices.find((invoice) => invoice.id === invoiceId);
      if (!current) {
        outcomes.push({ invoiceId, status: "failed", message: "Invoice not found after reservation" });
        continue;
      }
      let createdInMerit: Invoice | undefined;
      try {
        if (!current.taxId) throw new ApiError(400, "Choose a Merit tax rate before sending this invoice");
        meritTaxes ??= await fetchMeritTaxes(env);
        const tax = meritTaxes.find((item) => item.id === current?.taxId);
        if (!tax) throw new ApiError(400, "The saved Merit tax rate is no longer available");
        const billingRule = current.billingRuleId
          ? state.revenuePartners.find((partner) => partner.id === current?.billingRuleId)
          : undefined;
        const provider = current.providerId ? state.providers.find((item) => item.id === current?.providerId) : undefined;
        const created = await createMeritInvoice(
          env,
          {
            transactionId: current.transactionId,
            providerId: current.providerId,
            documentType: current.documentType,
            customerName: current.customerName,
            amount: current.amount,
            currency: current.currency,
            issueDate: current.issueDate,
            dueDate: current.dueDate,
            description: current.description,
            taxId: current.taxId,
            periodStart: current.periodStart,
            periodEnd: current.periodEnd
          },
          tax,
          billingRule?.defaultMeritItemCode,
          provider,
          current.invoiceNumber
        );
        createdInMerit = created;
        const {
          sendError: _sendError,
          meritDeliveryError: _deliveryError,
          meritCreationReservedAt: _reservation,
          ...cleanCurrent
        } = current;
        current = {
          ...cleanCurrent,
          source: "merit",
          status: "open",
          meritStatus: "open",
          meritDeliveryStatus: "saved",
          externalId: created.externalId,
          invoiceNumber: created.invoiceNumber,
          updatedAt: created.updatedAt
        };
        await finalizeInvoiceCreation(env, current);
        state = await loadPersisted(env);
        current = state.invoices.find((invoice) => invoice.id === invoiceId) ?? current;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Merit invoice creation failed";
        if (createdInMerit?.externalId) {
          outcomes.push({
            invoiceId,
            status: "failed",
            message: `Merit created invoice ${createdInMerit.externalId}, but local persistence failed. Retry persistence before sending again.`
          });
          continue;
        }
        const { meritCreationReservedAt: _reservation, ...cleanCurrent } = current;
        const failed = { ...cleanCurrent, sendError: message, updatedAt: new Date().toISOString() };
        await finalizeInvoiceCreation(env, failed);
        state = await loadPersisted(env);
        outcomes.push({ invoiceId, status: "failed", message });
        continue;
      }
    }

    if (payload.mode === "save") {
      outcomes.push({ invoiceId, status: "saved" });
      continue;
    }
    if (current.meritDeliveryStatus === "delivered") {
      outcomes.push({ invoiceId, status: "delivered" });
      continue;
    }

    const externalId = current.externalId;
    if (!externalId) {
      outcomes.push({ invoiceId, status: "failed", message: "Merit invoice ID is missing after creation" });
      continue;
    }
    try {
      await deliverMeritInvoice(env, externalId);
      const { meritDeliveryError: _deliveryError, ...cleanCurrent } = current;
      const deliveredAt = new Date().toISOString();
      current = {
        ...cleanCurrent,
        meritDeliveryStatus: "delivered",
        sentAt: cleanCurrent.sentAt ?? deliveredAt,
        updatedAt: deliveredAt
      };
      replaceInvoice(state, current);
      await savePersisted(env, state);
      outcomes.push({ invoiceId, status: "delivered" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Merit invoice delivery failed";
      current = {
        ...current,
        meritDeliveryStatus: "delivery-failed",
        meritDeliveryError: message,
        updatedAt: new Date().toISOString()
      };
      replaceInvoice(state, current);
      await savePersisted(env, state);
      outcomes.push({ invoiceId, status: "failed", message });
    }
  }

  return { dashboard: await getSnapshot(env), outcomes };
}

const paymentSources = new Set(["wise", "revolut", "slash", "amex", "cash", "kraken", "trust", "other"]);

function isIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function recordInvoicePayment(
  env: Env,
  invoiceId: string,
  payload: RecordInvoicePaymentPayload
): Promise<DashboardSnapshot> {
  if (!Number.isFinite(payload.amount) || payload.amount <= 0 || !isIsoCalendarDate(payload.paidAt) || !paymentSources.has(payload.source)) {
    throw new ApiError(400, "positive amount, paidAt, and a valid payment source are required");
  }
  const state = await loadPersisted(env);
  const invoice = state.invoices.find((item) => item.id === invoiceId);
  if (!invoice) throw new ApiError(404, "Invoice not found");
  if (invoice.status === "draft") throw new ApiError(409, "Save the invoice to Merit before recording payment");
  const outstanding = invoiceOutstanding(invoice, state.paymentAllocations);
  if (payload.amount - outstanding > 0.01) throw new ApiError(409, `Payment exceeds the ${outstanding.toFixed(2)} ${invoice.currency} outstanding balance`);
  const transaction = payload.transactionId
    ? await fetchTransactionForUpdate(env, payload.transactionId, state)
    : undefined;
  if (payload.transactionId && !transaction) throw new ApiError(400, "Bank transaction not found");
  if (
    transaction &&
    (transaction.currency.toUpperCase() !== invoice.currency.toUpperCase() ||
      transaction.direction !== "in" ||
      (transaction.status !== "posted" && transaction.status !== "settled"))
  ) {
    throw new ApiError(400, "The selected transaction must be posted or settled, incoming, and use the invoice currency");
  }
  if (transaction && transaction.source !== payload.source) {
    throw new ApiError(400, "Payment source must match the selected bank transaction");
  }
  if (transaction) {
    const allocated = state.paymentAllocations
      .filter((allocation) => allocation.transactionId === transaction.id)
      .reduce((total, allocation) => total + allocation.amount, 0);
    if (allocated + payload.amount - transaction.amount > 0.01) {
      throw new ApiError(409, `Allocations exceed the transaction's ${transaction.amount.toFixed(2)} ${transaction.currency} amount`);
    }
  }

  const createdAt = new Date().toISOString();
  const allocation: PaymentAllocation = {
    id: `payment-${crypto.randomUUID()}`,
    invoiceId,
    transactionId: payload.transactionId,
    amount: Number(payload.amount.toFixed(2)),
    currency: invoice.currency,
    source: payload.source,
    accountName: cleanOptional(payload.accountName) ?? transaction?.accountName,
    reference: cleanOptional(payload.reference) ?? transaction?.description,
    note: cleanOptional(payload.note),
    mode: "manual",
    paidAt: transaction?.date ?? payload.paidAt,
    createdAt
  };
  state.paymentAllocations = [allocation, ...state.paymentAllocations];
  state.invoices = applyPaymentState(state.invoices, state.paymentAllocations).map((item) =>
    item.id === invoiceId ? { ...item, updatedAt: createdAt } : item
  );
  if (transaction) {
    if (invoice.providerId) {
      state.providers = state.providers.map((provider) =>
        provider.id === invoice.providerId ? learnAliases(provider, bankAliasNames(transaction)) : provider
      );
    }
    const linkedInvoiceIds = new Set(
      state.paymentAllocations
        .filter((item) => item.transactionId === transaction.id)
        .map((item) => item.invoiceId)
    );
    const { matchedInvoiceId: _matchedInvoiceId, ...transactionWithoutInvoice } = transaction;
    const updatedTransaction: Transaction = {
      ...transactionWithoutInvoice,
      ...(linkedInvoiceIds.size === 1 ? { matchedInvoiceId: invoiceId } : {}),
      matchedProviderId: invoice.providerId ?? transaction.matchedProviderId,
      confidence: 1,
      matchReason: linkedInvoiceIds.size === 1 ? "Manually allocated to invoice" : "Manually split across invoices"
    };
    if (!updatePersistedTransaction(state, updatedTransaction)) {
      state.wiseStatementTransactions = [updatedTransaction, ...state.wiseStatementTransactions];
    }
  }
  await savePersisted(env, state);
  return getSnapshot(env);
}

function normalizedHoldingPayload(payload: CreateHoldingPayload | UpdateHoldingPayload): Omit<Holding, "id" | "updatedAt"> {
  if (
    !payload.name?.trim() ||
    !payload.asset?.trim() ||
    !Number.isFinite(payload.balance) ||
    payload.balance < 0 ||
    (payload.kind !== "cash" && payload.kind !== "exchange" && payload.kind !== "wallet") ||
    (payload.assetType !== "fiat" && payload.assetType !== "crypto")
  ) {
    throw new ApiError(400, "name, kind, assetType, asset, and a non-negative finite balance are required");
  }
  return {
    name: payload.name.trim(),
    kind: payload.kind,
    assetType: payload.assetType,
    asset: payload.asset.trim().toUpperCase(),
    balance: payload.balance,
    notes: cleanOptional(payload.notes)
  };
}

async function createHolding(env: Env, payload: CreateHoldingPayload): Promise<DashboardSnapshot> {
  const state = await loadPersisted(env);
  const holding: Holding = {
    id: `holding-${crypto.randomUUID()}`,
    ...normalizedHoldingPayload(payload),
    updatedAt: new Date().toISOString()
  };
  state.holdings = [holding, ...state.holdings];
  await savePersisted(env, state);
  return getSnapshot(env, { refreshFxRates: true });
}

async function updateHolding(env: Env, holdingId: string, payload: UpdateHoldingPayload): Promise<DashboardSnapshot> {
  const state = await loadPersisted(env);
  if (!state.holdings.some((holding) => holding.id === holdingId)) throw new ApiError(404, "Holding not found");
  const updated: Holding = { id: holdingId, ...normalizedHoldingPayload(payload), updatedAt: new Date().toISOString() };
  state.holdings = state.holdings.map((holding) => holding.id === holdingId ? updated : holding);
  await savePersisted(env, state);
  return getSnapshot(env, { refreshFxRates: true });
}

async function deleteHolding(env: Env, holdingId: string): Promise<DashboardSnapshot> {
  const state = await loadPersisted(env);
  if (!state.holdings.some((holding) => holding.id === holdingId)) throw new ApiError(404, "Holding not found");
  state.holdings = state.holdings.filter((holding) => holding.id !== holdingId);
  await savePersisted(env, state);
  return getSnapshot(env);
}

export async function fetchCoinbaseUsdRates(env: Env, assets: Iterable<string>): Promise<FxRate[]> {
  const uniqueAssets = [...new Set(
    [...assets].map((asset) => asset.trim().toUpperCase()).filter((asset) => asset && asset !== "USD")
  )];
  if (uniqueAssets.length === 0) return [];

  const url = new URL(env.COINBASE_EXCHANGE_RATES_URL || defaultCoinbaseExchangeRatesUrl);
  url.searchParams.set("currency", "USD");
  const fetchedAt = new Date().toISOString();
  const payload = await fetchJson<{ data?: { currency?: string; rates?: Record<string, string> } }>(url.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8_000)
  });
  if (payload.data?.currency !== "USD" || !payload.data.rates) {
    throw new ApiError(502, "Coinbase did not return USD-based exchange rates");
  }

  const rates = uniqueAssets.flatMap((asset): FxRate[] => {
    const unitsPerUsd = Number(payload.data?.rates?.[asset]);
    if (!Number.isFinite(unitsPerUsd) || unitsPerUsd <= 0) return [];
    return [{
      asset,
      rateUsd: Number((1 / unitsPerUsd).toPrecision(15)),
      provider: "coinbase",
      asOf: fetchedAt,
      checkedAt: fetchedAt,
      stale: false
    }];
  });
  if (rates.length === 0) throw new ApiError(502, "Coinbase did not return any requested USD rates");
  return rates;
}

async function updateCurrentFxRates(
  env: Env,
  state: PersistedState,
  accounts: AccountBalance[] = []
): Promise<void> {
  const trackedAssets = new Set([
    ...state.fxTrackedAssets,
    ...state.fxRates.map((rate) => rate.asset),
    ...accounts.filter(isLiquidAccountBalance).map((account) => account.currency),
    ...state.holdings.map((holding) => holding.asset)
  ]);
  const checkedAt = new Date().toISOString();
  state.fxTrackedAssets = [...trackedAssets].map((asset) => asset.trim().toUpperCase()).filter(Boolean).sort();
  let refreshedRates: FxRate[] = [];
  try {
    refreshedRates = await fetchCoinbaseUsdRates(env, trackedAssets);
  } catch {
    // Conversion availability is independent from bank/invoice sync; last-known values stay visible as stale.
  }
  state.fxRates = mergeFxRates(state.fxRates, refreshedRates, trackedAssets, checkedAt);
}

async function refreshFxRates(env: Env): Promise<DashboardSnapshot> {
  return getSnapshot(env, { refreshFxRates: true });
}

async function refreshStoredFxRates(env: Env): Promise<void> {
  const state = await loadPersisted(env);
  await updateCurrentFxRates(env, state);
  await savePersisted(env, state);
}

function upsertRevenueRun(state: PersistedState, run: RevenueRun): void {
  const existing = state.revenueRuns.find((item) => item.id === run.id);
  if (existing && (existing.status === "drafted" || existing.status === "invoicing" || existing.status === "invoiced")) {
    return;
  }
  state.revenueRuns = [run, ...state.revenueRuns.filter((item) => item.id !== run.id)].slice(0, 250);
}

function upsertFailedRevenueRun(state: PersistedState, run: RevenueRun, failedAt: Date): void {
  const existing = state.revenueRuns.find((item) => item.id === run.id);
  upsertRevenueRun(
    state,
    existing && existing.status !== "failed" ? { ...run, id: `${run.id}-failed-${failedAt.getTime()}` } : run
  );
}

function upsertRevenueAccrual(state: PersistedState, accrual: RevenueAccrual): boolean {
  const previousAccrual = state.revenueAccruals.find((item) => item.id === accrual.id);
  if (
    previousAccrual &&
    !accrual.invoiceId &&
    (previousAccrual.invoiceId || previousAccrual.accruedThrough > accrual.accruedThrough)
  ) {
    return false;
  }
  state.revenueRuns = pruneSupersededAccrualRun(state.revenueRuns, previousAccrual, accrual.revenueRunId);
  state.revenueAccruals = [accrual, ...state.revenueAccruals.filter((item) => item.id !== accrual.id)].slice(0, 250);
  return true;
}

function removeClosedRevenueAccrual(state: PersistedState, partner: RevenuePartner, run: RevenueRun): void {
  const id = `revenue-accrual-${partner.id}-${run.periodStart}-${run.periodEnd}`;
  const previousAccrual = state.revenueAccruals.find((item) => item.id === id);
  state.revenueRuns = pruneSupersededAccrualRun(state.revenueRuns, previousAccrual, run.id);
  state.revenueAccruals = state.revenueAccruals.filter((item) => item.id !== id);
}

async function pullAutomatedRevenue(
  env: Env,
  state: PersistedState,
  partner: RevenuePartner,
  periodStart: string,
  periodEnd: string,
  scheduledAt: Date
): Promise<RevenueRun> {
  const period: RevenuePeriod = { preset: "custom", periodStart, periodEnd, timezone: partner.timezone };
  try {
    const run = await fetchTuneRevenue(env, partner, period);
    return partner.teamId
      ? { ...run, teamName: state.teams.find((team) => team.id === partner.teamId)?.name ?? partner.teamId }
      : run;
  } catch (error) {
    return {
      id: `revenue-${partner.id}-${periodStart}-${periodEnd}`,
      partnerId: partner.id,
      providerId: partner.providerId,
      partnerName: partner.name,
      revenueCategory: partner.revenueCategory,
      teamId: partner.teamId,
      teamName: partner.teamId ? state.teams.find((team) => team.id === partner.teamId)?.name ?? partner.teamId : undefined,
      source: "tune",
      periodStart,
      periodEnd,
      timezone: partner.timezone,
      revenue: 0,
      currency: partner.currency,
      status: "failed",
      error: error instanceof Error ? error.message : "Revenue pull failed",
      createdAt: scheduledAt.toISOString()
    };
  }
}

async function automateClosedRevenuePeriod(
  env: Env,
  state: PersistedState,
  partner: RevenuePartner,
  periodStart: string,
  periodEnd: string,
  scheduledAt: Date
): Promise<boolean> {
  let run = await pullAutomatedRevenue(env, state, partner, periodStart, periodEnd, scheduledAt);
  if (run.status === "failed") {
    upsertFailedRevenueRun(state, run, scheduledAt);
    return false;
  }
  removeClosedRevenueAccrual(state, partner, run);
  if (partner.billingCadence === "monthly") {
    state.revenueRuns = state.revenueRuns.filter(
      (item) => !(item.partnerId === partner.id && item.periodStart === periodStart && item.periodEnd !== periodEnd)
    );
  }
  const existingInvoice = state.invoices.find(
    (invoice) => invoice.billingRuleId === partner.id && invoice.periodStart === periodStart && invoice.periodEnd === periodEnd
  );
  if (existingInvoice) {
    run = { ...run, status: existingInvoice.externalId ? "invoiced" : "drafted", invoiceId: existingInvoice.id, externalInvoiceId: existingInvoice.externalId };
  } else if (partner.autoDraft && run.revenue > 0) {
    const draft = buildRevenueDraft(partner, run, scheduledAt);
    state.invoices = [draft, ...state.invoices.filter((invoice) => invoice.id !== draft.id)];
    run = { ...run, status: "drafted", invoiceId: draft.id };
  }
  upsertRevenueRun(state, run);
  if (partner.billingCadence === "monthly" && (run.status === "drafted" || run.status === "invoiced")) {
    upsertRevenueAccrual(state, {
      id: `revenue-accrual-${partner.id}-${periodStart}-${periodEnd}`,
      partnerId: partner.id,
      providerId: partner.providerId,
      partnerName: partner.name,
      billingCadence: "monthly",
      periodStart,
      periodEnd,
      accruedThrough: periodEnd,
      amount: run.revenue,
      currency: run.currency,
      status: "drafted",
      revenueRunId: run.id,
      invoiceId: run.invoiceId,
      updatedAt: scheduledAt.toISOString()
    });
  }
  return true;
}

async function automateCurrentRevenueAccrual(
  env: Env,
  state: PersistedState,
  partner: RevenuePartner,
  period: { periodStart: string; periodEnd: string; accruedThrough: string },
  scheduledAt: Date
): Promise<boolean> {
  const run = await pullAutomatedRevenue(
    env,
    state,
    partner,
    period.periodStart,
    period.accruedThrough,
    scheduledAt
  );
  if (run.status === "failed") {
    upsertFailedRevenueRun(state, run, scheduledAt);
    return false;
  }
  upsertRevenueRun(state, run);
  upsertRevenueAccrual(state, {
    id: `revenue-accrual-${partner.id}-${period.periodStart}-${period.periodEnd}`,
    partnerId: partner.id,
    providerId: partner.providerId,
    partnerName: partner.name,
    billingCadence: partner.billingCadence,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    accruedThrough: period.accruedThrough,
    amount: run.revenue,
    currency: run.currency,
    status: "accruing",
    revenueRunId: run.id,
    updatedAt: scheduledAt.toISOString()
  });
  return true;
}

function periodKey(periodStart: string, periodEnd: string): string {
  return `${periodStart}:${periodEnd}`;
}

export async function runIncomeAutomation(env: Env, scheduledAt: Date): Promise<"already-ran" | "completed"> {
  const completedWeek = previousCompletedWeek(scheduledAt);
  const automation: AutomationRun = {
    id: `weekly-income-${completedWeek.periodStart}-${completedWeek.periodEnd}`,
    type: "weekly-income",
    periodStart: completedWeek.periodStart,
    periodEnd: completedWeek.periodEnd,
    timezone: incomeAutomationTimezone,
    status: "running",
    startedAt: new Date().toISOString()
  };
  if (!(await reserveIncomeAutomation(env, automation))) return "already-ran";

  try {
    const state = await loadPersisted(env);
    const failures: string[] = [];
    for (const partner of state.revenuePartners.filter((item) => item.enabled)) {
      const closedPeriods = new Map<string, { periodStart: string; periodEnd: string }>();
      if (partner.billingCadence === "weekly") {
        const partnerWeek = previousCompletedWeek(scheduledAt, partner.billingTimezone);
        closedPeriods.set(periodKey(partnerWeek.periodStart, partnerWeek.periodEnd), partnerWeek);
      } else {
        const previousMonth = previousCalendarMonth(scheduledAt, partner.billingTimezone);
        const previousMonthHandled = state.revenueRuns.some(
          (run) =>
            run.partnerId === partner.id &&
            run.periodStart === previousMonth.periodStart &&
            run.periodEnd === previousMonth.periodEnd &&
            run.status !== "failed" &&
            (!partner.autoDraft || run.status === "drafted" || run.status === "invoiced")
        );
        if (!previousMonthHandled) closedPeriods.set(periodKey(previousMonth.periodStart, previousMonth.periodEnd), previousMonth);
      }
      for (const failed of state.revenueRuns.filter(
        (run) => run.partnerId === partner.id && run.status === "failed" && isClosedBillingPeriod(partner, run, scheduledAt)
      )) {
        closedPeriods.set(periodKey(failed.periodStart, failed.periodEnd), {
          periodStart: failed.periodStart,
          periodEnd: failed.periodEnd
        });
      }
      for (const period of closedPeriods.values()) {
        if (!(await automateClosedRevenuePeriod(env, state, partner, period.periodStart, period.periodEnd, scheduledAt))) {
          failures.push(`${partner.name} ${period.periodStart}–${period.periodEnd}`);
        }
      }

      if (partner.billingCadence === "weekly") {
        const accrualPeriod = currentWeekAccrualPeriod(scheduledAt, partner.billingTimezone);
        if (!(await automateCurrentRevenueAccrual(env, state, partner, accrualPeriod, scheduledAt))) {
          failures.push(`${partner.name} accrual through ${accrualPeriod.accruedThrough}`);
        }
      }

      if (partner.billingCadence === "monthly") {
        const accrualPeriod = currentMonthAccrualPeriod(scheduledAt, partner.billingTimezone);
        if (accrualPeriod) {
          if (!(await automateCurrentRevenueAccrual(env, state, partner, accrualPeriod, scheduledAt))) {
            failures.push(`${partner.name} accrual through ${accrualPeriod.accruedThrough}`);
          }
        }
      }
    }
    if (failures.length > 0) {
      const error = `Income automation failed for ${failures.join(", ")}`;
      state.automationRuns = state.automationRuns.map((run) =>
        run.id === automation.id
          ? { ...run, status: "failed", completedAt: new Date().toISOString(), error }
          : run
      );
      await savePersisted(env, state);
      throw new ApiError(502, error);
    }
    state.automationRuns = state.automationRuns.map((run) =>
      run.id === automation.id ? { ...run, status: "completed", completedAt: new Date().toISOString() } : run
    );
    await savePersisted(env, state);
    return "completed";
  } catch (error) {
    try {
      const state = await loadPersisted(env);
      state.automationRuns = state.automationRuns.map((run) =>
        run.id === automation.id
          ? {
              ...run,
              status: "failed",
              completedAt: new Date().toISOString(),
              error: error instanceof Error ? error.message : "Income automation failed"
            }
          : run
      );
      await savePersisted(env, state);
    } catch (finalizeError) {
      console.error(JSON.stringify({ event: "income_automation_finalize_failed", error: finalizeError instanceof Error ? finalizeError.message : String(finalizeError) }));
    }
    throw error;
  }
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

    if (url.pathname === "/api/management-report" && request.method === "GET") {
      return json(await getManagementReportDashboard(env));
    }

    if (url.pathname === "/api/sync" && request.method === "POST") {
      return json(await getSnapshot(env, { refreshFxRates: true }));
    }

    if (url.pathname === "/api/wise/import-statement" && request.method === "POST") {
      return json(await importWiseStatement(env, (await request.json()) as ImportWiseStatementPayload));
    }

    if (url.pathname === "/api/wise/card-holder-team" && request.method === "POST") {
      const payload = (await request.json()) as AssignWiseCardHolderTeamPayload;
      if (!payload.cardHolderName?.trim() || !payload.teamId?.trim()) {
        return json({ message: "cardHolderName and teamId are required" }, { status: 400 });
      }
      return json(await assignWiseCardHolderTeam(env, payload));
    }

    if (url.pathname === "/api/revenue/sync" && request.method === "POST") {
      return json(await syncRevenue(env, (await request.json()) as SyncRevenuePayload));
    }

    const revenueDraftMatch = url.pathname.match(/^\/api\/revenue\/runs\/([^/]+)\/draft$/);
    if (revenueDraftMatch && request.method === "POST") {
      return json(await draftRevenueRun(env, decodeURIComponent(revenueDraftMatch[1])), { status: 201 });
    }

    if (url.pathname === "/api/providers" && request.method === "POST") {
      return json(await createProvider(env, (await request.json()) as CreateProviderPayload), { status: 201 });
    }

    const providerMatch = url.pathname.match(/^\/api\/providers\/([^/]+)$/);
    if (providerMatch && request.method === "PUT") {
      return json(await updateProvider(env, providerMatch[1], (await request.json()) as UpdateProviderPayload));
    }
    if (providerMatch && request.method === "DELETE") {
      return json(await deleteProvider(env, providerMatch[1]));
    }

    const revenuePartnerMatch = url.pathname.match(/^\/api\/revenue-partners\/([^/]+)$/);
    if (url.pathname === "/api/revenue-partners" && request.method === "POST") {
      return json(await createRevenuePartner(env, (await request.json()) as CreateRevenuePartnerPayload), { status: 201 });
    }
    if (revenuePartnerMatch && request.method === "PUT") {
      return json(await updateRevenuePartner(env, revenuePartnerMatch[1], (await request.json()) as UpdateRevenuePartnerPayload));
    }
    if (revenuePartnerMatch && request.method === "DELETE") {
      return json(await deleteRevenuePartner(env, revenuePartnerMatch[1]));
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

    if (url.pathname === "/api/transactions/auto-categorize" && request.method === "POST") {
      return json(await autoCategorizeTransactions(env, ((await request.json()) ?? {}) as AutoCategorizeTransactionsPayload));
    }

    const teamMatch = url.pathname.match(/^\/api\/transactions\/([^/]+)\/team$/);
    if (teamMatch && request.method === "POST") {
      const body = (await request.json()) as { teamId?: string | null };
      return json(await assignTransactionTeam(env, { transactionId: teamMatch[1], teamId: body.teamId || undefined }));
    }

    const categoryMatch = url.pathname.match(/^\/api\/transactions\/([^/]+)\/category$/);
    if (categoryMatch && request.method === "POST") {
      const body = (await request.json()) as { category?: string; rememberAlias?: boolean | null };
      return json(
        await updateTransactionCategory(env, {
          transactionId: categoryMatch[1],
          category: body.category ?? "",
          rememberAlias: body.rememberAlias !== false
        })
      );
    }

    if (url.pathname === "/api/distribution/adjustments" && request.method === "POST") {
      return json(await saveProfitDistributionAdjustment(env, (await request.json()) as SaveProfitDistributionAdjustmentPayload));
    }

    if (url.pathname === "/api/teams" && request.method === "POST") {
      return json(await createTeam(env, (await request.json()) as CreateTeamPayload), { status: 201 });
    }

    if (url.pathname === "/api/invoices" && request.method === "POST") {
      return json(await createInvoice(env, (await request.json()) as CreateInvoicePayload), { status: 201 });
    }

    if (url.pathname === "/api/invoices/send" && request.method === "POST") {
      return json(await sendInvoices(env, (await request.json()) as SendInvoicesPayload));
    }

    const invoicePaymentMatch = url.pathname.match(/^\/api\/invoices\/([^/]+)\/payments$/);
    if (invoicePaymentMatch && request.method === "POST") {
      return json(
        await recordInvoicePayment(
          env,
          decodeURIComponent(invoicePaymentMatch[1]),
          (await request.json()) as RecordInvoicePaymentPayload
        )
      );
    }

    const invoiceMatch = url.pathname.match(/^\/api\/invoices\/([^/]+)$/);
    if (invoiceMatch && request.method === "PUT") {
      return json(await updateInvoice(env, decodeURIComponent(invoiceMatch[1]), (await request.json()) as UpdateInvoicePayload));
    }

    if (url.pathname === "/api/holdings" && request.method === "POST") {
      return json(await createHolding(env, (await request.json()) as CreateHoldingPayload), { status: 201 });
    }

    const holdingMatch = url.pathname.match(/^\/api\/holdings\/([^/]+)$/);
    if (holdingMatch && request.method === "PUT") {
      return json(await updateHolding(env, decodeURIComponent(holdingMatch[1]), (await request.json()) as UpdateHoldingPayload));
    }
    if (holdingMatch && request.method === "DELETE") {
      return json(await deleteHolding(env, decodeURIComponent(holdingMatch[1])));
    }

    if (url.pathname === "/api/fx/refresh" && request.method === "POST") {
      return json(await refreshFxRates(env));
    }

    return json({ message: "Not found" }, { status: 404 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown server error";
    console.error(JSON.stringify({ event: "api_request_failed", method: request.method, path: url.pathname, message }));
    return json({ message }, { status: error instanceof ApiError ? error.status : 500 });
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
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    if (controller.cron === "17 * * * *") {
      try {
        await refreshStoredFxRates(env);
      } catch (error) {
        console.error(JSON.stringify({
          event: "fx_rate_refresh_failed",
          scheduledTime: controller.scheduledTime,
          error: error instanceof Error ? error.message : String(error)
        }));
        throw error;
      }
      return;
    }
    if (!isLebanonIncomeAutomationTime(controller.scheduledTime)) return;
    try {
      await runIncomeAutomation(env, new Date(controller.scheduledTime));
    } catch (error) {
      console.error(JSON.stringify({
        event: "income_automation_failed",
        scheduledTime: controller.scheduledTime,
        error: error instanceof Error ? error.message : String(error)
      }));
      throw error;
    }
  }
} satisfies WorkerExportedHandler;
