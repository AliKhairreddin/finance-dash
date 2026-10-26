import { defineTable } from "convex/server";
import { v } from "convex/values";
import { statementCompany } from "./statementSchema";
export const invoiceTables = {
  statementInvoiceTemplates: defineTable({ companyId: statementCompany, storageId: v.id("_storage"), fileName: v.string(), layoutJson: v.string(), approved: v.boolean(), createdAt: v.number(), actor: v.string(), model: v.string(), costUsd: v.optional(v.number()) }).index("by_company", ["companyId"]),
  statementInvoices: defineTable({ companyId: statementCompany, templateId: v.id("statementInvoiceTemplates"), requestId: v.string(), draftJson: v.string(), sourceJson: v.string(), instructions: v.string(), state: v.union(v.literal("preparing"), v.literal("draft"), v.literal("failed"), v.literal("ready"), v.literal("discarded")), error: v.optional(v.string()), leaseToken: v.optional(v.string()), leaseUntil: v.number(), revision: v.number(), createdAt: v.number(), updatedAt: v.number(), actor: v.string(), number: v.string(), storageId: v.optional(v.id("_storage")), model: v.optional(v.string()), costUsd: v.optional(v.number()) }).index("by_request", ["requestId"]).index("by_company", ["companyId"]).index("by_company_number", ["companyId", "number"])
};
