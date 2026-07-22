import assert from "node:assert/strict";
import test from "node:test";
import type { Invoice, Provider, RevenuePartner, RevenueRun } from "./types";
import {
  bindRevenuePartnerCompany,
  calculateRevenueMetrics,
  mergeRevenuePartnerDirectory,
  revenueRuleId,
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

test("company-level revenue rules can query the full network without an affiliate filter", () => {
  const custom = { ...partner("unconfigured"), affiliateId: "", enabled: true };
  const merged = mergeRevenuePartnerDirectory([custom]);

  assert.equal(merged.find((item) => item.id === custom.id)?.enabled, true);
  assert.equal(merged.length, 1);
});

test("revenue rule IDs are stable and restored drafts bind to the Merit customer", () => {
  const rule = {
    ...partner("legacy"),
    id: revenueRuleId("Kissterra"),
    providerId: "merit-kissterra",
    name: "Kissterra",
    affiliateId: "",
    invoiceDueDays: 30,
    defaultMeritTaxId: "tax-zero"
  };
  const provider: Provider = {
    id: "merit-kissterra",
    name: "Kissterra Technologies Ltd",
    legalName: "Kissterra Technologies Ltd",
    type: "client",
    tags: ["Merit"],
    aliases: ["Kissterra Technologies Ltd"],
    defaultCurrency: "USD",
    paymentTermsDays: 7,
    meritCustomerId: "customer-kissterra",
    source: "merit",
    createdAt: "2026-07-22T00:00:00.000Z"
  };
  const orphanedRun = {
    ...run("run-kissterra", 521252, "USD", "drafted", "2026-07-21T00:00:00.000Z"),
    partnerId: rule.id,
    partnerName: "Kissterra"
  };
  const orphanedDraft: Invoice = {
    id: "invoice-kissterra",
    documentType: "sales_invoice",
    origin: "revenue",
    customerName: "Kissterra",
    amount: 521252,
    currency: "USD",
    status: "draft",
    meritDeliveryStatus: "not-sent",
    invoiceNumber: "FD-KISSTERRA",
    issueDate: "2026-07-21",
    dueDate: "2026-08-20",
    source: "tune",
    description: "Partner network revenue",
    billingRuleId: rule.id,
    revenueRunIds: [orphanedRun.id],
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z"
  };

  const rebound = bindRevenuePartnerCompany(rule, provider, [orphanedRun], [orphanedDraft]);

  assert.equal(rule.id, "revenue-kissterra");
  assert.equal(rebound.runs[0]?.providerId, provider.id);
  assert.equal(rebound.invoices[0]?.providerId, provider.id);
  assert.equal(rebound.invoices[0]?.customerName, provider.legalName);
  assert.equal(rebound.invoices[0]?.dueDate, "2026-07-28");
  assert.equal(rebound.invoices[0]?.taxId, "tax-zero");
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
