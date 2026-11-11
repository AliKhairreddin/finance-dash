import assert from "node:assert/strict";
import test from "node:test";
import { calculatePaymentHistory } from "./paymentForecasts";
import { bankProviderTransactionId } from "./providerIdentity";
import { shiftFinanceOperatingDate } from "./operatingDate";
import type { Invoice, PaymentAllocation, Provider, Transaction } from "./types";

const client: Provider = { id: "client", name: "Media Client", type: "client", tags: [], aliases: [], source: "manual", createdAt: "2026-01-01" };
function invoice(id: string, patch: Partial<Invoice> = {}): Invoice {
  return { id, providerId: client.id, documentType: "sales_invoice", origin: "merit", customerName: client.name, amount: 100, currency: "USD", status: "paid", meritDeliveryStatus: "delivered", invoiceNumber: id, issueDate: "2026-10-01", dueDate: "2026-10-31", source: "merit", description: "Work", revenueRunIds: [], createdAt: "2026-10-01", updatedAt: "2026-10-01", ...patch };
}
function bank(id: string, patch: Partial<Transaction> = {}): Transaction {
  return { id: bankProviderTransactionId("slash", ["account", id]), source: "slash", accountName: "Business", date: "2026-10-04", description: "Client payment to Mojo Labs", rawName: client.name, counterparty: client.name, amount: 100, currency: "USD", direction: "in", status: "posted", category: "Media buying direct", matchedProviderId: client.id, ...patch };
}
function fixture(delays = [3, 3, 7]) {
  const invoices = delays.map((_, index) => invoice(`invoice-${index}`, { issueDate: `2026-${String(index + 1).padStart(2, "0")}-01`, paidAt: "2026-10-20" }));
  const transactions = invoices.map((item, index) => bank(String(index), { date: shiftFinanceOperatingDate(item.issueDate, delays[index]) }));
  const allocations: PaymentAllocation[] = invoices.map((item, index) => ({ id: `allocation-${index}`, invoiceId: item.id, transactionId: transactions[index].id, amount: 100, currency: "USD", source: "slash", mode: "manual", paidAt: "2026-10-20", createdAt: "2026-10-20" }));
  invoices.push(invoice("open", { status: "open", issueDate: "2026-11-01" }));
  return { providers: [client], invoices, transactions, allocations, asOfDate: "2026-11-10" };
}
const prediction = (data: ReturnType<typeof fixture>) => calculatePaymentHistory(data).predictions.find(item => item.invoiceId === "open")!;

test("uses actual bank dates, not recorded dates or the spacing between receipts", () => {
  const data = fixture();
  const result = calculatePaymentHistory(data);
  assert.deepEqual(result.predictions[0], { invoiceId: "open", state: "estimated", basis: "invoice_history", sampleSize: 3, medianDays: 3, earliestDays: 3, latestDays: 7, predictedDate: "2026-11-04" });
  assert.equal(result.clients[0].receiptCount, 3);
  assert.equal(result.clients[0].received, 300);
  assert.equal(result.clients[0].receiptIntervalDays, 32);
});

test("irregular bank receipts and fewer than three invoice matches cannot supply an estimate", () => {
  const data = fixture([3, 7]);
  data.transactions.push(bank("unmatched", { date: "2026-08-01" }));
  assert.equal(prediction(data).state, "learning");
  assert.equal(prediction(data).sampleSize, 2);
  assert.equal(prediction(data).predictedDate, undefined);
});

test("forecasts drafts provisionally from the invoice date and preserves past estimates", () => {
  const data = fixture();
  Object.assign(data.invoices.at(-1)!, { status: "draft", issueDate: "2026-10-01", sentAt: "2026-10-10" });
  assert.equal(prediction(data).predictedDate, "2026-10-04");
});

