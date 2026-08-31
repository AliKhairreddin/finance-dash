import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";

const source = v.literal("lemonmax");
const syncStatus = v.union(v.literal("running"), v.literal("healthy"), v.literal("failed"));

const mediaSpendRow = v.object({
  key: v.string(),
  source,
  workspace: v.number(),
  date: v.string(),
  platform: v.string(),
  businessManagerId: v.string(),
  businessManagerName: v.optional(v.string()),
  accountId: v.string(),
  accountName: v.optional(v.string()),
  spend: v.number(),
  currency: v.string(),
  syncedAt: v.string()
});

const publicSyncState = v.object({
  status: syncStatus,
  lastAttemptAt: v.string(),
  lastSuccessAt: v.optional(v.string()),
  coveredFrom: v.optional(v.string()),
  coveredThrough: v.optional(v.string()),
  requestedFrom: v.string(),
  requestedTo: v.string(),
  rowCount: v.optional(v.number()),
  totalSpend: v.optional(v.number()),
  lastError: v.optional(v.string()),
  consecutiveFailures: v.optional(v.number())
});

const maximumRowsPerDate = 3_500;
const syncStateKey = "lemonmax";
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function requireServiceToken(serviceToken: string): void {
  const expected = process.env.CONVEX_SERVICE_TOKEN;
  if (!expected || serviceToken !== expected) throw new ConvexError({ code: "UNAUTHORIZED" });
}

function requireIsoDate(value: string): void {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!isoDatePattern.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new ConvexError({ code: "INVALID_MEDIA_SPEND_DATE" });
  }
}

function requireTimestamp(value: string): void {
  if (Number.isNaN(Date.parse(value))) throw new ConvexError({ code: "INVALID_MEDIA_SPEND_TIMESTAMP" });
}

export const listDate = query({
  args: {
    serviceToken: v.string(),
    date: v.string(),
    includeZeroSpend: v.boolean()
  },
  returns: v.object({
    rows: v.array(mediaSpendRow),
    storedRowCount: v.number()
  }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    requireIsoDate(args.date);

    const rows = await ctx.db
      .query("mediaSpendDaily")
      .withIndex("by_date", (q) => q.eq("date", args.date))
      .take(maximumRowsPerDate + 1);
    if (rows.length > maximumRowsPerDate) {
      throw new ConvexError({ code: "MEDIA_SPEND_DAY_TOO_LARGE" });
    }

    const publicRows = args.includeZeroSpend ? rows : rows.filter((row) => row.spend !== 0);
    return {
      rows: publicRows.map((row) => ({
        key: row.key,
        source: row.source,
        workspace: row.workspace,
        date: row.date,
        platform: row.platform,
        businessManagerId: row.businessManagerId,
        ...(row.businessManagerName ? { businessManagerName: row.businessManagerName } : {}),
        accountId: row.accountId,
        ...(row.accountName ? { accountName: row.accountName } : {}),
        spend: row.spend,
        currency: row.currency,
        syncedAt: row.syncedAt
      })),
      storedRowCount: rows.length
    };
  }
});

export const getSyncState = query({
  args: { serviceToken: v.string() },
  returns: v.union(publicSyncState, v.null()),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const storedSync = await ctx.db
      .query("mediaSpendSyncState")
      .withIndex("by_key", (q) => q.eq("key", syncStateKey))
      .unique();
    return storedSync ? {
      status: storedSync.status,
      lastAttemptAt: storedSync.lastAttemptAt,
      lastSuccessAt: storedSync.lastSuccessAt,
      coveredFrom: storedSync.coveredFrom,
      coveredThrough: storedSync.coveredThrough,
      requestedFrom: storedSync.requestedFrom,
      requestedTo: storedSync.requestedTo,
      rowCount: storedSync.rowCount,
      totalSpend: storedSync.totalSpend,
      lastError: storedSync.lastError,
      consecutiveFailures: storedSync.consecutiveFailures
    } : null;
  }
});

