import assert from "node:assert/strict";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { ProfitDistributionAdjustment, RevenuePartner, RevenueRun, WiseCardHolderTeamAssignment } from "../../shared/types";

const url = new URL(process.env.TEST_CONVEX_URL!);
assert.equal(url.hostname, "127.0.0.1");
const client = new ConvexHttpClient(url.origin);
const serviceToken = process.env.TEST_SERVICE_TOKEN!;
const date = "2026-01-30";
const partner: RevenuePartner = {
  id: "publisher", providerId: "company", teamId: "team", revenueCategory: "subscriptions",
  name: "Test publisher", source: "tune", affiliateId: "affiliate", currency: "USD",
  timezone: "UTC", networkTimezone: "UTC", networkIdEnv: "TEST_NETWORK", apiKeyEnv: "TEST_KEY",
  invoiceDueDays: 30, billingCadence: "monthly", billingTimezone: "UTC", autoDraft: false,
  enabled: true, createdAt: date
};
const run: RevenueRun = {
  id: "january", partnerId: partner.id, providerId: partner.providerId, partnerName: partner.name,
  revenueCategory: partner.revenueCategory, source: "tune", periodStart: "2026-01-01", periodEnd: date,
  timezone: "UTC", revenue: 127.25, currency: "USD", status: "pulled", createdAt: date
};
const assignment: WiseCardHolderTeamAssignment = { cardHolderName: "Fixture cardholder", teamId: "team", updatedAt: date };
const adjustment: ProfitDistributionAdjustment = {
  id: "adjustment", month: "2026-01", currency: "USD", partnerId: "ben", bucket: "salary",
  waived: false, deferred: false, overrideAmount: 42.25, updatedAt: date
};
const data = {
  providers: [], invoices: [], expenses: [], manualReceivables: [], teams: [],
  transactionCategoryRules: [], revenuePartners: [partner], wiseCardHolderTeamAssignments: [assignment],
  wiseStatementImports: [], revenueRuns: [run], revenueAccruals: [], paymentAllocations: [],
  holdings: [], fxRates: [], automationRuns: [], profitDistributionAdjustments: [adjustment]
};
const saved = await client.mutation(api.dashboard.saveState, { ...data, expectedUpdatedAt: null, serviceToken });
const stored = await client.query(api.dashboard.getState, { serviceToken });
assert.ok(stored);
assert.equal(stored.updatedAt, saved.updatedAt);
assert.deepEqual(stored.revenuePartners, [partner]);
assert.deepEqual(stored.revenueRuns, [run]);
assert.deepEqual(stored.profitDistributionAdjustments, [adjustment]);
assert.deepEqual(stored.wiseCardHolderTeamAssignments, [assignment]);
console.log("Dashboard writes and reads retained the revenue metadata, profit adjustment and cardholder assignment.");
