import type { AccountBalance, SlashEntity } from "./types";
import type { SlashVirtualAccountBalance } from "./slashApi";
import { bankLegalEntities } from "./bankLegalEntities";

export type SlashEntityView = "all" | SlashEntity;
export const slashEntities = bankLegalEntities.map(entity => ({ ...entity, label: entity.legalName }));
export const slashEntityViews: SlashEntityView[] = ["all", ...slashEntities.map(entity => entity.id)];
export function slashEntityLabel(entity: SlashEntity): string {
  return slashEntities.find(item => item.id === entity)!.label;
}

/** Cash/credit parents share virtual accounts; count each partition exactly once. */
export function savedSlashVirtualBalances(accounts: readonly (AccountBalance & { syncedAt?: string })[], now = Date.now()): SlashVirtualAccountBalance[] {
  const result = new Map<string, SlashVirtualAccountBalance>();
  for (const entity of slashEntities) {
    const parents = accounts.filter(account => account.source === "slash" && account.slashEntity === entity.id);
    if (!parents.length) throw new Error(`${entity.label} balances have not synced yet`);
    for (const parent of parents) {
      const timestamp = Date.parse(parent.syncedAt ?? parent.updatedAt);
      if (!Number.isFinite(timestamp) || now - timestamp > 30 * 60_000) throw new Error(`${entity.label} balances are stale`);
      if (!parent.slashVirtualAccounts?.length) throw new Error(`${entity.label} virtual-account balances are unavailable`);
      for (const account of parent.slashVirtualAccounts) {
        if (typeof account.balance !== "number" || !Number.isFinite(account.balance)) throw new Error(`${entity.label} virtual-account balance is unavailable`);
        const item: SlashVirtualAccountBalance = { ...account, balance: account.balance, currency: "USD", slashEntity: entity.id };
        const existing = result.get(account.id);
        if (existing && (existing.slashEntity !== item.slashEntity || existing.balance !== item.balance)) throw new Error("Slash virtual-account balances conflict");
        result.set(account.id, item);
      }
    }
  }
  return [...result.values()];
}
