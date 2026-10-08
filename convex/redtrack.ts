import { ConvexError, v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { fetchRedTrackRows, fetchRedTrackSources, RedTrackRateLimitError } from "../shared/redtrackApi";
import { redTrackCurrency, redTrackTimezone, redTrackDates, redTrackNeedsSync, redTrackSyncRanges, validateRedTrackDates, validateRedTrackLink, type RedTrackRow, type RedTrackSource } from "../shared/redtrack";
import { internal } from "./_generated/api";
import { redtrackRow, redtrackSource } from "./redtrackSchema";

function authorize(serviceToken: string): void {
  if (!process.env.CONVEX_SERVICE_TOKEN || serviceToken !== process.env.CONVEX_SERVICE_TOKEN) {
    throw new ConvexError({ status: 401, message: "RedTrack access is unauthorized." });
  }
}
type SavedReport = { days: { date: string; savedAt: number; rows: RedTrackRow[] }[]; sources: RedTrackSource[]; sourcesSavedAt: number | null };
type ReportResult = { rows: RedTrackRow[]; sources: RedTrackSource[]; fromDate: string; toDate: string; currency: string; timezone: string; fetchedAt: string; savedAt: string; syncedDates: string[] };

export const report = action({
  args: { serviceToken: v.string(), fromDate: v.string(), toDate: v.string(), force: v.optional(v.boolean()) },
  returns: v.object({ rows: v.array(redtrackRow), sources: v.array(redtrackSource),
    fromDate: v.string(), toDate: v.string(), currency: v.string(), timezone: v.string(), fetchedAt: v.string(), savedAt: v.string(), syncedDates: v.array(v.string()) }),
  handler: async (ctx, args): Promise<ReportResult> => {
    authorize(args.serviceToken);
    try { validateRedTrackDates(args.fromDate, args.toDate); } catch (error) { throw new ConvexError({ status: 400, message: (error as Error).message }); }
    const range = { fromDate: args.fromDate, toDate: args.toDate }, dates = redTrackDates(args.fromDate, args.toDate);
    let saved: SavedReport = await ctx.runQuery(internal.redtrackCache.read, range);
    const needed = () => dates.filter(date => args.force || redTrackNeedsSync(date, saved.days.find(day => day.date === date)?.savedAt, Date.now()));
    const syncedDates: string[] = [];
    if (needed().length) {
      const attemptId = crypto.randomUUID();
      if (!await ctx.runMutation(internal.redtrackCache.claim, { attemptId })) throw new ConvexError({ status: 409, message: "RedTrack is already syncing. Wait a few seconds and refresh." });
      try {
        saved = await ctx.runQuery(internal.redtrackCache.read, range);
        const apiKey = process.env.REDTRACK_API_KEY ?? "";
        const pacedFetch: typeof fetch = async (input, init) => {
          const wait: number = await ctx.runMutation(internal.redtrackCache.reserveRequest, { attemptId });
          if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
          return fetch(input, init);
        };
        let sources: RedTrackSource[] | undefined;
        if (!saved.sourcesSavedAt || args.force || Date.now() - saved.sourcesSavedAt > 86_400_000) sources = await fetchRedTrackSources(apiKey, pacedFetch);
        // Only missing or expired days are requested. A different filter or an
        // overlapping date window reuses the same saved daily data.
        for (const interval of redTrackSyncRanges(needed())) {
          const rows = await fetchRedTrackRows(apiKey, interval.fromDate, interval.toDate, pacedFetch);
          await ctx.runMutation(internal.redtrackCache.save, { attemptId, ...interval, rows, savedAt: Date.now(), ...(sources ? { sources } : {}) });
          sources = undefined;
          syncedDates.push(...redTrackDates(interval.fromDate, interval.toDate));
        }
        await ctx.runMutation(internal.redtrackCache.finish, { attemptId });
      } catch (error) {
        await ctx.runMutation(internal.redtrackCache.finish, { attemptId, error: error instanceof Error ? error.message : "RedTrack sync failed.",
          ...(error instanceof RedTrackRateLimitError ? { retryAt: error.retryAt } : {}) });
        if (error instanceof ConvexError) throw error;
        throw new ConvexError({ status: error instanceof RedTrackRateLimitError ? 429 : 502, message: error instanceof Error ? error.message : "RedTrack sync failed. Saved data was not replaced." });
      }
      saved = await ctx.runQuery(internal.redtrackCache.read, range);
    }
    if (saved.days.length !== dates.length) throw new ConvexError({ status: 502, message: "RedTrack coverage is incomplete. Retry the sync." });
    const rows = saved.days.flatMap(day => day.rows), sources = [...saved.sources];
    for (const row of rows) if (row.offerSourceId && !sources.some(source => source.id === row.offerSourceId)) sources.push({ id: row.offerSourceId, name: row.offerSource });
    return { ...range, rows, sources, currency: redTrackCurrency, timezone: redTrackTimezone, fetchedAt: new Date().toISOString(),
      savedAt: new Date(Math.min(...saved.days.map(day => day.savedAt))).toISOString(), syncedDates };
  }
});

export const links = query({
  args: { serviceToken: v.string() },
  returns: v.array(v.object({ sourceId: v.string(), url: v.string() })),
  handler: async (ctx, args) => {
    authorize(args.serviceToken);
    const links = await ctx.db.query("redtrackAdvertiserLinks").withIndex("by_source_id").take(2001);
    if (links.length > 2000) throw new ConvexError({ status: 409, message: "Too many advertiser links." });
    return links.map(({ sourceId, url }) => ({ sourceId, url }));
  }
});

export const saveLink = mutation({
  args: { serviceToken: v.string(), sourceId: v.string(), url: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    authorize(args.serviceToken);
    let url: string;
    try { url = validateRedTrackLink(args.sourceId, args.url); }
    catch (error) { throw new ConvexError({ status: 400, message: (error as Error).message }); }
    const previous = await ctx.db.query("redtrackAdvertiserLinks").withIndex("by_source_id", q => q.eq("sourceId", args.sourceId)).unique();
    if (!url) { if (previous) await ctx.db.delete(previous._id); return null; }
    if (previous) await ctx.db.patch(previous._id, { url });
    else await ctx.db.insert("redtrackAdvertiserLinks", { sourceId: args.sourceId, url });
    return null;
  }
});
