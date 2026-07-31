import assert from "node:assert/strict";
import test from "node:test";
import { bankAnalyticsLimits, createBankAnalyticsAccumulator } from "./analytics";
import type { Transaction } from "./types";

function transaction(
  id: string,
  overrides: Partial<Transaction> = {}
): Transaction {
  return {
    id,
    source: "revolut",
    accountName: "Operating",
    date: "2026-07-15",
    description: id,
    rawName: id,
    counterparty: id,
    amount: 10,
    currency: "USD",
    direction: "out",
    status: "posted",
    category: "Software subscription",
    ...overrides
  };
}

test("streaming bank Analytics preserves exact headline and bounded-dimension totals", () => {
  const accumulator = createBankAnalyticsAccumulator({
    fromDate: "2026-07-01",
    toDate: "2026-07-31",
    providers: [
      { id: "client-1", name: "Client One", type: "client" },
      { id: "supplier-1", name: "Supplier One", type: "supplier" }
    ],
    teams: [
      { id: "growth", name: "Growth" },
      { id: "ops", name: "Operations" }
    ]
  });

  accumulator.addPage([
    transaction("revenue-usd", {
      source: "revolut",
      amount: 100,
      direction: "in",
      category: "Revenue",
      matchedProviderId: "client-1",
      teamId: "growth"
    }),
    transaction("software-usd", {
      source: "slash",
      amount: 40,
      category: "Subscription",
      matchedProviderId: "supplier-1",
      teamId: "ops"
    })
  ]);
  accumulator.addPage([
    transaction("review-eur", {
      source: "wise",
      amount: 25,
      currency: "EUR",
      category: "Uncategorized",
      merchantName: "Mystery Merchant",
      categoryReason: "Classification pending"
    }),
    transaction("internal", {
      source: "amex",
      amount: 500,
      category: "Internal transfer"
    }),
    transaction("revenue-eur", {
      source: "wise",
      amount: 75,
      currency: "EUR",
      direction: "in",
      category: "Partner network revenue",
      matchedProviderId: "client-1",
      teamId: "growth"
    })
  ]);

  const snapshot = accumulator.finish("2026-07-31T20:00:00.000Z");

  assert.deepEqual(snapshot.summary, {
    transactionCount: 5,
    externalTransactionCount: 4,
    internalTransferCount: 1,
    matchedTransactionCount: 3,
    needsReviewCount: 1,
    activeTeamCount: 2,
    activeSourceCount: 4,
    moneyIn: { EUR: 75, USD: 100 },
    moneyOut: { EUR: 25, USD: 40 }
  });
  assert.deepEqual(
    snapshot.categories.map((row) => [row.category, row.transactionCount, row.moneyIn, row.moneyOut]),
    [
      ["Media buying direct", 1, { USD: 100 }, {}],
      ["Partner network revenue", 1, { EUR: 75 }, {}],
      ["Software subscription", 1, {}, { USD: 40 }],
      ["Uncategorized", 1, {}, { EUR: 25 }]
    ]
  );
  assert.deepEqual(
    snapshot.teams.map((row) => [row.teamName, row.transactionCount]),
    [["Growth", 2], ["Operations", 1], ["Unassigned", 1]]
  );
  assert.deepEqual(
    snapshot.sources.map((row) => [row.source, row.transactionCount]),
    [["revolut", 1], ["slash", 1], ["wise", 2]]
  );
  assert.deepEqual(
    snapshot.providers.map((row) => [row.providerName, row.relationship, row.transactionCount]),
    [["Client One", "client", 2], ["Supplier One", "supplier", 1]]
  );
  assert.deepEqual(
    snapshot.relationships.map((row) => [row.relationship, row.transactionCount]),
    [["client", 2], ["supplier", 1], ["unknown", 1]]
  );
  assert.deepEqual(snapshot.reviewSamples, [{
    id: "review-eur",
    date: "2026-07-15",
    direction: "out",
    amount: 25,
    currency: "EUR",
    company: "Mystery Merchant",
    category: "Uncategorized",
    reason: "Classification pending"
  }]);
  assert.equal(snapshot.unmatchedMerchants.rows.length, 1);
  assert.equal(snapshot.unmatchedMerchants.rows[0]?.transactionCount, 1);
  assert.equal(snapshot.unmatchedMerchants.other, null);
});

test("streaming bank Analytics excludes voided tombstones from every aggregate", () => {
  const accumulator = createBankAnalyticsAccumulator({
    fromDate: "2026-07-01",
    toDate: "2026-07-31",
    providers: [],
    teams: []
  });

  accumulator.addPage([
    transaction("posted", { amount: 25, direction: "in", category: "Revenue" }),
    transaction("voided", {
      source: "slash",
      status: "voided",
      amount: 10_000,
      direction: "in",
      category: "Uncategorized"
    })
  ]);

  const snapshot = accumulator.finish("2026-07-31T20:00:00.000Z");
  assert.deepEqual(snapshot.summary, {
    transactionCount: 1,
    externalTransactionCount: 1,
    internalTransferCount: 0,
    matchedTransactionCount: 0,
    needsReviewCount: 0,
    activeTeamCount: 0,
    activeSourceCount: 1,
    moneyIn: { USD: 25 },
    moneyOut: {}
  });
  assert.deepEqual(snapshot.sources.map((row) => row.source), ["revolut"]);
  assert.deepEqual(snapshot.reviewSamples, []);
});

