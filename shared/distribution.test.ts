import assert from "node:assert/strict";
import test from "node:test";
import {
  addProfitDistributionFactPage,
  addProfitDistributionTransactionPage,
  calculateProfitDistribution,
  calculateProfitDistributionFromFacts,
  createProfitDistributionAccumulator,
  finalizeProfitDistribution,
  profitDistributionAdjustmentFromPayload,
  profitDistributionContribution,
  profitDistributionContributionVersion,
  shouldKeepProfitDistributionAdjustment
} from "./distribution";
import type { ProfitDistributionFact } from "./distribution";
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

test("streaming profit distribution matches one-shot calculation across bounded pages", () => {
  const transactions = [
    transaction("usd-revenue", 100_000, "USD", "in", "Revenue", "Kissterra"),
    transaction("usd-cost", 20_000, "USD", "out", "Subscription", "Cloudflare"),
    transaction("eur-revenue", 70_000, "EUR", "in", "Revenue", "Lead Economy"),
    transaction("ben-salary", 3_000, "EUR", "out", "Salary and payroll", "Ben"),
    transaction("ishan-share", 5_000, "EUR", "out", "Partner payout", "Ishan", "Ishan 25% profit share"),
    transaction("amin-distribution", 1_000, "EUR", "out", "Distribution", "Amin")
  ];
  const adjustments = [
    profitDistributionAdjustmentFromPayload(
      {
        month: "2026-06",
        currency: "EUR",
        partnerId: "sanjan",
        bucket: "salary",
        waived: true,
        deferred: false
      },
      "2026-07-11T00:00:00.000Z"
    )
  ];

  const accumulator = createProfitDistributionAccumulator();
  addProfitDistributionTransactionPage(accumulator, transactions.slice(0, 2));
  addProfitDistributionTransactionPage(accumulator, transactions.slice(2, 5));
  addProfitDistributionTransactionPage(accumulator, transactions.slice(5));

  assert.deepEqual(
    finalizeProfitDistribution(accumulator, adjustments),
    calculateProfitDistribution(transactions, adjustments)
  );
  assert.equal("transactions" in accumulator, false);
  assert.equal(Object.values(accumulator).some(Array.isArray), false);
});

test("streaming profit distribution assumes transaction pages are duplicate-free", () => {
  const revenue = transaction("usd-revenue", 100_000, "USD", "in", "Revenue", "Kissterra");
  const accumulator = createProfitDistributionAccumulator();

  addProfitDistributionTransactionPage(accumulator, [revenue]);
  addProfitDistributionTransactionPage(accumulator, [revenue]);

  const streamed = monthLedger(finalizeProfitDistribution(accumulator, []), "USD");
  const oneShot = monthLedger(calculateProfitDistribution([revenue], []), "USD");
  assert.equal(streamed.revenue, 200_000);
  assert.equal(oneShot.revenue, 100_000);
});

test("streaming profit distribution matches empty and adjustment-only calculations", () => {
  const emptyAccumulator = createProfitDistributionAccumulator();
  assert.deepEqual(finalizeProfitDistribution(emptyAccumulator, []), calculateProfitDistribution([], []));

  const adjustments = [
    profitDistributionAdjustmentFromPayload(
      {
        month: "2026-03",
        currency: "CAD",
        partnerId: "ishan",
        bucket: "distribution",
        waived: false,
        deferred: true,
        overrideAmount: 1_250
      },
      "2026-07-11T00:00:00.000Z"
    )
  ];
  const adjustmentAccumulator = createProfitDistributionAccumulator();
  assert.deepEqual(
    finalizeProfitDistribution(adjustmentAccumulator, adjustments),
    calculateProfitDistribution([], adjustments)
  );
  assert.equal(adjustmentAccumulator.monthCurrencies.size, 0);
});

