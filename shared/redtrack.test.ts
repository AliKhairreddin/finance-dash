import assert from "node:assert/strict";
import test from "node:test";
import { fetchRedTrackReport } from "./redtrackApi";
import { filterRedTrackRows, groupRedTrackRows, redTrackNeedsSync, redTrackSyncRanges, validateRedTrackDates, validateRedTrackLink, type RedTrackRow } from "./redtrack";
import { dashboardPageAllowed, financeOperatorCanAccess, mediaSpendReviewerCanAccess } from "./dashboardAccess";

const source = "62866645c686840001f43358";
const raw = (i = 0) => ({ date: "2026-10-07", network: "Advertiser", network_id: source, offer: "Offer", offer_id: `offer-${i}`,
  source: "Google", source_id: "google", campaign: "Campaign", campaign_id: "campaign", revenue: 1.1234, conversions: 1, total_revenue: 2.2345, total_conversions: 2 });

test("RedTrack reads every report and source page, requests revenue only, and keeps the key in a header", async () => {
  const calls: string[] = [];
  const fetcher = (async (input, init) => {
    const url = new URL(String(input)); calls.push(url.pathname + url.search);
    assert.equal(new Headers(init?.headers).get("X-Auth-Token"), "test-secret");
    assert(!url.href.includes("test-secret"));
    assert(!url.searchParams.has("total"));
    assert.equal(init?.method, undefined);
    const page = url.searchParams.get("page");
    if (url.pathname === "/report") {
      assert.equal(url.searchParams.get("click_time"), "false");
      if (url.searchParams.get("group") === "date") return Response.json([{ date: "2026-10-07", revenue: 1124.5234, conversions: 1001, total_revenue: 2236.7345, total_conversions: 2002 }]);
      assert.equal(url.searchParams.get("group"), "date,network,offer,source,campaign");
      assert(!/cost|spend|profit|roi/.test(url.searchParams.get("fields")!));
      return Response.json(page === "1" ? Array.from({ length: 1000 }, (_, i) => raw(i)) : [raw(1000)]);
    }
    return Response.json(page === "1" ? Array.from({ length: 1000 }, (_, i) => ({ id: i.toString(16).padStart(24, "0"), title: `Source ${i}`, postback_token: "private" })) : [{ id: source, title: "Advertiser", postback_token: "private" }]);
  }) as typeof fetch;
  const result = await fetchRedTrackReport("test-secret", "2026-10-07", "2026-10-07", fetcher);
  assert.equal(result.rows.length, 1001);
  assert.equal(result.sources.length, 1001);
  assert.equal(calls.length, 5);
  assert(!JSON.stringify(result).includes("private"));
  const grouped = groupRedTrackRows(result.rows, "offerSources", "primary");
  assert.equal(grouped[0].revenue, 1124.5234);
  assert.equal(grouped[0].conversions, 1001);
  assert.equal(groupRedTrackRows(result.rows, "offerSources", "all")[0].revenue, 2236.7345);
});

test("detail must reconcile with independent daily totals before it can be saved", async () => {
  const fetcher = (async input => {
    const url = new URL(String(input));
    return Response.json(url.searchParams.get("group") === "date" ? [{ ...raw(), revenue: 500 }] : [raw()]);
  }) as typeof fetch;
  await assert.rejects(fetchRedTrackReport("key", "2026-10-07", "2026-10-07", fetcher), /daily totals do not match/);
});

test("historical days remain saved, recent days expire deliberately, and overlapping ranges only sync missing dates", () => {
  const now = Date.parse("2026-10-08T18:00:00Z");
  assert.equal(redTrackNeedsSync("2026-10-08", now - 14 * 60_000, now), false);
  assert.equal(redTrackNeedsSync("2026-10-08", now - 16 * 60_000, now), true);
  assert.equal(redTrackNeedsSync("2026-10-07", now - 59 * 60_000, now), false);
  assert.equal(redTrackNeedsSync("2026-10-07", now - 61 * 60_000, now), true);
  assert.equal(redTrackNeedsSync("2026-10-01", now - 23 * 60 * 60_000, now), false);
  assert.equal(redTrackNeedsSync("2026-09-01", Date.parse("2026-10-03T18:00:00Z"), now), false);
  assert.equal(redTrackNeedsSync("2026-09-01", Date.parse("2026-09-10T18:00:00Z"), now), true);
  assert.equal(redTrackNeedsSync("2026-01-01", undefined, now), true);
  assert.deepEqual(redTrackSyncRanges(["2026-10-02", "2026-10-03", "2026-10-07"]), [{ fromDate: "2026-10-02", toDate: "2026-10-03" }, { fromDate: "2026-10-07", toDate: "2026-10-07" }]);
});

