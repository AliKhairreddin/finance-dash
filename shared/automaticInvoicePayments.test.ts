import assert from "node:assert/strict";
import test from "node:test";
import { reconcileAiInvoicePayments, reconcileExactInvoicePayments } from "./income";
import type { Invoice, PaymentAllocation, Transaction } from "./types";

const invoice: Invoice = {
  id: "invoice-1", invoiceNumber: "INV-100", customerName: "Client Ltd", amount: 1000, currency: "EUR", entity: "dn",
  documentType: "sales_invoice", origin: "merit", status: "open", meritStatus: "open", source: "merit",
  meritDeliveryStatus: "saved", description: "Services", issueDate: "2026-09-01", dueDate: "2026-09-10",
  revenueRunIds: [], createdAt: "2026-09-01", updatedAt: "2026-09-01"
};
const payment: Transaction = {
  id: "payment-1", source: "revolut", accountName: "Main", date: "2026-09-10", amount: 1000,
  currency: "EUR", direction: "in", status: "settled", description: "INV-100", rawName: "Client Ltd",
  counterparty: "Client Ltd", category: "Partner network revenue"
};
const context = { invoices: [invoice], transactions: [payment], allocations: [], providers: [], now: new Date("2026-09-14T12:00:00Z") };

test("Wise, Revolut, and Slash exact incoming payments automatically settle invoices with bank details", () => {
  for (const source of ["wise", "revolut", "slash"] as const) {
    const result = reconcileExactInvoicePayments({ ...context, transactions: [{ ...payment, source }] });
    assert.equal(result.paid, 1);
    assert.equal(result.invoices[0].status, "paid");
    assert.equal(result.invoices[0].paidAt, payment.date);
    assert.equal(result.invoices[0].meritStatus, "open");
    assert.deepEqual(result.allocations[0], {
      id: `payment-auto-${invoice.id}-${payment.id}`, invoiceId: invoice.id, transactionId: payment.id,
      amount: 1000, currency: "EUR", source, accountName: "Main", reference: payment.id, mode: "automatic",
      confidence: 1, matchReason: "Exact amount and currency with a confirmed invoice match",
      paidAt: payment.date, createdAt: context.now.toISOString()
    });
    const again = reconcileExactInvoicePayments({ ...context, invoices: result.invoices, transactions: result.transactions, allocations: result.allocations });
    assert.equal(again.paid, 0);
    assert.equal(again.matched, 0);
    assert.deepEqual(again.allocations, result.allocations);
  }
});

test("existing exact and confirmed links are settled even when no new match is created", () => {
  for (const invoiceMatchSource of ["exact", "ai", "manual"] as const) {
    const result = reconcileExactInvoicePayments({ ...context, invoices: [{ ...invoice, transactionId: payment.id }],
      transactions: [{ ...payment, matchedInvoiceId: invoice.id, invoiceMatchSource, invoiceMatchConfidence: 0.98 }] });
    assert.equal(result.matched, 0);
    assert.equal(result.paid, 1);
    assert.equal(result.allocations[0].transactionId, payment.id);
  }
});

test("duplicate payments and competing invoices are not resolved by array order", () => {
  for (const transactions of [[payment, { ...payment, id: "other-payment" }], [{ ...payment, id: "other-payment" }, payment]]) {
    const result = reconcileExactInvoicePayments({ ...context, transactions });
    assert.equal(result.matched, 0);
    assert.equal(result.paid, 0);
    assert.deepEqual(result.allocations, []);
  }
  const result = reconcileExactInvoicePayments({ ...context, invoices: [invoice, { ...invoice, id: "other-invoice" }] });
  assert.equal(result.matched, 0);
  assert.equal(result.paid, 0);
});

test("the exact payment wins over a fee-different candidate regardless of transaction order", () => {
  const feePayment = { ...payment, id: "fee-payment", amount: 950 };
  for (const transactions of [[feePayment, payment], [payment, feePayment]]) {
    const result = reconcileExactInvoicePayments({ ...context, transactions });
    assert.equal(result.paid, 1);
    assert.equal(result.invoices[0].transactionId, payment.id);
    assert.equal(result.toleranceMatched, 0);
  }
});

