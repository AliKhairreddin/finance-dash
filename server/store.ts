import crypto from "node:crypto";
import type {
  CreateInvoicePayload,
  CreateProviderPayload,
  DashboardSnapshot,
  Invoice,
  MatchTransactionPayload,
  Provider,
  Transaction
} from "../shared/types";
import { calculateMetrics } from "./calculations";
import { createQuickBooksInvoice, fetchSlashActivity, fetchWiseActivity, getIntegrationStatus } from "./integrations";
import { enrichTransactions, learnAlias } from "./matching";
import {
  seededAccounts,
  seededAsOf,
  seededInvoices,
  seededInvestments,
  seededOpenBalances,
  seededPayables,
  seededProviders,
  seededReceivables,
  seededTransactions
} from "./mockData";
import { loadPersistedState, savePersistedState } from "./persistence";

let providers: Provider[] = [...seededProviders];
let invoices: Invoice[] = [...seededInvoices];
let transactions: Transaction[] = [...seededTransactions];
let accounts = [...seededAccounts];
let lastSync = new Date().toISOString();

function mergeById<T extends { id: string }>(seeded: T[], persisted?: T[]): T[] {
  const map = new Map(seeded.map((item) => [item.id, item]));
  for (const item of persisted ?? []) {
    map.set(item.id, item);
  }
  return [...map.values()];
}

export async function initializeStore(): Promise<void> {
  const persisted = await loadPersistedState();
  providers = mergeById(seededProviders, persisted.providers);
  invoices = mergeById(seededInvoices, persisted.invoices);
}

async function persist(): Promise<void> {
  await savePersistedState({ providers, invoices });
}

function getMatchedTransactions(): Transaction[] {
  const invoiceByTransaction = new Map(invoices.filter((invoice) => invoice.transactionId).map((invoice) => [invoice.transactionId, invoice]));
  const withInvoiceMatches = transactions.map((transaction) => {
    const invoice = invoiceByTransaction.get(transaction.id);
    return invoice
      ? { ...transaction, matchedInvoiceId: invoice.id, matchedProviderId: invoice.providerId ?? transaction.matchedProviderId }
      : transaction;
  });
  return enrichTransactions(withInvoiceMatches, providers);
}

export function getSnapshot(): DashboardSnapshot {
  const metrics = calculateMetrics(accounts, seededReceivables, seededOpenBalances, seededPayables, seededInvestments);
  return {
    asOf: seededAsOf,
    accounts,
    receivables: seededReceivables,
    openBalances: seededOpenBalances,
    payables: seededPayables,
    investments: seededInvestments,
    providers,
    transactions: getMatchedTransactions(),
    invoices,
    integrationStatus: getIntegrationStatus(),
    metrics,
    lastSync
  };
}

export async function createProvider(payload: CreateProviderPayload): Promise<Provider> {
  const provider: Provider = {
    id: `provider-${crypto.randomUUID()}`,
    name: payload.name.trim(),
    type: payload.type,
    category: payload.category.trim() || "Uncategorized",
    aliases: payload.aliases.map((alias) => alias.trim()).filter(Boolean),
    source: "manual",
    createdAt: new Date().toISOString()
  };
  providers = [...providers, provider];
  await persist();
  return provider;
}

export async function matchTransaction(payload: MatchTransactionPayload): Promise<Transaction> {
  const provider = providers.find((item) => item.id === payload.providerId);
  const transaction = transactions.find((item) => item.id === payload.transactionId);
  if (!provider || !transaction) {
    throw new Error("Provider or transaction not found");
  }

  transactions = transactions.map((item) =>
    item.id === payload.transactionId
      ? {
          ...item,
          matchedProviderId: payload.providerId,
          matchedInvoiceId: payload.invoiceId,
          confidence: 1,
          matchReason: "Manual match"
        }
      : item
  );

  if (payload.rememberAlias) {
    providers = providers.map((item) => (item.id === payload.providerId ? learnAlias(item, transaction.rawName) : item));
  }

  await persist();
  return getMatchedTransactions().find((item) => item.id === payload.transactionId)!;
}

export async function createInvoice(payload: CreateInvoicePayload): Promise<Invoice> {
  const liveInvoice = await createQuickBooksInvoice(payload);
  const invoice: Invoice =
    liveInvoice ?? {
      id: `mock-invoice-${crypto.randomUUID()}`,
      providerId: payload.providerId,
      customerName: payload.customerName,
      amount: payload.amount,
      currency: payload.currency,
      status: "draft",
      dueDate: payload.dueDate,
      source: "mock",
      description: payload.description,
      transactionId: payload.transactionId,
      createdAt: new Date().toISOString()
    };

  invoices = [invoice, ...invoices];
  if (payload.transactionId && payload.providerId) {
    transactions = transactions.map((transaction) =>
      transaction.id === payload.transactionId
        ? { ...transaction, matchedProviderId: payload.providerId, matchedInvoiceId: invoice.id, confidence: 1, matchReason: "Invoice created" }
        : transaction
    );
  }
  await persist();
  return invoice;
}

export async function syncExternalActivity(): Promise<DashboardSnapshot> {
  const [wise, slash] = await Promise.allSettled([fetchWiseActivity(), fetchSlashActivity()]);
  const liveTransactions: Transaction[] = [];

  if (wise.status === "fulfilled") {
    if (wise.value.accounts.length > 0) {
      accounts = [...seededAccounts.filter((account) => account.source !== "wise"), ...wise.value.accounts];
    }
    liveTransactions.push(...wise.value.transactions);
  }
  if (slash.status === "fulfilled") {
    liveTransactions.push(...slash.value.transactions);
  }

  if (liveTransactions.length > 0) {
    const existingIds = new Set(transactions.map((transaction) => transaction.id));
    transactions = [...liveTransactions.filter((transaction) => !existingIds.has(transaction.id)), ...transactions];
  }

  lastSync = new Date().toISOString();
  return getSnapshot();
}
