import { ConvexError, v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { requireSyncLease } from "./integrationSync";
import { meritHistoryKey, validateMeritHistory } from "../shared/meritHistory";
const report = v.object({ fromDate: v.string(), toDate: v.string(), recordsJson: v.string(), fetchedAt: v.string() });
function authorize(token: string) {
  if (!process.env.CONVEX_SERVICE_TOKEN || token !== process.env.CONVEX_SERVICE_TOKEN) throw new ConvexError("Unauthorized");
}
export const get = query({
  args: { serviceToken: v.string(), fromDate: v.string(), toDate: v.string() }, returns: v.union(v.null(), report),
  handler: async (ctx, args) => {
    authorize(args.serviceToken);
    const key = meritHistoryKey(args.fromDate, args.toDate);
    const row = await ctx.db.query("meritHistoryReports").withIndex("by_key", q => q.eq("key", key)).unique();
    return row ? { fromDate: row.fromDate, toDate: row.toDate, recordsJson: row.recordsJson, fetchedAt: row.fetchedAt } : null;
  }
});
export const save = mutation({
  args: { serviceToken: v.string(), leaseId: v.string(), fromDate: v.string(), toDate: v.string(), recordsJson: v.string() }, returns: report,
  handler: async (ctx, args) => {
    authorize(args.serviceToken);
    const key = meritHistoryKey(args.fromDate, args.toDate);
    await requireSyncLease(ctx, key, args.leaseId);
    const recordsJson = validateMeritHistory(JSON.parse(args.recordsJson), args.fromDate, args.toDate);
    const value = { fromDate: args.fromDate, toDate: args.toDate, recordsJson, fetchedAt: new Date().toISOString() };
    const row = await ctx.db.query("meritHistoryReports").withIndex("by_key", q => q.eq("key", key)).unique();
    if (row && JSON.parse(row.recordsJson).length > 0 && JSON.parse(recordsJson).length === 0) throw new ConvexError("An empty refresh cannot replace saved invoice history; review Merit coverage");
    if (row) await ctx.db.patch(row._id, value);
    else await ctx.db.insert("meritHistoryReports", { key, ...value });
    return value;
  }
});
