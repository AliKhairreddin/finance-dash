import { v } from "convex/values";
export const replacementPhase = v.union(v.literal("preparing"), v.literal("backed_up"), v.literal("deleting"), v.literal("deleted"), v.literal("creating"), v.literal("created"), v.literal("completed"), v.literal("aborted"));
export const replacementFields = {
  id: v.string(), invoiceId: v.string(), phase: replacementPhase,
  beforeJson: v.string(), afterJson: v.string(), requestJson: v.optional(v.string()),
  originalStorageId: v.optional(v.id("_storage")), pdfStorageId: v.optional(v.id("_storage")),
  externalId: v.optional(v.string()), token: v.string(), leaseUntil: v.number(),
  error: v.optional(v.string()), createdAt: v.string(), updatedAt: v.string()
};
