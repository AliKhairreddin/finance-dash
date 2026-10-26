import { defineTable } from "convex/server";
import { v } from "convex/values";
import { statementActor } from "./statementSchema";

export const exactKind = v.union(v.literal("accounts"), v.literal("invoices"), v.literal("purchases"), v.literal("transactions"), v.literal("receivables"), v.literal("payables"), v.literal("documents"), v.literal("documentTypes"), v.literal("attachments"), v.literal("glAccounts"), v.literal("journals"), v.literal("vatCodes"), v.literal("items"), v.literal("deleted"));
export const exactData = v.record(v.string(), v.union(v.string(), v.number(), v.boolean(), v.null()));
export const exactCompanyFields = { division: v.number(), name: v.string(), code: v.string(), currency: v.string(), active: v.boolean(), moveDate: v.string(), discoveredAt: v.number() };
export const exactDatasetFields = { division: v.number(), kind: exactKind, generation: v.string(), buildingGeneration: v.optional(v.string()), cursor: v.string(), nextUrl: v.optional(v.string()), state: v.string(), lastCompletedAt: v.optional(v.number()), error: v.optional(v.string()), nextRunAt: v.number(), attempts: v.number(), pages: v.number() };
export const exactRecordFields = { division: v.number(), kind: exactKind, generation: v.string(), providerId: v.string(), parentId: v.string(), data: exactData, deleted: v.boolean(), updatedAt: v.number() };
export const exactOperationFields = { requestId: v.string(), actor: statementActor, division: v.number(), kind: v.union(v.literal("accounts"), v.literal("invoices"), v.literal("purchases"), v.literal("documents"), v.literal("attachment")), method: v.union(v.literal("POST"), v.literal("PUT")), providerId: v.optional(v.string()), payloadJson: v.string(), expectedModified: v.optional(v.string()), state: v.union(v.literal("queued"), v.literal("running"), v.literal("succeeded"), v.literal("failed"), v.literal("uncertain")), message: v.optional(v.string()), createdAt: v.number(), updatedAt: v.number() };
export const exactTables = {
  exactConnections: defineTable({ key: v.string(), state: v.string(), encryptedTokens: v.optional(v.string()), expiresAt: v.optional(v.number()), userId: v.optional(v.string()), user: v.optional(v.string()), currentDivision: v.optional(v.number()), lastDiscoveryAt: v.optional(v.number()), error: v.optional(v.string()), leaseToken: v.optional(v.string()), leaseUntil: v.number(), nextAllowedAt: v.number(), discoveryPage: v.optional(v.string()), discoveryRun: v.optional(v.number()), discoveryFinalizing: v.optional(v.boolean()), resyncRun: v.optional(v.number()) }).index("by_key", ["key"]),
  exactOAuthStates: defineTable({ hash: v.string(), actor: statementActor, expiresAt: v.number() }).index("by_hash", ["hash"]).index("by_expiresAt", ["expiresAt"]),
  exactCompanies: defineTable(exactCompanyFields).index("by_division", ["division"]),
  exactDatasets: defineTable(exactDatasetFields).index("by_division_and_kind", ["division", "kind"]).index("by_nextRunAt", ["nextRunAt"]),
  exactRecords: defineTable(exactRecordFields).index("by_division_and_kind_and_generation_and_providerId", ["division", "kind", "generation", "providerId"]).index("by_division_and_kind_and_generation_and_parentId", ["division", "kind", "generation", "parentId"]),
  exactOperations: defineTable(exactOperationFields).index("by_requestId", ["requestId"]).index("by_state", ["state"]).index("by_division", ["division"])
};
