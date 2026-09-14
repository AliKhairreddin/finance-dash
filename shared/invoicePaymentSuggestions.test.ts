import assert from "node:assert/strict";
import test from "node:test";
import { loadInvoicePaymentSuggestions, suggestInvoicePayments } from "./invoicePaymentSuggestions";
import type { Invoice, PaymentAllocation, Transaction, TransactionPage } from "./types";

const invoice: Invoice = {
  id: "invoice-1365", invoiceNumber: "2026/1365", customerName: "NAM NAM Media XO LTD",
  amount: 31600, currency: "EUR", entity: "dn", documentType: "sales_invoice", origin: "merit",
  status: "open", source: "merit", meritDeliveryStatus: "saved", description: "Media buying",
  issueDate: "2026-09-03", dueDate: "2026-09-10", revenueRunIds: [], createdAt: "2026-09-03", updatedAt: "2026-09-03"
};
const payment: Transaction = {
  id: "bank-payment", source: "revolut", accountName: "Main", date: "2026-09-10", amount: 31600,
  currency: "EUR", direction: "in", status: "settled", description: "Media buying services",
  counterparty: "From NAM NAM MEDIA XO LTD", rawName: "NAM NAM MEDIA XO LTD", category: "Partner network revenue"
};
const context = { invoice, invoices: [invoice], allocations: [], providers: [] };
const page = (transactions: Transaction[], cursor: string | null = null): TransactionPage => ({
  transactions, fromDate: "1900-01-01", toDate: "9999-12-31", direction: "in", continueCursor: cursor, isDone: !cursor
});

test("a unique exact payment is selected without changing invoice status or allocations", () => {
  const result = suggestInvoicePayments({ ...context, transactions: [payment] });
  assert.equal(result.recommendedTransactionId, payment.id);
  assert.equal(result.suggestions[0].kind, "exact");
  assert.equal(invoice.status, "open");
  assert.equal(invoice.transactionId, undefined);
  assert.deepEqual(context.allocations, []);
});

test("saved exact, AI, and manual invoice links are retrieved outside the first candidate page", async () => {
  for (const invoiceMatchSource of ["exact", "ai", "manual"] as const) {
    const result = await loadInvoicePaymentSuggestions({
      ...context, invoice: { ...invoice, transactionId: payment.id },
      getTransaction: async id => { assert.equal(id, payment.id); return { ...payment, invoiceMatchSource, matchedInvoiceId: invoice.id }; },
      getPage: async () => { throw new Error("A known match should be fetched directly"); }
    });
    assert.equal(result.recommendedTransactionId, payment.id);
    assert.equal(result.suggestions[0].kind, "linked");
  }
});

test("older pages are searched automatically before recommending a unique payment", async () => {
  const cursors: Array<string | null> = [];
  const result = await loadInvoicePaymentSuggestions({
    ...context, getTransaction: async () => null,
    getPage: async cursor => {
      cursors.push(cursor);
      return cursor === null ? page([{ ...payment, id: "unrelated", counterparty: "Other", rawName: "Other" }], "older") : page([payment]);
    }
  });
  assert.deepEqual(cursors, [null, "older"]);
  assert.equal(result.recommendedTransactionId, payment.id);
});

test("equal payments and competing invoices require manual choice", () => {
  assert.equal(suggestInvoicePayments({ ...context, transactions: [payment, { ...payment, id: "second" }] }).recommendedTransactionId, null);
  assert.equal(suggestInvoicePayments({ ...context, invoices: [invoice, { ...invoice, id: "other-invoice" }], transactions: [payment] }).recommendedTransactionId, null);
});

test("amount alone, wrong currency or entity, unsettled payments, and manual exclusions are not suggested", () => {
  const rejected: Partial<Transaction>[] = [
    { counterparty: "Other sender", rawName: "Other sender" }, { currency: "USD" }, { wiseEntity: "lmd" },
    { status: "pending" }, { direction: "out" }, { date: "2026-09-02" },
    { invoiceMatchSource: "manual" }, { matchedInvoiceId: "other-invoice" }
  ];
  for (const changes of rejected) {
    assert.deepEqual(suggestInvoicePayments({ ...context, transactions: [{ ...payment, ...changes }] }).suggestions, [], JSON.stringify(changes));
  }
});

test("partial allocations use the remaining bank and invoice balances; exhausted funds are excluded", () => {
  const allocation: PaymentAllocation = { id: "allocated", invoiceId: invoice.id, transactionId: payment.id, amount: 10000,
    currency: "EUR", source: "revolut", mode: "manual", paidAt: payment.date, createdAt: payment.date };
  const result = suggestInvoicePayments({ ...context, transactions: [payment], allocations: [allocation] });
  assert.equal(result.recommendedTransactionId, payment.id);
  assert.equal(result.suggestions[0].available, 21600);
  assert.equal(suggestInvoicePayments({ ...context, transactions: [payment], allocations: [{ ...allocation, amount: 31600 }] }).suggestions.length, 0);
});

test("fee differences are offered for review without preselection", () => {
  const result = suggestInvoicePayments({ ...context, transactions: [{ ...payment, amount: 31550 }] });
  assert.equal(result.suggestions[0].kind, "tolerance");
  assert.equal(result.recommendedTransactionId, null);
});

test("a bounded or stalled search cannot silently recommend an incompletely checked payment", async () => {
  let pages = 0;
  const result = await loadInvoicePaymentSuggestions({
    ...context, getTransaction: async () => null,
    getPage: async () => page(pages++ === 0 ? [payment] : [], `page-${pages}`)
  });
  assert.equal(pages, 20);
  assert.equal(result.searchComplete, false);
  assert.equal(result.recommendedTransactionId, null);
  await assert.rejects(loadInvoicePaymentSuggestions({
    ...context, getTransaction: async () => null, getPage: async () => page([], "same-cursor")
  }), /did not advance/);
});
