import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateAnalyticsCategoryCompanies,
  analyticsCategoryCompanyIdentity
} from "./categoryCompanies";
import type { Transaction } from "./types";

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "tx-1",
    source: "slash",
    accountName: "Operating",
    date: "2026-07-15",
    description: "OPENAI",
    rawName: "OPENAI",
    counterparty: "OpenAI",
    amount: 20,
    currency: "USD",
    direction: "out",
    status: "posted",
    category: "Software",
    ...overrides
  };
}

test("category company identity prefers a matched provider", () => {
  assert.deepEqual(
    analyticsCategoryCompanyIdentity(transaction({ matchedProviderId: "provider-openai" })),
    {
      companyKey: "provider:provider-openai",
      providerId: "provider-openai",
      merchantName: "OpenAI"
    }
  );
});

test("category company aggregation merges merchants and filters the selected slice", () => {
  const rows = aggregateAnalyticsCategoryCompanies([
    transaction({ id: "tx-1", merchantKey: "openai", amount: 20 }),
    transaction({ id: "tx-2", merchantKey: "openai", amount: 30 }),
    transaction({ id: "tx-3", merchantName: "Figma", counterparty: "Figma", amount: 10 }),
    transaction({ id: "tx-4", category: "Travel", amount: 500 }),
    transaction({ id: "tx-5", status: "pending", amount: 500 })
  ], {
    fromDate: "2026-07-01",
    toDate: "2026-07-31",
    direction: "out",
    currency: "USD",
    category: "Software"
  });

  assert.deepEqual(rows, [
    { companyKey: "merchant:openai", merchantName: "OpenAI", amount: 50, transactionCount: 2 },
    { companyKey: "merchant:figma", merchantName: "Figma", amount: 10, transactionCount: 1 }
  ]);
});

test("Uncategorized includes review-only stored categories", () => {
  const rows = aggregateAnalyticsCategoryCompanies([
    transaction({ category: "5734", merchantName: "Legacy merchant" })
  ], {
    fromDate: "2026-07-01",
    toDate: "2026-07-31",
    direction: "out",
    currency: "USD",
    category: "Uncategorized"
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].merchantName, "Legacy merchant");
});
