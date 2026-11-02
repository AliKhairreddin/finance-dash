import { v } from "convex/values";

export const revenueInvoiceLine = v.object({
  accountId: v.string(),
  accountName: v.string(),
  billingRuleId: v.string(),
  revenueRunId: v.string(),
  description: v.string(),
  amount: v.number(),
  itemCode: v.optional(v.string())
});
