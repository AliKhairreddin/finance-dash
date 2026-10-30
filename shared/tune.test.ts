import assert from "node:assert/strict";
import test from "node:test";
import { fetchTuneTotals, summarizeTuneReport } from "./tune";

const period = { periodStart: "2026-10-19", periodEnd: "2026-10-25" };
function report(payout = "12.34567") {
  const stat = { date: "2026-10-19", payout, clicks: "20", conversions: "3" };
  return { response: { status: 1, data: { page: 1, current: 50, count: 1, pageCount: 1,
    data: [{ Stat: stat }], totals: { Stat: { payout, clicks: "20", conversions: "3" } } } } };
}

test("TUNE reconciles full precision before rounding, and accepts verified empty activity", () => {
  assert.deepEqual(summarizeTuneReport(report(), period), { revenue: 12.35, clicks: 20, conversions: 3 });
  assert.equal(summarizeTuneReport(report("0"), period).revenue, 0);
  assert.deepEqual(summarizeTuneReport({ response: { status: 1, data: {
    page: 1, current: 50, count: null, pageCount: null, data: [], totals: []
  } } }, period), { revenue: 0, clicks: 0, conversions: 0 });
});

test("TUNE rejects missing, failed, malformed, partial, and mismatched reports instead of zero", () => {
  for (const value of [undefined, {}, { response: { status: 0, data: {} } }, { response: { status: 1, data: [] } }]) {
    assert.throws(() => summarizeTuneReport(value, period));
  }
  const mutations: Array<(value: ReturnType<typeof report>) => void> = [
    value => { value.response.data.pageCount = 2; },
    value => { value.response.data.count = 2; },
    value => { value.response.data.page = 2; },
    value => { value.response.data.data = []; },
    value => { value.response.data.totals.Stat.payout = "99"; },
    value => { value.response.data.totals.Stat.clicks = "21"; },
    value => { value.response.data.data[0]!.Stat.payout = "NaN"; },
    value => { value.response.data.data[0]!.Stat.clicks = ""; },
    value => { value.response.data.data[0]!.Stat.date = "2026-10-26"; },
    value => { value.response.data.data.push(value.response.data.data[0]!); value.response.data.count = 2; }
  ];
  for (const mutate of mutations) {
    const value = report(); mutate(value);
    assert.throws(() => summarizeTuneReport(value, period));
  }
});

test("TUNE HTTP and parse failures cannot expose the credential-bearing URL", async t => {
  const url = "https://tune.example/Apiv3/json?api_key=private-test-credential";
  t.mock.method(globalThis, "fetch", async () => { throw new TypeError(`Failed ${url}`); });
  await assert.rejects(fetchTuneTotals(url, period), error => error instanceof Error && !error.message.includes("private-test-credential"));
  t.mock.method(globalThis, "fetch", async () => new Response(url, { status: 429, headers: { "Retry-After": "3600" } }));
  await assert.rejects(fetchTuneTotals(url, period), /HTTP 429/);
  t.mock.method(globalThis, "fetch", async () => new Response(url));
  await assert.rejects(fetchTuneTotals(url, period), /invalid JSON/);
});