test("does not learn manual, partial, currency-mismatched, pending, unverified, or overallocated payments", () => {
  const variations: ((data: ReturnType<typeof fixture>) => void)[] = [
    data => { delete data.allocations[0].transactionId; },
    data => { data.allocations[0].amount = 90; },
    data => { data.transactions[0].currency = "EUR"; },
    data => { data.allocations[0].currency = "EUR"; },
    data => { data.transactions[0].status = "pending"; },
    data => { data.transactions[0].id = "old-uncertain-id"; data.allocations[0].transactionId = "old-uncertain-id"; },
    data => { data.allocations.push({ ...data.allocations[0], id: "duplicate", invoiceId: "other-invoice" }); }
  ];
  for (const mutate of variations) {
    const data = fixture(); mutate(data);
    assert.equal(prediction(data).sampleSize, 2);
    assert.notEqual(prediction(data).basis, "invoice_history");
    assert.equal(prediction(data).medianDays, undefined);
    if (prediction(data).state === "estimated") assert.equal(prediction(data).basis, "bank_pattern");
  }
});

test("a fully settled invoice uses the final bank receipt and the recorded noncash adjustment", () => {
  const data = fixture();
  data.allocations[0].amount = 60;
  data.transactions[0].amount = 60;
  const final = bank("remainder", { date: "2026-01-06", amount: 35 });
  data.transactions.push(final);
  data.allocations.push({ ...data.allocations[0], id: "remainder", amount: 35, settlementAdjustment: 5, transactionId: final.id });
  const report = calculatePaymentHistory(data);
  assert.equal(prediction(data).sampleSize, 3);
  assert.equal(prediction(data).medianDays, 5);
  assert.equal(report.clients[0].received, 295);
});

test("negative invoice lags are excluded and a draft linked to an older receipt needs review", () => {
  const data = fixture();
  data.transactions[0].date = "2025-12-20";
  data.invoices.at(-1)!.transactionId = data.transactions[0].id;
  const report = calculatePaymentHistory(data);
  assert.equal(report.clients[0].sampleSize, 2);
  assert.equal(report.predictions[0].state, "review");
  assert.equal(report.predictions[0].predictedDate, undefined);
});

test("ignores internal owners, investors and capital transfers, but not own-company recipient text", () => {
  for (const name of ["Mojo Labs LLC", "Benno's World", "Inch Digital", "LoveMeDo B.V.", "Emerix Capital", "One Love Media"]) {
    const data = fixture(); data.providers[0] = { ...client, name }; data.invoices.forEach(item => { item.customerName = name; });
    const report = calculatePaymentHistory(data);
    assert.equal(report.clients.length, 0, name);
    assert.equal(report.predictions[0].state, "excluded");
  }
  const data = fixture();
  data.transactions[0].category = "Capital movement";
  assert.equal(prediction(data).sampleSize, 2);
  assert.equal(calculatePaymentHistory(fixture()).clients[0].receiptCount, 3);
});

test("includes all business revenue categories for BuyGoods and ClickBank without a client count cap", () => {
  const data = fixture(); data.providers = []; data.transactions = []; data.invoices = []; data.allocations = [];
  for (let index = 0; index < 20; index++) {
    const provider = { ...client, id: `provider-${index}`, name: index === 0 ? "BuyGoods Inc" : index === 1 ? "ClickBank" : `External Client ${index}` };
    data.providers.push(provider);
    for (const category of ["Media buying direct", "Affiliate team revenue", "Partner network revenue"]) data.transactions.push(bank(`${index}-${category}`, { matchedProviderId: provider.id, counterparty: provider.name, category }));
  }
  const report = calculatePaymentHistory(data);
  assert.equal(report.clients.length, 20);
  assert.ok(report.clients.every(item => item.received === 300 && item.receiptCount === 3));
});

test("resolves MediaAlpha's QuoteLab payer alias without mistaking monthly receipts for net 30", () => {
  const data = fixture(); data.providers = []; data.allocations = [];
  data.transactions.forEach(item => { delete item.matchedProviderId; item.counterparty = "82311QUOTELAB L"; });
  data.invoices = [invoice("open", { providerId: undefined, customerName: "Media Alpha", status: "open" })];
  const report = calculatePaymentHistory(data);
  assert.equal(report.clients.length, 1);
  assert.equal(report.clients[0].name, "MediaAlpha");
  assert.equal(report.clients[0].receiptCount, 3);
  assert.equal(report.predictions[0].state, "estimated");
  assert.equal(report.predictions[0].basis, "bank_pattern");
  assert.equal(report.predictions[0].medianDays, undefined);
  assert.equal(report.predictions[0].sampleSize, 0);
  assert.ok(report.predictions[0].bankPattern);
});

