import { accountBalanceGroups } from "./accountBalanceGroups";
import { isActiveBalanceSource, type BankSource } from "./banks";
import { convertCurrencyTotalsToUsd, sumCurrencyTotals } from "./currencyTotals";
import { hasNonZeroAccountBalance, isLiquidAccountBalance } from "./income";
import { revolutEntities, revolutLabel } from "./revolutBalances";
import type { AccountBalance, FxRate } from "./types";

export function ownerBankBalances(accounts: AccountBalance[], rates: FxRate[], sources: BankSource[]) {
  const active = accounts.filter(a => isActiveBalanceSource(a.source));
  const visible = active.filter(a => a.revolutEntity || hasNonZeroAccountBalance(a));
  const groups = accountBalanceGroups(visible, rates).map(group => {
    const members = group.accounts;
    const savedAt = members.map(a => a.syncedAt || a.updatedAt).filter(Boolean).sort()[0];
    const unavailable = group.excludedCurrencies.length > 0 || (members.some(a => a.revolutEntity) && group.staleCurrencies.length > 0);
    return {
      id: group.id, name: group.name, usd: unavailable ? null : group.totalUsd,
      asOf: savedAt ?? null, syncFailed: members.some(a => a.balanceSyncFailed),
      staleRates: group.staleCurrencies, missingRates: group.excludedCurrencies,
      fxAsOf: group.asOf ?? null, debt: members.length > 0 && members.every(a => !isLiquidAccountBalance(a)),
      accounts: members.filter(hasNonZeroAccountBalance).map((a, i) => ({ id: String(i), name: a.name, currency: a.currency, balance: a.balance }))
    };
  });
  const pending: string[] = [];
  if (sources.includes("revolut")) {
    for (const entity of revolutEntities) if (!active.some(a => a.revolutEntity === entity)) pending.push(revolutLabel(entity));
  }
  for (const source of ["slash", "mercury", "flex"] as const) {
    if (sources.includes(source) && !active.some(a => a.source === source)) pending.push(source[0].toUpperCase() + source.slice(1));
  }
  const liquid = active.filter(isLiquidAccountBalance);
  const cash = convertCurrencyTotalsToUsd(sumCurrencyTotals(liquid, a => a.balance), rates);
  return { groups, pending, cashUsd: liquid.length ? cash.totalUsd : null,
    partial: pending.length > 0 || cash.excludedCurrencies.length > 0, staleRates: cash.staleCurrencies };
}

export type OwnerBankBalances = ReturnType<typeof ownerBankBalances>;