export const startSync = mutation({
  args: {
    serviceToken: v.string(),
    attemptId: v.string(),
    fromDate: v.string(),
    toDate: v.string(),
    startedAt: v.string()
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    requireIsoDate(args.fromDate);
    requireIsoDate(args.toDate);
    requireTimestamp(args.startedAt);
    if (!args.attemptId || args.fromDate > args.toDate) {
      throw new ConvexError({ code: "INVALID_MEDIA_SPEND_SYNC" });
    }

    const existing = await ctx.db
      .query("mediaSpendSyncState")
      .withIndex("by_key", (q) => q.eq("key", syncStateKey))
      .unique();
    const next = {
      key: syncStateKey,
      source: "lemonmax" as const,
      status: "running" as const,
      attemptId: args.attemptId,
      requestedFrom: args.fromDate,
      requestedTo: args.toDate,
      lastAttemptAt: args.startedAt,
      ...(existing?.lastSuccessAt ? { lastSuccessAt: existing.lastSuccessAt } : {}),
      ...(existing?.coveredFrom ? { coveredFrom: existing.coveredFrom } : {}),
      ...(existing?.coveredThrough ? { coveredThrough: existing.coveredThrough } : {}),
      ...(existing?.rowCount !== undefined ? { rowCount: existing.rowCount } : {}),
      ...(existing?.totalSpend !== undefined ? { totalSpend: existing.totalSpend } : {}),
      ...(existing?.consecutiveFailures !== undefined ? { consecutiveFailures: existing.consecutiveFailures } : {}),
      updatedAt: args.startedAt
    };
    if (existing) await ctx.db.replace(existing._id, next);
    else await ctx.db.insert("mediaSpendSyncState", next);
    return null;
  }
});

export const initializeCoverageFromStorage = mutation({
  args: { serviceToken: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const storedSync = await ctx.db
      .query("mediaSpendSyncState")
      .withIndex("by_key", (q) => q.eq("key", syncStateKey))
      .unique();
    if (!storedSync) return null;
    if (storedSync.coveredFrom) return storedSync.coveredFrom;

    const earliestRow = await ctx.db
      .query("mediaSpendDaily")
      .withIndex("by_date")
      .order("asc")
      .first();
    if (!earliestRow) return null;
    await ctx.db.patch(storedSync._id, {
      coveredFrom: earliestRow.date,
      updatedAt: new Date().toISOString()
    });
    return earliestRow.date;
  }
});

export const advanceCoverage = mutation({
  args: {
    serviceToken: v.string(),
    attemptId: v.string(),
    date: v.string(),
    direction: v.union(v.literal("backward"), v.literal("forward")),
    updatedAt: v.string()
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    requireIsoDate(args.date);
    requireTimestamp(args.updatedAt);
    const storedSync = await ctx.db
      .query("mediaSpendSyncState")
      .withIndex("by_key", (q) => q.eq("key", syncStateKey))
      .unique();
    if (!storedSync || storedSync.attemptId !== args.attemptId) return false;
    await ctx.db.patch(storedSync._id, {
      ...(args.direction === "backward"
        ? {
            coveredFrom: !storedSync.coveredFrom || args.date < storedSync.coveredFrom
              ? args.date
              : storedSync.coveredFrom
          }
        : {
            coveredThrough: !storedSync.coveredThrough || args.date > storedSync.coveredThrough
              ? args.date
              : storedSync.coveredThrough
          }),
      updatedAt: args.updatedAt
    });
    return true;
  }
});

