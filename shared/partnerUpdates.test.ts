import assert from "node:assert/strict";
import test from "node:test";
import { buildPartnerReportData, canSharePartnerUpdates, partnerInvoiceRows } from "./partnerUpdates";
import type { CashFlowSnapshot, DashboardSnapshot, Invoice, PaymentAllocation } from "./types";

const snapshot = (date: string, updatedAt = date): CashFlowSnapshot => ({ id: date, asOfDate: date, updatedAt, createdAt: date, cashAccounts: [], receivables: [], openBalances: [], payables: [], investments: [] });
const invoice = { id: "open", documentType: "sales_invoice", invoiceNumber: "INV1", dueDate: "2026-09-20", customerName: "Company", status: "open", amount: 100, currency: "USD" } as Invoice;
const dashboard = { asOf: "2026-09-09T12:00:00Z", invoices: [invoice], paymentAllocations: [], providers: [], receivables: [], fxRates: [], cashFlowSnapshots: [snapshot("2026-09-08")] } as unknown as DashboardSnapshot;

test("both share triggers use the latest saved position, preserving edits, with current invoices", () => {
  const edited = { ...snapshot("2026-09-09", "2026-09-09T11:00:00Z"), notes: "Reviewed", cashAccounts: [{ id: "bank", name: "Cash", amount: 123, currency: "USD" }] };
  const report = buildPartnerReportData({ ...dashboard, cashFlowSnapshots: [snapshot("2026-09-09", "2026-09-09T10:00:00Z"), edited, snapshot("2026-09-08")] });
  assert.equal(report.cashFlow, edited);
  assert.equal(report.capturedAt, dashboard.asOf);
  assert.equal(report.invoices[0].amount, 100);
  assert.throws(() => buildPartnerReportData({ ...dashboard, cashFlowSnapshots: [] }), /Save a cash-flow snapshot/);
});

test("open-invoice images retain drafts, manual receivables and remaining payments, excluding settled invoices and bills", () => {
  const rows = partnerInvoiceRows({ ...dashboard,
    invoices: [invoice, { ...invoice, id: "draft", status: "draft" }, { ...invoice, id: "paid", status: "paid" }, { ...invoice, id: "settled" }, { ...invoice, id: "bill", documentType: "supplier_bill" }],
    paymentAllocations: [{ invoiceId: "open", amount: 30, currency: "USD" }, { invoiceId: "settled", amount: 100, currency: "USD" }] as PaymentAllocation[],
    receivables: [{ id: "manual", name: "Commission", source: "manual", balance: 25, currency: "EUR" }]
  });
  assert.deepEqual(rows.map(row => [row.status, row.amount, row.currency]), [["Open", 70, "USD"], ["Draft", 100, "USD"], ["Receivable", 25, "EUR"]]);
});

test("only Ali and Ali M can trigger partner sharing", () => {
  assert.equal(canSharePartnerUpdates(" Ali  M "), true);
  assert.equal(canSharePartnerUpdates("ALI"), true);
  for (const name of [undefined, "Amin", "Sani", "Ben", "Meet"]) assert.equal(canSharePartnerUpdates(name), false);
});
