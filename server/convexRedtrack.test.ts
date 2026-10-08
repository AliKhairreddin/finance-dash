import assert from "node:assert/strict";
import test from "node:test";
import { links, report, saveLink } from "../convex/redtrack";
import { getFunctionName } from "convex/server";
import { claim, finish, read, reserveRequest, save } from "../convex/redtrackCache";
import type { RedTrackRow } from "../shared/redtrack";
const call = (fn: object, ctx: unknown, args: unknown): Promise<unknown> => Reflect.get(fn, "_handler")(ctx, args);

test("RedTrack functions require the backend service token before reading, fetching, or writing", async () => {
  const previous = process.env.CONVEX_SERVICE_TOKEN;
  process.env.CONVEX_SERVICE_TOKEN = "redtrack-test-service-token";
  try {
    for (const fn of [links, report, saveLink]) await assert.rejects(call(fn, {}, { serviceToken: "wrong" }), /unauthorized/);
  } finally { if (previous === undefined) delete process.env.CONVEX_SERVICE_TOKEN; else process.env.CONVEX_SERVICE_TOKEN = previous; }
});

test("saved days and overlapping date windows avoid repeated API requests; failed syncs keep existing snapshots", async () => {
  const previousToken = process.env.CONVEX_SERVICE_TOKEN, previousKey = process.env.REDTRACK_API_KEY, previousFetch = globalThis.fetch;
  const previousNow = Date.now, now = Date.parse("2026-10-08T18:00:00Z");
  Date.now = () => now; process.env.CONVEX_SERVICE_TOKEN = "test"; process.env.REDTRACK_API_KEY = "api-test";
  const row: RedTrackRow = { key: "day1", date: "2026-10-01", offerSourceId: "62866645c686840001f43358", offerSource: "Advertiser", offerId: "offer", offer: "Offer", trafficChannelId: "google", trafficChannel: "Google", campaignId: "campaign", campaign: "Campaign", revenue: 10, conversions: 1, allRevenue: 15, allConversions: 2 };
  const saved = { days: [{ date: row.date, savedAt: now, rows: [row] }, { date: "2026-10-03", savedAt: now, rows: [] as RedTrackRow[] }], sources: [{ id: row.offerSourceId, name: row.offerSource }], sourcesSavedAt: now };
  let sourceCalls = 0, lastFinish: any;
  const ctx = {
    runQuery: async () => structuredClone(saved),
    runMutation: async (ref: any, args: any) => {
      const name = getFunctionName(ref);
      if (name.endsWith(":claim")) return true;
      if (name.endsWith(":reserveRequest")) return 0;
      if (name.endsWith(":finish")) { lastFinish = args; return null; }
      if (name.endsWith(":save")) { saved.days.push({ date: args.fromDate, savedAt: args.savedAt, rows: args.rows }); return null; }
      throw new Error(name);
    }
  };
  globalThis.fetch = (async input => {
    sourceCalls++;
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("date_from"), "2026-10-02");
    assert.equal(url.searchParams.get("date_to"), "2026-10-02");
    return Response.json([{ date: "2026-10-02", network: row.offerSource, network_id: row.offerSourceId, offer: row.offer, offer_id: row.offerId, source: row.trafficChannel, source_id: row.trafficChannelId, campaign: row.campaign, campaign_id: row.campaignId, revenue: 10, conversions: 1, total_revenue: 15, total_conversions: 2 }]);
  }) as typeof fetch;
  try {
    const args = { serviceToken: "test", fromDate: "2026-10-01", toDate: "2026-10-03" };
    const first = await call(report, ctx, args) as any;
    assert.deepEqual(first.syncedDates, ["2026-10-02"]); assert.equal(sourceCalls, 2);
    const second = await call(report, ctx, args) as any;
    assert.deepEqual(second.syncedDates, []); assert.equal(sourceCalls, 2); assert.equal(second.rows.length, 2);
    const before = structuredClone(saved);
    globalThis.fetch = (async () => new Response("private upstream details", { status: 429, headers: { "Retry-After": "120" } })) as typeof fetch;
    await assert.rejects(call(report, ctx, { ...args, force: true }), /request limit/);
    assert.equal(lastFinish.retryAt, now + 120_000); assert.deepEqual(saved, before);
  } finally {
    globalThis.fetch = previousFetch; Date.now = previousNow;
    if (previousToken === undefined) delete process.env.CONVEX_SERVICE_TOKEN; else process.env.CONVEX_SERVICE_TOKEN = previousToken;
    if (previousKey === undefined) delete process.env.REDTRACK_API_KEY; else process.env.REDTRACK_API_KEY = previousKey;
  }
});

