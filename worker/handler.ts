type Env = WorkerEnv;
import type {
  AccountBalance,
  AiPromptPayload,
  AssignTransactionTeamPayload,
  AutomationRun,
  AutoMatchInvoicePaymentsResult,
  AutoCategorizeTransactionsPayload,
  AutoCategorizeTransactionsResult,
  BankAnalyticsCategoryCompaniesPage,
  BankAnalyticsSnapshot,
  BankTransactionSource,
  BulkRecordInvoicePaymentsPayload,
  CreateExpensePayload,
  CreateHoldingPayload,
  CreateInvoicePayload,
  CreateManualReceivablePayload,
  CreateProviderPayload,
  CreateRevenuePartnerPayload,
  CreateTeamPayload,
  CreateTransactionCategoryPayload,
  DashboardSnapshot,
  DataSource,
  DeleteInvoicesPayload,
  DraftRevenueRunPayload,
  ExpenseDocument,
  ExpenseRecord,
  FxRate,
  Holding,
  ImportWiseStatementPayload,
  ImportWiseStatementResult,
  ImportWiseStatementSummary,
  IntegrationStatus,
  Invoice,
  LedgerItem,
  MeritTax,
  MatchTransactionPayload,
  MatchInvoicePaymentPayload,
  MatchExpensePaymentPayload,
  PaymentAllocation,
  PersistedAiSettings,
  ProfitDistributionAdjustment,
  ProfitDistributionSnapshot,
  Provider,
  RecordInvoicePaymentPayload,
  RevenueAccrual,
  RevenuePartner,
  RevenuePullResult,
  RevenueRun,
  SaveProfitDistributionAdjustmentPayload,
  SaveAiSettingsPayload,
  SendInvoicesPayload,
  SendInvoicesResult,
  StoredAiSettings,
  SyncRevenuePayload,
  Team,
  Transaction,
  TransactionCategory,
  TransactionCategoryRule,
  TransactionMatchFilter,
  TransactionPage,
  TransactionSortKey,
  UpdateProviderPayload,
  UpdateHoldingPayload,
  UpdateInvoicePayload,
  UpdateTransactionCategoryPayload,
  UpdateTransactionCategoryDefinitionPayload,
  UpdateRevenuePartnerPayload,
  WiseCardHolderTeamAssignment,
  WiseStatementImport
} from "../shared/types";
import {
  summarizeBankActivity,
  transactionBankActivityGroupKey,
  type BankActivityGroupType,
  type BankActivitySummary,
  type BankMerchantProvider
} from "../shared/bankMerchantGroups";
import {
  defaultAiSettings,
  listOpenRouterZdrModels,
  publicAiSettings,
  requireOpenRouterZdrModel,
  runOpenRouterPrompt,
  runOpenRouterInvoicePaymentMatching,
  runOpenRouterTransactionCategorization
} from "../shared/ai";
import { canonicalTeamId, canonicalTeamName } from "../shared/business";
import {
  initialTransactionCategories,
  isRequiredTransactionCategory,
  isReviewOnlyTransactionCategory,
  isTransactionCategoryForDirection,
  sanitizeStoredTransactionCategories,
  sanitizeStoredTransactionCategoryRules,
  transactionBusinessCategory,
  transactionNeedsCategoryReview
} from "../shared/categories";
import { dashboardInvoiceDeletionBatchBlockReason } from "../shared/invoiceDeletion";
import {
  expensePayables,
  nextExpenseRecordNumber,
  validateExpenseAmounts
} from "../shared/expenses";
import { generateMissingReceiptDeclarationPdf } from "../shared/missingReceiptPdf";
import { deleteProviderReferences } from "../shared/providerDeletion";
import { invoiceCopyPayload } from "../shared/invoiceCopies";
import { assignMeritStyleDraftNumbers, nextMeritInvoiceNumber } from "../shared/invoiceNumbers";
import {
  linkMeritInvoiceProviders,
  meritInvoiceCopyDetails,
  meritInvoiceLineDescription,
  meritInvoicePeriods,
  meritProviderId,
  meritProvidersFromResponse,
  reconcileMeritInvoices,
  reconcileMeritProviders
} from "../shared/merit";
import { inferMeritTaxDefault, type MeritInvoiceTaxSample } from "../shared/meritTaxDefaults";
import {
  bindRevenuePartnerCompany,
  calculateRevenueMetrics,
  calculateTuneHourOffset,
  mergeRevenuePartnerDirectory,
  revenueRuleId,
  resolveRevenuePeriod
} from "../shared/revenue";
import type { RevenuePeriod } from "../shared/revenue";
import {
  fetchRevolutActivityBatch
} from "../shared/revolutApi";
import {
  fetchSlashActivityBatch,
  parseSlashTransactionDateRange,
  type SlashTransactionDateRange
} from "../shared/slashApi";
import {
  emptyWiseActivity,
  fetchWiseBalancesForAccessibleBusinesses,
  parseWiseProfileIds,
  type WiseActivityResult
} from "../shared/wiseApi";
import {
  normalizeImportedWiseTransactions,
  validateWiseStatementImportPayload
} from "../shared/wiseStatements";
import { migrateLegacyWiseStatementImports } from "../shared/wiseEntities";
import {
  applyPaymentState,
  buildRevenueDraft,
  canCatchUpLebanonIncomeAutomation,
  calculateApproximateUsdTotals,
  calculateInvoicePredictions,
  currentMonthAccrualPeriod,
  currentWeekAccrualPeriod,
  incomeAutomationTimezone,
  invoicePaymentAiCandidates,
  invoiceOutstanding,
  isClosedBillingPeriod,
  isLiquidAccountBalance,
  isLebanonIncomeAutomationTime,
  mergeFxRates,
  openInvoiceReceivables,
  previousCalendarMonth,
  previousCompletedWeek,
  pruneSupersededAccrualRun,
  reconcileAiInvoicePayments,
  reconcileExactInvoicePayments
} from "../shared/income";
import {
  addProfitDistributionFactPage,
  createProfitDistributionAccumulator,
  finalizeProfitDistribution,
  profitDistributionAdjustmentFromPayload,
  shouldKeepProfitDistributionAdjustment,
  type ProfitDistributionFact
} from "../shared/distribution";
import type { BankAnalyticsAccumulatorState } from "../shared/analytics";
import {
  assertBankAnalyticsSnapshotSize,
  bankAnalyticsJobPageSize,
  buildBankAnalyticsPageBudget,
  createBankAnalyticsJobIdentity
} from "../shared/analyticsJob";
import { enforceSiteAuthentication } from "./auth";
import { pollTelegramOnboarding } from "./telegram";
import {
  appendAmexCursorFingerprint,
  amexCursorFingerprint,
  maximumAmexCursorHistory,
  normalizeAmexAccount,
  normalizeAmexTransactions,
  parseAmexAccountConfigs,
  type AmexAccountConfig
} from "../shared/amexApi";
import { decodeBankSyncCheckpoint, encodeBankSyncCheckpoint } from "../shared/bankSyncCheckpoint";
import {
  bankConnectionKey,
  requireBankConnectionKey
} from "../shared/bankConnectionIdentity";
import {
  bankProviderOAuthFetchPolicy,
  fetchBankProvider
} from "../shared/boundedHttp";
import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { api } from "../convex/_generated/api";
import { calculateMetrics } from "../server/calculations";
import {
  aiProviderDirectoryForTransactions,
  enrichTransactions,
  finalizeDeterministicCategorization,
  learnAliases,
  learnCategoryAliases,
  mergeWiseCardHolderTeamAssignments,
  mergeProviderDirectory,
  mergeTeamDirectory,
  normalizeName,
  providerMatchesTransactionDirection,
  providerTypeForTransactionDirection,
  semanticMatchThreshold,
  transactionAiGroupKey,
  transactionAliasCandidates,
  transactionMerchantKey,
  transactionsShareMerchant,
  uniqueProviderTags
} from "../server/matching";

interface PersistedState {
  revision: string | null;
  providers: Provider[];
  invoices: Invoice[];
  expenses: ExpenseRecord[];
  manualReceivables: LedgerItem[];
  teams: Team[];
  transactionCategories: TransactionCategory[];
  transactionCategoryRules: TransactionCategoryRule[];
  revenuePartners: RevenuePartner[];
  wiseCardHolderTeamAssignments: WiseCardHolderTeamAssignment[];
  pendingBankTransactions: Transaction[];
  wiseStatementImports: WiseStatementImport[];
  revenueRuns: RevenueRun[];
  revenueAccruals: RevenueAccrual[];
  paymentAllocations: PaymentAllocation[];
  holdings: Holding[];
  fxRates: FxRate[];
  fxTrackedAssets: string[];
  automationRuns: AutomationRun[];
  profitDistributionAdjustments: ProfitDistributionAdjustment[];
  profitDistributionCache?: ProfitDistributionSnapshot;
  meritTaxes: MeritTax[];
  aiSettings?: PersistedAiSettings;
  bankAccounts: AccountBalance[];
  bankSyncStates: Partial<Record<BankTransactionSource, BankSyncState>>;
  bankSyncHealth: Partial<Record<BankTransactionSource, BankSyncHealth>>;
  bankTransactionBaseline: Map<string, string>;
  dirtyBankTransactionIds: Set<string>;
}

interface BankSyncState {
  source: BankTransactionSource;
  coveredRanges: SlashTransactionDateRange[];
  lastSyncedAt: string;
}

interface BankSyncHealth {
  source: BankTransactionSource;
  status: "running" | "healthy" | "failed";
  lastAttemptAt: string;
  lastSuccessAt?: string;
  lastError?: string;
  consecutiveFailures: number;
}

interface StoredBankSyncCheckpoint {
  source: BankTransactionSource;
  connectionKey: string;
  laneKey: string;
  accountIds: string[];
  fromDate: string;
  toDate: string;
  checkpoint: string;
  updatedAt: string;
}

interface BankBackfillJob {
  key: string;
  source: BankTransactionSource;
  connectionKey: string;
  fromDate: string;
  toDate: string;
  status: "queued" | "running" | "complete" | "failed";
  attempts: number;
  consecutiveFailures: number;
  nextAttemptAt: string;
  lastAttemptAt?: string;
  lastError?: string;
  completedAt?: string;
  updatedAt: string;
}

const bankSources: BankTransactionSource[] = ["wise", "revolut", "slash", "amex"];
export const automaticTransactionBankSources: readonly BankTransactionSource[] = [
  "revolut",
  "slash",
  "amex"
];

export function hasSavedWiseBalanceAccounts(accounts: readonly AccountBalance[]): boolean {
  return accounts.some((account) => account.source === "wise");
}

async function bankConnectionDirectory(env: Env): Promise<Array<{
  source: BankTransactionSource;
  connectionKey: string;
}>> {
  return Promise.all(automaticTransactionBankSources.filter((source) => bankSourceConfigured(env, source)).map(async (source) => ({
    source,
    connectionKey: await requireBankConnectionKey(env, source)
  })));
}

async function bankStorageConnectionDirectory(env: Env): Promise<Array<{
  source: BankTransactionSource;
  connectionKey: string;
}>> {
  const connections = await Promise.all(bankSources.map(async (source) => {
    const connectionKey = await bankConnectionKey(env, source);
    return connectionKey ? { source, connectionKey } : null;
  }));
  return connections.filter((connection): connection is {
    source: BankTransactionSource;
    connectionKey: string;
  } => connection !== null);
}

function bankSourceConfigured(env: Env, source: BankTransactionSource): boolean {
  if (source === "wise") {
    return Boolean(env.WISE_API_TOKEN?.trim() && env.WISE_PROFILE_IDS?.trim());
  }
  if (source === "revolut") {
    return Boolean(
      env.REVOLUT_CLIENT_ID?.trim()
      && env.REVOLUT_ISSUER?.trim()
      && env.REVOLUT_PRIVATE_KEY_PEM?.trim()
      && env.REVOLUT_REFRESH_TOKEN?.trim()
    );
  }
  if (source === "slash") {
    return Boolean(
      env.SLASH_API_KEY?.trim()
      && env.SLASH_LEGAL_ENTITY_ID?.trim()
      && env.SLASH_BASE_URL?.trim()
    );
  }
  return Boolean(
    env.AMEX_TOKEN_URL?.trim()
    && env.AMEX_API_BASE_URL?.trim()
    && env.AMEX_CLIENT_ID?.trim()
    && env.AMEX_CLIENT_SECRET?.trim()
    && env.AMEX_REFRESH_TOKEN?.trim()
    && env.AMEX_ACCOUNT_IDS?.trim()
    && env.AMEX_ACCOUNT_PATH_TEMPLATE?.trim()
    && env.AMEX_TRANSACTIONS_PATH_TEMPLATE?.trim()
    && env.AMEX_TRANSACTIONS_ITEMS_PATH?.trim()
    && env.AMEX_TRANSACTIONS_NEXT_CURSOR_PATH?.trim()
    && env.AMEX_TRANSACTIONS_CURSOR_PARAM?.trim()
    && env.AMEX_TRANSACTIONS_PAGE_SIZE_PARAM?.trim()
    && env.AMEX_TRANSACTIONS_PAGE_SIZE?.trim()
  );
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

function categoryMutationError(error: unknown): never {
  if (error instanceof ApiError) throw error;
  if (error instanceof ConvexError && isRecord(error.data)) {
    const message = typeof error.data.message === "string" ? error.data.message : "Category update failed";
    const code = typeof error.data.code === "string" ? error.data.code : "";
    const status = code === "CATEGORY_NOT_FOUND" ? 404 : code === "INVALID_CATEGORY" ? 400 : 409;
    throw new ApiError(status, message, { cause: error });
  }
  throw new ApiError(503, "Category storage is temporarily unavailable", { cause: error });
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
  | "defaultMeritTaxId"
  | "defaultMeritTaxSource"
  | "defaultMeritTaxSampleSize"
  | "defaultMeritTaxUpdatedAt"
> {
  const defaultMeritTaxId = cleanOptional(payload.defaultMeritTaxId);
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
    meritSupplierId: cleanOptional(payload.meritSupplierId),
    defaultMeritTaxId,
    defaultMeritTaxSource: defaultMeritTaxId ? "manual" : undefined,
    defaultMeritTaxSampleSize: undefined,
    defaultMeritTaxUpdatedAt: defaultMeritTaxId ? new Date().toISOString() : undefined
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

const allowedExpenseDocumentContentTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp"
]);
const maximumExpenseDocumentBytes = 10 * 1024 * 1024;

function expenseDate(value: string | undefined, label: string): string {
  const normalized = value?.trim();
  if (!normalized || !/^\d{4}-\d{2}-\d{2}$/.test(normalized) || Number.isNaN(Date.parse(`${normalized}T00:00:00.000Z`))) {
    throw new ApiError(400, `${label} must use YYYY-MM-DD`);
  }
  return normalized;
}

function validateExpenseDocumentUpload(contentType: string, byteLength: number): void {
  if (!allowedExpenseDocumentContentTypes.has(contentType)) {
    throw new ApiError(415, "Expense documents must be PDF, JPEG, PNG, or WebP files");
  }
  if (byteLength <= 0 || byteLength > maximumExpenseDocumentBytes) {
    throw new ApiError(413, "Expense documents must be between 1 byte and 10 MB");
  }
}

async function uploadExpenseDocumentToConvex(
  env: Env,
  bytes: Uint8Array,
  contentType: string
): Promise<string> {
  validateExpenseDocumentUpload(contentType, bytes.byteLength);
  const convex = getConvexClient(env);
  const serviceToken = getConvexServiceToken(env);
  const uploadUrl = await convex.mutation(api.dashboard.generateExpenseDocumentUploadUrl, { serviceToken });
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: new Blob([bytes.slice().buffer as ArrayBuffer], { type: contentType })
  });
  const result = (await response.json().catch(() => null)) as { storageId?: string; message?: string } | null;
  if (!response.ok || !result?.storageId) {
    throw new ApiError(503, result?.message || "Expense document storage is temporarily unavailable");
  }
  return result.storageId;
}

async function expenseDocumentUrl(env: Env, storageId: string): Promise<string | null> {
  return getConvexClient(env).query(api.dashboard.getExpenseDocumentUrl, {
    serviceToken: getConvexServiceToken(env),
    storageId
  });
}

async function storedExpenseDocument(env: Env, documentId: string): Promise<ExpenseDocument | undefined> {
  const state = await getConvexClient(env).query(api.dashboard.getState, {
    serviceToken: getConvexServiceToken(env)
  });
  return state?.expenses.flatMap((expense) => expense.documents).find((document) => document.id === documentId);
}

function providerTags(payload: CreateProviderPayload | UpdateProviderPayload): string[] {
  return uniqueProviderTags(Array.isArray(payload.tags) ? payload.tags : []);
}

const wiseBaseUrlByEnvironment = {
  production: "https://api.wise.com",
  sandbox: "https://api.wise-sandbox.com"
};
const defaultMeritApiBaseUrl = "https://aktiva.merit.ee/api";
const defaultCoinbaseSpotPricesUrl = "https://api.coinbase.com/v2/prices";
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

export function mergeInvoices(liveInvoices: Invoice[], persistedInvoices: Invoice[], authoritative = true): Invoice[] {
  return reconcileMeritInvoices(liveInvoices, persistedInvoices, authoritative);
}

