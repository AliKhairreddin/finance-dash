import type { CurrencyTotals } from "./types";

function normalizedCurrency(currency: string): string {
  const value = currency.trim().toUpperCase();
  if (!value) throw new Error("Currency is required for monetary totals");
  return value;
}

export function sumCurrencyTotals<T extends { currency: string }>(
  rows: T[],
  amount: (row: T) => number
): CurrencyTotals {
  const totals: CurrencyTotals = {};
  for (const row of rows) {
    const currency = normalizedCurrency(row.currency);
    const value = amount(row);
    if (!Number.isFinite(value)) throw new Error(`Invalid ${currency} amount`);
    totals[currency] = (totals[currency] ?? 0) + value;
  }
  return totals;
}

export function combineCurrencyTotals(...groups: CurrencyTotals[]): CurrencyTotals {
  const totals: CurrencyTotals = {};
  for (const group of groups) {
    for (const [currency, amount] of Object.entries(group)) {
      totals[currency] = (totals[currency] ?? 0) + amount;
    }
  }
  return totals;
}

export function subtractCurrencyTotals(base: CurrencyTotals, deduction: CurrencyTotals): CurrencyTotals {
  const currencies = new Set([...Object.keys(base), ...Object.keys(deduction)]);
  return Object.fromEntries(
    [...currencies].map((currency) => [currency, (base[currency] ?? 0) - (deduction[currency] ?? 0)])
  );
}

export function hasCurrencyTotals(totals: CurrencyTotals): boolean {
  return Object.keys(totals).length > 0;
}
