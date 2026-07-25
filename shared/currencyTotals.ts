import type { CurrencyTotals, FxRate } from "./types";

export interface UsdCurrencyTotal {
  totalUsd: number;
  excludedCurrencies: string[];
  staleCurrencies: string[];
  asOf?: string;
}

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

export function convertCurrencyTotalsToUsd(totals: CurrencyTotals, rates: FxRate[]): UsdCurrencyTotal {
  const rateByCurrency = new Map(rates.map((rate) => [normalizedCurrency(rate.asset), rate]));
  const excludedCurrencies = new Set<string>();
  const staleCurrencies = new Set<string>();
  const usedRates = new Map<string, FxRate>();
  let totalUsd = 0;

  for (const [rawCurrency, amount] of Object.entries(totals)) {
    const currency = normalizedCurrency(rawCurrency);
    if (!Number.isFinite(amount)) throw new Error(`Invalid ${currency} amount`);
    if (amount === 0) continue;

    const quote = rateByCurrency.get(currency);
    const rateUsd = currency === "USD" ? 1 : quote?.rateUsd;
    if (rateUsd === undefined) {
      excludedCurrencies.add(currency);
      continue;
    }

    totalUsd += amount * rateUsd;
    if (quote) usedRates.set(currency, quote);
    if (quote?.stale) staleCurrencies.add(currency);
  }

  const asOf = [...usedRates.values()].reduce<string | undefined>(
    (oldest, rate) => (!oldest || rate.asOf < oldest ? rate.asOf : oldest),
    undefined
  );

  return {
    totalUsd: Math.round((totalUsd + Number.EPSILON) * 100) / 100,
    excludedCurrencies: [...excludedCurrencies].sort(),
    staleCurrencies: [...staleCurrencies].sort(),
    asOf
  };
}
