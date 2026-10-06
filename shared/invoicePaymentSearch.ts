import type { availableInvoicePaymentTransactions } from "./invoicePaymentSuggestions";

export type PaymentTransactionRow = ReturnType<typeof availableInvoicePaymentTransactions>[number];
export type PaymentMatchFilter = "all" | "suggested" | "exact" | "partial";
export interface PaymentTransactionFilters {
  query: string;
  bank: string;
  account: string;
  from: string;
  to: string;
  minimum: string;
  maximum: string;
  match: PaymentMatchFilter;
}

export const emptyPaymentTransactionFilters: PaymentTransactionFilters = {
  query: "", bank: "", account: "", from: "", to: "", minimum: "", maximum: "", match: "all"
};

export function paymentTransactionAccountKey(row: PaymentTransactionRow): string {
  return JSON.stringify([row.transaction.source, row.transaction.accountId ?? row.transaction.accountName]);
}

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/(\d),(?=\d{3}(?:\D|$))/g, "$1");
}

export function filterPaymentTransactions(
  rows: PaymentTransactionRow[],
  filters: PaymentTransactionFilters,
  remaining: number,
  suggestedIds: ReadonlySet<string>
): PaymentTransactionRow[] {
  const words = normalize(filters.query).trim().split(/\s+/).filter(Boolean);
  return rows.filter(row => {
    const { transaction, available } = row;
    const date = transaction.date.slice(0, 10);
    if (filters.bank && transaction.source !== filters.bank) return false;
    if (filters.account && paymentTransactionAccountKey(row) !== filters.account) return false;
    if (filters.from && date < filters.from || filters.to && date > filters.to) return false;
    if (filters.minimum && available < Number(filters.minimum) || filters.maximum && available > Number(filters.maximum)) return false;
    if (filters.match === "suggested" && !suggestedIds.has(transaction.id)) return false;
    if (filters.match === "exact" && Math.abs(Math.round(available * 100) - Math.round(remaining * 100)) > 1) return false;
    if (filters.match === "partial" && row.allocated <= 0) return false;
    const text = normalize([
      transaction.counterparty, transaction.description, transaction.rawName, transaction.id,
      transaction.source, transaction.accountName, transaction.accountId, transaction.currency,
      transaction.date, Math.abs(transaction.amount).toFixed(2), available.toFixed(2)
    ].join(" "));
    return words.every(word => text.includes(word));
  });
}
