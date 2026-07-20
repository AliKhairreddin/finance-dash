import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const dataSource = v.union(
  v.literal("wise"),
  v.literal("revolut"),
  v.literal("slash"),
  v.literal("amex"),
  v.literal("merit"),
  v.literal("manual"),
  v.literal("tune")
);

const providerType = v.union(v.literal("client"), v.literal("supplier"));
const invoiceStatus = v.union(v.literal("draft"), v.literal("open"), v.literal("paid"));
const invoiceDocumentType = v.union(v.literal("sales_invoice"), v.literal("supplier_bill"));
const billingCadence = v.union(v.literal("weekly"), v.literal("monthly"));

const provider = v.object({
  id: v.string(),
  name: v.string(),
  type: providerType,
  tags: v.array(v.string()),
  aliases: v.array(v.string()),
  defaultAccount: v.optional(v.string()),
  legalName: v.optional(v.string()),
  email: v.optional(v.string()),
  country: v.optional(v.string()),
  address: v.optional(v.string()),
  taxId: v.optional(v.string()),
  defaultCurrency: v.optional(v.string()),
  paymentTermsDays: v.optional(v.number()),
  meritCustomerId: v.optional(v.string()),
  meritSupplierId: v.optional(v.string()),
  source: dataSource,
  createdAt: v.string()
});

const invoice = v.object({
  id: v.string(),
  providerId: v.optional(v.string()),
  documentType: invoiceDocumentType,
  origin: v.union(v.literal("manual"), v.literal("revenue"), v.literal("merit")),
  customerName: v.string(),
  amount: v.number(),
  currency: v.string(),
  status: invoiceStatus,
  meritStatus: v.optional(v.union(v.literal("open"), v.literal("paid"))),
  meritDeliveryStatus: v.union(
    v.literal("not-sent"),
    v.literal("saved"),
    v.literal("delivered"),
    v.literal("delivery-failed")
  ),
  meritDeliveryError: v.optional(v.string()),
  sendError: v.optional(v.string()),
  meritCreationReservedAt: v.optional(v.string()),
  invoiceNumber: v.string(),
  issueDate: v.string(),
  dueDate: v.string(),
  source: dataSource,
  externalId: v.optional(v.string()),
  description: v.string(),
  transactionId: v.optional(v.string()),
  billingRuleId: v.optional(v.string()),
  revenueRunIds: v.array(v.string()),
  periodStart: v.optional(v.string()),
  periodEnd: v.optional(v.string()),
  taxId: v.optional(v.string()),
  sentAt: v.optional(v.string()),
  paidAt: v.optional(v.string()),
  createdAt: v.string(),
  updatedAt: v.string()
});

const team = v.object({
  id: v.string(),
  name: v.string(),
  createdAt: v.string()
});

const transactionTeamAssignment = v.object({
  transactionId: v.string(),
  teamId: v.string(),
  updatedAt: v.string()
});

const wiseCardHolderTeamAssignment = v.object({
  cardHolderName: v.string(),
  teamId: v.string(),
  updatedAt: v.string()
});

const transactionCategoryRule = v.object({
  id: v.string(),
  category: v.string(),
  direction: v.optional(v.union(v.literal("in"), v.literal("out"))),
  aliases: v.array(v.string()),
  createdAt: v.string(),
  updatedAt: v.string()
});

const transaction = v.object({
  id: v.string(),
  source: dataSource,
  accountName: v.string(),
  date: v.string(),
  description: v.string(),
  rawName: v.string(),
  counterparty: v.string(),
  cardHolderName: v.optional(v.string()),
  amount: v.number(),
  currency: v.string(),
  direction: v.union(v.literal("in"), v.literal("out")),
  status: v.union(v.literal("posted"), v.literal("pending"), v.literal("settled")),
  category: v.string(),
  matchedProviderId: v.optional(v.string()),
  matchedInvoiceId: v.optional(v.string()),
  teamId: v.optional(v.string()),
  confidence: v.optional(v.number()),
  matchReason: v.optional(v.string())
});

const wiseStatementImport = v.object({
  id: v.string(),
  balanceId: v.string(),
  currency: v.string(),
  periodStart: v.string(),
  periodEnd: v.string(),
  fileName: v.string(),
  transactionCount: v.number(),
  importedAt: v.string()
});

const revenueRun = v.object({
  id: v.string(),
  partnerId: v.string(),
  providerId: v.optional(v.string()),
  partnerName: v.string(),
  revenueCategory: v.optional(v.string()),
  teamId: v.optional(v.string()),
  teamName: v.optional(v.string()),
  source: v.literal("tune"),
  periodStart: v.string(),
  periodEnd: v.string(),
  timezone: v.string(),
  revenue: v.number(),
  currency: v.string(),
  clicks: v.optional(v.number()),
  conversions: v.optional(v.number()),
  status: v.union(
    v.literal("pulled"),
    v.literal("drafted"),
    v.literal("invoicing"),
    v.literal("invoiced"),
    v.literal("failed"),
    v.literal("skipped")
  ),
  invoiceId: v.optional(v.string()),
  externalInvoiceId: v.optional(v.string()),
  error: v.optional(v.string()),
  createdAt: v.string()
});

