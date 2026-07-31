import assert from "node:assert/strict";
import { after, test } from "node:test";
import { ConvexError } from "convex/values";
import {
  claimLease,
  finishBackfillAttempt,
  registerAccountSet,
  retryBackfill,
  saveCheckpoint
} from "../convex/bankSync";

const serviceToken = "bank-sync-test-service-token";
const connectionKey = "a".repeat(64);
const originalServiceToken = process.env.CONVEX_SERVICE_TOKEN;
process.env.CONVEX_SERVICE_TOKEN = serviceToken;

after(() => {
  if (originalServiceToken === undefined) delete process.env.CONVEX_SERVICE_TOKEN;
  else process.env.CONVEX_SERVICE_TOKEN = originalServiceToken;
});

type BackfillStatus = "queued" | "running" | "complete" | "failed";
type BankSource = "wise" | "revolut" | "slash" | "amex";

interface RetryBackfillResult {
  key: string;
  source: BankSource;
  connectionKey: string;
  fromDate: string;
  toDate: string;
  status: BackfillStatus;
  attempts: number;
  consecutiveFailures: number;
  nextAttemptAt: string;
  lastAttemptAt?: string;
  lastError?: string;
  completedAt?: string;
  updatedAt: string;
}

type RetryBackfillHandler = (
  context: { db: unknown },
  args: { serviceToken: string; key: string; connectionKey: string }
) => Promise<RetryBackfillResult>;

const retryBackfillHandler = (
  retryBackfill as unknown as { _handler: RetryBackfillHandler }
)._handler;

type FinishBackfillHandler = (
  context: { db: unknown },
  args: {
    serviceToken: string;
    key: string;
    connectionKey: string;
    attemptToken: string;
    complete: boolean;
    error?: string;
    terminal?: boolean;
  }
) => Promise<RetryBackfillResult>;

const finishBackfillHandler = (
  finishBackfillAttempt as unknown as { _handler: FinishBackfillHandler }
)._handler;

interface TestBackfillJob {
  _id: string;
  key: string;
  source: BankSource;
  connectionKey: string;
  fromDate: string;
  toDate: string;
  status: BackfillStatus;
  attempts: number;
  consecutiveFailures: number;
  attemptToken?: string;
  nextAttemptAt: string;
  lastAttemptAt?: string;
  lastError?: string;
  completedAt?: string;
  updatedAt: string;
}

function keyFor(
  source: BankSource = "wise",
  fromDate = "2025-01-01",
  toDate = "2025-01-31"
): string {
  return `${source}:${connectionKey}:${fromDate}:${toDate}`;
}

function makeJob(overrides: Partial<TestBackfillJob> = {}): TestBackfillJob {
  const source = overrides.source ?? "wise";
  const fromDate = overrides.fromDate ?? "2025-01-01";
  const toDate = overrides.toDate ?? "2025-01-31";
  return {
    _id: "backfill-job-id",
    key: keyFor(source, fromDate, toDate),
    source,
    connectionKey,
    fromDate,
    toDate,
    status: "failed",
    attempts: 8,
    consecutiveFailures: 8,
    attemptToken: "stale-attempt-token",
    nextAttemptAt: "2025-02-01T00:00:00.000Z",
    lastAttemptAt: "2025-02-01T00:00:00.000Z",
    lastError: "terminal provider failure",
    updatedAt: "2025-02-01T00:00:00.000Z",
    ...overrides
  };
}

function makeContext(
  job: TestBackfillJob,
  bindingKey: string | null = connectionKey
): {
  context: Parameters<typeof retryBackfillHandler>[0];
  patches: Array<{ id: string; value: Record<string, unknown> }>;
} {
  const patches: Array<{ id: string; value: Record<string, unknown> }> = [];
  const rows: Record<string, unknown> = {
    bankLedgerCutover: { _id: "cutover-id", key: "default", status: "ready" },
    bankBackfillJobs: job,
    bankConnectionBindings: bindingKey === null
      ? null
      : { _id: "binding-id", source: job.source, connectionKey: bindingKey }
  };
  const queryBuilder = {
    eq() {
      return queryBuilder;
    },
    lte() {
      return queryBuilder;
    }
  };
  const db = {
    query(table: string) {
      const chain = {
        withIndex(_index: string, configure: (builder: typeof queryBuilder) => unknown) {
          configure(queryBuilder);
          return chain;
        },
        async unique() {
          return rows[table] ?? null;
        }
      };
      return chain;
    },
    async patch(id: string, value: Record<string, unknown>) {
      patches.push({ id, value });
      Object.assign(job, value);
    }
  };
  return {
    context: { db },
    patches
  };
}

function errorCode(error: unknown): string | undefined {
  return error instanceof ConvexError
    && typeof error.data === "object"
    && error.data !== null
    && "code" in error.data
    ? String(error.data.code)
    : undefined;
}

