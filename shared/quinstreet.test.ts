import assert from "node:assert/strict";
import test from "node:test";
import { quinStreetMaximumReportRecords, summarizeQuinStreetReport } from "./quinstreet";

test("summarizeQuinStreetReport totals the configured revenue column", () => {
  assert.deepEqual(
    summarizeQuinStreetReport(
      [
        { date: "2026-08-01", total_commission: "125.25" },
        { date: "2026-08-02", total_commission: 74.75 }
      ],
      "total_commission"
    ),
    { revenue: 200, rowCount: 2 }
  );
});

test("summarizeQuinStreetReport rejects report schema drift", () => {
  assert.throws(
    () => summarizeQuinStreetReport([{ commission: 10 }], "total_commission"),
    /missing revenue column "total_commission"/
  );
  assert.throws(
    () => summarizeQuinStreetReport({ data: [] }, "total_commission"),
    /must be a JSON array/
  );
});

test("summarizeQuinStreetReport refuses a response at the provider row cap", () => {
  const rows = Array.from({ length: quinStreetMaximumReportRecords }, () => ({ total_commission: 1 }));
  assert.throws(() => summarizeQuinStreetReport(rows, "total_commission"), /15,000-row API limit/);
});
