import { defineTable } from "convex/server";
import { v } from "convex/values";
export const mailboxProvider = v.union(v.literal("gmail"), v.literal("outlook"));
export const mailboxFields = {
  provider: mailboxProvider, accountId: v.string(), email: v.string(), actor: v.string(), scanFrom: v.string(),
  state: v.union(v.literal("queued"), v.literal("scanning"), v.literal("connected"), v.literal("reconnect"), v.literal("failed"), v.literal("disconnected")),
  encryptedTokens: v.optional(v.string()), expiresAt: v.number(), nextRunAt: v.number(), leaseToken: v.optional(v.string()), leaseUntil: v.number(), attempts: v.number(),
  windowFrom: v.number(), windowTo: v.number(), cursor: v.optional(v.string()), completedThrough: v.optional(v.number()), lastCompletedAt: v.optional(v.number()), lastReconciledAt: v.optional(v.number()),
  scanned: v.number(), imported: v.number(), skipped: v.number(), issues: v.number(), latestIssue: v.optional(v.string()), error: v.optional(v.string()), createdAt: v.number(), lastRequestedAt: v.number()
};
export const mailboxView = v.object({ id: v.string(), provider: mailboxProvider, email: v.string(), actor: v.string(), scanFrom: v.string(), state: v.string(), scanned: v.number(), imported: v.number(), skipped: v.number(), issues: v.number(), latestIssue: v.optional(v.string()), error: v.optional(v.string()), lastCompletedAt: v.optional(v.number()), completedThrough: v.optional(v.number()), nextRunAt: v.number() });
export const statementMailboxTables = {
  statementMailboxes: defineTable(mailboxFields).index("by_provider_and_accountId", ["provider", "accountId"]).index("by_nextRunAt", ["nextRunAt"]),
  statementMailboxStates: defineTable({ hash: v.string(), provider: mailboxProvider, actor: v.string(), scanFrom: v.string(), verifier: v.string(), expiresAt: v.number() }).index("by_hash", ["hash"]).index("by_expiresAt", ["expiresAt"]),
  statementMailboxMessages: defineTable({ mailboxId: v.id("statementMailboxes"), providerId: v.string(), documents: v.array(v.id("statementDocuments")), issue: v.optional(v.string()), processedAt: v.number() }).index("by_mailboxId_and_providerId", ["mailboxId", "providerId"])
};
