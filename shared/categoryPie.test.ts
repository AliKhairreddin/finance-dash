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

test("analytics pie groups convert currencies into one USD chart and preserve native totals", () => {
  const groups = analyticsCategoryPieGroups([
    categoryRow("Software", { usd: 25 }, { usd: 2 }),
    categoryRow("Travel", { USD: 100, CAD: 10 }, { USD: 3, CAD: 1 }),
    categoryRow("Fees", { USD: 0 }, { USD: 1 })
  ], [{ asset: "CAD", rateUsd: 0.75, provider: "coinbase", asOf: "2026-08-11T00:00:00.000Z" }]);

  assert.equal(groups.in, null);
  assert.equal(groups.out?.currency, "USD");
  assert.equal(groups.out?.total, 132.5);
  assert.deepEqual(groups.out?.nativeTotals, { USD: 125, CAD: 10 });
  assert.deepEqual(
    groups.out?.segments.map(({ category, amount, count, nativeTotals }) => ({ category, amount, count, nativeTotals })),
    [
      { category: "Travel", amount: 107.5, count: 4, nativeTotals: { USD: 100, CAD: 10 } },
      { category: "Software", amount: 25, count: 2, nativeTotals: { USD: 25 } }
    ]
  );
});

test("analytics pie groups merge duplicate category rows and group the long tail", () => {
  const groups = analyticsCategoryPieGroups([
    categoryRow("Software", { USD: 40 }, { USD: 2 }),
    categoryRow("Software", { USD: 10 }, { USD: 1 }),
    categoryRow("Travel", { USD: 20 }, { USD: 1 }),
    categoryRow("Invalid", { USD: Number.NaN }, { USD: 1 }),
    categoryRow("", { USD: 99 }, { USD: 1 })
  ], [], 1);

  assert.equal(groups.out?.total, 70);
  assert.deepEqual(
    groups.out?.segments.map(({ category, categories, amount, count }) => ({ category, categories, amount, count })),
    [
      { category: "Software", categories: ["Software"], amount: 50, count: 3 },
      { category: "Other", categories: ["Travel"], amount: 20, count: 1 }
    ]
  );
});

test("shared categories keep the same color while each chart stays distinct", () => {
  const inbound = categoryRow("Shared", {}, {});
  inbound.moneyIn = { USD: 80 };
  inbound.moneyInTransactionCounts = { USD: 1 };
  inbound.moneyInTransactionCount = 1;
  const inboundOnly = categoryRow("Revenue only", {}, {});
  inboundOnly.moneyIn = { USD: 20 };
  inboundOnly.moneyInTransactionCounts = { USD: 1 };
  inboundOnly.moneyInTransactionCount = 1;
  const groups = analyticsCategoryPieGroups([
    inbound,
    inboundOnly,
    categoryRow("Shared", { USD: 70 }, { USD: 1 }),
    categoryRow("Spend only", { USD: 30 }, { USD: 1 })
  ], []);

  const sharedIn = groups.in?.segments.find((segment) => segment.category === "Shared");
  const sharedOut = groups.out?.segments.find((segment) => segment.category === "Shared");
  assert.equal(sharedIn?.color, sharedOut?.color);
  assert.notEqual(sharedOut?.color, groups.out?.segments.find((segment) => segment.category === "Spend only")?.color);
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
