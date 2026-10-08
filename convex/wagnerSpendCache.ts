import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";

const leaseMs = 60_000;
const maxPayloadBytes = 4 * 1024 * 1024;
const maxChunks = 50;

function authorize(serviceToken: string) {
  if (!process.env.CONVEX_SERVICE_TOKEN || serviceToken !== process.env.CONVEX_SERVICE_TOKEN) {
    throw new ConvexError({ code: "UNAUTHORIZED" });
  }
}

// An atomic read/reservation prevents simultaneous page loads from duplicating source requests.
export const acquire = mutation({
  args: { serviceToken: v.string(), key: v.string(), attemptId: v.string() },
  returns: v.union(
    v.object({ status: v.literal("cached"), payload: v.string(), savedAt: v.number(), refreshAfter: v.union(v.number(), v.null()) }),
    v.object({ status: v.literal("claimed") }),
    v.object({ status: v.literal("busy") })
  ),
  handler: async (ctx, args) => {
    authorize(args.serviceToken);
    if (!args.key.startsWith("wagner:v1:") || args.key.length > 5_000 || !args.attemptId) throw new ConvexError({ code: "INVALID_WAGNER_CACHE_KEY" });
    const existing = await ctx.db.query("wagnerSpendCache").withIndex("by_key", q => q.eq("key", args.key)).unique();
    if (existing?.savedAt !== undefined && existing.refreshAfter !== undefined
      && (existing.refreshAfter === null || existing.refreshAfter > Date.now())) {
      const chunks = await ctx.db.query("wagnerSpendCacheChunks").withIndex("by_report_and_part", q => q.eq("reportId", existing._id)).take(maxChunks + 1);
      if (chunks.length !== existing.chunkCount || chunks.length > maxChunks || chunks.some((chunk, index) => chunk.part !== index)) {
        throw new ConvexError({ code: "INCOMPLETE_WAGNER_CACHE" });
      }
      return { status: "cached" as const, payload: chunks.map(chunk => chunk.text).join(""), savedAt: existing.savedAt, refreshAfter: existing.refreshAfter };
    }
    if (existing && (existing.leaseExpiresAt ?? 0) > Date.now()) return { status: "busy" as const };
    const claim = { attemptId: args.attemptId, leaseExpiresAt: Date.now() + leaseMs };
    if (existing) await ctx.db.patch(existing._id, claim);
    else await ctx.db.insert("wagnerSpendCache", { key: args.key, ...claim });
    return { status: "claimed" as const };
  }
});

export const save = mutation({
  args: {
    serviceToken: v.string(), key: v.string(), attemptId: v.string(), payload: v.string(),
    savedAt: v.number(), refreshAfter: v.union(v.number(), v.null())
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    authorize(args.serviceToken);
    if (!args.payload || new TextEncoder().encode(args.payload).length > maxPayloadBytes
      || !Number.isFinite(args.savedAt) || (args.refreshAfter !== null && (!Number.isFinite(args.refreshAfter) || args.refreshAfter <= args.savedAt))) {
      throw new ConvexError({ code: "INVALID_WAGNER_CACHE_PAYLOAD" });
    }
    const existing = await ctx.db.query("wagnerSpendCache").withIndex("by_key", q => q.eq("key", args.key)).unique();
    if (!existing || existing.attemptId !== args.attemptId || (existing.leaseExpiresAt ?? 0) <= Date.now()) {
      throw new ConvexError({ code: "WAGNER_CACHE_LEASE_LOST" });
    }
    const previous = await ctx.db.query("wagnerSpendCacheChunks").withIndex("by_report_and_part", q => q.eq("reportId", existing._id)).take(maxChunks + 1);
    if (previous.length > maxChunks) throw new ConvexError({ code: "WAGNER_CACHE_TOO_LARGE" });
    for (const chunk of previous) await ctx.db.delete(chunk._id);
    let part = 0;
    // UTF-16 chunks remain well below Convex's document limit, even with multibyte names.
    for (let offset = 0; offset < args.payload.length; offset += 100_000) {
      await ctx.db.insert("wagnerSpendCacheChunks", { reportId: existing._id, part: part++, text: args.payload.slice(offset, offset + 100_000) });
    }
    await ctx.db.patch(existing._id, { savedAt: args.savedAt, refreshAfter: args.refreshAfter, chunkCount: part, attemptId: undefined, leaseExpiresAt: undefined });
    return null;
  }
});

export const release = mutation({
  args: { serviceToken: v.string(), key: v.string(), attemptId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    authorize(args.serviceToken);
    const existing = await ctx.db.query("wagnerSpendCache").withIndex("by_key", q => q.eq("key", args.key)).unique();
    if (existing?.attemptId === args.attemptId) await ctx.db.patch(existing._id, { attemptId: undefined, leaseExpiresAt: undefined });
    return null;
  }
});