export const replaceDate = mutation({
  args: {
    serviceToken: v.string(),
    date: v.string(),
    rows: v.array(mediaSpendRow)
  },
  returns: v.object({ inserted: v.number(), replaced: v.number(), deleted: v.number() }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    requireIsoDate(args.date);
    if (args.rows.length > maximumRowsPerDate) {
      throw new ConvexError({ code: "MEDIA_SPEND_DAY_TOO_LARGE" });
    }

    const incomingKeys = new Set<string>();
    for (const row of args.rows) {
      if (row.date !== args.date || incomingKeys.has(row.key)) {
        throw new ConvexError({ code: "INVALID_MEDIA_SPEND_ROWS" });
      }
      incomingKeys.add(row.key);
    }

    const existing = await ctx.db
      .query("mediaSpendDaily")
      .withIndex("by_date", (q) => q.eq("date", args.date))
      .take(maximumRowsPerDate + 1);
    if (existing.length > maximumRowsPerDate) {
      throw new ConvexError({ code: "MEDIA_SPEND_DAY_TOO_LARGE" });
    }
    const existingByKey = new Map(existing.map((row) => [row.key, row]));
    if (existingByKey.size !== existing.length) {
      throw new ConvexError({ code: "DUPLICATE_MEDIA_SPEND_STORAGE_KEYS" });
    }

    let inserted = 0;
    let replaced = 0;
    let deleted = 0;
    for (const row of args.rows) {
      const stored = existingByKey.get(row.key);
      if (stored) {
        await ctx.db.replace(stored._id, row);
        replaced += 1;
      } else {
        await ctx.db.insert("mediaSpendDaily", row);
        inserted += 1;
      }
    }
    for (const row of existing) {
      if (!incomingKeys.has(row.key)) {
        await ctx.db.delete(row._id);
        deleted += 1;
      }
    }
    return { inserted, replaced, deleted };
  }
});

export const completeSync = mutation({
  args: {
    serviceToken: v.string(),
    attemptId: v.string(),
    completedAt: v.string(),
    coveredThrough: v.string(),
    rowCount: v.number(),
    totalSpend: v.number()
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    requireTimestamp(args.completedAt);
    requireIsoDate(args.coveredThrough);
    const existing = await ctx.db
      .query("mediaSpendSyncState")
      .withIndex("by_key", (q) => q.eq("key", syncStateKey))
      .unique();
    if (!existing || existing.attemptId !== args.attemptId) return false;
    await ctx.db.replace(existing._id, {
      key: syncStateKey,
      source: "lemonmax",
      status: "healthy",
      requestedFrom: existing.requestedFrom,
      requestedTo: existing.requestedTo,
      lastAttemptAt: existing.lastAttemptAt,
      lastSuccessAt: args.completedAt,
      ...(existing.coveredFrom ? { coveredFrom: existing.coveredFrom } : {}),
      coveredThrough: existing.coveredThrough && existing.coveredThrough > args.coveredThrough
        ? existing.coveredThrough
        : args.coveredThrough,
      rowCount: args.rowCount,
      totalSpend: args.totalSpend,
      consecutiveFailures: 0,
      updatedAt: args.completedAt
    });
    return true;
  }
});

export const failSync = mutation({
  args: {
    serviceToken: v.string(),
    attemptId: v.string(),
    failedAt: v.string(),
    error: v.string()
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    requireTimestamp(args.failedAt);
    const existing = await ctx.db
      .query("mediaSpendSyncState")
      .withIndex("by_key", (q) => q.eq("key", syncStateKey))
      .unique();
    if (!existing || existing.attemptId !== args.attemptId) return false;
    await ctx.db.replace(existing._id, {
      key: syncStateKey,
      source: "lemonmax",
      status: "failed",
      requestedFrom: existing.requestedFrom,
      requestedTo: existing.requestedTo,
      lastAttemptAt: existing.lastAttemptAt,
      ...(existing.lastSuccessAt ? { lastSuccessAt: existing.lastSuccessAt } : {}),
      ...(existing.coveredFrom ? { coveredFrom: existing.coveredFrom } : {}),
      ...(existing.coveredThrough ? { coveredThrough: existing.coveredThrough } : {}),
      ...(existing.rowCount !== undefined ? { rowCount: existing.rowCount } : {}),
      ...(existing.totalSpend !== undefined ? { totalSpend: existing.totalSpend } : {}),
      lastError: args.error.slice(0, 500),
      consecutiveFailures: (existing.consecutiveFailures ?? 0) + 1,
      updatedAt: args.failedAt
    });
    return true;
  }
});