test("unmatched merchant cardinality and snapshot payload stay hard-bounded", () => {
  const accumulator = createBankAnalyticsAccumulator({
    fromDate: "2026-07-01",
    toDate: "2026-07-31",
    providers: [],
    teams: [],
    unmatchedMerchantRowLimit: 3,
    reviewSampleLimit: 2
  });

  for (let pageStart = 0; pageStart < 10_000; pageStart += 200) {
    accumulator.addPage(
      Array.from({ length: 200 }, (_, offset) => {
        const index = pageStart + offset;
        return transaction(`merchant-${index}`, {
          merchantName: `Merchant ${index}`,
          merchantKey: `merchant-${index}`,
          amount: 1,
          category: index < 100 ? "Uncategorized" : "Software subscription"
        });
      })
    );
  }

  const serializedState = accumulator.serialize();
  assert.equal(serializedState.merchantCandidates.length, 3);
  assert.ok(new TextEncoder().encode(JSON.stringify(serializedState)).byteLength <= bankAnalyticsLimits.serializedStateBytes);
  const snapshot = accumulator.finish("2026-07-31T20:00:00.000Z");
  const retainedCount = snapshot.unmatchedMerchants.rows.reduce(
    (sum, row) => sum + row.transactionCount,
    0
  );

  assert.equal(snapshot.summary.transactionCount, 10_000);
  assert.deepEqual(snapshot.summary.moneyOut, { USD: 10_000 });
  assert.equal(snapshot.summary.needsReviewCount, 100);
  assert.equal(snapshot.reviewSamples.length, 2);
  assert.equal(snapshot.unmatchedMerchants.rows.length, 3);
  assert.equal(snapshot.unmatchedMerchants.truncated, true);
  assert.ok(snapshot.unmatchedMerchants.evictedCandidateCount > 0);
  assert.ok(snapshot.unmatchedMerchants.other);
  assert.equal(
    retainedCount + (snapshot.unmatchedMerchants.other?.transactionCount ?? 0),
    snapshot.summary.externalTransactionCount
  );
  assert.ok(JSON.stringify(snapshot).length < 15_000);
});

test("serialized Analytics progress resumes to the exact one-shot snapshot", () => {
  const options = {
    fromDate: "2026-07-01",
    toDate: "2026-07-31",
    providers: [{ id: "provider-1", name: "Provider One", type: "supplier" as const }],
    teams: [{ id: "ops", name: "Operations" }],
    unmatchedMerchantRowLimit: 3,
    reviewSampleLimit: 2
  };
  const transactions = Array.from({ length: 80 }, (_, index) => transaction(`resume-${index}`, {
    source: index % 2 === 0 ? "revolut" : "wise",
    merchantName: index % 5 === 0 ? "Recurring Merchant" : `Merchant ${index}`,
    merchantKey: index % 5 === 0 ? "recurring-merchant" : `merchant-${index}`,
    amount: index + 0.25,
    currency: index % 3 === 0 ? "EUR" : "USD",
    direction: index % 4 === 0 ? "in" : "out",
    category: index % 13 === 0 ? "Uncategorized" : "Software subscription",
    ...(index % 9 === 0 ? { matchedProviderId: "provider-1" } : {}),
    ...(index % 4 === 0 ? { teamId: "ops" } : {})
  }));
  transactions.splice(37, 0, transaction("resume-internal", {
    source: "amex",
    amount: 999,
    category: "Internal transfer"
  }));

  const oneShot = createBankAnalyticsAccumulator(options);
  oneShot.addPage(transactions);

  const firstInvocation = createBankAnalyticsAccumulator(options);
  firstInvocation.addPage(transactions.slice(0, 37));
  const persistedState = JSON.parse(JSON.stringify(firstInvocation.serialize()));
  const resumed = createBankAnalyticsAccumulator({ ...options, state: persistedState });
  resumed.addPage(transactions.slice(37, 61));
  const secondState = JSON.parse(JSON.stringify(resumed.serialize()));
  const resumedAgain = createBankAnalyticsAccumulator({ ...options, state: secondState });
  resumedAgain.addPage(transactions.slice(61));

  const generatedAt = "2026-07-31T20:00:00.000Z";
  assert.deepEqual(resumedAgain.finish(generatedAt), oneShot.finish(generatedAt));
  assert.throws(
    () => createBankAnalyticsAccumulator({
      ...options,
      teams: [{ id: "ops", name: "Renamed Operations" }],
      state: persistedState
    }),
    /does not match the requested configuration/
  );
});
