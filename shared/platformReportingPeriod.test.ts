import assert from "node:assert/strict";
import test from "node:test";
import { platformReportingPeriod, type ManagementReportPlatformPerformance } from "./managementReport";
const row = (period: string, revenue: number, ytd = false): ManagementReportPlatformPerformance => ({ period, periodLabel: ytd ? "YTD June 2026" : period, platformMetricId: period + ytd, platform: "Total", revenue, spend: revenue / 2, profit: revenue / 2, isTotal: true, profitMargin: 0.5, leads: 0, cpl: 0, sourceRow: 1 });

test("YTD period changes only when cumulative source amounts uniquely reconcile", () => {
  const ytd = row("2026-06-30", 300, true);
  const monthly = [row("2026-01-31", 100), row("2026-02-28", 0), row("2026-03-31", 0), row("2026-04-30", 0), row("2026-05-31", 0), row("2026-06-30", 0), row("2026-07-31", 200)];
  assert.deepEqual(platformReportingPeriod(ytd, [ytd, ...monthly]), { period: "2026-07-31", label: "YTD July 2026", sourceLabel: "YTD June 2026" });
  assert.deepEqual(platformReportingPeriod(ytd, [ytd, monthly[0]]), { period: ytd.period, label: ytd.periodLabel });
  assert.deepEqual(platformReportingPeriod(ytd, [ytd, ...monthly, row("2026-08-31", 0)]), { period: ytd.period, label: ytd.periodLabel });
  assert.equal(platformReportingPeriod(monthly[0], monthly).label, monthly[0].periodLabel);
});
