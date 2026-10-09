import assert from "node:assert/strict";
import test from "node:test";
import { buildManagementReport, type ManagementReportBusinessLine } from "./managementReport";
import { syntheticManagementReportSheets } from "./testFixtures/managementReport";
import { businessMetricBreakdown, platformSpendRows, reportBreakdownUrl, reportColumn, reportMetricValue, sumBreakdownRows } from "./managementReportBreakdown";

function fixture() {
  const { dashboard } = buildManagementReport(syntheticManagementReportSheets(), { importedAt: "2026-06-01T00:00:00Z", asOf: "2026-05-31" });
  const unit = dashboard.businessUnits.find(unit => unit.id === "cognitive-pixel")!;
  const column = reportColumn(unit, "2026-05-31")!;
  return { dashboard, unit, column };
}

test("revenue includes negative allocation adjustments once and preserves the reported subtotal", () => {
  const { dashboard, unit, column } = fixture();
  const source = unit.lines.find(line => line.label === "Source B")!;
  source.values[column.key] = -20;
  const detail = businessMetricBreakdown(dashboard, unit, "2026-05-31", "revenue");
  assert.deepEqual(detail.rows.map(row => row.value), [40, -20]);
  assert.equal(detail.reported, 100);
  assert.equal(detail.total, 20);
  assert.equal(detail.difference, 80);
  assert.match(detail.rows[0].source, /1\. VB - CP · E5$/);
});

test("operating spend excludes computed profit, ratios and deductions below its subtotal", () => {
  const { dashboard, unit, column } = fixture();
  const spend = unit.lines.find(line => line.metric === "operating-spend")!;
  const net = unit.lines.find(line => line.metric === "net-profit")!;
  net.sourceRow = spend.sourceRow + 10;
  const extra = (label: string, offset: number, value: number): ManagementReportBusinessLine => ({ ...spend,
    lineId: label, label, sourceRow: spend.sourceRow + offset, metric: undefined, isSubtotal: false,
    section: "operating-spend", values: { [column.key]: value }
  });
  unit.lines.push(extra("COMPUTED PROFIT", 1, 30), extra("East Operation Cost", 3, 5), extra("West Operation Cost", 4, 7));
  net.values[column.key] = 18;
  const detail = businessMetricBreakdown(dashboard, unit, "2026-05-31", "operating-spend");
  assert.equal(detail.reported, 10);
  assert.equal(detail.total, 10);
  assert.deepEqual(detail.exclusions.map(row => row.label), ["East Operation Cost", "West Operation Cost"]);
  assert.equal(sumBreakdownRows(detail.exclusions), 12);
  const profit = businessMetricBreakdown(dashboard, unit, "2026-05-31", "net-profit");
  assert.deepEqual(profit.rows.map(row => row.value), [40, -10, -5, -7]);
  assert.equal(profit.total, 18);
  assert.equal(profit.difference, 0);
});

test("blank cells and unavailable months are never reported as zero", () => {
  const { dashboard, unit, column } = fixture();
  delete unit.lines.find(line => line.label === "Software")!.values[column.key];
  const detail = businessMetricBreakdown(dashboard, unit, "2026-05-31", "operating-spend");
  assert.equal(detail.rows[0].value, undefined);
  assert.equal(detail.total, undefined);
  assert.equal(detail.difference, undefined);
  assert.equal(detail.reported, 10);
  assert.equal(reportMetricValue(unit, "2026-06-30", "operating-spend"), undefined);
  assert.equal(sumBreakdownRows([]), undefined);
});

test("monthly, YTD and zero-revenue margin calculations retain their actual scope", () => {
  const { dashboard, unit, column } = fixture();
  const ytd = reportColumn(unit, "ytd")!;
  unit.lines.find(line => line.metric === "revenue")!.values[ytd.key] = 200;
  assert.equal(reportMetricValue(unit, "ytd", "revenue"), 200);
  assert.equal(reportMetricValue(unit, "2026-05-31", "revenue"), 100);
  assert.equal(reportMetricValue(unit, "2026-05-31", "net-margin"), 0.3);
  assert.equal(businessMetricBreakdown(dashboard, unit, "ytd", "net-margin").difference, 0.15);
  unit.lines.find(line => line.metric === "revenue")!.values[column.key] = 0;
  const detail = businessMetricBreakdown(dashboard, unit, "2026-05-31", "net-margin");
  assert.equal(detail.reported, undefined);
  assert.equal(detail.total, undefined);
});

test("consolidated unit links use exact source names, not similarly named customer adjustments", () => {
  const { dashboard, column } = fixture();
  const lines = dashboard.consolidated.lines.filter(line => line.section === "revenue");
  lines[0].label = "VB - CP";
  lines[1].label = "VB - ACP - Rev";
  const detail = businessMetricBreakdown(dashboard, dashboard.consolidated, "2026-05-31", "revenue");
  assert.equal(detail.rows[0].scope, "cognitive-pixel");
  assert.equal(detail.rows[0].value, lines[0].values[column.key]);
  assert.equal(detail.rows[1].scope, undefined);
});

test("chart allocations exclude duplicate YTD/total rows and honor month and platform", () => {
  const { dashboard } = fixture();
  const row = dashboard.platforms[0];
  dashboard.platforms.push(
    { ...row, platformMetricId: "may", period: "2026-05-31", periodLabel: "May 2026", spend: 10, isTotal: false },
    { ...row, platformMetricId: "april", period: "2026-04-30", periodLabel: "April 2026", spend: 3, isTotal: false },
    { ...row, platformMetricId: "future", period: "2026-06-30", periodLabel: "June 2026", spend: 90, isTotal: false }
  );
  assert.equal(sumBreakdownRows(platformSpendRows(dashboard, "ytd")), 13);
  assert.equal(sumBreakdownRows(platformSpendRows(dashboard, "2026-05-31", "Facebook")), 10);
  assert.deepEqual(platformSpendRows(dashboard, "2026-05-31", "Google"), []);
});

test("breakdown links retain period and unrelated filters and clear obsolete scope on return", () => {
  const start = "https://finance.example/?page=management&managementPeriod=2026-05-31&managementUnitSort=revenue&analyticsPeriod=custom";
  const detail = new URL(reportBreakdownUrl(start, { metric: "operating-spend", scope: "cognitive-pixel" }), start);
  assert.equal(detail.searchParams.get("managementSection"), "breakdown");
  assert.equal(detail.searchParams.get("managementPeriod"), "2026-05-31");
  assert.equal(detail.searchParams.get("managementUnitSort"), "revenue");
  const summary = new URL(reportBreakdownUrl(detail.href, {}), start);
  assert.equal(summary.searchParams.get("managementScope"), null);
  assert.equal(summary.searchParams.get("managementMetric"), null);
  assert.equal(summary.searchParams.get("managementPeriod"), "2026-05-31");
  assert.equal(summary.searchParams.get("analyticsPeriod"), "custom");
});
