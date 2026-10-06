import assert from "node:assert/strict";
import test from "node:test";
import { emptyPaymentTransactionFilters, filterPaymentTransactions, paymentTransactionAccountKey, type PaymentTransactionFilters, type PaymentTransactionRow } from "./invoicePaymentSearch";
import { availableInvoicePaymentTransactions } from "./invoicePaymentSuggestions";
import type { Invoice } from "./types";

const row: PaymentTransactionRow = {
  transaction: { id: "REF-2026/1400", source: "wise", accountId: "usd-dn", accountName: "Operating USD", date: "2026-09-30T23:59:00Z", amount: 20000, currency: "USD", direction: "in", status: "posted", description: "September marketing services", counterparty: "Média Holdings", rawName: "MEDIA HOLDINGS LTD", category: "Revenue" },
  allocated: 3302.52, available: 16697.48
};
const rows = [row, { ...row, transaction: { ...row.transaction, id: "another-bank", source: "revolut" as const, accountId: "usd-revolut", date: "2026-10-01", amount: 5000 }, allocated: 0, available: 5000 }];
const search = (filters: Partial<PaymentTransactionFilters>) => filterPaymentTransactions(rows, { ...emptyPaymentTransactionFilters, ...filters }, 16697.48, new Set([row.transaction.id])).map(item => item.transaction.id);

test("payment search combines case-insensitive words across names, bank, account, reference and amount", () => {
  assert.deepEqual(search({ query: "MEDIA wise September" }), [row.transaction.id]);
  assert.deepEqual(search({ query: "2026/1400 operating" }), [row.transaction.id]);
  assert.deepEqual(search({ query: "16,697.48" }), [row.transaction.id]);
  assert.deepEqual(search({ query: "20,000.00" }), [row.transaction.id]);
  assert.deepEqual(search({ query: "media missing" }), []);
  assert.deepEqual(search({ query: "   " }), rows.map(item => item.transaction.id));
});

test("bank and account filters distinguish accounts with identical display names", () => {
  assert.deepEqual(search({ bank: "revolut" }), ["another-bank"]);
  assert.deepEqual(search({ account: paymentTransactionAccountKey(row) }), [row.transaction.id]);
  assert.deepEqual(search({ bank: "revolut", account: paymentTransactionAccountKey(row) }), []);
});

test("date bounds are inclusive and amount filters use available funds after allocations", () => {
  assert.deepEqual(search({ from: "2026-09-30", to: "2026-09-30", minimum: "16697.48", maximum: "16697.48" }), [row.transaction.id]);
  assert.deepEqual(search({ minimum: "19000" }), []);
  assert.deepEqual(search({ maximum: "5000" }), ["another-bank"]);
  assert.deepEqual(search({ from: "2026-10-02", to: "2026-09-01" }), []);
});

test("match filters find suggestions, exact remaining amounts and partial allocations", () => {
  for (const match of ["suggested", "exact", "partial"] as const) assert.deepEqual(search({ match }), [row.transaction.id]);
  const cents = [0, 0.01, -0.01, 0.02].map((difference, index) => ({ ...row, transaction: { ...row.transaction, id: String(index) }, available: row.available + difference }));
  assert.deepEqual(filterPaymentTransactions(cents, { ...emptyPaymentTransactionFilters, match: "exact" }, 16697.48, new Set()).map(item => item.transaction.id), ["0", "1", "2"]);
});

test("search cannot expose outgoing, wrong-currency, pending or fully allocated payments", () => {
  const invoice = { id: "invoice", currency: "USD" } as Invoice;
  const transactions = [row.transaction, { ...row.transaction, id: "out", direction: "out" as const }, { ...row.transaction, id: "eur", currency: "EUR" }, { ...row.transaction, id: "pending", status: "pending" as const }, { ...row.transaction, id: "spent", amount: 0 }, { ...row.transaction, id: "other-invoice", matchedInvoiceId: "different" }];
  const eligible = availableInvoicePaymentTransactions(invoice, transactions, []);
  assert.deepEqual(filterPaymentTransactions(eligible, emptyPaymentTransactionFilters, 16697.48, new Set()).map(item => item.transaction.id), [row.transaction.id]);
});
