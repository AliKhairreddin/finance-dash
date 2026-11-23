import assert from "node:assert/strict";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const url = new URL(process.env.TEST_CONVEX_URL!);
assert.equal(url.hostname, "127.0.0.1");
const client = new ConvexHttpClient(url.origin);
const insert = makeFunctionReference<"mutation">("fixtures:insert");
const date = "2026-01-30";
const partner = {
  id: "publisher", name: "Test publisher", source: "tune", affiliateId: "affiliate", currency: "USD",
  timezone: "UTC", networkTimezone: "UTC", networkIdEnv: "TEST_NETWORK", apiKeyEnv: "TEST_KEY",
  invoiceDueDays: 30, enabled: true, createdAt: date
};
const run = {
  id: "january", partnerId: "publisher", partnerName: "Test publisher", source: "tune",
  periodStart: "2026-01-01", periodEnd: date, timezone: "UTC", revenue: 127.25,
  currency: "USD", status: "pulled", createdAt: date
};
const transaction = {
  id: "payment", source: "wise", accountName: "USD balance", date, description: "Fixture debit",
  rawName: "payment", counterparty: "Test merchant", amount: 12, currency: "USD",
  direction: "out", status: "posted", category: "fixture", cardHolderName: "Fixture cardholder"
};
const controls = [
  ["370ade8", "providerId", { revenuePartners: [{ ...partner, providerId: "company" }] }],
  ["54a79e0", "revenueCategory", { revenuePartners: [{ ...partner, revenueCategory: "subscriptions" }] }],
  ["92c29a9", "teamId", { revenuePartners: [{ ...partner, teamId: "team" }] }],
  ["7ce4bbb", "providerId", { revenueRuns: [{ ...run, providerId: "company" }] }],
  ["7ce4bbb", "revenueCategory", { revenueRuns: [{ ...run, revenueCategory: "subscriptions" }] }],
  ["e1e9133", "cardHolderName", { wiseStatementTransactions: [transaction] }],
  ["d54429e", "profitDistributionAdjustments", { profitDistributionAdjustments: [{ overrideAmount: 42.25 }] }],
  ["3d25c1c", "wiseCardHolderTeamAssignments", { wiseCardHolderTeamAssignments: [{ cardHolderName: "Fixture cardholder", teamId: "team", updatedAt: date }] }]
] as const;
for (const [fix, field, record] of controls) {
  const data = { key: "default", invoices: [], providers: [], updatedAt: date, ...record };
  await assert.rejects(
    client.mutation(insert, { table: `before_${fix}`, data }),
    new RegExp("extra field `" + field + "`"),
    `Pre-fix schema must reject ${field}`
  );
  await client.mutation(insert, { table: `after_${fix}`, data });
  console.log(`${fix}: the original parent rejected ${field} and the corrected schema stored it.`);
}
