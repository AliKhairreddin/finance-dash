import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import { addresses, decisionState, owner } from "./ownerReviewSchema";
import { canPublishPeriod, ownerReport, owners, ownerTransaction } from "../shared/ownerReview";
import type { ManagementReportDashboard } from "../shared/managementReport";
import type { Doc, Id } from "./_generated/dataModel";

import type { QueryCtx } from "./_generated/server";

const service = { serviceToken: v.string() };
const reviewId = v.id("ownerReviews");
const readTarget = v.union(reviewId, v.object({ importId: v.string(), period: v.string() }));
const attemptArgs = { id: reviewId, owner, attempt: v.number() };
const pageArgs = { cursor: v.union(v.string(), v.null()) };

function authorize(token: string) {
  if (!process.env.CONVEX_SERVICE_TOKEN || token !== process.env.CONVEX_SERVICE_TOKEN) throw new ConvexError("Unauthorized");
}

function summary(row: Doc<"ownerReviews">, finance: boolean) {
  const { _id: id, period, revision, importId, current, publishedAt, decisions } = row;
  return { id, period, revision, importId, current, publishedAt, decisions,
    ...(finance ? { mail: row.mail.map(({ owner, state, error }) => ({ owner, state, error })) } : {}) };
}

export const list = query({
  args: { ...service, ...pageArgs, finance: v.boolean() }, returns: v.any(),
  handler: async (ctx, args) => {
    authorize(args.serviceToken);
    const result = await ctx.db.query("ownerReviews").withIndex("by_period_revision").order("desc")
      .paginate({ cursor: args.cursor, numItems: 40 });
    return { rows: result.page.map(row => summary(row, args.finance)), next: result.isDone ? null : result.continueCursor };
  }
});

export const contacts = query({
  args: service, returns: v.union(addresses, v.null()), handler: async (ctx, args) => {
    authorize(args.serviceToken);
    return (await ctx.db.query("ownerReviewContacts").unique())?.addresses ?? null;
  }
});

export const saveContacts = mutation({
  args: { ...service, addresses }, returns: v.null(), handler: async (ctx, args) => {
    authorize(args.serviceToken);
    const next = { ...args.addresses };
    for (const owner of owners) {
      next[owner] = next[owner].trim().toLowerCase();
      if (next[owner].length > 254 || !/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(next[owner])) throw new ConvexError("Enter a valid email address for " + owner);
    }
    if (new Set(Object.values(next)).size !== owners.length) throw new ConvexError("Use a separate email address for each owner");
    const old = await ctx.db.query("ownerReviewContacts").unique();
    if (old) await ctx.db.patch(old._id, { addresses: next });
    else await ctx.db.insert("ownerReviewContacts", { addresses: next });
    return null;
  }
});

function latestWorkbook(ctx: QueryCtx) {
  return ctx.db.query("managementReportImports").withIndex("by_status_reporting_through_imported_at",
    q => q.eq("status", "complete")).order("desc").first();
}

export const imported = query({
  args: service, returns: v.object({ importId: v.string(), periods: v.array(v.string()) }),
  handler: async (ctx, args) => {
    authorize(args.serviceToken);
    const source = await latestWorkbook(ctx);
    const dashboard: ManagementReportDashboard | undefined = source?.dashboard;
    return { importId: source?.importId ?? "", periods: dashboard?.trend
      .map(point => point.period).filter(period => canPublishPeriod(dashboard, period)) ?? [] };
  }
});

async function readableMonth(ctx: QueryCtx, id: Id<"ownerReviews"> | { importId: string; period: string }) {
  if (typeof id !== "string") {
    const source = await latestWorkbook(ctx);
    if (!source?.dashboard || source.importId !== id.importId || !canPublishPeriod(source.dashboard, id.period)) {
      throw new ConvexError("This imported month is unavailable. Reload the dashboard.");
    }
    return { review: null, source, period: id.period };
  }
  const review = await ctx.db.get(id);
  if (!review) throw new ConvexError("Published month not found");
  const source = await ctx.db.query("managementReportImports").withIndex("by_import_id", q => q.eq("importId", review.importId)).unique();
  if (!source?.dashboard || source.status !== "complete") throw new ConvexError("Published workbook unavailable");
  return { review, source, period: review.period };
}

