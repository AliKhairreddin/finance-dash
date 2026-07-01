export type DataSource = "wise" | "revolut" | "slash" | "merit" | "manual" | "mock" | "tune";

export type Direction = "in" | "out";

export type ProviderType = "partner" | "provider" | "platform" | "internal";

export type InvoiceStatus = "draft" | "open" | "paid" | "created";

export type RevenuePeriodPreset = "last-week" | "last-7-days" | "this-month" | "custom";

export type RevenueRunStatus = "pulled" | "invoiced" | "failed" | "mock" | "skipped";

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
  category: string;
  aliases: string[];
  defaultAccount?: string;
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
  name: string;
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
  apiKeyPreview?: string;
  updatedAt?: string;
}

export interface StoredAiSettings {
  provider: "openrouter";
  model: string;
  openRouterApiKey?: string;
  updatedAt?: string;
}

export interface RevenueRun {
  id: string;
  partnerId: string;
  partnerName: string;
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

export interface Invoice {
  id: string;
  providerId?: string;
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
  totalCash: number | null;
  totalReceivables: number | null;
  totalOpenBalance: number | null;
  totalPayables: number | null;
  totalFloat: number | null;
  profit: number | null;
  investments: number | null;
  totalAssets: number | null;
  monthTotals: Record<string, number>;
}

export interface RevenueMetrics {
  totalRevenue: number | null;
  invoicedRevenue: number | null;
  pendingRevenue: number | null;
  failedRuns: number;
  partnerCount: number;
  lastRunAt?: string;
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
  wiseStatementImports: WiseStatementImport[];
  integrationStatus: IntegrationStatus[];
  metrics: Metrics;
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

export interface CreateInvoicePayload {
  transactionId?: string;
  providerId?: string;
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

export interface CreateProviderPayload {
  name: string;
  type: ProviderType;
  category: string;
  aliases: string[];
}

export interface UpdateProviderPayload extends CreateProviderPayload {
  defaultAccount?: string;
}

export interface UpdateRevenuePartnerPayload {
  name: string;
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
  periodPreset?: RevenuePeriodPreset;
  periodStart?: string;
  periodEnd?: string;
  timezone?: string;
  createInvoices?: boolean;
}

export interface SaveAiSettingsPayload {
  openRouterApiKey?: string;
  clearApiKey?: boolean;
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
