import type { AccountBalance, FxRate } from "./types";
import { sumCurrencyTotals, convertCurrencyTotalsToUsd } from "./currencyTotals";
import { wiseEntityLabel } from "./wiseEntities";

export function accountBalanceGroups(accounts: AccountBalance[], rates: FxRate[]) {
  const groups = new Map<string, { id: string; name: string; accounts: AccountBalance[] }>();
  for (const account of accounts) {
    const id = account.source === "wise" ? `wise-${account.wiseEntity ?? "unassigned"}` : `${account.source}${account.slashAccountSubtype === "credit" ? "-credit" : ""}`;
    const name = account.source === "wise" ? `Wise · ${account.wiseEntity ? wiseEntityLabel(account.wiseEntity) : "Unassigned"}`
      : `${account.source[0].toUpperCase()}${account.source.slice(1)}${account.slashAccountSubtype === "credit" ? " credit" : ""}`;
    const group = groups.get(id) ?? { id, name, accounts: [] };
    group.accounts.push(account); groups.set(id, group);
  }
  return [...groups.values()].map(group => {
    const native = sumCurrencyTotals(group.accounts, account => account.balance);
    return { ...group, native, ...convertCurrencyTotalsToUsd(native, rates) };
  });
}
