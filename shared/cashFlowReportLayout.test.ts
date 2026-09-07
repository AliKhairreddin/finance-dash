import assert from "node:assert/strict";
import test from "node:test";
import { packCashFlowReportCards, splitCashFlowReportRows } from "./cashFlowReportLayout";
import { planCashFlowPng } from "../src/features/cash-flow/exportCashFlowPng";
import { cashFlowSections, cashFlowUsdTotal } from "./cashFlowReport";
import type { CashFlowLine, CashFlowSnapshot } from "./types";

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
  for (const orientation of ["landscape", "portrait"] as const) test(`${name}: ${orientation} preserves all rows, orientation, chart area, and subtotals`, () => {
    const plan = planCashFlowPng(context, input, [], orientation);
    assert.equal(plan.width > plan.height, orientation === "landscape");
    const expected = cashFlowSections.flatMap(key => input[key]);
    const actual = plan.sections.flatMap(section => section.lines);
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
