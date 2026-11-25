import {
  accountBalance,
  bankSource,
  dashboardFields,
  transaction,
  transactionCategoryDirection,
  transactionTeamAssignment,
  wiseEntity
} from "./dashboardSchema";
import { flexTables } from "./flexSchema";
import { receivablesTables } from "./receivablesSchema";
import { mediaFundingSourceReference } from "./mediaFundingSourceSchema";
import { intelligenceTables } from "./statementIntelligenceSchema";
import { topUpFields, topUpRecord } from "./topUpSchema";
import { replacementFields } from "./meritReplacementSchema";
import { ownerReviewTables } from "./ownerReviewSchema";
import { defineSchema, defineTable } from "convex/server";
import { redtrackRow, redtrackSource } from "./redtrackSchema";
import { v } from "convex/values";
import { companyDocumentFields } from "./companyDocumentSchema";
import { financialDocumentFields } from "./documentSchema";
import { amexStatementFields } from "./amexStatementSchema";
import { manualBankFields, manualBankRecord } from "./manualBankSchema";
import { statementTables } from "./statementSchema";
import { statementMailboxTables } from "./statementMailboxSchema";
import { exactTables } from "./exactSchema";
import { invoiceTables } from "./statementInvoiceSchema";

const mediaFundingBillingSpend = v.object({ card: v.number(), credit_line: v.number(), unclassified: v.number(), unclassifiedRows: v.number() });

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

