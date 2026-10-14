import { v } from "convex/values";

export const manualBankSource = v.union(v.literal("kraken"), v.literal("trust"));
export const manualBankFields = {
  companyName: v.string(), amount: v.number(), currency: v.string(),
  direction: v.union(v.literal("in"), v.literal("out")), date: v.string()
};
export const manualBankRecord = {
  ...manualBankFields, source: manualBankSource, createdBy: v.string(),
  revision: v.number(), createdAt: v.string(), updatedAt: v.string()
};
