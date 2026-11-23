import { v } from "convex/values";
import { flexAccount, flexTransaction } from "./flexSchema";
import { meritInvoiceCopy } from "./meritInvoiceCopySchema";
import { revenueInvoiceLine } from "./revenueInvoiceSchema";

const dataSource = v.union(
  v.literal("wise"),
  v.literal("revolut"),
  v.literal("slash"),
  v.literal("flex"),
  v.literal("mercury"),
  v.literal("amex"),
  v.literal("merit"),
  v.literal("manual"),
  v.literal("tune"),
  v.literal("quinstreet")
);

export const bankSource = v.union(
  v.literal("wise"),
  v.literal("revolut"),
  v.literal("slash"),
  v.literal("flex"),
  v.literal("mercury"),
  v.literal("amex")
);

export const providerType = v.union(v.literal("client"), v.literal("supplier"));

const invoiceStatus = v.union(v.literal("draft"), v.literal("open"), v.literal("paid"));

const invoiceDocumentType = v.union(v.literal("sales_invoice"), v.literal("supplier_bill"));

const billingCadence = v.union(v.literal("weekly"), v.literal("monthly"));

export const wiseEntity = v.union(v.literal("dn"), v.literal("lmd"));

const ledgerItem = v.object({
  id: v.string(),
  name: v.string(),
  balance: v.number(),
  currency: v.string(),
  source: dataSource,
  notes: v.optional(v.string()),
  dueDate: v.optional(v.string())
});

const meritCompanyComment = v.object({ date: v.optional(v.string()), text: v.string() });

const meritCompanyDimension = v.object({
  id: v.optional(v.string()),
  dimensionId: v.optional(v.string()),
  dimensionValueId: v.optional(v.string()),
  code: v.optional(v.string())
});

const meritCompanyDetails = v.object({
  relationship: v.union(v.literal("customer"), v.literal("vendor")),
  registrationNumber: v.optional(v.string()),
  contactName: v.optional(v.string()),
  phone: v.optional(v.string()),
  secondaryPhone: v.optional(v.string()),
  city: v.optional(v.string()),
  county: v.optional(v.string()),
  postalCode: v.optional(v.string()),
  countryName: v.optional(v.string()),
  fax: v.optional(v.string()),
  website: v.optional(v.string()),
  bankName: v.optional(v.string()),
  bankAccount: v.optional(v.string()),
  referenceNumber: v.optional(v.string()),
  invoiceLanguage: v.optional(v.string()),
  groupId: v.optional(v.string()),
  groupName: v.optional(v.string()),
  changedDate: v.optional(v.string()),
  invoiceSendPreference: v.optional(v.string()),
  glnCode: v.optional(v.string()),
  partyCode: v.optional(v.string()),
  telemaEdi: v.optional(v.string()),
  vendorType: v.optional(v.number()),
  notTaxDomesticCustomer: v.optional(v.boolean()),
  taxRegistered: v.optional(v.boolean()),
  overdueCharge: v.optional(v.number()),
  comments: v.optional(v.array(meritCompanyComment)),
  dimensions: v.optional(v.array(meritCompanyDimension))
});

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
  defaultMeritTaxId: v.optional(v.string()),
  defaultMeritTaxSource: v.optional(v.union(v.literal("merit-history"), v.literal("manual"))),
  defaultMeritTaxSampleSize: v.optional(v.number()),
  defaultMeritTaxUpdatedAt: v.optional(v.string()),
  meritDetails: v.optional(meritCompanyDetails),
  source: dataSource,
  createdAt: v.string()
});

