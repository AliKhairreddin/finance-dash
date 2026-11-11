import { v } from "convex/values";
import { defineTable } from "convex/server";

export const flexAccount = v.object({
  type: v.union(v.literal("banking"), v.literal("rewardCard")),
  available: v.number(), availableAsOf: v.string(), status: v.string()
});
export const flexTransaction = v.object({
  id: v.string(), type: v.string(), status: v.string(), occurredAt: v.string(),
  createdAt: v.string(), modifiedAt: v.string(), declineReason: v.optional(v.string())
});
export const flexTables = {
  flexSyncControls: defineTable({ connectionKey: v.string(), activatedAt: v.string(), modifiedThrough: v.optional(v.string()),
    retryAt: v.number() }).index("by_connection", ["connectionKey"]),
  flexAlertStates: defineTable({ key: v.string(), at: v.string(), active: v.boolean() }).index("by_key", ["key"]),
  flexAlertDeliveries: defineTable({ key: v.string(), connectionKey: v.string(), message: v.string(), recipient: v.string(),
    status: v.union(v.literal("pending"), v.literal("sent"), v.literal("failed")), attempts: v.number(), nextAttemptAt: v.number(),
    createdAt: v.number() }).index("by_key", ["key"]).index("by_connection_status_next_attempt", ["connectionKey", "status", "nextAttemptAt"]).index("by_created", ["createdAt"])
};
