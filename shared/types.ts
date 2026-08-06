export type DataSource = "wise" | "revolut" | "slash" | "amex" | "merit" | "manual" | "tune";

export type BankTransactionSource = Extract<DataSource, "wise" | "revolut" | "slash" | "amex">;

export type Direction = "in" | "out";

export type WiseEntity = "dn" | "lmd";

export type ProviderType = "client" | "supplier";

export type InvoiceStatus = "draft" | "open" | "paid";

export type InvoiceDocumentType = "sales_invoice" | "supplier_bill";

export type RevenuePeriodPreset = "last-week" | "this-week" | "last-7-days" | "this-month" | "custom";

export type RevenueRunStatus = "pulled" | "drafted" | "invoicing" | "invoiced" | "failed" | "skipped";

export type BillingCadence = "weekly" | "monthly";

export type MeritSendMode = "save" | "deliver";

export type MeritDeliveryStatus = "not-sent" | "saved" | "delivered" | "delivery-failed";

export type PaymentSource = "wise" | "revolut" | "slash" | "amex" | "cash" | "kraken" | "trust" | "other";

export type HoldingKind = "cash" | "exchange" | "wallet";

export type HoldingAssetType = "fiat" | "crypto";

export type ExpenseRecordType = "paid_expense" | "supplier_bill";

export type ExpensePaymentStatus = "paid" | "unpaid";

export type ExpenseDocumentKind = "vendor_receipt" | "vendor_invoice" | "missing_receipt_declaration";

export type ExpenseVatTreatment = "standard" | "reduced" | "zero" | "exempt" | "reverse_charge" | "not_applicable";

export type CurrencyTotals = Record<string, number>;

export type SlashAccountSubtype = "cash" | "credit";

export interface AccountBalance {
  id: string;
  name: string;
  source: DataSource;
  wiseEntity?: WiseEntity;
  slashAccountSubtype?: SlashAccountSubtype;
  balance: number;
  currency: string;
  updatedAt: string;
  status: "live" | "seeded" | "manual";
}

export interface LedgerItem {
  id: string;
  name: string;
  balance: number;
  currency: string;
  source: DataSource;
  notes?: string;
  dueDate?: string;
}

export interface CreateManualReceivablePayload {
  name: string;
  amount: number;
  currency: string;
}

export interface Payable {
  id: string;
  supplier: string;
  balance: number;
  currency: string;
  category: string;
  monthBuckets: Record<string, number>;
  aliases: string[];
}

export interface Investment {
  id: string;
  name: string;
  balance: number;
  currency: string;
  notes?: string;
}

export interface MeritCompanyComment {
  date?: string;
  text: string;
}

export interface MeritCompanyDimension {
  id?: string;
  dimensionId?: string;
  dimensionValueId?: string;
  code?: string;
}

export interface MeritCompanyDetails {
  relationship: "customer" | "vendor";
  registrationNumber?: string;
  contactName?: string;
  phone?: string;
  secondaryPhone?: string;
  city?: string;
  county?: string;
  postalCode?: string;
  countryName?: string;
  fax?: string;
  website?: string;
  bankName?: string;
  bankAccount?: string;
  referenceNumber?: string;
  invoiceLanguage?: string;
  groupId?: string;
  groupName?: string;
  changedDate?: string;
  invoiceSendPreference?: string;
  glnCode?: string;
  partyCode?: string;
  telemaEdi?: string;
  vendorType?: number;
  notTaxDomesticCustomer?: boolean;
  taxRegistered?: boolean;
  overdueCharge?: number;
  comments?: MeritCompanyComment[];
  dimensions?: MeritCompanyDimension[];
}

