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

const bankSource = v.union(
  v.literal("wise"),
  v.literal("revolut"),
  v.literal("slash"),
  v.literal("amex")
);

const providerType = v.union(v.literal("client"), v.literal("supplier"));
const invoiceStatus = v.union(v.literal("draft"), v.literal("open"), v.literal("paid"));
const invoiceDocumentType = v.union(v.literal("sales_invoice"), v.literal("supplier_bill"));
const billingCadence = v.union(v.literal("weekly"), v.literal("monthly"));
const wiseEntity = v.union(v.literal("dn"), v.literal("lmd"));

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

const transactionCategoryDirection = v.union(v.literal("in"), v.literal("out"), v.literal("both"));
const transactionClassificationSource = v.union(v.literal("ai"), v.literal("rule"), v.literal("manual"));
const slashAccountSubtype = v.union(v.literal("cash"), v.literal("credit"));

const transaction = v.object({
  id: v.string(),
  source: dataSource,
  wiseEntity: v.optional(wiseEntity),
  slashAccountSubtype: v.optional(slashAccountSubtype),
  accountId: v.optional(v.string()),
  accountName: v.string(),
  date: v.string(),
  description: v.string(),
  rawName: v.string(),
  counterparty: v.string(),
  cardHolderName: v.optional(v.string()),
  cardLastFour: v.optional(v.string()),
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
  teamId: v.optional(v.string()),
  confidence: v.optional(v.number()),
  matchReason: v.optional(v.string())
});

const profitDistributionPaymentFact = v.object({
  partnerId: v.union(
    v.literal("ishan"),
    v.literal("ben"),
    v.literal("sanjan"),
    v.literal("amin")
  ),
  bucket: v.union(
    v.literal("profit-share"),
    v.literal("salary"),
    v.literal("distribution")
  ),
  amount: v.number()
});

const accountBalance = v.object({
  id: v.string(),
  name: v.string(),
  source: bankSource,
  wiseEntity: v.optional(wiseEntity),
  slashAccountSubtype: v.optional(slashAccountSubtype),
  balance: v.number(),
  currency: v.string(),
  updatedAt: v.string(),
  status: v.union(v.literal("live"), v.literal("seeded"), v.literal("manual"))
});