function normalizedTransactionText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function wiseStatementTransactionKey(transaction: Transaction): string {
  const sourceId = transaction.id.match(/^wise-(?:csv|pdf)-[^-]+-(.+)$/)?.[1];
  if (sourceId) return `${transaction.wiseEntity ?? "dn"}:${transaction.currency}:${sourceId}`;
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

const maximumExternalJsonBytes = 4 * 1024 * 1024;

async function boundedResponseText(response: Response, maximumBytes = maximumExternalJsonBytes): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`External API response exceeded ${maximumBytes} bytes`);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maximumBytes) {
        throw new Error(`External API response exceeded ${maximumBytes} bytes`);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await boundedResponseText(response);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

async function fetchBankJson<T>(
  url: string,
  init: RequestInit,
  provider: string,
  oauth = false
): Promise<T> {
  const response = await fetchBankProvider(fetch, url, init, {
    provider,
    ...(oauth ? bankProviderOAuthFetchPolicy : {})
  });
  const text = await boundedResponseText(response);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

function wiseBaseUrl(env: Env): string {
  return env.WISE_ENVIRONMENT === "sandbox" ? wiseBaseUrlByEnvironment.sandbox : wiseBaseUrlByEnvironment.production;
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

async function fetchAmexAccessToken(env: Env): Promise<string | undefined> {
  if (!env.AMEX_TOKEN_URL || !env.AMEX_CLIENT_ID || !env.AMEX_CLIENT_SECRET || !env.AMEX_REFRESH_TOKEN) return undefined;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: env.AMEX_REFRESH_TOKEN,
    client_id: env.AMEX_CLIENT_ID,
    client_secret: env.AMEX_CLIENT_SECRET
  });

  const response = await fetchBankJson<{ access_token?: string }>(env.AMEX_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body
  }, "Amex", true);

  if (
    typeof response.access_token !== "string"
    || !response.access_token.trim()
    || response.access_token !== response.access_token.trim()
    || response.access_token.length > 16_384
    || /[\u0000-\u0020\u007f-\u009f]/u.test(response.access_token)
  ) {
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

type AmexCheckpointCursor = {
  accountIds: string[];
  accountIndex: number;
  providerCursor: string | null;
  seenCursorFingerprints: string[];
};

type AmexActivityBatchResult = {
  accounts: AccountBalance[];
  nextCheckpoint: string | null;
  complete: boolean;
  pagesFetched: number;
  providerTransactionsRead: number;
};

const maximumAmexTransactionPageSize = 200;

function amexTransactionPageSize(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error("AMEX_TRANSACTIONS_PAGE_SIZE must be a whole number");
  }
  const pageSize = Number(value);
  if (pageSize < 1 || pageSize > maximumAmexTransactionPageSize) {
    throw new Error(`AMEX_TRANSACTIONS_PAGE_SIZE must be between 1 and ${maximumAmexTransactionPageSize}`);
  }
  return pageSize;
}

function amexResponseValue(payload: unknown, path: string, label: string): unknown {
  const normalizedPath = path.trim();
  if (normalizedPath === "$") return payload;
  const segments = normalizedPath.split(".");
  if (
    segments.length === 0
    || segments.length > 10
    || segments.some((segment) => !/^[A-Za-z0-9_-]+$/.test(segment))
  ) {
    throw new Error(`${label} must be a dot-separated response path or $`);
  }
  let value = payload;
  for (const segment of segments) {
    if (!isRecord(value)) return undefined;
    value = value[segment];
  }
  return value;
}

function amexTransactionItems(payload: unknown, path: string): Array<Record<string, unknown>> {
  const value = amexResponseValue(payload, path, "AMEX_TRANSACTIONS_ITEMS_PATH");
  if (!Array.isArray(value) || value.some((item) => !isRecord(item))) {
    throw new Error("Amex transaction response did not contain the configured item array");
  }
  return value as Array<Record<string, unknown>>;
}

function amexNextCursor(payload: unknown, path: string): string | null {
  const value = amexResponseValue(payload, path, "AMEX_TRANSACTIONS_NEXT_CURSOR_PATH");
  if (value === undefined || value === null || value === "") return null;
  const cursor = typeof value === "string"
    ? value
    : typeof value === "number" && Number.isSafeInteger(value)
      ? String(value)
      : "";
  if (
    !cursor
    || cursor !== cursor.trim()
    || cursor.length > 4_096
    || /[\u0000-\u001f\u007f-\u009f]/u.test(cursor)
  ) {
    throw new Error("Amex transaction response returned an invalid pagination cursor");
  }
  return cursor;
}

async function amexCheckpointCursor(value: string, accountIds: string[]): Promise<AmexCheckpointCursor> {
  let payload: unknown;
  try {
    payload = JSON.parse(value) as unknown;
  } catch {
    throw new Error("Amex sync checkpoint cursor is invalid");
  }
  if (!isRecord(payload)) throw new Error("Amex sync checkpoint cursor is invalid");
  const storedAccountIds = payload.accountIds;
  const accountIndex = payload.accountIndex;
  const providerCursor = payload.providerCursor;
  const seenCursorFingerprints = payload.seenCursorFingerprints;
  if (
    !Array.isArray(storedAccountIds)
    || storedAccountIds.some((id) => typeof id !== "string")
    || JSON.stringify(storedAccountIds) !== JSON.stringify(accountIds)
    || !Number.isInteger(accountIndex)
    || (accountIndex as number) < 0
    || (accountIndex as number) >= accountIds.length
    || (providerCursor !== null && (
      typeof providerCursor !== "string"
      || !providerCursor
      || providerCursor !== providerCursor.trim()
      || providerCursor.length > 4_096
      || /[\u0000-\u001f\u007f-\u009f]/u.test(providerCursor)
    ))
    || !Array.isArray(seenCursorFingerprints)
    || seenCursorFingerprints.length > maximumAmexCursorHistory
    || seenCursorFingerprints.some((fingerprint) => typeof fingerprint !== "string" || !/^[0-9a-f]{64}$/.test(fingerprint))
    || new Set(seenCursorFingerprints).size !== seenCursorFingerprints.length
    || (providerCursor === null && seenCursorFingerprints.length !== 0)
    || (providerCursor !== null && seenCursorFingerprints.length === 0)
  ) {
    throw new Error("Amex sync checkpoint cursor is invalid");
  }
  if (
    typeof providerCursor === "string"
    && seenCursorFingerprints.at(-1) !== await amexCursorFingerprint(providerCursor)
  ) {
    throw new Error("Amex sync checkpoint cursor is invalid");
  }
  return {
    accountIds,
    accountIndex: accountIndex as number,
    providerCursor: providerCursor as string | null,
    seenCursorFingerprints: seenCursorFingerprints as string[]
  };
}

function encodeAmexCheckpoint(
  windowStart: string,
  windowEnd: string,
  cursor: AmexCheckpointCursor
): string {
  return encodeBankSyncCheckpoint({
    provider: "amex",
    windowStart,
    windowEnd,
    cursor: JSON.stringify(cursor)
  });
}

async function fetchAmexActivityBatch(
  env: Env,
  options: {
    dateRange?: SlashTransactionDateRange;
    checkpoint?: string;
    pageBudget?: number;
    onAccountsDiscovered?: (accounts: AccountBalance[]) => void | Promise<void>;
    onTransactionPage: (transactions: Transaction[]) => void | Promise<void>;
  }
): Promise<AmexActivityBatchResult> {
  if (options.dateRange && options.checkpoint) {
    throw new Error("Amex sync accepts either a date range or a checkpoint, not both");
  }
  const pageBudget = options.pageBudget ?? 5;
  if (!Number.isInteger(pageBudget) || pageBudget < 1 || pageBudget > 10) {
    throw new Error("Amex sync page budget must be an integer from 1 to 10");
  }
  const accountConfigs = parseAmexAccountConfigs(env.AMEX_ACCOUNT_IDS);
  const accessToken = await fetchAmexAccessToken(env);
  if (
    !accessToken ||
    !env.AMEX_API_BASE_URL ||
    !env.AMEX_ACCOUNT_PATH_TEMPLATE ||
    !env.AMEX_TRANSACTIONS_PATH_TEMPLATE ||
    !env.AMEX_TRANSACTIONS_ITEMS_PATH ||
    !env.AMEX_TRANSACTIONS_NEXT_CURSOR_PATH ||
    !env.AMEX_TRANSACTIONS_CURSOR_PARAM ||
    !env.AMEX_TRANSACTIONS_PAGE_SIZE_PARAM ||
    !env.AMEX_TRANSACTIONS_PAGE_SIZE ||
    accountConfigs.length === 0
  ) {
    throw new Error("Amex bounded transaction pagination is not fully configured");
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json"
  };
  const decodedCheckpoint = options.checkpoint
    ? decodeBankSyncCheckpoint(options.checkpoint, "amex")
    : null;
  const range = options.dateRange ?? defaultBankDateRange();
  const windowStart = decodedCheckpoint?.windowStart ?? `${range.fromDate}T00:00:00.000Z`;
  const windowEnd = decodedCheckpoint?.windowEnd ?? `${range.toDate}T23:59:59.999Z`;
  const accountIds = accountConfigs.map((config) => config.id);
  const accounts = await Promise.all(accountConfigs.map(async (config) => normalizeAmexAccount(
    await fetchBankJson<unknown>(
      amexEndpoint(env, env.AMEX_ACCOUNT_PATH_TEMPLATE!, config.id),
      { headers },
      "Amex"
    ),
    config
  )));
  if (options.onAccountsDiscovered) await options.onAccountsDiscovered(accounts);
  const initialCursor: AmexCheckpointCursor = decodedCheckpoint
    ? await amexCheckpointCursor(decodedCheckpoint.cursor, accountIds)
    : { accountIds, accountIndex: 0, providerCursor: null, seenCursorFingerprints: [] };
  let accountIndex = initialCursor.accountIndex;
  let providerCursor = initialCursor.providerCursor;
  let seenCursorFingerprints = initialCursor.seenCursorFingerprints;
  let pagesFetched = 0;
  let providerTransactionsRead = 0;
  const providerPageSize = amexTransactionPageSize(env.AMEX_TRANSACTIONS_PAGE_SIZE);

  while (pagesFetched < pageBudget && accountIndex < accountConfigs.length) {
    const config = accountConfigs[accountIndex];
    const params = new URLSearchParams({
      from: windowStart.slice(0, 10),
      to: windowEnd.slice(0, 10)
    });
    params.set(env.AMEX_TRANSACTIONS_PAGE_SIZE_PARAM, String(providerPageSize));
    if (providerCursor) params.set(env.AMEX_TRANSACTIONS_CURSOR_PARAM, providerCursor);
    const payload = await fetchBankJson<unknown>(
      amexEndpoint(env, env.AMEX_TRANSACTIONS_PATH_TEMPLATE, config.id, params),
      { headers },
      "Amex"
    );
    pagesFetched += 1;
    const items = amexTransactionItems(payload, env.AMEX_TRANSACTIONS_ITEMS_PATH);
    if (items.length > providerPageSize) {
      throw new Error("Amex returned more transactions than the requested page size");
    }
    const nextCursor = amexNextCursor(payload, env.AMEX_TRANSACTIONS_NEXT_CURSOR_PATH);
    const nextCursorFingerprints = nextCursor
      ? await appendAmexCursorFingerprint(seenCursorFingerprints, nextCursor)
      : [];
    const transactions = normalizeAmexTransactions(items, config);
    if (transactions.length > 0) await options.onTransactionPage(transactions);
    providerTransactionsRead += items.length;
    if (nextCursor) {
      seenCursorFingerprints = nextCursorFingerprints;
      providerCursor = nextCursor;
    } else {
      accountIndex += 1;
      providerCursor = null;
      seenCursorFingerprints = [];
    }
  }

  if (accountIndex >= accountConfigs.length) {
    return {
      accounts,
      nextCheckpoint: null,
      complete: true,
      pagesFetched,
      providerTransactionsRead
    };
  }
  return {
    accounts,
    nextCheckpoint: encodeAmexCheckpoint(windowStart, windowEnd, {
      accountIds,
      accountIndex,
      providerCursor,
      seenCursorFingerprints
    }),
    complete: false,
    pagesFetched,
    providerTransactionsRead
  };
}

function findPersistedTransaction(state: PersistedState, transactionId: string): Transaction | undefined {
  return state.pendingBankTransactions.find((transaction) => transaction.id === transactionId);
}

function upsertPersistedTransaction(state: PersistedState, updated: Transaction): void {
  const existing = state.pendingBankTransactions.find((transaction) => transaction.id === updated.id);
  state.pendingBankTransactions = existing
    ? state.pendingBankTransactions.map((transaction) =>
        transaction.id === updated.id ? { ...transaction, ...updated } : transaction
      )
    : [updated, ...state.pendingBankTransactions];
  if (
    updated.source === "wise"
    || updated.source === "revolut"
    || updated.source === "slash"
    || updated.source === "amex"
  ) {
    state.dirtyBankTransactionIds.add(updated.id);
  }
}

async function fetchTransactionForUpdate(env: Env, transactionId: string, state?: PersistedState): Promise<Transaction | undefined> {
  if (state) {
    const persisted = findPersistedTransaction(state, transactionId);
    if (persisted) return persisted;
  }
  const storedBankTransaction = await getConvexClient(env).query(api.banking.getTransaction, {
    serviceToken: getConvexServiceToken(env),
    id: transactionId
  });
  return storedBankTransaction ?? undefined;
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
  return "EE";
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
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(await meritUrl(env, path, body), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body
    });
    const text = await response.text();
    if (response.ok) return text ? (JSON.parse(text) as T) : ({} as T);
    if (response.status !== 429 || attempt === 3) {
      throw new Error(`Merit API failed: ${response.status} ${response.statusText}`);
    }
    const retryAfterSeconds = Math.max(1, Number(response.headers.get("Retry-After")) || 10);
    await new Promise((resolve) => setTimeout(resolve, Math.min(retryAfterSeconds, 60) * 1000));
  }
  throw new Error("Merit API request retry limit reached");
}

interface MeritInvoiceRecord {
  SIHId?: string;
  InvoiceNo?: string;
  CustomerId?: string;
  CustomerName?: string;
  DueDate?: string;
  InvoiceDate?: string;
  DocumentDate?: string;
  DocDate?: string;
  CurrencyCode?: string;
  TotalSum?: number;
  TotalAmount?: number;
  Paid?: boolean;
}

export async function fetchMeritInvoices(env: Env, persistedInvoices: Invoice[] = []): Promise<Invoice[]> {
  if (!env.MERIT_API_ID || !env.MERIT_API_KEY) return [];

  const responses = await Promise.all(
    meritInvoicePeriods(persistedInvoices).map((period) =>
      fetchMeritJson<MeritInvoiceRecord[]>(env, env.MERIT_GET_INVOICES_PATH || "/v1/getinvoices", {
        PeriodStart: meritDate(period.periodStart),
        PeriodEnd: meritDate(period.periodEnd),
        UnPaid: false
      })
    )
  );

  return meritInvoicesFromRecords(responses.flat());
}

function meritInvoicesFromRecords(records: MeritInvoiceRecord[]): Invoice[] {
  const fetchedAt = new Date().toISOString();
  const byExternalId = new Map<string, Invoice>();
  for (const invoice of records) {
    const externalId = invoice.SIHId ?? invoice.InvoiceNo;
    if (!externalId) continue;
    const issueDate = meritIsoDate(invoice.DocumentDate ?? invoice.InvoiceDate ?? invoice.DocDate, fetchedAt.slice(0, 10));
    byExternalId.set(externalId, {
      id: `merit-${externalId}`,
      ...(invoice.CustomerId ? { providerId: meritProviderId("customer", invoice.CustomerId) } : {}),
      documentType: "sales_invoice",
      origin: "merit",
      customerName: invoice.CustomerName ?? "Merit invoice",
      amount: invoice.TotalSum ?? invoice.TotalAmount ?? 0,
      currency: (invoice.CurrencyCode ?? "USD").toUpperCase(),
      status: "open",
      meritStatus: invoice.Paid ? "paid" : "open",
      meritDeliveryStatus: "saved",
      invoiceNumber: invoice.InvoiceNo ?? externalId,
      issueDate,
      dueDate: meritIsoDate(invoice.DueDate, fetchedAt.slice(0, 10)),
      source: "merit",
      externalId,
      description: `Merit invoice ${invoice.InvoiceNo ?? invoice.SIHId ?? ""}`.trim(),
      revenueRunIds: [],
      createdAt: `${issueDate}T00:00:00.000Z`,
      updatedAt: `${issueDate}T00:00:00.000Z`
    });
  }
  return [...byExternalId.values()];
}

async function fetchMeritInvoicesForCustomer(env: Env, customerId: string): Promise<Invoice[]> {
  const response = await fetchMeritJson<MeritInvoiceRecord[]>(env, "/v2/getinvoices2", { CustId: customerId });
  return meritInvoicesFromRecords(response);
}

export async function fetchMeritCustomers(env: Env): Promise<Provider[]> {
  if (!env.MERIT_API_ID || !env.MERIT_API_KEY) return [];
  const response = await fetchMeritJson<unknown>(env, "/v1/getcustomers", { WithComments: true });
  return meritProvidersFromResponse(response, "customer");
}

export async function fetchMeritVendors(env: Env): Promise<Provider[]> {
  if (!env.MERIT_API_ID || !env.MERIT_API_KEY) return [];
  const response = await fetchMeritJson<unknown>(env, "/v1/getvendors", { WithComments: true });
  return meritProvidersFromResponse(response, "vendor");
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

interface MeritInvoiceDetails {
  Lines?: Array<{
    AmountExclVat?: number;
    Description?: string;
    TaxId?: string;
  }>;
}

interface MeritTaxDefaultCompanyReport {
  providerId: string;
  company: string;
  status: "inferred" | "ambiguous" | "no-tax-history" | "no-invoices" | "manual-preserved";
  defaultMeritTaxId?: string;
  defaultMeritTaxName?: string;
  sampledInvoiceCount: number;
  usableInvoiceCount: number;
  supportingInvoiceCount: number;
  votes: Record<string, number>;
}

export async function fetchMeritInvoiceTaxSample(env: Env, invoice: Invoice): Promise<MeritInvoiceTaxSample> {
  if (!invoice.externalId) throw new Error("Merit invoice ID is required to read its tax");
  const detail = await fetchMeritJson<MeritInvoiceDetails>(env, "/v2/getinvoice", {
    Id: invoice.externalId,
    AddAttachment: false
  });
  return {
    invoiceId: invoice.externalId,
    invoiceNumber: invoice.invoiceNumber ?? invoice.externalId,
    issueDate: invoice.issueDate,
    taxIds: (detail.Lines ?? []).map((line) => line.TaxId?.trim()).filter((taxId): taxId is string => Boolean(taxId))
  };
}

export async function fetchMeritInvoiceCopyDetails(
  env: Env,
  invoice: Invoice
): Promise<Pick<Invoice, "amount" | "description" | "periodStart" | "periodEnd" | "taxId">> {
  if (!invoice.externalId) throw new ApiError(409, "Merit invoice ID is required to duplicate this invoice");
  const detail = await fetchMeritJson<MeritInvoiceDetails>(env, "/v2/getinvoice", {
    Id: invoice.externalId,
    AddAttachment: false
  });
  try {
    return meritInvoiceCopyDetails(detail);
  } catch (error) {
    throw new ApiError(
      409,
      error instanceof Error ? error.message : "Merit invoice details cannot be duplicated exactly",
      { cause: error }
    );
  }
}

async function syncMeritTaxDefaults(env: Env): Promise<{
  updatedCompanies: number;
  updatedDrafts: number;
  companies: MeritTaxDefaultCompanyReport[];
}> {
  if (!env.MERIT_API_ID || !env.MERIT_API_KEY) {
    throw new ApiError(503, "Merit is not configured");
  }

  const state = await loadPersisted(env);
  const [meritInvoices, meritTaxes, meritCustomers] = await Promise.all([
    fetchMeritInvoices(env, state.invoices),
    fetchMeritTaxes(env),
    fetchMeritCustomers(env)
  ]);
  state.providers = mergeProviderDirectory(reconcileMeritProviders(state.providers, meritCustomers, "customer"));
  const linkedInvoices = linkMeritInvoiceProviders(meritInvoices, state.providers);
  const invoicesByProviderId = new Map<string, Invoice[]>();
  for (const invoice of linkedInvoices) {
    if (!invoice.providerId || !invoice.externalId) continue;
    const providerInvoices = invoicesByProviderId.get(invoice.providerId) ?? [];
    providerInvoices.push(invoice);
    invoicesByProviderId.set(invoice.providerId, providerInvoices);
  }

  const taxById = new Map(meritTaxes.map((tax) => [tax.id, tax]));
  const reports: MeritTaxDefaultCompanyReport[] = [];
  const inferredByProviderId = new Map<string, ReturnType<typeof inferMeritTaxDefault>>();

  for (const provider of state.providers.filter((item) => item.type === "client" && item.meritCustomerId)) {
    if (provider.defaultMeritTaxSource === "manual") {
      reports.push({
        providerId: provider.id,
        company: provider.name,
        status: "manual-preserved",
        defaultMeritTaxId: provider.defaultMeritTaxId,
        defaultMeritTaxName: provider.defaultMeritTaxId ? taxById.get(provider.defaultMeritTaxId)?.name : undefined,
        sampledInvoiceCount: 0,
        usableInvoiceCount: 0,
        supportingInvoiceCount: 0,
        votes: {}
      });
      continue;
    }
    let providerInvoices = [...(invoicesByProviderId.get(provider.id) ?? [])];
    if (providerInvoices.length < 5) {
      providerInvoices = (await fetchMeritInvoicesForCustomer(env, provider.meritCustomerId!))
        .map((invoice) => ({ ...invoice, providerId: provider.id }));
    }
    const recentInvoices = providerInvoices
      .sort((left, right) => right.issueDate.localeCompare(left.issueDate) || (right.invoiceNumber ?? "").localeCompare(left.invoiceNumber ?? ""))
      .slice(0, 5);
    if (recentInvoices.length === 0) {
      reports.push({
        providerId: provider.id,
        company: provider.name,
        status: "no-invoices",
        sampledInvoiceCount: 0,
        usableInvoiceCount: 0,
        supportingInvoiceCount: 0,
        votes: {}
      });
      continue;
    }

    const samples: MeritInvoiceTaxSample[] = [];
    for (const invoice of recentInvoices) {
      const sample = await fetchMeritInvoiceTaxSample(env, invoice);
      samples.push({ ...sample, taxIds: sample.taxIds.filter((taxId) => taxById.has(taxId)) });
    }
    const inference = inferMeritTaxDefault(samples);
    inferredByProviderId.set(provider.id, inference);
    reports.push({
      providerId: provider.id,
      company: provider.name,
      status: inference.status,
      defaultMeritTaxId: inference.defaultMeritTaxId,
      defaultMeritTaxName: inference.defaultMeritTaxId ? taxById.get(inference.defaultMeritTaxId)?.name : undefined,
      sampledInvoiceCount: inference.sampledInvoiceCount,
      usableInvoiceCount: inference.usableInvoiceCount,
      supportingInvoiceCount: inference.supportingInvoiceCount,
      votes: inference.votes
    });
  }

  const updatedAt = new Date().toISOString();
  let updatedCompanies = 0;
  state.providers = state.providers.map((provider) => {
    const inference = inferredByProviderId.get(provider.id);
    if (!inference || provider.defaultMeritTaxSource === "manual") return provider;
    const nextDefaultMeritTaxId = inference.status === "inferred" ? inference.defaultMeritTaxId : undefined;
    if (
      provider.defaultMeritTaxId !== nextDefaultMeritTaxId ||
      provider.defaultMeritTaxSource !== (nextDefaultMeritTaxId ? "merit-history" : undefined) ||
      provider.defaultMeritTaxSampleSize !== inference.sampledInvoiceCount
    ) {
      updatedCompanies += 1;
    }
    return {
      ...provider,
      defaultMeritTaxId: nextDefaultMeritTaxId,
      defaultMeritTaxSource: nextDefaultMeritTaxId ? "merit-history" as const : undefined,
      defaultMeritTaxSampleSize: inference.sampledInvoiceCount,
      defaultMeritTaxUpdatedAt: updatedAt
    };
  });

  const providersById = new Map(state.providers.map((provider) => [provider.id, provider]));
  const revenuePartnersById = new Map(state.revenuePartners.map((partner) => [partner.id, partner]));
  let updatedDrafts = 0;
  state.invoices = state.invoices.map((invoice) => {
    if (invoice.status !== "draft" || invoice.externalId || invoice.taxId || !invoice.providerId) return invoice;
    const provider = providersById.get(invoice.providerId);
    const ruleTaxId = invoice.billingRuleId ? revenuePartnersById.get(invoice.billingRuleId)?.defaultMeritTaxId : undefined;
    const defaultMeritTaxId = ruleTaxId ?? provider?.defaultMeritTaxId;
    if (!defaultMeritTaxId) return invoice;
    updatedDrafts += 1;
    return { ...invoice, taxId: defaultMeritTaxId, updatedAt };
  });

  await savePersisted(env, state);
  return { updatedCompanies, updatedDrafts, companies: reports };
}

export async function createMeritInvoice(
  env: Env,
  payload: CreateInvoicePayload,
  tax: MeritTax,
  requestedInvoiceNumber: string,
  itemCode?: string,
  provider?: Provider
): Promise<Invoice> {
  assertMeritWriteConfiguration(env);
  const taxAmount = Number(((payload.amount * tax.taxPct) / 100).toFixed(2));

  const issueDate = payload.issueDate ?? new Date().toISOString().slice(0, 10);
  const invoiceNo = requestedInvoiceNumber.trim();
  if (!new RegExp(`^${issueDate.slice(0, 4)}/\\d+$`).test(invoiceNo)) {
    throw new ApiError(400, `Invoice number must follow the active Merit ${issueDate.slice(0, 4)}/sequence format`);
  }
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
            Description: meritInvoiceLineDescription(payload.description, payload.periodStart, payload.periodEnd),
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
  if (partner.affiliateId.trim()) {
    params.append("filters[Affiliate.id][conditional]", "EQUAL_TO");
    params.append("filters[Affiliate.id][values][0]", partner.affiliateId);
  }
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

const bankActivityWindowDays = 45;
const bankSyncOverlapDays = 3;
const bankMutationBatchSize = 200;
const bankClassificationBatchSize = 240;
const bankAiClassificationBatchSize = 40;

function isoDateShift(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function defaultBankDateRange(now = Date.now()): SlashTransactionDateRange {
  const toDate = new Date(now).toISOString().slice(0, 10);
  return {
    fromDate: isoDateShift(toDate, 1 - bankActivityWindowDays),
    toDate
  };
}

interface TransactionPageOptions {
  fromDate: string;
  toDate: string;
  source?: BankTransactionSource;
  direction?: Transaction["direction"];
  wiseEntity?: "dn" | "lmd";
  accountId?: string;
  category?: string;
  team?: string;
  groupType?: BankActivityGroupType;
  groupKey?: string;
  match: TransactionMatchFilter;
  search?: string;
  sortKey: TransactionSortKey;
  order: "asc" | "desc";
  cursor: string | null;
  limit: number;
}

interface ActivityDirectory {
  providers: BankMerchantProvider[];
  teams: Array<{ id: string; name: string }>;
  transactionCategories: TransactionCategory[];
  documentedTransactionIds: string[];
}

async function readRawTransactionPage(
  env: Env,
  options: Pick<TransactionPageOptions, "fromDate" | "toDate" | "source" | "direction" | "order" | "cursor" | "limit">
): Promise<TransactionPage> {
  const convex = getConvexClient(env);
  const serviceToken = getConvexServiceToken(env);
  const result = await convex.query(api.banking.getActivityPage, {
    serviceToken,
    source: options.source,
    direction: options.direction,
    fromDate: options.fromDate,
    toDate: options.toDate,
    order: options.order,
    paginationOpts: {
      cursor: options.cursor,
      numItems: Math.max(1, Math.min(bankMutationBatchSize, Math.trunc(options.limit)))
    }
  });
  return {
    fromDate: options.fromDate,
    toDate: options.toDate,
    ...(options.source ? { source: options.source } : {}),
    ...(options.direction ? { direction: options.direction } : {}),
    transactions: result.page,
    continueCursor: result.isDone ? null : result.continueCursor,
    isDone: result.isDone
  };
}

async function readTransactionPage(
  env: Env,
  options: {
    fromDate: string;
    toDate: string;
    source?: BankTransactionSource;
    direction?: Transaction["direction"];
    order?: "asc" | "desc";
    cursor?: string | null;
    limit?: number;
  }
): Promise<TransactionPage> {
  const convex = getConvexClient(env);
  const serviceToken = getConvexServiceToken(env);
  const connections = await bankConnectionDirectory(env);
  const normalized = {
    ...options,
    order: options.order ?? "desc",
    cursor: options.cursor ?? null,
    limit: options.limit ?? bankMutationBatchSize
  };
  const [result, coverage] = await Promise.all([
    readRawTransactionPage(env, normalized),
    convex.query(api.banking.getActivityCoverage, {
      serviceToken,
      connections,
      source: options.source,
      fromDate: options.fromDate,
      toDate: options.toDate
    })
  ]);
  return {
    ...result,
    coverage
  };
}

function normalizedActivityText(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function transactionPageNeedsScopeScan(options: TransactionPageOptions): boolean {
  return Boolean(
    options.search
    || options.wiseEntity
    || options.accountId
    || options.category
    || options.team
    || options.groupType
    || options.match !== "all"
    || options.sortKey !== "date"
  );
}

function activityOffsetCursor(cursor: string | null): number {
  if (!cursor) return 0;
  const match = /^activity-offset:(\d+)$/.exec(cursor);
  if (!match) throw new ApiError(400, "Transaction cursor does not match this filtered view");
  const offset = Number(match[1]);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new ApiError(400, "Transaction cursor is invalid");
  }
  return offset;
}

function compareActivityValues(left: boolean | number | string | undefined, right: boolean | number | string | undefined): number {
  if (left === right) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "boolean" && typeof right === "boolean") return Number(left) - Number(right);
  return String(left).localeCompare(String(right), "en", { numeric: true, sensitivity: "base" });
}

function activitySortValue(
  transaction: Transaction,
  options: TransactionPageOptions,
  providersById: ReadonlyMap<string, BankMerchantProvider>,
  teamsById: ReadonlyMap<string, { id: string; name: string }>,
  documentedTransactionIds: ReadonlySet<string>
): boolean | number | string | undefined {
  if (options.sortKey === "account") return transaction.accountName;
  if (options.sortKey === "amount") return transaction.amount;
  if (options.sortKey === "category") return transactionBusinessCategory(transaction.category);
  if (options.sortKey === "company") {
    return transaction.matchedProviderId
      ? providersById.get(transaction.matchedProviderId)?.name
      : transaction.merchantName ?? transaction.counterparty;
  }
  if (options.sortKey === "counterparty") return transaction.merchantName ?? transaction.counterparty;
  if (options.sortKey === "date") return transaction.date;
  if (options.sortKey === "direction") return transaction.direction;
  if (options.sortKey === "document") {
    return Boolean(transaction.matchedInvoiceId || documentedTransactionIds.has(transaction.id));
  }
  if (options.sortKey === "match") return transaction.categoryConfidence ?? 0;
  if (options.sortKey === "period") return transaction.date.slice(0, 7);
  if (options.sortKey === "source") return transaction.source;
  return transaction.teamId ? teamsById.get(transaction.teamId)?.name : undefined;
}

function filterAndSortActivity(
  transactions: readonly Transaction[],
  options: TransactionPageOptions,
  directory: ActivityDirectory
): Transaction[] {
  const providersById = new Map(directory.providers.map((provider) => [provider.id, provider]));
  const teamsById = new Map(directory.teams.map((team) => [team.id, team]));
  const documentedTransactionIds = new Set(directory.documentedTransactionIds);
  const search = normalizedActivityText(options.search);
  const rows = transactions.filter((transaction) => {
    if (options.wiseEntity && transaction.wiseEntity !== options.wiseEntity) return false;
    if (options.accountId && transaction.accountId !== options.accountId) return false;
    if (options.category && transactionBusinessCategory(transaction.category) !== options.category) return false;
    if (options.team === "unassigned" && transaction.teamId) return false;
    if (options.team && options.team !== "unassigned" && transaction.teamId !== options.team) return false;
    if (
      options.groupType
      && transactionBankActivityGroupKey(transaction, options.groupType, directory.providers) !== options.groupKey
    ) return false;
    if (options.match !== "all") {
      const categorized = !transactionNeedsCategoryReview(
        transaction,
        directory.transactionCategories
      );
      if (options.match === "matched" ? !categorized : categorized) return false;
    }
    if (!search) return true;
    const provider = transaction.matchedProviderId
      ? providersById.get(transaction.matchedProviderId)
      : undefined;
    const team = transaction.teamId ? teamsById.get(transaction.teamId) : undefined;
    return normalizedActivityText([
      transaction.merchantName,
      transaction.counterparty,
      transaction.description,
      transaction.rawName,
      transaction.accountName,
      transaction.cardHolderName,
      transaction.cardLastFour,
      transaction.category,
      transaction.currency,
      provider?.name,
      provider?.legalName,
      ...(provider?.aliases ?? []),
      team?.name
    ].filter(Boolean).join(" ")).includes(search);
  });
  const multiplier = options.order === "asc" ? 1 : -1;
  return rows.sort((left, right) => {
    const primary = compareActivityValues(
      activitySortValue(left, options, providersById, teamsById, documentedTransactionIds),
      activitySortValue(right, options, providersById, teamsById, documentedTransactionIds)
    );
    if (primary !== 0) return primary * multiplier;
    const date = left.date.localeCompare(right.date);
    return date !== 0 ? date * multiplier : left.id.localeCompare(right.id) * multiplier;
  });
}

async function collectActivityTransactions(env: Env, options: TransactionPageOptions): Promise<{
  directory: ActivityDirectory;
  transactions: Transaction[];
}> {
  const convex = getConvexClient(env);
  const serviceToken = getConvexServiceToken(env);
  const directoryPromise = convex.query(api.dashboard.getAnalyticsDirectory, { serviceToken });
  const transactions: Transaction[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const page = await readRawTransactionPage(env, {
      fromDate: options.fromDate,
      toDate: options.toDate,
      source: options.source,
      direction: options.direction,
      order: "asc",
      cursor,
      limit: bankMutationBatchSize
    });
    transactions.push(...page.transactions);
    cursor = page.continueCursor;
    if (cursor) {
      if (seenCursors.has(cursor)) throw new ApiError(503, "Transaction pagination did not advance");
      seenCursors.add(cursor);
    }
  } while (cursor);
  const directory = await directoryPromise as ActivityDirectory;
  return {
    directory,
    transactions: filterAndSortActivity(transactions, options, directory)
  };
}

async function readScopedTransactionPage(env: Env, options: TransactionPageOptions): Promise<TransactionPage> {
  if (!transactionPageNeedsScopeScan(options)) return readTransactionPage(env, options);
  const connections = await bankConnectionDirectory(env);
  const [collected, coverage] = await Promise.all([
    collectActivityTransactions(env, options),
    getConvexClient(env).query(api.banking.getActivityCoverage, {
      serviceToken: getConvexServiceToken(env),
      connections,
      source: options.source,
      fromDate: options.fromDate,
      toDate: options.toDate
    })
  ]);
  const offset = activityOffsetCursor(options.cursor);
  const transactions = collected.transactions.slice(offset, offset + options.limit);
  const nextOffset = offset + transactions.length;
  const isDone = nextOffset >= collected.transactions.length;
  return {
    fromDate: options.fromDate,
    toDate: options.toDate,
    ...(options.source ? { source: options.source } : {}),
    ...(options.direction ? { direction: options.direction } : {}),
    transactions,
    continueCursor: isDone ? null : `activity-offset:${nextOffset}`,
    isDone,
    totalCount: collected.transactions.length,
    coverage
  };
}

async function readBankActivitySummary(env: Env, options: TransactionPageOptions): Promise<BankActivitySummary> {
  const collected = await collectActivityTransactions(env, { ...options, cursor: null });
  return summarizeBankActivity(collected.transactions, collected.directory.providers);
}

interface BankAnalyticsDateRange {
  fromDate: string;
  toDate: string;
}

function bankAnalyticsDateRange(url: URL): BankAnalyticsDateRange {
  const fromDate = url.searchParams.get("fromDate");
  const toDate = url.searchParams.get("toDate");
  if (!fromDate || !toDate) throw new ApiError(400, "Analytics fromDate and toDate are required");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)
    || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)
    || fromDate > toDate
    || toDate > new Date().toISOString().slice(0, 10)
  ) {
    throw new ApiError(400, "Analytics date range is invalid");
  }
  return { fromDate, toDate };
}

