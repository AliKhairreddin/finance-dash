import assert from "node:assert/strict";
import test from "node:test";
import type { Invoice, Provider, RevenuePartner, RevenueRun } from "./types";
import {
  bindRevenuePartnerCompany,
  calculateRevenueMetrics,
  mergeRevenuePartnerDirectory,
  revenueRunsForPeriod,
  revenueRuleId,
  resolveRevenuePeriod
} from "./revenue";

const partner = (id: string, enabled = true): Extract<RevenuePartner, { source: "tune" }> => ({
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

test("rebinding a revenue draft preserves its invoice tax override", () => {
  const rule = { ...partner("tax-rule"), defaultMeritTaxId: "tax-rule" };
  const provider: Provider = {
    id: rule.providerId,
    name: "Tax Client",
    type: "client",
    tags: [],
    aliases: [],
    meritCustomerId: "merit-tax-client",
    defaultMeritTaxId: "tax-company",
    source: "merit",
    createdAt: "2026-07-01T00:00:00.000Z"
  };
  const draft: Invoice = {
    id: "invoice-tax-override",
    providerId: provider.id,
    documentType: "sales_invoice",
    origin: "revenue",
    customerName: provider.name,
    amount: 100,
    currency: "USD",
    status: "draft",
    meritDeliveryStatus: "not-sent",
    invoiceNumber: "2026/1304",
    issueDate: "2026-07-22",
    dueDate: "2026-08-21",
    source: "tune",
    description: "Revenue",
    taxId: "tax-invoice",
    billingRuleId: rule.id,
    revenueRunIds: [],
    createdAt: "2026-07-22T00:00:00.000Z",
    updatedAt: "2026-07-22T00:00:00.000Z"
  };

  const rebound = bindRevenuePartnerCompany(rule, provider, [], [draft]);

  assert.equal(rebound.invoices[0].taxId, "tax-invoice");
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

test("last-week revenue shows only the complete selected week and its total", () => {
  const period = resolveRevenuePeriod({ periodPreset: "last-week", now: new Date("2026-10-06T17:45:00Z") });
  const selected = {
    ...run("last-week", 222321, "USD", "invoiced", "2026-10-05T06:00:00Z"),
    periodStart: "2026-09-28", periodEnd: "2026-10-04"
  };
  const saved = [
    { ...selected, id: "accruing", revenue: 5259, periodStart: "2026-10-05", periodEnd: "2026-10-05" },
    selected,
    { ...selected, id: "older", revenue: 160685, periodStart: "2026-09-21", periodEnd: "2026-09-27" },
    { ...selected, id: "partial", periodEnd: "2026-10-02" },
    { ...selected, id: "overlap", periodStart: "2026-09-25" }
  ];
  const visible = revenueRunsForPeriod(saved, [], period);
  assert.deepEqual(visible, [selected]);
  assert.deepEqual(calculateRevenueMetrics([], visible).totalRevenue, { USD: 222321 });
  assert.equal(saved.length, 5);
});

test("a fresh pull replaces saved revenue for the same rule without double-counting", () => {
  const saved = run("saved", 100, "USD", "invoiced", "2026-07-08T00:00:00Z");
  const fresh = { ...saved, id: "fresh", revenue: 120, status: "pulled" as const, createdAt: "2026-07-09T00:00:00Z" };
  const visible = revenueRunsForPeriod([saved], [fresh], saved);
  assert.deepEqual(visible, [fresh]);
  assert.deepEqual(calculateRevenueMetrics([], visible).totalRevenue, { USD: 120 });
  const failed = { ...fresh, id: "retry-failed", status: "failed" as const, revenue: 0 };
  assert.deepEqual(revenueRunsForPeriod([saved], [failed], saved), [failed]);
});

test("changing the selected period excludes stale pulls and does not substitute overlapping history", () => {
  const saved = run("saved", 100, "USD", "invoiced", "2026-07-08T00:00:00Z");
  const custom = { ...saved, id: "custom", periodStart: "2026-07-03", periodEnd: "2026-07-05" };
  assert.deepEqual(revenueRunsForPeriod([saved], [custom], saved), [saved]);
  assert.deepEqual(revenueRunsForPeriod([saved], [], custom), []);
  assert.deepEqual(revenueRunsForPeriod([saved], [custom], custom), [custom]);
});

test("the selected period keeps one latest result per rule, including separate rules for one company", () => {
  const saved = run("saved", 100, "USD", "invoiced", "2026-07-08T00:00:00Z");
  const latest = { ...saved, id: "latest", revenue: 120, createdAt: "2026-07-09T00:00:00Z" };
  const other = { ...saved, id: "other", partnerId: "other-rule" };
  assert.deepEqual(revenueRunsForPeriod([latest, saved, other], [], saved), [latest, other]);
});
