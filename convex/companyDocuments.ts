import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { companyDocumentValidator, contractExtraction } from "./companyDocumentSchema";
import { docxType, matchContractCompany, validateContractExtraction } from "../shared/companyDocuments";

function authorize(token: string) { if (!process.env.CONVEX_SERVICE_TOKEN || token !== process.env.CONVEX_SERVICE_TOKEN) throw new ConvexError("Unauthorized"); }
const now = () => new Date().toISOString();
export const list = query({
  args: { serviceToken: v.string(), paginationOpts: paginationOptsValidator },
  returns: v.object({ page: v.array(companyDocumentValidator), isDone: v.boolean(), continueCursor: v.string(), splitCursor: v.optional(v.union(v.string(), v.null())), pageStatus: v.optional(v.union(v.literal("SplitRecommended"), v.literal("SplitRequired"), v.null())) }),
  handler: async (ctx, args) => { authorize(args.serviceToken); return ctx.db.query("companyDocuments").order("desc").paginate({ ...args.paginationOpts, numItems: Math.min(100, args.paginationOpts.numItems) }); }
});
export const get = query({
  args: { serviceToken: v.string(), id: v.id("companyDocuments") }, returns: v.union(v.object({ document: companyDocumentValidator, url: v.union(v.string(), v.null()) }), v.null()),
  handler: async (ctx, args) => { authorize(args.serviceToken); const document = await ctx.db.get(args.id); return document ? { document, url: await ctx.storage.getUrl(document.storageId) } : null; }
});
export const ingest = mutation({
  args: { serviceToken: v.string(), storageId: v.id("_storage"), contentHash: v.string(), fileName: v.string(), contentType: v.string(), size: v.number(), source: v.union(v.literal("upload"), v.literal("email")), sourceContext: v.string(), sender: v.optional(v.string()), providerId: v.optional(v.string()) },
  returns: v.object({ id: v.id("companyDocuments"), duplicate: v.boolean() }),
  handler: async (ctx, args) => {
    authorize(args.serviceToken);
    if (!/^[a-f0-9]{64}$/.test(args.contentHash) || args.size <= 0 || args.size > 10 * 1024 * 1024 || args.fileName.length > 240 || !args.fileName || args.sourceContext.length > 12000 || !["application/pdf", "image/png", "image/jpeg", "image/webp", docxType, "text/plain"].includes(args.contentType)) throw new ConvexError("Invalid document");
    const state = await ctx.db.query("dashboardState").withIndex("by_key", q => q.eq("key", "default")).unique();
    if (args.providerId && !state?.providers.some(p => p.id === args.providerId)) throw new ConvexError("Company not found");
    const metadata = await ctx.db.system.get(args.storageId);
    if (!metadata || metadata.size !== args.size) throw new ConvexError("Stored document is incomplete");
    const duplicate = await ctx.db.query("companyDocuments").withIndex("by_content_hash", q => q.eq("contentHash", args.contentHash)).unique();
    if (duplicate) {
      if (duplicate.storageId !== args.storageId) await ctx.storage.delete(args.storageId);
      // An explicit upload can assign an unassigned copy; never silently move a filed contract.
      if (args.providerId && (!duplicate.providerId || !state?.providers.some(p => p.id === duplicate.providerId))) await ctx.db.patch(duplicate._id, { providerId: args.providerId, status: "assigned", attemptToken: undefined, error: undefined, matchReason: "Assigned during upload", updatedAt: now() });
      return { id: duplicate._id, duplicate: true };
    }
    const { serviceToken: _, ...input } = args;
    const id = await ctx.db.insert("companyDocuments", { ...input, status: args.providerId ? "assigned" : "queued", attempts: 0, createdAt: now(), updatedAt: now(), ...(args.providerId ? { matchReason: "Assigned during upload" } : {}) });
    if (!args.providerId) await ctx.scheduler.runAfter(0, internal.companyDocumentProcessing.process, { id });
    return { id, duplicate: false };
  }
});
export const assign = mutation({
  args: { serviceToken: v.string(), id: v.id("companyDocuments"), providerId: v.union(v.string(), v.null()) }, returns: v.null(),
  handler: async (ctx, args) => {
    authorize(args.serviceToken);
    if (!await ctx.db.get(args.id)) throw new ConvexError("Document not found");
    const state = await ctx.db.query("dashboardState").withIndex("by_key", q => q.eq("key", "default")).unique();
    if (args.providerId !== null && !state?.providers.some(p => p.id === args.providerId)) throw new ConvexError("Company not found");
    await ctx.db.patch(args.id, { providerId: args.providerId ?? undefined, status: args.providerId ? "assigned" : "needs_review", attemptToken: undefined, error: undefined, matchReason: args.providerId ? "Assigned manually" : "Moved to unassigned", updatedAt: now() }); return null;
  }
});
export const retry = mutation({
  args: { serviceToken: v.string(), id: v.id("companyDocuments") }, returns: v.null(),
  handler: async (ctx, args) => { authorize(args.serviceToken); const row = await ctx.db.get(args.id); if (!row || row.status !== "needs_review") throw new ConvexError("Only documents needing review can be retried"); await ctx.db.patch(args.id, { status: "queued", attempts: 0, error: undefined, updatedAt: now() }); await ctx.scheduler.runAfter(0, internal.companyDocumentProcessing.process, { id: args.id }); return null; }
});
export const claim = internalMutation({
  args: { id: v.id("companyDocuments"), token: v.string() }, returns: v.boolean(),
  handler: async (ctx, { id, token }) => { const row = await ctx.db.get(id); if (!row || row.status !== "queued") return false; await ctx.db.patch(id, { status: "processing", attemptToken: token, attempts: row.attempts + 1, updatedAt: now() }); await ctx.scheduler.runAfter(180000, internal.companyDocuments.recover, { id, token, error: "Company recognition timed out" }); return true; }
});
export const complete = internalMutation({
  args: { id: v.id("companyDocuments"), token: v.string(), extraction: contractExtraction }, returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id); if (!row || row.status !== "processing" || row.attemptToken !== args.token) return null;
    const state = await ctx.db.query("dashboardState").withIndex("by_key", q => q.eq("key", "default")).unique();
    const match = matchContractCompany(validateContractExtraction(args.extraction), state?.providers ?? []);
    await ctx.db.patch(args.id, { providerId: match.providerId, matchReason: match.reason, status: match.providerId ? "assigned" : "needs_review", attemptToken: undefined, error: undefined, updatedAt: now() }); return null;
  }
});
export const recover = internalMutation({
  args: { id: v.id("companyDocuments"), token: v.string(), error: v.string(), retryAfterMs: v.optional(v.number()) }, returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id); if (!row || row.status !== "processing" || row.attemptToken !== args.token) return null;
    const retry = row.attempts < 3;
    await ctx.db.patch(args.id, { status: retry ? "queued" : "needs_review", attemptToken: undefined, error: args.error.slice(0, 500), matchReason: retry ? "Recognition will retry" : "Recognition failed. Assign a company or retry.", updatedAt: now() });
    if (retry) await ctx.scheduler.runAfter(Math.max(30000 * row.attempts, Math.min(900000, args.retryAfterMs ?? 0)), internal.companyDocumentProcessing.process, { id: args.id }); return null;
  }
});
