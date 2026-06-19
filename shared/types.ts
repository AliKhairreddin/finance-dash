export type DataSource = "wise" | "slash" | "merit" | "manual" | "mock" | "tune";

export type Direction = "in" | "out";

export type ProviderType = "customer" | "supplier" | "platform" | "internal";

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
  externalId?: string;
  currency: string;
  timezone: string;
  networkIdEnv: string;
  apiKeyEnv: string;
  apiBaseUrlEnv?: string;
  meritCustomerName?: string;
  invoiceDueDays: number;
  enabled: boolean;
  createdAt: string;
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

export interface IntegrationStatus {
  id: DataSource;
  label: string;
  configured: boolean;
  mode: "live" | "mock" | "partial";
  message: string;
  needs: string[];
}

export interface Metrics {
  totalCash: number;
  totalReceivables: number;
  totalOpenBalance: number;
  totalPayables: number;
  totalFloat: number;
  profit: number;
  investments: number;
  totalAssets: number;
  cashbackRedeemed: number;
  cryptoDifference: number;
  cashGrowth: number;
  spendGrowth: number;
  profitGrowth: number;
  monthTotals: Record<string, number>;
}

export interface RevenueMetrics {
  totalRevenue: number;
  invoicedRevenue: number;
  pendingRevenue: number;
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
  transactions: Transaction[];
  invoices: Invoice[];
  integrationStatus: IntegrationStatus[];
  metrics: Metrics;
  lastSync: string;
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

export interface SyncRevenuePayload {
  partnerId?: string;
  periodPreset?: RevenuePeriodPreset;
  periodStart?: string;
  periodEnd?: string;
  timezone?: string;
  createInvoices?: boolean;
}
