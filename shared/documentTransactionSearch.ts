import type { DocumentReviewMatchKind } from "./financialDocuments";
import type { Transaction } from "./types";

export type DocumentMatchCandidate = Pick<Transaction, "id" | "source" | "date" | "counterparty" | "description" | "rawName" | "accountId" | "accountName" | "amount" | "currency" | "cardLastFour" | "cardHolderName"> & { matchKind: DocumentReviewMatchKind };
export interface DocumentCandidates { rows: DocumentMatchCandidate[]; limited: boolean }
export interface DocumentTransactionFilters {
  query: string;
  bank: string;
  account: string;
  currency: string;
  from: string;
  to: string;
  match: "all" | DocumentReviewMatchKind;
}
export const emptyDocumentTransactionFilters: DocumentTransactionFilters = { query: "", bank: "", account: "", currency: "", from: "", to: "", match: "all" };
export const documentTransactionAccountKey = (row: DocumentMatchCandidate) => JSON.stringify([row.source, row.accountId ?? row.accountName]);
const normalize = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/(\d),(?=\d{3}(?:\D|$))/g, "$1");

export function filterDocumentTransactions(rows: DocumentMatchCandidate[], filters: DocumentTransactionFilters): DocumentMatchCandidate[] {
  const words = normalize(filters.query).trim().split(/\s+/).filter(Boolean);
  return rows.filter(row => {
    if (filters.bank && row.source !== filters.bank) return false;
    if (filters.account && documentTransactionAccountKey(row) !== filters.account) return false;
    if (filters.currency && row.currency !== filters.currency) return false;
    if (filters.match !== "all" && row.matchKind !== filters.match) return false;
    const date = row.date.slice(0, 10);
    if (filters.from && date < filters.from || filters.to && date > filters.to) return false;
    const text = normalize([row.counterparty, row.description, row.rawName, row.id, row.source, row.accountName, row.accountId, row.currency, row.date, row.amount.toFixed(2), row.cardLastFour, row.cardHolderName].join(" "));
    return words.every(word => text.includes(word));
  });
}
