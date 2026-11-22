import { defineTable } from "convex/server";
import { v } from "convex/values";

export const owner = v.union(v.literal("Amin"), v.literal("Sanjin"), v.literal("Ben"));
export const addresses = v.object({ Amin: v.string(), Sanjin: v.string(), Ben: v.string() });
export const decisionState = v.union(v.literal("approved"), v.literal("changes"));
export const mailState = v.union(v.literal("queued"), v.literal("sending"), v.literal("sent"), v.literal("failed"), v.literal("unconfirmed"));

export const ownerReviewTables = {
  ownerReviewContacts: defineTable({ addresses }),
  ownerReviews: defineTable({
    period: v.string(), revision: v.number(), importId: v.string(), current: v.boolean(),
    publishedAt: v.number(), publishedBy: v.string(),
    decisions: v.array(v.object({ owner, state: decisionState, comment: v.string(), at: v.number() })),
    mail: v.array(v.object({ owner, email: v.string(), state: mailState, attempt: v.number(), updatedAt: v.number(), error: v.string() }))
  }).index("by_period_revision", ["period", "revision"]).index("by_current_period", ["current", "period"])
};