test("retryBackfill explicitly requeues only a failed job without erasing attempt history", async () => {
  const job = makeJob();
  const previousLastAttemptAt = job.lastAttemptAt;
  const { context, patches } = makeContext(job);
  const result = await retryBackfillHandler(context, {
    serviceToken,
    key: job.key,
    connectionKey
  });

  assert.equal(result.status, "queued");
  assert.equal(result.attempts, 8);
  assert.equal(result.consecutiveFailures, 0);
  assert.equal(result.lastAttemptAt, previousLastAttemptAt);
  assert.equal(result.lastError, undefined);
  assert.equal(patches.length, 1);
  assert.equal(patches[0]?.id, "backfill-job-id");
  assert.equal(patches[0]?.value.attemptToken, undefined);
  assert.equal(patches[0]?.value.lastError, undefined);
  assert.equal(patches[0]?.value.consecutiveFailures, 0);
  assert.equal(patches[0]?.value.status, "queued");
  assert.equal(patches[0]?.value.nextAttemptAt, patches[0]?.value.updatedAt);
});

test("retryBackfill is idempotent for queued, running, and complete jobs", async () => {
  for (const status of ["queued", "running", "complete"] as const) {
    const job = makeJob({
      status,
      ...(status === "complete" ? { completedAt: "2025-02-01T01:00:00.000Z" } : {})
    });
    const { context, patches } = makeContext(job);
    const result = await retryBackfillHandler(context, {
      serviceToken,
      key: job.key,
      connectionKey
    });

    assert.equal(result.status, status);
    assert.equal(result.attempts, 8);
    assert.equal(patches.length, 0);
  }
});

test("retryBackfill rejects a job whose persisted identity does not match its exact key", async () => {
  const job = makeJob();
  job.fromDate = "2025-01-02";
  const { context, patches } = makeContext(job);

  await assert.rejects(
    retryBackfillHandler(context, {
      serviceToken,
      key: job.key,
      connectionKey
    }),
    (error: unknown) => errorCode(error) === "INVALID_BACKFILL_JOB_KEY"
  );
  assert.equal(patches.length, 0);
});

test("retryBackfill requires the active source connection binding", async () => {
  const job = makeJob();
  const { context, patches } = makeContext(job, "b".repeat(64));

  await assert.rejects(
    retryBackfillHandler(context, {
      serviceToken,
      key: job.key,
      connectionKey
    }),
    (error: unknown) => errorCode(error) === "BANK_CONNECTION_REBIND_REQUIRED"
  );
  assert.equal(patches.length, 0);
});

test("retryBackfill does not reveal jobs from another connection", async () => {
  const job = makeJob();
  const { context, patches } = makeContext(job);

  await assert.rejects(
    retryBackfillHandler(context, {
      serviceToken,
      key: job.key,
      connectionKey: "b".repeat(64)
    }),
    (error: unknown) => errorCode(error) === "BACKFILL_JOB_NOT_FOUND"
  );
  assert.equal(patches.length, 0);
});

test("a successful checkpoint page is eligible for continuation without a long idle gap", async () => {
  const job = makeJob({
    status: "running",
    attemptToken: "current-attempt",
    attempts: 3,
    consecutiveFailures: 0
  });
  const { context } = makeContext(job);
  const startedAt = Date.now();
  const result = await finishBackfillHandler(context, {
    serviceToken,
    key: job.key,
    connectionKey,
    attemptToken: "current-attempt",
    complete: false
  });

  assert.equal(result.status, "queued");
  assert.equal(result.consecutiveFailures, 0);
  const continuationDelay = Date.parse(result.nextAttemptAt) - startedAt;
  assert.ok(continuationDelay >= 900 && continuationDelay <= 1_500, String(continuationDelay));
});

type MemoryRow = Record<string, unknown> & { _id: string };

function bankSyncMemoryContext(seed: Record<string, MemoryRow[]>) {
  const tables = Object.fromEntries(
    Object.entries(seed).map(([table, rows]) => [table, rows.map((row) => ({ ...row }))])
  ) as Record<string, MemoryRow[]>;
  let inserted = 0;
  const rowsFor = (table: string) => tables[table] ?? (tables[table] = []);
  const db = {
    query(table: string) {
      const constraints: Array<[string, unknown]> = [];
      const range = {
        eq(field: string, value: unknown) {
          constraints.push([field, value]);
          return range;
        }
      };
      const selected = () => rowsFor(table).filter((row) =>
        constraints.every(([field, value]) => row[field] === value)
      );
      const chain = {
        withIndex(_index: string, configure: (builder: typeof range) => unknown) {
          configure(range);
          return chain;
        },
        async unique() {
          const matches = selected();
          if (matches.length > 1) throw new Error(`Expected unique ${table} row`);
          return matches[0] ?? null;
        },
        async first() {
          return selected()[0] ?? null;
        }
      };
      return chain;
    },
    async patch(id: string, value: Record<string, unknown>) {
      const row = Object.values(tables).flat().find((item) => item._id === id);
      if (!row) throw new Error(`Unknown row ${id}`);
      for (const [field, next] of Object.entries(value)) {
        if (next === undefined) delete row[field];
        else row[field] = next;
      }
    },
    async insert(table: string, value: Record<string, unknown>) {
      inserted += 1;
      const id = `${table}-${inserted}`;
      rowsFor(table).push({ _id: id, ...value });
      return id;
    }
  };
  return { db, tables };
}

