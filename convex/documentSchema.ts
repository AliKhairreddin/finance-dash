import { v } from "convex/values";

export const documentEntity = v.union(v.literal("dn"), v.literal("lmd"));
export const documentKind = v.union(v.literal("expense"), v.literal("invoice"), v.literal("unknown"));
export const documentStatus = v.union(v.literal("queued"), v.literal("processing"), v.literal("needs_review"), v.literal("unmatched"), v.literal("matched"), v.literal("failed"));
export const documentExtraction = v.object({
  kind: documentKind, entity: v.union(documentEntity, v.null()), counterparty: v.string(), documentNumber: v.string(),
  issueDate: v.union(v.string(), v.null()), dueDate: v.union(v.string(), v.null()), amount: v.union(v.number(), v.null()), currency: v.union(v.string(), v.null()),
  description: v.string(), confidence: v.number(), reviewReasons: v.array(v.string())
});
export const financialDocumentFields = {
  storageId: v.id("_storage"), contentHash: v.string(), intakeKey: v.string(), fileName: v.string(), contentType: v.string(), size: v.number(),
  source: v.union(v.literal("upload"), v.literal("email"), v.literal("telegram"), v.literal("archive")),
  sourceContext: v.string(), sender: v.optional(v.string()), status: documentStatus, entity: v.optional(documentEntity), kind: documentKind, month: v.string(),
  extraction: v.optional(documentExtraction), expenseId: v.optional(v.string()), invoiceId: v.optional(v.string()), transactionId: v.optional(v.string()),
  matchReason: v.optional(v.string()), error: v.optional(v.string()), attempts: v.number(), attemptToken: v.optional(v.string()),
  createdAt: v.string(), updatedAt: v.string(), processedAt: v.optional(v.string()), matchedAt: v.optional(v.string()), nextMatchAt: v.optional(v.string())
};
export const financialDocumentValidator = v.object({ _id: v.id("financialDocuments"), _creationTime: v.number(), ...financialDocumentFields });
