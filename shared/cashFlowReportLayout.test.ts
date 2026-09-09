import assert from "node:assert/strict";
import test from "node:test";
import { packCashFlowReportCards, splitCashFlowReportRows } from "./cashFlowReportLayout";
import { planCashFlowPng } from "../src/features/cash-flow/exportCashFlowPng";
import { cashFlowSections, cashFlowUsdTotal } from "./cashFlowReport";
import type { CashFlowLine, CashFlowSnapshot, FxRate } from "./types";

test("packing reserves space for charts beside tall cards without overlap", () => {
  const result = packCashFlowReportCards([
    { id: "long", height: 1000, span: 1, preferRight: true },
    { id: "cash", height: 350, span: 1 }, { id: "receivables", height: 350, span: 1 },
    { id: "trend", height: 500, span: 2 }, { id: "small", height: 150, span: 1 }
  ], 3, 760, 28);
  assert.equal(result.placements[0].column, 2);
  const trend = result.placements.find(card => card.id === "trend")!;
  assert.equal(trend.y, 378);
  assert.equal(trend.height, 500);
  for (const a of result.placements) for (const b of result.placements) {
    if (a.id === b.id) continue;
    assert.ok(a.column + a.span <= b.column || b.column + b.span <= a.column || a.y + a.height <= b.y || b.y + b.height <= a.y);
  }
});

test("continuation cards preserve row order and avoid a nearly empty final part", () => {
  const rows = Array.from({ length: 26 }, (_, index) => index);
  const parts = splitCashFlowReportRows(rows, 1000, values => 100 + values.length * 36);
  assert.deepEqual(parts.flat(), rows);
  assert.deepEqual(parts.map(part => part.length), [13, 13]);
  assert.deepEqual(splitCashFlowReportRows([], 1000, () => 100), [[]]);
});

const row = (id: string, name = id): CashFlowLine => ({ id, name, amount: id.endsWith("0") ? -200 : 100, currency: "USD", excludedFromTotals: id.endsWith("3") });
const snapshot = (patch: Partial<CashFlowSnapshot> = {}): CashFlowSnapshot => ({
  id: "test", asOfDate: "2026-09-07", createdAt: "2026-09-07", updatedAt: "2026-09-07",
  cashAccounts: [], receivables: [], openBalances: [], payables: [], investments: [], ...patch
});
// Deterministic text metrics exercise layout invariants; real font rendering is
// separately checked using the browser-generated PNGs.
const context = { font: "", measureText: (value: string) => ({ width: value.length * 10 }) } as CanvasRenderingContext2D;

test("cash export converts and consolidates each provider while keeping Wise entities and source details separate", () => {
  const cashAccounts: CashFlowLine[] = [
    { id: "cash-flow-account-wise-1-1", name: "Digital nudge OÜ · Wise EUR", amount: 100, currency: "EUR", notes: "Operating reserve", formula: "=50+50" },
    { id: "cash-flow-account-wise-1-2", name: "Digital nudge OÜ · Wise USD", amount: 20, currency: "USD" },
    { id: "cash-flow-account-wise-1-3", name: "Digital nudge OÜ · Wise GBP", amount: -10, currency: "GBP" },
    { id: "cash-flow-account-wise-2-1", name: "LOVEMEDO B.V. · Wise USD", amount: 7, currency: "USD" },
    { id: "cash-flow-account-wise-2-2", name: "LOVEMEDO B.V. · Wise EUR", amount: 900, currency: "EUR", excludedFromTotals: true },
    { id: "cash-flow-account-revolut-eur", name: "Main", amount: 10, currency: "EUR" },
    { id: "cash-flow-account-revolut-usd", name: "WGNR", amount: 8, currency: "USD" },
    { id: "cash-flow-account-slash-cash", name: "Business Platinum Cash", amount: 15, currency: "USD" },
    { id: "manual-eur", name: "Kraken EUR", amount: 5, currency: "EUR" },
    { id: "manual-usd", name: "Kraken USD", amount: 4, currency: "USD" }
  ];
  const rates: FxRate[] = [
    { asset: "EUR", rateUsd: 1.2, provider: "coinbase", asOf: "2026-09-07" },
    { asset: "GBP", rateUsd: 1.3, provider: "coinbase", asOf: "2026-09-07" }
  ];
  const original = structuredClone(cashAccounts);
  const plan = planCashFlowPng(context, snapshot({ cashAccounts }), rates);
  const cash = plan.sections.filter(section => section.id.startsWith("cash:"));
  const rows = cash.flatMap(section => section.rows);
  assert.deepEqual(rows.map(row => [row.name, row.usd?.totalUsd]), [
    ["Wise DN", 127], ["Wise LMD", 7], ["Revolut", 20], ["Slash", 15], ["Kraken", 10]
  ]);
  assert.deepEqual(rows.flatMap(row => row.lines), cashAccounts);
  assert.equal(cash.reduce((sum, section) => sum + section.total, 0), 179);
  assert.deepEqual(cashAccounts, original);
  assert.ok(cash.every(section => section.usd));
});