function analyticsBuildingResponse(): Response {
  return json(
    { status: "building", reason: "snapshot" },
    { status: 202, headers: { "Retry-After": "1" } }
  );
}

function isAnalyticsJobConflict(error: unknown): boolean {
  return error instanceof ConvexError
    && isRecord(error.data)
    && error.data.code === "ANALYTICS_JOB_CONFLICT";
}

function requireBankAnalyticsSnapshot(
  value: unknown,
  range: BankAnalyticsDateRange
): BankAnalyticsSnapshot {
  if (
    !isRecord(value)
    || value.version !== 3
    || value.fromDate !== range.fromDate
    || value.toDate !== range.toDate
    || !isRecord(value.summary)
    || !Array.isArray(value.categories)
    || !Array.isArray(value.teams)
    || !Array.isArray(value.sources)
    || !Array.isArray(value.providers)
    || !Array.isArray(value.relationships)
    || !Array.isArray(value.reviewSamples)
    || !isRecord(value.unmatchedMerchants)
    || !isRecord(value.bankPeriod)
    || !Array.isArray(value.bankPeriod.sources)
    || !Array.isArray(value.bankPeriod.wiseEntities)
    || !isRecord(value.bankPeriod.slashCashback)
  ) {
    throw new Error("Stored Analytics snapshot is invalid");
  }
  return value as unknown as BankAnalyticsSnapshot;
}

async function bankAnalyticsBuildContext(
  env: Env,
  range: BankAnalyticsDateRange
) {
  const convex = getConvexClient(env);
  const serviceToken = getConvexServiceToken(env);
  const [directory, monthRevisions] = await Promise.all([
    convex.query(api.dashboard.getAnalyticsDirectory, { serviceToken }),
    convex.query(api.banking.getAnalyticsPeriodRevision, {
      serviceToken,
      fromDate: range.fromDate,
      toDate: range.toDate
    })
  ]);
  const options = {
    ...range,
    providers: directory.providers,
    teams: directory.teams
  };
  return {
    options,
    identity: createBankAnalyticsJobIdentity(monthRevisions, options)
  };
}

async function getBankAnalyticsSnapshot(
  env: Env,
  range: BankAnalyticsDateRange
): Promise<Response> {
  const convex = getConvexClient(env);
  const serviceToken = getConvexServiceToken(env);
  const key = `${range.fromDate}:${range.toDate}`;
  const [context, storedJob] = await Promise.all([
    bankAnalyticsBuildContext(env, range),
    convex.query(api.analytics.getJob, { serviceToken, key })
  ]);

  let job = storedJob;
  if (!job || job.version !== context.identity.version) {
    try {
      job = await convex.mutation(api.analytics.startJob, {
        serviceToken,
        key,
        version: context.identity.version,
        expectedVersion: job?.version ?? null,
        fromDate: range.fromDate,
        toDate: range.toDate,
        accumulator: context.identity.initialState
      });
    } catch (error) {
      if (isAnalyticsJobConflict(error)) return analyticsBuildingResponse();
      throw error;
    }
  }

  if (job.version !== context.identity.version) return analyticsBuildingResponse();
  if (job.status === "complete") {
    return json(requireBankAnalyticsSnapshot(job.snapshot, range));
  }
  if (!job.accumulator) throw new Error("Stored Analytics build progress is missing its accumulator");

  const expectedCursor = job.cursor;
  const build = await buildBankAnalyticsPageBudget({
    ...context.options,
    state: job.accumulator as BankAnalyticsAccumulatorState,
    cursor: expectedCursor,
    readPage: (cursor) => readTransactionPage(env, {
      ...range,
      order: "asc",
      cursor,
      limit: bankAnalyticsJobPageSize
    })
  });

  const latestContext = await bankAnalyticsBuildContext(env, range);
  if (latestContext.identity.version !== context.identity.version) {
    return analyticsBuildingResponse();
  }

  try {
    if (build.status === "complete") {
      assertBankAnalyticsSnapshotSize(build.snapshot);
      await convex.mutation(api.analytics.completeJob, {
        serviceToken,
        key,
        version: context.identity.version,
        expectedCursor,
        snapshot: build.snapshot
      });
      return json(build.snapshot);
    }
    await convex.mutation(api.analytics.saveProgress, {
      serviceToken,
      key,
      version: context.identity.version,
      expectedCursor,
      cursor: build.cursor,
      accumulator: build.accumulator
    });
    return analyticsBuildingResponse();
  } catch (error) {
    if (isAnalyticsJobConflict(error)) return analyticsBuildingResponse();
    throw error;
  }
}

async function invoicePaymentCandidates(
  env: Env,
  currency: string,
  limit: number,
  cursor: string | null
): Promise<TransactionPage> {
  const result = await getConvexClient(env).query(api.banking.getInvoicePaymentCandidates, {
    serviceToken: getConvexServiceToken(env),
    currency,
    limit,
    cursor
  });
  return {
    fromDate: "1900-01-01",
    toDate: "9999-12-31",
    direction: "in",
    transactions: result.transactions,
    continueCursor: result.continueCursor,
    isDone: !result.hasMore
  };
}

async function profitDistributionFromFacts(
  env: Env,
  adjustments: ProfitDistributionAdjustment[]
): Promise<{ snapshot: ProfitDistributionSnapshot; transactionCount: number }> {
  const convex = getConvexClient(env);
  const serviceToken = getConvexServiceToken(env);
  const status = await convex.query(api.banking.getProfitFactsBackfillStatus, { serviceToken });
  if (!status.isComplete) {
    throw new ApiError(503, "Profit distribution aggregates are still being prepared");
  }
  const accumulator = createProfitDistributionAccumulator();
  const seenCursors = new Set<string>();
  let transactionCount = 0;
  let cursor: string | null = null;
  do {
    const page: {
      page: ProfitDistributionFact[];
      isDone: boolean;
      continueCursor: string;
    } = await convex.query(api.banking.getProfitFactsPage, {
      serviceToken,
      paginationOpts: {
        cursor,
        numItems: bankMutationBatchSize
      }
    });
    addProfitDistributionFactPage(accumulator, page.page);
    transactionCount += page.page.reduce((total, fact) => total + fact.transactionCount, 0);
    cursor = page.isDone ? null : page.continueCursor;
    if (cursor) {
      if (seenCursors.has(cursor)) throw new ApiError(503, "Profit fact pagination did not advance");
      seenCursors.add(cursor);
    }
  } while (cursor);
  return {
    snapshot: finalizeProfitDistribution(accumulator, adjustments),
    transactionCount
  };
}

async function rebuildProfitDistributionCache(env: Env): Promise<ProfitDistributionSnapshot> {
  const state = await loadPersisted(env);
  const { snapshot, transactionCount } = await profitDistributionFromFacts(
    env,
    state.profitDistributionAdjustments
  );
  console.log(JSON.stringify({
    event: "profit_distribution_cache_rebuilt",
    transactions: transactionCount,
    months: snapshot.months.length
  }));
  return snapshot;
}

async function upsertLedgerTransactions(
  env: Env,
  source: BankTransactionSource,
  transactions: Transaction[]
): Promise<{ inserted: number; updated: number }> {
  if (transactions.length === 0) return { inserted: 0, updated: 0 };
  const convex = getConvexClient(env);
  const serviceToken = getConvexServiceToken(env);
  const connectionKey = await requireBankConnectionKey(env, source);
  const syncedAt = new Date().toISOString();
  let inserted = 0;
  let updated = 0;
  for (let index = 0; index < transactions.length; index += bankMutationBatchSize) {
    const result = await convex.mutation(api.banking.upsertActivityBatch, {
      serviceToken,
      source,
      connectionKey,
      replaceAccounts: false,
      accounts: [],
      transactions: transactions.slice(index, index + bankMutationBatchSize).map((transaction) => ({
        ...transaction,
        source
      })),
      syncedAt
    });
    inserted += result.insertedTransactions;
    updated += result.updatedTransactions;
  }
  return { inserted, updated };
}

interface BankSyncLease {
  token: string;
  fence: number;
  connectionKey: string;
  renew: () => Promise<void>;
}

async function upsertSyncedLedgerTransactions(
  env: Env,
  source: BankTransactionSource,
  transactions: Transaction[],
  lease: BankSyncLease
): Promise<{ inserted: number; updated: number }> {
  if (transactions.length === 0) return { inserted: 0, updated: 0 };
  const convex = getConvexClient(env);
  const serviceToken = getConvexServiceToken(env);
  const syncedAt = new Date().toISOString();
  let inserted = 0;
  let updated = 0;
  for (let index = 0; index < transactions.length; index += bankMutationBatchSize) {
    await lease.renew();
    const result = await convex.mutation(api.banking.upsertSyncedActivityBatch, {
      serviceToken,
      source,
      replaceAccounts: false,
      accounts: [],
      transactions: transactions.slice(index, index + bankMutationBatchSize).map((transaction) => ({
        ...transaction,
        source
      })),
      syncedAt,
      connectionKey: lease.connectionKey,
      leaseToken: lease.token,
      leaseFence: lease.fence
    });
    inserted += result.insertedTransactions;
    updated += result.updatedTransactions;
  }
  return { inserted, updated };
}

async function loadPersisted(env: Env): Promise<PersistedState> {
  const convex = getConvexClient(env);
  const serviceToken = getConvexServiceToken(env);
  const connections = await bankStorageConnectionDirectory(env);
  const [loadedState, activityMetadata] = await Promise.all([
    convex.query(api.dashboard.getState, { serviceToken }),
    convex.query(api.banking.getActivityMetadata, { serviceToken, connections })
  ]).catch((error: unknown) => {
    throw new ApiError(503, "Dashboard storage is temporarily unavailable", { cause: error });
  });
  let stored = loadedState;

  let storedTransactionCategories = stored?.transactionCategories ?? [];
  const changedSystemCategories = initialTransactionCategories.filter((category) => {
    const storedCategory = storedTransactionCategories.find((storedItem) => storedItem.id === category.id);
    return !storedCategory
      || storedCategory.name !== category.name
      || storedCategory.direction !== category.direction
      || storedCategory.system !== category.system;
  });
  if (changedSystemCategories.length > 0) {
    for (const category of changedSystemCategories) {
      const storedCategory = storedTransactionCategories.find((storedItem) => storedItem.id === category.id);
      if (!storedCategory || storedCategory.name === category.name) continue;
      const duplicate = storedTransactionCategories.find(
        (storedItem) => storedItem.id !== category.id && normalizeName(storedItem.name) === normalizeName(category.name)
      );
      if (duplicate) {
        throw new ApiError(409, `The built-in category ${category.name} conflicts with an existing category`);
      }
      let hasMore = false;
      do {
        const result = await convex.mutation(api.banking.renameCategoryBatch, {
          serviceToken,
          fromCategory: storedCategory.name,
          toCategory: category.name,
          limit: bankMutationBatchSize
        });
        hasMore = result.hasMore;
      } while (hasMore);
    }
    await convex
      .mutation(api.dashboard.seedTransactionCategories, { serviceToken })
      .catch((error: unknown) => {
        throw new ApiError(503, "Transaction categories could not be initialized", { cause: error });
      });
    stored = await convex.query(api.dashboard.getState, { serviceToken }).catch((error: unknown) => {
      throw new ApiError(503, "Migrated dashboard storage could not be reloaded", { cause: error });
    });
    storedTransactionCategories = stored?.transactionCategories ?? [];
  }

  const storedCategoryRules = stored?.transactionCategoryRules ?? [];
  const storedWiseStatementImports = stored?.wiseStatementImports ?? [];
  const migratedWiseStatementImports = migrateLegacyWiseStatementImports(storedWiseStatementImports);
  const bankSyncStates = new Map(activityMetadata.syncStates.map((syncState) => [syncState.source, syncState]));
  const bankSyncHealth = new Map(activityMetadata.syncHealth.map((health) => [health.source, health]));
  const wiseSyncState = bankSyncStates.get("wise");
  const revolutSyncState = bankSyncStates.get("revolut");
  const slashSyncState = bankSyncStates.get("slash");
  const amexSyncState = bankSyncStates.get("amex");
  const state: PersistedState = {
    revision: stored?.updatedAt ?? null,
    providers: mergeProviderDirectory(stored?.providers ?? []),
    invoices: stored?.invoices ?? [],
    expenses: stored ? stored.expenses : [],
    manualReceivables: stored?.manualReceivables ?? [],
    teams: mergeTeamDirectory(stored?.teams ?? []),
    transactionCategories: storedTransactionCategories,
    transactionCategoryRules: sanitizeStoredTransactionCategoryRules(storedCategoryRules),
    revenuePartners: mergeRevenuePartnerDirectory(stored?.revenuePartners ?? []),
    wiseCardHolderTeamAssignments: mergeWiseCardHolderTeamAssignments(stored?.wiseCardHolderTeamAssignments ?? []),
    pendingBankTransactions: [],
    wiseStatementImports: migratedWiseStatementImports,
    revenueRuns: stored?.revenueRuns ?? [],
    revenueAccruals: stored?.revenueAccruals ?? [],
    paymentAllocations: stored?.paymentAllocations ?? [],
    holdings: stored?.holdings ?? [],
    fxRates: stored?.fxRates ?? [],
    fxTrackedAssets: stored?.fxTrackedAssets ?? [],
    automationRuns: stored?.automationRuns ?? [],
    profitDistributionAdjustments: stored?.profitDistributionAdjustments ?? [],
    profitDistributionCache: undefined,
    meritTaxes: stored?.meritTaxes ?? [],
    aiSettings: stored?.aiSettings ?? { ...defaultAiSettings },
    bankAccounts: activityMetadata.accounts,
    bankSyncStates: {
      ...(wiseSyncState
        ? { wise: { ...wiseSyncState, source: "wise" as const } }
        : {}),
      ...(revolutSyncState
        ? { revolut: { ...revolutSyncState, source: "revolut" as const } }
        : {}),
      ...(slashSyncState
        ? { slash: { ...slashSyncState, source: "slash" as const } }
        : {}),
      ...(amexSyncState
        ? { amex: { ...amexSyncState, source: "amex" as const } }
        : {})
    },
    bankSyncHealth: Object.fromEntries(bankSyncHealth) as Partial<Record<BankTransactionSource, BankSyncHealth>>,
    bankTransactionBaseline: new Map(),
    dirtyBankTransactionIds: new Set()
  };
  if (
    JSON.stringify(state.transactionCategoryRules) !== JSON.stringify(storedCategoryRules)
    || JSON.stringify(migratedWiseStatementImports) !== JSON.stringify(storedWiseStatementImports)
    || stored?.profitDistributionCache !== undefined
  ) {
    await savePersisted(env, state);
  }
  return state;
}

