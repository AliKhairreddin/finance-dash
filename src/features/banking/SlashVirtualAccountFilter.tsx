import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useUrlState } from "@/lib/url-state";
import type { DashboardSnapshot, SlashVirtualAccount } from "../../../shared/types";

export function useSlashVirtualAccountFilter() {
  return useUrlState("slashVirtualAccount", "all");
}

export function slashVirtualAccountOptions(accounts: DashboardSnapshot["accounts"]): SlashVirtualAccount[] {
  const options = new Map<string, SlashVirtualAccount>();
  for (const account of accounts) {
    if (account.source !== "slash") continue;
    for (const virtualAccount of account.slashVirtualAccounts ?? []) {
      if (!virtualAccount.closedAt) options.set(virtualAccount.id, virtualAccount);
    }
  }
  return [...options.values()].sort((left, right) =>
    Number(left.accountType !== "primary") - Number(right.accountType !== "primary")
    || left.name.localeCompare(right.name)
  );
}

export function SlashVirtualAccountFilter({
  accounts,
  value,
  onChange
}: {
  accounts: readonly SlashVirtualAccount[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      Virtual account
      <NativeSelect aria-label="Filter Slash activity by virtual account" value={value} onValueChange={onChange}>
        <NativeSelectOption value="all">All virtual accounts</NativeSelectOption>
        {accounts.map((account) => (
          <NativeSelectOption key={account.id} value={account.id}>{account.name}</NativeSelectOption>
        ))}
      </NativeSelect>
    </label>
  );
}
