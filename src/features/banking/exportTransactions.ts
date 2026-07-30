import type { Provider, Team, Transaction } from "../../../shared/types";
import { buildTransactionCsv, transactionCsvFileName } from "../../../shared/transactionCsv";

export function exportBankTransactionsCsv({
  providersById,
  rows,
  scope,
  teamsById
}: {
  providersById: ReadonlyMap<string, Pick<Provider, "name">>;
  rows: readonly Transaction[];
  scope: string;
  teamsById: ReadonlyMap<string, Pick<Team, "name">>;
}) {
  const csv = buildTransactionCsv(rows, { providersById, teamsById });
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = transactionCsvFileName(scope);
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
