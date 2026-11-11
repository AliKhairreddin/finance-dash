import type { AccountBalance, FxRate } from "./types";
import { sumCurrencyTotals, convertCurrencyTotalsToUsd } from "./currencyTotals";
import { isActiveBalanceSource } from "./banks";

export function accountBalanceGroups(accounts: AccountBalance[], rates: FxRate[]) {
  const groups = new Map<string, { id: string; name: string; accounts: AccountBalance[] }>();
  for (const account of accounts.filter(account => isActiveBalanceSource(account.source))) {
    const id = `${account.source}${account.slashAccountSubtype === "credit" || account.flex?.type === "rewardCard" ? "-credit" : ""}`;
    const name = account.source === "slash" ? `Slash ${account.slashAccountSubtype === "credit" ? "credit" : "cash"}`
      : account.source === "flex" ? `Flex ${account.flex?.type === "rewardCard" ? "card debt" : "cash"}`
      : `${account.source[0].toUpperCase()}${account.source.slice(1)}`;
    const group = groups.get(id) ?? { id, name, accounts: [] };
    group.accounts.push(account); groups.set(id, group);
  }
  return [...groups.values()].map(group => {
    const native = sumCurrencyTotals(group.accounts, account => account.balance);
    return { ...group, native, ...convertCurrencyTotalsToUsd(native, rates) };
  });
}
