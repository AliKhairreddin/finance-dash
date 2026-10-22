import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { topUpInputFields, topUpRecord, paymentDetails } from "./topUpSchema";
import { validateTopUpInput, validateTopUpAmount, isCryptoTopUp, topUpTransition } from "../shared/topUps";
function authorize(token: string) { if (!process.env.CONVEX_SERVICE_TOKEN || token !== process.env.CONVEX_SERVICE_TOKEN) throw new ConvexError("Unauthorized"); }
const now = () => new Date().toISOString();
export const options = query({
  args: { serviceToken: v.string(), search: v.string(), team: v.optional(v.string()) }, returns: v.object({ providers: v.array(v.object({ id: v.string(), name: v.string() })), teams: v.array(v.string()), members: v.array(v.string()) }),
  handler: async (ctx, a) => { authorize(a.serviceToken); const state = await ctx.db.query("dashboardState").withIndex("by_key", q => q.eq("key", "default")).unique();
    const term = a.search.trim().toLowerCase().slice(0, 200);
    const recent = a.team ? await ctx.db.query("topUpRequests").withIndex("by_team", q => q.eq("team", a.team!)).order("desc").take(100) : [];
    return { providers: term.length < 2 ? [] : (state?.providers ?? []).filter(p => [p.name, p.legalName ?? "", ...p.aliases].some(n => n.toLowerCase().includes(term))).slice(0, 25).map(({ id, name }) => ({ id, name })), teams: [...new Set(["Cognitive", "Wagner", "Atlantic", ...(state?.teams ?? []).map(t => t.name)])], members: [...new Set(recent.filter(r => !r.deletedAt).map(r => r.member))].sort() };
  }
});
export const rateLimit = mutation({
  args: { serviceToken: v.string(), key: v.string(), limit: v.number() }, returns: v.boolean(),
  handler: async (ctx, a) => { authorize(a.serviceToken); const time = Date.now(); const row = await ctx.db.query("topUpRateLimits").withIndex("by_key", q => q.eq("key", a.key)).unique();
    for (const old of await ctx.db.query("topUpRateLimits").withIndex("by_expiry", q => q.lt("expiresAt", time)).take(30)) if (old._id !== row?._id) await ctx.db.delete(old._id);
    if (row && row.expiresAt > time && row.count >= a.limit) return false;
    const value = { key: a.key, count: row && row.expiresAt > time ? row.count + 1 : 1, expiresAt: row && row.expiresAt > time ? row.expiresAt : time + 3600_000 };
    if (row) await ctx.db.patch(row._id, value); else await ctx.db.insert("topUpRateLimits", value); return true;
  }
});
export const bySubmission = query({ args: { serviceToken: v.string(), submissionId: v.string() }, returns: v.union(topUpRecord, v.null()), handler: async (ctx, a) => { authorize(a.serviceToken); return ctx.db.query("topUpRequests").withIndex("by_submission", q => q.eq("submissionId", a.submissionId)).unique(); } });
export const create = mutation({
  args: { serviceToken: v.string(), input: v.object(topUpInputFields), documentId: v.optional(v.id("financialDocuments")) }, returns: topUpRecord,
  handler: async (ctx, a) => {
    authorize(a.serviceToken); const input = validateTopUpInput(a.input);
    const existing = await ctx.db.query("topUpRequests").withIndex("by_submission", q => q.eq("submissionId", input.submissionId)).unique(); if (existing) return existing;
    const document = a.documentId ? await ctx.db.get(a.documentId) : null;
    if (a.documentId && (!document || document.deletedAt)) throw new ConvexError("Invoice is unavailable. Restore it from Documents or upload another file.");
    if (!document && !isCryptoTopUp(input.currency)) throw new ConvexError("Upload an invoice for an ad spend request");
    const state = await ctx.db.query("dashboardState").withIndex("by_key", q => q.eq("key", "default")).unique();
    const provider = state?.providers.find(p => p.id === input.providerId);
    if (input.providerId && !provider) throw new ConvexError("Company no longer exists. Search again.");
    const counter = await ctx.db.query("topUpSettings").withIndex("by_key", q => q.eq("key", "sequence")).unique(); const number = (counter?.sequence ?? 0) + 1;
    if (counter) await ctx.db.patch(counter._id, { sequence: number }); else await ctx.db.insert("topUpSettings", { key: "sequence", sequence: number });
    const at = now(); const id = await ctx.db.insert("topUpRequests", { ...input, companyName: provider?.name ?? input.companyName, ...(document ? { documentId: document._id, fileName: document.fileName, contentType: document.contentType } : {}), number, status: "pending", version: 1, originalAmount: input.amount, createdAt: at, updatedAt: at, events: [{ at, actor: input.member, action: "submitted", amount: input.amount }], draftStatus: isCryptoTopUp(input.currency) ? "not_applicable" : "awaiting_approval" });
    await ctx.db.insert("topUpDeliveries", { requestId: id, version: 1, state: "pending", attempts: 0 });
    await ctx.scheduler.runAfter(0, internal.topUpProcessing.deliver, { id, version: 1 }); return (await ctx.db.get(id))!;
  }
});
export const list = query({
  args: { serviceToken: v.string(), paginationOpts: paginationOptsValidator }, returns: v.object({ page: v.array(topUpRecord), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, a) => { authorize(a.serviceToken); const p = await ctx.db.query("topUpRequests").withIndex("by_deleted", q => q.eq("deletedAt", undefined)).order("desc").paginate({ ...a.paginationOpts, numItems: Math.min(200, a.paginationOpts.numItems) }); return { page: p.page, isDone: p.isDone, continueCursor: p.continueCursor }; }
});
export const deletedList = query({
  args: { serviceToken: v.string(), paginationOpts: paginationOptsValidator }, returns: v.object({ page: v.array(topUpRecord), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, a) => { authorize(a.serviceToken); const p = await ctx.db.query("topUpRequests").withIndex("by_deleted", q => q.gt("deletedAt", "")).order("desc").paginate({ ...a.paginationOpts, numItems: Math.min(200, a.paginationOpts.numItems) }); return { page: p.page, isDone: p.isDone, continueCursor: p.continueCursor }; }
});
export const summary = query({ args: { serviceToken: v.string() }, returns: v.object({ pending: v.number(), approved: v.number(), capped: v.boolean() }), handler: async (ctx, a) => { authorize(a.serviceToken); const pending = await ctx.db.query("topUpRequests").withIndex("by_deleted_status", q => q.eq("deletedAt", undefined).eq("status", "pending")).take(1001); const approved = await ctx.db.query("topUpRequests").withIndex("by_deleted_status", q => q.eq("deletedAt", undefined).eq("status", "approved")).take(1001); return { pending: pending.length, approved: approved.length, capped: pending.length === 1001 || approved.length === 1001 }; } });
export const get = query({ args: { serviceToken: v.string(), id: v.id("topUpRequests") }, returns: v.union(topUpRecord, v.null()), handler: async (ctx, a) => { authorize(a.serviceToken); return ctx.db.get(a.id); } });
export const transition = mutation({
  args: { serviceToken: v.string(), id: v.id("topUpRequests"), version: v.number(), action: v.union(v.literal("approve"), v.literal("adjust"), v.literal("paid")), actor: v.string(), amount: v.optional(v.number()) }, returns: topUpRecord,
  handler: async (ctx, a) => { authorize(a.serviceToken); const r = await ctx.db.get(a.id); if (!r || r.deletedAt || r.version !== a.version) throw new ConvexError("This request has changed. Refresh before acting.");
    const status = topUpTransition(r.status, a.action, r.draftStatus); const amount = a.action === "adjust" ? a.amount : r.amount;
    try { validateTopUpAmount(amount, r.currency); } catch (error) { throw new ConvexError((error as Error).message); }
    if (amount === undefined) throw new ConvexError("Enter an amount");
    let providerId = r.providerId;
    if (a.action === "approve" && !providerId && !isCryptoTopUp(r.currency)) {
      const state = await ctx.db.query("dashboardState").withIndex("by_key", q => q.eq("key", "default")).unique(); if (!state) throw new ConvexError("Dashboard is unavailable");
      const normalized = r.companyName.trim().toLowerCase(); const existing = state.providers.find(p => [p.name, ...p.aliases].some(n => n.trim().toLowerCase() === normalized));
      providerId = existing?.id ?? `topup-provider-${r._id}`;
      if (!existing) await ctx.db.patch(state._id, { providers: [...state.providers, { id: providerId, name: r.companyName, type: "supplier", tags: ["top-up"], aliases: [], defaultCurrency: r.currency, source: "manual", createdAt: now() }], updatedAt: now() });
    }
    const at = now(); const version = r.version + 1;
    await ctx.db.patch(r._id, { status, amount, providerId, version, updatedAt: at, adjustPromptId: undefined, adjustUserId: undefined, adjustExpiresAt: undefined,
      ...(a.action === "approve" ? { approvedBy: a.actor, draftStatus: !isCryptoTopUp(r.currency) && (r.paymentMethod === "Bank Transfer" || r.paymentMethod === "") ? "queued" : "not_applicable" } : {}), ...(a.action === "paid" ? { paidBy: a.actor } : {}),
      events: [...r.events, { at, actor: a.actor, action: a.action, amount }].slice(-200), notificationError: undefined });
    await ctx.db.insert("topUpDeliveries", { requestId: r._id, version, state: "pending", attempts: 0 }); await ctx.scheduler.runAfter(0, internal.topUpProcessing.deliver, { id: r._id, version });
    if (a.action === "approve" && !isCryptoTopUp(r.currency) && (r.paymentMethod === "Bank Transfer" || !r.paymentMethod)) await ctx.scheduler.runAfter(0, internal.topUpProcessing.draft, { id: r._id });
    return (await ctx.db.get(r._id))!;
  }
});
export const adjustmentPrompt = mutation({ args: { serviceToken: v.string(), id: v.id("topUpRequests"), version: v.number(), promptId: v.number(), userId: v.string() }, returns: v.null(), handler: async (ctx, a) => { authorize(a.serviceToken); const r = await ctx.db.get(a.id); if (!r || r.deletedAt || r.status !== "pending" || r.version !== a.version) throw new ConvexError("Request has changed"); await ctx.db.patch(r._id, { adjustPromptId: a.promptId, adjustUserId: a.userId, adjustExpiresAt: Date.now() + 600_000 }); return null; } });
export const findAdjustment = query({ args: { serviceToken: v.string(), promptId: v.number(), userId: v.string() }, returns: v.union(topUpRecord, v.null()), handler: async (ctx, a) => { authorize(a.serviceToken); const r = await ctx.db.query("topUpRequests").withIndex("by_adjust_prompt", q => q.eq("adjustPromptId", a.promptId)).unique(); return !r?.deletedAt && r?.status === "pending" && r.adjustUserId === a.userId && (r.adjustExpiresAt ?? 0) > Date.now() ? r : null; } });
export const claimDelivery = internalMutation({ args: { id: v.id("topUpRequests"), version: v.number(), token: v.string() }, returns: v.boolean(), handler: async (ctx, a) => { const d = await ctx.db.query("topUpDeliveries").withIndex("by_request_version", q => q.eq("requestId", a.id).eq("version", a.version)).unique(); if (!d || d.state !== "pending") return false; await ctx.db.patch(d._id, { state: "sending", token: a.token, attempts: d.attempts + 1 }); await ctx.scheduler.runAfter(120_000, internal.topUps.recoverDelivery, a); return true; } });
export const deliveryResult = internalMutation({ args: { id: v.id("topUpRequests"), version: v.number(), token: v.string(), error: v.optional(v.string()) }, returns: v.null(), handler: async (ctx, a) => { const d = await ctx.db.query("topUpDeliveries").withIndex("by_request_version", q => q.eq("requestId", a.id).eq("version", a.version)).unique(); if (!d || d.token !== a.token) return null;
  const retry = !!a.error && d.attempts < 4; await ctx.db.patch(d._id, { state: a.error ? retry ? "pending" : "failed" : "sent", error: a.error }); const r = await ctx.db.get(a.id); if (r && r.version === a.version) await ctx.db.patch(r._id, { notificationError: a.error });
  if (retry) await ctx.scheduler.runAfter(Math.min(900_000, 60_000 * 2 ** d.attempts), internal.topUpProcessing.deliver, { id: a.id, version: a.version }); return null;
} });
export const retryNotification = mutation({ args: { serviceToken: v.string(), id: v.id("topUpRequests") }, returns: v.null(), handler: async (ctx, a) => { authorize(a.serviceToken); const r = await ctx.db.get(a.id); if (!r) throw new ConvexError("Request not found"); const d = await ctx.db.query("topUpDeliveries").withIndex("by_request_version", q => q.eq("requestId", a.id).eq("version", r.version)).unique(); if (d?.state === "sending") throw new ConvexError("Delivery is already running"); if (d) await ctx.db.patch(d._id, { state: "pending", attempts: 0 }); await ctx.scheduler.runAfter(0, internal.topUpProcessing.deliver, { id: a.id, version: r.version }); return null; } });
export const saveMessage = mutation({ args: { serviceToken: v.string(), id: v.id("topUpRequests"), version: v.number(), messageId: v.number() }, returns: v.null(), handler: async (ctx, a) => { authorize(a.serviceToken); const r = await ctx.db.get(a.id); if (r?.version === a.version) await ctx.db.patch(a.id, { telegramMessageId: a.messageId, telegramVersion: a.version }); return null; } });
export const claimDraft = mutation({ args: { serviceToken: v.string(), id: v.id("topUpRequests"), token: v.string() }, returns: v.boolean(), handler: async (ctx, a) => { authorize(a.serviceToken); const r = await ctx.db.get(a.id); if (!r || r.deletedAt || r.status !== "approved" || !["queued", "needs_review", "failed"].includes(r.draftStatus)) return false; await ctx.db.patch(r._id, { draftStatus: "creating", draftAttempt: a.token, draftError: undefined }); await ctx.scheduler.runAfter(180_000, internal.topUps.recoverDraft, { id: a.id, token: a.token }); return true; } });
export const draftResult = mutation({ args: { serviceToken: v.string(), id: v.id("topUpRequests"), token: v.string(), status: v.union(v.literal("created"), v.literal("needs_review"), v.literal("failed"), v.literal("uncertain")), error: v.optional(v.string()), draftId: v.optional(v.string()), details: v.optional(paymentDetails) }, returns: v.null(), handler: async (ctx, a) => { authorize(a.serviceToken); const r = await ctx.db.get(a.id); if (r?.draftAttempt !== a.token) return null; await ctx.db.patch(a.id, { draftStatus: a.status, draftError: a.error, draftId: a.draftId, ...(a.details ? { paymentDetails: a.details } : {}) }); return null; } });

export const recoverDelivery = internalMutation({ args: { id: v.id("topUpRequests"), version: v.number(), token: v.string() }, returns: v.null(), handler: async (ctx, a) => {
  const d = await ctx.db.query("topUpDeliveries").withIndex("by_request_version", q => q.eq("requestId", a.id).eq("version", a.version)).unique();
  if (!d || d.state !== "sending" || d.token !== a.token) return null;
  const r = await ctx.db.get(a.id); const delivered = r?.telegramVersion === a.version;
  await ctx.db.patch(d._id, { state: delivered ? "sent" : "failed", error: delivered ? undefined : "Telegram delivery was interrupted. Retry from the dashboard." });
  if (r && r.version === a.version && !delivered) await ctx.db.patch(r._id, { notificationError: "Telegram delivery was interrupted. Retry from the dashboard." }); return null;
} });
export const recoverDraft = internalMutation({ args: { id: v.id("topUpRequests"), token: v.string() }, returns: v.null(), handler: async (ctx, a) => {
  const r = await ctx.db.get(a.id); if (r?.draftAttempt === a.token && r.draftStatus === "creating") await ctx.db.patch(r._id, { draftStatus: "uncertain", draftError: "Draft preparation was interrupted. Check Revolut drafts before reconciling this request." }); return null;
} });
export const failQueuedDraft = internalMutation({ args: { id: v.id("topUpRequests") }, returns: v.null(), handler: async (ctx, a) => { const r = await ctx.db.get(a.id); if (r?.draftStatus === "queued" && !r.deletedAt) await ctx.db.patch(r._id, { draftStatus: "needs_review", draftError: "Automatic draft preparation could not start. Review this request to retry." }); return null; } });
export const reconcileDraft = mutation({ args: { serviceToken: v.string(), id: v.id("topUpRequests"), actor: v.string(), draftId: v.optional(v.string()), confirmedNoDraft: v.boolean() }, returns: v.null(), handler: async (ctx, a) => {
  authorize(a.serviceToken); const r = await ctx.db.get(a.id); if (!r || r.deletedAt || r.status !== "approved" || r.draftStatus !== "uncertain") throw new ConvexError("Only interrupted drafts can be reconciled");
  if (!a.draftId && !a.confirmedNoDraft) throw new ConvexError("Check Revolut and confirm the result first");
  await ctx.db.patch(r._id, { draftStatus: a.draftId ? "created" : "needs_review", draftId: a.draftId, draftError: undefined, events: [...r.events, { at: now(), actor: a.actor, action: a.draftId ? "draft_reconciled" : "no_draft_confirmed", amount: r.amount }] }); return null;
} });

export const setDeleted = mutation({
  args: { serviceToken: v.string(), id: v.id("topUpRequests"), version: v.number(), deleted: v.boolean(), actor: v.string() }, returns: topUpRecord,
  handler: async (ctx, a) => {
    authorize(a.serviceToken);
    const r = await ctx.db.get(a.id);
    if (!r || r.version !== a.version || !!r.deletedAt === a.deleted) throw new ConvexError("This request has changed. Refresh before acting.");
    if (["creating", "uncertain"].includes(r.draftStatus)) throw new ConvexError("Check and reconcile the Revolut draft before deleting this request.");
    const at = now(), version = r.version + 1;
    await ctx.db.patch(r._id, { deletedAt: a.deleted ? at : undefined, deletedBy: a.deleted ? a.actor : undefined, version, updatedAt: at,
      adjustPromptId: undefined, adjustUserId: undefined, adjustExpiresAt: undefined, notificationError: undefined,
      events: [...r.events, { at, actor: a.actor, action: a.deleted ? "deleted" : "restored", amount: r.amount }].slice(-200) });
    await ctx.db.insert("topUpDeliveries", { requestId: r._id, version, state: "pending", attempts: 0 });
    await ctx.scheduler.runAfter(0, internal.topUpProcessing.deliver, { id: r._id, version });
    if (!a.deleted && r.status === "approved" && r.draftStatus === "queued") await ctx.scheduler.runAfter(0, internal.topUpProcessing.draft, { id: r._id });
    return (await ctx.db.get(r._id))!;
  }
});
