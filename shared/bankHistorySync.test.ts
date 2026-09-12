import assert from "node:assert/strict";
import test from "node:test";
import { claimAutomaticHistoryRequests, waitForBankHistorySync } from "./bankHistorySync";

const period = { fromDate: "2026-09-01", toDate: "2026-09-11" };

test("Wise feed and CSV gaps never trigger page-driven history sync", () => {
  const attempted = new Set<string>();
  assert.deepEqual(claimAutomaticHistoryRequests([
    { source: "wise", missingRanges: [period] }
  ], period, attempted), []);
  assert.equal(attempted.size, 0);
});

test("reloading, filtering and shrinking gaps cannot restart a period's automatic sync", () => {
  const attempted = new Set<string>();
  const coverage = [{ source: "slash" as const, missingRanges: [period] }];
  assert.deepEqual(claimAutomaticHistoryRequests(coverage, period, attempted), [{ source: "slash", ...period }]);
  assert.deepEqual(claimAutomaticHistoryRequests(coverage, period, attempted), []);
  assert.deepEqual(claimAutomaticHistoryRequests([
    { source: "slash", missingRanges: [{ fromDate: "2026-09-11", toDate: "2026-09-11" }] }
  ], period, attempted), []);
  assert.equal(claimAutomaticHistoryRequests(coverage, { ...period, fromDate: "2026-08-01" }, attempted).length, 1);
});

test("all-bank sync handles eligible sources independently without queuing Wise", () => {
  const attempted = new Set<string>();
  assert.deepEqual(claimAutomaticHistoryRequests([
    { source: "wise", missingRanges: [period] },
    { source: "slash", missingRanges: [] },
    { source: "revolut", missingRanges: [period] }
  ], period, attempted), [{ source: "revolut", ...period }]);
});

test("a completed history job settles immediately", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ status: "complete" }));
  assert.equal(await waitForBankHistorySync("/api", "job", new AbortController().signal), "complete");
});

test("a perpetually queued history job stops foreground polling", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ status: "queued" }, { status: 202 }); });
  assert.equal(await waitForBankHistorySync("/api", "job", new AbortController().signal, 25), "pending");
  assert.equal(calls, 1);
});

test("navigation cancels polling without claiming the history completed", async (t) => {
  const controller = new AbortController();
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; controller.abort(); return Response.json({ status: "running" }, { status: 202 }); });
  await assert.rejects(waitForBankHistorySync("/api", "job", controller.signal), { name: "AbortError" });
  assert.equal(calls, 1);
});

test("history sync preserves provider errors and rejects false completion responses", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ message: "Bank connection expired" }, { status: 409 }));
  await assert.rejects(waitForBankHistorySync("/api", "job", new AbortController().signal), /Bank connection expired/);
  t.mock.restoreAll();
  t.mock.method(globalThis, "fetch", async () => Response.json({ status: "running" }));
  await assert.rejects(waitForBankHistorySync("/api", "job", new AbortController().signal), /invalid status/);
});
