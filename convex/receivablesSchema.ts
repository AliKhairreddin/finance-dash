import { defineTable } from "convex/server";
import { v } from "convex/values";
export const trackerKind = v.union(...(["invoice", "earnings", "manual", "tariq", "monthly"] as const).map(v.literal));
export const trackerItem = v.object({
  key: v.string(), payer: v.string(), providerId: v.optional(v.string()), entity: v.optional(v.string()), currency: v.string(), amount: v.number(), kind: trackerKind,
  period: v.optional(v.string()), category: v.optional(v.string()), stream: v.optional(v.string()), invoiceId: v.optional(v.string()), reference: v.optional(v.string()), accountId: v.optional(v.string()),
  rejectedTransactions: v.optional(v.array(v.string())), expectedDate: v.optional(v.string()), dateBasis: v.optional(v.string()), dateConfidence: v.optional(v.string()), dateOverride: v.optional(v.boolean()), week: v.string(), payerSent: v.boolean(), review: v.optional(v.string()), checkedDate: v.optional(v.string()), sent: v.boolean(), archived: v.boolean(), createdAt: v.string(), updatedAt: v.string(), revision: v.number()
});
export const trackerReceipt = v.object({
  key: v.string(), itemKey: v.string(), transactionId: v.optional(v.string()), amount: v.number(), currency: v.string(), bankAmount: v.number(), bankCurrency: v.string(), paidAt: v.string(), bank: v.string(), account: v.string(), reference: v.optional(v.string()), evidence: v.string(), actor: v.string(), state: v.union(v.literal("active"), v.literal("reversed"), v.literal("transferred")), createdAt: v.string(), reversedAt: v.optional(v.string()), reversalReason: v.optional(v.string())
});
export const trackerRule = v.object({ payer: v.string(), kind: v.union(v.literal("weekly"), v.literal("monthly"), v.literal("hint")), slots: v.array(v.number()), label: v.string(), approved: v.boolean(), stream: v.optional(v.string()) });
export const trackerReportRow = v.object({
  key: v.string(), week: v.string(), section: trackerKind, payer: v.string(), amount: v.number(), currency: v.optional(v.string()), displayedCurrency: v.optional(v.string()), reference: v.optional(v.string()), period: v.optional(v.string()), source: v.optional(v.string()), category: v.optional(v.string()), expected: v.optional(v.string()), paid: v.boolean(), line: v.optional(v.string()), providerId: v.optional(v.string()), entity: v.optional(v.string()), accountId: v.optional(v.string()), invoiceId: v.optional(v.string()), stream: v.optional(v.string()), confidence: v.string(), raw: v.string(), issue: v.optional(v.string())
});
export const trackerReport = v.object({ key: v.string(), actor: v.string(), week: v.string(), origin: v.string(), rows: v.array(trackerReportRow), accepted: v.array(v.string()), summary: v.optional(v.number()), detail: v.number(), gap: v.optional(v.number()), issues: v.array(v.string()), files: v.array(v.object({ storageId: v.id("_storage"), name: v.string(), contentType: v.string() })), createdAt: v.string(), updatedAt: v.string() });
export const trackerDelivery = v.object({ key: v.string(), event: v.string(), itemKey: v.optional(v.string()), invoiceId: v.optional(v.string()), recipient: v.string(), text: v.string(), state: v.union(...(["pending", "sending", "sent", "retry", "uncertain", "disabled"] as const).map(v.literal)), attempts: v.number(), nextAt: v.number(), lease: v.optional(v.string()), error: v.optional(v.string()), createdAt: v.string(), sentAt: v.optional(v.string()) });
export const receivablesTables = {
  receivableItems: defineTable(trackerItem).index("by_key", ["key"]).index("by_invoice", ["invoiceId"]).index("by_archived", ["archived"]),
  receivableReceipts: defineTable(trackerReceipt).index("by_key", ["key"]).index("by_item", ["itemKey"]).index("by_transaction", ["transactionId"]).index("by_state", ["state"]),
  receivableReports: defineTable(trackerReport).index("by_key", ["key"]).index("by_actor", ["actor"]),
  receivableSources: defineTable({ key: v.string(), itemKey: v.string(), row: trackerReportRow, recognized: v.boolean(), reportKey: v.string(), updatedAt: v.string() }).index("by_key", ["key"]).index("by_item", ["itemKey"]),
  receivableAudit: defineTable({ itemKey: v.string(), actor: v.string(), action: v.string(), detail: v.string(), createdAt: v.string() }).index("by_item", ["itemKey"]),
  receivableSettings: defineTable({ key: v.string(), recipients: v.array(v.string()), enabledAt: v.optional(v.string()), reminderTime: v.string(), rules: v.array(trackerRule), updatedAt: v.string() }).index("by_key", ["key"]),
  receivableDeliveries: defineTable(trackerDelivery).index("by_key", ["key"]).index("by_state_next", ["state", "nextAt"]),
  receivableIntakes: defineTable({ actor: v.string(), week: v.string(), mediaGroupId: v.optional(v.string()), expires: v.number() }).index("by_actor", ["actor"])
};
