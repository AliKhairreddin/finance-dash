import { v } from "convex/values";

export const amexStatementRow = v.object({
  id: v.string(), date: v.string(), description: v.string(), amount: v.number(),
  cardLastFour: v.optional(v.string()), cardHolderName: v.optional(v.string())
});
export const amexStatementFields = {
  contentHash: v.string(), storageId: v.id("_storage"), fileName: v.string(), contentType: v.string(),
  source: v.union(v.literal("upload"), v.literal("telegram")), createdAt: v.string(),
  status: v.union(v.literal("ready"), v.literal("importing"), v.literal("imported"), v.literal("failed")),
  currency: v.string(), cardLastFour: v.string(), rows: v.array(amexStatementRow),
  reviewReasons: v.array(v.string()), processed: v.number(), inserted: v.number(), duplicates: v.number(),
  periodStart: v.string(), periodEnd: v.string(), chargesTotal: v.number(), creditsTotal: v.number(),
  error: v.optional(v.string())
};
