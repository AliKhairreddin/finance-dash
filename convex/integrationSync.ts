import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";

function authorize(token: string) {
  if (!process.env.CONVEX_SERVICE_TOKEN || token !== process.env.CONVEX_SERVICE_TOKEN) throw new ConvexError("Unauthorized");
}
export async function requireSyncLease(ctx: MutationCtx, key: string, leaseId: string) {
  const job = await ctx.db.query("integrationSyncJobs").withIndex("by_key", q => q.eq("key", key)).unique();
  if (!job || job.leaseId !== leaseId || job.leaseExpiresAt <= Date.now()) throw new ConvexError("Sync lease expired; retry the sync");
  return job;
}
export const begin = mutation({
  args: { serviceToken: v.string(), key: v.string(), leaseId: v.string() },
  returns: v.object({ acquired: v.boolean(), retryAt: v.number() }),
  handler: async (ctx, args) => {
    authorize(args.serviceToken);
    if (args.key !== "merit" && !args.key.startsWith("quinstreet-mtd:")) throw new ConvexError("Unknown sync");
    const job = await ctx.db.query("integrationSyncJobs").withIndex("by_key", q => q.eq("key", args.key)).unique();
    const now = Date.now();
    const retryAt = Math.max(job?.leaseExpiresAt ?? 0, job?.nextAllowedAt ?? 0);
    if (retryAt > now) return { acquired: false, retryAt };
    const update = { key: args.key, leaseId: args.leaseId, leaseExpiresAt: now + 10 * 60_000, nextAllowedAt: now + 5 * 60_000, lastAttemptAt: new Date(now).toISOString() };
    if (job) await ctx.db.patch(job._id, update);
    else await ctx.db.insert("integrationSyncJobs", update);
    return { acquired: true, retryAt: update.nextAllowedAt };
  }
});
export const finish = mutation({
  args: { serviceToken: v.string(), key: v.string(), leaseId: v.string(), error: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    authorize(args.serviceToken);
    const job = await requireSyncLease(ctx, args.key, args.leaseId);
    await ctx.db.patch(job._id, { leaseExpiresAt: 0, error: args.error,
      ...(!args.error ? { lastSuccessAt: new Date().toISOString() } : {}) });
    return null;
  }
});
export const status = query({
  args: { serviceToken: v.string(), key: v.string() },
  returns: v.union(v.null(), v.object({ lastAttemptAt: v.string(), lastSuccessAt: v.optional(v.string()), error: v.optional(v.string()), running: v.boolean(), retryAt: v.number() })),
  handler: async (ctx, args) => {
    authorize(args.serviceToken);
    const job = await ctx.db.query("integrationSyncJobs").withIndex("by_key", q => q.eq("key", args.key)).unique();
    return job ? { lastAttemptAt: job.lastAttemptAt, lastSuccessAt: job.lastSuccessAt, error: job.error,
      running: job.leaseExpiresAt > Date.now(), retryAt: Math.max(job.leaseExpiresAt, job.nextAllowedAt) } : null;
  }
});
const report = v.object({ partnerId: v.string(), partnerName: v.string(), periodStart: v.string(), periodEnd: v.string(), timezone: v.string(), revenue: v.number(), currency: v.string(), fetchedAt: v.string() });
export const saveQuinStreetReport = mutation({
  args: { serviceToken: v.string(), leaseId: v.string(), report },
  returns: v.null(),
  handler: async (ctx, args) => {
    authorize(args.serviceToken);
    const value = args.report;
    const key = `quinstreet-mtd:${value.partnerId}:${value.periodStart}:${value.periodEnd}`;
    await requireSyncLease(ctx, key, args.leaseId);
    if (!Number.isFinite(value.revenue) || value.periodStart > value.periodEnd) throw new ConvexError("Invalid QuinStreet report");
    const existing = await ctx.db.query("quinstreetMonthlyReports").withIndex("by_partner_period", q => q.eq("partnerId", value.partnerId).eq("periodStart", value.periodStart).eq("periodEnd", value.periodEnd)).unique();
    if (existing) await ctx.db.replace(existing._id, value);
    else await ctx.db.insert("quinstreetMonthlyReports", value);
    return null;
  }
});
export const quinStreetReport = query({
  args: { serviceToken: v.string(), partnerId: v.string(), periodStart: v.string(), periodEnd: v.string() },
  returns: v.union(v.null(), report),
  handler: async (ctx, args) => {
    authorize(args.serviceToken);
    const value = await ctx.db.query("quinstreetMonthlyReports").withIndex("by_partner_period", q => q.eq("partnerId", args.partnerId).eq("periodStart", args.periodStart).eq("periodEnd", args.periodEnd)).unique();
    if (!value) return null;
    const { _id, _creationTime, ...result } = value;
    return result;
  }
});
