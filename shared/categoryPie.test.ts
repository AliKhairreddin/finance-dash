import assert from "node:assert/strict";
import test from "node:test";
import { analyticsCategoryPieGroups, categoryDonutSegmentPath } from "./categoryPie";
import type { BankAnalyticsCategoryBreakdown } from "./types";

function categoryRow(
  category: string,
  moneyOut: Record<string, number>,
  moneyOutTransactionCounts: Record<string, number>
): BankAnalyticsCategoryBreakdown {
  const count = Object.values(moneyOutTransactionCounts).reduce((sum, value) => sum + value, 0);
  return {
    category,
    transactionCount: count,
    moneyInTransactionCount: 0,
    moneyOutTransactionCount: count,
    matchedTransactionCount: 0,
    needsReviewCount: 0,
    moneyIn: {},
    moneyOut,
    moneyInTransactionCounts: {},
    moneyOutTransactionCounts
  };
}

test("analytics pie groups keep every positive slice inspectable and sorted", () => {
  const groups = analyticsCategoryPieGroups([
    categoryRow("Software", { usd: 25 }, { usd: 2 }),
    categoryRow("Travel", { USD: 100, CAD: 10 }, { USD: 3, CAD: 1 }),
    categoryRow("Fees", { USD: 0 }, { USD: 1 })
  ], "out");

  assert.equal(groups.length, 2);
  assert.equal(groups[0].currency, "USD");
  assert.equal(groups[0].total, 125);
  assert.deepEqual(
    groups[0].segments.map(({ category, amount, count }) => ({ category, amount, count })),
    [
      { category: "Travel", amount: 100, count: 3 },
      { category: "Software", amount: 25, count: 2 }
    ]
  );
  assert.equal(groups[1].currency, "CAD");
});

test("analytics pie groups merge duplicate category rows and reject invalid amounts", () => {
  const groups = analyticsCategoryPieGroups([
    categoryRow("Software", { USD: 40 }, { USD: 2 }),
    categoryRow("Software", { USD: 10 }, { USD: 1 }),
    categoryRow("Invalid", { USD: Number.NaN }, { USD: 1 }),
    categoryRow("", { USD: 99 }, { USD: 1 })
  ], "out");

  assert.equal(groups.length, 1);
  assert.equal(groups[0].total, 50);
  assert.deepEqual(
    groups[0].segments.map(({ category, amount, count }) => ({ category, amount, count })),
    [{ category: "Software", amount: 50, count: 3 }]
  );
});

test("donut segment paths stay finite for partial and full-circle slices", () => {
  const partial = categoryDonutSegmentPath(0, 90);
  const full = categoryDonutSegmentPath(0, 360);

  assert.match(partial, /^M /);
  assert.match(full, /^M /);
  assert.equal(partial.includes("NaN"), false);
  assert.equal(full.includes("NaN"), false);
  assert.equal((full.match(/ A /g) ?? []).length, 4);
});
