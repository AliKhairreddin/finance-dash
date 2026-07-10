import assert from "node:assert/strict";
import test from "node:test";
import type { AccountBalance, Investment, LedgerItem, Payable } from "../shared/types";
import { calculateMetrics } from "./calculations";

const account = (id: string, balance: number, currency: string): AccountBalance => ({
  id,
  name: id,
  source: "wise",
  balance,
  currency,
  updatedAt: "2026-07-09T00:00:00.000Z",
  status: "live"
});

const ledger = (id: string, balance: number, currency: string): LedgerItem => ({
  id,
  name: id,
  balance,
  currency,
  source: "manual"
});

test("calculateMetrics keeps every currency separate through derived totals", () => {
  const accounts = [account("usd-1", 100, "USD"), account("usd-2", 25, "usd"), account("cad", 50, "CAD")];
  const receivables = [ledger("receivable-usd", 20, "USD"), ledger("receivable-cad", 5, "CAD")];
  const openBalances = [ledger("open-usd", 10, "USD"), ledger("open-eur", 7, "EUR")];
  const payables: Payable[] = [
    { id: "payable-usd", supplier: "USD supplier", balance: 30, currency: "USD", category: "Ads", monthBuckets: { "2026-07": 30 }, aliases: [] },
    { id: "payable-cad", supplier: "CAD supplier", balance: 2, currency: "CAD", category: "Fees", monthBuckets: { "2026-07": 2 }, aliases: [] },
    { id: "payable-gbp", supplier: "GBP supplier", balance: 4, currency: "GBP", category: "Fees", monthBuckets: { "2026-08": 4 }, aliases: [] }
  ];
  const investments: Investment[] = [{ id: "investment-eur", name: "EUR investment", balance: 3, currency: "EUR" }];

  assert.deepEqual(calculateMetrics(accounts, receivables, openBalances, payables, investments), {
    totalCash: { USD: 125, CAD: 50 },
    totalReceivables: { USD: 20, CAD: 5 },
    totalOpenBalance: { USD: 10, EUR: 7 },
    totalPayables: { USD: 30, CAD: 2, GBP: 4 },
    totalFloat: { USD: 155, CAD: 55, EUR: 7 },
    profit: { USD: 125, CAD: 53, EUR: 7, GBP: -4 },
    investments: { EUR: 3 },
    totalAssets: { USD: 125, CAD: 53, EUR: 10, GBP: -4 },
    monthTotals: { "2026-07": { USD: 30, CAD: 2 }, "2026-08": { GBP: 4 } }
  });
});

test("calculateMetrics never invents an aggregate when there are no rows", () => {
  assert.deepEqual(calculateMetrics([], [], [], [], []), {
    totalCash: {},
    totalReceivables: {},
    totalOpenBalance: {},
    totalPayables: {},
    totalFloat: {},
    profit: {},
    investments: {},
    totalAssets: {},
    monthTotals: {}
  });
});
