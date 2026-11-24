import { revolutLabel, type RevolutEntityView } from "./revolutBalances";
import type { Transaction } from "./types";

export function revolutEntityActivity(
  entity: RevolutEntityView,
  primary: readonly Transaction[],
  statements: readonly Transaction[],
  lmdAccounts: ReadonlyMap<string, string>
): Transaction[] {
  const statementsById = new Map(statements.map(row => [row.id, row]));
  if (statementsById.size !== statements.length) throw new Error("Duplicate LMD bank transactions in the selected period");
  const rows: Transaction[] = [];
  for (const row of primary) {
    const belongsToLmd = (row.accountId !== undefined && lmdAccounts.has(row.accountId)) || statementsById.has(row.id);
    const entityId = belongsToLmd ? "lmd" : "dn";
    statementsById.delete(row.id);
    if (entity !== "all" && entity !== entityId) continue;
    rows.push({ ...row, revolutEntity: entityId, accountName: `${revolutLabel(entityId)} · ${row.accountName}` });
  }
  if (entity !== "dn") {
    for (const row of statementsById.values()) {
      const account = (row.accountId && lmdAccounts.get(row.accountId)) || row.accountName;
      rows.push({ ...row, revolutEntity: "lmd", statementOnly: true, accountName: `${revolutLabel("lmd")} · ${account}` });
    }
  }
  return rows;
}
