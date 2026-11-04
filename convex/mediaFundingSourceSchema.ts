import { v } from "convex/values";

// Observations for review, never a reconciled opening balance.
export const mediaFundingSourceReference = v.object({
  url: v.string(),
  observedAt: v.string(),
  balances: v.array(v.object({ label: v.string(), amount: v.union(v.number(), v.null()) })),
  commissionTerms: v.string(),
  notes: v.string()
});
