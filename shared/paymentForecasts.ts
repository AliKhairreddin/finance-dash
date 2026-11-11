import { transactionBusinessCategory } from "./categories";
import { shiftFinanceOperatingDate } from "./operatingDate";
import { isCurrentBankTransactionId, isLegacySurrogateBankTransactionId } from "./providerIdentity";
import { bankPatternForInvoice, estimateBankPaymentPattern } from "./bankPaymentPatterns";
import type { ClientPaymentHistory, Invoice, PaymentAllocation, PaymentHistoryReport, Provider, Transaction } from "./types";

export const minimumPaymentSamples = 3;
export const maximumPaymentSamples = 10;
export const paymentHistoryDays = 365;

const businessRevenue = new Set(["Media buying direct", "Affiliate team revenue", "Partner network revenue"]);
function identity(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(?:incorporated|limited|llc|ltd|inc|bv|ou)$/g, "");
}
// Payer identities only: recipient names in bank descriptions are not payer evidence.
const excludedIdentities = [
  "Mojo Labs", "Benno's World", "Beno's World", "Inch Digital", "Digital Nudge", "LoveMeDo",
  "One Love Media", "One Love Media D.O.O. Sarajevo", "OLM d.o.o.", "Cognitive Pixel", "Wagner",
  "That Canadian Software Services", "TCSS", "Ali Khaireddin", "Ali Kheireddine", "Emerix Capital",
  "CoverageBird", "Coverage Pro", "CoveragePro"
].map(identity);
function excluded(name: string): boolean {
  const key = identity(name);
  return !key || excludedIdentities.some(value => key === value || key.startsWith(`${value}holding`));
}
// Verified company/trading-name aliases; never infer clients from amounts or recipient descriptions.
const knownClients = [
  { name: "QuinStreet", aliases: ["QuinStreet", "QuinStreet Inc"] },
  { name: "MediaAlpha", aliases: ["MediaAlpha", "Media Alpha", "QuoteLab", "QuoteLab LLC", "82311QUOTELAB L", "82311QUOTELAB, L", "82311Quotelab"] },
  { name: "SmartFinancial", aliases: ["SmartFinancial", "Smart Financial"] },
  { name: "Lead Economy", aliases: ["Lead Economy", "LeadEconomy"] },
  { name: "LeadPier", aliases: ["LeadPier", "LeadPie", "Lead Pie"] },
  { name: "EverQuote", aliases: ["EverQuote", "EverQuote Inc"] },
  { name: "All Web Leads", aliases: ["All Web Leads", "All Web Lead", "AWL"] }
];

