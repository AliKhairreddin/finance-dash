import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import {
  assertActiveBankSyncLease,
  assertBankConnectionBinding,
  assertBankLedgerReady,
  ensureBankConnectionBinding
} from "./bankLease";

const bankSource = v.union(
  v.literal("wise"),
  v.literal("revolut"),
  v.literal("slash"),
  v.literal("amex")
);
const checkpointValue = v.object({
  source: bankSource,
  connectionKey: v.string(),
  laneKey: v.string(),
  accountIds: v.array(v.string()),
  fromDate: v.string(),
  toDate: v.string(),
  checkpoint: v.string(),
  updatedAt: v.string()
});
const maximumCheckpointLength = 512 * 1024;
const maximumAccountsPerCheckpoint = 200;
const minimumLeaseMs = 60_000;
const maximumLeaseMs = 15 * 60_000;
const maximumBackfillJobsPerRun = 4;
const maximumBackfillAttempts = 8;
const staleBackfillAttemptMs = 20 * 60_000;
const backfillJobValue = v.object({
  key: v.string(),
  source: bankSource,
  connectionKey: v.string(),
  fromDate: v.string(),
  toDate: v.string(),
  status: v.union(
    v.literal("queued"),
    v.literal("running"),
    v.literal("complete"),
    v.literal("failed")
  ),
  attempts: v.number(),
  consecutiveFailures: v.number(),
  nextAttemptAt: v.string(),
  lastAttemptAt: v.optional(v.string()),
  lastError: v.optional(v.string()),
  completedAt: v.optional(v.string()),
  updatedAt: v.string()
});

function requireServiceToken(serviceToken: string): void {
  const expected = process.env.CONVEX_SERVICE_TOKEN;
  if (!expected || serviceToken !== expected) throw new ConvexError({ code: "UNAUTHORIZED" });
}

function assertDateRange(fromDate: string, toDate: string): void {
  const today = new Date().toISOString().slice(0, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)
    || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)
    || fromDate > toDate
    || toDate > today
  ) {
    throw new ConvexError({ code: "INVALID_DATE_RANGE" });
  }
}

function assertCheckpoint(checkpoint: string): void {
  if (!checkpoint || checkpoint.length > maximumCheckpointLength) {
    throw new ConvexError({ code: "INVALID_SYNC_CHECKPOINT" });
  }
}

function assertConnectionKey(connectionKey: string): void {
  if (!/^[0-9a-f]{64}$/.test(connectionKey)) {
    throw new ConvexError({ code: "INVALID_BANK_CONNECTION_KEY" });
  }
}

function assertLaneKey(laneKey: string): void {
  if (!laneKey || laneKey.length > 512 || /[\u0000-\u001f\u007f]/u.test(laneKey)) {
    throw new ConvexError({ code: "INVALID_SYNC_LANE_KEY" });
  }
}

function normalizedAccountIds(accountIds: string[]): string[] {
  const normalized = [...new Set(accountIds)].sort();
  if (
    normalized.length > maximumAccountsPerCheckpoint
    || normalized.some((accountId) => !accountId || accountId.length > 1_024)
  ) {
    throw new ConvexError({ code: "INVALID_SYNC_ACCOUNT_SET" });
  }
  return normalized;
}

function backfillJobKey(
  source: "wise" | "revolut" | "slash" | "amex",
  connectionKey: string,
  fromDate: string,
  toDate: string
): string {
  return `${source}:${connectionKey}:${fromDate}:${toDate}`;
}

function assertSuppliedBackfillJobKey(key: string): void {
  if (!key || key.length > 512 || /[\u0000-\u001f\u007f]/u.test(key)) {
    throw new ConvexError({ code: "INVALID_BACKFILL_JOB_KEY" });
  }
}

