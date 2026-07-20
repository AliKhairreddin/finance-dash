import assert from "node:assert/strict";
import test from "node:test";
import type { RevenuePartner, RevenueRun } from "./types";
import {
  calculateRevenueMetrics,
  mergeRevenuePartnerDirectory,
  resolveRevenuePeriod
} from "./revenue";

const partner = (id: string, enabled = true): RevenuePartner => ({
  id,
  providerId: `provider-${id}`,
  name: id,
  source: "tune",
  affiliateId: id,
  currency: "USD",
  timezone: "UTC",
  networkTimezone: "UTC",
  networkIdEnv: "NETWORK_ID",
  apiKeyEnv: "API_KEY",
  invoiceDueDays: 30,
  billingCadence: "weekly",
  billingTimezone: "Asia/Beirut",
  autoDraft: true,
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

test("revenue rules are ordinary persisted child records and are never injected or re-parented at runtime", () => {
  assert.deepEqual(mergeRevenuePartnerDirectory([]), []);

  const first = partner("first");
  const configured: RevenuePartner = {
    ...partner("configured-kissterra"),
    id: "user-created-kissterra-rule",
    providerId: "provider-user-kissterra",
    affiliateId: "configured-affiliate",
    enabled: true
  };
  const merged = mergeRevenuePartnerDirectory([first, configured]);

  assert.equal(merged.length, 2);
  assert.equal(merged.find((item) => item.id === first.id)?.providerId, "provider-first");
  assert.equal(merged.find((item) => item.id === configured.id)?.providerId, "provider-user-kissterra");
});

test("revenue rules without an affiliate ID stay disabled until configured", () => {
  const custom = { ...partner("unconfigured"), affiliateId: "", enabled: true };
  const merged = mergeRevenuePartnerDirectory([custom]);

  assert.equal(merged.find((item) => item.id === custom.id)?.enabled, false);
  assert.equal(merged.length, 1);
});

test("this-week revenue pulls are cumulative from Monday through the current local date", () => {
  assert.deepEqual(resolveRevenuePeriod({
    periodPreset: "this-week",
    timezone: "Asia/Beirut",
    now: new Date("2026-07-23T18:00:00.000Z")
  }), {
    preset: "this-week",
    periodStart: "2026-07-20",
    periodEnd: "2026-07-23",
    timezone: "Asia/Beirut"
  });
});