function day(value: string): string | undefined {
  const date = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : undefined;
}
function days(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
function median(values: number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return Math.round(ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2);
}
const cents = (value: number) => Math.round(value * 100);

type Client = { key: string; name: string };
type Observation = { date: string; delay: number; bankIds: string[] };

/** Derived only from saved bank records. No upstream calls, invoice edits, or inferred matches. */
export function calculatePaymentHistory(input: {
  invoices: Invoice[];
  allocations: PaymentAllocation[];
  providers: Provider[];
  transactions: Transaction[];
  asOfDate: string;
  complete?: boolean;
}): PaymentHistoryReport {
  const toDate = day(input.asOfDate);
  if (!toDate) throw new Error("Invalid payment history date");
  const fromDate = shiftFinanceOperatingDate(toDate, 1 - paymentHistoryDays);
  const complete = input.complete !== false;
  const providers = new Map(input.providers.map(provider => [provider.id, provider]));
  const byProvider = new Map<string, Client>();
  const byAlias = new Map<string, Client | null>();
  const known = new Map(knownClients.flatMap(client => client.aliases.map(alias => [identity(alias), client] as const)));
  const addAlias = (alias: string, client: Client) => {
    const key = identity(alias);
    if (!key || key.length < 3) return;
    const previous = byAlias.get(key);
    byAlias.set(key, previous === undefined || previous?.key === client.key ? client : null);
  };
  for (const provider of input.providers) {
    if (provider.type !== "client" || excluded(provider.name) || (provider.legalName && excluded(provider.legalName))
      || provider.tags.some(tag => /^(investor|internal|intercompany|owned company)$/i.test(tag))) continue;
    const named = known.get(identity(provider.name));
    const client = { key: named ? `client-${identity(named.name)}` : provider.id, name: named?.name ?? provider.name };
    byProvider.set(provider.id, client);
    for (const alias of [provider.name, provider.legalName ?? "", ...provider.aliases]) addAlias(alias, client);
  }
  for (const named of knownClients) {
    const client = { key: `client-${identity(named.name)}`, name: named.name };
    for (const alias of named.aliases) addAlias(alias, client);
  }
  const resolve = (providerId: string | undefined, names: string[]): Client | undefined => {
    if (names.some(excluded)) return undefined;
    if (providerId && providers.has(providerId)) return byProvider.get(providerId);
    const matches = names.map(name => byAlias.get(identity(name))).filter((client): client is Client => Boolean(client));
    return matches.length && matches.every(client => client.key === matches[0].key) ? matches[0] : undefined;
  };
  const invoiceClient = (invoice: Invoice) => resolve(invoice.providerId, [invoice.customerName]);
  const rows = new Map<string, ClientPaymentHistory>();
  const rowKey = (client: Client, currency: string) => `${client.key}:${currency}`;
  const ensureRow = (client: Client, currency: string) => {
    const id = rowKey(client, currency);
    let row = rows.get(id);
    if (!row) {
      row = { id, name: client.name, currency, received: 0, receiptCount: 0, sampleSize: 0 };
      rows.set(id, row);
    }
    return row;
  };
  const bankById = new Map<string, Transaction>();
  const bankClients = new Map<string, Client>();
  const receiptDates = new Map<string, Set<string>>();
  const isBankSource = (source: Transaction["source"]): source is "wise" | "revolut" | "slash" | "amex" | "mercury" | "flex" => source === "wise" || source === "revolut" || source === "slash" || source === "amex" || source === "mercury" || source === "flex";
  let unverifiedReceipts = 0;
  for (const transaction of input.transactions) {
    const date = day(transaction.date);
    if (transaction.direction !== "in" || !["posted", "settled"].includes(transaction.status)
      || !date || date < fromDate || date > toDate || transaction.amount <= 0.01
      || !businessRevenue.has(transactionBusinessCategory(transaction.category))) continue;
    if (bankById.has(transaction.id)) continue;
    const client = resolve(transaction.matchedProviderId, [transaction.merchantName || transaction.counterparty, transaction.counterparty]);
    if (!client || !isBankSource(transaction.source) || !isCurrentBankTransactionId(transaction.source, transaction.id)
      || isLegacySurrogateBankTransactionId(transaction.source, transaction.id)) {
      unverifiedReceipts++;
      continue;
    }
    bankById.set(transaction.id, transaction);
    bankClients.set(transaction.id, client);
    const row = ensureRow(client, transaction.currency);
    row.received = (cents(row.received) + cents(transaction.amount)) / 100;
    row.receiptCount++;
    row.lastReceipt = !row.lastReceipt || date > row.lastReceipt ? date : row.lastReceipt;
    const dates = receiptDates.get(row.id) ?? new Set<string>();
    dates.add(date);
    receiptDates.set(row.id, dates);
  }
  // Count every allocation against its bank receipt, including allocations on excluded invoices.
  const bankAllocated = new Map<string, number>();
  const byInvoice = new Map<string, PaymentAllocation[]>();
  for (const allocation of input.allocations) {
    byInvoice.set(allocation.invoiceId, [...(byInvoice.get(allocation.invoiceId) ?? []), allocation]);
    if (allocation.transactionId) bankAllocated.set(allocation.transactionId,
      (bankAllocated.get(allocation.transactionId) ?? 0) + cents(allocation.amount));
  }
  // A linked migration surrogate may duplicate a current bank receipt. Do not train on
  // either invoice when that collision exists; this is an exclusion, never a new match.
  const receiptKey = (transaction: Transaction, client: Client) =>
    `${client.key}:${transaction.currency}:${transaction.date.slice(0, 10)}:${cents(transaction.amount)}`;
  const linkedSurrogates = new Set(input.transactions.flatMap(transaction => {
    if (!isBankSource(transaction.source) || !isLegacySurrogateBankTransactionId(transaction.source, transaction.id)
      || !bankAllocated.has(transaction.id)) return [];
    const client = resolve(transaction.matchedProviderId, [transaction.merchantName || transaction.counterparty, transaction.counterparty]);
    return client ? [receiptKey(transaction, client)] : [];
  }));
  const observations = new Map<string, Observation[]>();
  const reviewInvoices = new Set<string>();
  for (const invoice of input.invoices) {
    if (invoice.documentType !== "sales_invoice" || invoice.meritReplacementId) continue;
    const client = invoiceClient(invoice);
    if (!client) continue;
    if (invoice.status !== "paid") ensureRow(client, invoice.currency);
    const issueDate = day(invoice.issueDate);
    if (!issueDate) { reviewInvoices.add(invoice.id); continue; }
    const allocations = byInvoice.get(invoice.id) ?? [];
    const linkedIds = [...allocations.flatMap(allocation => allocation.transactionId ? [allocation.transactionId] : []), ...(invoice.transactionId ? [invoice.transactionId] : [])];
    if (linkedIds.some(id => {
      const bank = bankById.get(id);
      return bank && bank.date.slice(0, 10) < issueDate;
    })) { reviewInvoices.add(invoice.id); continue; }
    if (!allocations.length || allocations.some(allocation => {
      const bank = allocation.transactionId ? bankById.get(allocation.transactionId) : undefined;
      return !bank || allocation.amount <= 0 || bank.currency !== invoice.currency || allocation.currency !== invoice.currency
        || bankClients.get(bank.id)?.key !== client.key
        || linkedSurrogates.has(receiptKey(bank, client))
        || (bankAllocated.get(bank.id) ?? 0) > cents(bank.amount);
    })) continue;
    const settled = allocations.reduce((sum, allocation) => sum + cents(allocation.amount) + cents(allocation.settlementAdjustment ?? 0), 0);
    if (cents(invoice.amount) <= 0 || Math.abs(settled - cents(invoice.amount)) > 1) continue;
    const bankIds = [...new Set(allocations.map(allocation => allocation.transactionId!))];
    const paymentDate = bankIds.map(id => bankById.get(id)!.date.slice(0, 10)).sort().at(-1)!;
    const delay = days(issueDate, paymentDate);
    if (delay < 0 || delay > paymentHistoryDays) continue;
    const id = ensureRow(client, invoice.currency).id;
    observations.set(id, [...(observations.get(id) ?? []), { date: paymentDate, delay, bankIds }]);
  }
  // Keep explicitly tracked revenue clients visible even before their first identifiable receipt.
  for (const provider of input.providers) {
    const client = byProvider.get(provider.id);
    if (client && provider.tags.includes("Revenue partner") && provider.defaultCurrency) ensureRow(client, provider.defaultCurrency);
  }
  for (const row of rows.values()) {
    const dates = [...(receiptDates.get(row.id) ?? [])].sort();
    if (dates.length >= 3) row.receiptIntervalDays = median(dates.slice(1).map((date, index) => days(dates[index], date)));
    if (complete) row.bankPattern = estimateBankPaymentPattern(dates, toDate);
    // One payment event cannot artificially satisfy the minimum sample count via several invoices.
    const used = new Set<string>();
    const history = (observations.get(row.id) ?? []).sort((a, b) => b.date.localeCompare(a.date) || b.delay - a.delay).filter(item => {
      if (item.bankIds.some(id => used.has(id))) return false;
      item.bankIds.forEach(id => used.add(id));
      return true;
    }).slice(0, maximumPaymentSamples);
    row.sampleSize = history.length;
    if (history.length >= minimumPaymentSamples && complete) {
      const delays = history.map(item => item.delay);
      row.medianDays = median(delays);
      row.earliestDays = Math.min(...delays);
      row.latestDays = Math.max(...delays);
    }
  }
  return {
    fromDate, toDate, complete, unverifiedReceipts,
    clients: complete ? [...rows.values()].sort((a, b) => a.currency.localeCompare(b.currency) || b.received - a.received || a.id.localeCompare(b.id)) : [],
    predictions: input.invoices.filter(invoice => invoice.documentType === "sales_invoice" && invoice.status !== "paid").map(invoice => {
      const client = invoiceClient(invoice);
      const row = client ? rows.get(rowKey(client, invoice.currency)) : undefined;
      const base = { invoiceId: invoice.id, sampleSize: row?.sampleSize ?? 0 };
      if (!complete) return { ...base, state: "incomplete" };
      if (!client) return { ...base, state: "excluded" };
      if (reviewInvoices.has(invoice.id) || invoice.meritReplacementId) return { ...base, state: "review" };
      if (row?.medianDays === undefined) {
        if (!row?.bankPattern) return { ...base, state: "learning" };
        const bankPattern = bankPatternForInvoice(row.bankPattern, invoice.issueDate.slice(0, 10));
        return { ...base, state: "estimated", basis: "bank_pattern", bankPattern, predictedDate: bankPattern.expectedDate };
      }
      return { ...base, state: "estimated", basis: "invoice_history", medianDays: row.medianDays, earliestDays: row.earliestDays, latestDays: row.latestDays,
        predictedDate: shiftFinanceOperatingDate(invoice.issueDate.slice(0, 10), row.medianDays) };
    })
  };
}
