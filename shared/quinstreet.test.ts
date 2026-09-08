import assert from "node:assert/strict";
import test from "node:test";
import { quinStreetMaximumReportRecords, summarizeQuinStreetReport } from "./quinstreet";

test("summarizeQuinStreetReport totals the configured revenue column", () => {
  assert.deepEqual(
    summarizeQuinStreetReport(
      {
        data: {
          columns: ["date", "category", "total_earn", "clicks", "grs_leads", "payable_leads", "click_earn", "lead_earn"],
          numberOfRecords: "4",
          records: [
            { "0": "2026-08-01", "1": "Auto Insurance", "2": "125.25", "3": 10, "4": 30, "5": 25, "6": 100, "7": 25.25 },
            { "0": "2026-08-01", "1": "Home Insurance", "2": 11.5 },
            { "0": "2026-08-02", "1": "auto insurance", "2": 74.75, "3": 20, "4": 50, "5": 40, "6": 60, "7": 14.75 },
            { "0": "2026-08-03", "1": "Auto Insurance", "2": null, "3": null, "4": null, "5": null, "6": null, "7": null }
          ]
        }
      },
      "total_earn",
      { categoryField: "category", categoryValue: "Auto Insurance" }
    ),
    { revenue: 200, rowCount: 3, clicks: 30, leads: 80, payableLeads: 65, clickRevenue: 160, leadRevenue: 40, earningsPerClick: 5.3333, earningsPerLead: 0.6154 }
  );
});

test("summarizeQuinStreetReport rejects report schema drift", () => {
  assert.throws(
    () => summarizeQuinStreetReport([], "total_earn", { categoryField: "category", categoryValue: "Auto Insurance" }),
    /must contain a data object/
  );
  assert.throws(
    () => summarizeQuinStreetReport(
      { data: { columns: ["category"], numberOfRecords: 1, records: [{ "0": "Auto Insurance" }] } },
      "total_earn",
      { categoryField: "category", categoryValue: "Auto Insurance" }
    ),
    /missing column "total_earn"/
  );
  assert.throws(
    () => summarizeQuinStreetReport(
      { data: { columns: ["category", "total_earn"], numberOfRecords: 2, records: [{ "0": "Auto Insurance", "1": 10 }] } },
      "total_earn",
      { categoryField: "category", categoryValue: "Auto Insurance" }
    ),
    /record count does not match/
  );
});

test("summarizeQuinStreetReport refuses a response at the provider row cap", () => {
  const records = Array.from({ length: quinStreetMaximumReportRecords }, () => ({ "0": "Auto Insurance", "1": 1 }));
  assert.throws(
    () => summarizeQuinStreetReport(
      { data: { columns: ["category", "total_earn"], numberOfRecords: quinStreetMaximumReportRecords, records } },
      "total_earn",
      { categoryField: "category", categoryValue: "Auto Insurance" }
    ),
    /15,000-row API limit/
  );
});

test("zero unit counts leave average rates unavailable and missing metric columns are errors", () => {
 const payload = {data: {columns:["category","total_earn","clicks","grs_leads","payable_leads","click_earn","lead_earn"], numberOfRecords:1, records:[{"0":"Auto","1":0,"2":0,"3":0,"4":0,"5":0,"6":0}]}};
 const summary=summarizeQuinStreetReport(payload,"total_earn",{categoryField:"category",categoryValue:"Auto"});
 assert.equal(summary.earningsPerClick,undefined); assert.equal(summary.earningsPerLead,undefined);
 payload.data.columns.pop(); assert.throws(()=>summarizeQuinStreetReport(payload,"total_earn",{categoryField:"category",categoryValue:"Auto"}),/missing column "lead_earn"/);
});
