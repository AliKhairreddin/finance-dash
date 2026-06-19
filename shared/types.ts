export type DataSource = "wise" | "slash" | "merit" | "manual" | "mock";

export type Direction = "in" | "out";

export type ProviderType = "customer" | "supplier" | "platform" | "internal";

export type InvoiceStatus = "draft" | "open" | "paid" | "created";

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

export interface DashboardSnapshot {
  asOf: string;
  accounts: AccountBalance[];
  receivables: LedgerItem[];
  openBalances: LedgerItem[];
  payables: Payable[];
  investments: Investment[];
  providers: Provider[];
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

export interface CreateProviderPayload {
  name: string;
  type: ProviderType;
  category: string;
  aliases: string[];
}