test("fees, underpayments, overpayments, and even a cent difference never silently close an invoice", () => {
  for (const amount of [925, 999.99, 1000.01, 1075]) {
    const result = reconcileExactInvoicePayments({ ...context, transactions: [{ ...payment, amount }] });
    assert.equal(result.paid, 0);
    assert.equal(result.invoices[0].status, "open");
    assert.deepEqual(result.allocations, []);
  }
});

test("linked transactions still require correct bank status, direction, currency, entity, and date", () => {
  for (const change of [{ status: "pending" }, { direction: "out" }, { currency: "USD" }, { wiseEntity: "lmd" },
    { date: "2026-08-31" }, { invoiceMatchSource: "manual", matchedInvoiceId: undefined },
    { invoiceMatchSource: "ai", invoiceMatchConfidence: 0.7 }, { matchedInvoiceId: "other-invoice" }] satisfies Partial<Transaction>[]) {
    const result = reconcileExactInvoicePayments({ ...context, invoices: [{ ...invoice, transactionId: payment.id }],
      transactions: [{ ...payment, matchedInvoiceId: invoice.id, invoiceMatchSource: "exact", ...change }] });
    assert.equal(result.paid, 0, JSON.stringify(change));
    assert.deepEqual(result.allocations, []);
  }
});

test("a final exact payment settles a partial invoice without duplicating previous allocations", () => {
  const prior: PaymentAllocation = { id: "prior-payment", invoiceId: invoice.id, amount: 400, currency: "EUR", source: "cash", mode: "manual", paidAt: "2026-09-05", createdAt: "2026-09-05" };
  const result = reconcileExactInvoicePayments({ ...context, transactions: [{ ...payment, amount: 600 }], allocations: [prior] });
  assert.equal(result.paid, 1);
  assert.deepEqual(result.allocations[0], prior);
  assert.equal(result.allocations[1].amount, 600);
  assert.equal(result.invoices[0].status, "paid");
});

test("allocated funds, draft invoices, and unrelated paid records are left unchanged", () => {
  const allocated: PaymentAllocation = { id: "used-payment", invoiceId: "other-invoice", transactionId: payment.id, amount: 1000, currency: "EUR", source: "revolut", mode: "manual", paidAt: payment.date, createdAt: payment.date };
  const result = reconcileExactInvoicePayments({ ...context, allocations: [allocated] });
  assert.equal(result.paid, 0);
  assert.deepEqual(result.allocations, [allocated]);
  for (const status of ["draft", "paid"] as const) {
    const untouched = { ...invoice, status };
    const skipped = reconcileExactInvoicePayments({ ...context, invoices: [untouched] });
    assert.equal(skipped.paid, 0);
    assert.deepEqual(skipped.invoices, [untouched]);
  }
});

test("an invoice's existing transaction link cannot be claimed by another invoice", () => {
  const linkedInvoice = { ...invoice, id: "already-linked-invoice", transactionId: payment.id, status: "paid" as const };
  const existing = { ...context, invoices: [linkedInvoice, invoice] };
  const exact = reconcileExactInvoicePayments(existing);
  const ai = reconcileAiInvoicePayments({ ...existing, matches: [{ invoiceId: invoice.id, transactionId: payment.id, confidence: 0.99, reason: "Same amount" }] });
  for (const result of [exact, ai]) {
    assert.equal(result.matched, 0);
    assert.equal(result.paid, 0);
    assert.deepEqual(result.invoices, existing.invoices);
    assert.deepEqual(result.allocations, []);
  }
});

test("high-confidence AI matches settle exact amounts; non-exact or rejected AI matches do not", () => {
  for (const [amount, confidence, expectedPaid] of [[1000, 0.96, 1], [925, 0.96, 0], [1000, 0.7, 0]]) {
    const result = reconcileAiInvoicePayments({ ...context, transactions: [{ ...payment, amount }],
      matches: [{ invoiceId: invoice.id, transactionId: payment.id, confidence, reason: "Client and reference agree" }] });
    assert.equal(result.paid, expectedPaid);
    assert.equal(result.allocations.length, expectedPaid);
    if (expectedPaid) assert.match(result.allocations[0].matchReason ?? "", /^AI:/);
  }
});