function publicBackfillJob(stored: {
  key: string;
  source: "wise" | "revolut" | "slash" | "amex";
  connectionKey: string;
  fromDate: string;
  toDate: string;
  status: "queued" | "running" | "complete" | "failed";
  attempts: number;
  consecutiveFailures: number;
  nextAttemptAt: string;
  lastAttemptAt?: string;
  lastError?: string;
  completedAt?: string;
  updatedAt: string;
}) {
  return {
    key: stored.key,
    source: stored.source,
    connectionKey: stored.connectionKey,
    fromDate: stored.fromDate,
    toDate: stored.toDate,
    status: stored.status,
    attempts: stored.attempts,
    consecutiveFailures: stored.consecutiveFailures,
    nextAttemptAt: stored.nextAttemptAt,
    ...(stored.lastAttemptAt ? { lastAttemptAt: stored.lastAttemptAt } : {}),
    ...(stored.lastError ? { lastError: stored.lastError } : {}),
    ...(stored.completedAt ? { completedAt: stored.completedAt } : {}),
    updatedAt: stored.updatedAt
  };
}

export const enqueueBackfill = mutation({
  args: {
    serviceToken: v.string(),
    source: bankSource,
    connectionKey: v.string(),
    fromDate: v.string(),
    toDate: v.string()
  },
  returns: backfillJobValue,
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    await assertBankLedgerReady(ctx);
    assertConnectionKey(args.connectionKey);
    await ensureBankConnectionBinding(ctx, args.source, args.connectionKey);
    assertDateRange(args.fromDate, args.toDate);
    const key = backfillJobKey(args.source, args.connectionKey, args.fromDate, args.toDate);
    const existing = await ctx.db
      .query("bankBackfillJobs")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (existing && existing.status !== "complete") return publicBackfillJob(existing);
    const updatedAt = new Date().toISOString();
    const next = {
      key,
      source: args.source,
      connectionKey: args.connectionKey,
      fromDate: args.fromDate,
      toDate: args.toDate,
      status: "queued" as const,
      attempts: existing?.status === "complete" ? 0 : existing?.attempts ?? 0,
      consecutiveFailures: 0,
      attemptToken: undefined,
      nextAttemptAt: updatedAt,
      lastAttemptAt: existing?.lastAttemptAt,
      lastError: undefined,
      completedAt: undefined,
      updatedAt
    };
    if (existing) await ctx.db.patch(existing._id, next);
    else await ctx.db.insert("bankBackfillJobs", next);
    return publicBackfillJob(next);
  }
});

export const getBackfill = query({
  args: { serviceToken: v.string(), key: v.string() },
  returns: v.union(v.null(), backfillJobValue),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    assertSuppliedBackfillJobKey(args.key);
    const stored = await ctx.db
      .query("bankBackfillJobs")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    return stored ? publicBackfillJob(stored) : null;
  }
});

export const retryBackfill = mutation({
  args: {
    serviceToken: v.string(),
    key: v.string(),
    connectionKey: v.string()
  },
  returns: backfillJobValue,
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    assertSuppliedBackfillJobKey(args.key);
    assertConnectionKey(args.connectionKey);
    await assertBankLedgerReady(ctx);
    const stored = await ctx.db
      .query("bankBackfillJobs")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (!stored || stored.connectionKey !== args.connectionKey) {
      throw new ConvexError({ code: "BACKFILL_JOB_NOT_FOUND" });
    }
    const expectedKey = backfillJobKey(
      stored.source,
      stored.connectionKey,
      stored.fromDate,
      stored.toDate
    );
    if (stored.key !== expectedKey || args.key !== expectedKey) {
      throw new ConvexError({ code: "INVALID_BACKFILL_JOB_KEY" });
    }
    assertDateRange(stored.fromDate, stored.toDate);
    await assertBankConnectionBinding(ctx, stored.source, stored.connectionKey);
    if (stored.status !== "failed") return publicBackfillJob(stored);

    const updatedAt = new Date().toISOString();
    const next = {
      status: "queued" as const,
      consecutiveFailures: 0,
      attemptToken: undefined,
      nextAttemptAt: updatedAt,
      lastError: undefined,
      completedAt: undefined,
      updatedAt
    };
    await ctx.db.patch(stored._id, next);
    return publicBackfillJob({ ...stored, ...next });
  }
});