test("transaction contributions capture only the immutable distribution inputs", () => {
  assert.deepEqual(
    profitDistributionContribution(transaction("revenue", 12_500, "usd", "in", "Revenue")),
    {
      version: profitDistributionContributionVersion,
      month: "2026-06",
      currency: "USD",
      transactionCount: 1,
      revenue: 12_500,
      generalCosts: 0,
      payments: []
    }
  );
  assert.deepEqual(
    profitDistributionContribution(transaction("cost", 900, "USD", "out", "Subscription", "Cloudflare")),
    {
      version: profitDistributionContributionVersion,
      month: "2026-06",
      currency: "USD",
      transactionCount: 1,
      revenue: 0,
      generalCosts: 900,
      payments: []
    }
  );
  assert.deepEqual(
    profitDistributionContribution(transaction("salary", 3_000, "EUR", "out", "Salary and payroll", "Ben")),
    {
      version: profitDistributionContributionVersion,
      month: "2026-06",
      currency: "EUR",
      transactionCount: 1,
      revenue: 0,
      generalCosts: 0,
      payments: [{ partnerId: "ben", bucket: "salary", amount: 3_000 }]
    }
  );
  assert.deepEqual(
    profitDistributionContribution(transaction("transfer", 1_000, "EUR", "out", "Internal transfer")),
    {
      version: profitDistributionContributionVersion,
      month: "2026-06",
      currency: "EUR",
      transactionCount: 1,
      revenue: 0,
      generalCosts: 0,
      payments: []
    }
  );
  assert.deepEqual(
    profitDistributionContribution({
      ...transaction("voided-revenue", 50_000, "USD", "in", "Revenue"),
      status: "voided"
    }),
    {
      version: profitDistributionContributionVersion,
      month: "2026-06",
      currency: "USD",
      transactionCount: 0,
      revenue: 0,
      generalCosts: 0,
      payments: []
    }
  );
});

test("compact monthly facts reproduce the transaction-backed distribution exactly", () => {
  const transactions = [
    transaction("revenue", 100_000, "USD", "in", "Revenue", "Kissterra"),
    transaction("cost", 20_000, "USD", "out", "Subscription", "Cloudflare"),
    transaction("transfer", 4_000, "USD", "out", "Internal transfer", "Wise transfer"),
    { ...transaction("voided-revenue", 500_000, "USD", "in", "Revenue"), status: "voided" as const },
    transaction("eur-revenue", 70_000, "EUR", "in", "Revenue", "Lead Economy"),
    transaction("ben-salary", 3_000, "EUR", "out", "Salary and payroll", "Ben"),
    transaction("ishan-share", 5_000, "EUR", "out", "Partner payout", "Ishan", "Ishan 25% profit share")
  ];
  const factsByKey = new Map<string, ProfitDistributionFact>();
  for (const contribution of transactions.map(profitDistributionContribution)) {
    const key = `${contribution.month}:${contribution.currency}`;
    const fact = factsByKey.get(key) ?? {
      version: profitDistributionContributionVersion,
      month: contribution.month,
      currency: contribution.currency,
      transactionCount: 0,
      revenue: 0,
      generalCosts: 0,
      payments: []
    };
    fact.transactionCount += contribution.transactionCount;
    fact.revenue += contribution.revenue;
    fact.generalCosts += contribution.generalCosts;
    for (const contributionPayment of contribution.payments) {
      const payment = fact.payments.find((item) =>
        item.partnerId === contributionPayment.partnerId && item.bucket === contributionPayment.bucket
      );
      if (payment) payment.amount += contributionPayment.amount;
      else fact.payments.push({ ...contributionPayment });
    }
    factsByKey.set(key, fact);
  }

  const facts = [...factsByKey.values()];
  assert.deepEqual(
    calculateProfitDistributionFromFacts(facts, []),
    calculateProfitDistribution(transactions, [])
  );

  const accumulator = createProfitDistributionAccumulator();
  addProfitDistributionFactPage(accumulator, facts.slice(0, 1));
  addProfitDistributionFactPage(accumulator, facts.slice(1));
  assert.deepEqual(finalizeProfitDistribution(accumulator, []), calculateProfitDistribution(transactions, []));
});
