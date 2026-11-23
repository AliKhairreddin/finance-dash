import type { AccountBalance, RevolutEntity } from "./types";

export const revolutEntities = ["dn", "lmd"] as const satisfies readonly RevolutEntity[];
let cashCurrencies: Set<string> | undefined;

export function isCashCurrency(currency: string): boolean {
  cashCurrencies ??= new Set(Intl.supportedValuesOf("currency"));
  return cashCurrencies.has(currency.toUpperCase());
}

export function revolutLabel(entity: RevolutEntity): string {
  return `Revolut · ${entity.toUpperCase()}`;
}

export function revolutBalanceIssue(accounts: readonly AccountBalance[], entity: RevolutEntity, now: number): string | undefined {
  const rows = accounts.filter(row => row.source === "revolut" && row.revolutEntity === entity && row.status === "live");
  const label = revolutLabel(entity);
  if (!rows.length) return `${label} balances are pending.`;
  const oldest = rows.map(row => row.syncedAt).filter((time): time is string => !!time).sort()[0];
  if (oldest && (rows.some(row => row.balanceSyncFailed) || now - Date.parse(oldest) > 30 * 60_000)) {
    return `${label} balances were last synced at ${oldest}.`;
  }
}
