import assert from "node:assert/strict";
import test from "node:test";
import { cashFlowOpenBalanceGroups, cashFlowPayableMonths, cashFlowPayableMonthTotals, cashFlowReportHistory, cashFlowSnapshotTotals, cashFlowUsdTotal } from "./cashFlowReport";
import type { CashFlowLine, CashFlowSnapshot, FxRate } from "./types";

const line = (amount: number, currency = "USD", excludedFromTotals = false): CashFlowLine => ({
  id: "line", name: "Account", amount, currency, excludedFromTotals
});
const snapshot = (asOfDate = "2026-09-06", patch: Partial<CashFlowSnapshot> = {}): CashFlowSnapshot => ({
  id: asOfDate, asOfDate, createdAt: `${asOfDate}T00:00:00Z`, updatedAt: `${asOfDate}T00:00:00Z`,
  cashAccounts: [], receivables: [], openBalances: [], payables: [], investments: [], ...patch
});

test("report and dashboard share native-currency totals, exclusions, and the position equation", () => {
  const rates: FxRate[] = [{ asset: "EUR", rateUsd: 1.2, provider: "coinbase", asOf: "2026-09-06" }];
  const totals = cashFlowSnapshotTotals(snapshot("2026-09-06", {
    cashAccounts: [line(100), line(50, "EUR"), line(900, "USD", true)],
    receivables: [line(20, "EUR")], openBalances: [line(-10)], payables: [line(40), line(200, "USD", true)],
    investments: [line(50), line(500, "USD", true)]
  }), rates);
  assert.deepEqual(totals, { cash: 160, receivables: 24, openBalances: -10, approximateCash: 174,
    payables: 40, investments: 50, profit: 134, assets: 184 });
  assert.equal(cashFlowSnapshotTotals(snapshot(), []).assets, 0);
});

test("payable month detail retains all calendar months, zeroes, commas, and credits", () => {
  assert.deepEqual(cashFlowPayableMonths("September $1,250.50; october -50; December 0; August $100"), [
    { month: "August", amount: 100 }, { month: "September", amount: 1250.5 },
    { month: "October", amount: -50 }, { month: "December", amount: 0 }
  ]);
  assert.deepEqual(cashFlowPayableMonths("Ad spend"), []);
});

test("payable month totals exclude unchecked rows and never add different currencies together", () => {
  assert.deepEqual(cashFlowPayableMonthTotals([
    { ...line(100), notes: "August 100" }, { ...line(30), notes: "August 30" },
    { ...line(90, "USD", true), notes: "August 90" }, { ...line(50, "EUR"), notes: "August 50" }
  ]), [{ month: "August", currency: "EUR", amount: 50 }, { month: "August", currency: "USD", amount: 130 }]);
});

test("history ends at the exported as-of date, includes the unsaved draft, and deduplicates dates", () => {
  const draft = snapshot("2026-09-06", { id: "preview", cashAccounts: [line(123)] });
  const result = cashFlowReportHistory(draft, [snapshot("2026-09-07"), snapshot(), snapshot("2026-09-01")]);
  assert.deepEqual(result.map((row) => row.asOfDate), ["2026-09-01", "2026-09-06"]);
  assert.equal(result[1], draft);
  assert.deepEqual(cashFlowReportHistory(draft, []), [draft]);
  const history = Array.from({ length: 20 }, (_, i) => snapshot(`2026-08-${String(i + 1).padStart(2, "0")}`));
  assert.equal(cashFlowReportHistory(draft, history).length, 12);
});

test("open balances use explicit company suffixes, keep ambiguous suppliers, and reconcile signed totals", () => {
  const rows = [
    { ...line(100), id: "a", name: "Platform-cog" },
    { ...line(-60), id: "b", name: "Platform - Cognitive" },
    { ...line(40), id: "c", name: "Platform–WAGNER" },
    { ...line(200, "USD", true), id: "d", name: "Excluded-wagner" },
    { ...line(30), id: "e", name: "Blackbird (SuccessRoom)" },
    { ...line(20), id: "f", name: "Cognitive supplier without suffix" }
  ];
  const groups = cashFlowOpenBalanceGroups(rows);
  assert.deepEqual(groups.map(group => [group.label, group.lines.map(row => row.id)]), [
    ["Cognitive", ["a", "b"]], ["Wagner", ["c", "d"]], ["Other", ["e", "f"]]
  ]);
  assert.equal(groups.reduce((total, group) => total + cashFlowUsdTotal(group.lines, []), 0), cashFlowUsdTotal(rows, []));
  assert.deepEqual(cashFlowOpenBalanceGroups([]), []);
});
