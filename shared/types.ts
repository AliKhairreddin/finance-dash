export type DataSource = "wise" | "revolut" | "slash" | "amex" | "merit" | "manual" | "mock" | "tune";

export type Direction = "in" | "out";

export type ProviderType = "client" | "supplier";

export type InvoiceStatus = "draft" | "open" | "paid" | "created";

export type InvoiceDocumentType = "sales_invoice" | "supplier_bill";

export type RevenuePeriodPreset = "last-week" | "last-7-days" | "this-month" | "custom";

export type RevenueRunStatus = "pulled" | "invoicing" | "invoiced" | "failed" | "mock" | "skipped";

export type CurrencyTotals = Record<string, number>;

export interface AccountBalance {
  id: string;
  name: string;
  source: DataSource;
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
  providerId?: string;
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

export interface Invoice {
  id: string;
  providerId?: string;
  documentType?: InvoiceDocumentType;
  customerName: string;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  approvalStatus?: "pending" | "approved" | "denied";
  paidLocally?: boolean;
  paidLocallyAt?: string;
  meritPaid?: boolean;
  dueDate: string;
  source: DataSource;
  externalId?: string;
  description: string;
  transactionId?: string;
  createdAt: string;
}

export interface Transaction {
  id: string;
  source: DataSource;
  accountName: string;
  date: string;
  description: string;
  rawName: string;
  counterparty: string;
  cardHolderName?: string;
  amount: number;
  currency: string;
  direction: Direction;
  status: "posted" | "pending" | "settled";
  category: string;
  matchedProviderId?: string;
  matchedInvoiceId?: string;
  teamId?: string;
  confidence?: number;
  matchReason?: string;
}

export interface WiseStatementImport {
  id: string;
  balanceId: string;
  currency: string;
  periodStart: string;
  periodEnd: string;
  fileName: string;
  transactionCount: number;
  importedAt: string;
}

export interface IntegrationStatus {
  id: DataSource | "openrouter";
  label: string;
  configured: boolean;
  mode: "live" | "mock" | "partial";
  message: string;
  needs: string[];
  issue?: string;
}

export interface Metrics {
  totalCash: CurrencyTotals;
  totalReceivables: CurrencyTotals;
  totalOpenBalance: CurrencyTotals;
  totalPayables: CurrencyTotals;
  totalFloat: CurrencyTotals;
  profit: CurrencyTotals;
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
  revenueMetrics: RevenueMetrics;
  aiSettings: AiSettings;
  transactions: Transaction[];
  invoices: Invoice[];
  transactionCategoryRules: TransactionCategoryRule[];
  wiseCardHolderTeamAssignments: WiseCardHolderTeamAssignment[];
  wiseStatementImports: WiseStatementImport[];
  integrationStatus: IntegrationStatus[];
  metrics: Metrics;
  profitDistribution: ProfitDistributionSnapshot;
  lastSync: string;
}

export interface ImportWiseStatementPayload {
  balanceId: string;
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
}

export interface MatchTransactionPayload {
  transactionId: string;
  providerId: string;
  invoiceId?: string;
  rememberAlias: boolean;
}

export interface AssignTransactionTeamPayload {
  transactionId: string;
  teamId?: string;
}

export interface AssignWiseCardHolderTeamPayload {
  cardHolderName: string;
  teamId: string;
}

export interface CreateTeamPayload {
  name: string;
}

export interface UpdateTransactionCategoryPayload {
  transactionId: string;
  category: string;
  rememberAlias: boolean;
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
  enabled: boolean;
}

export interface SyncRevenuePayload {
  partnerId?: string;
  teamId?: string;
  partnerLevelOnly?: boolean;
  periodPreset?: RevenuePeriodPreset;
  periodStart?: string;
  periodEnd?: string;
  timezone?: string;
  createInvoices?: boolean;
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
  category?: string;
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