test("account discovery invalidates certified coverage before new pages are written", async () => {
  const ctx = bankSyncMemoryContext({
    bankConnectionBindings: [{ _id: "binding", source: "wise", connectionKey }],
    workerLeases: [{
      _id: "lease",
      key: `bank-sync:wise:${connectionKey}`,
      token: "lease-token",
      fence: 3,
      expiresAt: Date.now() + 60_000
    }],
    bankSyncState: [{
      _id: "state",
      source: "wise",
      connectionKey,
      accountIds: ["wise-account-old"],
      coveredRanges: [{ fromDate: "2025-01-01", toDate: "2025-12-31" }],
      lastSyncedAt: "2026-07-01T00:00:00.000Z"
    }]
  });
  const handler = (registerAccountSet as unknown as { _handler: (
    context: { db: unknown },
    args: Record<string, unknown>
  ) => Promise<{ changed: boolean; invalidatedCoverageRanges: number }> })._handler;
  const changed = await handler(ctx, {
    serviceToken,
    source: "wise",
    connectionKey,
    accountIds: ["wise-account-new", "wise-account-old"],
    leaseToken: "lease-token",
    leaseFence: 3
  });
  assert.deepEqual(changed, { changed: true, invalidatedCoverageRanges: 1 });
  assert.deepEqual(ctx.tables.bankSyncState[0]?.coveredRanges, []);
  assert.deepEqual(ctx.tables.bankSyncState[0]?.accountIds, ["wise-account-new", "wise-account-old"]);

  const unchanged = await handler(ctx, {
    serviceToken,
    source: "wise",
    connectionKey,
    accountIds: ["wise-account-old", "wise-account-new"],
    leaseToken: "lease-token",
    leaseFence: 3
  });
  assert.deepEqual(unchanged, { changed: false, invalidatedCoverageRanges: 0 });
});

test("a first configured bank connection binds atomically when it has no prior ledger data", async () => {
  const ctx = bankSyncMemoryContext({
    bankLedgerCutover: [{ _id: "cutover", key: "default", status: "ready" }],
    bankConnectionBindings: [],
    bankTransactions: [],
    bankAccounts: [],
    workerLeases: []
  });
  const handler = (claimLease as unknown as { _handler: (
    context: { db: unknown },
    args: Record<string, unknown>
  ) => Promise<{ claimed: boolean; fence: number | null }> })._handler;
  const result = await handler(ctx, {
    serviceToken,
    source: "amex",
    connectionKey,
    token: "lease-token",
    leaseMs: 60_000
  });
  assert.deepEqual(result, { claimed: true, fence: 1 });
  assert.equal(ctx.tables.bankConnectionBindings.length, 1);
  assert.equal(ctx.tables.bankConnectionBindings[0]?.connectionKey, connectionKey);
});

test("live and historical lanes keep independent checkpoint compare-and-set state", async () => {
  const ctx = bankSyncMemoryContext({
    workerLeases: [{
      _id: "lease",
      key: `bank-sync:wise:${connectionKey}`,
      token: "lease-token",
      fence: 2,
      expiresAt: Date.now() + 60_000
    }],
    bankSyncCheckpoints: [{
      _id: "live-checkpoint",
      source: "wise",
      connectionKey,
      laneKey: "live",
      accountIds: ["wise-account"],
      fromDate: "2026-07-01",
      toDate: "2026-07-02",
      checkpoint: "live-cursor",
      updatedAt: "2026-07-02T00:00:00.000Z"
    }]
  });
  const handler = (saveCheckpoint as unknown as { _handler: (
    context: { db: unknown },
    args: Record<string, unknown>
  ) => Promise<Record<string, unknown>> })._handler;
  await handler(ctx, {
    serviceToken,
    source: "wise",
    connectionKey,
    laneKey: "history:2026-07-01:2026-07-02",
    accountIds: ["wise-account"],
    fromDate: "2026-07-01",
    toDate: "2026-07-02",
    checkpoint: "history-cursor",
    expectedCheckpoint: null,
    leaseToken: "lease-token",
    leaseFence: 2
  });
  assert.equal(ctx.tables.bankSyncCheckpoints.length, 2);
  await assert.rejects(
    handler(ctx, {
      serviceToken,
      source: "wise",
      connectionKey,
      laneKey: "live",
      accountIds: ["wise-account"],
      fromDate: "2026-07-01",
      toDate: "2026-07-02",
      checkpoint: "replacement",
      expectedCheckpoint: "stale-cursor",
      leaseToken: "lease-token",
      leaseFence: 2
    }),
    (error: unknown) => errorCode(error) === "SYNC_CHECKPOINT_CONFLICT"
  );
  assert.equal(ctx.tables.bankSyncCheckpoints.find((row) => row.laneKey === "live")?.checkpoint, "live-cursor");
});