export const publish = mutation({
  args: { ...service, importId: v.string(), period: v.string(), actor: v.string(), expectedRevision: v.number() },
  returns: reviewId, handler: async (ctx, args) => {
    authorize(args.serviceToken);
    const latest = await latestWorkbook(ctx);
    if (!latest?.dashboard || latest.importId !== args.importId) throw new ConvexError("The workbook changed. Reload Management Report before publishing.");
    if (!canPublishPeriod(latest.dashboard, args.period)) throw new ConvexError("This month needs a validated report with revenue, gross profit and net profit.");
    const previous = await ctx.db.query("ownerReviews").withIndex("by_current_period", q => q.eq("current", true).eq("period", args.period)).unique();
    if (previous?.importId === latest.importId) return previous._id;
    if ((previous?.revision ?? 0) !== args.expectedRevision) throw new ConvexError("A newer review was published. Reload before continuing.");
    const contacts = await ctx.db.query("ownerReviewContacts").unique();
    if (!contacts) throw new ConvexError("Save an email address for each owner before publishing.");
    if (previous) await ctx.db.patch(previous._id, { current: false });
    const publishedAt = Date.now();
    const id = await ctx.db.insert("ownerReviews", {
      period: args.period, revision: args.expectedRevision + 1, importId: latest.importId,
      current: true, publishedAt, publishedBy: args.actor, decisions: [],
      mail: owners.map(owner => ({ owner, email: contacts.addresses[owner], state: "queued" as const, attempt: 1, updatedAt: publishedAt, error: "" }))
    });
    for (const owner of owners) await ctx.scheduler.runAfter(0, internal.ownerReviewMail.deliver, { id, owner, attempt: 1 });
    return id;
  }
});

export const report = query({
  args: { ...service, id: readTarget, owner }, returns: v.any(), handler: async (ctx, args) => {
    authorize(args.serviceToken);
    const { review, source, period } = await readableMonth(ctx, args.id);
    return { review: review ? summary(review, false) : null, report: ownerReport(source.dashboard, period, args.owner) };
  }
});

export const transactions = query({
  args: { ...service, id: readTarget, ...pageArgs }, returns: v.any(), handler: async (ctx, args) => {
    authorize(args.serviceToken);
    const { source, period } = await readableMonth(ctx, args.id);
    const result = await ctx.db.query("managementReportBankEntries").withIndex("by_import_date", q =>
      q.eq("importId", source.importId).gte("date", period.slice(0, 7) + "-01").lte("date", period)).order("desc")
      .paginate({ cursor: args.cursor, numItems: 150 });
    return { rows: result.page.map(entry => ownerTransaction(entry.payload)), next: result.isDone ? null : result.continueCursor };
  }
});

export const decide = mutation({
  args: { ...service, id: reviewId, owner, state: decisionState, comment: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    authorize(args.serviceToken);
    const row = await ctx.db.get(args.id);
    if (!row?.current) throw new ConvexError("Finance published a newer version. Open the current version to sign off.");
    const comment = args.comment.trim();
    if (comment.length > 2000 || (args.state === "changes" && !comment)) throw new ConvexError("Describe the requested changes in 1 to 2,000 characters.");
    const existing = row.decisions.find(d => d.owner === args.owner);
    if (existing?.state === args.state && existing.comment === comment) return null;
    if (existing) throw new ConvexError("Your decision has already been recorded for this version.");
    await ctx.db.patch(row._id, { decisions: [...row.decisions, { owner: args.owner, state: args.state, comment, at: Date.now() }] });
    return null;
  }
});

export const retryEmail = mutation({
  args: { ...service, id: reviewId, owner }, returns: v.null(), handler: async (ctx, args) => {
    authorize(args.serviceToken);
    const row = await ctx.db.get(args.id);
    if (!row?.current) throw new ConvexError("Open the current version.");
    const item = row.mail.find(m => m.owner === args.owner)!;
    if (item.state !== "failed" && item.state !== "unconfirmed") return null;
    const contacts = await ctx.db.query("ownerReviewContacts").unique();
    if (!contacts) throw new ConvexError("Save all three email addresses first.");
    const attempt = item.attempt + 1;
    await ctx.db.patch(row._id, { mail: row.mail.map(m => m.owner === args.owner ? { ...m, state: "queued", error: "", attempt, updatedAt: Date.now(), email: contacts.addresses[args.owner] } : m) });
    await ctx.scheduler.runAfter(0, internal.ownerReviewMail.deliver, { id: row._id, owner: args.owner, attempt });
    return null;
  }
});

export const claimMail = internalMutation({
  args: attemptArgs, returns: v.union(v.null(), v.object({ email: v.string(), period: v.string(), revision: v.number() })),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    const item = row?.mail.find(m => m.owner === args.owner);
    if (!row?.current || item?.attempt !== args.attempt || item.state !== "queued") return null;
    await ctx.db.patch(row._id, { mail: row.mail.map(m => m.owner === args.owner ? { ...m, state: "sending", updatedAt: Date.now() } : m) });
    await ctx.scheduler.runAfter(120000, internal.ownerReviews.finishMail, { ...args, state: "unconfirmed", error: "Delivery was not confirmed. Check with the owner before resending." });
    return { email: item.email, period: row.period, revision: row.revision };
  }
});

export const finishMail = internalMutation({
  args: { ...attemptArgs, state: v.union(v.literal("sent"), v.literal("failed"), v.literal("unconfirmed")), error: v.string() },
  returns: v.null(), handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row?.mail.some(m => m.owner === args.owner && m.attempt === args.attempt && m.state === "sending")) return null;
    await ctx.db.patch(row._id, { mail: row.mail.map(m =>
      m.owner === args.owner && m.attempt === args.attempt && m.state === "sending"
        ? { ...m, state: args.state, updatedAt: Date.now(), error: args.error } : m) });
    return null;
  }
});
