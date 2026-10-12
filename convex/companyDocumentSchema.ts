import { v } from "convex/values";
export const contractExtraction = v.object({ parties: v.array(v.object({ name: v.string(), email: v.string(), registrationNumber: v.string(), taxId: v.string() })), confidence: v.number(), reason: v.string() });
export const companyDocumentFields = {
  storageId: v.id("_storage"), contentHash: v.string(), fileName: v.string(), contentType: v.string(), size: v.number(),
  source: v.union(v.literal("upload"), v.literal("email")), sourceContext: v.string(), sender: v.optional(v.string()),
  providerId: v.optional(v.string()), status: v.union(v.literal("queued"), v.literal("processing"), v.literal("assigned"), v.literal("needs_review")),
  matchReason: v.optional(v.string()), error: v.optional(v.string()), attempts: v.number(), attemptToken: v.optional(v.string()),
  createdAt: v.string(), updatedAt: v.string()
};
export const companyDocumentValidator = v.object({ _id: v.id("companyDocuments"), _creationTime: v.number(), ...companyDocumentFields });