export const invoice = v.object({
  revenueLines: v.optional(v.array(revenueInvoiceLine)),
  meritCopy: v.optional(meritInvoiceCopy),
  id: v.string(),
  entity: v.optional(wiseEntity),
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
  meritReplacementId: v.optional(v.string()),
  meritBackupId: v.optional(v.string()),
  historicalImportedAt: v.optional(v.string()),
  meritPdfStorageId: v.optional(v.id("_storage")),
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

const expenseDocumentKind = v.union(
  v.literal("vendor_receipt"),
  v.literal("vendor_invoice"),
  v.literal("missing_receipt_declaration")
);

const expenseVatTreatment = v.union(
  v.literal("standard"),
  v.literal("reduced"),
  v.literal("zero"),
  v.literal("exempt"),
  v.literal("reverse_charge"),
  v.literal("not_applicable")
);

const expenseDocument = v.object({
  id: v.string(),
  kind: expenseDocumentKind,
  fileName: v.string(),
  contentType: v.string(),
  size: v.number(),
  storageId: v.string(),
  createdAt: v.string()
});

const expenseRecord = v.object({
  id: v.string(),
  entity: v.optional(wiseEntity),
  recordNumber: v.string(),
  recordType: v.union(v.literal("paid_expense"), v.literal("supplier_bill")),
  paymentStatus: v.union(v.literal("paid"), v.literal("unpaid")),
  transactionId: v.optional(v.string()),
  providerId: v.optional(v.string()),
  teamId: v.optional(v.string()),
  supplierName: v.string(),
  supplierRegistrationNumber: v.optional(v.string()),
  supplierVatNumber: v.optional(v.string()),
  sourceDocumentNumber: v.optional(v.string()),
  issueDate: v.string(),
  transactionDate: v.optional(v.string()),
  dueDate: v.optional(v.string()),
  paidAt: v.optional(v.string()),
  category: v.string(),
  businessPurpose: v.string(),
  description: v.string(),
  netAmount: v.number(),
  vatAmount: v.number(),
  grossAmount: v.number(),
  vatRate: v.optional(v.number()),
  vatTreatment: expenseVatTreatment,
  currency: v.string(),
  missingDocumentReason: v.optional(v.string()),
  declarationConfirmedAt: v.optional(v.string()),
  documents: v.array(expenseDocument),
  createdAt: v.string(),
  updatedAt: v.string()
});

const team = v.object({
  id: v.string(),
  name: v.string(),
  createdAt: v.string()
});

export const transactionTeamAssignment = v.object({
  transactionId: v.string(),
  teamId: v.string(),
  updatedAt: v.string()
});

export const wiseCardHolderTeamAssignment = v.object({
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

export const transactionCategoryDirection = v.union(v.literal("in"), v.literal("out"), v.literal("both"));

export const transactionClassificationSource = v.union(v.literal("ai"), v.literal("rule"), v.literal("manual"));

export const invoiceMatchSource = v.union(v.literal("exact"), v.literal("tolerance"), v.literal("ai"), v.literal("manual"));

export const mercuryEntity = v.union(v.literal("mojo"), v.literal("coveragebird"), v.literal("coveragepro"));

export const slashEntity = v.union(v.literal("mojo"), v.literal("coveragebird"), v.literal("coveragepro"));

const slashAccountSubtype = v.union(v.literal("cash"), v.literal("credit"));

const slashVirtualAccount = v.object({
  balance: v.optional(v.number()),
  id: v.string(),
  name: v.string(),
  accountId: v.string(),
  accountType: v.union(v.literal("primary"), v.literal("default")),
  closedAt: v.optional(v.string())
});

export const accountBalance = v.object({
  id: v.string(),
  name: v.string(),
  source: bankSource,
  wiseEntity: v.optional(wiseEntity),
  mercuryEntity: v.optional(mercuryEntity),
  slashEntity: v.optional(slashEntity),
  slashAccountSubtype: v.optional(slashAccountSubtype),
  slashVirtualAccounts: v.optional(v.array(slashVirtualAccount)),
  flex: v.optional(flexAccount),
  balance: v.number(),
  currency: v.string(),
  updatedAt: v.string(),
  status: v.union(v.literal("live"), v.literal("seeded"), v.literal("manual"))
});

export const transaction = v.object({
  id: v.string(),
  source: dataSource,
  wiseEntity: v.optional(wiseEntity),
  mercuryEntity: v.optional(mercuryEntity),
  slashEntity: v.optional(slashEntity),
  slashAccountSubtype: v.optional(slashAccountSubtype),
  slashVirtualAccountId: v.optional(v.string()),
  slashVirtualAccountName: v.optional(v.string()),
  slashVirtualAccountMetadataVersion: v.optional(v.number()),
  accountId: v.optional(v.string()),
  accountName: v.string(),
  date: v.string(),
  description: v.string(),
  reference: v.optional(v.string()),
  rawName: v.string(),
  counterparty: v.string(),
  cardHolderName: v.optional(v.string()),
  cardId: v.optional(v.string()),
  cardLastFour: v.optional(v.string()),
  cardMetadataVersion: v.optional(v.number()),
  flex: v.optional(flexTransaction),
  amount: v.number(),
  currency: v.string(),
  cashback: v.optional(v.object({
    amount: v.number(),
    rate: v.number()
  })),
  direction: v.union(v.literal("in"), v.literal("out")),
  status: v.union(
    v.literal("posted"),
    v.literal("pending"),
    v.literal("settled"),
    v.literal("voided")
  ),
  category: v.string(),
  merchantName: v.optional(v.string()),
  merchantKey: v.optional(v.string()),
  classificationComplete: v.optional(v.boolean()),
  categorySource: v.optional(transactionClassificationSource),
  categoryConfidence: v.optional(v.number()),
  categoryReason: v.optional(v.string()),
  matchedProviderId: v.optional(v.string()),
  companyMatchSource: v.optional(transactionClassificationSource),
  companyConfidence: v.optional(v.number()),
  companyMatchReason: v.optional(v.string()),
  matchedInvoiceId: v.optional(v.string()),
  invoiceMatchSource: v.optional(invoiceMatchSource),
  invoiceMatchConfidence: v.optional(v.number()),
  invoiceMatchReason: v.optional(v.string()),
  teamId: v.optional(v.string()),
  confidence: v.optional(v.number()),
  matchReason: v.optional(v.string())
});

export const wiseStatementImport = v.object({
  id: v.string(),
  balanceId: v.string(),
  wiseEntity: v.optional(wiseEntity),
  accountName: v.optional(v.string()),
  currency: v.string(),
  periodStart: v.string(),
  periodEnd: v.string(),
  fileName: v.string(),
  transactionCount: v.number(),
  importedAt: v.string()
});

const cashFlowLine = v.object({
  id: v.string(),
  name: v.string(),
  amount: v.number(),
  formula: v.optional(v.string()),
  currency: v.string(),
  notes: v.optional(v.string()),
  dueDate: v.optional(v.string()),
  excludedFromTotals: v.optional(v.boolean())
});

export const cashFlowSnapshot = v.object({
  id: v.string(),
  asOfDate: v.string(),
  cashAccounts: v.array(cashFlowLine),
  receivables: v.array(cashFlowLine),
  openBalances: v.array(cashFlowLine),
  payables: v.array(cashFlowLine),
  investments: v.array(cashFlowLine),
  cashGrowthPercent: v.optional(v.number()),
  spendGrowthPercent: v.optional(v.number()),
  profitGrowthPercent: v.optional(v.number()),
  notes: v.optional(v.string()),
  createdAt: v.string(),
  updatedAt: v.string()
});

export const revenueRun = v.object({
  id: v.string(),
  partnerId: v.string(),
  providerId: v.optional(v.string()),
  partnerName: v.string(),
  revenueCategory: v.optional(v.string()),
  teamId: v.optional(v.string()),
  teamName: v.optional(v.string()),
  source: v.union(v.literal("tune"), v.literal("quinstreet")),
  periodStart: v.string(),
  periodEnd: v.string(),
  timezone: v.string(),
  revenue: v.number(),
  currency: v.string(),
  clicks: v.optional(v.number()),
  conversions: v.optional(v.number()),
  leads: v.optional(v.number()),
  payableLeads: v.optional(v.number()),
  clickRevenue: v.optional(v.number()),
  leadRevenue: v.optional(v.number()),
  earningsPerClick: v.optional(v.number()),
  earningsPerLead: v.optional(v.number()),

  status: v.union(
    v.literal("pulled"),
    v.literal("drafted"),
    v.literal("invoicing"),
    v.literal("invoiced"),
    v.literal("failed"),
    v.literal("skipped")
  ),
  draftDeletedAt: v.optional(v.string()),
  invoiceId: v.optional(v.string()),
  externalInvoiceId: v.optional(v.string()),
  error: v.optional(v.string()),
  createdAt: v.string()
});

const revenuePartnerCommon = {
  id: v.string(),
  providerId: v.string(),
  teamId: v.optional(v.string()),
  name: v.string(),
  revenueCategory: v.optional(v.string()),
  currency: v.string(),
  timezone: v.string(),
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
};

export const revenuePartner = v.union(
  v.object({
    ...revenuePartnerCommon,
    source: v.literal("tune"),
    affiliateId: v.string(),
    externalId: v.optional(v.string()),
    networkTimezone: v.string(),
    networkIdEnv: v.string(),
    apiKeyEnv: v.string()
  }),
  v.object({
    ...revenuePartnerCommon,
    source: v.literal("quinstreet"),
    publisherName: v.string(),
    reportKeyEnv: v.string(),
    clientIdEnv: v.string(),
    clientSecretEnv: v.string(),
    revenueField: v.string(),
    categoryField: v.string(),
    categoryValue: v.string()
  })
);

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
  v.literal("flex"),
  v.literal("mercury"),
  v.literal("amex"),
  v.literal("cash"),
  v.literal("kraken"),
  v.literal("trust"),
  v.literal("other")
);

const paymentAllocation = v.object({
  settlementAdjustment: v.optional(v.number()),
  settlementAdjustmentUsd: v.optional(v.number()),
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

export const automationRun = v.object({
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

export const profitDistributionAdjustment = v.object({
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

const meritTax = v.object({
  id: v.string(),
  code: v.string(),
  name: v.string(),
  taxPct: v.number()
});

const profitDistributionPartnerLedger = v.object({
  partnerId: profitDistributionPartnerId,
  partnerName: v.string(),
  entityName: v.optional(v.string()),
  currency: v.string(),
  profitSharePayable: v.number(),
  salaryPayable: v.number(),
  distributionPayable: v.number(),
  totalPayable: v.number(),
  profitSharePaid: v.number(),
  salaryPaid: v.number(),
  distributionPaid: v.number(),
  totalPaid: v.number(),
  remaining: v.number(),
  hasAdjustment: v.boolean(),
  hasDeferred: v.boolean()
});

const profitDistributionSnapshot = v.object({
  partners: v.array(profitDistributionPartnerLedger),
  months: v.array(v.object({
    id: v.string(),
    month: v.string(),
    currency: v.string(),
    revenue: v.number(),
    generalCosts: v.number(),
    netProfitAfterGeneralCosts: v.number(),
    ishanProfitShare: v.number(),
    salaryDeductions: v.number(),
    profitAvailableForDistribution: v.number(),
    distributionPool: v.number(),
    partners: v.array(profitDistributionPartnerLedger)
  })),
  currencies: v.array(v.object({
    currency: v.string(),
    totalPayable: v.number(),
    totalPaid: v.number(),
    remaining: v.number()
  })),
  adjustments: v.array(profitDistributionAdjustment)
});

export const dashboardFields = {
  providers: v.array(provider),
  invoices: v.array(invoice),
  expenses: v.array(expenseRecord),
  manualReceivables: v.array(ledgerItem),
  teams: v.array(team),
  transactionCategoryRules: v.array(transactionCategoryRule),
  revenuePartners: v.array(revenuePartner),
  wiseCardHolderTeamAssignments: v.array(wiseCardHolderTeamAssignment),
  wiseStatementImports: v.array(wiseStatementImport),
  revenueRuns: v.array(revenueRun),
  revenueAccruals: v.array(revenueAccrual),
  paymentAllocations: v.array(paymentAllocation),
  holdings: v.array(holding),
  fxRates: v.array(fxRate),
  fxTrackedAssets: v.optional(v.array(v.string())),
  automationRuns: v.array(automationRun),
  profitDistributionAdjustments: v.array(profitDistributionAdjustment),
  profitDistributionCache: v.optional(profitDistributionSnapshot),
  meritTaxes: v.optional(v.array(meritTax)),
  aiSettings: v.optional(aiSettings),
  cashFlowSnapshots: v.optional(v.array(cashFlowSnapshot))
};
