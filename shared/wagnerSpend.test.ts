import assert from "node:assert/strict";
import test from "node:test";
import { handleWagnerSpendApi as handleApi, parseWagnerDimensions, parseWagnerSpend, type WagnerCacheEntry, type WagnerSpendCache } from "./wagnerSpendApi";
import { validateWagnerDateRange, wagnerSpendCsv, wagnerRefreshAfter } from "./wagnerSpend";

function memoryCache(): WagnerSpendCache {
  const entries = new Map<string, WagnerCacheEntry>();
  const claims = new Map<string, string>();
  let retryAfter = 0;
  return {
    async acquire(key, attemptId) {
      const entry = entries.get(key);
      if (entry && (entry.refreshAfter === null || entry.refreshAfter > Date.now())) return { status: "cached", ...entry };
      if (claims.has(key)) return { status: "busy" };
      if (retryAfter > Date.now()) return { status: "throttled", retryAfter };
      claims.set(key, attemptId);
      return { status: "claimed" };
    },
    async save(key, attemptId, entry) { assert.equal(claims.get(key), attemptId); entries.set(key, entry); claims.delete(key); },
    async release(key, attemptId, until) { if (claims.get(key) === attemptId) claims.delete(key); retryAfter = Math.max(retryAfter, until ?? 0); }
  };
}
const handleWagnerSpendApi = (url: URL, key: string | undefined, cache = memoryCache()) => handleApi(url, key, cache);

const fixture = {
  from: "2026-10-01", to: "2026-10-07", currency: "USD", group_by: ["agency"],
  data_through: "2026-10-08", generated_at: "2026-10-08T12:00:00Z",
  totals: { spend_usd: 10.01, commission_usd: 0.31, rows: 2 },
  rows: [
    { agency_id: "agency-1", agency_name: "Agency One", spend_usd: 5, commission_usd: 0.15 },
    { agency_id: null, agency_name: null, spend_usd: 5, commission_usd: 0.15 }
  ]
};
const parse = (value: unknown) => parseWagnerSpend(value, fixture.from, fixture.to, "agency");

test("Wagner retains exact source totals and unassigned spend despite row rounding", () => {
  const result = parse(fixture);
  assert.deepEqual(result.totals, { spend: 10.01, commission: 0.31, total: 10.32 });
  assert.equal(result.rows[1].key, "none");
  assert.equal(result.rows[1].label, "Unassigned");
  assert.equal(result.rows[1].total, 5.15);
  assert.equal(result.dataThrough, "2026-10-08");
});

test("Wagner rejects incomplete, mismatched, duplicated and malformed financial responses", () => {
  for (const value of [
    { ...fixture, from: "2026-09-01" }, { ...fixture, currency: "EUR" },
    { ...fixture, group_by: ["source"] }, { ...fixture, rows: fixture.rows.slice(0, 1) },
    { ...fixture, rows: [fixture.rows[0], fixture.rows[0]] },
    { ...fixture, totals: { ...fixture.totals, spend_usd: 11 } },
    { ...fixture, totals: { ...fixture.totals, commission_usd: "0.31" } },
    { ...fixture, data_through: "2026-02-30" }, { ...fixture, generated_at: "invalid" },
    { ...fixture, rows: [{ ...fixture.rows[0], spend_usd: NaN }, fixture.rows[1]] }
  ]) assert.throws(() => parse(value), /invalid spend response/);
});

test("empty Wagner periods are valid zero results, without inventing coverage", () => {
  const result = parse({ ...fixture, totals: { spend_usd: 0, commission_usd: 0, rows: 0 }, rows: [], data_through: null });
  assert.equal(result.totals.total, 0);
  assert.equal(result.dataThrough, null);
});

test("Wagner date validation uses inclusive 400-day limits and rejects impossible dates", () => {
  validateWagnerDateRange("2025-01-01", "2026-02-04");
  for (const [from, to] of [["2025-01-01", "2026-02-05"], ["2026-02-30", "2026-03-01"], ["", "2026-10-07"], ["2026-10-08", "2026-10-07"]]) {
    assert.throws(() => validateWagnerDateRange(from, to));
  }
});