export interface Provider {
  id: string;
  name: string;
  type: ProviderType;
  tags: string[];
  aliases: string[];
  defaultAccount?: string;
  legalName?: string;
  email?: string;
  country?: string;
  address?: string;
  taxId?: string;
  defaultCurrency?: string;
  paymentTermsDays?: number;
  meritCustomerId?: string;
  meritSupplierId?: string;
  defaultMeritTaxId?: string;
  defaultMeritTaxSource?: "merit-history" | "manual";
  defaultMeritTaxSampleSize?: number;
  defaultMeritTaxUpdatedAt?: string;
  meritDetails?: MeritCompanyDetails;
  source: DataSource;
  createdAt: string;
}

export interface Team {
  id: string;
  name: string;
  createdAt: string;
}

export interface RevenuePartner {
  id: string;
  providerId: string;
  teamId?: string;
  name: string;
  revenueCategory?: string;
  source: "tune";
  affiliateId: string;
  externalId?: string;
  currency: string;
  timezone: string;
  networkTimezone: string;
  networkIdEnv: string;
  apiKeyEnv: string;
  apiBaseUrlEnv?: string;
  meritCustomerName?: string;
  invoiceDueDays: number;
  billingCadence: BillingCadence;
  billingTimezone: string;
  autoDraft: boolean;
  defaultMeritTaxId?: string;
  defaultMeritItemCode?: string;
  enabled: boolean;
  createdAt: string;
}

export interface AiSettings {
  provider: "openrouter";
  model: string;
  apiKeyConfigured: boolean;
  updatedAt?: string;
}

export interface PersistedAiSettings {
  provider: "openrouter";
  model: string;
  updatedAt?: string;
}

export interface StoredAiSettings extends PersistedAiSettings {
  openRouterApiKey?: string;
}

export interface OpenRouterZdrModel {
  id: string;
  name: string;
  contextLength?: number;
}

export interface RevenueRun {
  id: string;
  partnerId: string;
  providerId?: string;
  partnerName: string;
  revenueCategory?: string;
  teamId?: string;
  teamName?: string;
  source: "tune";
  periodStart: string;
  periodEnd: string;
  timezone: string;
  revenue: number;
  currency: string;
  clicks?: number;
  conversions?: number;
  status: RevenueRunStatus;
  invoiceId?: string;
  externalInvoiceId?: string;
  error?: string;
  createdAt: string;
}

export interface RevenueAccrual {
  id: string;
  partnerId: string;
  providerId?: string;
  partnerName: string;
  billingCadence: BillingCadence;
  periodStart: string;
  periodEnd: string;
  accruedThrough: string;
  amount: number;
  currency: string;
  status: "accruing" | "drafted";
  revenueRunId: string;
  invoiceId?: string;
  updatedAt: string;
}

export interface TransactionTeamAssignment {
  transactionId: string;
  teamId: string;
  updatedAt: string;
}

export interface WiseCardHolderTeamAssignment {
  cardHolderName: string;
  teamId: string;
  updatedAt: string;
}

export interface TransactionCategoryRule {
  id: string;
  category: string;
  direction?: Direction;
  aliases: string[];
  createdAt: string;
  updatedAt: string;
}

export type TransactionCategoryDirection = Direction | "both";

