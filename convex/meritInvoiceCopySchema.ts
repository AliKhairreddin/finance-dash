import { v } from "convex/values";
export const meritInvoiceCopy = v.object({
  lines: v.array(v.object({
    itemCode: v.string(), description: v.string(), quantity: v.number(), price: v.number(),
    discountPercent: v.number(), discountAmount: v.number(), netAmount: v.number(), taxId: v.string(), taxPercent: v.number(), taxAmount: v.number(),
    accountCode: v.string(), departmentCode: v.string(), unit: v.string()
  })),
  netAmount: v.number(), taxAmount: v.number(), roundingAmount: v.number(), totalAmount: v.number(), currency: v.string(),
  departmentCode: v.string(), headerComment: v.string(), footerComment: v.string(), contractNumber: v.string()
});
