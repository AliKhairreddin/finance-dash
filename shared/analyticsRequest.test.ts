import assert from "node:assert/strict";
import test from "node:test";
import { fetchAnalyticsRange } from "./analyticsRequest";
import { createBankAnalyticsAccumulator } from "./analytics";

const range = { fromDate: "2026-09-08", toDate: "2026-09-08" };
const snapshot = { ...createBankAnalyticsAccumulator({ ...range, providers: [], teams: [] }).finish(), coverage: [] };

test("analytics settles empty and partial snapshots without requiring complete bank history", async (t) => {
  for (const coverage of [[], [{ source: "wise", missingRanges: [range] }]]) {
    t.mock.method(globalThis, "fetch", async () => Response.json({ ...snapshot, coverage }));
    const result = await fetchAnalyticsRange("/api", range, new AbortController().signal);
    assert.equal(result.summary.transactionCount, 0);
    assert.deepEqual(result.coverage, coverage);
    t.mock.restoreAll();
  }
});

test("analytics reports failed responses and rejects wrong-period snapshots", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ message: "Calculation failed" }, { status: 502 }));
  await assert.rejects(fetchAnalyticsRange("/api", range, new AbortController().signal), /Calculation failed/);
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => Response.json({ ...snapshot, fromDate: "2026-01-01" }));
  await assert.rejects(fetchAnalyticsRange("/api", range, new AbortController().signal), /invalid period/);
});

test("a perpetually building analytics response terminates with an actionable retry", async (t) => {
  let attempts = 0;
  t.mock.method(globalThis, "fetch", async () => { attempts++; return Response.json({ status: "building" }, { status: 202, headers: { "Retry-After": "0" } }); });
  await assert.rejects(fetchAnalyticsRange("/api", range, new AbortController().signal, undefined, 140), /Retry to continue/);
  assert.ok(attempts >= 1 && attempts <= 2, `bounded attempts: ${attempts}`);
});

test("an aborted analytics request stops retrying", async (t) => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async () => Response.json({ status: "building" }, { status: 202 }));
  const request = fetchAnalyticsRange("/api", range, controller.signal);
  controller.abort();
  await assert.rejects(request, { name: "AbortError" });
});
