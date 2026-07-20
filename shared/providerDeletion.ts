import type { Invoice, Provider, RevenuePartner, RevenueRun, Transaction } from "./types";

export interface ProviderReferenceState {
  providers: Provider[];
  invoices: Invoice[];
  revenuePartners: RevenuePartner[];
  revenueRuns: RevenueRun[];
  transactions: Transaction[];
  wiseStatementTransactions: Transaction[];
}

export interface ProviderDeletionResult extends ProviderReferenceState {
  deletedProvider: Provider;
}

function clearInvoiceProvider(invoice: Invoice, providerId: string): Invoice {
  if (invoice.providerId !== providerId) return invoice;
  const { providerId: _providerId, ...nextInvoice } = invoice;
  return nextInvoice;
}

function clearRevenueRunProvider(run: RevenueRun, providerId: string): RevenueRun {
  if (run.providerId !== providerId) return run;
  const { providerId: _providerId, ...nextRun } = run;
  return nextRun;
}

function clearTransactionProvider(transaction: Transaction, providerId: string): Transaction {
  if (transaction.matchedProviderId !== providerId) return transaction;
  const { matchedProviderId: _matchedProviderId, ...nextTransaction } = transaction;
  return nextTransaction;
}

export function deleteProviderReferences(state: ProviderReferenceState, providerId: string): ProviderDeletionResult | undefined {
  const deletedProvider = state.providers.find((provider) => provider.id === providerId);
  if (!deletedProvider) return undefined;

  return {
    deletedProvider,
    providers: state.providers.filter((provider) => provider.id !== providerId),
    invoices: state.invoices.map((invoice) => clearInvoiceProvider(invoice, providerId)),
    revenuePartners: state.revenuePartners.filter((partner) => partner.providerId !== providerId),
    revenueRuns: state.revenueRuns.map((run) => clearRevenueRunProvider(run, providerId)),
    transactions: state.transactions.map((transaction) => clearTransactionProvider(transaction, providerId)),
    wiseStatementTransactions: state.wiseStatementTransactions.map((transaction) => clearTransactionProvider(transaction, providerId))
  };
}
