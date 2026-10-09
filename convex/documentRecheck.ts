import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, mutation, query } from "./_generated/server";
import { documentExtraction } from "./documentSchema";
import { reconcileExistingDocument } from "./documents";
import { documentSupplier } from "../shared/documentDuplicates";
import { validateExtraction } from "../shared/financialDocuments";
import { readBoundedResponseJson } from "../shared/boundedHttp";

const key = "purchase-references-v1";
const version = 1;
const nowIso = () => new Date().toISOString();
function authorize(token: string): void {
  if (!process.env.CONVEX_SERVICE_TOKEN || token !== process.env.CONVEX_SERVICE_TOKEN) throw new ConvexError("Unauthorized");
}
const statusValidator = v.object({ status: v.union(v.literal("running"), v.literal("completed")), checked: v.number(), skipped: v.number(), failed: v.number(), startedAt: v.string(), updatedAt: v.string() });
export const status = query({
  args: { serviceToken: v.string() }, returns: v.union(v.null(), statusValidator),
  handler: async (ctx, args) => {
    authorize(args.serviceToken);
    const job = await ctx.db.query("documentRechecks").withIndex("by_key", q => q.eq("key", key)).unique();
    return job ? { status: job.status, checked: job.checked, skipped: job.skipped, failed: job.failed, startedAt: job.startedAt, updatedAt: job.updatedAt } : null;
  }
});
export const start = mutation({
  args: { serviceToken: v.string() }, returns: v.object({ started: v.boolean() }),
  handler: async (ctx, args) => {
    authorize(args.serviceToken);
    const job = await ctx.db.query("documentRechecks").withIndex("by_key", q => q.eq("key", key)).unique();
    if (job?.status === "running") return { started: false };
    const runId = crypto.randomUUID();
    const next = { key, runId, status: "running" as const, cursor: null, exhausted: false, currentId: undefined, token: undefined, leaseUntil: undefined,
      attempts: 0, checked: 0, skipped: 0, failed: 0, startedAt: nowIso(), updatedAt: nowIso() };
    if (job) await ctx.db.patch(job._id, next); else await ctx.db.insert("documentRechecks", next);
    await ctx.scheduler.runAfter(0, internal.documentRecheck.run, { runId });
    return { started: true };
  }
});
export const claim = internalMutation({
  args: { runId: v.string(), token: v.string() }, returns: v.union(v.null(), v.id("financialDocuments")),
  handler: async (ctx, args) => {
    const job = await ctx.db.query("documentRechecks").withIndex("by_key", q => q.eq("key", key)).unique();
    if (!job || job.runId !== args.runId || job.status !== "running" || (job.leaseUntil ?? 0) > Date.now()) return null;
    if (job.currentId && job.attempts >= 3) {
      const doc = await ctx.db.get(job.currentId);
      if (doc) await ctx.db.patch(doc._id, { referenceError: "Reference check timed out; retry the recheck" });
      await ctx.db.patch(job._id, { currentId: undefined, token: undefined, leaseUntil: undefined, attempts: 0, failed: job.failed + 1, updatedAt: nowIso() });
      await ctx.scheduler.runAfter(1500, internal.documentRecheck.run, { runId: job.runId });
      return null;
    }
    let id = job.currentId;
    if (!id) {
      if (job.exhausted) { await ctx.db.patch(job._id, { status: "completed", updatedAt: nowIso() }); return null; }
      const page = await ctx.db.query("financialDocuments").withIndex("by_kind", q => q.eq("kind", "expense")).paginate({ cursor: job.cursor, numItems: 1 });
      const doc = page.page[0];
      await ctx.db.patch(job._id, { cursor: page.continueCursor, exhausted: page.isDone });
      if (!doc || doc.deletedAt || !doc.extraction || doc.referenceVersion === version || ["queued", "processing", "failed"].includes(doc.status)) {
        await ctx.db.patch(job._id, { skipped: job.skipped + (doc ? 1 : 0), updatedAt: nowIso() });
        await ctx.scheduler.runAfter(0, internal.documentRecheck.run, { runId: job.runId });
        return null;
      }
      id = doc._id;
    }
    await ctx.db.patch(job._id, { currentId: id, token: args.token, attempts: job.attempts + 1, leaseUntil: Date.now() + 150_000, updatedAt: nowIso() });
    await ctx.scheduler.runAfter(151_000, internal.documentRecheck.run, { runId: job.runId });
    return id;
  }
});
export const complete = internalMutation({
  args: { runId: v.string(), token: v.string(), extraction: documentExtraction }, returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.query("documentRechecks").withIndex("by_key", q => q.eq("key", key)).unique();
    if (!job || job.runId !== args.runId || job.token !== args.token || !job.currentId || job.status !== "running") return null;
    const doc = await ctx.db.get(job.currentId);
    let error: string | undefined;
    if (doc && !doc.deletedAt && doc.extraction && doc.referenceVersion !== version) {
      const old = doc.extraction, fresh = args.extraction;
      if (!fresh.identity) error = "The reference check returned no identifiers; existing details were preserved";
      else if (fresh.kind !== old.kind || fresh.amount !== old.amount || fresh.currency !== old.currency || documentSupplier(fresh.counterparty) !== documentSupplier(old.counterparty)
        || fresh.entity && (doc.entity ?? old.entity) && fresh.entity !== (doc.entity ?? old.entity)
        || !fresh.issueDate || !old.issueDate || Math.abs(Date.parse(fresh.issueDate) - Date.parse(old.issueDate)) > 7 * 86400000) {
        error = "The new reading disagrees with the saved purchase details; review the original. Existing details were preserved";
      } else if (["queued", "processing", "failed"].includes(doc.status)) error = "Document processing changed during the recheck; retry after it finishes";
      else {
        await reconcileExistingDocument(ctx, doc, { ...old, identity: fresh.identity });
        await ctx.db.patch(doc._id, { referenceVersion: version, referencesCheckedAt: nowIso(), referenceError: undefined });
      }
      if (error) await ctx.db.patch(doc._id, { referenceError: error });
    }
    await ctx.db.patch(job._id, { currentId: undefined, token: undefined, leaseUntil: undefined, attempts: 0,
      checked: job.checked + (error ? 0 : 1), failed: job.failed + (error ? 1 : 0), updatedAt: nowIso() });
    await ctx.scheduler.runAfter(1500, internal.documentRecheck.run, { runId: job.runId });
    return null;
  }
});
export const recover = internalMutation({
  args: { runId: v.string(), token: v.string(), error: v.string(), retryAfterMs: v.optional(v.number()) }, returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.query("documentRechecks").withIndex("by_key", q => q.eq("key", key)).unique();
    if (!job || job.runId !== args.runId || job.token !== args.token || !job.currentId || job.status !== "running") return null;
    const retry = job.attempts < 3;
    const delay = Math.max(5_000 * job.attempts, Math.min(900_000, args.retryAfterMs ?? 0));
    const doc = await ctx.db.get(job.currentId);
    if (doc && !retry) await ctx.db.patch(doc._id, { referenceError: args.error.slice(0, 400) });
    await ctx.db.patch(job._id, { token: undefined, leaseUntil: retry ? Date.now() + delay : undefined,
      ...(retry ? {} : { currentId: undefined, attempts: 0, failed: job.failed + 1 }), updatedAt: nowIso() });
    await ctx.scheduler.runAfter(retry ? delay : 1500, internal.documentRecheck.run, { runId: job.runId });
    return null;
  }
});
export const run = internalAction({
  args: { runId: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    const token = crypto.randomUUID();
    const id = await ctx.runMutation(internal.documentRecheck.claim, { ...args, token });
    if (!id) return null;
    let retryAfterMs: number | undefined;
    try {
      const endpoint = process.env.DOCUMENT_PROCESSOR_URL;
      if (!endpoint || new URL(endpoint).protocol !== "https:" || !process.env.CONVEX_SERVICE_TOKEN) throw new Error("Document processor is not configured");
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.CONVEX_SERVICE_TOKEN}` }, body: JSON.stringify({ id }), signal: AbortSignal.timeout(120_000) });
      if (!response.ok) {
        const retry = response.headers.get("Retry-After");
        if (retry) retryAfterMs = /^\d+$/.test(retry) ? Number(retry) * 1000 : Math.max(0, Date.parse(retry) - Date.now());
        throw new Error(`Document reference check returned ${response.status}`);
      }
      const extraction = validateExtraction(await readBoundedResponseJson(response, "Document reference check", 100_000));
      await ctx.runMutation(internal.documentRecheck.complete, { ...args, token, extraction });
    } catch (error) {
      await ctx.runMutation(internal.documentRecheck.recover, { ...args, token, error: error instanceof Error ? error.message : "Reference check failed", ...(Number.isFinite(retryAfterMs) ? { retryAfterMs } : {}) });
    }
    return null;
  }
});