export default defineSchema({
  ...ownerReviewTables,
  ...flexTables,
  ...receivablesTables,
  statementCaptureDevices: defineTable({ actor: v.string(), tokenHash: v.string(), active: v.boolean(), createdAt: v.number(), minuteStart: v.number(), minuteCount: v.number(), dayStart: v.number(), dayCount: v.number() }).index("by_actor", ["actor"]).index("by_tokenHash", ["tokenHash"]),
  ...statementTables, ...intelligenceTables,
  ...statementMailboxTables,
  ...exactTables,
  ...invoiceTables,
  topUpRequests: defineTable(topUpFields).index("by_submission", ["submissionId"]).index("by_document", ["documentId"]).index("by_status", ["status"]).index("by_deleted", ["deletedAt"]).index("by_deleted_status", ["deletedAt", "status"]).index("by_adjust_prompt", ["adjustPromptId"]).index("by_team", ["team"]),
  topUpSettings: defineTable({ key: v.string(), sequence: v.number() }).index("by_key", ["key"]),
  topUpRateLimits: defineTable({ key: v.string(), count: v.number(), expiresAt: v.number() }).index("by_key", ["key"]).index("by_expiry", ["expiresAt"]),
  topUpDeliveries: defineTable({ requestId: v.id("topUpRequests"), version: v.number(), state: v.string(), attempts: v.number(), token: v.optional(v.string()), error: v.optional(v.string()), messageId: v.optional(v.number()), deletedSnapshot: v.optional(topUpRecord) }).index("by_request_version", ["requestId", "version"]),
  meritInvoiceReplacements: defineTable(replacementFields).index("by_operation_id", ["id"]).index("by_invoice_id", ["invoiceId"]),
  manualBankTransactions: defineTable({
    ...manualBankRecord, intakeKey: v.string(), companySort: v.string(), sentAt: v.optional(v.number()),
    deletedAt: v.optional(v.string()), deletedBy: v.optional(v.string())
  }).index("by_intake_key", ["intakeKey"])
    .index("by_source_date", ["source", "deletedAt", "date"])
    .index("by_source_company", ["source", "deletedAt", "companySort"])
    .index("by_source_amount", ["source", "deletedAt", "amount"])
    .index("by_source_currency", ["source", "deletedAt", "currency"])
    .index("by_source_direction", ["source", "deletedAt", "direction"])
    .index("by_source_creator", ["source", "deletedAt", "createdBy"]),
  manualBankTransactionEdits: defineTable({
    transactionId: v.id("manualBankTransactions"), revision: v.number(),
    before: v.object(manualBankFields), after: v.object(manualBankFields), updatedBy: v.string(), updatedAt: v.string()
  }).index("by_transaction_id", ["transactionId"]),
  integrationSyncJobs: defineTable({
    key: v.string(), leaseId: v.string(), leaseExpiresAt: v.number(), nextAllowedAt: v.number(),
    lastAttemptAt: v.string(), lastSuccessAt: v.optional(v.string()), error: v.optional(v.string())
  }).index("by_key", ["key"]),
  meritHistoryReports: defineTable({
    key: v.string(), fromDate: v.string(), toDate: v.string(), recordsJson: v.string(), fetchedAt: v.string()
  }).index("by_key", ["key"]),
  quinstreetMonthlyReports: defineTable({
    partnerId: v.string(), partnerName: v.string(), periodStart: v.string(), periodEnd: v.string(), timezone: v.string(),
    revenue: v.number(), currency: v.string(), fetchedAt: v.string()
  }).index("by_partner_period", ["partnerId", "periodStart", "periodEnd"]),

  companyDocuments: defineTable(companyDocumentFields).index("by_content_hash", ["contentHash"]),
  redtrackAdvertiserLinks: defineTable({ sourceId: v.string(), url: v.string() }).index("by_source_id", ["sourceId"]),
  redtrackDays: defineTable({ date: v.string(), savedAt: v.number(), rowCount: v.number(), chunkCount: v.number() }).index("by_date", ["date"]),
  redtrackDayChunks: defineTable({ dayId: v.id("redtrackDays"), part: v.number(), rows: v.array(redtrackRow) }).index("by_day_part", ["dayId", "part"]),
  redtrackSyncState: defineTable({ key: v.string(), attemptId: v.optional(v.string()), leaseUntil: v.optional(v.number()),
    nextRequestAt: v.optional(v.number()), retryAt: v.optional(v.number()), lastError: v.optional(v.string()),
    sources: v.optional(v.array(redtrackSource)), sourcesSavedAt: v.optional(v.number()) }).index("by_key", ["key"]),
  amexStatementImports: defineTable(amexStatementFields).index("by_content_hash", ["contentHash"]),
  amexStatementAccounts: defineTable({ id: v.string(), name: v.string(), source: v.literal("amex"), currency: v.string() }).index("by_account_id", ["id"]),
  financialDocuments: defineTable(financialDocumentFields)
    .index("by_kind", ["kind"])
    .index("by_purchase", ["purchaseId"])
    .index("by_kind_currency_amount_date", ["kind", "extraction.currency", "extraction.amount", "extraction.issueDate"])
    .index("by_storage", ["storageId"])
    .index("by_content_hash", ["contentHash"])
    .index("by_intake_key", ["intakeKey"])
    .index("by_entity_month", ["entity", "month"])
    .index("by_month", ["month"])
    .index("by_status_deleted_next_match", ["status", "deletedAt", "nextMatchAt"])
    .index("by_status", ["status"])
    .index("by_transaction", ["transactionId"])
    .index("by_invoice", ["invoiceId"]),
  documentRechecks: defineTable({
    key: v.string(), runId: v.string(), status: v.union(v.literal("running"), v.literal("completed")), cursor: v.union(v.string(), v.null()), exhausted: v.boolean(),
    currentId: v.optional(v.id("financialDocuments")), token: v.optional(v.string()), leaseUntil: v.optional(v.number()), attempts: v.number(),
    checked: v.number(), skipped: v.number(), failed: v.number(), startedAt: v.string(), updatedAt: v.string()
  }).index("by_key", ["key"]),
  documentFolders: defineTable({ key: v.string(), entity: v.optional(wiseEntity), month: v.string(), count: v.number() }).index("by_key", ["key"]),
  documentSettings: defineTable({ key: v.string(), allowedSenders: v.array(v.string()) }).index("by_key", ["key"]),
  dashboardState: defineTable({
    key: v.string(),
    ...dashboardFields,
    transactionTeamAssignments: v.optional(v.array(transactionTeamAssignment)),
    wiseStatementTransactions: v.optional(v.array(transaction)),
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
    .index("by_source_slash_entity", ["source", "slashEntity"])
    .index("by_source_mercury_entity", ["source", "mercuryEntity"])
    .index("by_source_connection_card_metadata_version_date_id", [
      "source",
      "connectionKey",
      "cardMetadataVersion",
      "date",
      "id"
    ])
    .index("by_source_connection_slash_virtual_version_date_id", [
      "source",
      "connectionKey",
      "slashVirtualAccountMetadataVersion",
      "date",
      "id"
    ])
    .index("by_source_connection_synced", ["source", "connectionKey", "syncedAt"])
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
    .index("by_category_direction_status_date_id", ["category", "direction", "status", "date", "id"])
    .index("by_source_date_id", ["source", "date", "id"])
    .index("by_source_direction_date_id", ["source", "direction", "date", "id"])
    .index("by_classification_complete", ["classificationComplete"])
    .index("by_profit_contribution_version", ["profitContributionVersion"])
    .index("by_identity_version", ["identityVersion"])
    .index("by_source_identity_version", ["source", "identityVersion"])
    .index("by_source_connection_identity_version", ["source", "connectionKey", "identityVersion"])
    .index("by_merchant_direction", ["merchantKey", "direction"])
    .index("by_matched_provider", ["matchedProviderId"])
    .index("by_matched_invoice", ["matchedInvoiceId"])
    .index("by_direction_currency_amount", ["direction", "currency", "amount"])
    .index("by_matched_provider_category_date_id", ["matchedProviderId", "category", "date", "id"])
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
    .index("by_import_segment_date", ["importId", "segment", "date"]),
  wagnerSpendCache: defineTable({
    key: v.string(),
    retryAfter: v.optional(v.number()),
    attemptId: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    savedAt: v.optional(v.number()),
    refreshAfter: v.optional(v.union(v.number(), v.null())),
    chunkCount: v.optional(v.number())
  }).index("by_key", ["key"]),
  wagnerSpendCacheChunks: defineTable({
    reportId: v.id("wagnerSpendCache"), part: v.number(), text: v.string()
  }).index("by_report_and_part", ["reportId", "part"]),
  mediaSpendDaily: defineTable({
    key: v.string(),
    source: v.literal("lemonmax"),
    workspace: v.number(),
    date: v.string(),
    platform: v.string(),
    businessManagerId: v.string(),
    businessManagerName: v.optional(v.string()),
    accountId: v.string(),
    accountName: v.optional(v.string()),
    agencyId: v.optional(v.number()),
    agencyName: v.optional(v.string()),
    reportedPaymentMethod: v.optional(v.union(v.string(), v.null())),
    spend: v.number(),
    currency: v.string(),
    syncedAt: v.string()
  })
    .index("by_key", ["key"])
    .index("by_date", ["date"])
    .index("by_account_and_date", ["accountId", "date"])
    .index("by_business_manager_and_date", ["businessManagerId", "date"]),
  mediaSpendSyncState: defineTable({
    key: v.string(),
    source: v.literal("lemonmax"),
    status: v.union(v.literal("running"), v.literal("healthy"), v.literal("failed")),
    attemptId: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    requestedFrom: v.string(),
    requestedTo: v.string(),
    lastAttemptAt: v.string(),
    lastSuccessAt: v.optional(v.string()),
    coveredFrom: v.optional(v.string()),
    coveredThrough: v.optional(v.string()),
    rowCount: v.optional(v.number()),
    totalSpend: v.optional(v.number()),
    lastError: v.optional(v.string()),
    consecutiveFailures: v.optional(v.number()),
    updatedAt: v.string()
  }).index("by_key", ["key"]),
  mediaFundingProviders: defineTable({
    balanceVerifiedAt: v.optional(v.string()),
    sourceReference: v.optional(mediaFundingSourceReference),
    companyProviderId: v.string(),
    bankFundingPaused: v.optional(v.boolean()),
    defaultFeePercent: v.number(),
    currency: v.string(),
    openingBalance: v.number(),
    openingBalanceDate: v.string(),
    createdAt: v.string(),
    updatedAt: v.string()
  }).index("by_company_provider_id", ["companyProviderId"]),
  mediaFundingEntries: defineTable({
    providerId: v.id("mediaFundingProviders"),
    type: v.literal("adjustment"),
    date: v.string(),
    netAmount: v.number(),
    note: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string()
  })
    .index("by_provider_and_date", ["providerId", "date"])
    .index("by_provider_and_type_and_date", ["providerId", "type", "date"]),
  mediaFundingAssignments: defineTable({
    providerId: v.id("mediaFundingProviders"),
    scope: v.union(v.literal("business_manager"), v.literal("ad_account")),
    targetKey: v.string(),
    businessManagerKey: v.string(),
    platform: v.string(),
    businessManagerId: v.string(),
    businessManagerName: v.optional(v.string()),
    accountId: v.optional(v.string()),
    accountName: v.optional(v.string()),
    billingType: v.optional(v.union(v.literal("card"), v.literal("credit_line"))),
    effectiveFrom: v.string(),
    effectiveTo: v.optional(v.string()),
    autoPattern: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string()
  })
    .index("by_target_and_effective_from", ["targetKey", "effectiveFrom"])
    .index("by_business_manager_and_effective_from", ["businessManagerKey", "effectiveFrom"])
    .index("by_provider_and_effective_from", ["providerId", "effectiveFrom"])
    .index("by_effective_from", ["effectiveFrom"]),
  mediaAccountPaymentMethods: defineTable({
    providerId: v.optional(v.id("mediaFundingProviders")),
    platform: v.string(),
    accountId: v.string(),
    method: v.union(v.literal("needs_review"), v.literal("provider_funded"), v.literal("own_card"), v.literal("meta_credit_line")),
    reference: v.optional(v.string()),
    effectiveFrom: v.string(),
    effectiveTo: v.optional(v.string()),
    updatedAt: v.string()
  }).index("by_account", ["platform", "accountId"])
    .index("by_effective_from", ["effectiveFrom"]),
  mediaFundingAutomationExclusions: defineTable({
    targetKey: v.string(),
    effectiveFrom: v.string(),
    effectiveTo: v.optional(v.string()),
    createdAt: v.string()
  }).index("by_target", ["targetKey"])
    .index("by_effective_from", ["effectiveFrom"]),
  mediaFundingSpendDaily: defineTable({
    key: v.string(),
    providerId: v.id("mediaFundingProviders"),
    date: v.string(),
    currency: v.string(),
    spend: v.number(),
    billingSpend: v.optional(mediaFundingBillingSpend),
    billingRevision: v.optional(v.number()),
    classifiedSpend: v.optional(v.object({ provider_funded: v.number(), own_card: v.number(), meta_credit_line: v.number() })),
    accountCount: v.number(),
    businessManagerCount: v.number(),
    updatedAt: v.string()
  })
    .index("by_key", ["key"])
    .index("by_date", ["date"])
    .index("by_provider_and_date", ["providerId", "date"]),
  mediaFundingProviderTotals: defineTable({
    providerId: v.id("mediaFundingProviders"),
    currency: v.string(),
    adjustments: v.number(),
    spend: v.number(),
    billingSpend: v.optional(mediaFundingBillingSpend),
    billingRevision: v.optional(v.number()),
    billingRebuildFrom: v.optional(v.string()),
    classifiedSpend: v.optional(v.object({ provider_funded: v.number(), own_card: v.number(), meta_credit_line: v.number() })),
    updatedAt: v.string()
  }).index("by_provider", ["providerId"])
});