export const getPendingBackfills = query({
  args: { serviceToken: v.string(), limit: v.optional(v.number()) },
  returns: v.array(backfillJobValue),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const limit = Math.max(
      1,
      Math.min(maximumBackfillJobsPerRun, Math.trunc(args.limit ?? maximumBackfillJobsPerRun))
    );
    const now = new Date().toISOString();
    const staleBefore = new Date(Date.now() - staleBackfillAttemptMs).toISOString();
    const jobs = await Promise.all(["wise", "revolut", "slash", "amex"].slice(0, limit).map(async (source) => {
      const queued = await ctx.db
        .query("bankBackfillJobs")
        .withIndex("by_source_status_next_attempt", (q) =>
          q.eq("source", source as "wise" | "revolut" | "slash" | "amex")
            .eq("status", "queued")
            .lte("nextAttemptAt", now)
        )
        .order("asc")
        .first();
      if (queued) return queued;
      const running = await ctx.db
        .query("bankBackfillJobs")
        .withIndex("by_source_status_next_attempt", (q) =>
          q.eq("source", source as "wise" | "revolut" | "slash" | "amex")
            .eq("status", "running")
        )
        .order("asc")
        .first();
      return running && running.updatedAt <= staleBefore ? running : null;
    }));
    return jobs.filter((job): job is NonNullable<typeof job> => job !== null).map(publicBackfillJob);
  }
});

export const startBackfillAttempt = mutation({
  args: {
    serviceToken: v.string(),
    key: v.string(),
    connectionKey: v.string(),
    expectedUpdatedAt: v.string(),
    attemptToken: v.string()
  },
  returns: v.object({ started: v.boolean(), job: backfillJobValue }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    assertConnectionKey(args.connectionKey);
    const stored = await ctx.db
      .query("bankBackfillJobs")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (!stored || stored.connectionKey !== args.connectionKey) {
      throw new ConvexError({ code: "BACKFILL_JOB_NOT_FOUND" });
    }
    if (!args.attemptToken || args.attemptToken.length > 256) {
      throw new ConvexError({ code: "INVALID_BACKFILL_ATTEMPT_TOKEN" });
    }
    const now = new Date().toISOString();
    const runningIsFresh = stored.status === "running"
      && Date.parse(stored.updatedAt) > Date.now() - staleBackfillAttemptMs;
    if (
      stored.status === "complete"
      || stored.status === "failed"
      || stored.updatedAt !== args.expectedUpdatedAt
      || runningIsFresh
      || (stored.status === "queued" && stored.nextAttemptAt > now)
    ) {
      return { started: false, job: publicBackfillJob(stored) };
    }
    const next = {
      status: "running" as const,
      attempts: stored.attempts + 1,
      attemptToken: args.attemptToken,
      lastAttemptAt: now,
      lastError: undefined,
      updatedAt: now
    };
    await ctx.db.patch(stored._id, next);
    return { started: true, job: publicBackfillJob({ ...stored, ...next }) };
  }
});

