import { defineTable } from "convex/server";
import { v } from "convex/values";
export const statementCompany = v.union(v.literal("amg-holding"), v.literal("artec"), v.literal("inch-engineering"), v.literal("digital-nudge"), v.literal("inch-digital"), v.literal("mzs-bouw"));
export const statementActor = v.union(v.literal("Ali"), v.literal("Ali M"), v.literal("Alaa"));
export const statementStatus = v.union(v.literal("pending"), v.literal("reconciled"), v.literal("completed"));
export const statementOrigin = v.union(v.literal("manual"), v.literal("file"), v.literal("email"));
export const statementFileOrigin = v.union(v.literal("file"), v.literal("email"));
export const statementInputFields = { companyId: v.optional(statementCompany), date: v.string(), description: v.string(), counterparty: v.optional(v.string()), reference: v.optional(v.string()), source: v.string(), account: v.optional(v.string()), providerId: v.optional(v.string()), cardLastFour: v.optional(v.string()), amount: v.string(), currency: v.string(), direction: v.union(v.literal("in"), v.literal("out")), notes: v.optional(v.string()), fee: v.optional(v.string()), balance: v.optional(v.string()) };
const { amount: _amount, fee: _fee, balance: _balance, ...baseRow } = statementInputFields;
export const statementRowFields = { ...baseRow, amountMinor: v.string(), feeMinor: v.optional(v.string()), balanceMinor: v.optional(v.string()), reviewReasons: v.array(v.string()) };
export const statementRow = v.object(statementRowFields);
export const statementTransactionFields = { ...statementRowFields, origin: statementOrigin, status: statementStatus, documentIds: v.array(v.id("statementDocuments")), revision: v.number(), createdAt: v.string(), updatedAt: v.string(), createdBy: v.string(), importId: v.optional(v.id("statementImports")), deletedAt: v.optional(v.string()), identity: v.optional(v.string()), candidateKey: v.string(), intakeKey: v.string() };
export const statementTransactionPublic = v.object({ _id: v.id("statementTransactions"), ...statementRowFields, origin: statementOrigin, status: statementStatus, documentIds: v.array(v.id("statementDocuments")), revision: v.number(), createdAt: v.string(), updatedAt: v.string(), createdBy: v.string(), importId: v.optional(v.id("statementImports")), deletedAt: v.optional(v.string()) });
export const statementCardFields = { companyId: statementCompany, lastFour: v.string(), label: v.string(), source: v.optional(v.string()), account: v.optional(v.string()), active: v.boolean() };
export const statementCardPublic = v.object({ _id: v.id("statementCards"), ...statementCardFields });
export const statementEvidence = v.object({ field: v.string(), value: v.string(), quote: v.string(), page: v.optional(v.number()) });
export const statementDocumentFields = {
  companyId: v.optional(statementCompany), fileName: v.string(), contentType: v.string(), size: v.number(), storageId: v.id("_storage"), contentHash: v.string(), origin: statementFileOrigin,
  status: v.union(v.literal("queued"), v.literal("processing"), v.literal("needs_review"), v.literal("ready"), v.literal("failed")),
  documentType: v.union(v.literal("unknown"), v.literal("invoice"), v.literal("receipt"), v.literal("bank_statement"), v.literal("supporting")),
  sourceContext: v.optional(v.string()), senderKnown: v.optional(v.boolean()), sender: v.optional(v.string()), subject: v.optional(v.string()), messageId: v.optional(v.string()), receivedAt: v.optional(v.string()), emailRawStorageId: v.optional(v.id("_storage")),
  evidence: v.array(statementEvidence), reviewReasons: v.array(v.string()), extracted: v.optional(v.string()), error: v.optional(v.string()), attempts: v.number(), quarantined: v.boolean(),
  transactionIds: v.array(v.id("statementTransactions")), createdAt: v.string(), updatedAt: v.string(), importId: v.optional(v.id("statementImports")),
  attemptToken: v.optional(v.string()), leaseUntil: v.optional(v.number()), generationId: v.optional(v.string()), costUsd: v.optional(v.number())
};
const { storageId: _storage, contentHash: _hash, emailRawStorageId: _raw, attemptToken: _token, leaseUntil: _lease, ...documentPublicFields } = statementDocumentFields;
export const statementDocumentPublic = v.object({ _id: v.id("statementDocuments"), ...documentPublicFields });
export const statementImportFields = { fileName: v.string(), contentHash: v.string(), companyId: v.optional(statementCompany), origin: statementFileOrigin, status: v.union(v.literal("ready"), v.literal("importing"), v.literal("imported"), v.literal("failed")), rows: v.array(statementRow), documentId: v.optional(v.id("statementDocuments")), processed: v.number(), inserted: v.number(), duplicates: v.number(), reviewReasons: v.array(v.string()), error: v.optional(v.string()), createdAt: v.string(), createdBy: v.string(), csvText: v.optional(v.string()), mappingJson: v.optional(v.string()), reviewed: v.boolean(), errors: v.array(v.string()), storageId: v.optional(v.id("_storage")) };
const { contentHash: _importHash, storageId: _importStorage, ...importPublicFields } = statementImportFields;
export const statementImportPublic = v.object({ _id: v.id("statementImports"), ...importPublicFields });
const { rows: _rows, csvText: _csv, mappingJson: _mapping, ...importSummaryFields } = importPublicFields;
export const statementImportSummary = v.object({ _id: v.id("statementImports"), ...importSummaryFields, transactionCount: v.number() });
export const statementAddressFields = { companyId: v.union(statementCompany, v.literal("all")), name: v.string(), email: v.optional(v.string()), notes: v.string(), addressLine1: v.optional(v.string()), addressLine2: v.optional(v.string()), city: v.optional(v.string()), postalCode: v.optional(v.string()), country: v.optional(v.string()), invoiceName: v.optional(v.string()), vat: v.optional(v.string()), description: v.optional(v.string()), aliases: v.optional(v.array(v.string())), reviewNote: v.optional(v.string()) };
export const statementAddressPublic = v.object({ _id: v.id("statementAddresses"), ...statementAddressFields });
export const statementAuditFields = { entityType: v.string(), entityId: v.string(), actor: v.string(), action: v.string(), details: v.string(), createdAt: v.string() };
export const statementAuditPublic = v.object({ _id: v.id("statementAudit"), ...statementAuditFields });
export const statementSenderFields = { email: v.string(), actor: statementActor };
export const statementSenderPublic = v.object({ _id: v.id("statementSenders"), ...statementSenderFields });
export const statementTables = {
  statementConfiguration: defineTable({ key: v.string(), initializedAt: v.string() }).index("by_key", ["key"]),
  statementMembers: defineTable({ actor: statementActor, companyIds: v.array(statementCompany), manage: v.boolean() }).index("by_actor", ["actor"]),
  statementCards: defineTable(statementCardFields).index("by_companyId", ["companyId"]).index("by_lastFour", ["lastFour"]),
  statementTransactions: defineTable(statementTransactionFields).index("by_companyId_and_date", ["companyId", "date"]).index("by_date", ["date"]).index("by_identity", ["identity"]).index("by_intakeKey", ["intakeKey"]).index("by_candidateKey", ["candidateKey"]),
  statementImports: defineTable(statementImportFields).index("by_contentHash", ["contentHash"]).index("by_status", ["status"]).index("by_companyId", ["companyId"]),
  statementImportEdits: defineTable({ importId: v.id("statementImports"), companyId: v.optional(statementCompany), rows: v.array(statementRow), reviewReasons: v.array(v.string()), errors: v.array(v.string()), actor: statementActor, createdAt: v.string() }).index("by_importId", ["importId"]),
  statementDocuments: defineTable(statementDocumentFields).index("by_contentHash", ["contentHash"]).index("by_status", ["status"]).index("by_companyId", ["companyId"]),
  statementAddresses: defineTable(statementAddressFields).index("by_companyId", ["companyId"]),
  statementSenders: defineTable(statementSenderFields).index("by_email", ["email"]),
  statementAudit: defineTable(statementAuditFields).index("by_entityId", ["entityId"])
  ,statementLinks: defineTable({ transactionId: v.id("statementTransactions"), documentId: v.id("statementDocuments"), amountMinor: v.string(), currency: v.string(), note: v.string(), createdBy: v.string(), createdAt: v.string() }).index("by_transactionId", ["transactionId"]).index("by_documentId", ["documentId"])
};
