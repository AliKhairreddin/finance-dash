import { defineTable } from "convex/server";
import { v } from "convex/values";
import { statementCompany } from "./statementSchema";
export const intelligenceTables = {
  statementAutomationJobs: defineTable({
    key: v.string(),
    transactionId: v.id("statementTransactions"),
    actor: v.union(v.literal("Ali"), v.literal("Ali M"), v.literal("Alaa")),
    policyId: v.id("statementPolicies"),
    requestId: v.string(),
    state: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("blocked"),
    ),
    attempts: v.number(),
    leaseUntil: v.number(),
    nextAttemptAt: v.number(),
    token: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_next", ["nextAttemptAt"]),
  statementMerchants: defineTable({
    key: v.string(),
    companyId: statementCompany,
    financialAccountId: v.optional(v.string()),
    name: v.string(),
    aliases: v.array(v.string()),
    status: v.union(
      v.literal("queued"),
      v.literal("researching"),
      v.literal("suggested"),
      v.literal("approved"),
      v.literal("discarded"),
      v.literal("blocked"),
      v.literal("failed"),
    ),
    approvedJson: v.optional(v.string()),
    suggestionJson: v.optional(v.string()),
    approvedBy: v.optional(v.string()),
    approvedAt: v.optional(v.number()),
    researchedAt: v.optional(v.number()),
    nextAttemptAt: v.number(),
    attempts: v.number(),
    leaseToken: v.optional(v.string()),
    leaseUntil: v.number(),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_scope_key", ["companyId", "financialAccountId", "key"])
    .index("by_company", ["companyId"])
    .index("by_nextAttemptAt", ["nextAttemptAt"])
    .index("by_status_next", ["status", "nextAttemptAt"]),
};