const wiseStatementImport = v.object({
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

export default defineSchema({
  dashboardState: defineTable({
    key: v.string(),
    providers: v.array(provider),
    invoices: v.array(invoice),
    expenses: v.array(expenseRecord),
    manualReceivables: v.array(ledgerItem),
    teams: v.array(team),
    transactionCategoryRules: v.array(transactionCategoryRule),
    revenuePartners: v.array(revenuePartner),
    transactionTeamAssignments: v.optional(v.array(transactionTeamAssignment)),
    wiseCardHolderTeamAssignments: v.array(wiseCardHolderTeamAssignment),
    wiseStatementTransactions: v.optional(v.array(transaction)),
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
    updatedAt: v.string()
  }).index("by_key", ["key"]),
  transactionCategories: defineTable({
    id: v.string(),
    name: v.string(),
    nameNormalized: v.string(),
    direction: transactionCategoryDirection,
    color: v.string(),
    system: v.boolean(),
    createdAt: v.string(),
    updatedAt: v.string()
  })
    .index("by_category_id", ["id"])
    .index("by_name_normalized", ["nameNormalized"]),
  bankTransactions: defineTable({
    ...transaction.fields,
    source: bankSource,
    connectionKey: v.optional(v.string()),
    syncedAt: v.string(),
    profitContributionVersion: v.optional(v.number()),
    identityVersion: v.optional(v.number())
  })
    .index("by_transaction_id", ["id"])
    .index("by_transaction_account_id", ["accountId"])
    .index("by_connection_key", ["connectionKey"])
    .index("by_source", ["source"])
    .index("by_source_connection", ["source", "connectionKey"])
    .index("by_source_connection_date_id", ["source", "connectionKey", "date", "id"])
    .index("by_source_connection_direction_date_id", ["source", "connectionKey", "direction", "date", "id"])
    .index("by_source_connection_status_date_id", ["source", "connectionKey", "status", "date", "id"])
    .index("by_source_connection_classification_complete", ["source", "connectionKey", "classificationComplete"])
    .index("by_source_connection_direction_currency_status_date_id", [
      "source",
      "connectionKey",
      "direction",
      "currency",
      "status",
      "date",
      "id"
    ])
    .index("by_source_status_date_id", ["source", "status", "date", "id"])
    .index("by_date_id", ["date", "id"])
    .index("by_direction_date_id", ["direction", "date", "id"])
    .index("by_direction_currency_date_id", ["direction", "currency", "date", "id"])
    .index("by_category_direction_currency_date_id", ["category", "direction", "currency", "date", "id"])
    .index("by_direction_currency_status_date_id", ["direction", "currency", "status", "date", "id"])
    .index("by_source_date_id", ["source", "date", "id"])
    .index("by_source_direction_date_id", ["source", "direction", "date", "id"])
    .index("by_classification_complete", ["classificationComplete"])
    .index("by_profit_contribution_version", ["profitContributionVersion"])
    .index("by_identity_version", ["identityVersion"])
    .index("by_source_identity_version", ["source", "identityVersion"])
    .index("by_source_connection_identity_version", ["source", "connectionKey", "identityVersion"])
    .index("by_merchant_direction", ["merchantKey", "direction"])
    .index("by_matched_provider", ["matchedProviderId"])
    .index("by_category", ["category"]),
  profitDistributionFacts: defineTable({
    key: v.string(),
    version: v.number(),
    month: v.string(),
    currency: v.string(),
    transactionCount: v.number(),
    revenue: v.number(),
    generalCosts: v.number(),
    payments: v.array(profitDistributionPaymentFact),
    updatedAt: v.string()
  })
    .index("by_key", ["key"])
    .index("by_month_currency", ["month", "currency"]),
  bankLedgerRevision: defineTable({
    key: v.string(),
    revision: v.number(),
    updatedAt: v.string()
  }).index("by_key", ["key"]),
  bankLedgerCutover: defineTable({
    key: v.string(),
    status: v.literal("ready"),
    completedAt: v.string()
  }).index("by_key", ["key"]),
  bankConnectionBindings: defineTable({
    source: bankSource,
    connectionKey: v.string(),
    boundAt: v.string()
  })
    .index("by_source", ["source"])
    .index("by_source_connection", ["source", "connectionKey"]),
  bankTransactionAliases: defineTable({
    key: v.string(),
    source: bankSource,
    connectionKey: v.optional(v.string()),
    alias: v.string(),
    transactionId: v.string(),
    updatedAt: v.string()
  })
    .index("by_key", ["key"])
    .index("by_transaction_id", ["transactionId"]),
  bankIdentityMigrations: defineTable({
    source: bankSource,
    version: v.number(),
    completedAt: v.string()
  }).index("by_source", ["source"]),
  bankIdentityDispositions: defineTable({
    key: v.string(),
    source: bankSource,
    connectionKey: v.string(),
    disposition: v.literal("accept-surrogate-identities"),
    acceptedCount: v.number(),
    earliestDate: v.string(),
    latestDate: v.string(),
    updatedAt: v.string()
  }).index("by_key", ["key"]),
  bankLegacyReferenceDispositions: defineTable({
    key: v.string(),
    transactionId: v.string(),
    teamId: v.string(),
    disposition: v.literal("discard-orphaned-team-assignment"),
    disposedAt: v.string()
  }).index("by_key", ["key"]),
  bankAccounts: defineTable({
    ...accountBalance.fields,
    connectionKey: v.optional(v.string()),
    syncedAt: v.string()
  })
    .index("by_account_id", ["id"])
    .index("by_connection_key", ["connectionKey"])
    .index("by_source", ["source"])
    .index("by_source_connection", ["source", "connectionKey"]),
  bankSyncState: defineTable({
    source: bankSource,
    connectionKey: v.optional(v.string()),
    accountIds: v.optional(v.array(v.string())),
    coveredRanges: v.array(v.object({ fromDate: v.string(), toDate: v.string() })),
    lastSyncedAt: v.string()
  })
    .index("by_source", ["source"])
    .index("by_source_connection", ["source", "connectionKey"]),
  bankSyncCheckpoints: defineTable({
    source: bankSource,
    connectionKey: v.optional(v.string()),
    laneKey: v.optional(v.string()),
    accountIds: v.optional(v.array(v.string())),
    fromDate: v.string(),
    toDate: v.string(),
    checkpoint: v.string(),
    updatedAt: v.string()
  })
    .index("by_source", ["source"])
    .index("by_source_connection", ["source", "connectionKey"])
    .index("by_source_connection_lane", ["source", "connectionKey", "laneKey"]),
  bankBackfillJobs: defineTable({
    key: v.string(),
    source: bankSource,
    connectionKey: v.string(),
    fromDate: v.string(),
    toDate: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("complete"),
      v.literal("failed")
    ),
    attempts: v.number(),
    consecutiveFailures: v.number(),
    attemptToken: v.optional(v.string()),
    nextAttemptAt: v.string(),
    lastAttemptAt: v.optional(v.string()),
    lastError: v.optional(v.string()),
    completedAt: v.optional(v.string()),
    updatedAt: v.string()
  })
    .index("by_key", ["key"])
    .index("by_status_next_attempt", ["status", "nextAttemptAt", "updatedAt"])
    .index("by_source_status_next_attempt", ["source", "status", "nextAttemptAt", "updatedAt"]),
  bankSyncHealth: defineTable({
    key: v.string(),
    source: bankSource,
    connectionKey: v.string(),
    status: v.union(v.literal("running"), v.literal("healthy"), v.literal("failed")),
    lastAttemptAt: v.string(),
    lastSuccessAt: v.optional(v.string()),
    lastError: v.optional(v.string()),
    consecutiveFailures: v.number(),
    updatedAt: v.string()
  })
    .index("by_key", ["key"])
    .index("by_source_connection", ["source", "connectionKey"]),
  bankReconciliationCursors: defineTable({
    key: v.string(),
    source: bankSource,
    connectionKey: v.string(),
    cursor: v.optional(v.string()),
    updatedAt: v.string()
  }).index("by_key", ["key"]),
  bankAnalyticsJobs: defineTable({
    key: v.string(),
    version: v.string(),
    fromDate: v.string(),
    toDate: v.string(),
    status: v.union(v.literal("building"), v.literal("complete")),
    cursor: v.optional(v.string()),
    accumulator: v.optional(v.any()),
    snapshot: v.optional(v.any()),
    updatedAt: v.string()
  }).index("by_key", ["key"]),
  workerLeases: defineTable({
    key: v.string(),
    token: v.string(),
    fence: v.optional(v.number()),
    expiresAt: v.number()
  }).index("by_key", ["key"]),
  managementReportImports: defineTable({
    importId: v.string(),
    contentHash: v.string(),
    parserVersion: v.string(),
    attemptId: v.string(),
    leaseExpiresAt: v.string(),
    sourceName: v.string(),
    sourceUrl: v.optional(v.string()),
    reportingThrough: v.string(),
    importedAt: v.string(),
    status: v.union(v.literal("importing"), v.literal("complete"), v.literal("failed")),
    sheetSummaries: v.array(
      v.object({
        key: v.string(),
        label: v.string(),
        rowCount: v.number(),
        nonEmptyRowCount: v.number(),
        visibility: v.optional(v.union(v.literal("visible"), v.literal("hidden"))),
        role: v.optional(v.union(v.literal("report"), v.literal("supporting")))
      })
    ),
    sourceRowCount: v.number(),
    bankEntryCount: v.number(),
    factCount: v.number(),
    dashboard: v.optional(v.any()),
    error: v.optional(v.string())
  })
    .index("by_import_id", ["importId"])
    .index("by_content_hash", ["contentHash"])
    .index("by_status_reporting_through_imported_at", ["status", "reportingThrough", "importedAt"]),
  managementReportSourceRows: defineTable({
    importId: v.string(),
    sheetKey: v.string(),
    rowNumber: v.number(),
    cells: v.array(v.string())
  })
    .index("by_import", ["importId"])
    .index("by_import_sheet_row", ["importId", "sheetKey", "rowNumber"]),
  managementReportFacts: defineTable({
    importId: v.string(),
    factId: v.string(),
    scope: v.string(),
    scopeId: v.string(),
    metric: v.string(),
    period: v.string(),
    value: v.number(),
    valueDecimal: v.optional(v.string()),
    unit: v.union(
      v.literal("currency"),
      v.literal("percent"),
      v.literal("count"),
      v.literal("rate"),
      v.literal("number")
    ),
    currency: v.optional(v.string()),
    scenario: v.optional(v.string()),
    section: v.optional(v.string()),
    dimension: v.optional(v.string()),
    sourceSheet: v.string(),
    sourceRow: v.number(),
    payload: v.optional(v.any())
  })
    .index("by_import", ["importId"])
    .index("by_import_fact", ["importId", "factId"])
    .index("by_import_scope_period", ["importId", "scope", "period"]),
  managementReportBankEntries: defineTable({
    importId: v.string(),
    entryId: v.string(),
    date: v.string(),
    bankName: v.string(),
    segment: v.string(),
    amountUsd: v.number(),
    amountUsdDecimal: v.optional(v.string()),
    sourceRow: v.number(),
    payload: v.any()
  })
    .index("by_import", ["importId"])
    .index("by_import_entry", ["importId", "entryId"])
    .index("by_import_date", ["importId", "date"])
    .index("by_import_segment_date", ["importId", "segment", "date"])
});
