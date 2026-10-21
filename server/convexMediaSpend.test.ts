import assert from "node:assert/strict";
import test from "node:test";
import { completeSync, replaceDate, startSync, failSync, getSyncState, listDate } from "../convex/mediaSpend";
import { database } from "./convexTestDb";

function handlerOf(registered: object): (ctx: unknown, args: unknown) => Promise<unknown> {
  const handler: unknown = Reflect.get(registered, "_handler");
  if (typeof handler !== "function") throw new Error("Missing Convex handler");
  return (ctx, args) => handler(ctx, args);
}

test("empty media spend snapshots cannot erase stored financial data", async () => {
  const previous = process.env.CONVEX_SERVICE_TOKEN;
  process.env.CONVEX_SERVICE_TOKEN = "media-test";
  try {
    await assert.rejects(handlerOf(replaceDate)({}, {
      serviceToken: "media-test", attemptId: "attempt", date: "2026-09-19", rows: []
    }), /EMPTY_MEDIA_SPEND_DATE/);
  } finally {
    if (previous === undefined) delete process.env.CONVEX_SERVICE_TOKEN;
    else process.env.CONVEX_SERVICE_TOKEN = previous;
  }
});

test("completing a later sync does not claim coverage over an unsynced gap", async () => {
  const previous = process.env.CONVEX_SERVICE_TOKEN;
  process.env.CONVEX_SERVICE_TOKEN = "media-test";
  try {
    let saved: Record<string, unknown> | undefined;
    const existing = { _id: "state", status: "running", leaseExpiresAt: Date.now() + 120_000, attemptId: "attempt", coveredFrom: "2026-08-01",
      coveredThrough: "2026-09-18", requestedFrom: "2026-09-23", requestedTo: "2026-09-23",
      lastAttemptAt: "2026-09-24T08:30:00Z" };
    const context = { db: {
      query: () => ({ withIndex: () => ({ unique: async () => existing }) }),
      replace: async (_id: string, row: Record<string, unknown>) => { saved = row; }
    } };
    assert.equal(await handlerOf(completeSync)(context, {
      serviceToken: "media-test", attemptId: "attempt", completedAt: "2026-09-24T08:32:00Z",
      coveredThrough: "2026-09-23", rowCount: 2300, totalSpend: 56093.37
    }), true);
    assert.equal(saved?.coveredThrough, "2026-09-18");
  } finally {
    if (previous === undefined) delete process.env.CONVEX_SERVICE_TOKEN;
    else process.env.CONVEX_SERVICE_TOKEN = previous;
  }
});

test("sync reservation blocks overlapping pulls but allows same-day retries and completed re-imports", async (t) => {
  const previousToken = process.env.CONVEX_SERVICE_TOKEN;
  process.env.CONVEX_SERVICE_TOKEN = "media-test";
  t.after(() => { if (previousToken === undefined) delete process.env.CONVEX_SERVICE_TOKEN; else process.env.CONVEX_SERVICE_TOKEN = previousToken; });
  const now = Date.parse("2026-10-06T08:30:00Z");
  t.mock.method(Date, "now", () => now);
  let stored: Record<string, unknown> = {};
  let writes = 0;
  const db = {
    query: () => ({ withIndex: () => ({ unique: async () => Object.keys(stored).length ? stored : null }) }),
    insert: async (_table: string, row: Record<string, unknown>) => { stored = { _id: "state", ...row }; writes += 1; },
    replace: async (_id: string, row: Record<string, unknown>) => { stored = { _id: "state", ...row }; writes += 1; }
  };
  const args = { serviceToken: "media-test", attemptId: "first", fromDate: "2026-10-04", toDate: "2026-10-05", startedAt: new Date(now).toISOString() };
  assert.equal(await handlerOf(startSync)({ db }, args), "started");
  assert.equal(await handlerOf(startSync)({ db }, { ...args, attemptId: "duplicate" }), "busy");
  assert.equal(writes, 1);
  assert.equal(await handlerOf(failSync)({ db }, { serviceToken: "media-test", attemptId: "first", failedAt: args.startedAt, error: "Missing account rows" }), true);
  assert.equal(await handlerOf(startSync)({ db }, { ...args, attemptId: "retry" }), "started");
  assert.equal(await handlerOf(startSync)({ db }, { ...args, attemptId: "overlapping-retry" }), "busy");
  stored = { ...stored, status: "running", leaseExpiresAt: now - 1 };
  assert.equal(await handlerOf(startSync)({ db }, { ...args, attemptId: "abandoned" }), "started");
  assert.equal(await handlerOf(completeSync)({ db }, {
    serviceToken: "media-test", attemptId: "abandoned", completedAt: args.startedAt,
    coveredThrough: args.toDate, rowCount: 1, totalSpend: 5
  }), true);
  assert.equal(await handlerOf(startSync)({ db }, { ...args, attemptId: "reimport" }), "started");
});

test("stale sync attempts cannot write rows or claim success", async (t) => {
  const previousToken = process.env.CONVEX_SERVICE_TOKEN;
  process.env.CONVEX_SERVICE_TOKEN = "media-test";
  t.after(() => { if (previousToken === undefined) delete process.env.CONVEX_SERVICE_TOKEN; else process.env.CONVEX_SERVICE_TOKEN = previousToken; });
  const row = { key: "key", source: "lemonmax", workspace: 1, date: "2026-10-05", platform: "TikTok", businessManagerId: "bm", accountId: "new", spend: 0, currency: "USD", syncedAt: new Date().toISOString() };
  const state = { _id: "state", status: "running", attemptId: "newer", leaseExpiresAt: Date.now() + 120_000 };
  const ctx = { db: { query: () => ({ withIndex: () => ({ unique: async () => state }) }) } };
  await assert.rejects(handlerOf(replaceDate)(ctx, { serviceToken: "media-test", attemptId: "older", date: row.date, rows: [row] }), /MEDIA_SPEND_SYNC_SUPERSEDED/);
  assert.equal(await handlerOf(completeSync)(ctx, { serviceToken: "media-test", attemptId: "older", completedAt: row.syncedAt, coveredThrough: row.date, rowCount: 1, totalSpend: 0 }), false);
});

