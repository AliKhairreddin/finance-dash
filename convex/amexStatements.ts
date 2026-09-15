import { ConvexError, v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { amexStatementFields, amexStatementRow } from "./amexStatementSchema";
import { validateAmexStatement, amexTransactionFromStatementRow } from "../shared/amexStatements";
import { applyActivityBatch } from "./banking";
import { assertBankLedgerReady } from "./bankLease";

function authorize(token: string) {
  if (!process.env.CONVEX_SERVICE_TOKEN || token !== process.env.CONVEX_SERVICE_TOKEN) throw new ConvexError("Unauthorized");
}
const { rows: _rows, storageId: _storageId, contentType: _contentType, contentHash: _contentHash, ...summaryFields } = amexStatementFields;
const summaryValidator = v.object({ ...summaryFields, _id: v.id("amexStatementImports"), transactionCount: v.number() });
function summary(doc: Doc<"amexStatementImports">) {
  const { _creationTime: _time, storageId: _storage, contentType: _type, contentHash: _hash, rows, ...result } = doc;
  return { ...result, transactionCount: rows.length };
}

export const stage = mutation({
  args: {
    serviceToken: v.string(), storageId: v.id("_storage"), contentHash: v.string(), fileName: v.string(),
    contentType: v.union(v.literal("application/pdf"), v.literal("text/csv")), source: v.union(v.literal("upload"), v.literal("telegram")),
    currency: v.string(), cardLastFour: v.string(), rows: v.array(amexStatementRow), reviewReasons: v.array(v.string())
  },
  returns: v.object({ id: v.id("amexStatementImports"), duplicate: v.boolean() }),
  handler: async (ctx, args) => {
    authorize(args.serviceToken);
    const data = validateAmexStatement(args);
    if (!/^[a-f0-9]{64}$/.test(args.contentHash) || !args.fileName || args.fileName.length > 240 || new TextEncoder().encode(JSON.stringify(args.rows)).length > 600_000) throw new ConvexError("Statement exceeds the supported size");
    if (new Set(args.rows.map(row => row.id)).size !== args.rows.length) throw new ConvexError("Duplicate statement row IDs");
    const existing = await ctx.db.query("amexStatementImports").withIndex("by_content_hash", q => q.eq("contentHash", args.contentHash)).unique();
    if (existing) {
      // A retry cannot silently change which card or currency an original belongs to.
      if (existing.currency !== args.currency || existing.cardLastFour !== args.cardLastFour || JSON.stringify(existing.rows) !== JSON.stringify(args.rows)) {
        await ctx.storage.delete(args.storageId);
        throw new ConvexError("This file was already uploaded with different details. Use its existing preview.");
      }
      if (existing.storageId !== args.storageId) await ctx.storage.delete(args.storageId);
      return { id: existing._id, duplicate: true };
    }
    const { serviceToken: _token, ...fields } = args;
    const dates = data.rows.map(row => row.date).sort();
    const id = await ctx.db.insert("amexStatementImports", {
      ...fields, createdAt: new Date().toISOString(), status: "ready", processed: 0, inserted: 0, duplicates: 0,
      periodStart: dates[0], periodEnd: dates[dates.length - 1],
      chargesTotal: data.rows.reduce((sum, row) => sum + Math.max(0, Math.round(row.amount * 100)), 0) / 100,
      creditsTotal: data.rows.reduce((sum, row) => sum + Math.max(0, -Math.round(row.amount * 100)), 0) / 100
    });
    return { id, duplicate: false };
  }
});

export const list = query({
  args: { serviceToken: v.string() }, returns: v.array(summaryValidator),
  handler: async (ctx, args) => { authorize(args.serviceToken); return (await ctx.db.query("amexStatementImports").order("desc").take(10)).map(summary); }
});
export const findByHash = query({
  args: { serviceToken: v.string(), contentHash: v.string() }, returns: v.union(v.id("amexStatementImports"), v.null()),
  handler: async (ctx, args) => { authorize(args.serviceToken); return (await ctx.db.query("amexStatementImports").withIndex("by_content_hash", q => q.eq("contentHash", args.contentHash)).unique())?._id ?? null; }
});
export const accounts = query({
  args: { serviceToken: v.string() }, returns: v.array(v.object({ id: v.string(), name: v.string(), source: v.literal("amex"), currency: v.string() })),
  handler: async (ctx, args) => { authorize(args.serviceToken); return (await ctx.db.query("amexStatementAccounts").take(100)).map(({ id, name, source, currency }) => ({ id, name, source, currency })); }
});
export const discard = mutation({
  args: { serviceToken: v.string(), id: v.id("amexStatementImports") }, returns: v.null(),
  handler: async (ctx, args) => {
    authorize(args.serviceToken); const doc = await ctx.db.get(args.id); if (!doc) return null;
    if (doc.status !== "ready") throw new ConvexError("Only an unimported preview can be discarded");
    await ctx.storage.delete(doc.storageId); await ctx.db.delete(args.id); return null;
  }
});
export const get = query({
  args: { serviceToken: v.string(), id: v.id("amexStatementImports") },
  returns: v.union(v.null(), v.object({ record: summaryValidator, rows: v.array(amexStatementRow), url: v.union(v.string(), v.null()), contentType: v.string() })),
  handler: async (ctx, args) => {
    authorize(args.serviceToken); const doc = await ctx.db.get(args.id);
    return doc ? { record: summary(doc), rows: doc.rows, url: await ctx.storage.getUrl(doc.storageId), contentType: doc.contentType } : null;
  }
});
export const start = mutation({
  args: { serviceToken: v.string(), id: v.id("amexStatementImports"), reviewed: v.boolean() }, returns: v.null(),
  handler: async (ctx, args) => {
    authorize(args.serviceToken); await assertBankLedgerReady(ctx);
    const doc = await ctx.db.get(args.id); if (!doc) throw new ConvexError("Statement not found");
    if (doc.reviewReasons.length && !args.reviewed) throw new ConvexError("Review this statement in Banks → Amex before importing");
    if (doc.status === "imported" || doc.status === "importing") return null;
    await ctx.db.patch(args.id, { status: "importing", error: undefined });
    await ctx.scheduler.runAfter(0, internal.amexStatementProcessing.process, { id: args.id });
    return null;
  }
});
export const batch = internalMutation({
  args: { id: v.id("amexStatementImports") }, returns: v.boolean(),
  handler: async (ctx, { id }) => {
    await assertBankLedgerReady(ctx);
    const doc = await ctx.db.get(id); if (!doc || doc.status !== "importing") return false;
    const binding = await ctx.db.query("bankConnectionBindings").withIndex("by_source", q => q.eq("source", "amex")).unique();
    // Statement imports own this connection when the live bank has never been connected.
    const connectionKey = binding?.connectionKey ?? "f33eb6b7d65f364f77d845c1f35b0ac8c8e44dc2b8e8c845942b638182c2b7e6";
    const rows = doc.rows.slice(doc.processed, doc.processed + 100);
    const accountId = `amex-statement-${doc.currency}-${doc.cardLastFour}`;
    const account = await ctx.db.query("amexStatementAccounts").withIndex("by_account_id", q => q.eq("id", accountId)).unique();
    if (!account) {
      if ((await ctx.db.query("amexStatementAccounts").take(100)).length >= 100) throw new ConvexError("Amex statement account limit reached");
      await ctx.db.insert("amexStatementAccounts", { id: accountId, name: `Amex •${doc.cardLastFour}`, source: "amex", currency: doc.currency });
    }
    const result = await applyActivityBatch(ctx, {
      source: "amex", connectionKey, replaceAccounts: false, accounts: [],
      transactions: rows.map(row => ({ ...amexTransactionFromStatementRow(doc, row, row.id), source: "amex" as const })), syncedAt: new Date().toISOString()
    });
    if (!binding) {
      // The first statement initializes a bank with current identities only; no legacy rows exist.
      const identity = await ctx.db.query("bankIdentityMigrations").withIndex("by_source", q => q.eq("source", "amex")).unique();
      const fields = { source: "amex" as const, version: 2, completedAt: new Date().toISOString() };
      if (identity) await ctx.db.patch(identity._id, fields); else await ctx.db.insert("bankIdentityMigrations", fields);
    }
    const processed = doc.processed + rows.length, done = processed === doc.rows.length;
    await ctx.db.patch(id, { processed, inserted: doc.inserted + result.insertedTransactions, duplicates: doc.duplicates + result.updatedTransactions, status: done ? "imported" : "importing" });
    if (!done) await ctx.scheduler.runAfter(0, internal.amexStatementProcessing.process, { id });
    return done;
  }
});
export const fail = internalMutation({
  args: { id: v.id("amexStatementImports"), error: v.string() }, returns: v.null(),
  handler: async (ctx, args) => { const doc = await ctx.db.get(args.id); if (doc?.status === "importing") await ctx.db.patch(args.id, { status: "failed", error: args.error.slice(0, 500) }); return null; }
});