export const finishBackfillAttempt = mutation({
  args: {
    serviceToken: v.string(),
    key: v.string(),
    connectionKey: v.string(),
    attemptToken: v.string(),
    complete: v.boolean(),
    error: v.optional(v.string()),
    terminal: v.optional(v.boolean())
  },
  returns: backfillJobValue,
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    assertConnectionKey(args.connectionKey);
    if (args.error && args.error.length > 2_048) throw new ConvexError({ code: "INVALID_BACKFILL_ERROR" });
    const stored = await ctx.db
      .query("bankBackfillJobs")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (!stored || stored.connectionKey !== args.connectionKey) {
      throw new ConvexError({ code: "BACKFILL_JOB_NOT_FOUND" });
    }
    if (stored.status === "complete") return publicBackfillJob(stored);
    if (stored.status !== "running" || stored.attemptToken !== args.attemptToken) {
      throw new ConvexError({ code: "STALE_BACKFILL_ATTEMPT" });
    }
    const now = new Date().toISOString();
    const consecutiveFailures = args.error ? stored.consecutiveFailures + 1 : 0;
    const terminal = !args.complete && Boolean(
      args.terminal || (args.error && consecutiveFailures >= maximumBackfillAttempts)
    );
    const retryDelayMs = args.error
      ? Math.min(6 * 60 * 60_000, 30_000 * 2 ** Math.max(0, consecutiveFailures - 1))
      : 30_000;
    const next = args.complete
      ? {
          status: "complete" as const,
          attemptToken: undefined,
          nextAttemptAt: now,
          consecutiveFailures: 0,
          lastError: undefined,
          completedAt: now,
          updatedAt: now
        }
      : terminal
        ? {
            status: "failed" as const,
            attemptToken: undefined,
            nextAttemptAt: now,
            consecutiveFailures,
            lastError: args.error ?? "Backfill stopped after repeated failures",
            completedAt: undefined,
            updatedAt: now
          }
        : {
          status: "queued" as const,
          attemptToken: undefined,
          nextAttemptAt: new Date(Date.now() + retryDelayMs).toISOString(),
          consecutiveFailures,
          ...(args.error ? { lastError: args.error } : { lastError: undefined }),
          completedAt: undefined,
          updatedAt: now
        };
    await ctx.db.patch(stored._id, next);
    return publicBackfillJob({ ...stored, ...next });
  }
});

export const getCheckpoint = query({
  args: {
    serviceToken: v.string(),
    source: bankSource,
    connectionKey: v.string(),
    laneKey: v.string()
  },
  returns: v.union(v.null(), checkpointValue),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    assertConnectionKey(args.connectionKey);
    assertLaneKey(args.laneKey);
    await assertBankLedgerReady(ctx);
    const stored = await ctx.db
      .query("bankSyncCheckpoints")
      .withIndex("by_source_connection_lane", (q) =>
        q.eq("source", args.source)
          .eq("connectionKey", args.connectionKey)
          .eq("laneKey", args.laneKey)
      )
      .unique();
    if (!stored) return null;
    if (!stored.accountIds) {
      throw new ConvexError({ code: "SYNC_CHECKPOINT_ACCOUNT_SET_MISSING", source: args.source });
    }
    return {
      source: stored.source,
      connectionKey: args.connectionKey,
      laneKey: args.laneKey,
      accountIds: stored.accountIds,
      fromDate: stored.fromDate,
      toDate: stored.toDate,
      checkpoint: stored.checkpoint,
      updatedAt: stored.updatedAt
    };
  }
});

export const saveCheckpoint = mutation({
  args: {
    serviceToken: v.string(),
    source: bankSource,
    connectionKey: v.string(),
    laneKey: v.string(),
    accountIds: v.array(v.string()),
    fromDate: v.string(),
    toDate: v.string(),
    checkpoint: v.string(),
    expectedCheckpoint: v.union(v.string(), v.null()),
    leaseToken: v.string(),
    leaseFence: v.number()
  },
  returns: checkpointValue,
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    assertConnectionKey(args.connectionKey);
    assertLaneKey(args.laneKey);
    await assertActiveBankSyncLease(ctx, args.source, args);
    assertDateRange(args.fromDate, args.toDate);
    assertCheckpoint(args.checkpoint);
    if (args.expectedCheckpoint !== null) assertCheckpoint(args.expectedCheckpoint);
    const accountIds = normalizedAccountIds(args.accountIds);
    const existing = await ctx.db
      .query("bankSyncCheckpoints")
      .withIndex("by_source_connection_lane", (q) =>
        q.eq("source", args.source)
          .eq("connectionKey", args.connectionKey)
          .eq("laneKey", args.laneKey)
      )
      .unique();
    if ((existing?.checkpoint ?? null) !== args.expectedCheckpoint) {
      throw new ConvexError({ code: "SYNC_CHECKPOINT_CONFLICT", source: args.source });
    }
    const next = {
      source: args.source,
      connectionKey: args.connectionKey,
      laneKey: args.laneKey,
      accountIds,
      fromDate: args.fromDate,
      toDate: args.toDate,
      checkpoint: args.checkpoint,
      updatedAt: new Date().toISOString()
    };
    if (existing) await ctx.db.patch(existing._id, next);
    else await ctx.db.insert("bankSyncCheckpoints", next);
    return next;
  }
});

