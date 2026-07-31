import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";

const analyticsJob = v.object({
  key: v.string(),
  version: v.string(),
  fromDate: v.string(),
  toDate: v.string(),
  status: v.union(v.literal("building"), v.literal("complete")),
  cursor: v.union(v.string(), v.null()),
  accumulator: v.optional(v.any()),
  snapshot: v.optional(v.any()),
  updatedAt: v.string()
});

function requireServiceToken(serviceToken: string): void {
  const expected = process.env.CONVEX_SERVICE_TOKEN;
  if (!expected || serviceToken !== expected) throw new ConvexError({ code: "UNAUTHORIZED" });
}

function assertDateRange(fromDate: string, toDate: string): void {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)
    || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)
    || fromDate > toDate
  ) {
    throw new ConvexError({ code: "INVALID_DATE_RANGE" });
  }
}

function assertKey(key: string, fromDate: string, toDate: string): void {
  if (key !== `${fromDate}:${toDate}`) throw new ConvexError({ code: "INVALID_ANALYTICS_KEY" });
}

function assertVersion(version: string): void {
  if (!version || version.length > 256) throw new ConvexError({ code: "INVALID_ANALYTICS_VERSION" });
}

function publicJob(stored: {
  key: string;
  version: string;
  fromDate: string;
  toDate: string;
  status: "building" | "complete";
  cursor?: string;
  accumulator?: unknown;
  snapshot?: unknown;
  updatedAt: string;
}) {
  return {
    key: stored.key,
    version: stored.version,
    fromDate: stored.fromDate,
    toDate: stored.toDate,
    status: stored.status,
    cursor: stored.cursor ?? null,
    ...(stored.accumulator !== undefined ? { accumulator: stored.accumulator } : {}),
    ...(stored.snapshot !== undefined ? { snapshot: stored.snapshot } : {}),
    updatedAt: stored.updatedAt
  };
}

export const getJob = query({
  args: { serviceToken: v.string(), key: v.string() },
  returns: v.union(v.null(), analyticsJob),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const stored = await ctx.db
      .query("bankAnalyticsJobs")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    return stored ? publicJob(stored) : null;
  }
});

export const startJob = mutation({
  args: {
    serviceToken: v.string(),
    key: v.string(),
    version: v.string(),
    expectedVersion: v.union(v.string(), v.null()),
    fromDate: v.string(),
    toDate: v.string(),
    accumulator: v.any()
  },
  returns: analyticsJob,
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    assertDateRange(args.fromDate, args.toDate);
    assertKey(args.key, args.fromDate, args.toDate);
    assertVersion(args.version);
    if (args.expectedVersion !== null) assertVersion(args.expectedVersion);
    const existing = await ctx.db
      .query("bankAnalyticsJobs")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (existing?.version === args.version) return publicJob(existing);
    if ((existing?.version ?? null) !== args.expectedVersion) {
      throw new ConvexError({ code: "ANALYTICS_JOB_CONFLICT" });
    }
    const next = {
      key: args.key,
      version: args.version,
      fromDate: args.fromDate,
      toDate: args.toDate,
      status: "building" as const,
      cursor: undefined,
      accumulator: args.accumulator,
      snapshot: undefined,
      updatedAt: new Date().toISOString()
    };
    if (existing) await ctx.db.patch(existing._id, next);
    else await ctx.db.insert("bankAnalyticsJobs", next);
    return publicJob(next);
  }
});

export const saveProgress = mutation({
  args: {
    serviceToken: v.string(),
    key: v.string(),
    version: v.string(),
    expectedCursor: v.union(v.string(), v.null()),
    cursor: v.string(),
    accumulator: v.any()
  },
  returns: analyticsJob,
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    assertVersion(args.version);
    if (!args.cursor) throw new ConvexError({ code: "INVALID_ANALYTICS_CURSOR" });
    const existing = await ctx.db
      .query("bankAnalyticsJobs")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (
      !existing
      || existing.version !== args.version
      || existing.status !== "building"
      || (existing.cursor ?? null) !== args.expectedCursor
    ) {
      throw new ConvexError({ code: "ANALYTICS_JOB_CONFLICT" });
    }
    const next = {
      cursor: args.cursor,
      accumulator: args.accumulator,
      updatedAt: new Date().toISOString()
    };
    await ctx.db.patch(existing._id, next);
    return publicJob({ ...existing, ...next });
  }
});

export const completeJob = mutation({
  args: {
    serviceToken: v.string(),
    key: v.string(),
    version: v.string(),
    expectedCursor: v.union(v.string(), v.null()),
    snapshot: v.any()
  },
  returns: analyticsJob,
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    assertVersion(args.version);
    const existing = await ctx.db
      .query("bankAnalyticsJobs")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (
      !existing
      || existing.version !== args.version
      || existing.status !== "building"
      || (existing.cursor ?? null) !== args.expectedCursor
    ) {
      throw new ConvexError({ code: "ANALYTICS_JOB_CONFLICT" });
    }
    const next = {
      status: "complete" as const,
      cursor: undefined,
      accumulator: undefined,
      snapshot: args.snapshot,
      updatedAt: new Date().toISOString()
    };
    await ctx.db.patch(existing._id, next);
    return publicJob({ ...existing, ...next });
  }
});
