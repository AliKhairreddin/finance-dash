import assert from "node:assert/strict";
import test from "node:test";
import { ConvexError } from "convex/values";
import { completeJob, saveProgress, startJob } from "../convex/analytics";

type AsyncHandler<TArgs, TResult> = (ctx: unknown, args: TArgs) => Promise<TResult>;

function handlerOf<TArgs, TResult>(registered: object): AsyncHandler<TArgs, TResult> {
  const candidate: unknown = Reflect.get(registered, "_handler");
  if (typeof candidate !== "function") throw new Error("Convex handler is not registered");
  return async (ctx, args) => candidate(ctx, args);
}

type JobArgs = {
  serviceToken: string;
  key: string;
  version: string;
  expectedVersion: string | null;
  fromDate: string;
  toDate: string;
  accumulator: unknown;
};

const startJobHandler = handlerOf<JobArgs, Record<string, unknown>>(startJob);
const saveProgressHandler = handlerOf<{
  serviceToken: string;
  key: string;
  version: string;
  expectedCursor: string | null;
  cursor: string;
  accumulator: unknown;
}, Record<string, unknown>>(saveProgress);
const completeJobHandler = handlerOf<{
  serviceToken: string;
  key: string;
  version: string;
  expectedCursor: string | null;
  snapshot: unknown;
}, Record<string, unknown>>(completeJob);

function convexErrorCode(error: unknown): string | undefined {
  return error instanceof ConvexError && typeof error.data === "object" && error.data !== null && "code" in error.data
    ? String(error.data.code)
    : undefined;
}

async function withServiceToken(run: () => Promise<void>): Promise<void> {
  const previousToken = process.env.CONVEX_SERVICE_TOKEN;
  process.env.CONVEX_SERVICE_TOKEN = "expected-token";
  try {
    await run();
  } finally {
    if (previousToken === undefined) delete process.env.CONVEX_SERVICE_TOKEN;
    else process.env.CONVEX_SERVICE_TOKEN = previousToken;
  }
}

function analyticsJobContext() {
  let row: Record<string, unknown> | null = null;
  return {
    ctx: {
      db: {
        query: () => ({
          withIndex: () => ({ unique: async () => row })
        }),
        async insert(_table: string, value: Record<string, unknown>) {
          row = { _id: "job-1", ...value };
          return "job-1";
        },
        async patch(_id: string, patch: Record<string, unknown>) {
          if (!row) throw new Error("Missing Analytics job");
          for (const [key, value] of Object.entries(patch)) {
            if (value === undefined) delete row[key];
            else row[key] = value;
          }
        }
      }
    },
    row: () => row
  };
}

function startArgs(version: string, expectedVersion: string | null): JobArgs {
  return {
    serviceToken: "expected-token",
    key: "2026-07-01:2026-07-31",
    version,
    expectedVersion,
    fromDate: "2026-07-01",
    toDate: "2026-07-31",
    accumulator: { transactionCount: 0 }
  };
}

test("Analytics job start is idempotent for one version and rejects stale replacement", async () => {
  await withServiceToken(async () => {
    const storage = analyticsJobContext();
    const first = await startJobHandler(storage.ctx, startArgs("version-1", null));
    assert.equal(first.version, "version-1");
    assert.equal(first.status, "building");

    const same = await startJobHandler(storage.ctx, startArgs("version-1", null));
    assert.equal(same.version, "version-1");

    await assert.rejects(
      () => startJobHandler(storage.ctx, startArgs("version-2", null)),
      (error) => {
        assert.equal(convexErrorCode(error), "ANALYTICS_JOB_CONFLICT");
        return true;
      }
    );

    const replaced = await startJobHandler(storage.ctx, startArgs("version-2", "version-1"));
    assert.equal(replaced.version, "version-2");
    assert.equal(storage.row()?.cursor, undefined);
  });
});

test("Analytics progress and completion compare-and-set the opaque page cursor", async () => {
  await withServiceToken(async () => {
    const storage = analyticsJobContext();
    await startJobHandler(storage.ctx, startArgs("version-1", null));
    await saveProgressHandler(storage.ctx, {
      serviceToken: "expected-token",
      key: "2026-07-01:2026-07-31",
      version: "version-1",
      expectedCursor: null,
      cursor: "cursor-10",
      accumulator: { transactionCount: 2_000 }
    });

    await assert.rejects(
      () => completeJobHandler(storage.ctx, {
        serviceToken: "expected-token",
        key: "2026-07-01:2026-07-31",
        version: "version-1",
        expectedCursor: null,
        snapshot: { version: 1 }
      }),
      (error) => {
        assert.equal(convexErrorCode(error), "ANALYTICS_JOB_CONFLICT");
        return true;
      }
    );

    const completed = await completeJobHandler(storage.ctx, {
      serviceToken: "expected-token",
      key: "2026-07-01:2026-07-31",
      version: "version-1",
      expectedCursor: "cursor-10",
      snapshot: { version: 1 }
    });
    assert.equal(completed.status, "complete");
    assert.equal(completed.cursor, null);
    assert.equal(storage.row()?.accumulator, undefined);
  });
});
