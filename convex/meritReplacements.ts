import { ConvexError, v, type Infer } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { replacementFields, replacementPhase } from "./meritReplacementSchema";
import { assertUnpaidInvoice } from "../shared/meritReplacement";
import type { Invoice } from "../shared/types";
import { invoice as invoiceValidator } from "./dashboard";

function authorize(token: string) {
  if (!process.env.CONVEX_SERVICE_TOKEN || token !== process.env.CONVEX_SERVICE_TOKEN) throw new ConvexError("Unauthorized");
}
const updatedAt = (previous: string) => new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();
async function state(ctx: MutationCtx) {
  const value = await ctx.db.query("dashboardState").withIndex("by_key", q => q.eq("key", "default")).unique();
  if (!value) throw new ConvexError("Dashboard state not found");
  return value;
}
const auth = { serviceToken: v.string(), id: v.string(), token: v.string() };
async function owned(ctx: MutationCtx, args: { serviceToken: string; id: string; token: string }) {
  authorize(args.serviceToken);
  const job = await ctx.db.query("meritInvoiceReplacements").withIndex("by_operation_id", q => q.eq("id", args.id)).unique();
  if (!job || job.token !== args.token || job.leaseUntil <= Date.now()) throw new ConvexError("Replacement is running elsewhere; check its status shortly");
  return job;
}
const replacement = v.object(replacementFields);
export const claim = mutation({
  args: { serviceToken: v.string(), invoiceId: v.string(), id: v.string(), token: v.string(), after: v.optional(invoiceValidator), expectedUpdatedAt: v.optional(v.string()) },
  returns: replacement,
  handler: async (ctx, args): Promise<Infer<typeof replacement>> => {
    authorize(args.serviceToken);
    const saved = await state(ctx), current = saved.invoices.find(i => i.id === args.invoiceId);
    if (!current) throw new ConvexError("Invoice not found");
    const now = new Date().toISOString();
    if (current.meritReplacementId) {
      if (args.after) throw new ConvexError("This invoice has a pending replacement. Use Check replacement to recover the saved edit");
      const job = await ctx.db.query("meritInvoiceReplacements").withIndex("by_operation_id", q => q.eq("id", current.meritReplacementId!)).unique();
      if (!job || ["completed", "aborted"].includes(job.phase)) throw new ConvexError("Replacement record is inconsistent");
      if (job.leaseUntil > Date.now()) throw new ConvexError("Replacement is still running. Check again shortly");
      const update = { token: args.token, leaseUntil: Date.now() + 120_000, updatedAt: now };
      await ctx.db.patch(job._id, update);
      const { _id, _creationTime, ...value } = job;
      return { ...value, ...update };
    }
    const previous = await ctx.db.query("meritInvoiceReplacements").withIndex("by_invoice_id", q => q.eq("invoiceId", current.id)).order("desc").first();
    if (previous?.phase === "aborted" && previous.leaseUntil > Date.now()) throw new ConvexError("Merit rate limit reached; wait before saving again");
    const sync = await ctx.db.query("integrationSyncJobs").withIndex("by_key", q => q.eq("key", "merit")).unique();
    if (sync && sync.leaseExpiresAt > Date.now()) throw new ConvexError("Merit sync is running; save the edit after it finishes");
    if (!args.after || args.expectedUpdatedAt !== current.updatedAt) throw new ConvexError("Invoice changed; reopen the editor");
    assertUnpaidInvoice(current, saved.paymentAllocations);
    const job = { id: args.id, invoiceId: current.id, phase: "preparing" as const, beforeJson: JSON.stringify(current), afterJson: JSON.stringify(args.after), token: args.token, leaseUntil: Date.now() + 120_000, createdAt: now, updatedAt: now };
    await ctx.db.insert("meritInvoiceReplacements", job);
    await ctx.db.patch(saved._id, { invoices: saved.invoices.map(i => i.id === current.id ? { ...i, meritReplacementId: args.id } : i), updatedAt: updatedAt(saved.updatedAt) });
    return job;
  }
});
export const uploadUrl = mutation({ args: auth, returns: v.string(), handler: async (ctx, args) => { await owned(ctx, args); return ctx.storage.generateUploadUrl(); } });
export const backup = mutation({
  args: { ...auth, originalStorageId: v.id("_storage"), pdfStorageId: v.id("_storage"), requestJson: v.string(), after: invoiceValidator }, returns: v.null(),
  handler: async (ctx, args) => {
    const job = await owned(ctx, args);
    if (job.phase !== "preparing") throw new ConvexError("Original backup already exists");
    for (const [id, type] of [[args.originalStorageId, "application/json"], [args.pdfStorageId, "application/pdf"]] as const) {
      const file = await ctx.db.system.get(id);
      if (!file || file.size <= 0 || file.contentType !== type) throw new ConvexError("Original backup is not safely stored");
    }
    await ctx.db.patch(job._id, { originalStorageId: args.originalStorageId, pdfStorageId: args.pdfStorageId, requestJson: args.requestJson, afterJson: JSON.stringify(args.after), phase: "backed_up", updatedAt: new Date().toISOString(), leaseUntil: Date.now() + 120_000 });
    return null;
  }
});
export const phase = mutation({
  args: { ...auth, expected: replacementPhase, next: replacementPhase, externalId: v.optional(v.string()) }, returns: v.null(),
  handler: async (ctx, args) => {
    const job = await owned(ctx, args);
    const transitions: Record<string, string[]> = { backed_up: ["deleting"], deleting: ["deleted", "backed_up"], deleted: ["creating"], creating: ["created", "deleted"] };
    if (job.phase !== args.expected || !transitions[job.phase]?.includes(args.next) || !job.originalStorageId || !job.pdfStorageId || (args.next === "created" && !args.externalId)) throw new ConvexError("Invalid replacement transition");
    await ctx.db.patch(job._id, { phase: args.next, ...(args.externalId ? { externalId: args.externalId } : {}), updatedAt: new Date().toISOString(), leaseUntil: Date.now() + 120_000 });
    return null;
  }
});
export const complete = mutation({
  args: { ...auth, invoice: invoiceValidator, currentPdfStorageId: v.id("_storage") }, returns: invoiceValidator,
  handler: async (ctx, args) => {
    const job = await owned(ctx, args), saved = await state(ctx);
    const current = saved.invoices.find(i => i.id === job.invoiceId);
    if (job.phase !== "created" || !current || current.meritReplacementId !== job.id || args.invoice.externalId !== job.externalId) throw new ConvexError("Replacement is not ready to complete");
    assertUnpaidInvoice(current, saved.paymentAllocations);
    const pdf = await ctx.db.system.get(args.currentPdfStorageId);
    if (!pdf || pdf.contentType !== "application/pdf" || !pdf.size) throw new ConvexError("Replacement PDF is not stored");
    const { meritReplacementId: _pending, ...base } = current;
    const after = JSON.parse(job.afterJson) as Invoice;
    const invoice = { ...base, providerId: after.providerId, customerName: after.customerName, amount: after.amount, currency: after.currency,
      issueDate: after.issueDate, dueDate: after.dueDate, description: after.description, taxId: after.taxId, periodStart: after.periodStart, periodEnd: after.periodEnd,
      externalId: job.externalId!, meritPdfStorageId: args.currentPdfStorageId, meritBackupId: job.id, meritDeliveryStatus: "saved" as const,
      meritStatus: "open" as const, sentAt: undefined, meritDeliveryError: undefined, sendError: undefined, updatedAt: new Date().toISOString() };
    await ctx.db.patch(saved._id, { invoices: saved.invoices.map(i => i.id === current.id ? invoice : i),
      revenueRuns: saved.revenueRuns.map(run => current.revenueRunIds.includes(run.id) || run.invoiceId === current.id ? { ...run, externalInvoiceId: job.externalId } : run), updatedAt: updatedAt(saved.updatedAt) });
    await ctx.db.patch(job._id, { phase: "completed", leaseUntil: 0, error: undefined, updatedAt: new Date().toISOString() });
    return invoice;
  }
});
export const fail = mutation({
  args: { ...auth, message: v.string(), abort: v.boolean(), retryAfterMs: v.optional(v.number()) }, returns: v.null(),
  handler: async (ctx, args) => {
    const job = await owned(ctx, args);
    if (args.abort && !["preparing", "backed_up"].includes(job.phase)) throw new ConvexError("Cannot discard an attempted replacement");
    if (args.abort) {
      const saved = await state(ctx);
      await ctx.db.patch(saved._id, { invoices: saved.invoices.map(i => { if (i.meritReplacementId !== job.id) return i; const { meritReplacementId, ...rest } = i; return rest; }), updatedAt: updatedAt(saved.updatedAt) });
    }
    await ctx.db.patch(job._id, { ...(args.abort ? { phase: "aborted" as const } : {}), error: args.message.slice(0, 500), leaseUntil: args.abort && !args.retryAfterMs ? 0 : Date.now() + Math.max(30_000, args.retryAfterMs ?? 30_000), updatedAt: new Date().toISOString() });
    return null;
  }
});
export const files = query({
  args: { serviceToken: v.string(), invoiceId: v.string() },
  returns: v.object({ original: v.union(v.string(), v.null()), pdf: v.union(v.string(), v.null()), current: v.union(v.string(), v.null()) }),
  handler: async (ctx, args) => {
    authorize(args.serviceToken);
    const saved = await ctx.db.query("dashboardState").withIndex("by_key", q => q.eq("key", "default")).unique();
    const invoice = saved?.invoices.find(i => i.id === args.invoiceId);
    const id = invoice?.meritReplacementId ?? invoice?.meritBackupId;
    const job = id ? await ctx.db.query("meritInvoiceReplacements").withIndex("by_operation_id", q => q.eq("id", id)).unique() : null;
    return { original: job?.originalStorageId ? await ctx.storage.getUrl(job.originalStorageId) : null,
      pdf: job?.pdfStorageId ? await ctx.storage.getUrl(job.pdfStorageId) : null,
      current: invoice?.meritPdfStorageId ? await ctx.storage.getUrl(invoice.meritPdfStorageId) : null };
  }
});