test("reconciliation preserves unchanged document IDs and imports new platforms and zero-spend accounts", async (t) => {
  const previousToken = process.env.CONVEX_SERVICE_TOKEN;
  process.env.CONVEX_SERVICE_TOKEN = "media-test";
  t.after(() => { if (previousToken === undefined) delete process.env.CONVEX_SERVICE_TOKEN; else process.env.CONVEX_SERVICE_TOKEN = previousToken; });
  const syncedAt = new Date().toISOString();
  const base = { source: "lemonmax", workspace: 1, date: "2026-10-05", platform: "Facebook", businessManagerId: "bm", spend: 0, currency: "USD", syncedAt };
  const incoming = [
    { ...base, key: "kept", accountId: "existing", accountName: "Existing" },
    { ...base, key: "google", accountId: "new-google", platform: "Google", spend: 5 },
    { ...base, key: "tiktok", accountId: "new-tiktok", platform: "TikTok" }
  ];
  const stored = { _id: "original-id", ...incoming[0], syncedAt: "2026-10-05T08:30:00Z" };
  const inserted: unknown[] = [];
  const ctx = { db: {
    query: (table: string) => ({ withIndex: () => ({
      unique: async () => ({ status: "running", attemptId: "attempt", leaseExpiresAt: Date.now() + 120_000 }),
      take: async () => { assert.equal(table, "mediaSpendDaily"); return [stored]; }
    }) }),
    replace: async () => { assert.fail("Unchanged financial rows should retain their ID and values"); },
    insert: async (_table: string, row: unknown) => { inserted.push(row); }
  } };
  assert.deepEqual(await handlerOf(replaceDate)(ctx, { serviceToken: "media-test", attemptId: "attempt", date: base.date, rows: incoming }), { inserted: 2, replaced: 0, deleted: 0, unchanged: 1 });
  assert.deepEqual(inserted, incoming.slice(1));
});


test("agency reconciliation enriches, changes and clears metadata without changing document IDs or spend", async (t) => {
  const previous = process.env.CONVEX_SERVICE_TOKEN;
  process.env.CONVEX_SERVICE_TOKEN = "media-test";
  t.after(() => { if (previous === undefined) delete process.env.CONVEX_SERVICE_TOKEN; else process.env.CONVEX_SERVICE_TOKEN = previous; });
  const base = { source: "lemonmax", workspace: 1, date: "2026-08-01", platform: "Facebook", businessManagerId: "bm", currency: "USD", syncedAt: "2026-08-02T08:30:00Z" };
  const { db, tables } = database({
    mediaSpendSyncState: [{ _id: "state", key: "lemonmax", status: "running", attemptId: "attempt", leaseExpiresAt: Date.now() + 120_000 }],
    mediaSpendDaily: [
      { ...base, _id: "original-1", key: "one", accountId: "one", spend: 5 },
      { ...base, _id: "original-2", key: "two", accountId: "two", spend: 0, agencyId: 10, agencyName: "Old" },
      { ...base, _id: "original-3", key: "three", accountId: "three", spend: 8, agencyId: 11, agencyName: "Removed" }
    ]
  });
  const rows = [
    { ...base, key: "one", accountId: "one", spend: 5, agencyId: 11, agencyName: "Hustle Blink" },
    { ...base, key: "two", accountId: "two", spend: 0, agencyId: 15, agencyName: "FALKYN" },
    { ...base, key: "three", accountId: "three", spend: 8 }
  ];
  assert.deepEqual(await handlerOf(replaceDate)({ db }, { serviceToken: "media-test", attemptId: "attempt", date: base.date, rows }),
    { inserted: 0, replaced: 3, deleted: 0, unchanged: 0 });
  assert.deepEqual(tables.mediaSpendDaily.map(row => row._id), ["original-1", "original-2", "original-3"]);
  const saved = await handlerOf(listDate)({ db }, { serviceToken: "media-test", date: base.date, includeZeroSpend: true });
  assert.deepEqual(saved, { rows, storedRowCount: 3 });
  assert.deepEqual(await handlerOf(replaceDate)({ db }, { serviceToken: "media-test", attemptId: "attempt", date: base.date, rows }),
    { inserted: 0, replaced: 0, deleted: 0, unchanged: 3 });
});

test("an expired import is visibly failed instead of appearing to run forever", async () => {
  const previous = process.env.CONVEX_SERVICE_TOKEN;
  process.env.CONVEX_SERVICE_TOKEN = "media-test";
  try {
    const state = { status: "running", leaseExpiresAt: Date.now() - 1, lastAttemptAt: "2026-10-06T08:30:00Z", requestedFrom: "2026-10-04", requestedTo: "2026-10-05" };
    const ctx = { db: { query: () => ({ withIndex: () => ({ unique: async () => state }) }) } };
    const result = await handlerOf(getSyncState)(ctx, { serviceToken: "media-test" }) as { status: string; lastError: string };
    assert.equal(result.status, "failed");
    assert.match(result.lastError, /interrupted/);
  } finally {
    if (previous === undefined) delete process.env.CONVEX_SERVICE_TOKEN;
    else process.env.CONVEX_SERVICE_TOKEN = previous;
  }
});
