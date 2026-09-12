import assert from "node:assert/strict";
import test from "node:test";
import { historicalCoverageGaps } from "./analyticsCoverage";
import type { AnalyticsCoverage } from "./analyticsRequest";

test("coverage warnings omit the ongoing Eastern day even after UTC midnight", () => {
  const coverage: AnalyticsCoverage[] = [{ source: "wise", missingRanges: [
    { fromDate: "2026-09-01", toDate: "2026-09-03" },
    { fromDate: "2026-09-11", toDate: "2026-09-11" }
  ] }];
  assert.deepEqual(historicalCoverageGaps(coverage, new Date("2026-09-12T03:30:00Z")), [
    { source: "wise", missingRanges: [{ fromDate: "2026-09-01", toDate: "2026-09-03" }] }
  ]);
  assert.equal(coverage[0].missingRanges.length, 2, "canonical sync coverage stays unchanged");
});

test("a current-day-only gap produces no warning for any bank", () => {
  const coverage: AnalyticsCoverage[] = ["wise", "revolut", "slash", "amex"].map((source) => ({
    source: source as AnalyticsCoverage["source"],
    missingRanges: [{ fromDate: "2026-09-11", toDate: "2026-09-11" }]
  }));
  assert.deepEqual(historicalCoverageGaps(coverage, new Date("2026-09-12T03:30:00Z")), []);
});

test("spanning gaps are clipped to yesterday without hiding older missing dates", () => {
  assert.deepEqual(historicalCoverageGaps([
    { source: "wise", missingRanges: [{ fromDate: "2026-09-01", toDate: "2026-09-12" }] }
  ], new Date("2026-09-12T03:30:00Z")), [
    { source: "wise", missingRanges: [{ fromDate: "2026-09-01", toDate: "2026-09-10" }] }
  ]);
});

test("a day becomes historical at Eastern midnight in summer and winter", () => {
  for (const [day, before, after] of [
    ["2026-09-11", "2026-09-12T03:59:59Z", "2026-09-12T04:00:00Z"],
    ["2026-01-11", "2026-01-12T04:59:59Z", "2026-01-12T05:00:00Z"],
    ["2026-03-08", "2026-03-09T03:59:59Z", "2026-03-09T04:00:00Z"]
  ]) {
    const coverage: AnalyticsCoverage[] = [{ source: "wise", missingRanges: [{ fromDate: day, toDate: day }] }];
    assert.deepEqual(historicalCoverageGaps(coverage, new Date(before)), []);
    assert.deepEqual(historicalCoverageGaps(coverage, new Date(after)), coverage);
  }
});
