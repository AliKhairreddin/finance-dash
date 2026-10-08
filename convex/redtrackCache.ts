import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { redtrackRow, redtrackSource } from "./redtrackSchema";
import { redTrackDates } from "../shared/redtrack";

const leaseMs = 90_000;
const state = (ctx: QueryCtx | MutationCtx) => ctx.db.query("redtrackSyncState").withIndex("by_key", q => q.eq("key", "account")).unique();

export const read = internalQuery({
  args: { fromDate: v.string(), toDate: v.string() },
  returns: v.object({ days: v.array(v.object({ date: v.string(), savedAt: v.number(), rows: v.array(redtrackRow) })),
    sources: v.array(redtrackSource), sourcesSavedAt: v.union(v.number(), v.null()) }),
  handler: async (ctx, args) => {
    const days = await ctx.db.query("redtrackDays").withIndex("by_date", q => q.gte("date", args.fromDate).lte("date", args.toDate)).take(94);
    if (days.length > 93 || days.reduce((sum, day) => sum + day.rowCount, 0) > 8000) throw new ConvexError({ status: 400, message: "Choose a shorter RedTrack date range." });
    const result = [];
    for (const day of days) {
      const chunks = await ctx.db.query("redtrackDayChunks").withIndex("by_day_part", q => q.eq("dayId", day._id)).take(81);
      const rows = chunks.flatMap(chunk => chunk.rows);
      if (chunks.length !== day.chunkCount || chunks.some((chunk, index) => chunk.part !== index) || rows.length !== day.rowCount) {
        throw new ConvexError({ status: 500, message: "Saved RedTrack data is incomplete. Contact an administrator before syncing." });
      }
      result.push({ date: day.date, savedAt: day.savedAt, rows });
    }
    const sync = await state(ctx);
    return { days: result, sources: sync?.sources ?? [], sourcesSavedAt: sync?.sourcesSavedAt ?? null };
  }
});

export const claim = internalMutation({
  args: { attemptId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const existing = await state(ctx), now = Date.now();
    const retryAt = existing?.retryAt ?? 0;
    if (retryAt > now) throw new ConvexError({ status: 429, message: `RedTrack is cooling down until ${new Date(retryAt).toISOString()}. Saved data is unchanged.` });
    if ((existing?.leaseUntil ?? 0) > now) return false;
    const lease = { attemptId: args.attemptId, leaseUntil: now + leaseMs };
    if (existing) await ctx.db.patch(existing._id, lease);
    else await ctx.db.insert("redtrackSyncState", { key: "account", ...lease });
    return true;
  }
});

export const reserveRequest = internalMutation({
  args: { attemptId: v.string() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const sync = await state(ctx), now = Date.now();
    if (!sync || sync.attemptId !== args.attemptId || (sync.leaseUntil ?? 0) <= now) throw new ConvexError({ status: 409, message: "RedTrack sync lease expired. Please retry." });
    const at = Math.max(now, sync.nextRequestAt ?? 0);
    // The Regular API allows 20 requests/minute. This account-wide gate stays
    // below that rate, including across different report requests and users.
    await ctx.db.patch(sync._id, { nextRequestAt: at + 3200, leaseUntil: at + leaseMs });
    return at - now;
  }
});

export const save = internalMutation({
  args: { attemptId: v.string(), fromDate: v.string(), toDate: v.string(), rows: v.array(redtrackRow), savedAt: v.number(),
    sources: v.optional(v.array(redtrackSource)) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const sync = await state(ctx);
    if (!sync || sync.attemptId !== args.attemptId || (sync.leaseUntil ?? 0) <= Date.now()) throw new ConvexError({ status: 409, message: "RedTrack sync lease expired. Saved data is unchanged." });
    const dates = redTrackDates(args.fromDate, args.toDate);
    if (!dates.length || dates.length > 93 || args.rows.length > 8000 || args.rows.some(row => !dates.includes(row.date))) throw new ConvexError({ status: 400, message: "Invalid RedTrack snapshot." });
    for (const date of dates) {
      const rows = args.rows.filter(row => row.date === date);
      const previous = await ctx.db.query("redtrackDays").withIndex("by_date", q => q.eq("date", date)).unique();
      const fields = { date, savedAt: args.savedAt, rowCount: rows.length, chunkCount: Math.ceil(rows.length / 100) };
      const dayId = previous?._id ?? await ctx.db.insert("redtrackDays", fields);
      if (previous) {
        const chunks = await ctx.db.query("redtrackDayChunks").withIndex("by_day_part", q => q.eq("dayId", dayId)).take(81);
        if (chunks.length > 80) throw new ConvexError({ status: 500, message: "Invalid saved RedTrack chunks." });
        for (const chunk of chunks) await ctx.db.delete(chunk._id);
        await ctx.db.patch(dayId, fields);
      }
      for (let i = 0; i < rows.length; i += 100) await ctx.db.insert("redtrackDayChunks", { dayId, part: i / 100, rows: rows.slice(i, i + 100) });
    }
    await ctx.db.patch(sync._id, { leaseUntil: Date.now() + leaseMs,
      ...(args.sources ? { sources: args.sources, sourcesSavedAt: args.savedAt } : {}) });
    return null;
  }
});

export const finish = internalMutation({
  args: { attemptId: v.string(), error: v.optional(v.string()), retryAt: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const sync = await state(ctx);
    if (sync?.attemptId === args.attemptId) await ctx.db.patch(sync._id, { attemptId: undefined, leaseUntil: undefined,
      lastError: args.error, retryAt: args.retryAt });
    return null;
  }
});
