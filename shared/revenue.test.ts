import assert from "node:assert/strict";
import test from "node:test";
import type { RevenuePartner, RevenueRun } from "./types";
import { calculateRevenueMetrics } from "./revenue";

const partner = (id: string, enabled = true): RevenuePartner => ({
  id,
  name: id,
  source: "tune",
  affiliateId: id,
  currency: "USD",
  timezone: "UTC",
  networkTimezone: "UTC",
  networkIdEnv: "NETWORK_ID",
  apiKeyEnv: "API_KEY",
  invoiceDueDays: 30,
  enabled,
  createdAt: "2026-07-01T00:00:00.000Z"
});

const run = (id: string, revenue: number, currency: string, status: RevenueRun["status"], createdAt: string): RevenueRun => ({
  id,
  partnerId: "partner",
  partnerName: "Partner",
  source: "tune",
  periodStart: "2026-07-01",
  periodEnd: "2026-07-07",
  timezone: "UTC",
  revenue,
  currency,
  status,
  createdAt
});

test("calculateRevenueMetrics does not add unlike currencies", () => {
  const metrics = calculateRevenueMetrics(
    [partner("enabled"), partner("disabled", false)],
    [
      run("usd-invoiced", 100, "USD", "invoiced", "2026-07-08T00:00:00.000Z"),
      run("cad-invoiced", 25, "CAD", "invoiced", "2026-07-09T00:00:00.000Z"),
      run("usd-pending", 10, "usd", "pulled", "2026-07-07T00:00:00.000Z"),
      run("ignored", 999, "EUR", "failed", "2026-07-06T00:00:00.000Z")
    ]
  );

  assert.deepEqual(metrics.totalRevenue, { USD: 110, CAD: 25 });
  assert.deepEqual(metrics.invoicedRevenue, { USD: 100, CAD: 25 });
  assert.deepEqual(metrics.pendingRevenue, { USD: 10 });
  assert.equal(metrics.failedRuns, 1);
  assert.equal(metrics.partnerCount, 1);
  assert.equal(metrics.lastRunAt, "2026-07-09T00:00:00.000Z");
});
