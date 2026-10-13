import assert from "node:assert/strict";
import test from "node:test";
import { begin, finish, quinStreetReport, saveQuinStreetReport } from "../convex/integrationSync";
import { call, database } from "./convexTestDb";
import { currentMonthAccrualPeriod, previousCompletedWeek } from "../shared/income";

test("sync leases deduplicate requests, enforce cooldowns, fence expired writers and preserve good reports after failures", async () => {
  const old = process.env.CONVEX_SERVICE_TOKEN; process.env.CONVEX_SERVICE_TOKEN = "sync-test";
  try {
    const ctx = database({});
    const serviceToken = "sync-test", key = "quinstreet-mtd:auto:2026-10-01:2026-10-11";
    const first = await call(begin, ctx, { serviceToken, key, leaseId: "one" });
    assert.equal(first.acquired, true);
    assert.equal((await call(begin, ctx, { serviceToken, key, leaseId: "two" })).acquired, false);
    const report = { partnerId: "auto", partnerName: "Auto", periodStart: "2026-10-01", periodEnd: "2026-10-11", timezone: "Asia/Beirut", revenue: 1234, currency: "USD", fetchedAt: new Date().toISOString() };
    await call(saveQuinStreetReport, ctx, { serviceToken, leaseId: "one", report });
    await call(finish, ctx, { serviceToken, key, leaseId: "one" });
    assert.equal((await call(begin, ctx, { serviceToken, key, leaseId: "two" })).acquired, false);
    ctx.tables.integrationSyncJobs[0].nextAllowedAt = 0;
    assert.equal((await call(begin, ctx, { serviceToken, key, leaseId: "two" })).acquired, true);
    await assert.rejects(call(saveQuinStreetReport, ctx, { serviceToken, leaseId: "one", report: { ...report, revenue: 0 } }), /expired/);
    await call(finish, ctx, { serviceToken, key, leaseId: "two", error: "Rate limited" });
    const saved = await call(quinStreetReport, ctx, { serviceToken, partnerId: "auto", periodStart: report.periodStart, periodEnd: report.periodEnd });
    assert.equal(saved.revenue, 1234);
    assert.equal(ctx.tables.integrationSyncJobs[0].error, "Rate limited");
    await assert.rejects(call(begin, ctx, { serviceToken: "wrong", key, leaseId: "x" }), /Unauthorized/);
  } finally { if (old === undefined) delete process.env.CONVEX_SERVICE_TOKEN; else process.env.CONVEX_SERVICE_TOKEN = old; }
});
test("Monday QuinStreet coverage is month-to-prior-Sunday; invoice last week is exactly seven inclusive days", () => {
  for (const timestamp of ["2026-10-12T06:00:00Z", "2026-10-13T06:00:00Z"]) {
    const period = currentMonthAccrualPeriod(new Date(timestamp), "Asia/Beirut")!;
    assert.equal(period.periodStart, "2026-10-01"); assert.equal(period.accruedThrough, "2026-10-11");
    const week = previousCompletedWeek(new Date(timestamp), "Asia/Beirut");
    assert.equal(week.periodStart, "2026-10-05"); assert.equal(week.periodEnd, "2026-10-11");
  }
  assert.equal(currentMonthAccrualPeriod(new Date("2026-10-01T06:00:00Z"), "Asia/Beirut"), undefined);
});

test("ordinary QuinStreet reads and completed-week catch-up reuse saved reports; explicit reconciliation preserves data on failure", async () => {
  const { readQuinStreetMonthly, syncQuinStreetMonthly } = await import("../shared/quinstreetMonthly");
  const { status } = await import("../convex/integrationSync");
  const { getFunctionName } = await import("convex/server");
  const old = process.env.CONVEX_SERVICE_TOKEN; process.env.CONVEX_SERVICE_TOKEN = "sync-test";
  try {
    const ctx = database({});
    const handlers = { begin, finish, status, quinStreetReport, saveQuinStreetReport };
    const invoke = (ref: any, args: any) => call(handlers[getFunctionName(ref).split(":")[1] as keyof typeof handlers], ctx, args);
    const client = { query: invoke, mutation: invoke } as unknown as import("convex/browser").ConvexHttpClient;
    const partners = [{ id: "auto", name: "Auto", enabled: true, source: "quinstreet", currency: "USD", billingTimezone: "Asia/Beirut", billingCadence: "weekly" }] as import("../shared/types").RevenuePartner[];
    let calls = 0;
    const fetchRevenue = async (_partner: unknown, period: import("../shared/revenue").RevenuePeriod) => {
      calls++;
      return { id: "report", partnerName: "Auto", source: "quinstreet", createdAt: new Date().toISOString(), partnerId: "auto", ...period, revenue: 500, currency: "USD", status: "pulled" } as import("../shared/types").RevenueRun;
    };
    const now = new Date("2026-10-13T06:00:00Z");
    assert.equal((await readQuinStreetMonthly(client, "sync-test", partners, now))[0].revenue, null);
    assert.equal((await syncQuinStreetMonthly(client, "sync-test", partners, fetchRevenue, now))[0].revenue, 500);
    await syncQuinStreetMonthly(client, "sync-test", partners, fetchRevenue, now);
    await readQuinStreetMonthly(client, "sync-test", partners, now);
    assert.equal(calls, 1);
    ctx.tables.integrationSyncJobs[0].nextAllowedAt = 0;
    const failed = await syncQuinStreetMonthly(client, "sync-test", partners, async () => { throw new Error("Incomplete response"); }, now, true);
    assert.equal(failed[0].revenue, 500);
    assert.equal(failed[0].error, "Incomplete response");
    assert.equal(ctx.tables.quinstreetMonthlyReports.length, 1);
    assert.equal(ctx.tables.dashboardState, undefined, "Reporting must not create invoices or accruals");
  } finally { if (old === undefined) delete process.env.CONVEX_SERVICE_TOKEN; else process.env.CONVEX_SERVICE_TOKEN = old; }
});