test("cash export recognizes manual entity labels and keeps unrelated accounts separate", () => {
  const input = snapshot({ cashAccounts: [
    { ...row("a", "Wise · DN"), amount: 20 },
    { ...row("b", "Wise DN EUR"), amount: 10, currency: "EUR" },
    { ...row("c", "Wise LMD"), amount: 5 },
    row("d", "Slash"), row("e", "Slash cashback"), row("f", "Other treasury")
  ] });
  const plan = planCashFlowPng(context, input, [{ asset: "EUR", rateUsd: 1.2, provider: "coinbase", asOf: "2026-09-07" }]);
  const rows = plan.sections.filter(section => section.id.startsWith("cash:")).flatMap(section => section.rows);
  assert.deepEqual(rows.map(row => row.name), ["Wise DN", "Wise LMD", "Slash", "Slash cashback", "Other treasury"]);
  assert.equal(rows[0].usd?.totalUsd, 32);
});

test("cash export flags missing rates even for offsetting balances and excludes unchecked currencies", () => {
  const input = snapshot({ cashAccounts: [
    { ...row("a", "Wise DN"), amount: 20 },
    { ...row("b", "Wise DN EUR"), amount: 10, currency: "EUR" },
    { ...row("c", "Wise DN EUR"), amount: -10, currency: "EUR" },
    { ...row("d", "Wise DN GBP"), amount: 50, currency: "GBP", excludedFromTotals: true }
  ] });
  const plan = planCashFlowPng(context, input, []);
  const rows = plan.sections.filter(section => section.id.startsWith("cash:")).flatMap(section => section.rows);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].usd?.excludedCurrencies, ["EUR"]);
  assert.equal(rows[0].lines.length, 4);
});

for (const [name, input] of Object.entries({
  empty: snapshot(),
  "long open balances": snapshot({
    cashAccounts: Array.from({ length: 9 }, (_, index) => row(`cash-${index}`)),
    receivables: Array.from({ length: 9 }, (_, index) => row(`receivable-${index}`)),
    openBalances: Array.from({ length: 36 }, (_, index) => row(`open-${index}`, `Account ${index}-${index < 9 ? "wagner" : "cog"}`))
  }),
  "120 long-name rows": snapshot({
    cashAccounts: Array.from({ length: 60 }, (_, index) => row(`cash-${index}`, "Long treasury account ".repeat(9))),
    openBalances: Array.from({ length: 60 }, (_, index) => row(`open-${index}`, `${"Long advertising account ".repeat(7)}-cog`))
  })
})) {
  test(`${name}: portrait preserves all source rows, chart area, and subtotals`, () => {
    const plan = planCashFlowPng(context, input, []);
    assert.ok(plan.width < plan.height);
    const expected = cashFlowSections.flatMap(key => input[key]);
    const actual = plan.sections.flatMap(section => section.rows.flatMap(row => row.lines));
    assert.deepEqual(actual.map(item => item.id).sort(), expected.map(item => item.id).sort());
    assert.equal(plan.sections.reduce((sum, section) => sum + section.total, 0), cashFlowUsdTotal(expected, []));
    assert.ok(plan.placements.find(card => card.id === "trend")!.height >= 470);
    assert.ok(plan.placements.find(card => card.id === "composition")!.height >= 380);
    for (const a of plan.placements) {
      assert.ok(a.y + a.height + 416 < plan.height);
      for (const b of plan.placements) {
        if (a.id === b.id) continue;
        assert.ok(a.column + a.span <= b.column || b.column + b.span <= a.column || a.y + a.height <= b.y || b.y + b.height <= a.y);
      }
    }
  });
}