async function saveBankTransactionUpdates(
  env: Env,
  state: PersistedState
): Promise<void> {
  const changed = state.pendingBankTransactions.filter(
    (transaction): transaction is Transaction & { source: BankTransactionSource } =>
      (
        transaction.source === "wise"
        || transaction.source === "revolut"
        || transaction.source === "slash"
        || transaction.source === "amex"
      )
      && state.dirtyBankTransactionIds.has(transaction.id)
      && state.bankTransactionBaseline.get(transaction.id) !== JSON.stringify(transaction)
  );
  for (let index = 0; index < changed.length; index += bankMutationBatchSize) {
    const transactions = changed.slice(index, index + bankMutationBatchSize);
    await getConvexClient(env).mutation(api.banking.saveTransactionUpdates, {
      serviceToken: getConvexServiceToken(env),
      transactions: transactions.map((transaction) => ({
        id: transaction.id,
        category: transaction.category,
        merchantName: transaction.merchantName,
        merchantKey: transaction.merchantKey,
        classificationComplete: transaction.classificationComplete,
        categorySource: transaction.categorySource,
        categoryConfidence: transaction.categoryConfidence,
        categoryReason: transaction.categoryReason,
        matchedProviderId: transaction.matchedProviderId,
        companyMatchSource: transaction.companyMatchSource,
        companyConfidence: transaction.companyConfidence,
        companyMatchReason: transaction.companyMatchReason,
        invoiceMatchSource: transaction.invoiceMatchSource,
        invoiceMatchConfidence: transaction.invoiceMatchConfidence,
        invoiceMatchReason: transaction.invoiceMatchReason,
        confidence: transaction.confidence,
        matchReason: transaction.matchReason
      }))
    });
    await getConvexClient(env).mutation(api.banking.applyTeamAssignmentsBatch, {
      serviceToken: getConvexServiceToken(env),
      assignments: transactions.map((transaction) => ({
        transactionId: transaction.id,
        teamId: transaction.teamId ?? null
      }))
    });
    await getConvexClient(env).mutation(api.banking.applyMatchedInvoiceAssignmentsBatch, {
      serviceToken: getConvexServiceToken(env),
      assignments: transactions.map((transaction) => ({
        transactionId: transaction.id,
        matchedInvoiceId: transaction.matchedInvoiceId ?? null,
        invoiceMatchSource: transaction.invoiceMatchSource,
        invoiceMatchConfidence: transaction.invoiceMatchConfidence,
        invoiceMatchReason: transaction.invoiceMatchReason
      }))
    });
    for (const transaction of transactions) {
      state.bankTransactionBaseline.set(transaction.id, JSON.stringify(transaction));
      state.dirtyBankTransactionIds.delete(transaction.id);
    }
  }
}

async function savePersisted(env: Env, state: PersistedState): Promise<void> {
  const convex = getConvexClient(env);
  const serviceToken = getConvexServiceToken(env);
  const {
    revision,
    transactionCategories: _transactionCategories,
    pendingBankTransactions: _pendingBankTransactions,
    bankAccounts: _bankAccounts,
    bankSyncStates: _bankSyncStates,
    bankSyncHealth: _bankSyncHealth,
    bankTransactionBaseline: _bankTransactionBaseline,
    dirtyBankTransactionIds: _dirtyBankTransactionIds,
    profitDistributionCache: _profitDistributionCache,
    ...dashboardState
  } = state;
  try {
    const result = await convex.mutation(api.dashboard.saveState, {
      ...dashboardState,
      serviceToken,
      expectedUpdatedAt: revision
    });
    state.revision = result.updatedAt;
    await saveBankTransactionUpdates(env, state);
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({
      event: "dashboard_storage_save_failed",
      payloadBytes: new TextEncoder().encode(JSON.stringify(dashboardState)).length,
      cause
    }));
    if (error instanceof ConvexError && isRecord(error.data) && error.data.code === "STATE_CONFLICT") {
      throw new ApiError(409, "Dashboard data changed while this update was saving. Retry the action.", { cause: error });
    }
    throw new ApiError(503, "Dashboard storage is temporarily unavailable", { cause: error });
  }
}

async function getWiseResetPreview(env: Env): Promise<{ transactions: number; imports: number }> {
  return getConvexClient(env).query(api.dashboard.getWiseResetPreview, {
    serviceToken: getConvexServiceToken(env)
  });
}

async function resetWiseImports(
  env: Env,
  confirmation: string | undefined
): Promise<{ deletedTransactions: number; deletedImports: number; updatedAt: string }> {
  if (confirmation !== "CLEAR_WISE_IMPORT_HISTORY") {
    throw new ApiError(400, "Explicit CLEAR_WISE_IMPORT_HISTORY confirmation is required");
  }
  const dashboardResult = await getConvexClient(env).mutation(api.dashboard.resetWiseImports, {
    serviceToken: getConvexServiceToken(env)
  });
  return {
    deletedTransactions: 0,
    deletedImports: dashboardResult.deletedImports,
    updatedAt: dashboardResult.updatedAt
  };
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
  bankIssues: Partial<Record<BankTransactionSource, string>> = {},
  fxRates: FxRate[] = [],
  missingFxAssets: string[] = [],
  staleFxAssets: string[] = []
): IntegrationStatus[] {
  const wiseNeeds = ["WISE_API_TOKEN", "WISE_PROFILE_IDS"].filter((name) => !env[name as keyof Env]);
  const wiseBalanceIssue = wiseNeeds.length === 0 ? bankIssues.wise ?? wiseActivity?.balanceIssue : undefined;

  const revolutNeeds = [
    "REVOLUT_CLIENT_ID",
    "REVOLUT_ISSUER",
    "REVOLUT_PRIVATE_KEY_PEM",
    "REVOLUT_REFRESH_TOKEN"
  ].filter((name) => !env[name as keyof Env]);
  const slashNeeds = ["SLASH_API_KEY", "SLASH_LEGAL_ENTITY_ID", "SLASH_BASE_URL"].filter((name) => !env[name as keyof Env]);
  const amexNeeds = [
    "AMEX_TOKEN_URL",
    "AMEX_API_BASE_URL",
    "AMEX_CLIENT_ID",
    "AMEX_CLIENT_SECRET",
    "AMEX_REFRESH_TOKEN",
    "AMEX_ACCOUNT_IDS",
    "AMEX_ACCOUNT_PATH_TEMPLATE",
    "AMEX_TRANSACTIONS_PATH_TEMPLATE",
    "AMEX_TRANSACTIONS_ITEMS_PATH",
    "AMEX_TRANSACTIONS_NEXT_CURSOR_PATH",
    "AMEX_TRANSACTIONS_CURSOR_PARAM",
    "AMEX_TRANSACTIONS_PAGE_SIZE_PARAM",
    "AMEX_TRANSACTIONS_PAGE_SIZE"
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
      mode: wiseNeeds.length === 0 && !wiseBalanceIssue ? "live" : "partial",
      message:
        wiseBalanceIssue ??
        (wiseNeeds.length === 0
          ? "Balances sync automatically. Transactions and statements are imported manually from Wise CSVs."
          : "Wise rows stay empty until an API token and selected profile IDs are configured."),
      needs: wiseNeeds,
      issue: wiseBalanceIssue
    },
    {
      id: "revolut" as DataSource,
      label: "Revolut",
      configured: revolutNeeds.length === 0,
      mode: revolutNeeds.length === 0 && !bankIssues.revolut ? "live" : "partial",
      message:
        bankIssues.revolut ?? (revolutNeeds.length === 0
          ? "Transactions resume from a saved provider checkpoint into indexed storage."
          : "Revolut rows stay empty until the client ID, issuer, certificate private key, and refresh token are configured."),
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
          ? "Transactions resume from Slash's native cursor into indexed storage."
          : "Slash rows stay empty until the user-scoped API key, legal entity ID, and API base URL are configured."),
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
          ? "Balances and transactions use the configured Amex cursor contract and resume in bounded pages."
          : "Amex rows stay empty until OAuth, account, response-path, and cursor settings are configured."),
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
          ? "Enable at least one owner revenue stream before pulling TUNE/HasOffers revenue."
          : tuneNeeds.length === 0
            ? "Ready to pull owner-attributed partner revenue from TUNE/HasOffers. Invoice creation is a separate explicit action."
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

function wiseImportId(payload: ImportWiseStatementPayload): string {
  return `wise-import-${payload.balanceId}-${payload.currency}-${payload.periodStart}-${payload.periodEnd}`;
}

async function importWiseStatement(env: Env, payload: ImportWiseStatementPayload): Promise<ImportWiseStatementResult> {
  const state = await loadPersisted(env);
  validateWiseStatementImportPayload(payload, state.wiseStatementImports);
  const importedTransactions = normalizeImportedWiseTransactions(payload);
  const stored = await upsertLedgerTransactions(env, "wise", importedTransactions);
  const publicImportedTransactions = importedTransactions.map((transaction) => {
    const { providerLegacyId: _providerLegacyId, ...publicTransaction } = transaction;
    return publicTransaction;
  });
  const summary: ImportWiseStatementSummary = {
    processedTransactions: importedTransactions.length,
    newTransactions: stored.inserted,
    duplicateTransactions: stored.updated
  };
  const importedAt = new Date().toISOString();
  const importRecord: WiseStatementImport = {
    id: wiseImportId(payload),
    balanceId: payload.balanceId,
    wiseEntity: payload.wiseEntity,
    accountName: payload.accountName,
    currency: payload.currency,
    periodStart: payload.periodStart,
    periodEnd: payload.periodEnd,
    fileName: payload.fileName,
    transactionCount: importedTransactions.length,
    importedAt
  };

  state.wiseStatementImports = migrateLegacyWiseStatementImports([
    importRecord,
    ...state.wiseStatementImports.filter((item) => item.id !== importRecord.id)
  ]);
  await savePersisted(env, state);
  await autoCategorizeBankTransactions(env, publicImportedTransactions);
  await rebuildProfitDistributionCache(env);
  return {
    dashboard: await getSnapshot(env),
    summary
  };
}

async function bankSyncState(
  env: Env,
  source: BankTransactionSource,
  connectionKey: string
): Promise<BankSyncState | null> {
  const state = await getConvexClient(env).query(api.banking.getSyncState, {
    serviceToken: getConvexServiceToken(env),
    source,
    connectionKey
  });
  if (!state) return null;
  return { ...state, source };
}

async function bankSyncCheckpoint(
  env: Env,
  source: BankTransactionSource,
  connectionKey: string,
  laneKey: string
): Promise<StoredBankSyncCheckpoint | null> {
  return getConvexClient(env).query(api.bankSync.getCheckpoint, {
    serviceToken: getConvexServiceToken(env),
    source,
    connectionKey,
    laneKey
  });
}

export function incrementalBankDateRange(
  state: BankSyncState | null,
  now = Date.now()
): SlashTransactionDateRange {
  const current = defaultBankDateRange(now);
  const latestCoveredDate = state?.coveredRanges.reduce<string | null>(
    (latest, range) => latest === null || range.toDate > latest ? range.toDate : latest,
    null
  );
  if (!latestCoveredDate) return current;
  const boundedLatestCoveredDate = latestCoveredDate > current.toDate ? current.toDate : latestCoveredDate;
  return {
    fromDate: isoDateShift(boundedLatestCoveredDate, 1 - bankSyncOverlapDays),
    toDate: current.toDate
  };
}

async function persistBankAccountSnapshot(
  env: Env,
  source: BankTransactionSource,
  accounts: AccountBalance[],
  lease: BankSyncLease
): Promise<void> {
  const convex = getConvexClient(env);
  const serviceToken = getConvexServiceToken(env);
  const syncedAt = new Date().toISOString();
  await lease.renew();
  await convex.mutation(api.banking.upsertSyncedActivityBatch, {
    serviceToken,
    source,
    replaceAccounts: true,
    accounts: accounts.map((account) => ({ ...account, source })),
    transactions: [],
    syncedAt,
    connectionKey: lease.connectionKey,
    leaseToken: lease.token,
    leaseFence: lease.fence
  });
}

async function registerDiscoveredBankAccountSet(
  env: Env,
  source: BankTransactionSource,
  laneKey: string,
  currentCheckpoint: StoredBankSyncCheckpoint | null,
  accounts: AccountBalance[],
  lease: BankSyncLease
): Promise<void> {
  const convex = getConvexClient(env);
  const serviceToken = getConvexServiceToken(env);
  const accountIds = [...new Set(accounts.map((account) => account.id))].sort();
  await lease.renew();
  await convex.mutation(api.bankSync.registerAccountSet, {
    serviceToken,
    source,
    connectionKey: lease.connectionKey,
    accountIds,
    leaseToken: lease.token,
    leaseFence: lease.fence
  });
  if (
    currentCheckpoint
    && JSON.stringify([...currentCheckpoint.accountIds].sort()) !== JSON.stringify(accountIds)
  ) {
    await lease.renew();
    await convex.mutation(api.bankSync.clearCheckpoint, {
      serviceToken,
      source,
      connectionKey: lease.connectionKey,
      laneKey,
      expectedCheckpoint: currentCheckpoint.checkpoint,
      leaseToken: lease.token,
      leaseFence: lease.fence
    });
    throw new Error(`${source} account set changed; the frozen sync lane will restart`);
  }
}

async function persistCheckpointedBankSync(
  env: Env,
  source: BankTransactionSource,
  range: SlashTransactionDateRange,
  laneKey: string,
  currentCheckpoint: string | null,
  checkpointAccountIds: readonly string[] | null,
  lease: BankSyncLease,
  result: {
    accounts: AccountBalance[];
    nextCheckpoint: string | null;
    complete: boolean;
    pagesFetched: number;
    providerTransactionsRead: number;
  }
): Promise<void> {
  const convex = getConvexClient(env);
  const serviceToken = getConvexServiceToken(env);
  const accountIds = [...new Set(result.accounts.map((account) => account.id))].sort();
  if (
    checkpointAccountIds
    && JSON.stringify([...checkpointAccountIds].sort()) !== JSON.stringify(accountIds)
  ) {
    await lease.renew();
    await convex.mutation(api.bankSync.clearCheckpoint, {
      serviceToken,
      source,
      connectionKey: lease.connectionKey,
      laneKey,
      expectedCheckpoint: currentCheckpoint,
      leaseToken: lease.token,
      leaseFence: lease.fence
    });
    throw new Error(`${source} account set changed during a paginated sync; the frozen range will restart`);
  }
  await persistBankAccountSnapshot(env, source, result.accounts, lease);
  if (!result.complete) {
    if (!result.nextCheckpoint) throw new Error(`${source} sync stopped without a resume checkpoint`);
    await lease.renew();
    await convex.mutation(api.bankSync.saveCheckpoint, {
      serviceToken,
      source,
      connectionKey: lease.connectionKey,
      laneKey,
      accountIds,
      fromDate: range.fromDate,
      toDate: range.toDate,
      checkpoint: result.nextCheckpoint,
      expectedCheckpoint: currentCheckpoint,
      leaseToken: lease.token,
      leaseFence: lease.fence
    });
    console.log(JSON.stringify({
      event: "bank_sync_checkpoint_saved",
      source,
      pagesFetched: result.pagesFetched,
      providerTransactionsRead: result.providerTransactionsRead
    }));
    return;
  }

  const syncedAt = new Date().toISOString();
  await lease.renew();
  await convex.mutation(api.banking.completeSync, {
    serviceToken,
    source,
    fromDate: range.fromDate,
    toDate: range.toDate,
    syncedAt,
    accountIds,
    connectionKey: lease.connectionKey,
    leaseToken: lease.token,
    leaseFence: lease.fence
  });
  await lease.renew();
  await convex.mutation(api.bankSync.clearCheckpoint, {
    serviceToken,
    source,
    connectionKey: lease.connectionKey,
    laneKey,
    expectedCheckpoint: currentCheckpoint,
    leaseToken: lease.token,
    leaseFence: lease.fence
  });
  console.log(JSON.stringify({
    event: "bank_sync_completed",
    source,
    fromDate: range.fromDate,
    toDate: range.toDate,
    pagesFetched: result.pagesFetched,
    providerTransactionsRead: result.providerTransactionsRead
  }));
}