/**
 * Invalidates previously certified coverage as soon as provider account
 * discovery observes a different account set. This must run before the first
 * transaction page for the new account generation is written.
 */
export const registerAccountSet = mutation({
  args: {
    serviceToken: v.string(),
    source: bankSource,
    connectionKey: v.string(),
    accountIds: v.array(v.string()),
    leaseToken: v.string(),
    leaseFence: v.number()
  },
  returns: v.object({ changed: v.boolean(), invalidatedCoverageRanges: v.number() }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    assertConnectionKey(args.connectionKey);
    await assertBankConnectionBinding(ctx, args.source, args.connectionKey);
    await assertActiveBankSyncLease(ctx, args.source, args);
    const accountIds = normalizedAccountIds(args.accountIds);
    const existing = await ctx.db
      .query("bankSyncState")
      .withIndex("by_source_connection", (q) =>
        q.eq("source", args.source).eq("connectionKey", args.connectionKey)
      )
      .unique();
    if (!existing || JSON.stringify(existing.accountIds ?? []) === JSON.stringify(accountIds)) {
      return { changed: false, invalidatedCoverageRanges: 0 };
    }
    const invalidatedCoverageRanges = existing.coveredRanges.length;
    await ctx.db.patch(existing._id, {
      accountIds,
      coveredRanges: []
    });
    return { changed: true, invalidatedCoverageRanges };
  }
});

export const clearCheckpoint = mutation({
  args: {
    serviceToken: v.string(),
    source: bankSource,
    connectionKey: v.string(),
    laneKey: v.string(),
    expectedCheckpoint: v.union(v.string(), v.null()),
    leaseToken: v.string(),
    leaseFence: v.number()
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    assertConnectionKey(args.connectionKey);
    assertLaneKey(args.laneKey);
    await assertActiveBankSyncLease(ctx, args.source, args);
    if (args.expectedCheckpoint !== null) assertCheckpoint(args.expectedCheckpoint);
    const existing = await ctx.db
      .query("bankSyncCheckpoints")
      .withIndex("by_source_connection_lane", (q) =>
        q.eq("source", args.source)
          .eq("connectionKey", args.connectionKey)
          .eq("laneKey", args.laneKey)
      )
      .unique();
    if (!existing) return args.expectedCheckpoint === null;
    if (existing.checkpoint !== args.expectedCheckpoint) {
      throw new ConvexError({ code: "SYNC_CHECKPOINT_CONFLICT", source: args.source });
    }
    await ctx.db.delete(existing._id);
    return true;
  }
});

export const claimLease = mutation({
  args: {
    serviceToken: v.string(),
    source: bankSource,
    connectionKey: v.string(),
    token: v.string(),
    leaseMs: v.number()
  },
  returns: v.object({
    claimed: v.boolean(),
    fence: v.union(v.number(), v.null())
  }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    await assertBankLedgerReady(ctx);
    assertConnectionKey(args.connectionKey);
    await ensureBankConnectionBinding(ctx, args.source, args.connectionKey);
    if (!args.token || args.token.length > 256) throw new ConvexError({ code: "INVALID_SYNC_LEASE_TOKEN" });
    if (!Number.isFinite(args.leaseMs)) throw new ConvexError({ code: "INVALID_SYNC_LEASE_DURATION" });
    const now = Date.now();
    const key = `bank-sync:${args.source}:${args.connectionKey}`;
    const existing = await ctx.db
      .query("workerLeases")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (existing && existing.expiresAt > now) return { claimed: false, fence: null };
    const fence = Math.trunc(existing?.fence ?? 0) + 1;
    const next = {
      key,
      token: args.token,
      fence,
      expiresAt: now + Math.max(minimumLeaseMs, Math.min(maximumLeaseMs, Math.trunc(args.leaseMs)))
    };
    if (existing) await ctx.db.patch(existing._id, next);
    else await ctx.db.insert("workerLeases", next);
    return { claimed: true, fence };
  }
});