test("dimension lists preserve API identities and resolve unassigned and platform labels", () => {
  const result = parseWagnerDimensions({ agencies: [{ id: null, name: null }], ad_accounts: [], buyers: [], teams: [], sources: [{ id: "facebook", name: "facebook" }], verticals: [], categories: [], rt_campaigns: [{ id: "campaign-1", name: "facebook" }, { id: null, name: null }] });
  assert.deepEqual(result.agency, [{ value: "none", label: "Unassigned" }]);
  assert.deepEqual(result.source, [{ value: "facebook", label: "Meta" }]);
  assert.deepEqual(result.rt_campaign, [{ value: "campaign-1", label: "facebook" }, { value: "none", label: "Unassigned" }]);
});

test("Wagner proxy sends credentials only in headers and forwards supported filters", async t => {
  const calls: URL[] = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input)); calls.push(url);
    assert.equal(url.origin, "https://www.inchops.com");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer private-test-key");
    assert.equal(init?.redirect, "manual");
    assert.ok(init?.signal);
    assert.equal(url.searchParams.get("team"), "team-303");
    assert.equal(url.searchParams.get("buyer"), "none");
    assert.equal(url.searchParams.get("source"), "facebook");
    assert.equal(url.searchParams.has("url"), false);
    return Response.json(fixture);
  });
  const response = await handleWagnerSpendApi(new URL("https://finance.example/api/media-spend/wagner?fromDate=2026-10-01&toDate=2026-10-07&groupBy=agency&team=team-303&buyer=none&source=facebook&url=https://example.com"), "private-test-key");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(calls.length, 1);
  assert.doesNotMatch(await response.text(), /private-test-key/);
});

test("Wagner proxy does not call upstream for invalid requests or missing credentials", async t => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Must not fetch"); });
  const validUrl = new URL("https://finance.example/api/media-spend/wagner?fromDate=2026-10-01&toDate=2026-10-07");
  assert.equal((await handleWagnerSpendApi(validUrl, undefined)).status, 503);
  validUrl.searchParams.set("groupBy", "unsupported");
  assert.equal((await handleWagnerSpendApi(validUrl, "test")).status, 400);
});

test("upstream failures and malformed responses never expose credentials or masquerade as zero spend", async t => {
  const url = new URL("https://finance.example/api/media-spend/wagner?fromDate=2026-10-01&toDate=2026-10-07");
  for (const status of [401, 429, 500, 200]) {
    const mock = t.mock.method(globalThis, "fetch", async () => new Response("private-test-key", { status }));
    const response = await handleWagnerSpendApi(url, "private-test-key");
    assert.equal(response.status, status === 429 ? 429 : 502);
    assert.doesNotMatch(await response.text(), /private-test-key/);
    mock.mock.restore();
  }
});

test("Wagner account CSV includes IDs and neutralizes spreadsheet formulas", () => {
  const data = parseWagnerSpend({ ...fixture, group_by: ["ad_account"], totals: { spend_usd: 5, commission_usd: 0.15, rows: 1 }, rows: [{ ad_account_id: "crm-id", ad_account_name: '=HYPERLINK("unsafe")', meta_act_id: "act_1", spend_usd: 5, commission_usd: 0.15 }] }, fixture.from, fixture.to, "ad_account");
  assert.equal(data.rows[0].accountId, "act_1");
  const csv = wagnerSpendCsv(data);
  assert.ok(csv.includes('"Account ID"'));
  assert.ok(csv.includes('"\'=HYPERLINK(""unsafe"")"'));
  assert.ok(csv.includes('"5.15"'));
});

