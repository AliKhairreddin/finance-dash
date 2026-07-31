import type { Provider, Team, Transaction } from "./types";

type NamedLookup = ReadonlyMap<string, Pick<Provider | Team, "name">>;

export interface TransactionCsvLookups {
  providersById: NamedLookup;
  teamsById: NamedLookup;
}

const transactionCsvHeaders = [
  "Date",
  "Source",
  "Account",
  "AI merchant",
  "Merchant key",
  "Counterparty",
  "Description",
  "Raw name",
  "Direction",
  "Amount",
  "Currency",
  "Cashback earned",
  "Cashback rate",
  "Status",
  "Category",
  "Classification complete",
  "Category source",
  "Category confidence",
  "Category reason",
  "Team",
  "Company",
  "Company match source",
  "Company match confidence",
  "Company match reason",
  "Invoice ID",
  "Transaction ID"
] as const;

function csvCell(value: number | string | undefined): string {
  if (value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";

  // Prevent spreadsheet applications from interpreting imported text as a formula.
  const spreadsheetSafeValue = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${spreadsheetSafeValue.replaceAll('"', '""')}"`;
}

export function buildTransactionCsv(
  transactions: readonly Transaction[],
  { providersById, teamsById }: TransactionCsvLookups
): string {
  const rows = transactions.map((transaction) => [
    transaction.date,
    transaction.source,
    transaction.accountName,
    transaction.merchantName,
    transaction.merchantKey,
    transaction.counterparty,
    transaction.description,
    transaction.rawName,
    transaction.direction,
    transaction.amount,
    transaction.currency,
    transaction.cashback?.amount,
    transaction.cashback?.rate,
    transaction.status,
    transaction.category,
    transaction.classificationComplete ? "Yes" : "No",
    transaction.categorySource,
    transaction.categoryConfidence,
    transaction.categoryReason,
    transaction.teamId ? teamsById.get(transaction.teamId)?.name : undefined,
    transaction.matchedProviderId ? providersById.get(transaction.matchedProviderId)?.name : undefined,
    transaction.companyMatchSource,
    transaction.companyConfidence,
    transaction.companyMatchReason,
    transaction.matchedInvoiceId,
    transaction.id
  ]);

  return `\uFEFF${[transactionCsvHeaders, ...rows]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n")}`;
}

export function transactionCsvFileName(scope: string, date = new Date()): string {
  const normalizedScope = scope.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "all";
  return `bank-transactions-${normalizedScope}-${date.toISOString().slice(0, 10)}.csv`;
}
