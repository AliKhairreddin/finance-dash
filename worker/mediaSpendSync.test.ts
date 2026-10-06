import assert from "node:assert/strict";
import test from "node:test";
import worker from "./handler";

const env = {
  CONVEX_URL: "https://test.convex.cloud", CONVEX_SERVICE_TOKEN: "service",
  LEMONMAX_AUTH_TOKEN: "auth", LEMONMAX_BEARER_TOKEN: "bearer",
  LEMONMAX_SPEND_CURRENCY: "USD", LEMONMAX_SYNC_START_DATE: "2026-10-04"
} as never;
const scheduled = { cron: "30 8 * * *", scheduledTime: Date.parse("2026-10-06T08:30:00Z"), noRetry() {} };
const summary = {
  success: true, message: "OK", from_date: "2026-10-04", to_date: "2026-10-05",
  total_rows: 4, total_accounts: 3, total_spend: 19,
  data: [
    { Workspace: 1, Date: "2026-10-04", Platform: "Facebook", "BM ID": "bm1", "Account ID": "meta", Spend: 5 },
    { Workspace: 1, Date: "2026-10-05", Platform: "Facebook", "BM ID": "bm1", "Account ID": "meta", Spend: 6 },
    { Workspace: 2, Date: "2026-10-05", Platform: "Google", "BM ID": "bm2", "Account ID": "google", Spend: 8 },
    { Workspace: 3, Date: "2026-10-05", Platform: "TikTok", "BM ID": "bm3", "Account ID": "tiktok", Spend: 0 }
  ]
};

test("daily schedule imports every platform with exactly one unfiltered range request", async (t) => {
  let sourceCalls = 0;
  const mutations: { path: string; args: Record<string, unknown> }[] = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === "api.lemonmaxx.com") {
      sourceCalls += 1;
      assert.deepEqual([...url.searchParams.keys()].sort(), ["auth_token", "end_date", "start_date"]);
      assert.equal(url.searchParams.get("start_date"), summary.from_date);
      assert.equal(url.searchParams.get("end_date"), summary.to_date);
      return Response.json(summary);
    }
    const body = JSON.parse(String(init?.body));
    if (body.path === "mediaSpend:getSyncState") return Response.json({ status: "success", value: { status: "healthy", coveredFrom: "2026-10-04", coveredThrough: "2026-10-04" } });
    mutations.push({ path: body.path, args: body.args[0] });
    return Response.json({ status: "success", value: body.path === "mediaSpend:startSync" ? "started" : body.path === "mediaSpend:replaceDate" ? { inserted: 2, replaced: 0, deleted: 0, unchanged: 1 } : true });
  });
  await worker.scheduled(scheduled, env);
  assert.equal(sourceCalls, 1);
  const saves = mutations.filter((m) => m.path === "mediaSpend:replaceDate");
  assert.deepEqual(saves.map((m) => m.args.date), ["2026-10-04", "2026-10-05"]);
  const latest = saves[1].args.rows as { platform: string; spend: number; workspace: number }[];
  assert.deepEqual(latest.map((r) => r.platform), ["Facebook", "Google", "TikTok"]);
  assert.equal(latest[2].spend, 0);
  assert.equal(latest[2].workspace, 3);
  assert.equal(typeof saves[1].args.attemptId, "string");
  assert.equal(mutations.at(-1)?.path, "mediaSpend:completeSync");
});

test("duplicate daily events and in-progress imports do not consume another API request", async (t) => {
  for (const reservation of ["daily_limit", "busy"]) {
    const calls: string[] = [];
    const fetchMock = t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(new URL(String(input)).hostname, "test.convex.cloud");
      const body = JSON.parse(String(init?.body));
      calls.push(body.path);
      return Response.json({ status: "success", value: body.path === "mediaSpend:getSyncState" ? null : reservation });
    });
    await worker.scheduled(scheduled, env);
    assert.deepEqual(calls, ["mediaSpend:getSyncState", "mediaSpend:startSync"]);
    fetchMock.mock.restore();
  }
});

test("unpublished days preserve stored rows and report failure without a second API call", async (t) => {
  let sourceCalls = 0;
  const saves: string[] = [];
  const completed: string[] = [];
  t.mock.method(console, "error", () => {});
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    if (new URL(String(input)).hostname === "api.lemonmaxx.com") {
      sourceCalls += 1;
      return Response.json({ ...summary, total_rows: 1, total_accounts: 1, total_spend: 5, data: [summary.data[0]] });
    }
    const body = JSON.parse(String(init?.body));
    if (body.path === "mediaSpend:replaceDate") saves.push(body.args[0].date);
    if (body.path === "mediaSpend:completeSync" || body.path === "mediaSpend:failSync") completed.push(body.path);
    return Response.json({ status: "success", value: body.path === "mediaSpend:getSyncState" ? null : body.path === "mediaSpend:startSync" ? "started" : true });
  });
  await assert.rejects(worker.scheduled(scheduled, env), /no account rows for 2026-10-05/);
  assert.equal(sourceCalls, 1);
  assert.deepEqual(saves, ["2026-10-04"]);
  assert.deepEqual(completed, ["mediaSpend:failSync"]);
});

test("a full fourteen-day account report over 4 MB fits in the single daily request", async (t) => {
  const dates = Array.from({ length: 14 }, (_, i) =>
    new Date(Date.parse("2026-09-22T00:00:00Z") + i * 86_400_000).toISOString().slice(0, 10));
  const data = dates.flatMap((date) => Array.from({ length: 2452 }, (_, i) => ({ ...summary.data[0], Date: date, "Account ID": String(i), "Account Name": `Account ${i} - managed media`, Spend: 0 })));
  const payload = JSON.stringify({ ...summary, from_date: dates[0], to_date: dates.at(-1), total_rows: data.length, total_accounts: 2452, total_spend: 0, data });
  assert.ok(Buffer.byteLength(payload) > 4 * 1024 * 1024);
  let sourceCalls = 0, savedRows = 0;
  t.mock.method(console, "log", () => {});
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    if (new URL(String(input)).hostname === "api.lemonmaxx.com") {
      sourceCalls += 1;
      return new Response(payload, { headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(payload)) } });
    }
    const body = JSON.parse(String(init?.body));
    if (body.path === "mediaSpend:replaceDate") savedRows += body.args[0].rows.length;
    return Response.json({ status: "success", value: body.path === "mediaSpend:getSyncState" ? { status: "healthy", coveredThrough: "2026-10-04" } : body.path === "mediaSpend:startSync" ? "started" : true });
  });
  await worker.scheduled(scheduled, { ...env as object, LEMONMAX_SYNC_START_DATE: "2026-08-01" } as never);
  assert.equal(sourceCalls, 1);
  assert.equal(savedRows, 2452 * 14);
});