test("refreshing saved recent reports avoids the API until expiry, then saves the new response", async t => {
  let now = Date.parse("2026-10-08T12:00:00Z");
  t.mock.method(Date, "now", () => now);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json(fixture); });
  const cache = memoryCache();
  const url = new URL("https://finance.example/api/media-spend/wagner?fromDate=2026-10-01&toDate=2026-10-07");
  const first = await (await handleWagnerSpendApi(url, "key", cache)).json();
  const second = await (await handleWagnerSpendApi(url, undefined, cache)).json();
  assert.equal(calls, 1);
  assert.equal(second.savedAt, first.savedAt);
  now += 3_600_001;
  assert.equal((await handleWagnerSpendApi(url, "key", cache)).status, 200);
  assert.equal(calls, 2);
});

test("historical reports stay saved indefinitely while incomplete and recent periods remain refreshable", async t => {
  let now = Date.parse("2026-11-08T12:00:00Z");
  t.mock.method(Date, "now", () => now);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json(fixture); });
  const cache = memoryCache();
  const url = new URL("https://finance.example/api/media-spend/wagner?fromDate=2026-10-01&toDate=2026-10-07");
  const result = await (await handleWagnerSpendApi(url, "key", cache)).json();
  assert.equal(result.refreshAfter, null);
  now += 365 * 86_400_000;
  assert.equal((await handleWagnerSpendApi(url, undefined, cache)).status, 200);
  assert.equal(calls, 1);
  assert.equal(wagnerRefreshAfter(now, "2026-10-07", "2026-10-06"), now + 3_600_000);
  assert.equal(wagnerRefreshAfter(now, "2026-10-07", null), now + 3_600_000);
  assert.equal(wagnerRefreshAfter(now, null, null), now + 86_400_000);
});

test("equivalent filter order shares saved reports; a different filter has its own snapshot", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json(fixture); });
  const cache = memoryCache();
  for (const filter of ["P2W,Avoud", "avoud,p2w", "P2W"]) {
    const url = new URL(`https://finance.example/api/media-spend/wagner?fromDate=2026-10-01&toDate=2026-10-07&agency=${filter}`);
    assert.equal((await handleWagnerSpendApi(url, "key", cache)).status, 200);
  }
  assert.equal(calls, 2);
});

test("failed source pulls release reservations, preserve saved history, and can be retried", async t => {
  let now = Date.parse("2026-10-08T12:00:00Z");
  t.mock.method(Date, "now", () => now);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return calls === 1 ? new Response("failure", { status: 500 }) : Response.json(fixture); });
  const cache = memoryCache();
  const url = new URL("https://finance.example/api/media-spend/wagner?fromDate=2026-10-01&toDate=2026-10-07");
  assert.equal((await handleWagnerSpendApi(url, "key", cache)).status, 502);
  assert.equal((await handleWagnerSpendApi(url, "key", cache)).status, 429);
  now += 60_001;
  assert.equal((await handleWagnerSpendApi(url, "key", cache)).status, 200);
  assert.equal((await handleWagnerSpendApi(url, "key", cache)).status, 200);
  assert.equal(calls, 2);
});

test("RedTrack campaign reports retain IDs, identical names, unassigned spend, and exact totals in CSV", () => {
  const campaigns = { ...fixture, group_by: ["rt_campaign"], rows: [
    { rt_campaign_id: "campaign-1", rt_campaign_name: "facebook", spend_usd: 5, commission_usd: 0.15 },
    { rt_campaign_id: null, rt_campaign_name: null, spend_usd: 5, commission_usd: 0.15 }
  ] };
  const result = parseWagnerSpend(campaigns, fixture.from, fixture.to, "rt_campaign");
  assert.deepEqual(result.rows.map(row => [row.key, row.label, row.campaignId]), [["campaign-1", "facebook", "campaign-1"], ["none", "Unassigned", null]]);
  assert.equal(result.totals.spend, 10.01);
  const csv = wagnerSpendCsv(result);
  assert.match(csv, /"RedTrack campaign","Campaign ID"/);
  assert.match(csv, /"facebook","campaign-1","5.00","0.15","5.15"/);
  assert.match(csv, /"Unassigned",""/);
  assert.equal(parseWagnerSpend({ ...campaigns, rows: campaigns.rows.map((row, i) => ({ ...row, rt_campaign_id: `campaign-${i}`, rt_campaign_name: "Same name" })) }, fixture.from, fixture.to, "rt_campaign").rows.length, 2);
  assert.throws(() => parseWagnerSpend({ ...campaigns, rows: campaigns.rows.map(row => ({ ...row, rt_campaign_id: "duplicate" })) }, fixture.from, fixture.to, "rt_campaign"));
});