async function withBankSyncLease(
  env: Env,
  source: BankTransactionSource,
  connectionKey: string,
  run: (lease: BankSyncLease) => Promise<void | boolean>
): Promise<boolean> {
  const convex = getConvexClient(env);
  const serviceToken = getConvexServiceToken(env);
  const token = crypto.randomUUID();
  const claim = await convex.mutation(api.bankSync.claimLease, {
    serviceToken,
    source,
    connectionKey,
    token,
    leaseMs: 10 * 60_000
  });
  if (!claim.claimed || claim.fence === null) {
    console.log(JSON.stringify({ event: "bank_sync_skipped", source, reason: "active_lease" }));
    return false;
  }
  const fence = claim.fence;
  const lease: BankSyncLease = {
    token,
    fence,
    connectionKey,
    renew: async () => {
      await convex.mutation(api.bankSync.renewLease, {
        serviceToken,
        source,
        connectionKey,
        token,
        fence,
        leaseMs: 10 * 60_000
      });
    }
  };
  try {
    await convex.mutation(api.bankSync.recordSyncStarted, {
      serviceToken,
      source,
      connectionKey,
      leaseToken: token,
      leaseFence: fence
    });
    try {
      const completedRequestedWork = await run(lease);
      await convex.mutation(api.bankSync.recordSyncFinished, {
        serviceToken,
        source,
        connectionKey,
        leaseToken: token,
        leaseFence: fence,
        success: true
      });
      return completedRequestedWork !== false;
    } catch (error) {
      try {
        await convex.mutation(api.bankSync.recordSyncFinished, {
          serviceToken,
          source,
          connectionKey,
          leaseToken: token,
          leaseFence: fence,
          success: false,
          error: (error instanceof Error ? error.message : String(error)).slice(0, 2_048)
        });
      } catch (healthError) {
        console.error(JSON.stringify({
          event: "bank_sync_health_write_failed",
          source,
          error: healthError instanceof Error ? healthError.message : String(healthError)
        }));
      }
      throw error;
    }
  } finally {
    try {
      await convex.mutation(api.bankSync.releaseLease, {
        serviceToken,
        source,
        connectionKey,
        token,
        fence
      });
    } catch (error) {
      console.error(JSON.stringify({
        event: "bank_sync_lease_release_failed",
        source,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  }
}

async function syncRevolutActivity(
  env: Env,
  requestedRange?: SlashTransactionDateRange,
  laneKey = "live",
  pageBudget = 10
): Promise<boolean> {
  const connectionKey = await requireBankConnectionKey(env, "revolut");
  return withBankSyncLease(env, "revolut", connectionKey, async (lease) => {
    const storedCheckpoint = await bankSyncCheckpoint(env, "revolut", connectionKey, laneKey);
    if (
      storedCheckpoint
      && requestedRange
      && (storedCheckpoint.fromDate !== requestedRange.fromDate || storedCheckpoint.toDate !== requestedRange.toDate)
    ) return false;
    const range = storedCheckpoint
      ?? requestedRange
      ?? incrementalBankDateRange(await bankSyncState(env, "revolut", connectionKey));
    const activity = await fetchRevolutActivityBatch({
      environment: env.REVOLUT_ENVIRONMENT,
      clientId: env.REVOLUT_CLIENT_ID,
      issuer: env.REVOLUT_ISSUER,
      privateKeyPem: env.REVOLUT_PRIVATE_KEY_PEM,
      refreshToken: env.REVOLUT_REFRESH_TOKEN,
      ...(storedCheckpoint ? { checkpoint: storedCheckpoint.checkpoint } : { dateRange: range }),
      pageBudget,
      collectTransactions: false,
      onAccountsDiscovered: async (accounts) => {
        await registerDiscoveredBankAccountSet(
          env,
          "revolut",
          laneKey,
          storedCheckpoint,
          accounts,
          lease
        );
      },
      onTransactionPage: async (transactions) => {
        await upsertSyncedLedgerTransactions(env, "revolut", transactions, lease);
      }
    });
    await persistCheckpointedBankSync(
      env,
      "revolut",
      range,
      laneKey,
      storedCheckpoint?.checkpoint ?? null,
      storedCheckpoint?.accountIds ?? null,
      lease,
      activity
    );
    return activity.complete;
  });
}

async function syncSlashActivity(
  env: Env,
  requestedRange?: SlashTransactionDateRange,
  laneKey = "live",
  pageBudget = 10
): Promise<boolean> {
  const connectionKey = await requireBankConnectionKey(env, "slash");
  return withBankSyncLease(env, "slash", connectionKey, async (lease) => {
    const storedCheckpoint = await bankSyncCheckpoint(env, "slash", connectionKey, laneKey);
    if (
      storedCheckpoint
      && requestedRange
      && (storedCheckpoint.fromDate !== requestedRange.fromDate || storedCheckpoint.toDate !== requestedRange.toDate)
    ) return false;
    const range = storedCheckpoint
      ?? requestedRange
      ?? incrementalBankDateRange(await bankSyncState(env, "slash", connectionKey));
    const activity = await fetchSlashActivityBatch({
      baseUrl: env.SLASH_BASE_URL,
      apiKey: env.SLASH_API_KEY,
      legalEntityId: env.SLASH_LEGAL_ENTITY_ID,
      ...(storedCheckpoint ? { checkpoint: storedCheckpoint.checkpoint } : { dateRange: range }),
      pageBudget,
      collectTransactions: false,
      onAccountsDiscovered: async (accounts) => {
        await registerDiscoveredBankAccountSet(
          env,
          "slash",
          laneKey,
          storedCheckpoint,
          accounts,
          lease
        );
      },
      onTransactionPage: async (transactions) => {
        await upsertSyncedLedgerTransactions(env, "slash", transactions, lease);
      }
    });
    await persistCheckpointedBankSync(
      env,
      "slash",
      range,
      laneKey,
      storedCheckpoint?.checkpoint ?? null,
      storedCheckpoint?.accountIds ?? null,
      lease,
      activity
    );
    return activity.complete;
  });
}

async function syncWiseActivity(env: Env): Promise<boolean> {
  const connectionKey = await requireBankConnectionKey(env, "wise");
  return withBankSyncLease(env, "wise", connectionKey, async (lease) => {
    const activity = await fetchWiseBalancesForAccessibleBusinesses({
      baseUrl: wiseBaseUrl(env),
      token: env.WISE_API_TOKEN,
      profileIds: parseWiseProfileIds(env.WISE_PROFILE_IDS)
    });
    await persistBankAccountSnapshot(
      env,
      "wise",
      activity.accounts,
      lease
    );
  });
}

async function syncAmexActivity(
  env: Env,
  requestedRange?: SlashTransactionDateRange,
  laneKey = "live",
  pageBudget = 10
): Promise<boolean> {
  const connectionKey = await requireBankConnectionKey(env, "amex");
  return withBankSyncLease(env, "amex", connectionKey, async (lease) => {
    const storedCheckpoint = await bankSyncCheckpoint(env, "amex", connectionKey, laneKey);
    if (
      storedCheckpoint
      && requestedRange
      && (storedCheckpoint.fromDate !== requestedRange.fromDate || storedCheckpoint.toDate !== requestedRange.toDate)
    ) return false;
    const range = storedCheckpoint
      ?? requestedRange
      ?? incrementalBankDateRange(await bankSyncState(env, "amex", connectionKey));
    let activity: Awaited<ReturnType<typeof fetchAmexActivityBatch>>;
    try {
      activity = await fetchAmexActivityBatch(env, {
        ...(storedCheckpoint ? { checkpoint: storedCheckpoint.checkpoint } : { dateRange: range }),
        pageBudget,
        onAccountsDiscovered: async (accounts) => {
          await registerDiscoveredBankAccountSet(
            env,
            "amex",
            laneKey,
            storedCheckpoint,
            accounts,
            lease
          );
        },
        onTransactionPage: async (transactions) => {
          await upsertSyncedLedgerTransactions(env, "amex", transactions, lease);
        }
      });
    } catch (error) {
      if (storedCheckpoint && /account configuration changed/i.test(
        error instanceof Error ? error.message : String(error)
      )) {
        await lease.renew();
        await getConvexClient(env).mutation(api.bankSync.clearCheckpoint, {
          serviceToken: getConvexServiceToken(env),
          source: "amex",
          connectionKey,
          laneKey,
          expectedCheckpoint: storedCheckpoint.checkpoint,
          leaseToken: lease.token,
          leaseFence: lease.fence
        });
      }
      throw error;
    }
    await persistCheckpointedBankSync(
      env,
      "amex",
      range,
      laneKey,
      storedCheckpoint?.checkpoint ?? null,
      storedCheckpoint?.accountIds ?? null,
      lease,
      activity
    );
    return activity.complete;
  });
}

async function syncLatestBankActivity(
  env: Env,
  options: {
    sources?: ReadonlySet<BankTransactionSource>;
    dateRange?: SlashTransactionDateRange;
  } = {}
): Promise<void> {
  const jobs: Array<{ source: BankTransactionSource; run: Promise<boolean> }> = [];
  const includes = (source: BankTransactionSource) => !options.sources || options.sources.has(source);
  const laneKey = options.dateRange
    ? `range:${options.dateRange.fromDate}:${options.dateRange.toDate}`
    : "live";
  if (!options.dateRange && includes("wise") && env.WISE_API_TOKEN?.trim() && env.WISE_PROFILE_IDS?.trim()) {
    jobs.push({ source: "wise", run: syncWiseActivity(env) });
  }
  if (
    includes("revolut")
    &&
    env.REVOLUT_CLIENT_ID?.trim()
    && env.REVOLUT_ISSUER?.trim()
    && env.REVOLUT_PRIVATE_KEY_PEM?.trim()
    && env.REVOLUT_REFRESH_TOKEN?.trim()
  ) {
    jobs.push({ source: "revolut", run: syncRevolutActivity(env, options.dateRange, laneKey) });
  }
  if (
    includes("slash")
    && env.SLASH_API_KEY?.trim()
    && env.SLASH_LEGAL_ENTITY_ID?.trim()
    && env.SLASH_BASE_URL?.trim()
  ) {
    jobs.push({ source: "slash", run: syncSlashActivity(env, options.dateRange, laneKey) });
  }
  if (
    includes("amex")
    &&
    env.AMEX_TOKEN_URL?.trim()
    && env.AMEX_API_BASE_URL?.trim()
    && env.AMEX_CLIENT_ID?.trim()
    && env.AMEX_CLIENT_SECRET?.trim()
    && env.AMEX_REFRESH_TOKEN?.trim()
    && env.AMEX_ACCOUNT_IDS?.trim()
    && env.AMEX_ACCOUNT_PATH_TEMPLATE?.trim()
    && env.AMEX_TRANSACTIONS_PATH_TEMPLATE?.trim()
    && env.AMEX_TRANSACTIONS_ITEMS_PATH?.trim()
    && env.AMEX_TRANSACTIONS_NEXT_CURSOR_PATH?.trim()
    && env.AMEX_TRANSACTIONS_CURSOR_PARAM?.trim()
    && env.AMEX_TRANSACTIONS_PAGE_SIZE_PARAM?.trim()
    && env.AMEX_TRANSACTIONS_PAGE_SIZE?.trim()
  ) {
    jobs.push({ source: "amex", run: syncAmexActivity(env, options.dateRange, laneKey) });
  }
  const results = await Promise.allSettled(jobs.map((job) => job.run));
  const failures = results.filter((result) => result.status === "rejected");
  for (const [index, result] of results.entries()) {
    if (result.status !== "rejected") continue;
    console.error(JSON.stringify({
      event: "bank_sync_failed",
      source: jobs[index].source,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason)
    }));
  }
  if (failures.length > 0) throw failures[0].reason;
}

async function syncBankSourceRange(
  env: Env,
  source: BankTransactionSource,
  range: SlashTransactionDateRange,
  laneKey: string
): Promise<boolean> {
  if (source === "wise") throw new Error("Wise transaction history is imported manually from CSV");
  if (source === "revolut") return syncRevolutActivity(env, range, laneKey, 1);
  if (source === "slash") return syncSlashActivity(env, range, laneKey, 1);
  return syncAmexActivity(env, range, laneKey, 1);
}

async function enqueueBankBackfill(
  env: Env,
  source: BankTransactionSource,
  range: SlashTransactionDateRange
): Promise<BankBackfillJob> {
  if (source === "wise") {
    throw new ApiError(409, "Wise transaction history is imported manually from CSV");
  }
  if (!bankSourceConfigured(env, source)) {
    throw new ApiError(409, `${source} is not configured for transaction sync`);
  }
  const connectionKey = await requireBankConnectionKey(env, source);
  return getConvexClient(env).mutation(api.bankSync.enqueueBackfill, {
    serviceToken: getConvexServiceToken(env),
    source,
    connectionKey,
    fromDate: range.fromDate,
    toDate: range.toDate
  });
}

async function enqueueSlashCardMetadataRepair(env: Env): Promise<{
  range: SlashTransactionDateRange;
  job: BankBackfillJob;
} | null> {
  if (!bankSourceConfigured(env, "slash")) return null;
  const connectionKey = await requireBankConnectionKey(env, "slash");
  const range = await getConvexClient(env).query(api.banking.getSlashCardMetadataRepairRange, {
    serviceToken: getConvexServiceToken(env),
    connectionKey
  });
  if (!range) return null;
  return {
    range,
    job: await enqueueBankBackfill(env, "slash", range)
  };
}

async function runBankBackfillJob(env: Env, key: string): Promise<BankBackfillJob | null> {
  const convex = getConvexClient(env);
  const serviceToken = getConvexServiceToken(env);
  const stored = await convex.query(api.bankSync.getBackfill, { serviceToken, key });
  if (!stored || stored.status === "complete" || stored.status === "failed") return stored;
  const attemptToken = crypto.randomUUID();
  const attempt = await convex.mutation(api.bankSync.startBackfillAttempt, {
    serviceToken,
    key,
    connectionKey: stored.connectionKey,
    expectedUpdatedAt: stored.updatedAt,
    attemptToken
  });
  if (!attempt.started) return attempt.job;
  if (stored.source === "wise") {
    return convex.mutation(api.bankSync.finishBackfillAttempt, {
      serviceToken,
      key,
      connectionKey: stored.connectionKey,
      attemptToken,
      complete: true
    });
  }
  const currentConnectionKey = await bankConnectionKey(env, stored.source);
  if (!bankSourceConfigured(env, stored.source) || currentConnectionKey !== stored.connectionKey) {
    const message = `${stored.source} connection changed while its history job was queued`;
    return convex.mutation(api.bankSync.finishBackfillAttempt, {
      serviceToken,
      key,
      connectionKey: stored.connectionKey,
      attemptToken,
      complete: false,
      error: message,
      terminal: true
    });
  }
  try {
    const ran = await syncBankSourceRange(env, stored.source, {
      fromDate: stored.fromDate,
      toDate: stored.toDate
    }, stored.key);
    if (!ran) {
      return convex.mutation(api.bankSync.finishBackfillAttempt, {
        serviceToken,
        key,
        connectionKey: stored.connectionKey,
        attemptToken,
        complete: false
      });
    }
    const coverage = await convex.query(api.banking.getActivityCoverage, {
      serviceToken,
      connections: [{ source: stored.source, connectionKey: stored.connectionKey }],
      source: stored.source,
      fromDate: stored.fromDate,
      toDate: stored.toDate
    });
    const complete = coverage.length === 1 && coverage[0].missingRanges.length === 0;
    return convex.mutation(api.bankSync.finishBackfillAttempt, {
      serviceToken,
      key,
      connectionKey: stored.connectionKey,
      attemptToken,
      complete
    });
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 2_048);
    await convex.mutation(api.bankSync.finishBackfillAttempt, {
      serviceToken,
      key,
      connectionKey: stored.connectionKey,
      attemptToken,
      complete: false,
      error: message
    });
    throw error;
  }
}

async function processPendingBankBackfills(env: Env): Promise<void> {
  const jobs = await getConvexClient(env).query(api.bankSync.getPendingBackfills, {
    serviceToken: getConvexServiceToken(env),
    limit: 8
  });
  const sourceJobs = new Map<BankTransactionSource, BankBackfillJob>();
  for (const job of jobs) {
    if (!sourceJobs.has(job.source)) sourceJobs.set(job.source, job);
  }
  const results = await Promise.allSettled(
    [...sourceJobs.values()].map((job) => runBankBackfillJob(env, job.key))
  );
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
}

async function reconcilePendingBankTransactions(env: Env): Promise<void> {
  const connections = await bankConnectionDirectory(env);
  const pending = await getConvexClient(env).mutation(api.banking.getPendingReconciliationDates, {
    serviceToken: getConvexServiceToken(env),
    connections
  });
  await Promise.all(pending.flatMap((item) => item.dates.map((date) =>
    enqueueBankBackfill(env, item.source, { fromDate: date, toDate: date })
  )));
  await processPendingBankBackfills(env);
}

async function syncMeritActivity(env: Env): Promise<void> {
  if (!env.MERIT_API_ID || !env.MERIT_API_KEY) return;
  const state = await loadPersisted(env);
  const results = await Promise.allSettled([
    fetchMeritInvoices(env, state.invoices),
    fetchMeritTaxes(env),
    fetchMeritCustomers(env),
    fetchMeritVendors(env)
  ]);
  const [invoiceResult, taxResult, customerResult, vendorResult] = results;
  if (customerResult.status === "fulfilled") {
    state.providers = reconcileMeritProviders(state.providers, customerResult.value, "customer");
  }
  if (vendorResult.status === "fulfilled") {
    state.providers = reconcileMeritProviders(state.providers, vendorResult.value, "vendor");
  }
  state.providers = mergeProviderDirectory(state.providers);
  if (invoiceResult.status === "fulfilled") {
    const liveInvoices = linkMeritInvoiceProviders(invoiceResult.value, state.providers);
    state.invoices = assignMeritStyleDraftNumbers(
      mergeInvoices(liveInvoices, state.invoices, true),
      liveInvoices
    );
  }
  if (taxResult.status === "fulfilled") state.meritTaxes = taxResult.value;
  await savePersisted(env, state);

  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") {
    throw new Error(meritConnectionIssue(failure.reason));
  }
}

export function missingBankActivityRanges(
  state: BankSyncState | null,
  requested: SlashTransactionDateRange
): SlashTransactionDateRange[] {
  if (!state) {
    return [{ ...requested }];
  }
  let missing = [{ ...requested }];
  for (const covered of state.coveredRanges) {
    missing = missing.flatMap((range) => {
      if (covered.toDate < range.fromDate || covered.fromDate > range.toDate) return [range];
      const parts: SlashTransactionDateRange[] = [];
      if (covered.fromDate > range.fromDate) {
        parts.push({
          fromDate: range.fromDate,
          toDate: isoDateShift(covered.fromDate, -1)
        });
      }
      if (covered.toDate < range.toDate) {
        parts.push({
          fromDate: isoDateShift(covered.toDate, 1),
          toDate: range.toDate
        });
      }
      return parts;
    });
  }
  return missing;
}

async function getSnapshot(
  env: Env,
  options: { refreshFxRates?: boolean } = {}
): Promise<DashboardSnapshot> {
  const bankIssues: Partial<Record<BankTransactionSource, string>> = {};
  const state = await loadPersisted(env);
  const now = Date.now();
  for (const source of bankSources) {
    const health = state.bankSyncHealth[source];
    if (!health) continue;
    if (health.status === "failed" && health.lastError) {
      bankIssues[source] = `Latest sync failed: ${health.lastError}`;
      continue;
    }
    const lastSuccess = health.lastSuccessAt ? Date.parse(health.lastSuccessAt) : Number.NaN;
    if (health.status === "running" && now - Date.parse(health.lastAttemptAt) > 20 * 60_000) {
      bankIssues[source] = "Bank sync has been running longer than expected.";
    } else if (Number.isFinite(lastSuccess) && now - lastSuccess > 30 * 60_000) {
      bankIssues[source] = `Bank data has not synced successfully since ${health.lastSuccessAt}.`;
    }
  }
  if (
    env.WISE_API_TOKEN
    && env.WISE_PROFILE_IDS
    && !hasSavedWiseBalanceAccounts(state.bankAccounts)
  ) {
    bankIssues.wise ??= "No saved Wise balances yet. The next automatic refresh will populate them.";
  }
  if (
    env.REVOLUT_CLIENT_ID
    && env.REVOLUT_ISSUER
    && env.REVOLUT_PRIVATE_KEY_PEM
    && env.REVOLUT_REFRESH_TOKEN
    && !state.bankSyncStates.revolut
  ) {
    bankIssues.revolut ??= "No saved Revolut activity yet. The next automatic refresh will create the initial 45-day cache.";
  }
  if (
    env.SLASH_API_KEY
    && env.SLASH_LEGAL_ENTITY_ID
    && env.SLASH_BASE_URL
    && !state.bankSyncStates.slash
  ) {
    bankIssues.slash ??= "No saved Slash activity yet. The next automatic refresh will create the initial 45-day cache.";
  }
  if (
    env.AMEX_CLIENT_ID
    && env.AMEX_CLIENT_SECRET
    && env.AMEX_REFRESH_TOKEN
    && env.AMEX_ACCOUNT_IDS
    && !state.bankSyncStates.amex
  ) {
    bankIssues.amex ??= "No saved Amex activity yet. The next automatic refresh will create the initial 45-day cache.";
  }
  const wise: WiseActivityResult = {
    ...emptyWiseActivity(),
    accounts: state.bankAccounts.filter((account) => account.source === "wise")
  };
  const reviewBacklog = await getConvexClient(env).query(api.banking.getClassificationBacklog, {
    serviceToken: getConvexServiceToken(env),
    limit: 5
  });
  const meritIssue = undefined;
  state.providers = mergeProviderDirectory(state.providers);
  const accounts = state.bankAccounts;
  const trackedAssetsBefore = state.fxTrackedAssets.join("|");
  state.fxTrackedAssets = trackedFxAssets(state, accounts, state.invoices);
  const fxAssetInventoryChanged = state.fxTrackedAssets.join("|") !== trackedAssetsBefore;
  let fxRatesRefreshed = false;
  if (options.refreshFxRates) {
    await updateCurrentFxRates(env, state, accounts, state.invoices);
    fxRatesRefreshed = true;
  }
  const invoicesBeforeReconciliation = assignMeritStyleDraftNumbers(state.invoices);
  const liveInvoiceIds = new Set(invoicesBeforeReconciliation.map((invoice) => invoice.id));
  const paymentAllocationsBeforeSync = state.paymentAllocations;
  state.paymentAllocations = state.paymentAllocations.filter((allocation) => liveInvoiceIds.has(allocation.invoiceId));
  const paymentAllocationsChanged = state.paymentAllocations.length !== paymentAllocationsBeforeSync.length;
  const invoiceStateChanged = JSON.stringify(invoicesBeforeReconciliation) !== JSON.stringify(state.invoices);
  if (
    invoiceStateChanged ||
    paymentAllocationsChanged ||
    fxRatesRefreshed ||
    fxAssetInventoryChanged
  ) {
    state.invoices = invoicesBeforeReconciliation;
    await savePersisted(env, state);
  }
  const invoices = invoicesBeforeReconciliation;
  const transactionReviewPreview = enrichTransactions(
    reviewBacklog.transactions,
    state.providers,
    state.transactionCategoryRules
  );
  const receivables = [...openInvoiceReceivables(invoices, state.paymentAllocations), ...state.manualReceivables];
  const payables = expensePayables(state.expenses);
  const approximateUsdTotals = calculateApproximateUsdTotals(accounts, state.holdings, state.fxRates);
  const profitDistribution = (await profitDistributionFromFacts(
    env,
    state.profitDistributionAdjustments
  )).snapshot;

  return {
    asOf: new Date().toISOString(),
    accounts,
    receivables,
    openBalances: [],
    payables,
    investments: [],
    providers: state.providers,
    teams: state.teams,
    revenuePartners: state.revenuePartners,
    revenueRuns: state.revenueRuns,
    revenueAccruals: state.revenueAccruals,
    revenueMetrics: calculateRevenueMetrics(state.revenuePartners, state.revenueRuns),
    aiSettings: publicAiSettings(runtimeAiSettings(env, state.aiSettings)),
    transactionReviewPreview,
    invoices,
    expenses: state.expenses,
    paymentAllocations: state.paymentAllocations,
    invoicePredictions: calculateInvoicePredictions(invoices, state.paymentAllocations),
    holdings: state.holdings,
    fxRates: state.fxRates,
    approximateUsdTotals,
    automationRuns: state.automationRuns,
    meritTaxes: state.meritTaxes,
    transactionCategories: state.transactionCategories,
    transactionCategoryRules: state.transactionCategoryRules,
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
    metrics: calculateMetrics(accounts, receivables, [], payables, []),
    profitDistribution,
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
      transactions: state.pendingBankTransactions,
      wiseStatementTransactions: state.pendingBankTransactions
    },
    providerId
  );
  if (!deletion) throw new ApiError(404, "Company not found");

  let hasMore = false;
  do {
    const result = await getConvexClient(env).mutation(api.banking.clearProviderReferencesBatch, {
      serviceToken: getConvexServiceToken(env),
      providerId,
      limit: bankMutationBatchSize
    });
    hasMore = result.hasMore;
  } while (hasMore);

  state.providers = deletion.providers;
  state.invoices = deletion.invoices;
  state.revenuePartners = deletion.revenuePartners;
  state.revenueRuns = deletion.revenueRuns;
  state.expenses = state.expenses.map((expense) => {
    if (expense.providerId !== providerId) return expense;
    const { providerId: _providerId, ...withoutProvider } = expense;
    return withoutProvider;
  });
  state.pendingBankTransactions = deletion.wiseStatementTransactions;
  await savePersisted(env, state);
  return deletion.deletedProvider;
}