export interface TransactionCategory {
  id: string;
  name: string;
  direction: TransactionCategoryDirection;
  color: string;
  system: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Invoice {
  id: string;
  providerId?: string;
  documentType: InvoiceDocumentType;
  origin: "manual" | "revenue" | "merit";
  customerName: string;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  meritStatus?: "open" | "paid";
  meritDeliveryStatus: MeritDeliveryStatus;
  meritDeliveryError?: string;
  sendError?: string;
  meritCreationReservedAt?: string;
  invoiceNumber: string;
  issueDate: string;
  dueDate: string;
  source: DataSource;
  externalId?: string;
  description: string;
  transactionId?: string;
  billingRuleId?: string;
  revenueRunIds: string[];
  periodStart?: string;
  periodEnd?: string;
  taxId?: string;
  sentAt?: string;
  paidAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentAllocation {
  id: string;
  invoiceId: string;
  transactionId?: string;
  amount: number;
  currency: string;
  source: PaymentSource;
  accountName?: string;
  reference?: string;
  note?: string;
  mode: "automatic" | "manual";
  confidence?: number;
  matchReason?: string;
  paidAt: string;
  createdAt: string;
}

export interface InvoicePaymentPrediction {
  invoiceId: string;
  sampleSize: number;
  predictedDate?: string;
  medianDays?: number;
  earliestDays?: number;
  latestDays?: number;
}

export interface ExpenseDocument {
  id: string;
  kind: ExpenseDocumentKind;
  fileName: string;
  contentType: string;
  size: number;
  storageId: string;
  createdAt: string;
}

export interface ExpenseRecord {
  id: string;
  recordNumber: string;
  recordType: ExpenseRecordType;
  paymentStatus: ExpensePaymentStatus;
  transactionId?: string;
  providerId?: string;
  teamId?: string;
  supplierName: string;
  supplierRegistrationNumber?: string;
  supplierVatNumber?: string;
  sourceDocumentNumber?: string;
  issueDate: string;
  transactionDate?: string;
  dueDate?: string;
  paidAt?: string;
  category: string;
  businessPurpose: string;
  description: string;
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
  vatRate?: number;
  vatTreatment: ExpenseVatTreatment;
  currency: string;
  missingDocumentReason?: string;
  declarationConfirmedAt?: string;
  documents: ExpenseDocument[];
  createdAt: string;
  updatedAt: string;
}

export interface Holding {
  id: string;
  name: string;
  kind: HoldingKind;
  assetType: HoldingAssetType;
  asset: string;
  balance: number;
  notes?: string;
  updatedAt: string;
}

export interface FxRate {
  asset: string;
  rateUsd: number;
  provider: "coinbase" | "yahoo";
  asOf: string;
  checkedAt?: string;
  stale?: boolean;
}

export interface ApproximateUsdTotals {
  accountsUsd: number;
  holdingsUsd: number;
  totalUsd: number;
  excludedAssets: string[];
  staleAssets: string[];
  asOf?: string;
}

export interface AutomationRun {
  id: string;
  type: "weekly-income";
  periodStart: string;
  periodEnd: string;
  timezone: "Asia/Beirut";
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt?: string;
  error?: string;
}

export interface MeritTax {
  id: string;
  code: string;
  name: string;
  taxPct: number;
}

export interface Transaction {
  id: string;
  /** Ingestion-only alias used to atomically rekey a pre-v2 provider row. */
  providerLegacyId?: string;
  source: DataSource;
  wiseEntity?: WiseEntity;
  slashAccountSubtype?: SlashAccountSubtype;
  /** Immutable provider account identity used for coverage and connection isolation. */
  accountId?: string;
  accountName: string;
  date: string;
  description: string;
  rawName: string;
  counterparty: string;
  cardHolderName?: string;
  /** Immutable provider card identity used to distinguish cards with the same last four digits. */
  cardId?: string;
  cardLastFour?: string;
  amount: number;
  currency: string;
  cashback?: {
    amount: number;
    rate: number;
  };
  direction: Direction;
  status: "posted" | "pending" | "settled" | "voided";
  category: string;
  merchantName?: string;
  merchantKey?: string;
  classificationComplete?: boolean;
  categorySource?: "ai" | "rule" | "manual";
  categoryConfidence?: number;
  categoryReason?: string;
  matchedProviderId?: string;
  companyMatchSource?: "ai" | "rule" | "manual";
  companyConfidence?: number;
  companyMatchReason?: string;
  matchedInvoiceId?: string;
  teamId?: string;
  confidence?: number;
  matchReason?: string;
}

export interface WiseStatementImport {
  id: string;
  balanceId: string;
  wiseEntity?: WiseEntity;
  accountName?: string;
  currency: string;
  periodStart: string;
  periodEnd: string;
  fileName: string;
  transactionCount: number;
  importedAt: string;
}

export interface IntegrationStatus {
  id: DataSource | "openrouter" | "coinbase";
  label: string;
  configured: boolean;
  mode: "live" | "partial";
  message: string;
  needs: string[];
  issue?: string;
  writeEnabled?: boolean;
}

export interface Metrics {
  totalCash: CurrencyTotals;
  totalReceivables: CurrencyTotals;
  totalOpenBalance: CurrencyTotals;
  totalPayables: CurrencyTotals;
  totalFloat: CurrencyTotals;
  netOperatingAssets: CurrencyTotals;
  investments: CurrencyTotals;
  totalAssets: CurrencyTotals;
  monthTotals: Record<string, CurrencyTotals>;
}

export interface RevenueMetrics {
  totalRevenue: CurrencyTotals;
  invoicedRevenue: CurrencyTotals;
  pendingRevenue: CurrencyTotals;
  failedRuns: number;
  partnerCount: number;
  lastRunAt?: string;
}

export type ProfitDistributionPartnerId = "ishan" | "ben" | "sanjan" | "amin";

export type ProfitDistributionBucket = "profit-share" | "salary" | "distribution";

export interface ProfitDistributionAdjustment {
  id: string;
  month: string;
  currency: string;
  partnerId: ProfitDistributionPartnerId;
  bucket: ProfitDistributionBucket;
  waived: boolean;
  deferred: boolean;
  overrideAmount?: number;
  note?: string;
  updatedAt: string;
}

export interface ProfitDistributionPartnerLedger {
  partnerId: ProfitDistributionPartnerId;
  partnerName: string;
  entityName?: string;
  currency: string;
  profitSharePayable: number;
  salaryPayable: number;
  distributionPayable: number;
  totalPayable: number;
  profitSharePaid: number;
  salaryPaid: number;
  distributionPaid: number;
  totalPaid: number;
  remaining: number;
  hasAdjustment: boolean;
  hasDeferred: boolean;
}

export interface ProfitDistributionMonthLedger {
  id: string;
  month: string;
  currency: string;
  revenue: number;
  generalCosts: number;
  netProfitAfterGeneralCosts: number;
  ishanProfitShare: number;
  salaryDeductions: number;
  profitAvailableForDistribution: number;
  distributionPool: number;
  partners: ProfitDistributionPartnerLedger[];
}

export interface ProfitDistributionCurrencySummary {
  currency: string;
  totalPayable: number;
  totalPaid: number;
  remaining: number;
}

export interface ProfitDistributionSnapshot {
  partners: ProfitDistributionPartnerLedger[];
  months: ProfitDistributionMonthLedger[];
  currencies: ProfitDistributionCurrencySummary[];
  adjustments: ProfitDistributionAdjustment[];
}

export interface DashboardSnapshot {
  asOf: string;
  accounts: AccountBalance[];
  receivables: LedgerItem[];
  openBalances: LedgerItem[];
  payables: Payable[];
  investments: Investment[];
  providers: Provider[];
  teams: Team[];
  revenuePartners: RevenuePartner[];
  revenueRuns: RevenueRun[];
  revenueAccruals: RevenueAccrual[];
  revenueMetrics: RevenueMetrics;
  aiSettings: AiSettings;
  transactionReviewPreview: Transaction[];
  invoices: Invoice[];
  expenses: ExpenseRecord[];
  paymentAllocations: PaymentAllocation[];
  invoicePredictions: InvoicePaymentPrediction[];
  holdings: Holding[];
  fxRates: FxRate[];
  approximateUsdTotals: ApproximateUsdTotals;
  automationRuns: AutomationRun[];
  meritTaxes: MeritTax[];
  transactionCategories: TransactionCategory[];
  transactionCategoryRules: TransactionCategoryRule[];
  wiseStatementImports: WiseStatementImport[];
  integrationStatus: IntegrationStatus[];
  metrics: Metrics;
  profitDistribution: ProfitDistributionSnapshot;
  lastSync: string;
}

export interface ImportWiseStatementPayload {
  balanceId: string;
  accountId: string;
  wiseEntity: WiseEntity;
  accountName: string;
  currency: string;
  periodStart: string;
  periodEnd: string;
  fileName: string;
  transactions: Transaction[];
}

export interface ImportWiseStatementSummary {
  processedTransactions: number;
  newTransactions: number;
  duplicateTransactions: number;
}

export type ConnectedBankSource = Extract<DataSource, "revolut" | "slash">;

export interface TransactionPage {
  fromDate: string;
  toDate: string;
  source?: BankTransactionSource;
  direction?: Direction;
  transactions: Transaction[];
  continueCursor: string | null;
  isDone: boolean;
  coverage?: Array<{
    source: BankTransactionSource;
    missingRanges: Array<{ fromDate: string; toDate: string }>;
  }>;
}

/** Exact money and review totals for one bounded Analytics dimension. */
export interface BankAnalyticsAggregate {
  transactionCount: number;
  moneyInTransactionCount: number;
  moneyOutTransactionCount: number;
  matchedTransactionCount: number;
  needsReviewCount: number;
  moneyIn: CurrencyTotals;
  moneyOut: CurrencyTotals;
  moneyInTransactionCounts: Record<string, number>;
  moneyOutTransactionCounts: Record<string, number>;
}

export interface BankAnalyticsCategoryBreakdown extends BankAnalyticsAggregate {
  category: string;
}

export interface BankAnalyticsCategoryCompany {
  companyKey: string;
  providerId?: string;
  merchantName: string;
  amount: number;
  transactionCount: number;
}

/** One bounded page of exact merchant/company contributions for a category slice. */
export interface BankAnalyticsCategoryCompaniesPage {
  version: 1;
  fromDate: string;
  toDate: string;
  direction: Direction;
  currency: string;
  category: string;
  companies: BankAnalyticsCategoryCompany[];
  continueCursor: string | null;
  isDone: boolean;
}

export interface BankAnalyticsTeamBreakdown extends BankAnalyticsAggregate {
  teamId: string | null;
  teamName: string;
}

export interface BankAnalyticsSourceBreakdown extends BankAnalyticsAggregate {
  source: BankTransactionSource;
}

export type BankAnalyticsRelationship = ProviderType | "unknown";

export interface BankAnalyticsProviderBreakdown extends BankAnalyticsAggregate {
  providerId: string;
  providerName: string;
  relationship: BankAnalyticsRelationship;
  directoryMatch: boolean;
}

export interface BankAnalyticsRelationshipBreakdown extends BankAnalyticsAggregate {
  relationship: BankAnalyticsRelationship;
}

export interface BankAnalyticsReviewSample {
  id: string;
  date: string;
  direction: Direction;
  amount: number;
  currency: string;
  company: string;
  category: string;
  reason: string;
}

/**
 * A bounded Space-Saving candidate. Its aggregate contains the exact retained
 * contribution; the estimate is used only to rank candidates after evictions.
 */
export interface BankAnalyticsMerchantBreakdown extends BankAnalyticsAggregate {
  merchantKey: string;
  merchantName: string;
  estimatedTransactionCount: number;
  estimateError: number;
}

export interface BankAnalyticsMerchantRollup {
  algorithm: "space-saving";
  rowLimit: number;
  truncated: boolean;
  evictedCandidateCount: number;
  rows: BankAnalyticsMerchantBreakdown[];
  /** Exact aggregate of contributions evicted from the bounded candidate set. */
  other: BankAnalyticsAggregate | null;
}

export interface BankAnalyticsSummary {
  transactionCount: number;
  externalTransactionCount: number;
  internalTransferCount: number;
  matchedTransactionCount: number;
  needsReviewCount: number;
  activeTeamCount: number;
  activeSourceCount: number;
  moneyIn: CurrencyTotals;
  moneyOut: CurrencyTotals;
}

export interface BankPeriodDirectionMetrics {
  transactionCount: number;
  categorizedTransactionCount: number;
  unassignedOwnerTransactionCount: number;
  volume: CurrencyTotals;
}

export interface BankPeriodSourceMetrics {
  source: BankTransactionSource;
  moneyIn: BankPeriodDirectionMetrics;
  moneyOut: BankPeriodDirectionMetrics;
}

export interface BankPeriodWiseEntityMetrics {
  wiseEntity: WiseEntity;
  moneyIn: BankPeriodDirectionMetrics;
  moneyOut: BankPeriodDirectionMetrics;
}

export interface BankPeriodSlashCashbackMetrics {
  eligiblePurchaseCount: number;
  earned: CurrencyTotals;
  eligibleSpend: CurrencyTotals;
  credited: CurrencyTotals;
}

export interface BankPeriodMetrics {
  /** Operating activity only; internal transfers and capital movements are excluded. */
  sources: BankPeriodSourceMetrics[];
  wiseEntities: BankPeriodWiseEntityMetrics[];
  slashCashback: BankPeriodSlashCashbackMetrics;
}

/** Compact response returned by GET /analytics?fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD. */
export interface BankAnalyticsSnapshot {
  version: 2;
  fromDate: string;
  toDate: string;
  generatedAt: string;
  summary: BankAnalyticsSummary;
  categories: BankAnalyticsCategoryBreakdown[];
  teams: BankAnalyticsTeamBreakdown[];
  sources: BankAnalyticsSourceBreakdown[];
  providers: BankAnalyticsProviderBreakdown[];
  relationships: BankAnalyticsRelationshipBreakdown[];
  reviewSamples: BankAnalyticsReviewSample[];
  unmatchedMerchants: BankAnalyticsMerchantRollup;
  bankPeriod: BankPeriodMetrics;
}

export interface ImportWiseStatementResult {
  dashboard: DashboardSnapshot;
  summary: ImportWiseStatementSummary;
}

export interface CreateInvoicePayload {
  transactionId?: string;
  providerId?: string;
  documentType: InvoiceDocumentType;
  customerName: string;
  amount: number;
  currency: string;
  dueDate: string;
  description: string;
  issueDate?: string;
  taxId?: string;
  periodStart?: string;
  periodEnd?: string;
}

export interface UploadedExpenseDocumentPayload {
  kind: Extract<ExpenseDocumentKind, "vendor_receipt" | "vendor_invoice">;
  fileName: string;
  contentType: string;
  size: number;
  storageId: string;
}

export interface CreateExpensePayload {
  recordType: ExpenseRecordType;
  paymentStatus: ExpensePaymentStatus;
  transactionId?: string;
  providerId?: string;
  teamId?: string;
  supplierName: string;
  supplierRegistrationNumber?: string;
  supplierVatNumber?: string;
  sourceDocumentNumber?: string;
  issueDate: string;
  transactionDate?: string;
  dueDate?: string;
  category: string;
  businessPurpose: string;
  description: string;
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
  vatRate?: number;
  vatTreatment: ExpenseVatTreatment;
  currency: string;
  document:
    | { mode: "upload"; file: UploadedExpenseDocumentPayload }
    | { mode: "generate_missing_receipt"; reason: string; confirmation: "MISSING_SOURCE_DOCUMENT_CONFIRMED" };
}

export interface MatchExpensePaymentPayload {
  transactionId: string;
}

export interface UpdateInvoicePayload {
  providerId?: string;
  customerName: string;
  amount: number;
  currency: string;
  issueDate: string;
  dueDate: string;
  description: string;
  taxId?: string;
  periodStart?: string;
  periodEnd?: string;
}

export interface DeleteInvoicesPayload {
  invoiceIds: string[];
}

export interface SendInvoicesPayload {
  invoiceIds: string[];
  mode: MeritSendMode;
  confirmation: "SEND_TO_MERIT";
}

export interface SendInvoiceOutcome {
  invoiceId: string;
  status: "saved" | "delivered" | "failed";
  message?: string;
}

export interface SendInvoicesResult {
  dashboard: DashboardSnapshot;
  outcomes: SendInvoiceOutcome[];
}

export interface RecordInvoicePaymentPayload {
  amount: number;
  paidAt: string;
  source: PaymentSource;
  accountName?: string;
  transactionId?: string;
  reference?: string;
  note?: string;
}

export interface CreateHoldingPayload {
  name: string;
  kind: HoldingKind;
  assetType: HoldingAssetType;
  asset: string;
  balance: number;
  notes?: string;
}

export interface UpdateHoldingPayload extends CreateHoldingPayload {}

export interface MatchTransactionPayload {
  transactionId: string;
  providerId: string;
  invoiceId?: string;
  scope: TransactionOverrideScope;
}

export type TransactionOverrideScope = "transaction" | "merchant";

export interface AssignTransactionTeamPayload {
  transactionId: string;
  teamId?: string;
}

export interface CreateTeamPayload {
  name: string;
}

export interface CreateTransactionCategoryPayload {
  name: string;
  direction: TransactionCategoryDirection;
  color: string;
}

export interface UpdateTransactionCategoryDefinitionPayload extends CreateTransactionCategoryPayload {}

export interface UpdateTransactionCategoryPayload {
  transactionId: string;
  category: string;
  scope: TransactionOverrideScope;
}

export interface SaveProfitDistributionAdjustmentPayload {
  month: string;
  currency: string;
  partnerId: ProfitDistributionPartnerId;
  bucket: ProfitDistributionBucket;
  waived?: boolean;
  deferred?: boolean;
  overrideAmount?: number | null;
  note?: string;
}

export interface CreateProviderPayload {
  name: string;
  type: ProviderType;
  tags: string[];
  aliases: string[];
  defaultAccount?: string;
  legalName?: string;
  email?: string;
  country?: string;
  address?: string;
  taxId?: string;
  defaultCurrency?: string;
  paymentTermsDays?: number;
  meritCustomerId?: string;
  meritSupplierId?: string;
  defaultMeritTaxId?: string;
}

export interface UpdateProviderPayload extends CreateProviderPayload {}

export interface UpdateRevenuePartnerPayload {
  name: string;
  providerId: string;
  teamId?: string;
  revenueCategory: string;
  affiliateId: string;
  externalId?: string;
  currency: string;
  timezone: string;
  networkTimezone: string;
  networkIdEnv: string;
  apiKeyEnv: string;
  apiBaseUrlEnv?: string;
  meritCustomerName?: string;
  invoiceDueDays: number;
  billingCadence: BillingCadence;
  billingTimezone: string;
  autoDraft: boolean;
  defaultMeritTaxId?: string;
  defaultMeritItemCode?: string;
  enabled: boolean;
}

export interface CreateRevenuePartnerPayload extends UpdateRevenuePartnerPayload {}

export interface SyncRevenuePayload {
  partnerId?: string;
  teamId?: string;
  partnerLevelOnly?: boolean;
  periodPreset?: RevenuePeriodPreset;
  periodStart?: string;
  periodEnd?: string;
  timezone?: string;
}

export interface RevenuePullResult {
  runs: RevenueRun[];
}

export interface DraftRevenueRunPayload {
  partnerId: string;
  periodStart: string;
  periodEnd: string;
  timezone: string;
}

export interface SendRevenueInvoicePayload {
  confirmation: "SEND_TO_MERIT";
  taxId: string;
}

export interface SaveAiSettingsPayload {
  model: string;
}

export interface AiPromptPayload {
  prompt: string;
  systemPrompt?: string;
}

export interface AiPromptResult {
  output: string;
  model: string;
  createdAt: string;
}

export interface AiTransactionCategorization {
  transactionId: string;
  providerId?: string;
  category: string;
  merchantName: string;
  confidence: number;
  reason: string;
}

export interface AutoCategorizeTransactionsPayload {
  transactionIds?: string[];
  useAi?: boolean;
}

export interface AutoCategorizeTransactionsResult {
  dashboard: DashboardSnapshot;
  semanticMatches: number;
  aiMatches: number;
  categorizedOnly: number;
  reviewed: number;
}