export const renewLease = mutation({
  args: {
    serviceToken: v.string(),
    source: bankSource,
    connectionKey: v.string(),
    token: v.string(),
    fence: v.number(),
    leaseMs: v.number()
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    assertConnectionKey(args.connectionKey);
    if (!Number.isFinite(args.leaseMs)) throw new ConvexError({ code: "INVALID_SYNC_LEASE_DURATION" });
    await assertActiveBankSyncLease(ctx, args.source, {
      connectionKey: args.connectionKey,
      leaseToken: args.token,
      leaseFence: args.fence
    });
    const existing = await ctx.db
      .query("workerLeases")
      .withIndex("by_key", (q) => q.eq("key", `bank-sync:${args.source}:${args.connectionKey}`))
      .unique();
    if (!existing) throw new ConvexError({ code: "STALE_SYNC_LEASE", source: args.source });
    await ctx.db.patch(existing._id, {
      expiresAt: Date.now() + Math.max(
        minimumLeaseMs,
        Math.min(maximumLeaseMs, Math.trunc(args.leaseMs))
      )
    });
    return true;
  }
});

export const releaseLease = mutation({
  args: {
    serviceToken: v.string(),
    source: bankSource,
    connectionKey: v.string(),
    token: v.string(),
    fence: v.number()
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    assertConnectionKey(args.connectionKey);
    const existing = await ctx.db
      .query("workerLeases")
      .withIndex("by_key", (q) => q.eq("key", `bank-sync:${args.source}:${args.connectionKey}`))
      .unique();
    if (!existing || existing.token !== args.token || existing.fence !== args.fence) return false;
    await ctx.db.delete(existing._id);
    return true;
  }
});

export const recordSyncStarted = mutation({
  args: {
    serviceToken: v.string(),
    source: bankSource,
    connectionKey: v.string(),
    leaseToken: v.string(),
    leaseFence: v.number()
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    assertConnectionKey(args.connectionKey);
    await assertActiveBankSyncLease(ctx, args.source, args);
    const key = `${args.source}:${args.connectionKey}`;
    const existing = await ctx.db
      .query("bankSyncHealth")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    const now = new Date().toISOString();
    const next = {
      key,
      source: args.source,
      connectionKey: args.connectionKey,
      status: "running" as const,
      lastAttemptAt: now,
      lastSuccessAt: existing?.lastSuccessAt,
      lastError: undefined,
      consecutiveFailures: existing?.consecutiveFailures ?? 0,
      updatedAt: now
    };
    if (existing) await ctx.db.patch(existing._id, next);
    else await ctx.db.insert("bankSyncHealth", next);
    return true;
  }
});

export const recordSyncFinished = mutation({
  args: {
    serviceToken: v.string(),
    source: bankSource,
    connectionKey: v.string(),
    leaseToken: v.string(),
    leaseFence: v.number(),
    success: v.boolean(),
    error: v.optional(v.string())
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    assertConnectionKey(args.connectionKey);
    await assertActiveBankSyncLease(ctx, args.source, args);
    if (args.success === Boolean(args.error)) {
      throw new ConvexError({ code: "INVALID_SYNC_RESULT" });
    }
    if (args.error && args.error.length > 2_048) throw new ConvexError({ code: "INVALID_SYNC_ERROR" });
    const key = `${args.source}:${args.connectionKey}`;
    const existing = await ctx.db
      .query("bankSyncHealth")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (!existing) throw new ConvexError({ code: "SYNC_ATTEMPT_NOT_FOUND" });
    const now = new Date().toISOString();
    const next = args.success
      ? {
          status: "healthy" as const,
          lastSuccessAt: now,
          lastError: undefined,
          consecutiveFailures: 0,
          updatedAt: now
        }
      : {
          status: "failed" as const,
          lastError: args.error,
          consecutiveFailures: existing.consecutiveFailures + 1,
          updatedAt: now
        };
    await ctx.db.patch(existing._id, next);
    return true;
  }
});