const revenuePartner = v.object({
  id: v.string(),
  providerId: v.string(),
  teamId: v.optional(v.string()),
  name: v.string(),
  revenueCategory: v.optional(v.string()),
  source: v.literal("tune"),
  affiliateId: v.string(),
  externalId: v.optional(v.string()),
  currency: v.string(),
  timezone: v.string(),
  networkTimezone: v.string(),
  networkIdEnv: v.string(),
  apiKeyEnv: v.string(),
  apiBaseUrlEnv: v.optional(v.string()),
  meritCustomerName: v.optional(v.string()),
  invoiceDueDays: v.number(),
  billingCadence,
  billingTimezone: v.string(),
  autoDraft: v.boolean(),
  defaultMeritTaxId: v.optional(v.string()),
  defaultMeritItemCode: v.optional(v.string()),
  enabled: v.boolean(),
  createdAt: v.string()
});

const revenueAccrual = v.object({
  id: v.string(),
  partnerId: v.string(),
  providerId: v.optional(v.string()),
  partnerName: v.string(),
  billingCadence,
  periodStart: v.string(),
  periodEnd: v.string(),
  accruedThrough: v.string(),
  amount: v.number(),
  currency: v.string(),
  status: v.union(v.literal("accruing"), v.literal("drafted")),
  revenueRunId: v.string(),
  invoiceId: v.optional(v.string()),
  updatedAt: v.string()
});

const paymentSource = v.union(
  v.literal("wise"),
  v.literal("revolut"),
  v.literal("slash"),
  v.literal("amex"),
  v.literal("cash"),
  v.literal("kraken"),
  v.literal("trust"),
  v.literal("other")
);

const paymentAllocation = v.object({
  id: v.string(),
  invoiceId: v.string(),
  transactionId: v.optional(v.string()),
  amount: v.number(),
  currency: v.string(),
  source: paymentSource,
  accountName: v.optional(v.string()),
  reference: v.optional(v.string()),
  note: v.optional(v.string()),
  mode: v.union(v.literal("automatic"), v.literal("manual")),
  confidence: v.optional(v.number()),
  matchReason: v.optional(v.string()),
  paidAt: v.string(),
  createdAt: v.string()
});

const holding = v.object({
  id: v.string(),
  name: v.string(),
  kind: v.union(v.literal("cash"), v.literal("exchange"), v.literal("wallet")),
  assetType: v.union(v.literal("fiat"), v.literal("crypto")),
  asset: v.string(),
  balance: v.number(),
  notes: v.optional(v.string()),
  updatedAt: v.string()
});

const fxRate = v.object({
  asset: v.string(),
  rateUsd: v.number(),
  provider: v.union(v.literal("coinbase"), v.literal("yahoo")),
  asOf: v.string(),
  checkedAt: v.optional(v.string()),
  stale: v.optional(v.boolean())
});

const automationRun = v.object({
  id: v.string(),
  type: v.literal("weekly-income"),
  periodStart: v.string(),
  periodEnd: v.string(),
  timezone: v.literal("Asia/Beirut"),
  status: v.union(v.literal("running"), v.literal("completed"), v.literal("failed")),
  startedAt: v.string(),
  completedAt: v.optional(v.string()),
  error: v.optional(v.string())
});

const aiSettings = v.object({
  provider: v.literal("openrouter"),
  model: v.string(),
  updatedAt: v.optional(v.string())
});

const profitDistributionPartnerId = v.union(
  v.literal("ishan"),
  v.literal("ben"),
  v.literal("sanjan"),
  v.literal("amin")
);

const profitDistributionBucket = v.union(
  v.literal("profit-share"),
  v.literal("salary"),
  v.literal("distribution")
);

const profitDistributionAdjustment = v.object({
  id: v.string(),
  month: v.string(),
  currency: v.string(),
  partnerId: profitDistributionPartnerId,
  bucket: profitDistributionBucket,
  waived: v.boolean(),
  deferred: v.boolean(),
  overrideAmount: v.optional(v.number()),
  note: v.optional(v.string()),
  updatedAt: v.string()
});

export default defineSchema({
  dashboardState: defineTable({
    key: v.string(),
    providers: v.array(provider),
    invoices: v.array(invoice),
    teams: v.array(team),
    transactionCategoryRules: v.array(transactionCategoryRule),
    revenuePartners: v.array(revenuePartner),
    transactionTeamAssignments: v.array(transactionTeamAssignment),
    wiseCardHolderTeamAssignments: v.array(wiseCardHolderTeamAssignment),
    wiseStatementTransactions: v.array(transaction),
    wiseStatementImports: v.array(wiseStatementImport),
    revenueRuns: v.array(revenueRun),
    revenueAccruals: v.array(revenueAccrual),
    paymentAllocations: v.array(paymentAllocation),
    holdings: v.array(holding),
    fxRates: v.array(fxRate),
    fxTrackedAssets: v.optional(v.array(v.string())),
    automationRuns: v.array(automationRun),
    profitDistributionAdjustments: v.array(profitDistributionAdjustment),
    aiSettings: v.optional(aiSettings),
    updatedAt: v.string()
  }).index("by_key", ["key"])
});