async function updateRevenuePartner(env: Env, partnerId: string, payload: UpdateRevenuePartnerPayload): Promise<RevenuePartner> {
  if (
    !payload.name?.trim() ||
    !payload.providerId?.trim() ||
    !payload.revenueCategory?.trim() ||
    (Boolean(payload.teamId) && !payload.affiliateId?.trim()) ||
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
  if (!selectedProvider || selectedProvider.type !== "client" || !selectedProvider.meritCustomerId) {
    throw new Error("Revenue rules require a customer imported from Merit");
  }
  if (payload.teamId && !state.teams.some((team) => team.id === payload.teamId)) {
    throw new Error("Revenue partner owner not found");
  }
  const revenueCategory = transactionBusinessCategory(payload.revenueCategory);
  if (!isTransactionCategoryForDirection(revenueCategory, "in", state.transactionCategories)) {
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
      affiliateId: payload.affiliateId?.trim() ?? "",
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
  const rebound = bindRevenuePartnerCompany(updated, selectedProvider, state.revenueRuns, state.invoices);
  state.revenueRuns = rebound.runs;
  state.invoices = rebound.invoices;
  await savePersisted(env, state);
  return updated;
}

async function createRevenuePartner(env: Env, payload: CreateRevenuePartnerPayload): Promise<RevenuePartner> {
  if (
    !payload.name?.trim() ||
    !payload.providerId?.trim() ||
    !payload.revenueCategory?.trim() ||
    (Boolean(payload.teamId) && !payload.affiliateId?.trim()) ||
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
    throw new ApiError(400, "name, Merit customer, revenue category, API environment names, cadence, and billing timezone are required; owner-specific rules also require an affiliate ID");
  }
  const state = await loadPersisted(env);
  const provider = state.providers.find((item) => item.id === payload.providerId);
  if (!provider || provider.type !== "client" || !provider.meritCustomerId) {
    throw new ApiError(400, "Revenue rules require a customer imported from Merit");
  }
  if (payload.teamId && !state.teams.some((team) => team.id === payload.teamId)) {
    throw new ApiError(400, "Revenue rule owner not found");
  }
  const revenueCategory = transactionBusinessCategory(payload.revenueCategory);
  if (!isTransactionCategoryForDirection(revenueCategory, "in", state.transactionCategories)) {
    throw new ApiError(400, `Category "${revenueCategory}" is not valid for money in`);
  }
  const partner: RevenuePartner = {
    id: revenueRuleId(payload.name, cleanOptional(payload.teamId)),
    providerId: provider.id,
    teamId: cleanOptional(payload.teamId),
    name: payload.name.trim(),
    revenueCategory,
    source: "tune",
    affiliateId: payload.affiliateId?.trim() ?? "",
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
  if (state.revenuePartners.some((item) => item.id === partner.id)) {
    throw new ApiError(409, "A revenue rule already exists for this company and owner");
  }
  state.revenuePartners = mergeRevenuePartnerDirectory([...state.revenuePartners, partner]);
  const rebound = bindRevenuePartnerCompany(partner, provider, state.revenueRuns, state.invoices);
  state.revenueRuns = rebound.runs;
  state.invoices = rebound.invoices;
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
  const model = await requireOpenRouterZdrModel(payload.model);

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

function transactionCategoryNeedsReview(
  transaction: Transaction,
  categories: readonly Pick<TransactionCategory, "name" | "direction">[]
): boolean {
  return transactionNeedsCategoryReview(transaction, categories);
}

function transactionNeedsCategorization(
  transaction: Transaction,
  categories: readonly Pick<TransactionCategory, "name" | "direction">[]
): boolean {
  return transaction.status !== "voided"
    && (
      transaction.classificationComplete !== true
      || transactionCategoryNeedsReview(transaction, categories)
      || !transaction.merchantName?.trim()
    );
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

  state.pendingBankTransactions = state.pendingBankTransactions.map((transaction) => {
    if (targetIds && !targetIds.has(transaction.id)) return transaction;
    if (!transactionNeedsCategorization(transaction, state.transactionCategories)) return transaction;
    reviewed += 1;
    const categorized = finalizeDeterministicCategorization(
      transaction,
      state.providers,
      state.transactionCategoryRules,
      state.transactionCategories
    );
    if (
      (transaction.source === "wise"
        || transaction.source === "revolut"
        || transaction.source === "slash"
        || transaction.source === "amex")
      && JSON.stringify(categorized) !== JSON.stringify(transaction)
    ) {
      state.dirtyBankTransactionIds.add(transaction.id);
    }
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
  const remaining = state.pendingBankTransactions.filter((transaction) => {
    if (targetIds && !targetIds.has(transaction.id)) return false;
    return transactionNeedsCategorization(transaction, state.transactionCategories);
  });

  if (shouldUseAi && remaining.length > 0) {
    const transactionsByGroup = new Map<string, Transaction[]>();
    for (const transaction of remaining) {
      const key = transactionAiGroupKey(transaction);
      transactionsByGroup.set(key, [...(transactionsByGroup.get(key) ?? []), transaction]);
    }
    const aiTargetsByRepresentativeId = new Map<string, Transaction[]>();
    const representatives = [...transactionsByGroup.values()].map((group) => {
      const representative = group[0];
      aiTargetsByRepresentativeId.set(representative.id, group);
      return representative;
    });
    const aiResults = await runOpenRouterTransactionCategorization(
      activeAiSettings,
      representatives,
      aiProviderDirectoryForTransactions(remaining, state.providers),
      env.PUBLIC_APP_URL,
      state.transactionCategories
    );
    for (const aiResult of aiResults) {
      for (const target of aiTargetsByRepresentativeId.get(aiResult.transactionId) ?? []) {
        const transaction = findPersistedTransaction(state, target.id);
        if (!transaction) continue;
        const provider = aiResult.providerId ? state.providers.find((item) => item.id === aiResult.providerId) : undefined;
        const matchedProvider =
          aiResult.confidence >= 0.72
          && provider
          && providerMatchesTransactionDirection(transaction, provider)
            ? provider
            : undefined;
        const keepEstablishedCategory =
          (transaction.categorySource === "manual" || transaction.categorySource === "rule")
          && isRequiredTransactionCategory(transaction.category, transaction.direction, state.transactionCategories);
        const updated: Transaction = {
          ...transaction,
          matchedProviderId: matchedProvider?.id ?? transaction.matchedProviderId,
          category: keepEstablishedCategory ? transaction.category : aiResult.category,
          merchantName: aiResult.merchantName,
          merchantKey: transactionMerchantKey({ merchantName: aiResult.merchantName }),
          classificationComplete: true,
          ...(keepEstablishedCategory
            ? {}
            : {
                categorySource: "ai" as const,
                categoryConfidence: aiResult.confidence,
                categoryReason: aiResult.reason
              }),
          ...(matchedProvider
            ? {
                companyMatchSource: "ai" as const,
                companyConfidence: aiResult.confidence,
                companyMatchReason: aiResult.reason,
                confidence: aiResult.confidence,
                matchReason: `AI: ${aiResult.reason}`
              }
            : {})
        };
        upsertPersistedTransaction(state, updated);
        if (updated.matchedProviderId) {
          aiMatches += 1;
        } else {
          categorizedOnly += 1;
        }
      }
    }
  }

  return { semanticMatches, aiMatches, categorizedOnly, reviewed };
}

async function autoCategorizeBankTransactions(
  env: Env,
  transactions: Transaction[],
  limit = bankClassificationBatchSize,
  useAi = true
): Promise<Omit<AutoCategorizeTransactionsResult, "dashboard"> | undefined> {
  const state = await loadPersisted(env);
  const candidates = transactions
    .filter((transaction) => transactionNeedsCategorization(transaction, state.transactionCategories))
    .slice(0, limit);
  if (candidates.length === 0) return undefined;
  for (const transaction of candidates) {
    const existing = findPersistedTransaction(state, transaction.id);
    state.pendingBankTransactions = existing
      ? state.pendingBankTransactions.map((item) => item.id === transaction.id ? transaction : item)
      : [transaction, ...state.pendingBankTransactions];
    state.bankTransactionBaseline.set(transaction.id, JSON.stringify(transaction));
  }
  const summary = await autoCategorizeState(env, state, {
    transactionIds: candidates.map((transaction) => transaction.id),
    useAi
  });
  await saveBankTransactionUpdates(env, state);
  return summary;
}

async function loadInvoicePaymentMatchTransactions(
  env: Env,
  invoices: Invoice[]
): Promise<Transaction[]> {
  const transactions = new Map<string, Transaction>();
  const invoicesByCurrency = new Map<string, Invoice[]>();
  for (const invoice of invoices) {
    if (invoice.documentType !== "sales_invoice" || invoice.status !== "open") continue;
    const currency = invoice.currency.toUpperCase();
    invoicesByCurrency.set(currency, [...(invoicesByCurrency.get(currency) ?? []), invoice]);
  }
  for (const [currency, currencyInvoices] of invoicesByCurrency) {
    const earliestIssueDate = currencyInvoices.reduce(
      (earliest, invoice) => invoice.issueDate < earliest ? invoice.issueDate : earliest,
      currencyInvoices[0].issueDate
    );
    const seenCursors = new Set<string>();
    let cursor: string | null = null;
    for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
      const page: {
        transactions: Transaction[];
        hasMore: boolean;
        continueCursor: string | null;
      } = await getConvexClient(env).query(api.banking.getInvoicePaymentCandidates, {
        serviceToken: getConvexServiceToken(env),
        currency,
        limit: bankMutationBatchSize,
        cursor
      });
      for (const transaction of page.transactions) transactions.set(transaction.id, transaction);
      const oldestDate = page.transactions.at(-1)?.date;
      if (!page.hasMore || (oldestDate && oldestDate < earliestIssueDate)) break;
      if (!page.continueCursor || seenCursors.has(page.continueCursor)) {
        throw new ApiError(503, "Invoice payment candidate pagination did not advance");
      }
      seenCursors.add(page.continueCursor);
      cursor = page.continueCursor;
    }
  }
  return [...transactions.values()];
}

async function autoMatchInvoicePayments(env: Env): Promise<AutoMatchInvoicePaymentsResult> {
  const state = await loadPersisted(env);
  const candidates = await loadInvoicePaymentMatchTransactions(env, state.invoices);
  const originalTransactions = new Map(candidates.map((transaction) => [transaction.id, transaction]));
  for (const transaction of candidates) {
    upsertPersistedTransaction(state, transaction);
    state.bankTransactionBaseline.set(transaction.id, JSON.stringify(transaction));
    state.dirtyBankTransactionIds.delete(transaction.id);
  }

  const exact = reconcileExactInvoicePayments({
    invoices: state.invoices,
    transactions: candidates,
    allocations: state.paymentAllocations,
    providers: state.providers
  });
  state.invoices = exact.invoices;
  state.paymentAllocations = exact.allocations;

  const eligibleForAi = invoicePaymentAiCandidates({
    invoices: exact.invoices,
    transactions: exact.transactions,
    allocations: exact.allocations,
    providers: state.providers
  });
  const activeAiSettings = runtimeAiSettings(env, state.aiSettings);
  const aiMatches = activeAiSettings.openRouterApiKey && eligibleForAi.length > 0
    ? await runOpenRouterInvoicePaymentMatching(
        activeAiSettings,
        exact.transactions,
        exact.invoices,
        exact.allocations,
        state.providers,
        env.PUBLIC_APP_URL
      )
    : [];
  const ai = reconcileAiInvoicePayments({
    invoices: exact.invoices,
    transactions: exact.transactions,
    allocations: exact.allocations,
    providers: state.providers,
    matches: aiMatches
  });
  state.invoices = ai.invoices;
  state.paymentAllocations = ai.allocations;

  for (const transaction of ai.transactions) {
    if (JSON.stringify(transaction) !== JSON.stringify(originalTransactions.get(transaction.id))) {
      upsertPersistedTransaction(state, transaction);
    }
  }
  if (exact.matched > 0 || ai.matched > 0) {
    await savePersisted(env, state);
    await saveBankTransactionUpdates(env, state);
  }
  return {
    dashboard: await getSnapshot(env),
    exactMatches: exact.exactMatched,
    toleranceMatches: exact.toleranceMatched,
    aiMatches: ai.matched,
    reviewed: eligibleForAi.length
  };
}

async function categorizeHistoricalBankBacklog(
  env: Env,
  limit = 240
): Promise<{ processed: number; hasMore: boolean }> {
  const backlog = await getConvexClient(env).query(api.banking.getClassificationBacklog, {
    serviceToken: getConvexServiceToken(env),
    limit
  });
  let processed = 0;
  let failedBatches = 0;
  const checkpointSize = bankAiClassificationBatchSize;
  for (let index = 0; index < backlog.transactions.length; index += checkpointSize) {
    const transactions = backlog.transactions.slice(index, index + checkpointSize);
    try {
      await autoCategorizeBankTransactions(env, transactions, transactions.length, false);
      processed += transactions.length;
    } catch (error) {
      failedBatches += 1;
      console.error(JSON.stringify({
        event: "transaction_classification_checkpoint_failed",
        transactionCount: transactions.length,
        firstTransactionId: transactions[0]?.id,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  }
  const aiBacklog = await getConvexClient(env).query(api.banking.getClassificationBacklog, {
    serviceToken: getConvexServiceToken(env),
    limit: bankAiClassificationBatchSize
  });
  if (aiBacklog.transactions.length > 0) {
    try {
      await autoCategorizeBankTransactions(
        env,
        aiBacklog.transactions,
        aiBacklog.transactions.length,
        true
      );
    } catch (error) {
      failedBatches += 1;
      console.error(JSON.stringify({
        event: "transaction_classification_ai_batch_failed",
        transactionCount: aiBacklog.transactions.length,
        firstTransactionId: aiBacklog.transactions[0]?.id,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  }
  console.log(JSON.stringify({
    event: "transaction_classification_backlog",
    attempted: backlog.transactions.length,
    processed,
    aiAttempted: aiBacklog.transactions.length,
    failedBatches,
    hasMore: backlog.hasMore || aiBacklog.hasMore
  }));
  return { processed, hasMore: backlog.hasMore || aiBacklog.hasMore };
}

async function runHistoricalClassificationBackfill(env: Env): Promise<void> {
  const convex = getConvexClient(env);
  const serviceToken = getConvexServiceToken(env);
  const token = crypto.randomUUID();
  const claimed = await convex.mutation(api.banking.claimClassificationBackfill, {
    serviceToken,
    token,
    leaseMs: 10 * 60_000
  });
  if (!claimed) {
    console.log(JSON.stringify({ event: "transaction_classification_backlog_skipped", reason: "active_lease" }));
    return;
  }
  try {
    await categorizeHistoricalBankBacklog(env);
  } finally {
    try {
      await convex.mutation(api.banking.releaseClassificationBackfill, {
        serviceToken,
        token
      });
    } catch (error) {
      console.error(JSON.stringify({
        event: "transaction_classification_backlog_release_failed",
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  }
}

async function autoCategorizeTransactions(
  env: Env,
  payload: AutoCategorizeTransactionsPayload = {}
): Promise<AutoCategorizeTransactionsResult> {
  const summary = await autoCategorizeStoredTransactions(env, payload);
  await rebuildProfitDistributionCache(env);
  return {
    dashboard: await getSnapshot(env),
    ...summary
  };
}

async function autoCategorizeStoredTransactions(
  env: Env,
  payload: AutoCategorizeTransactionsPayload = {},
  limit?: number
): Promise<Omit<AutoCategorizeTransactionsResult, "dashboard">> {
  const maximum = Math.max(1, Math.min(240, Math.trunc(limit ?? 240)));
  const requestedIds = [...new Set(payload.transactionIds ?? [])].slice(0, maximum);
  const transactions: Transaction[] = requestedIds.length > 0
    ? (await Promise.all(requestedIds.map((id) => getConvexClient(env).query(api.banking.getTransaction, {
        serviceToken: getConvexServiceToken(env),
        id
      })))).filter((transaction) => transaction !== null).map((transaction) => transaction as Transaction)
    : (await getConvexClient(env).query(api.banking.getClassificationBacklog, {
        serviceToken: getConvexServiceToken(env),
        limit: maximum
      })).transactions;
  if (transactions.length === 0) {
    return { semanticMatches: 0, aiMatches: 0, categorizedOnly: 0, reviewed: 0 };
  }
  return (await autoCategorizeBankTransactions(env, transactions, maximum))
    ?? { semanticMatches: 0, aiMatches: 0, categorizedOnly: 0, reviewed: 0 };
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
    companyMatchSource: "manual",
    companyConfidence: 1,
    companyMatchReason: "Approved company match",
    confidence: 1,
    matchReason: "Approved company match"
  };
  if (payload.scope === "merchant") {
    if (!transaction.merchantName?.trim()) {
      throw new Error("This transaction needs an AI merchant name before a merchant-wide company rule can be saved");
    }
    state.providers = state.providers.map((item) =>
      item.id === provider.id ? learnAliases(item, bankAliasNames(transaction)) : item
    );
    state.pendingBankTransactions = state.pendingBankTransactions.map((item) =>
      transactionsShareMerchant(item, transaction)
        ? {
            ...item,
            matchedProviderId: provider.id,
            companyMatchSource: "manual",
            companyConfidence: 1,
            companyMatchReason: `Manual rule for ${transaction.merchantName}`,
            confidence: 1,
            matchReason: `Manual rule for ${transaction.merchantName}`
          }
        : item
    );
    let cursor: string | null = null;
    do {
      const result: { hasMore: boolean; continueCursor: string | null } = await getConvexClient(env).mutation(api.banking.applyMerchantCompany, {
        serviceToken: getConvexServiceToken(env),
        merchantKey: transactionMerchantKey(transaction),
        merchantName: transaction.merchantName,
        direction: transaction.direction,
        providerId: provider.id,
        cursor,
        limit: bankMutationBatchSize
      });
      cursor = result.hasMore ? result.continueCursor : null;
      if (result.hasMore && !cursor) throw new ApiError(503, "Merchant company update did not advance");
    } while (cursor);
  }
  upsertPersistedTransaction(state, matchedTransaction);
  await savePersisted(env, state);
  return enrichTransactions([matchedTransaction], state.providers, state.transactionCategoryRules)[0];
}

async function updateTransactionCategory(env: Env, payload: UpdateTransactionCategoryPayload): Promise<Transaction> {
  const state = await loadPersisted(env);
  const transaction = await fetchTransactionForUpdate(env, payload.transactionId, state);
  if (!transaction) {
    throw new Error("Transaction not found");
  }

  const category = transactionBusinessCategory(payload.category);
  if (!isRequiredTransactionCategory(category, transaction.direction, state.transactionCategories)) {
    throw new Error(`Category "${category}" is not valid for money ${transaction.direction === "in" ? "in" : "out"}`);
  }
  const updated: Transaction = {
    ...transaction,
    category,
    categorySource: "manual",
    categoryConfidence: 1,
    categoryReason: "Manual category",
    matchReason: "Manual category"
  };
  upsertPersistedTransaction(state, updated);

  if (payload.scope === "merchant") {
    if (!transaction.merchantName?.trim()) {
      throw new Error("This transaction needs an AI merchant name before a merchant-wide category rule can be saved");
    }
    state.transactionCategoryRules = learnCategoryAliases(state.transactionCategoryRules, transaction, category);
    state.pendingBankTransactions = state.pendingBankTransactions.map((item) =>
      transactionsShareMerchant(item, transaction)
        ? {
            ...item,
            category,
            categorySource: "manual",
            categoryConfidence: 1,
            categoryReason: `Manual rule for ${transaction.merchantName}`,
            matchReason: `Manual rule for ${transaction.merchantName}`
          }
        : item
    );
    let cursor: string | null = null;
    do {
      const result: { hasMore: boolean; continueCursor: string | null } = await getConvexClient(env).mutation(api.banking.applyMerchantCategory, {
        serviceToken: getConvexServiceToken(env),
        merchantKey: transactionMerchantKey(transaction),
        merchantName: transaction.merchantName,
        direction: transaction.direction,
        category,
        cursor,
        limit: bankMutationBatchSize
      });
      cursor = result.hasMore ? result.continueCursor : null;
      if (result.hasMore && !cursor) throw new ApiError(503, "Merchant category update did not advance");
    } while (cursor);
  }

  await savePersisted(env, state);
  await rebuildProfitDistributionCache(env);
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
  await rebuildProfitDistributionCache(env);
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
    throw new Error("Owner not found");
  }

  const updated = { ...transaction, teamId };
  upsertPersistedTransaction(state, updated);
  await savePersisted(env, state);
  return updated;
}

async function createTeam(env: Env, payload: CreateTeamPayload): Promise<Team> {
  const name = canonicalTeamName(payload.name.trim());
  if (!name) {
    throw new Error("Owner name is required");
  }

  const state = await loadPersisted(env);
  if (state.teams.some((team) => normalizeName(team.name) === normalizeName(name))) {
    throw new Error("Owner already exists");
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

async function createTransactionCategory(
  env: Env,
  payload: CreateTransactionCategoryPayload
): Promise<TransactionCategory[]> {
  const convex = getConvexClient(env);
  try {
    return await convex.mutation(api.dashboard.createTransactionCategory, {
      serviceToken: getConvexServiceToken(env),
      id: `category-${crypto.randomUUID()}`,
      ...payload
    });
  } catch (error) {
    categoryMutationError(error);
  }
}

async function updateTransactionCategoryDefinition(
  env: Env,
  categoryId: string,
  payload: UpdateTransactionCategoryDefinitionPayload
): Promise<TransactionCategory[]> {
  const convex = getConvexClient(env);
  const categoriesBeforeUpdate = (await loadPersisted(env)).transactionCategories;
  const existing = categoriesBeforeUpdate.find((category) => category.id === categoryId);
  if (!existing) throw new ApiError(404, "Category not found");
  try {
    const targetName = payload.name.trim().replace(/\s+/g, " ");
    if (!targetName) throw new ApiError(400, "Category name is required");
    if (!/^#[0-9a-f]{6}$/i.test(payload.color)) {
      throw new ApiError(400, "Category color must be a six-digit hex value");
    }
    if (existing.system && (targetName !== existing.name || payload.direction !== existing.direction)) {
      throw new ApiError(409, "Built-in category names and types are locked because reporting rules depend on them");
    }
    if (categoriesBeforeUpdate.some(
      (category) => category.id !== categoryId && normalizeName(category.name) === normalizeName(targetName)
    )) {
      throw new ApiError(409, "A category with this name already exists");
    }

    // Move ledger rows first while the old definition remains the durable resume marker.
    // A retry after any failed batch still discovers the old name and continues safely.
    if (existing.name !== targetName) {
      let hasMore = false;
      do {
        const result = await convex.mutation(api.banking.renameCategoryBatch, {
          serviceToken: getConvexServiceToken(env),
          fromCategory: existing.name,
          toCategory: targetName,
          limit: bankMutationBatchSize
        });
        hasMore = result.hasMore;
      } while (hasMore);
    }
    return await convex.mutation(api.dashboard.updateTransactionCategory, {
      serviceToken: getConvexServiceToken(env),
      id: categoryId,
      ...payload,
      name: targetName
    });
  } catch (error) {
    categoryMutationError(error);
  }
}

async function deleteTransactionCategoryDefinition(env: Env, categoryId: string): Promise<TransactionCategory[]> {
  const convex = getConvexClient(env);
  const existing = (await loadPersisted(env)).transactionCategories.find((category) => category.id === categoryId);
  if (!existing) throw new ApiError(404, "Category not found");
  try {
    const hasBankReference = await convex.query(api.banking.hasCategoryReference, {
      serviceToken: getConvexServiceToken(env),
      category: existing.name
    });
    if (hasBankReference) {
      throw new ApiError(409, "Reassign bank transactions before deleting this category");
    }
    return await convex.mutation(api.dashboard.deleteTransactionCategory, {
      serviceToken: getConvexServiceToken(env),
      id: categoryId
    });
  } catch (error) {
    categoryMutationError(error);
  }
}

async function validateExpensePayload(
  env: Env,
  state: PersistedState,
  payload: CreateExpensePayload
): Promise<{ provider?: Provider; transaction?: Transaction; category: string }> {
  if (!payload.supplierName?.trim() || !payload.businessPurpose?.trim() || !payload.description?.trim()) {
    throw new ApiError(400, "Supplier, economic content, and business purpose are required");
  }
  if (!/^[A-Z]{3}$/.test(payload.currency?.trim().toUpperCase())) {
    throw new ApiError(400, "Expense currency must be a three-letter ISO code");
  }
  try {
    validateExpenseAmounts(payload);
  } catch (error) {
    throw new ApiError(400, error instanceof Error ? error.message : "Expense amounts are invalid");
  }
  const category = transactionBusinessCategory(payload.category);
  if (!isTransactionCategoryForDirection(category, "out", state.transactionCategories)) {
    throw new ApiError(400, `Category "${category}" is not valid for money out`);
  }
  const provider = payload.providerId ? state.providers.find((item) => item.id === payload.providerId) : undefined;
  if (payload.providerId && (!provider || provider.type !== "supplier")) {
    throw new ApiError(400, "Expense records require a supplier company");
  }
  if (payload.teamId && !state.teams.some((team) => team.id === payload.teamId)) {
    throw new ApiError(400, "Expense owner not found");
  }
  const transaction = payload.transactionId
    ? await fetchTransactionForUpdate(env, payload.transactionId, state)
    : undefined;
  if (payload.transactionId && (!transaction || transaction.direction !== "out")) {
    throw new ApiError(400, "Paid expenses require an outgoing bank transaction");
  }
  if (transaction) {
    if (payload.recordType !== "paid_expense" || payload.paymentStatus !== "paid") {
      throw new ApiError(400, "An outgoing bank transaction can only create a paid expense");
    }
    if (
      transaction.currency !== payload.currency.trim().toUpperCase()
      || Math.abs(transaction.amount - payload.grossAmount) > 0.01
    ) {
      throw new ApiError(400, "Expense currency and gross amount must match the outgoing bank transaction");
    }
    if (state.expenses.some((expense) => expense.transactionId === transaction.id)) {
      throw new ApiError(409, "This bank transaction already has an expense record");
    }
  } else if (payload.recordType !== "supplier_bill" || payload.paymentStatus !== "unpaid" || !payload.dueDate) {
    throw new ApiError(400, "Records without a bank transaction must be unpaid supplier bills with a due date");
  }
  if (payload.document.mode === "upload" && !payload.sourceDocumentNumber?.trim()) {
    throw new ApiError(400, "Supplier receipt or invoice number is required");
  }
  if (payload.sourceDocumentNumber?.trim()) {
    const normalizedDocumentNumber = payload.sourceDocumentNumber.trim().toLowerCase();
    const supplierName = payload.supplierName.trim().toLowerCase();
    const duplicate = state.expenses.some((expense) =>
      expense.sourceDocumentNumber?.toLowerCase() === normalizedDocumentNumber
      && (provider ? expense.providerId === provider.id : expense.supplierName.toLowerCase() === supplierName)
    );
    if (duplicate) throw new ApiError(409, "This supplier document number is already recorded");
  }
  if (payload.document.mode === "generate_missing_receipt") {
    if (
      !transaction
      || !payload.document.reason.trim()
      || payload.document.confirmation !== "MISSING_SOURCE_DOCUMENT_CONFIRMED"
    ) {
      throw new ApiError(400, "A linked bank transaction, reason, and missing source document confirmation are required");
    }
    if (payload.vatAmount !== 0 || payload.vatTreatment !== "not_applicable") {
      throw new ApiError(400, "Input VAT cannot be recorded from an internally generated missing-document declaration");
    }
  } else {
    validateExpenseDocumentUpload(payload.document.file.contentType, payload.document.file.size);
    if (!payload.document.file.storageId?.trim() || !payload.document.file.fileName?.trim()) {
      throw new ApiError(400, "Uploaded expense document details are required");
    }
  }
  return { provider, transaction, category };
}

async function createExpense(env: Env, payload: CreateExpensePayload): Promise<ExpenseRecord> {
  const state = await loadPersisted(env);
  const { provider, transaction, category } = await validateExpensePayload(env, state, payload);
  const createdAt = new Date().toISOString();
  const issueDate = expenseDate(payload.issueDate, "Issue date");
  const transactionDate = payload.transactionDate
    ? expenseDate(payload.transactionDate, "Transaction date")
    : transaction?.date;
  const dueDate = payload.dueDate ? expenseDate(payload.dueDate, "Due date") : undefined;
  if (dueDate && dueDate < issueDate) throw new ApiError(400, "Due date cannot be before issue date");
  const expense: ExpenseRecord = {
    id: `expense-${crypto.randomUUID()}`,
    recordNumber: nextExpenseRecordNumber(state.expenses, issueDate),
    recordType: payload.recordType,
    paymentStatus: payload.paymentStatus,
    transactionId: transaction?.id,
    providerId: provider?.id,
    teamId: cleanOptional(payload.teamId),
    supplierName: payload.supplierName.trim(),
    supplierRegistrationNumber: cleanOptional(payload.supplierRegistrationNumber),
    supplierVatNumber: cleanOptional(payload.supplierVatNumber)?.toUpperCase(),
    sourceDocumentNumber: cleanOptional(payload.sourceDocumentNumber),
    issueDate,
    transactionDate,
    dueDate,
    paidAt: payload.paymentStatus === "paid" ? transaction?.date ?? issueDate : undefined,
    category,
    businessPurpose: payload.businessPurpose.trim(),
    description: payload.description.trim(),
    netAmount: Number(payload.netAmount.toFixed(2)),
    vatAmount: Number(payload.vatAmount.toFixed(2)),
    grossAmount: Number(payload.grossAmount.toFixed(2)),
    vatRate: payload.vatRate,
    vatTreatment: payload.vatTreatment,
    currency: payload.currency.trim().toUpperCase(),
    missingDocumentReason: payload.document.mode === "generate_missing_receipt" ? payload.document.reason.trim() : undefined,
    declarationConfirmedAt: payload.document.mode === "generate_missing_receipt" ? createdAt : undefined,
    documents: [],
    createdAt,
    updatedAt: createdAt
  };

  let document: ExpenseDocument;
  if (payload.document.mode === "upload") {
    const file = payload.document.file;
    document = {
      id: `expense-document-${crypto.randomUUID()}`,
      kind: file.kind,
      fileName: file.fileName.trim(),
      contentType: file.contentType,
      size: file.size,
      storageId: file.storageId,
      createdAt
    };
  } else {
    const bytes = await generateMissingReceiptDeclarationPdf(expense, transaction!);
    const fileName = `${expense.recordNumber}-missing-source-document.pdf`;
    document = {
      id: `expense-document-${crypto.randomUUID()}`,
      kind: "missing_receipt_declaration",
      fileName,
      contentType: "application/pdf",
      size: bytes.byteLength,
      storageId: await uploadExpenseDocumentToConvex(env, bytes, "application/pdf"),
      createdAt
    };
  }
  expense.documents = [document];
  state.expenses = [expense, ...state.expenses];

  if (transaction) {
    upsertPersistedTransaction(state, {
      ...transaction,
      matchedProviderId: provider?.id ?? transaction.matchedProviderId,
      category,
      teamId: expense.teamId ?? transaction.teamId,
      confidence: 1,
      matchReason: "Paid expense reviewed with source document"
    });
    if (provider) {
      state.providers = state.providers.map((item) =>
        item.id === provider.id ? learnAliases(item, bankAliasNames(transaction)) : item
      );
    }
  }
  await savePersisted(env, state);
  return expense;
}

async function matchExpensePayment(
  env: Env,
  expenseId: string,
  payload: MatchExpensePaymentPayload
): Promise<ExpenseRecord> {
  const state = await loadPersisted(env);
  const expense = state.expenses.find((item) => item.id === expenseId);
  if (!expense || expense.recordType !== "supplier_bill" || expense.paymentStatus !== "unpaid") {
    throw new ApiError(404, "Unpaid supplier bill not found");
  }
  const transaction = await fetchTransactionForUpdate(env, payload.transactionId, state);
  if (!transaction || transaction.direction !== "out") throw new ApiError(404, "Outgoing bank transaction not found");
  if (state.expenses.some((item) => item.id !== expense.id && item.transactionId === transaction.id)) {
    throw new ApiError(409, "This bank transaction already has an expense record");
  }
  if (expense.currency !== transaction.currency || Math.abs(expense.grossAmount - transaction.amount) > 0.01) {
    throw new ApiError(400, "Supplier bill currency and gross amount must match the bank transaction");
  }
  const updatedAt = new Date().toISOString();
  const updated: ExpenseRecord = {
    ...expense,
    paymentStatus: "paid",
    transactionId: transaction.id,
    transactionDate: expense.transactionDate ?? transaction.date,
    paidAt: transaction.date,
    updatedAt
  };
  state.expenses = state.expenses.map((item) => item.id === expense.id ? updated : item);
  upsertPersistedTransaction(state, {
    ...transaction,
    matchedProviderId: expense.providerId ?? transaction.matchedProviderId,
    category: expense.category,
    teamId: expense.teamId ?? transaction.teamId,
    confidence: 1,
    matchReason: `Matched to supplier bill ${expense.recordNumber}`
  });
  await savePersisted(env, state);
  return updated;
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
  const liveMeritInvoices = payload.documentType === "sales_invoice"
    ? await fetchMeritInvoices(env, state.invoices)
    : [];
  const invoiceNumber = payload.documentType === "sales_invoice"
    ? nextMeritInvoiceNumber([...state.invoices, ...liveMeritInvoices], issueDate)
    : `BILL-${Date.now().toString(36).toUpperCase()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
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
    invoiceNumber,
    issueDate,
    dueDate: payload.dueDate,
    source: "manual",
    description: payload.description.trim(),
    transactionId: payload.transactionId,
    revenueRunIds: [],
    periodStart: cleanOptional(payload.periodStart),
    periodEnd: cleanOptional(payload.periodEnd),
    taxId: cleanOptional(payload.taxId) ?? (payload.documentType === "sales_invoice" ? selectedProvider?.defaultMeritTaxId : undefined),
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
        upsertPersistedTransaction(state, {
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

async function previewInvoiceDuplicate(env: Env, invoiceId: string): Promise<CreateInvoicePayload> {
  const state = await loadPersisted(env);
  const source = state.invoices.find((invoice) => invoice.id === invoiceId);
  if (!source) throw new ApiError(404, "Invoice not found");
  const copySource = source.origin === "merit"
    ? { ...source, ...(await fetchMeritInvoiceCopyDetails(env, source)) }
    : source;
  return invoiceCopyPayload(copySource);
}

async function deleteInvoiceDrafts(env: Env, invoiceIds: string[]): Promise<Invoice[]> {
  const state = await loadPersisted(env);
  const requestedIds = [...new Set(invoiceIds.filter((invoiceId) => typeof invoiceId === "string" && invoiceId.trim()).map((invoiceId) => invoiceId.trim()))];
  const selectedInvoices = requestedIds.map((invoiceId) => {
    const invoice = state.invoices.find((item) => item.id === invoiceId);
    if (!invoice) throw new ApiError(404, `Invoice not found: ${invoiceId}`);
    return invoice;
  });
  const blockReason = dashboardInvoiceDeletionBatchBlockReason(selectedInvoices, state.paymentAllocations);
  if (blockReason) throw new ApiError(409, blockReason);
  const selectedIds = new Set(requestedIds);
  state.invoices = state.invoices.filter((item) => !selectedIds.has(item.id));
  await savePersisted(env, state);
  return selectedInvoices;
}

async function createManualReceivable(env: Env, payload: CreateManualReceivablePayload): Promise<LedgerItem> {
  const name = payload.name?.trim();
  const currency = payload.currency?.trim().toUpperCase();
  if (!name) throw new ApiError(400, "Receivable name is required");
  if (!Number.isFinite(payload.amount) || payload.amount <= 0) {
    throw new ApiError(400, "Receivable amount must be positive");
  }
  if (!currency || !/^[A-Z0-9]{2,12}$/.test(currency)) {
    throw new ApiError(400, "Receivable currency is invalid");
  }

  const state = await loadPersisted(env);
  const receivable: LedgerItem = {
    id: `manual-receivable-${crypto.randomUUID()}`,
    name,
    balance: Number(payload.amount.toFixed(2)),
    currency,
    source: "manual"
  };
  state.manualReceivables = [receivable, ...state.manualReceivables];
  await savePersisted(env, state);
  return receivable;
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

async function syncRevenue(env: Env, payload: SyncRevenuePayload = {}): Promise<RevenuePullResult> {
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

  return { runs: nextRuns };
}

async function draftRevenueRun(env: Env, payload: DraftRevenueRunPayload): Promise<Invoice> {
  const state = await loadPersisted(env);
  const partner = state.revenuePartners.find((item) => item.id === payload.partnerId);
  if (!partner) throw new ApiError(409, "Revenue rule no longer exists");
  if (!partner.enabled) throw new ApiError(409, "Revenue rule is disabled");
  if (payload.timezone !== partner.timezone && payload.timezone !== partner.billingTimezone) {
    throw new ApiError(400, "Revenue draft timezone does not match the revenue rule");
  }
  const period = resolveRevenuePeriod({
    periodPreset: "custom",
    periodStart: payload.periodStart,
    periodEnd: payload.periodEnd,
    timezone: payload.timezone
  });
  const run: RevenueRun = {
    ...(await fetchTuneRevenue(env, partner, period)),
    ...(partner.teamId
      ? { teamName: state.teams.find((team) => team.id === partner.teamId)?.name ?? partner.teamId }
      : {})
  };
  if (run.revenue <= 0) throw new ApiError(409, "Only a positive pulled revenue period can be drafted");
  if (!isClosedBillingPeriod(partner, run)) throw new ApiError(409, "Revenue period is not closed yet");
  const existing = state.invoices.find(
    (invoice) => invoice.billingRuleId === partner.id && invoice.periodStart === run.periodStart && invoice.periodEnd === run.periodEnd
  );
  if (existing) return existing;
  const provider = state.providers.find((item) => item.id === partner.providerId);
  if (!provider) throw new ApiError(409, "Revenue rule customer no longer exists");
  const draftedAt = new Date();
  const invoiceNumber = nextMeritInvoiceNumber(state.invoices, draftedAt.toISOString().slice(0, 10));
  const draft = buildRevenueDraft({ ...partner, autoDraft: true }, run, provider, invoiceNumber, draftedAt);
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
  const liveMeritInvoices = await fetchMeritInvoices(env, state.invoices);
  const numberedInvoices = assignMeritStyleDraftNumbers(state.invoices, liveMeritInvoices);
  if (JSON.stringify(numberedInvoices) !== JSON.stringify(state.invoices)) {
    state.invoices = numberedInvoices;
    await savePersisted(env, state);
  }
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
        if (current.origin === "revenue" && !provider?.meritCustomerId) {
          throw new ApiError(409, "Revenue invoices require a customer imported from Merit");
        }
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
          current.invoiceNumber,
          billingRule?.defaultMeritItemCode,
          provider
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

const paymentSources = new Set<PaymentAllocation["source"]>(["wise", "revolut", "slash", "amex", "cash", "kraken", "trust", "other"]);

function isInvoicePaymentSource(value: DataSource): value is Extract<DataSource, PaymentAllocation["source"]> {
  return paymentSources.has(value as PaymentAllocation["source"]);
}

function isIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function bulkPaymentAllocationId(operationId: string, invoiceId: string): string {
  const safeOperationId = operationId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 100);
  const safeInvoiceId = invoiceId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 100);
  return `payment-bulk-${safeOperationId}-${safeInvoiceId}`;
}

async function recordBulkInvoicePayments(
  env: Env,
  payload: BulkRecordInvoicePaymentsPayload
): Promise<DashboardSnapshot> {
  const invoiceIds = [...new Set(payload.invoiceIds)];
  if (
    payload.confirmation !== "RECORD_DASHBOARD_PAYMENTS"
    || invoiceIds.length === 0
    || invoiceIds.length !== payload.invoiceIds.length
    || invoiceIds.length > 200
    || !/^[a-zA-Z0-9_-]{8,100}$/.test(payload.operationId)
    || !isIsoCalendarDate(payload.paidAt)
    || !paymentSources.has(payload.source)
  ) {
    throw new ApiError(400, "Unique invoice IDs, operation ID, paidAt, payment source, and explicit confirmation are required");
  }
  const state = await loadPersisted(env);
  const selected = invoiceIds.map((invoiceId) => {
    const invoice = state.invoices.find((item) => item.id === invoiceId);
    if (!invoice) throw new ApiError(404, `Invoice ${invoiceId} was not found`);
    const allocationId = bulkPaymentAllocationId(payload.operationId, invoiceId);
    const existingAllocation = state.paymentAllocations.find((allocation) => allocation.id === allocationId);
    if (existingAllocation) return { invoice, allocationId, outstanding: 0, alreadyRecorded: true };
    if (invoice.documentType !== "sales_invoice" || invoice.status !== "open") {
      throw new ApiError(409, `Invoice ${invoice.invoiceNumber} is not an open sales invoice`);
    }
    const outstanding = invoiceOutstanding(invoice, state.paymentAllocations);
    if (outstanding <= 0) throw new ApiError(409, `Invoice ${invoice.invoiceNumber} has no outstanding balance`);
    return { invoice, allocationId, outstanding, alreadyRecorded: false };
  });
  const createdAt = new Date().toISOString();
  const additions: PaymentAllocation[] = selected.flatMap(({ invoice, allocationId, outstanding, alreadyRecorded }) =>
    alreadyRecorded
      ? []
      : [{
          id: allocationId,
          invoiceId: invoice.id,
          amount: Number(outstanding.toFixed(2)),
          currency: invoice.currency,
          source: payload.source,
          accountName: cleanOptional(payload.accountName),
          note: cleanOptional(payload.note),
          mode: "manual" as const,
          matchReason: "Bulk dashboard payment",
          paidAt: payload.paidAt,
          createdAt
        }]
  );
  if (additions.length > 0) {
    state.paymentAllocations = [...additions, ...state.paymentAllocations];
    const selectedIds = new Set(invoiceIds);
    state.invoices = applyPaymentState(state.invoices, state.paymentAllocations).map((invoice) =>
      selectedIds.has(invoice.id) ? { ...invoice, updatedAt: createdAt } : invoice
    );
    await savePersisted(env, state);
  }
  return getSnapshot(env);
}

async function matchInvoicePayment(
  env: Env,
  transactionId: string,
  payload: MatchInvoicePaymentPayload
): Promise<DashboardSnapshot> {
  if (payload.confirmation !== "REVIEWED_INVOICE_MATCH") {
    throw new ApiError(400, "Explicit invoice match confirmation is required");
  }
  const state = await loadPersisted(env);
  const transaction = await fetchTransactionForUpdate(env, transactionId, state);
  if (!transaction) throw new ApiError(404, "Bank transaction not found");
  if (
    transaction.direction !== "in"
    || (transaction.status !== "posted" && transaction.status !== "settled")
    || !isInvoicePaymentSource(transaction.source)
  ) {
    throw new ApiError(409, "Only posted or settled incoming bank transactions can be matched to invoices");
  }

  const removedInvoiceIds = new Set(
    state.paymentAllocations
      .filter((allocation) => allocation.transactionId === transaction.id)
      .map((allocation) => allocation.invoiceId)
  );
  state.paymentAllocations = state.paymentAllocations.filter(
    (allocation) => allocation.transactionId !== transaction.id
  );
  const invoice = payload.invoiceId
    ? state.invoices.find((item) => item.id === payload.invoiceId)
    : undefined;
  if (payload.invoiceId && !invoice) throw new ApiError(404, "Invoice not found");
  if (invoice) {
    if (invoice.documentType !== "sales_invoice" || invoice.status === "draft") {
      throw new ApiError(409, "Only saved sales invoices can receive bank payments");
    }
    if (invoice.currency.toUpperCase() !== transaction.currency.toUpperCase()) {
      throw new ApiError(409, "The invoice and bank transaction currencies must match");
    }
    const outstanding = invoiceOutstanding(invoice, state.paymentAllocations);
    if (outstanding <= 0) throw new ApiError(409, "The selected invoice has no outstanding balance");
    const amount = Math.min(outstanding, Math.abs(transaction.amount));
    const createdAt = new Date().toISOString();
    state.paymentAllocations = [{
      id: `payment-manual-${crypto.randomUUID()}`,
      invoiceId: invoice.id,
      transactionId: transaction.id,
      amount: Number(amount.toFixed(2)),
      currency: invoice.currency,
      source: transaction.source,
      accountName: transaction.accountName,
      reference: transaction.description,
      mode: "manual",
      confidence: 1,
      matchReason: "Manually matched bank transaction",
      paidAt: transaction.date,
      createdAt
    }, ...state.paymentAllocations];
    removedInvoiceIds.add(invoice.id);
    if (invoice.providerId) {
      state.providers = state.providers.map((provider) =>
        provider.id === invoice.providerId ? learnAliases(provider, bankAliasNames(transaction)) : provider
      );
    }
  }
  const updatedAt = new Date().toISOString();
  state.invoices = applyPaymentState(state.invoices, state.paymentAllocations).map((item) =>
    removedInvoiceIds.has(item.id) ? { ...item, updatedAt } : item
  );
  const {
    matchedInvoiceId: _matchedInvoiceId,
    invoiceMatchConfidence: _invoiceMatchConfidence,
    invoiceMatchReason: _invoiceMatchReason,
    ...withoutInvoiceMatch
  } = transaction;
  upsertPersistedTransaction(state, {
    ...withoutInvoiceMatch,
    matchedInvoiceId: invoice?.id,
    ...(invoice?.providerId ? { matchedProviderId: invoice.providerId } : {}),
    invoiceMatchSource: "manual",
    invoiceMatchConfidence: 1,
    invoiceMatchReason: invoice ? "Manually matched bank transaction" : "Manually left unmatched"
  });
  await savePersisted(env, state);
  await saveBankTransactionUpdates(env, state);
  return getSnapshot(env);
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
      invoiceMatchSource: "manual",
      invoiceMatchConfidence: 1,
      invoiceMatchReason: linkedInvoiceIds.size === 1 ? "Manually allocated to invoice" : "Manually split across invoices",
      confidence: 1,
      matchReason: linkedInvoiceIds.size === 1 ? "Manually allocated to invoice" : "Manually split across invoices"
    };
    upsertPersistedTransaction(state, updatedTransaction);
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

  const fetchedAt = new Date().toISOString();
  const baseUrl = (env.COINBASE_SPOT_PRICES_URL || defaultCoinbaseSpotPricesUrl).replace(/\/+$/, "");
  const results = await Promise.allSettled(uniqueAssets.map(async (asset): Promise<FxRate> => {
    const url = new URL(`${baseUrl}/${encodeURIComponent(asset)}-USD/spot`);
    const payload = await fetchJson<{ data?: { amount?: string; base?: string; currency?: string } }>(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000)
    });
    const rateUsd = Number(payload.data?.amount);
    if (payload.data?.currency !== "USD" || !Number.isFinite(rateUsd) || rateUsd <= 0) {
      throw new ApiError(502, `Coinbase did not return a USD spot price for ${asset}`);
    }
    return {
      asset,
      rateUsd,
      provider: "coinbase",
      asOf: fetchedAt,
      checkedAt: fetchedAt,
      stale: false
    };
  }));
  const rates = results.flatMap((result): FxRate[] => result.status === "fulfilled" ? [result.value] : []);
  if (rates.length === 0) {
    const firstFailure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (firstFailure?.reason instanceof Error) throw firstFailure.reason;
    throw new ApiError(502, "Coinbase did not return any requested USD rates");
  }
  return rates;
}

async function updateCurrentFxRates(
  env: Env,
  state: PersistedState,
  accounts: AccountBalance[] = [],
  liveInvoices: Invoice[] = []
): Promise<void> {
  const trackedAssets = trackedFxAssets(state, accounts, liveInvoices);
  const checkedAt = new Date().toISOString();
  state.fxTrackedAssets = trackedAssets;
  let refreshedRates: FxRate[] = [];
  try {
    refreshedRates = await fetchCoinbaseUsdRates(env, trackedAssets);
  } catch {
    // Conversion availability is independent from bank/invoice sync; last-known values stay visible as stale.
  }
  state.fxRates = mergeFxRates(state.fxRates, refreshedRates, trackedAssets, checkedAt);
}

function trackedFxAssets(
  state: PersistedState,
  accounts: AccountBalance[] = [],
  liveInvoices: Invoice[] = []
): string[] {
  return [...new Set([
    ...state.fxTrackedAssets,
    ...state.fxRates.map((rate) => rate.asset),
    ...accounts.map((account) => account.currency),
    ...state.holdings.map((holding) => holding.asset),
    ...state.invoices.map((invoice) => invoice.currency),
    ...state.expenses.map((expense) => expense.currency),
    ...liveInvoices.map((invoice) => invoice.currency),
    ...state.manualReceivables.map((receivable) => receivable.currency),
    ...state.revenuePartners.map((partner) => partner.currency),
    ...state.revenueRuns.map((run) => run.currency),
    ...state.revenueAccruals.map((accrual) => accrual.currency)
  ].map((asset) => asset.trim().toUpperCase()).filter(Boolean))].sort();
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
    const provider = state.providers.find((item) => item.id === partner.providerId);
    if (!provider) throw new Error("Revenue rule customer no longer exists");
    const invoiceNumber = nextMeritInvoiceNumber(state.invoices, scheduledAt.toISOString().slice(0, 10));
    const draft = buildRevenueDraft(partner, run, provider, invoiceNumber, scheduledAt);
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

function boundedPageLimit(value: string | null): number {
  if (value === null) return bankMutationBatchSize;
  if (!/^\d+$/.test(value)) throw new ApiError(400, "Transaction limit must be a whole number");
  const limit = Number(value);
  if (limit < 1 || limit > bankMutationBatchSize) {
    throw new ApiError(400, `Transaction limit must be between 1 and ${bankMutationBatchSize}`);
  }
  return limit;
}

function opaqueCursor(value: string | null): string | null {
  if (!value) return null;
  if (value.length > 4096) throw new ApiError(400, "Transaction cursor is invalid");
  return value;
}

function transactionPageOptions(url: URL): TransactionPageOptions {
  const fromDate = url.searchParams.get("fromDate");
  const toDate = url.searchParams.get("toDate");
  if (!fromDate || !toDate) {
    throw new ApiError(400, "Transaction fromDate and toDate are required");
  }
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)
    || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)
    || fromDate > toDate
    || toDate > new Date().toISOString().slice(0, 10)
  ) {
    throw new ApiError(400, "Transaction date range is invalid");
  }
  const source = url.searchParams.get("source");
  if (source !== null && source !== "wise" && source !== "revolut" && source !== "slash" && source !== "amex") {
    throw new ApiError(400, "Transaction source is invalid");
  }
  const direction = url.searchParams.get("direction");
  if (direction !== null && direction !== "in" && direction !== "out") {
    throw new ApiError(400, "Transaction direction is invalid");
  }
  const order = url.searchParams.get("order") ?? "desc";
  if (order !== "asc" && order !== "desc") throw new ApiError(400, "Transaction order is invalid");
  const wiseEntity = url.searchParams.get("wiseEntity");
  if (wiseEntity !== null && wiseEntity !== "dn" && wiseEntity !== "lmd") {
    throw new ApiError(400, "Transaction Wise entity is invalid");
  }
  const match = url.searchParams.get("match") ?? "all";
  if (match !== "all" && match !== "matched" && match !== "needs-review") {
    throw new ApiError(400, "Transaction category status is invalid");
  }
  const sortKey = url.searchParams.get("sort") ?? "date";
  const transactionSortKeys: readonly TransactionSortKey[] = [
    "account",
    "amount",
    "category",
    "company",
    "counterparty",
    "date",
    "direction",
    "document",
    "match",
    "period",
    "source",
    "team"
  ];
  if (!transactionSortKeys.includes(sortKey as TransactionSortKey)) {
    throw new ApiError(400, "Transaction sort is invalid");
  }
  const search = url.searchParams.get("search")?.trim();
  const accountId = url.searchParams.get("accountId")?.trim();
  const category = url.searchParams.get("category")?.trim();
  const team = url.searchParams.get("team")?.trim();
  const groupType = url.searchParams.get("groupType")?.trim();
  const groupKey = url.searchParams.get("groupKey")?.trim();
  if (search && search.length > 200) throw new ApiError(400, "Transaction search is too long");
  if (accountId && accountId.length > 256) throw new ApiError(400, "Transaction account is invalid");
  if (category && category.length > 160) throw new ApiError(400, "Transaction category is invalid");
  if (team && team.length > 256) throw new ApiError(400, "Transaction owner is invalid");
  if (groupType && groupType !== "merchant" && groupType !== "card" && groupType !== "account") {
    throw new ApiError(400, "Transaction group type is invalid");
  }
  if (Boolean(groupType) !== Boolean(groupKey) || (groupKey?.length ?? 0) > 512) {
    throw new ApiError(400, "Transaction group filter is invalid");
  }
  return {
    fromDate,
    toDate,
    ...(source ? { source } : {}),
    ...(direction ? { direction } : {}),
    ...(wiseEntity ? { wiseEntity } : {}),
    ...(accountId ? { accountId } : {}),
    ...(category ? { category } : {}),
    ...(team ? { team } : {}),
    ...(groupType ? { groupType: groupType as BankActivityGroupType, groupKey } : {}),
    ...(search ? { search } : {}),
    match,
    sortKey: sortKey as TransactionSortKey,
    order,
    cursor: opaqueCursor(url.searchParams.get("cursor")),
    limit: boundedPageLimit(url.searchParams.get("limit"))
  };
}

function analyticsCategoryCompaniesOptions(url: URL): {
  fromDate: string;
  toDate: string;
  direction: "in" | "out";
  currency: string;
  category: string;
  cursor: string | null;
  limit: number;
} {
  const range = bankAnalyticsDateRange(url);
  const direction = url.searchParams.get("direction");
  if (direction !== "in" && direction !== "out") {
    throw new ApiError(400, "Analytics category direction is invalid");
  }
  const currency = url.searchParams.get("currency")?.trim().toUpperCase() ?? "";
  if (!/^[A-Z0-9]{2,12}$/.test(currency)) {
    throw new ApiError(400, "Analytics category currency is invalid");
  }
  const rawCategory = url.searchParams.get("category")?.trim() ?? "";
  const category = transactionBusinessCategory(rawCategory);
  if (!rawCategory || category.length > 160) {
    throw new ApiError(400, "Analytics category is invalid");
  }
  return {
    ...range,
    direction,
    currency,
    category,
    cursor: opaqueCursor(url.searchParams.get("cursor")),
    limit: boundedPageLimit(url.searchParams.get("limit"))
  };
}

async function handleApi(
  request: Request,
  env: Env,
  executionContext?: { waitUntil(promise: Promise<unknown>): void }
): Promise<Response> {
  const url = new URL(request.url);

  try {
    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "finance-dash-worker", time: new Date().toISOString() });
    }

    if (url.pathname === "/api/dashboard" && request.method === "GET") {
      return json(await getSnapshot(env));
    }

    if (url.pathname === "/api/analytics" && request.method === "GET") {
      const range = bankAnalyticsDateRange(url);
      const coverage = await getConvexClient(env).query(api.banking.getActivityCoverage, {
        serviceToken: getConvexServiceToken(env),
        connections: await bankConnectionDirectory(env),
        fromDate: range.fromDate,
        toDate: range.toDate
      });
      const missingSources = coverage.filter((item) => item.missingRanges.length > 0);
      if (missingSources.length > 0) {
        const jobs = await Promise.all(missingSources.flatMap((item) =>
          item.missingRanges.map((missingRange) => enqueueBankBackfill(env, item.source, missingRange))
        ));
        const failedJob = jobs.find((job) => job.status === "failed");
        if (failedJob) {
          throw new ApiError(502, failedJob.lastError ?? `${failedJob.source} history sync failed`);
        }
        const run = Promise.allSettled(jobs.map((job) => runBankBackfillJob(env, job.key))).then(() => undefined);
        if (executionContext) executionContext.waitUntil(run);
        else void run;
        return json(
          { status: "building", reason: "historical-coverage", jobs: jobs.map((job) => job.key) },
          { status: 202, headers: { "Retry-After": "1" } }
        );
      }
      return await getBankAnalyticsSnapshot(env, range);
    }

    if (url.pathname === "/api/analytics/category-companies" && request.method === "GET") {
      const options = analyticsCategoryCompaniesOptions(url);
      const result = await getConvexClient(env).query(api.banking.getAnalyticsCategoryCompaniesPage, {
        serviceToken: getConvexServiceToken(env),
        fromDate: options.fromDate,
        toDate: options.toDate,
        direction: options.direction,
        currency: options.currency,
        category: options.category,
        paginationOpts: {
          cursor: options.cursor,
          numItems: options.limit
        }
      });
      const response: BankAnalyticsCategoryCompaniesPage = {
        version: 1,
        fromDate: options.fromDate,
        toDate: options.toDate,
        direction: options.direction,
        currency: options.currency,
        category: options.category,
        companies: result.companies,
        continueCursor: result.isDone ? null : result.continueCursor,
        isDone: result.isDone
      };
      return json(response);
    }

    if (url.pathname === "/api/transactions/summary" && request.method === "GET") {
      const options = transactionPageOptions(url);
      if (options.source && !bankSourceConfigured(env, options.source)) {
        throw new ApiError(409, `${options.source} is not configured for transaction sync`);
      }
      return json(await readBankActivitySummary(env, options));
    }

    if (url.pathname === "/api/transactions" && request.method === "GET") {
      const startedAt = Date.now();
      const options = transactionPageOptions(url);
      if (options.source && !bankSourceConfigured(env, options.source)) {
        throw new ApiError(409, `${options.source} is not configured for transaction sync`);
      }
      const page = await readScopedTransactionPage(env, options);
      const durationMs = Date.now() - startedAt;
      console.log(JSON.stringify({
        event: "transaction_page_loaded",
        durationMs,
        fromDate: page.fromDate,
        toDate: page.toDate,
        source: page.source ?? "all",
        direction: page.direction ?? "all",
        transactions: page.transactions.length,
        isDone: page.isDone
      }));
      return json(page, { headers: { "server-timing": `transactions;dur=${durationMs}` } });
    }

    if (url.pathname === "/api/transactions/sync" && request.method === "GET") {
      const key = url.searchParams.get("key")?.trim();
      if (!key || key.length > 512) throw new ApiError(400, "Historical transaction sync key is invalid");
      const job = await getConvexClient(env).query(api.bankSync.getBackfill, {
        serviceToken: getConvexServiceToken(env),
        key
      });
      if (!job) throw new ApiError(404, "Historical transaction sync job was not found");
      if (job.status === "failed") {
        return json(
          { ...job, message: job.lastError ?? "Historical transaction sync failed" },
          { status: 409 }
        );
      }
      if (job.status !== "complete") {
        const run = runBankBackfillJob(env, job.key).catch((error: unknown) => {
          console.error(JSON.stringify({
            event: "historical_bank_sync_failed",
            source: job.source,
            fromDate: job.fromDate,
            toDate: job.toDate,
            error: error instanceof Error ? error.message : String(error)
          }));
          throw error;
        });
        if (executionContext) executionContext.waitUntil(run);
        else void run.catch(() => undefined);
      }
      return json(job, job.status === "complete"
        ? undefined
        : { status: 202, headers: { "Retry-After": "5" } });
    }

    if (url.pathname === "/api/transactions/card-metadata-repair" && request.method === "POST") {
      const repair = await enqueueSlashCardMetadataRepair(env);
      if (!repair) return json({ status: "complete" });
      const run = runBankBackfillJob(env, repair.job.key).catch((error: unknown) => {
        console.error(JSON.stringify({
          event: "slash_card_metadata_repair_failed",
          fromDate: repair.range.fromDate,
          toDate: repair.range.toDate,
          error: error instanceof Error ? error.message : String(error)
        }));
        throw error;
      });
      if (executionContext) executionContext.waitUntil(run);
      else void run.catch(() => undefined);
      return json(
        { status: "repairing", key: repair.job.key, ...repair.range },
        { status: 202, headers: { "Retry-After": "5" } }
      );
    }

    if (url.pathname === "/api/transactions/sync" && request.method === "POST") {
      const payload = (await request.json()) as Partial<{
        source: BankTransactionSource;
        fromDate: string;
        toDate: string;
      }>;
      if (
        payload.source !== "wise"
        && payload.source !== "revolut"
        && payload.source !== "slash"
        && payload.source !== "amex"
      ) {
        throw new ApiError(400, "Historical transaction sync source is invalid");
      }
      const dateRange = parseSlashTransactionDateRange(payload.fromDate, payload.toDate);
      if (!dateRange) throw new ApiError(400, "Historical transaction sync date range is required");
      let queued = await enqueueBankBackfill(env, payload.source, dateRange);
      if (queued.status === "failed") {
        queued = await getConvexClient(env).mutation(api.bankSync.retryBackfill, {
          serviceToken: getConvexServiceToken(env),
          key: queued.key,
          connectionKey: queued.connectionKey
        });
      }
      const run = runBankBackfillJob(env, queued.key).catch((error: unknown) => {
        console.error(JSON.stringify({
          event: "historical_bank_sync_failed",
          source: payload.source,
          fromDate: dateRange.fromDate,
          toDate: dateRange.toDate,
          error: error instanceof Error ? error.message : String(error)
        }));
        throw error;
      });
      if (executionContext) executionContext.waitUntil(run);
      else void run.catch(() => undefined);
      return json(
        { status: "queued", key: queued.key, source: payload.source, ...dateRange },
        { status: 202, headers: { "Retry-After": "5" } }
      );
    }

    if (url.pathname === "/api/invoice-payment-candidates" && request.method === "GET") {
      const currency = url.searchParams.get("currency")?.trim().toUpperCase();
      if (!currency) throw new ApiError(400, "Invoice payment candidate currency is required");
      return json(await invoicePaymentCandidates(
        env,
        currency,
        boundedPageLimit(url.searchParams.get("limit")),
        url.searchParams.get("cursor")
      ));
    }

    if (url.pathname === "/api/management-report" && request.method === "GET") {
      return json(await getManagementReportDashboard(env));
    }

    if (url.pathname === "/api/expense-documents/upload" && request.method === "POST") {
      const contentType = request.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
      const declaredLength = Number(request.headers.get("content-length"));
      if (Number.isFinite(declaredLength) && declaredLength > maximumExpenseDocumentBytes) {
        throw new ApiError(413, "Expense documents cannot exceed 10 MB");
      }
      const bytes = new Uint8Array(await request.arrayBuffer());
      const storageId = await uploadExpenseDocumentToConvex(env, bytes, contentType);
      return json({ storageId, size: bytes.byteLength }, { status: 201 });
    }

    const expenseDocumentMatch = url.pathname.match(/^\/api\/expense-documents\/([^/]+)$/);
    if (expenseDocumentMatch && request.method === "GET") {
      const document = await storedExpenseDocument(env, decodeURIComponent(expenseDocumentMatch[1]));
      if (!document) throw new ApiError(404, "Expense document not found");
      const storageUrl = await expenseDocumentUrl(env, document.storageId);
      if (!storageUrl) throw new ApiError(404, "Expense document file not found");
      return Response.redirect(storageUrl, 302);
    }

    if (url.pathname === "/api/admin/wise/reset-preview" && request.method === "GET") {
      return json(await getWiseResetPreview(env));
    }

    if (url.pathname === "/api/admin/wise/reset" && request.method === "POST") {
      const payload = (await request.json()) as { confirmation?: string };
      return json(await resetWiseImports(env, payload.confirmation));
    }

    if (url.pathname === "/api/sync" && request.method === "POST") {
      const syncResults = await Promise.allSettled([
        syncLatestBankActivity(env),
        syncMeritActivity(env)
      ]);
      const failure = syncResults.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") {
        const reason = failure.reason instanceof Error ? failure.reason.message : String(failure.reason);
        console.error(JSON.stringify({ event: "manual_sync_failed", error: reason }));
        throw new ApiError(502, `Financial data sync failed: ${reason}`, { cause: failure.reason });
      }
      await rebuildProfitDistributionCache(env);
      return json(await getSnapshot(env, { refreshFxRates: true }));
    }

    if (url.pathname === "/api/merit/default-taxes/sync" && request.method === "POST") {
      return json(await syncMeritTaxDefaults(env));
    }

    if (url.pathname === "/api/wise/import-statement" && request.method === "POST") {
      return json(await importWiseStatement(env, (await request.json()) as ImportWiseStatementPayload));
    }

    if (url.pathname === "/api/revenue/sync" && request.method === "POST") {
      return json(await syncRevenue(env, (await request.json()) as SyncRevenuePayload));
    }

    if (url.pathname === "/api/revenue/draft" && request.method === "POST") {
      return json(await draftRevenueRun(env, (await request.json()) as DraftRevenueRunPayload), { status: 201 });
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

    const transactionCategoryDefinitionMatch = url.pathname.match(/^\/api\/settings\/categories\/([^/]+)$/);
    if (url.pathname === "/api/settings/categories" && request.method === "POST") {
      return json(await createTransactionCategory(env, (await request.json()) as CreateTransactionCategoryPayload), { status: 201 });
    }
    if (transactionCategoryDefinitionMatch && request.method === "PUT") {
      return json(
        await updateTransactionCategoryDefinition(
          env,
          decodeURIComponent(transactionCategoryDefinitionMatch[1]),
          (await request.json()) as UpdateTransactionCategoryDefinitionPayload
        )
      );
    }
    if (transactionCategoryDefinitionMatch && request.method === "DELETE") {
      return json(await deleteTransactionCategoryDefinition(env, decodeURIComponent(transactionCategoryDefinitionMatch[1])));
    }

    if (url.pathname === "/api/settings/ai" && request.method === "POST") {
      return json(await saveAiSettings(env, (await request.json()) as SaveAiSettingsPayload));
    }

    if (url.pathname === "/api/ai/models" && request.method === "GET") {
      return json(await listOpenRouterZdrModels());
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

    if (url.pathname === "/api/invoices/auto-match-payments" && request.method === "POST") {
      return json(await autoMatchInvoicePayments(env));
    }

    const transactionInvoiceMatch = url.pathname.match(/^\/api\/transactions\/([^/]+)\/invoice-match$/);
    if (transactionInvoiceMatch && request.method === "POST") {
      return json(
        await matchInvoicePayment(
          env,
          decodeURIComponent(transactionInvoiceMatch[1]),
          (await request.json()) as MatchInvoicePaymentPayload
        )
      );
    }

    const teamMatch = url.pathname.match(/^\/api\/transactions\/([^/]+)\/team$/);
    if (teamMatch && request.method === "POST") {
      const body = (await request.json()) as { teamId?: string | null };
      return json(await assignTransactionTeam(env, { transactionId: teamMatch[1], teamId: body.teamId || undefined }));
    }

    const categoryMatch = url.pathname.match(/^\/api\/transactions\/([^/]+)\/category$/);
    if (categoryMatch && request.method === "POST") {
      const body = (await request.json()) as { category?: string; scope?: "transaction" | "merchant" };
      return json(
        await updateTransactionCategory(env, {
          transactionId: categoryMatch[1],
          category: body.category ?? "",
          scope: body.scope === "merchant" ? "merchant" : "transaction"
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

    if (url.pathname === "/api/expenses" && request.method === "POST") {
      return json(await createExpense(env, (await request.json()) as CreateExpensePayload), { status: 201 });
    }

    const expensePaymentMatch = url.pathname.match(/^\/api\/expenses\/([^/]+)\/match-payment$/);
    if (expensePaymentMatch && request.method === "POST") {
      return json(
        await matchExpensePayment(
          env,
          decodeURIComponent(expensePaymentMatch[1]),
          (await request.json()) as MatchExpensePaymentPayload
        )
      );
    }

    if (url.pathname === "/api/invoices" && request.method === "DELETE") {
      const payload = (await request.json()) as Partial<DeleteInvoicesPayload> | null;
      return json(await deleteInvoiceDrafts(env, Array.isArray(payload?.invoiceIds) ? payload.invoiceIds : []));
    }

    const invoiceDuplicatePreviewMatch = url.pathname.match(/^\/api\/invoices\/([^/]+)\/duplicate-preview$/);
    if (invoiceDuplicatePreviewMatch && request.method === "GET") {
      return json(await previewInvoiceDuplicate(env, decodeURIComponent(invoiceDuplicatePreviewMatch[1])));
    }

    if (url.pathname === "/api/receivables" && request.method === "POST") {
      return json(await createManualReceivable(env, (await request.json()) as CreateManualReceivablePayload), { status: 201 });
    }

    if (url.pathname === "/api/invoices/send" && request.method === "POST") {
      return json(await sendInvoices(env, (await request.json()) as SendInvoicesPayload));
    }

    if (url.pathname === "/api/invoices/payments/bulk" && request.method === "POST") {
      return json(await recordBulkInvoicePayments(env, (await request.json()) as BulkRecordInvoicePaymentsPayload));
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
  async fetch(
    request: Request,
    env: Env,
    executionContext?: ExecutionContext
  ): Promise<Response> {
    const authenticationResponse = await enforceSiteAuthentication(request, env);
    if (authenticationResponse) return authenticationResponse;

    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, executionContext);
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const failures: unknown[] = [];
    if (controller.cron === "* * * * *") {
      try {
        const processed = await pollTelegramOnboarding(env);
        if (processed > 0) {
          console.log(JSON.stringify({ event: "telegram_onboarding_updates_processed", processed }));
        }
      } catch (error) {
        console.error(JSON.stringify({
          event: "telegram_onboarding_poll_failed",
          scheduledTime: controller.scheduledTime,
          error: error instanceof Error ? error.message : String(error)
        }));
        failures.push(error);
      }
    }
    if (controller.cron === "*/5 * * * *") {
      try {
        await enqueueSlashCardMetadataRepair(env);
        await processPendingBankBackfills(env);
      } catch (error) {
        console.error(JSON.stringify({
          event: "bank_backfill_queue_failed",
          scheduledTime: controller.scheduledTime,
          error: error instanceof Error ? error.message : String(error)
        }));
        failures.push(error);
      }
      try {
        await syncLatestBankActivity(env);
      } catch (error) {
        console.error(JSON.stringify({
          event: "bank_activity_sync_failed",
          scheduledTime: controller.scheduledTime,
          error: error instanceof Error ? error.message : String(error)
        }));
        failures.push(error);
      }
      try {
        await runHistoricalClassificationBackfill(env);
      } catch (error) {
        console.error(JSON.stringify({
          event: "transaction_classification_backlog_failed",
          scheduledTime: controller.scheduledTime,
          error: error instanceof Error ? error.message : String(error)
        }));
        failures.push(error);
      }
      try {
        const result = await autoMatchInvoicePayments(env);
        if (result.exactMatches > 0 || result.toleranceMatches > 0 || result.aiMatches > 0) {
          console.log(JSON.stringify({
            event: "invoice_payment_auto_match_completed",
            exactMatches: result.exactMatches,
            toleranceMatches: result.toleranceMatches,
            aiMatches: result.aiMatches,
            reviewed: result.reviewed
          }));
        }
      } catch (error) {
        console.error(JSON.stringify({
          event: "invoice_payment_auto_match_failed",
          scheduledTime: controller.scheduledTime,
          error: error instanceof Error ? error.message : String(error)
        }));
        failures.push(error);
      }
    }
    if (controller.cron === "*/15 * * * *") {
      try {
        await syncMeritActivity(env);
      } catch (error) {
        console.error(JSON.stringify({
          event: "merit_activity_sync_failed",
          scheduledTime: controller.scheduledTime,
          error: error instanceof Error ? error.message : String(error)
        }));
        failures.push(error);
      }
      try {
        await rebuildProfitDistributionCache(env);
      } catch (error) {
        console.error(JSON.stringify({
          event: "profit_distribution_cache_rebuild_failed",
          scheduledTime: controller.scheduledTime,
          error: error instanceof Error ? error.message : String(error)
        }));
        failures.push(error);
      }
    }
    if (controller.cron === "17 * * * *") {
      try {
        await refreshStoredFxRates(env);
      } catch (error) {
        console.error(JSON.stringify({
          event: "fx_rate_refresh_failed",
          scheduledTime: controller.scheduledTime,
          error: error instanceof Error ? error.message : String(error)
        }));
        failures.push(error);
      }
    }
    if (controller.cron === "23 3 * * *") {
      try {
        await reconcilePendingBankTransactions(env);
      } catch (error) {
        console.error(JSON.stringify({
          event: "pending_bank_reconciliation_failed",
          scheduledTime: controller.scheduledTime,
          error: error instanceof Error ? error.message : String(error)
        }));
        failures.push(error);
      }
    }

    const shouldRunIncomeAutomation =
      isLebanonIncomeAutomationTime(controller.scheduledTime) ||
      (controller.cron === "17 * * * *" && canCatchUpLebanonIncomeAutomation(controller.scheduledTime));
    if (shouldRunIncomeAutomation) {
      try {
        await runIncomeAutomation(env, new Date(controller.scheduledTime));
      } catch (error) {
        console.error(JSON.stringify({
          event: "income_automation_failed",
          scheduledTime: controller.scheduledTime,
          error: error instanceof Error ? error.message : String(error)
        }));
        failures.push(error);
      }
    }

    if (failures.length > 0) throw failures[0];
  }
} satisfies ExportedHandler<Env>;
