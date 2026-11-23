import type { AccountBalance, FxRate } from "./types";
import { sumCurrencyTotals, convertCurrencyTotalsToUsd } from "./currencyTotals";
import { isActiveBalanceSource } from "./banks";
import { isCashCurrency, revolutLabel } from "./revolutBalances";

export function accountBalanceGroups(accounts: AccountBalance[], rates: FxRate[]) {
  const groups = new Map<string, { id: string; name: string; accounts: AccountBalance[] }>();
  for (const account of accounts.filter(account => isActiveBalanceSource(account.source))) {
    const credit = account.slashAccountSubtype === "credit" || account.flex?.type === "rewardCard";
    let id = account.source + (credit ? "-credit" : "");
    let name = account.source[0].toUpperCase() + account.source.slice(1);
    if (account.source === "revolut" && account.revolutEntity) {
      const crypto = !isCashCurrency(account.currency);
      if (crypto && !groups.has(`revolut-${account.revolutEntity}`)) {
        const cashId = `revolut-${account.revolutEntity}`;
        groups.set(cashId, { id: cashId, name: revolutLabel(account.revolutEntity), accounts: [] });
      }
      id = `revolut-${account.revolutEntity}${crypto ? "-crypto" : ""}`;
      name = revolutLabel(account.revolutEntity) + (crypto ? " · Crypto" : "");
    } else if (account.source === "slash") {
      name = credit ? "Slash credit" : "Slash cash";
    } else if (account.source === "flex") {
      name = credit ? "Flex card debt" : "Flex cash";
    }
    const group = groups.get(id) ?? { id, name, accounts: [] };
    group.accounts.push(account); groups.set(id, group);
  }
  return [...groups.values()].map(group => {
    const native = sumCurrencyTotals(group.accounts, account => account.balance);
    return { ...group, native, ...convertCurrencyTotalsToUsd(native, rates) };
  });
}