test("RedTrack rejects incomplete numeric data, repeated pages, and upstream errors without exposing response contents", async () => {
  await assert.rejects(fetchRedTrackReport("secret", "2026-10-07", "2026-10-07", (async () => Response.json([{ ...raw(), revenue: undefined }])) as typeof fetch), /incomplete revenue/);
  await assert.rejects(fetchRedTrackReport("secret", "2026-10-07", "2026-10-07", (async () => Response.json([raw(), raw()])) as typeof fetch), /repeated report/);
  await assert.rejects(fetchRedTrackReport("secret", "2026-10-07", "2026-10-07", (async () => new Response("secret credentials", { status: 403 })) as typeof fetch), { message: "RedTrack rejected access. Check the API key and account permissions." });
  await assert.rejects(fetchRedTrackReport("secret", "2026-10-07", "2026-10-07", (async () => new Response("secret credentials", { status: 429 })) as typeof fetch), /request limit/);
  await assert.rejects(fetchRedTrackReport("", "2026-10-07", "2026-10-07"), /not connected/);
});

test("empty RedTrack reports remain empty without synthetic revenue", async () => {
  const result = await fetchRedTrackReport("secret", "2026-10-07", "2026-10-07", (async input => Response.json(new URL(String(input)).pathname === "/networks" ? null : [])) as typeof fetch);
  assert.deepEqual(result.rows, []); assert.deepEqual(result.sources, []);
});

test("filters intersect and each breakdown preserves revenue without merging different advertisers or channels", () => {
  const base: RedTrackRow = { key: "a", date: "2026-10-06", offerSourceId: source, offerSource: "Advertiser", offerId: "offer", offer: "Same name", trafficChannelId: "google", trafficChannel: "Google", campaignId: "one", campaign: "Campaign", revenue: 10, conversions: 1, allRevenue: 20, allConversions: 2 };
  const rows = [base, { ...base, key: "b", date: "2026-10-07", revenue: -2 }, { ...base, key: "c", trafficChannelId: "meta", trafficChannel: "Meta" }, { ...base, key: "d", offerSourceId: "other", offerSource: "Other advertiser" }];
  const filtered = filterRedTrackRows(rows, { offerSourceId: source, offerId: "offer", trafficChannelId: "google", search: "campaign" });
  assert.equal(filtered.length, 2);
  for (const group of ["offerSources", "offers", "trafficChannels", "campaigns", "daily"] as const) {
    assert.equal(groupRedTrackRows(rows, group, "primary").reduce((sum, row) => sum + row.revenue, 0), 28);
  }
  assert.equal(groupRedTrackRows(rows, "offers", "primary").length, 3);
  assert.equal(groupRedTrackRows(filtered, "offers", "primary")[0].revenue, 8);
  assert.equal(groupRedTrackRows(filtered, "offers", "primary")[0].campaigns, 1);
});

test("report periods and advertiser links are validated at the boundary", () => {
  assert.throws(() => validateRedTrackDates("2026-02-30", "2026-03-01"), /valid dates/);
  assert.throws(() => validateRedTrackDates("2026-10-07", "2026-10-06"), /start date/);
  assert.throws(() => validateRedTrackDates("2026-01-01", "2026-10-01"), /93 days/);
  assert.throws(() => validateRedTrackDates("2099-01-01", "2099-01-02"), /future/);
  assert.equal(validateRedTrackLink(source, " https://advertiser.example.com/report "), "https://advertiser.example.com/report");
  assert.equal(validateRedTrackLink(source, ""), "");
  for (const url of ["javascript:alert(1)", "http://example.com", "https://user:password@example.com", "https://localhost"]) assert.throws(() => validateRedTrackLink(source, url));
  assert.throws(() => validateRedTrackLink("invalid", "https://example.com"));
});

test("RedTrack stays behind administrator access for both reports and link updates", () => {
  assert.equal(dashboardPageAllowed("administrator", "redtrack"), true);
  for (const role of ["finance-operator", "media-spend-reviewer", "transaction-reviewer"] as const) assert.equal(dashboardPageAllowed(role, "redtrack"), false);
  for (const request of [new Request("https://finance.example.com/api/redtrack"), new Request("https://finance.example.com/api/redtrack/links", { method: "PUT" })]) {
    assert.equal(financeOperatorCanAccess(request), false); assert.equal(mediaSpendReviewerCanAccess(request), false);
  }
});
