import { invoiceOutstanding, invoicePaymentAmountTolerance, invoicePaymentIdentityMatched } from "./income";
import type { Invoice, PaymentAllocation, Provider, Transaction, TransactionPage } from "./types";
import { wiseEntityFromAccountName } from "./wiseEntities";

export interface InvoicePaymentSuggestion {
  transaction: Transaction;
  available: number;
  kind: "linked" | "exact" | "tolerance";
  reason: string;
}

export interface InvoicePaymentSuggestions {
  suggestions: InvoicePaymentSuggestion[];
  recommendedTransactionId: string | null;
  searchComplete: boolean;
}

export function availableInvoicePaymentTransactions(
  invoice: Invoice,
  transactions: Transaction[],
  allocations: PaymentAllocation[]
) {
  const allocatedByTransaction = new Map<string, number>();
  for (const allocation of allocations) {
    if (!allocation.transactionId) continue;
    allocatedByTransaction.set(allocation.transactionId, (allocatedByTransaction.get(allocation.transactionId) ?? 0) + allocation.amount);
  }
  return transactions
    .filter(transaction => transaction.direction === "in"
      && transaction.currency.toUpperCase() === invoice.currency.toUpperCase()
      && (transaction.status === "posted" || transaction.status === "settled"))
    .map(transaction => {
      const allocated = allocatedByTransaction.get(transaction.id) ?? 0;
      return { transaction, allocated, available: Math.max(0, Number((Math.abs(transaction.amount) - allocated).toFixed(2))) };
    })
    .filter(row => row.available > 0
      && (!row.transaction.matchedInvoiceId || row.transaction.matchedInvoiceId === invoice.id || row.allocated > 0));
}

export function suggestInvoicePayments({
  invoice, invoices, transactions, allocations, providers, searchComplete = true
}: {
  invoice: Invoice;
  invoices: Invoice[];
  transactions: Transaction[];
  allocations: PaymentAllocation[];
  providers: Provider[];
  searchComplete?: boolean;
}): InvoicePaymentSuggestions {
  const outstanding = invoiceOutstanding(invoice, allocations);
  const result: InvoicePaymentSuggestions = { suggestions: [], recommendedTransactionId: null, searchComplete };
  if (invoice.documentType !== "sales_invoice" || outstanding <= 0) return result;
  const providerById = new Map(providers.map(provider => [provider.id, provider]));
  const identityMatches = (candidate: Invoice, transaction: Transaction) => {
    const entity = transaction.wiseEntity ?? wiseEntityFromAccountName(transaction.accountName);
    return (!candidate.entity || !entity || candidate.entity === entity)
      && candidate.currency.toUpperCase() === transaction.currency.toUpperCase()
      && transaction.date.slice(0, 10) >= candidate.issueDate.slice(0, 10)
      && invoicePaymentIdentityMatched(transaction, candidate, providerById.get(candidate.providerId ?? ""), false);
  };
  const competingTransactions = new Set<string>();
  for (const { transaction, available } of availableInvoicePaymentTransactions(invoice, transactions, allocations)) {
    if (transaction.matchedInvoiceId && transaction.matchedInvoiceId !== invoice.id) continue;
    if (invoices.some(other => other.id !== invoice.id && other.transactionId === transaction.id)) continue;
    const linked = invoice.transactionId === transaction.id || transaction.matchedInvoiceId === invoice.id;
    if (linked) {
      result.suggestions.push({ transaction, available, kind: "linked", reason: transaction.invoiceMatchReason || "Already matched to this invoice" });
      continue;
    }
    if (invoice.transactionId || transaction.invoiceMatchSource === "manual" || !identityMatches(invoice, transaction)) continue;
    const difference = Math.abs(outstanding - available);
    if (difference > invoicePaymentAmountTolerance) continue;
    const exact = difference <= 0.01;
    result.suggestions.push({
      transaction, available, kind: exact ? "exact" : "tolerance",
      reason: exact ? "Exact remaining amount, currency, and company or invoice reference"
        : `Company or invoice reference matches; ${difference.toFixed(2)} ${invoice.currency} amount difference`
    });
    if (invoices.some(other => other.id !== invoice.id && other.documentType === "sales_invoice"
      && other.status !== "paid" && !other.transactionId && invoiceOutstanding(other, allocations) > 0
      && Math.abs(invoiceOutstanding(other, allocations) - available) <= 0.01 && identityMatches(other, transaction))) {
      competingTransactions.add(transaction.id);
    }
  }
  const priority = { linked: 0, exact: 1, tolerance: 2 };
  result.suggestions.sort((left, right) => priority[left.kind] - priority[right.kind]
    || right.transaction.date.localeCompare(left.transaction.date) || left.transaction.id.localeCompare(right.transaction.id));
  const linked = result.suggestions.filter(suggestion => suggestion.kind === "linked");
  const exact = result.suggestions.filter(suggestion => suggestion.kind === "exact");
  if (linked.length === 1) result.recommendedTransactionId = linked[0].transaction.id;
  else if (linked.length === 0 && searchComplete && exact.length === 1 && !competingTransactions.has(exact[0].transaction.id)) {
    result.recommendedTransactionId = exact[0].transaction.id;
  }
  return result;
}

/** Search older pages automatically, while keeping each request bounded and disclosing incomplete searches. */
export async function loadInvoicePaymentSuggestions({
  invoice, invoices, allocations, providers, getTransaction, getPage
}: {
  invoice: Invoice;
  invoices: Invoice[];
  allocations: PaymentAllocation[];
  providers: Provider[];
  getTransaction: (id: string) => Promise<Transaction | null>;
  getPage: (cursor: string | null) => Promise<TransactionPage>;
}): Promise<InvoicePaymentSuggestions> {
  const transactions = new Map<string, Transaction>();
  if (invoice.transactionId) {
    const transaction = await getTransaction(invoice.transactionId);
    if (transaction) transactions.set(transaction.id, transaction);
    const linked = suggestInvoicePayments({ invoice, invoices, allocations, providers, transactions: [...transactions.values()] });
    if (linked.recommendedTransactionId) return linked;
  }
  let cursor: string | null = null;
  let searchComplete = false;
  const seenCursors = new Set<string>();
  for (let pageNumber = 0; pageNumber < 20; pageNumber += 1) {
    const page = await getPage(cursor);
    for (const transaction of page.transactions) transactions.set(transaction.id, transaction);
    if (page.isDone || (page.transactions.at(-1)?.date.slice(0, 10) ?? "9999-12-31") < invoice.issueDate.slice(0, 10)) {
      searchComplete = true;
      break;
    }
    if (!page.continueCursor || seenCursors.has(page.continueCursor)) throw new Error("Invoice payment search did not advance");
    cursor = page.continueCursor;
    seenCursors.add(cursor);
  }
  return suggestInvoicePayments({ invoice, invoices, allocations, providers, transactions: [...transactions.values()], searchComplete });
}