test("deduplicates exact bank IDs and rejects invoice evidence colliding with a linked migration surrogate", () => {
  const data = fixture();
  data.transactions.push({ ...data.transactions[0] });
  assert.equal(calculatePaymentHistory(data).clients[0].received, 300);
  const surrogate = { ...data.transactions[0], id: bankProviderTransactionId("slash", ["legacy", "old-id"]) };
  data.transactions.push(surrogate);
  data.allocations.push({ ...data.allocations[0], id: "legacy", invoiceId: "legacy-invoice", transactionId: surrogate.id });
  assert.equal(calculatePaymentHistory(data).clients[0].received, 300);
  assert.equal(prediction(data).sampleSize, 2);
});

test("a bundled bank receipt is one independent observation, not three", () => {
  const data = fixture(); data.transactions = [bank("bundle", { amount: 300, date: "2026-05-01" })];
  data.allocations.forEach(item => { item.transactionId = data.transactions[0].id; });
  assert.equal(prediction(data).sampleSize, 1);
  assert.equal(prediction(data).state, "learning");
});

test("uses at most ten recent independent samples and keeps currency histories separate", () => {
  const data = fixture(Array.from({ length: 12 }, () => 3));
  data.invoices.slice(0, 12).forEach((item, index) => {
    item.issueDate = shiftFinanceOperatingDate("2026-01-01", index * 7);
    data.transactions[index].date = shiftFinanceOperatingDate(item.issueDate, index < 2 ? 25 : 3);
  });
  assert.equal(prediction(data).sampleSize, 10);
  assert.equal(prediction(data).medianDays, 3);
  data.invoices.at(-1)!.currency = "EUR";
  assert.equal(prediction(data).state, "learning");
  assert.equal(prediction(data).sampleSize, 0);
});

test("retains the full last calendar day, excludes out-of-window receipts, and never labels truncated reads complete", () => {
  const data = fixture();
  data.transactions.push(bank("end-of-day", { date: "2026-11-10T23:59:59Z" }));
  data.transactions.push(bank("old", { date: "2025-11-10" }));
  data.transactions.push(bank("future", { date: "2026-11-11" }));
  assert.equal(calculatePaymentHistory(data).clients[0].receiptCount, 4);
  const report = calculatePaymentHistory({ ...data, complete: false });
  assert.deepEqual(report.clients, []);
  assert.equal(report.predictions[0].state, "incomplete");
  assert.equal(report.predictions[0].predictedDate, undefined);
});

test("unmapped vendors and ambiguous aliases cannot become clients just from a revenue category", () => {
  const data = fixture(); data.transactions[0].matchedProviderId = undefined; data.transactions[0].counterparty = "Wise Cashback";
  assert.equal(prediction(data).sampleSize, 2);
  const ambiguous = fixture(); ambiguous.providers.push({ ...client, id: "another-client" });
  ambiguous.transactions.forEach(item => { delete item.matchedProviderId; });
  assert.equal(calculatePaymentHistory(ambiguous).clients[0].receiptCount, 0);
});

test("unmatched invoices use the next bank cycle and preserve contractual due dates and accounting records", () => {
  const data = fixture(); data.allocations = [];
  data.transactions.forEach((t, i) => { t.date = ['2026-09-01', '2026-10-01', '2026-10-31'][i]; });
  data.invoices = [invoice('open', { status: 'open', issueDate: '2026-11-10', dueDate: '2026-12-25' })];
  const original = structuredClone(data);
  const report = calculatePaymentHistory(data);
  assert.equal(report.predictions[0].basis, 'bank_pattern');
  assert.equal(report.predictions[0].predictedDate, '2026-11-30');
  assert.equal(report.predictions[0].sampleSize, 0);
  assert.equal(report.clients[0].bankPattern?.expectedDate, '2026-11-30');
  assert.deepEqual(data, original);
  const incomplete = calculatePaymentHistory({ ...data, complete: false });
  assert.equal(incomplete.predictions[0].bankPattern, undefined);
  assert.deepEqual(incomplete.clients, []);
});
