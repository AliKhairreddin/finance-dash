import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const dataSource = v.union(
  v.literal("wise"),
  v.literal("slash"),
  v.literal("quickbooks"),
  v.literal("merit"),
  v.literal("manual"),
  v.literal("mock")
);

const providerType = v.union(
  v.literal("customer"),
  v.literal("supplier"),
  v.literal("platform"),
  v.literal("internal")
);

const invoiceStatus = v.union(v.literal("draft"), v.literal("open"), v.literal("paid"), v.literal("created"));

const provider = v.object({
  id: v.string(),
  name: v.string(),
  type: providerType,
  category: v.string(),
  aliases: v.array(v.string()),
  defaultAccount: v.optional(v.string()),
  source: dataSource,
  createdAt: v.string()
});

const invoice = v.object({
  id: v.string(),
  providerId: v.optional(v.string()),
  customerName: v.string(),
  amount: v.number(),
  currency: v.string(),
  status: invoiceStatus,
  dueDate: v.string(),
  source: dataSource,
  externalId: v.optional(v.string()),
  description: v.string(),
  transactionId: v.optional(v.string()),
  createdAt: v.string()
});

export default defineSchema({
  dashboardState: defineTable({
    key: v.string(),
    providers: v.array(provider),
    invoices: v.array(invoice),
    updatedAt: v.string()
  }).index("by_key", ["key"])
});