test("daily storage replaces chunks atomically, stores empty-day coverage, and enforces one paced sync lease", async () => {
  const tables: Record<string, any[]> = {};
  const ctx = { db: {
    query(table: string) {
      let rows = tables[table] ?? [];
      const index = { eq(key: string, value: any) { rows = rows.filter(row => row[key] === value); return index; },
        gte(key: string, value: any) { rows = rows.filter(row => row[key] >= value); return index; },
        lte(key: string, value: any) { rows = rows.filter(row => row[key] <= value); return index; } };
      const query = { withIndex(_name: string, filter?: (q: typeof index) => unknown) { filter?.(index); return query; },
        unique: async () => { assert(rows.length <= 1); return rows[0] ?? null; }, take: async (count: number) => rows.slice(0, count) };
      return query;
    },
    insert: async (table: string, row: any) => { const id = `${table}-${Math.random()}`; (tables[table] ??= []).push({ _id: id, ...row }); return id; },
    patch: async (id: string, value: any) => { Object.assign(Object.values(tables).flat().find(row => row._id === id), value); },
    delete: async (id: string) => { for (const table of Object.keys(tables)) tables[table] = tables[table].filter(row => row._id !== id); }
  } };
  assert.equal(await call(claim, ctx, { attemptId: "first" }), true);
  assert.equal(await call(claim, ctx, { attemptId: "second" }), false);
  assert.equal(await call(reserveRequest, ctx, { attemptId: "first" }), 0);
  assert(Number(await call(reserveRequest, ctx, { attemptId: "first" })) > 3000);
  const args = { attemptId: "first", fromDate: "2026-10-01", toDate: "2026-10-02", rows: [], savedAt: Date.now() };
  await call(save, ctx, args);
  const data = await call(read, ctx, args) as any;
  assert.equal(data.days.length, 2); assert.equal(data.days[0].rows.length, 0);
  const before = structuredClone(tables.redtrackDays);
  await assert.rejects(call(save, ctx, { ...args, attemptId: "lost" }), /lease expired/);
  assert.deepEqual(tables.redtrackDays, before);
  await call(finish, ctx, { attemptId: "first", retryAt: Date.now() + 60_000, error: "rate limited" });
  await assert.rejects(call(claim, ctx, { attemptId: "second" }), /cooling down/);
});

test("advertiser links update one source, persist across reads, and can be removed without affecting other sources", async () => {
  const previous = process.env.CONVEX_SERVICE_TOKEN, serviceToken = "redtrack-test-service-token";
  process.env.CONVEX_SERVICE_TOKEN = serviceToken;
  const records = new Map<string, { _id: string; sourceId: string; url: string }>();
  const ctx = { db: {
    query(table: string) {
      assert.equal(table, "redtrackAdvertiserLinks");
      let id: string | undefined;
      return { withIndex(name: string, filter?: (q: { eq: (key: string, value: string) => void }) => unknown) {
        assert.equal(name, "by_source_id"); filter?.({ eq: (key, value) => { assert.equal(key, "sourceId"); id = value; } });
        return { unique: async () => records.get(id!) ?? null, take: async (count: number) => [...records.values()].slice(0, count) };
      } };
    },
    insert: async (_table: string, row: { sourceId: string; url: string }) => { records.set(row.sourceId, { ...row, _id: row.sourceId }); },
    patch: async (id: string, row: { url: string }) => { Object.assign(records.get(id)!, row); },
    delete: async (id: string) => { records.delete(id); }
  } };
  const first = "62866645c686840001f43358", second = "62866645c686840001f43359";
  try {
    await call(saveLink, ctx, { serviceToken, sourceId: first, url: "https://first.example.com" });
    await call(saveLink, ctx, { serviceToken, sourceId: second, url: "https://second.example.com" });
    await call(saveLink, ctx, { serviceToken, sourceId: first, url: "https://first.example.com/report" });
    assert.deepEqual(await call(links, ctx, { serviceToken }), [{ sourceId: first, url: "https://first.example.com/report" }, { sourceId: second, url: "https://second.example.com/" }]);
    await assert.rejects(call(saveLink, ctx, { serviceToken, sourceId: first, url: "javascript:alert(1)" }));
    assert.equal(records.size, 2);
    await call(saveLink, ctx, { serviceToken, sourceId: first, url: "" });
    assert.deepEqual(await call(links, ctx, { serviceToken }), [{ sourceId: second, url: "https://second.example.com/" }]);
  } finally { if (previous === undefined) delete process.env.CONVEX_SERVICE_TOKEN; else process.env.CONVEX_SERVICE_TOKEN = previous; }
});