test("campaign filters support IDs, exact names, multiple values and unassigned daily drill-down with saved report reuse", async t => {
  const filters: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("group_by"), "date");
    filters.push(url.searchParams.get("rt_campaign") ?? "");
    return Response.json({ ...fixture, group_by: ["date"], totals: { spend_usd: 5, commission_usd: 0.15, rows: 1 }, rows: [{ date: fixture.from, spend_usd: 5, commission_usd: 0.15 }] });
  });
  const cache = memoryCache();
  for (const filter of ["campaign-1", "Exact campaign name", "campaign-2,campaign-1", "campaign-1,campaign-2", "none"]) {
    const params = new URLSearchParams({ fromDate: fixture.from, toDate: fixture.to, groupBy: "date", rt_campaign: filter });
    assert.equal((await handleWagnerSpendApi(new URL(`https://finance.example/api/media-spend/wagner?${params}`), "key", cache)).status, 200);
  }
  assert.deepEqual(filters, ["campaign-1", "exact campaign name", "campaign-1,campaign-2", "none"]);
});

test("new dimensions snapshots require campaigns and do not reuse the previous dimensions contract", async t => {
  const dimensions = { agencies: [], ad_accounts: [], buyers: [], teams: [], sources: [], verticals: [], categories: [], rt_campaigns: [] };
  assert.throws(() => parseWagnerDimensions({ ...dimensions, rt_campaigns: undefined }));
  const cache = memoryCache();
  const oldKey = "wagner:v1:/api/finance/v1/dimensions?";
  await cache.acquire(oldKey, "seed");
  await cache.save(oldKey, "seed", { payload: JSON.stringify({ ...dimensions, rt_campaigns: undefined }), savedAt: Date.now(), refreshAfter: null });
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => {
    assert.equal(new URL(String(input)).search, "");
    calls++;
    return Response.json(dimensions);
  });
  const url = new URL("https://finance.example/api/media-spend/wagner/dimensions");
  for (let i = 0; i < 2; i++) {
    const response = await handleWagnerSpendApi(url, "key", cache);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).rt_campaign, []);
  }
  assert.equal(calls, 1);
  assert.equal((await cache.acquire(oldKey, "read")).status, "cached");
});

test("provider Retry-After pauses all uncached reports while saved reports remain available", async t => {
  let now = Date.parse("2026-10-08T12:00:00Z");
  t.mock.method(Date, "now", () => now);
  for (const retry of ["120", new Date(now + 120_000).toUTCString()]) {
    let calls = 0;
    const mock = t.mock.method(globalThis, "fetch", async () => {
      calls++;
      return calls === 2 ? new Response(null, { status: 429, headers: { "Retry-After": retry } }) : Response.json(fixture);
    });
    const cache = memoryCache();
    const saved = new URL("https://finance.example/api/media-spend/wagner?fromDate=2026-10-01&toDate=2026-10-07");
    assert.equal((await handleWagnerSpendApi(saved, "key", cache)).status, 200);
    const limited = new URL(`${saved}&agency=a`);
    const response = await handleWagnerSpendApi(limited, "key", cache);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("Retry-After"), "120");
    assert.equal((await handleWagnerSpendApi(new URL(`${saved}&agency=b`), "key", cache)).status, 429);
    assert.equal((await handleWagnerSpendApi(saved, undefined, cache)).status, 200);
    assert.equal(calls, 2);
    now += 120_001;
    assert.equal((await handleWagnerSpendApi(limited, "key", cache)).status, 200);
    assert.equal(calls, 3);
    mock.mock.restore();
    now = Date.parse("2026-10-08T12:00:00Z");
  }
});
