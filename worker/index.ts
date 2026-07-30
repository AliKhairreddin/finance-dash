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
  BankActivityLoadResult,
  ConnectedBankSource,
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
  MatchExpensePaymentPayload,
  PaymentAllocation,
  PersistedAiSettings,
  ProfitDistributionAdjustment,
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
  TransactionTeamAssignment,
  Transaction,
  TransactionCategory,
  TransactionCategoryRule,
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
  defaultAiSettings,
  listOpenRouterZdrModels,
  publicAiSettings,
  requireOpenRouterZdrModel,
  runOpenRouterPrompt,
  runOpenRouterTransactionCategorization
} from "../shared/ai";
import { canonicalTeamId, canonicalTeamName } from "../shared/business";
import {
  isRequiredTransactionCategory,
  isReviewOnlyTransactionCategory,
  isTransactionCategoryForDirection,
  sanitizeStoredTransactionCategories,
  sanitizeStoredTransactionCategoryRules,
  transactionBusinessCategory
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
  fetchRevolutActivity as fetchRevolutApiActivity,
  parseRevolutTransactionDateRange,
  type RevolutTransactionDateRange
} from "../shared/revolutApi";
import {
  fetchSlashActivityForLegalEntity,
  fetchSlashTransactionForLegalEntity,
  parseSlashTransactionDateRange,
  type SlashTransactionDateRange
} from "../shared/slashApi";
import {
  emptyWiseActivity,
  fetchWiseActivityForAccessibleBusinesses,
  parseWiseProfileIds,
  wiseSyncIssue,
  type WiseActivityResult
} from "../shared/wiseApi";
import {
  applyPaymentState,
  buildRevenueDraft,
  canCatchUpLebanonIncomeAutomation,
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
  openInvoiceReceivables,
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
import { enforceSiteAuthentication } from "./auth";
import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { api } from "../convex/_generated/api";
import { calculateMetrics } from "../server/calculations";
import {
  aiProviderDirectoryForTransactions,
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
  bankAccounts: AccountBalance[];
  bankSyncStates: Partial<Record<SyncedBankSource, BankSyncState>>;
  bankTransactionBaseline: Map<string, string>;
  dirtyBankTransactionIds: Set<string>;
}

type SyncedBankSource = ConnectedBankSource;

interface BankSyncState {
  source: SyncedBankSource;
  coveredRanges: SlashTransactionDateRange[];
  lastSyncedAt: string;
}

interface BankDateRanges {
  revolut?: RevolutTransactionDateRange;
  slash?: SlashTransactionDateRange;
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

export function retainCurrentSlashTransactions(
  persisted: Transaction[],
  live: Transaction[],
  authoritative: boolean
): Transaction[] {
  if (!authoritative) return persisted;
  const liveIds = new Set(live.map((transaction) => transaction.id));
  return persisted.filter((transaction) => transaction.source !== "slash" || liveIds.has(transaction.id));
}

export function retainPersistedTransactions(
  persisted: Transaction[],
  reconciled: Transaction[]
): Transaction[] {
  const persistedIds = new Set(persisted.map((transaction) => transaction.id));
  return reconciled.filter((transaction) => persistedIds.has(transaction.id));
}

export function transactionsForDashboardStorage(transactions: Transaction[]): Transaction[] {
  return transactions.filter((transaction) => transaction.source === "wise");
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

async function fetchWiseActivity(env: Env): Promise<WiseActivityResult> {
  const profileIds = parseWiseProfileIds(env.WISE_PROFILE_IDS);
  if (!env.WISE_API_TOKEN || profileIds.size === 0) return emptyWiseActivity();
  return fetchWiseActivityForAccessibleBusinesses({
    baseUrl: wiseBaseUrl(env),
    token: env.WISE_API_TOKEN,
    profileIds,
    includeTransactions: false
  });
}

async function fetchRevolutActivity(
  env: Env,
  dateRange?: RevolutTransactionDateRange
): Promise<{ accounts: AccountBalance[]; transactions: Transaction[] }> {
  return fetchRevolutApiActivity({
    environment: env.REVOLUT_ENVIRONMENT,
    clientId: env.REVOLUT_CLIENT_ID,
    issuer: env.REVOLUT_ISSUER,
    privateKeyPem: env.REVOLUT_PRIVATE_KEY_PEM,
    refreshToken: env.REVOLUT_REFRESH_TOKEN,
    dateRange
  });
}

async function fetchSlashActivity(
  env: Env,
  dateRange?: SlashTransactionDateRange
): Promise<{ accounts: AccountBalance[]; transactions: Transaction[] }> {
  const apiKey = env.SLASH_API_KEY?.trim();
  const legalEntityId = env.SLASH_LEGAL_ENTITY_ID?.trim();
  const baseUrl = env.SLASH_BASE_URL?.trim();
  if (!apiKey || !legalEntityId || !baseUrl) return { accounts: [], transactions: [] };
  return fetchSlashActivityForLegalEntity({
    baseUrl,
    apiKey,
    legalEntityId,
    dateRange
  });
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

function upsertPersistedTransaction(state: PersistedState, updated: Transaction): void {
  const existing = state.wiseStatementTransactions.find((transaction) => transaction.id === updated.id);
  state.wiseStatementTransactions = existing
    ? state.wiseStatementTransactions.map((transaction) =>
        transaction.id === updated.id ? { ...transaction, ...updated } : transaction
      )
    : [updated, ...state.wiseStatementTransactions];
  if (updated.source === "revolut" || updated.source === "slash") {
    state.dirtyBankTransactionIds.add(updated.id);
  }
}

async function fetchSlashTransaction(env: Env, transactionId: string): Promise<Transaction | undefined> {
  const apiKey = env.SLASH_API_KEY?.trim();
  const legalEntityId = env.SLASH_LEGAL_ENTITY_ID?.trim();
  const baseUrl = env.SLASH_BASE_URL?.trim();
  if (!apiKey || !legalEntityId || !baseUrl || !transactionId.startsWith("slash-")) return undefined;
  return fetchSlashTransactionForLegalEntity({
    baseUrl,
    apiKey,
    legalEntityId,
    transactionId: transactionId.slice("slash-".length)
  });
}

async function fetchTransactionForUpdate(env: Env, transactionId: string, state?: PersistedState): Promise<Transaction | undefined> {
  if (state) {
    const persisted = findPersistedTransaction(state, transactionId);
    if (persisted) return persisted;
  }
  const storedBankTransaction = await getConvexClient(env)
    .query(api.banking.getTransaction, {
      serviceToken: getConvexServiceToken(env),
      id: transactionId
    })
    .catch(() => null);
  if (storedBankTransaction) return storedBankTransaction;

  if (transactionId.startsWith("slash-")) {
    return fetchSlashTransaction(env, transactionId);
  }

  const [wise, revolut, amex] = await Promise.all([
    fetchWiseActivity(env).catch((error: unknown) => emptyWiseActivity(wiseSyncIssue(error))),
    fetchRevolutActivity(env).catch(() => ({ accounts: [], transactions: [] })),
    fetchAmexActivity(env).catch(() => ({ accounts: [], transactions: [] }))
  ]);
  return [...wise.transactions, ...revolut.transactions, ...amex.transactions].find(
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

async function readBankActivity(
  env: Env,
  source: SyncedBankSource,
  dateRange: SlashTransactionDateRange
) {
  return getConvexClient(env).query(api.banking.getActivity, {
    serviceToken: getConvexServiceToken(env),
    source,
    fromDate: dateRange.fromDate,
    toDate: dateRange.toDate
  });
}

async function loadPersisted(
  env: Env,
  dateRanges: BankDateRanges = {}
): Promise<PersistedState> {
  const convex = getConvexClient(env);
  const serviceToken = getConvexServiceToken(env);
  const revolutDateRange = dateRanges.revolut ?? defaultBankDateRange();
  const slashDateRange = dateRanges.slash ?? defaultBankDateRange();
  const [stored, revolut, slash] = await Promise.all([
    convex.query(api.dashboard.getState, { serviceToken }),
    readBankActivity(env, "revolut", revolutDateRange),
    readBankActivity(env, "slash", slashDateRange)
  ]).catch((error: unknown) => {
    throw new ApiError(503, "Dashboard storage is temporarily unavailable", { cause: error });
  });

  const storedCategoryRules = stored?.transactionCategoryRules ?? [];
  const storedTransactions = stored?.wiseStatementTransactions ?? [];
  const sanitizedStoredTransactions = sanitizeStoredTransactionCategories(storedTransactions);
  const cachedTransactions = [...revolut.transactions, ...slash.transactions];
  const allTransactions = mergeWiseStatementTransactions(
    sanitizedStoredTransactions,
    cachedTransactions
  );
  const state: PersistedState = {
    revision: stored?.updatedAt ?? null,
    providers: mergeProviderDirectory(stored?.providers ?? []),
    invoices: stored?.invoices ?? [],
    expenses: stored ? stored.expenses : [],
    manualReceivables: stored?.manualReceivables ?? [],
    teams: mergeTeamDirectory(stored?.teams ?? []),
    transactionCategories: stored?.transactionCategories ?? [],
    transactionCategoryRules: sanitizeStoredTransactionCategoryRules(storedCategoryRules),
    revenuePartners: mergeRevenuePartnerDirectory(stored?.revenuePartners ?? []),
    transactionTeamAssignments: normalizedTeamAssignments(stored?.transactionTeamAssignments),
    wiseCardHolderTeamAssignments: mergeWiseCardHolderTeamAssignments(stored?.wiseCardHolderTeamAssignments ?? []),
    wiseStatementTransactions: allTransactions,
    wiseStatementImports: stored?.wiseStatementImports ?? [],
    revenueRuns: stored?.revenueRuns ?? [],
    revenueAccruals: stored?.revenueAccruals ?? [],
    paymentAllocations: stored?.paymentAllocations ?? [],
    holdings: stored?.holdings ?? [],
    fxRates: stored?.fxRates ?? [],
    fxTrackedAssets: stored?.fxTrackedAssets ?? [],
    automationRuns: stored?.automationRuns ?? [],
    profitDistributionAdjustments: stored?.profitDistributionAdjustments ?? [],
    aiSettings: stored?.aiSettings ?? { ...defaultAiSettings },
    bankAccounts: [...revolut.accounts, ...slash.accounts],
    bankSyncStates: {
      ...(revolut.syncState ? { revolut: revolut.syncState } : {}),
      ...(slash.syncState ? { slash: slash.syncState } : {})
    },
    bankTransactionBaseline: new Map(
      cachedTransactions.map((transaction) => [transaction.id, JSON.stringify(transaction)])
    ),
    dirtyBankTransactionIds: new Set()
  };
  if (
    JSON.stringify(state.transactionCategoryRules) !== JSON.stringify(storedCategoryRules)
    || JSON.stringify(sanitizedStoredTransactions) !== JSON.stringify(storedTransactions)
  ) {
    await savePersisted(env, state);
  }
  return state;
}

async function saveBankTransactionUpdates(
  env: Env,
  state: PersistedState
): Promise<void> {
  const changed = state.wiseStatementTransactions.filter(
    (transaction): transaction is Transaction & { source: SyncedBankSource } =>
      (transaction.source === "revolut" || transaction.source === "slash")
      && state.dirtyBankTransactionIds.has(transaction.id)
      && state.bankTransactionBaseline.get(transaction.id) !== JSON.stringify(transaction)
  );
  for (let index = 0; index < changed.length; index += bankMutationBatchSize) {
    const transactions = changed.slice(index, index + bankMutationBatchSize);
    await getConvexClient(env).mutation(api.banking.saveTransactionUpdates, {
      serviceToken: getConvexServiceToken(env),
      transactions
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
    bankAccounts: _bankAccounts,
    bankSyncStates: _bankSyncStates,
    bankTransactionBaseline: _bankTransactionBaseline,
    dirtyBankTransactionIds: _dirtyBankTransactionIds,
    ...dashboardState
  } = state;
  dashboardState.wiseStatementTransactions = transactionsForDashboardStorage(
    dashboardState.wiseStatementTransactions
  );
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
      transactionCount: dashboardState.wiseStatementTransactions.length,
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
  if (confirmation !== "DELETE_WISE_TRANSACTIONS") {
    throw new ApiError(400, "Explicit DELETE_WISE_TRANSACTIONS confirmation is required");
  }
  return getConvexClient(env).mutation(api.dashboard.resetWiseImports, {
    serviceToken: getConvexServiceToken(env)
  });
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
  const wiseNeeds = ["WISE_API_TOKEN", "WISE_PROFILE_IDS"].filter((name) => !env[name as keyof Env]);
  const wiseBalanceIssue = wiseNeeds.length === 0 ? wiseActivity?.balanceIssue : undefined;

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
          ? "Transactions refresh every 15 minutes, are saved in Convex, and are categorized automatically."
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
          ? "Transactions refresh every 15 minutes and are categorized automatically; older dates are backfilled when requested."
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

async function bankSyncState(
  env: Env,
  source: SyncedBankSource
): Promise<BankSyncState | null> {
  return getConvexClient(env).query(api.banking.getSyncState, {
    serviceToken: getConvexServiceToken(env),
    source
  });
}

function incrementalBankDateRange(
  state: BankSyncState | null,
  now = Date.now()
): SlashTransactionDateRange {
  const current = defaultBankDateRange(now);
  if (!state) return current;
  return {
    fromDate: isoDateShift(state.lastSyncedAt.slice(0, 10), 1 - bankSyncOverlapDays),
    toDate: current.toDate
  };
}

async function persistBankActivity(
  env: Env,
  source: SyncedBankSource,
  activity: { accounts: AccountBalance[]; transactions: Transaction[] },
  dateRange: SlashTransactionDateRange
): Promise<string[]> {
  const convex = getConvexClient(env);
  const serviceToken = getConvexServiceToken(env);
  const syncedAt = new Date().toISOString();
  const accounts = activity.accounts.map((account) => ({ ...account, source }));
  const transactions = activity.transactions.map((transaction) => ({ ...transaction, source }));
  const batches = Math.max(1, Math.ceil(transactions.length / bankMutationBatchSize));
  for (let batch = 0; batch < batches; batch += 1) {
    await convex.mutation(api.banking.upsertActivityBatch, {
      serviceToken,
      source,
      accounts: batch === 0 ? accounts : [],
      transactions: transactions.slice(
        batch * bankMutationBatchSize,
        (batch + 1) * bankMutationBatchSize
      ),
      syncedAt
    });
  }
  await convex.mutation(api.banking.completeSync, {
    serviceToken,
    source,
    fromDate: dateRange.fromDate,
    toDate: dateRange.toDate,
    syncedAt
  });
  return transactions.map((transaction) => transaction.id);
}

async function syncRevolutActivity(
  env: Env,
  dateRange?: RevolutTransactionDateRange
): Promise<string[]> {
  const range = dateRange ?? incrementalBankDateRange(await bankSyncState(env, "revolut"));
  const activity = await fetchRevolutActivity(env, range);
  return persistBankActivity(env, "revolut", activity, range);
}

async function syncSlashActivity(
  env: Env,
  dateRange?: SlashTransactionDateRange
): Promise<string[]> {
  const range = dateRange ?? incrementalBankDateRange(await bankSyncState(env, "slash"));
  const activity = await fetchSlashActivity(env, range);
  return persistBankActivity(env, "slash", activity, range);
}

async function syncLatestBankActivity(env: Env): Promise<void> {
  const results = await Promise.allSettled([
    syncRevolutActivity(env),
    syncSlashActivity(env)
  ]);
  const failures = results.filter((result) => result.status === "rejected");
  const transactionIds = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (transactionIds.length > 0) {
    await autoCategorizeStoredTransactions(env, { transactionIds, useAi: true }, 240);
  }
  for (const result of failures) {
    console.error(JSON.stringify({
      event: "bank_sync_failed",
      error: result.reason instanceof Error ? result.reason.message : String(result.reason)
    }));
  }
  if (failures.length > 0) throw failures[0].reason;
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

async function syncBankActivityRanges(
  env: Env,
  source: SyncedBankSource,
  ranges: SlashTransactionDateRange[]
): Promise<string[]> {
  const transactionIds: string[] = [];
  for (const range of ranges) {
    transactionIds.push(
      ...(source === "revolut"
        ? await syncRevolutActivity(env, range)
        : await syncSlashActivity(env, range))
    );
  }
  return transactionIds;
}

async function loadBankActivity(
  env: Env,
  sources: ConnectedBankSource[],
  dateRange: SlashTransactionDateRange
): Promise<BankActivityLoadResult> {
  const convex = getConvexClient(env);
  const serviceToken = getConvexServiceToken(env);
  const [context, initialActivity] = await Promise.all([
    convex.query(api.dashboard.getBankContext, { serviceToken }),
    Promise.all(sources.map((source) => readBankActivity(env, source, dateRange)))
  ]);
  if (!context) throw new ApiError(503, "Dashboard bank context is not initialized");

  const missingBySource = sources.map((source, index) => ({
    source,
    ranges: missingBankActivityRanges(initialActivity[index].syncState, dateRange)
  }));
  const syncedTransactionIds = (await Promise.all(
    missingBySource.map(({ source, ranges }) => syncBankActivityRanges(env, source, ranges))
  )).flat();
  const refreshedBySource = new Map<ConnectedBankSource, Awaited<ReturnType<typeof readBankActivity>>>();
  await Promise.all(
    missingBySource.map(async ({ source, ranges }) => {
      if (ranges.length === 0) return;
      refreshedBySource.set(source, await readBankActivity(env, source, dateRange));
    })
  );
  if (syncedTransactionIds.length > 0) {
    const syncedTransactions = sources.flatMap((source, index) =>
      (refreshedBySource.get(source) ?? initialActivity[index]).transactions
        .filter((transaction) => syncedTransactionIds.includes(transaction.id))
    );
    await autoCategorizeBankTransactions(env, syncedTransactions);
    await Promise.all(
      missingBySource.map(async ({ source, ranges }) => {
        if (ranges.length === 0) return;
        refreshedBySource.set(source, await readBankActivity(env, source, dateRange));
      })
    );
  }

  const transactions = enrichTransactions(
    applyTeamAssignments(
      sources.flatMap((source, index) =>
        (refreshedBySource.get(source) ?? initialActivity[index]).transactions
      ),
      context.transactionTeamAssignments,
      context.wiseCardHolderTeamAssignments
    ),
    mergeProviderDirectory(context.providers),
    sanitizeStoredTransactionCategoryRules(context.transactionCategoryRules)
  ).sort((left, right) => right.date.localeCompare(left.date) || left.id.localeCompare(right.id));

  return {
    fromDate: dateRange.fromDate,
    toDate: dateRange.toDate,
    sources,
    transactions
  };
}

async function getSnapshot(
  env: Env,
  options: { refreshFxRates?: boolean; bankDateRanges?: BankDateRanges } = {}
): Promise<DashboardSnapshot> {
  const bankIssues: Partial<Record<"revolut" | "slash" | "amex", string>> = {};
  const bankIssue = (label: string, error: unknown): string => {
    const message = error instanceof Error ? error.message : String(error);
    return `${label} balance sync failed: ${message.slice(0, 240)}`;
  };
  const statePromise = loadPersisted(env, options.bankDateRanges);
  const wisePromise = fetchWiseActivity(env).catch((error: unknown) => emptyWiseActivity(wiseSyncIssue(error)));
  const amexPromise = fetchAmexActivity(env).catch((error: unknown) => {
    bankIssues.amex = bankIssue("Amex", error);
    return { accounts: [], transactions: [] };
  });
  const state = await statePromise;
  if (
    env.REVOLUT_CLIENT_ID
    && env.REVOLUT_ISSUER
    && env.REVOLUT_PRIVATE_KEY_PEM
    && env.REVOLUT_REFRESH_TOKEN
    && !state.bankSyncStates.revolut
  ) {
    bankIssues.revolut = "No saved Revolut activity yet. The next automatic refresh will create the initial 45-day cache.";
  }
  if (
    env.SLASH_API_KEY
    && env.SLASH_LEGAL_ENTITY_ID
    && env.SLASH_BASE_URL
    && !state.bankSyncStates.slash
  ) {
    bankIssues.slash = "No saved Slash activity yet. The next automatic refresh will create the initial 45-day cache.";
  }
  const revolut = {
    accounts: state.bankAccounts.filter((account) => account.source === "revolut"),
    transactions: state.wiseStatementTransactions.filter((transaction) => transaction.source === "revolut")
  };
  const slash = {
    accounts: state.bankAccounts.filter((account) => account.source === "slash"),
    transactions: state.wiseStatementTransactions.filter((transaction) => transaction.source === "slash")
  };
  const [wise, amex, meritResults] = await Promise.all([
    wisePromise,
    amexPromise,
    Promise.allSettled([
      fetchMeritInvoices(env, state.invoices),
      fetchMeritTaxes(env),
      fetchMeritCustomers(env),
      fetchMeritVendors(env)
    ])
  ]);
  const [meritInvoicesResult, meritTaxesResult, meritCustomersResult, meritVendorsResult] = meritResults;
  const meritConfigured = Boolean(env.MERIT_API_ID && env.MERIT_API_KEY);
  const meritTaxes = meritTaxesResult.status === "fulfilled" ? meritTaxesResult.value : [];
  const meritIssue =
    meritInvoicesResult.status === "rejected"
      ? meritConnectionIssue(meritInvoicesResult.reason)
      : meritTaxesResult.status === "rejected"
        ? meritConnectionIssue(meritTaxesResult.reason)
        : meritCustomersResult.status === "rejected"
          ? meritConnectionIssue(meritCustomersResult.reason)
          : meritVendorsResult.status === "rejected"
            ? meritConnectionIssue(meritVendorsResult.reason)
            : undefined;
  const providersBeforeSync = JSON.stringify(state.providers);
  if (meritConfigured && meritCustomersResult.status === "fulfilled") {
    state.providers = reconcileMeritProviders(state.providers, meritCustomersResult.value, "customer");
  }
  if (meritConfigured && meritVendorsResult.status === "fulfilled") {
    state.providers = reconcileMeritProviders(state.providers, meritVendorsResult.value, "vendor");
  }
  state.providers = mergeProviderDirectory(state.providers);
  const providerStateChanged = JSON.stringify(state.providers) !== providersBeforeSync;
  const liveMeritInvoices = meritInvoicesResult.status === "fulfilled"
    ? linkMeritInvoiceProviders(meritInvoicesResult.value, state.providers)
    : [];
  const accounts = mergeLiveAccounts(wise.accounts, revolut.accounts, slash.accounts, amex.accounts);
  const trackedAssetsBefore = state.fxTrackedAssets.join("|");
  state.fxTrackedAssets = trackedFxAssets(state, accounts, liveMeritInvoices);
  const fxAssetInventoryChanged = state.fxTrackedAssets.join("|") !== trackedAssetsBefore;
  let fxRatesRefreshed = false;
  if (options.refreshFxRates) {
    await updateCurrentFxRates(env, state, accounts, liveMeritInvoices);
    fxRatesRefreshed = true;
  }
  const invoicesBeforeReconciliation = assignMeritStyleDraftNumbers(
    mergeInvoices(
      liveMeritInvoices,
      state.invoices,
      meritConfigured && meritInvoicesResult.status === "fulfilled"
    ),
    liveMeritInvoices
  );
  const liveInvoiceIds = new Set(invoicesBeforeReconciliation.map((invoice) => invoice.id));
  const paymentAllocationsBeforeSync = state.paymentAllocations;
  state.paymentAllocations = state.paymentAllocations.filter((allocation) => liveInvoiceIds.has(allocation.invoiceId));
  const paymentAllocationsChanged = state.paymentAllocations.length !== paymentAllocationsBeforeSync.length;
  const persistedTransactionsBeforeSync = transactionsForDashboardStorage(
    state.wiseStatementTransactions
  );
  const rawTransactions = mergeWiseStatementTransactions(state.wiseStatementTransactions, [
    ...wise.transactions,
    ...amex.transactions
  ]).map((transaction) => {
    if (!transaction.matchedInvoiceId || liveInvoiceIds.has(transaction.matchedInvoiceId)) return transaction;
    const { matchedInvoiceId: _matchedInvoiceId, ...withoutDeletedInvoice } = transaction;
    return withoutDeletedInvoice;
  }).sort((left, right) => right.date.localeCompare(left.date));
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
  const persistedTransactionsAfterSync = transactionsForDashboardStorage(
    reconciliation.transactions
  );
  const bankStateChanged =
    JSON.stringify(persistedTransactionsAfterSync) !== JSON.stringify(persistedTransactionsBeforeSync);
  const invoiceStateChanged = JSON.stringify(invoicesBeforeReconciliation) !== JSON.stringify(state.invoices);
  if (
    reconciliation.matched > 0 ||
    bankStateChanged ||
    invoiceStateChanged ||
    providerStateChanged ||
    paymentAllocationsChanged ||
    fxRatesRefreshed ||
    fxAssetInventoryChanged
  ) {
    state.invoices = reconciliation.invoices;
    state.paymentAllocations = reconciliation.allocations;
    state.wiseStatementTransactions = persistedTransactionsAfterSync;
    await savePersisted(env, state);
  }
  const invoices = reconciliation.invoices;
  const transactions = reconciliation.transactions;
  const receivables = [...openInvoiceReceivables(invoices, reconciliation.allocations), ...state.manualReceivables];
  const payables = expensePayables(state.expenses);
  const approximateUsdTotals = calculateApproximateUsdTotals(accounts, state.holdings, state.fxRates);

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
    transactions,
    invoices,
    expenses: state.expenses,
    paymentAllocations: reconciliation.allocations,
    invoicePredictions: calculateInvoicePredictions(invoices, reconciliation.allocations),
    holdings: state.holdings,
    fxRates: state.fxRates,
    approximateUsdTotals,
    automationRuns: state.automationRuns,
    meritTaxes,
    transactionCategories: state.transactionCategories,
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
    metrics: calculateMetrics(accounts, receivables, [], payables, []),
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
  for (const transaction of state.wiseStatementTransactions) {
    if (
      transaction.matchedProviderId === providerId
      && (transaction.source === "revolut" || transaction.source === "slash")
    ) {
      state.dirtyBankTransactionIds.add(transaction.id);
    }
  }
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
  state.expenses = state.expenses.map((expense) => {
    if (expense.providerId !== providerId) return expense;
    const { providerId: _providerId, ...withoutProvider } = expense;
    return withoutProvider;
  });
  state.wiseStatementTransactions = deletion.wiseStatementTransactions;
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
    throw new Error("Revenue partner team not found");
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
    throw new ApiError(400, "name, Merit customer, revenue category, API environment names, cadence, and billing timezone are required; team rules also require an affiliate ID");
  }
  const state = await loadPersisted(env);
  const provider = state.providers.find((item) => item.id === payload.providerId);
  if (!provider || provider.type !== "client" || !provider.meritCustomerId) {
    throw new ApiError(400, "Revenue rules require a customer imported from Merit");
  }
  if (payload.teamId && !state.teams.some((team) => team.id === payload.teamId)) {
    throw new ApiError(400, "Revenue rule team not found");
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
    throw new ApiError(409, "A revenue rule already exists for this company and team");
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
  return !isRequiredTransactionCategory(
    transaction.category,
    transaction.direction,
    categories
  );
}

function transactionNeedsCategorization(
  transaction: Transaction,
  categories: readonly Pick<TransactionCategory, "name" | "direction">[]
): boolean {
  return transaction.classificationComplete !== true
    || transactionCategoryNeedsReview(transaction, categories)
    || !transaction.merchantName?.trim();
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
    if (!transactionNeedsCategorization(transaction, state.transactionCategories)) return transaction;
    reviewed += 1;
    const categorized = semanticCategorizeTransaction(transaction, state.providers, state.transactionCategoryRules);
    if (
      (transaction.source === "revolut" || transaction.source === "slash")
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
  const remaining = state.wiseStatementTransactions.filter((transaction) => {
    if (targetIds && !targetIds.has(transaction.id)) return false;
    return transactionNeedsCategorization(transaction, state.transactionCategories);
  });

  if (shouldUseAi && remaining.length > 0) {
    const aiResults = await runOpenRouterTransactionCategorization(
      activeAiSettings,
      remaining,
      aiProviderDirectoryForTransactions(remaining, state.providers),
      env.PUBLIC_APP_URL,
      state.transactionCategories
    );
    for (const aiResult of aiResults) {
      const transaction = findPersistedTransaction(state, aiResult.transactionId);
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

async function autoCategorizeBankTransactions(
  env: Env,
  transactions: Transaction[],
  limit = 240
): Promise<Omit<AutoCategorizeTransactionsResult, "dashboard"> | undefined> {
  const state = await loadPersisted(env);
  const candidates = transactions
    .filter((transaction) => transactionNeedsCategorization(transaction, state.transactionCategories))
    .slice(0, limit);
  if (candidates.length === 0) return undefined;
  for (const transaction of candidates) {
    const existing = findPersistedTransaction(state, transaction.id);
    state.wiseStatementTransactions = existing
      ? state.wiseStatementTransactions.map((item) => item.id === transaction.id ? transaction : item)
      : [transaction, ...state.wiseStatementTransactions];
    state.bankTransactionBaseline.set(transaction.id, JSON.stringify(transaction));
  }
  const summary = await autoCategorizeState(env, state, {
    transactionIds: candidates.map((transaction) => transaction.id),
    useAi: true
  });
  const candidateIds = new Set(candidates.map((transaction) => transaction.id));
  const updates = state.wiseStatementTransactions.filter(
    (transaction): transaction is Transaction & { source: SyncedBankSource } =>
      candidateIds.has(transaction.id)
      && (transaction.source === "revolut" || transaction.source === "slash")
  );
  for (let index = 0; index < updates.length; index += bankMutationBatchSize) {
    await getConvexClient(env).mutation(api.banking.saveTransactionUpdates, {
      serviceToken: getConvexServiceToken(env),
      transactions: updates.slice(index, index + bankMutationBatchSize)
    });
  }
  return summary;
}

async function categorizeHistoricalBankBacklog(
  env: Env,
  limit = 240
): Promise<{ processed: number; hasMore: boolean }> {
  const backlog = await getConvexClient(env).query(api.banking.getClassificationBacklog, {
    serviceToken: getConvexServiceToken(env),
    limit
  });
  if (backlog.transactions.length > 0) {
    await autoCategorizeBankTransactions(env, backlog.transactions);
  }
  console.log(JSON.stringify({
    event: "transaction_classification_backlog",
    processed: backlog.transactions.length,
    hasMore: backlog.hasMore
  }));
  return { processed: backlog.transactions.length, hasMore: backlog.hasMore };
}

async function categorizeHistoricalWiseBacklog(
  env: Env,
  limit = 240
): Promise<{ processed: number; hasMore: boolean }> {
  const state = await loadPersisted(env);
  const candidates = state.wiseStatementTransactions
    .filter((transaction) => transaction.source === "wise" && transaction.classificationComplete !== true);
  const batch = candidates.slice(0, limit);
  if (batch.length > 0) {
    await autoCategorizeState(env, state, {
      transactionIds: batch.map((transaction) => transaction.id),
      useAi: true
    });
    await savePersisted(env, state);
  }
  console.log(JSON.stringify({
    event: "wise_transaction_classification_backlog",
    processed: batch.length,
    hasMore: candidates.length > batch.length
  }));
  return { processed: batch.length, hasMore: candidates.length > batch.length };
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
    await categorizeHistoricalWiseBacklog(env);
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
  const state = await loadPersisted(env);
  const requestedIds = payload.transactionIds?.length ? new Set(payload.transactionIds) : undefined;
  const limitedIds = limit
    ? state.wiseStatementTransactions
        .filter(
          (transaction) =>
            (!requestedIds || requestedIds.has(transaction.id))
            && transactionNeedsCategorization(transaction, state.transactionCategories)
        )
        .slice(0, limit)
        .map((transaction) => transaction.id)
    : payload.transactionIds;
  if (limit && limitedIds?.length === 0) {
    return { semanticMatches: 0, aiMatches: 0, categorizedOnly: 0, reviewed: 0 };
  }
  const summary = await autoCategorizeState(env, state, {
    ...payload,
    transactionIds: limitedIds
  });
  await savePersisted(env, state);
  return summary;
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
    state.wiseStatementTransactions = state.wiseStatementTransactions.map((item) =>
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
    await getConvexClient(env).mutation(api.banking.applyMerchantCompany, {
      serviceToken: getConvexServiceToken(env),
      merchantKey: transactionMerchantKey(transaction),
      merchantName: transaction.merchantName,
      direction: transaction.direction,
      providerId: provider.id
    });
  }
  upsertPersistedTransaction(state, matchedTransaction);
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
    state.wiseStatementTransactions = state.wiseStatementTransactions.map((item) =>
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
    await getConvexClient(env).mutation(api.banking.applyMerchantCategory, {
      serviceToken: getConvexServiceToken(env),
      merchantKey: transactionMerchantKey(transaction),
      merchantName: transaction.merchantName,
      direction: transaction.direction,
      category
    });
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

async function assignWiseCardHolderTeam(
  env: Env,
  payload: AssignWiseCardHolderTeamPayload
): Promise<WiseCardHolderTeamAssignment> {
  const state = await loadPersisted(env);
  const cardHolderName = payload.cardHolderName.trim().replace(/\s+/g, " ");
  const teamId = canonicalTeamId(payload.teamId);
  if (!cardHolderName) {
    throw new Error("Card holder name is required");
  }
  if (!state.teams.some((team) => team.id === teamId)) {
    throw new Error("Team not found");
  }

  const assignment: WiseCardHolderTeamAssignment = {
    cardHolderName,
    teamId,
    updatedAt: new Date().toISOString()
  };
  state.wiseCardHolderTeamAssignments = mergeWiseCardHolderTeamAssignments([
    ...state.wiseCardHolderTeamAssignments.filter(
      (assignment) => normalizeCardHolderName(assignment.cardHolderName) !== normalizeCardHolderName(cardHolderName)
    ),
    assignment
  ]);

  await savePersisted(env, state);
  return assignment;
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
  try {
    return await convex.mutation(api.dashboard.updateTransactionCategory, {
      serviceToken: getConvexServiceToken(env),
      id: categoryId,
      ...payload
    });
  } catch (error) {
    categoryMutationError(error);
  }
}

async function deleteTransactionCategoryDefinition(env: Env, categoryId: string): Promise<TransactionCategory[]> {
  const convex = getConvexClient(env);
  try {
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
    throw new ApiError(400, "Expense team not found");
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
    if (expense.teamId) {
      state.transactionTeamAssignments = [
        { transactionId: transaction.id, teamId: expense.teamId, updatedAt: createdAt },
        ...state.transactionTeamAssignments.filter((assignment) => assignment.transactionId !== transaction.id)
      ];
    }
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
  if (expense.teamId) {
    state.transactionTeamAssignments = [
      { transactionId: transaction.id, teamId: expense.teamId, updatedAt },
      ...state.transactionTeamAssignments.filter((assignment) => assignment.transactionId !== transaction.id)
    ];
  }
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
    ...state.revenueAccruals.map((accrual) => accrual.currency),
    ...state.wiseStatementTransactions.map((transaction) => transaction.currency)
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

function requestedBankDateRanges(url: URL): BankDateRanges {
  try {
    return {
      revolut: parseRevolutTransactionDateRange(
        url.searchParams.get("revolutFromDate"),
        url.searchParams.get("revolutToDate")
      ),
      slash: parseSlashTransactionDateRange(
        url.searchParams.get("slashFromDate"),
        url.searchParams.get("slashToDate")
      )
    };
  } catch (error) {
    throw new ApiError(400, error instanceof Error ? error.message : "Invalid bank transaction date range");
  }
}

function bankActivityRequest(value: unknown): {
  dateRange: SlashTransactionDateRange;
  sources: ConnectedBankSource[];
} {
  if (!isRecord(value)) throw new ApiError(400, "Bank activity request is required");
  const rawSources = value.sources;
  if (!Array.isArray(rawSources) || rawSources.length === 0) {
    throw new ApiError(400, "Choose at least one bank source");
  }
  const sources: ConnectedBankSource[] = [];
  for (const source of rawSources) {
    if (source !== "revolut" && source !== "slash") {
      throw new ApiError(400, "Bank activity sources must be Revolut or Slash");
    }
    if (!sources.includes(source)) sources.push(source);
  }
  try {
    const dateRange = parseSlashTransactionDateRange(
      typeof value.fromDate === "string" ? value.fromDate : undefined,
      typeof value.toDate === "string" ? value.toDate : undefined
    );
    if (!dateRange) throw new ApiError(400, "Bank activity from and to dates are required");
    return { dateRange, sources };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const message = error instanceof Error
      ? error.message.replaceAll("Slash", "Bank activity")
      : "Invalid bank activity date range";
    throw new ApiError(400, message);
  }
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  try {
    if (url.pathname === "/api/health") {
      return json({ ok: true, service: "finance-dash-worker", time: new Date().toISOString() });
    }

    if (url.pathname === "/api/dashboard" && request.method === "GET") {
      return json(await getSnapshot(env, { bankDateRanges: requestedBankDateRanges(url) }));
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
      await syncLatestBankActivity(env);
      return json(await getSnapshot(env, {
        refreshFxRates: true,
        bankDateRanges: requestedBankDateRanges(url)
      }));
    }

    if (url.pathname === "/api/banks/activity" && request.method === "POST") {
      const startedAt = Date.now();
      const { dateRange, sources } = bankActivityRequest(await request.json());
      const result = await loadBankActivity(env, sources, dateRange);
      const durationMs = Date.now() - startedAt;
      console.log(JSON.stringify({
        event: "bank_activity_loaded",
        durationMs,
        fromDate: result.fromDate,
        toDate: result.toDate,
        sources: result.sources,
        transactions: result.transactions.length
      }));
      return json(result, {
        headers: { "server-timing": `bank-activity;dur=${durationMs}` }
      });
    }

    if (url.pathname === "/api/merit/default-taxes/sync" && request.method === "POST") {
      return json(await syncMeritTaxDefaults(env));
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
    const authenticationResponse = await enforceSiteAuthentication(request, env);
    if (authenticationResponse) return authenticationResponse;

    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env);
    }
    return env.ASSETS.fetch(request);
  },
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const failures: unknown[] = [];
    if (controller.cron === "*/1 * * * *") {
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
    }
    if (controller.cron === "*/15 * * * *") {
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
} satisfies WorkerExportedHandler;
