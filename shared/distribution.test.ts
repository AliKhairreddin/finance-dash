import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateProfitDistribution,
  profitDistributionAdjustmentFromPayload,
  shouldKeepProfitDistributionAdjustment
} from "./distribution";
import type { ProfitDistributionAdjustment, Transaction } from "./types";

function transaction(
  id: string,
  amount: number,
  currency: string,
  direction: Transaction["direction"],
  category: string,
  counterparty = "Operating activity",
  description = counterparty
): Transaction {
  return {
    id,
    source: "wise",
    accountName: `Wise ${currency}`,
    date: "2026-06-15",
    description,
    rawName: counterparty,
    counterparty,
    amount,
    currency,
    direction,
    status: "posted",
    category
  };
}

function monthLedger(snapshot: ReturnType<typeof calculateProfitDistribution>, currency: string) {
  const ledger = snapshot.months.find((item) => item.month === "2026-06" && item.currency === currency);
  assert.ok(ledger, `Expected a 2026-06 ${currency} ledger`);
  return ledger;
}

test("calculateProfitDistribution keeps revenue and distributions isolated by currency", () => {
  const snapshot = calculateProfitDistribution(
    [
      transaction("usd-revenue", 100_000, "USD", "in", "Revenue", "Kissterra"),
      transaction("usd-cost", 20_000, "USD", "out", "Subscription", "Cloudflare"),
      transaction("cad-revenue", 50_000, "CAD", "in", "Revenue", "Lead Economy")
    ],
    []
  );

  const usd = monthLedger(snapshot, "USD");
  const cad = monthLedger(snapshot, "CAD");
  const eur = monthLedger(snapshot, "EUR");

  assert.equal(usd.netProfitAfterGeneralCosts, 80_000);
  assert.equal(usd.ishanProfitShare, 20_000);
  assert.equal(usd.salaryDeductions, 0);
  assert.equal(usd.distributionPool, 60_000);
  assert.equal(usd.partners.find((partner) => partner.partnerId === "ishan")?.totalPayable, 50_000);
  assert.equal(usd.partners.find((partner) => partner.partnerId === "ben")?.distributionPayable, 10_000);

  assert.equal(cad.revenue, 50_000);
  assert.equal(cad.ishanProfitShare, 12_500);
  assert.equal(cad.distributionPool, 37_500);

  assert.equal(eur.revenue, 0);
  assert.equal(eur.salaryDeductions, 30_000);
  assert.equal(eur.partners.find((partner) => partner.partnerId === "ben")?.salaryPayable, 10_000);
});

test("calculateProfitDistribution applies adjustments and recognizes recorded partner payments", () => {
  const updatedAt = "2026-07-11T00:00:00.000Z";
  const adjustments: ProfitDistributionAdjustment[] = [
    profitDistributionAdjustmentFromPayload(
      {
        month: "2026-06",
        currency: "EUR",
        partnerId: "sanjan",
        bucket: "salary",
        waived: true,
        deferred: false
      },
      updatedAt
    ),
    profitDistributionAdjustmentFromPayload(
      {
        month: "2026-06",
        currency: "EUR",
        partnerId: "ishan",
        bucket: "distribution",
        waived: false,
        deferred: true,
        overrideAmount: 1_000,
        note: "Hold until approved"
      },
      updatedAt
    )
  ];

  const snapshot = calculateProfitDistribution(
    [
      transaction("eur-revenue", 100_000, "EUR", "in", "Revenue", "Kissterra"),
      transaction("eur-cost", 10_000, "EUR", "out", "Subscription", "Cloudflare"),
      transaction("ben-salary", 3_000, "EUR", "out", "Salary and payroll", "Ben"),
      transaction("ishan-share", 5_000, "EUR", "out", "Partner payout", "Ishan", "Ishan 25% profit share"),
      transaction("amin-distribution", 1_000, "EUR", "out", "Distribution", "Amin")
    ],
    adjustments
  );

  const eur = monthLedger(snapshot, "EUR");
  const ishan = eur.partners.find((partner) => partner.partnerId === "ishan");
  const ben = eur.partners.find((partner) => partner.partnerId === "ben");
  const sanjan = eur.partners.find((partner) => partner.partnerId === "sanjan");
  const amin = eur.partners.find((partner) => partner.partnerId === "amin");

  assert.equal(eur.netProfitAfterGeneralCosts, 90_000);
  assert.equal(eur.ishanProfitShare, 22_500);
  assert.equal(eur.salaryDeductions, 20_000);
  assert.equal(eur.distributionPool, 47_500);
  assert.equal(ishan?.distributionPayable, 1_000);
  assert.equal(ishan?.profitSharePaid, 5_000);
  assert.equal(ishan?.hasDeferred, true);
  assert.equal(ben?.salaryPaid, 3_000);
  assert.equal(sanjan?.salaryPayable, 0);
  assert.equal(sanjan?.hasAdjustment, true);
  assert.equal(amin?.distributionPaid, 1_000);
});

test("distribution adjustments normalize inputs and omit empty records", () => {
  const adjustment = profitDistributionAdjustmentFromPayload(
    {
      month: " 2026-06 ",
      currency: " eur ",
      partnerId: "ben",
      bucket: "salary",
      waived: false,
      deferred: false,
      overrideAmount: -50,
      note: "  manual correction  "
    },
    "2026-07-11T00:00:00.000Z"
  );

  assert.equal(adjustment.month, "2026-06");
  assert.equal(adjustment.currency, "EUR");
  assert.equal(adjustment.overrideAmount, 0);
  assert.equal(adjustment.note, "manual correction");
  assert.equal(shouldKeepProfitDistributionAdjustment(adjustment), true);
  assert.equal(
    shouldKeepProfitDistributionAdjustment({ ...adjustment, overrideAmount: undefined, note: undefined }),
    false
  );
});
