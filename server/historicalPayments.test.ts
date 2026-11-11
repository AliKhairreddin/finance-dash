import assert from "node:assert/strict";
import test from "node:test";
import { call, database } from "./convexTestDb";
import { reconcile } from "../convex/historicalPayments";
import { bankProviderTransactionId } from "../shared/providerIdentity";
import { wiseTransactionId, wiseCsvLedgerEntryIdentifier } from "../shared/wiseTransactionIdentity";
const auth = { serviceToken: "historical-test", expectedUpdatedAt: "2026-10-01T00:00:00Z" };
const id = wiseTransactionId("123", wiseCsvLedgerEntryIdentifier("TRANSFER-1234", "100", "USD", "CREDIT", "DEPOSIT"));
const matches = [{ invoiceId: "invoice", allocationId: "allocation", transactionId: id }];
function setup() {
  process.env.CONVEX_SERVICE_TOKEN = auth.serviceToken;
  return database({ dashboardState: [{ _id: "state", key: "default", updatedAt: auth.expectedUpdatedAt,
    invoices: [{ id: "invoice", status: "paid", providerId: "client", amount: 100, currency: "USD", issueDate: "2026-08-01", paidAt: "2026-09-01" }],
    paymentAllocations: [{ id: "allocation", invoiceId: "invoice", amount: 100, currency: "USD", paidAt: "2026-09-01", createdAt: "2026-09-01", mode: "manual", source: "other" }] }],
  bankConnectionBindings: [{ source: "wise", connectionKey: "connection" }],
  bankTransactions: [{ _id: "bank", id, identityVersion: 2, connectionKey: "connection", source: "wise", direction: "in", status: "posted", amount: 100, currency: "USD", date: "2026-08-05", wiseEntity: "dn", matchedProviderId: "client", accountName: "Wise USD" }] });
}
test("reconciliation links an existing settlement without changing balances, cash or creation dates", async () => {
  const ctx = setup();
  const result = await call(reconcile, ctx, { ...auth, matches });
  assert.equal(result.matched, 1);
  const state = ctx.tables.dashboardState[0];
  assert.equal(state.paymentAllocations.length, 1);
  assert.equal(state.paymentAllocations[0].amount, 100);
  assert.equal(state.paymentAllocations[0].createdAt, "2026-09-01");
  assert.equal(state.paymentAllocations[0].transactionId, id);
  assert.equal(state.invoices[0].status, "paid");
  assert.equal(state.invoices[0].amount, 100);
  assert.equal(state.invoices[0].paidAt, "2026-08-05");
  assert.equal(ctx.tables.bankTransactions[0].amount, 100);
  assert.equal(ctx.tables.bankTransactions[0].matchedInvoiceId, "invoice");
});
test("a deliberate old-import repair requires the exact underlying transfer and preserves adjustments", async () => {
  const ctx = setup();
  const oldId = bankProviderTransactionId("wise", ["legacy", "wise-csv-USD-transfer1234"]);
  ctx.tables.bankTransactions.push({ ...ctx.tables.bankTransactions[0], _id: "old", id: oldId, matchedInvoiceId: "invoice" });
  const state = ctx.tables.dashboardState[0];
  Object.assign(state.invoices[0], { amount: 106.11, transactionId: oldId });
  Object.assign(state.paymentAllocations[0], { transactionId: oldId, settlementAdjustment: 6.11 });
  await call(reconcile, ctx, { ...auth, matches });
  assert.equal(state.paymentAllocations[0].settlementAdjustment, 6.11);
  assert.equal(state.paymentAllocations[0].amount, 100);
  assert.equal(ctx.tables.bankTransactions[1].matchedInvoiceId, undefined);
});
test("invalid evidence, double allocations and stale plans reject the whole operation", async () => {
  const changes = [
    (ctx: ReturnType<typeof setup>) => { ctx.tables.bankTransactions[0].matchedProviderId = "other"; },
    (ctx: ReturnType<typeof setup>) => { ctx.tables.bankTransactions[0].amount = 99; },
    (ctx: ReturnType<typeof setup>) => { ctx.tables.bankTransactions[0].connectionKey = "inactive"; },
    (ctx: ReturnType<typeof setup>) => { ctx.tables.bankTransactions[0].date = "2026-07-30"; },
    (ctx: ReturnType<typeof setup>) => { ctx.tables.bankTransactions[0].currency = "EUR"; },
    (ctx: ReturnType<typeof setup>) => { ctx.tables.bankTransactions[0].status = "pending"; },
    (ctx: ReturnType<typeof setup>) => { ctx.tables.dashboardState[0].invoices[0].meritReplacementId = "locked"; },
    (ctx: ReturnType<typeof setup>) => { ctx.tables.dashboardState[0].updatedAt = "changed"; },
    (ctx: ReturnType<typeof setup>) => { ctx.tables.dashboardState[0].paymentAllocations.push({ id: "other", invoiceId: "other", transactionId: id }); },
    (ctx: ReturnType<typeof setup>) => { ctx.tables.dashboardState[0].paymentAllocations.push({ id: "other", invoiceId: "other", transactionId: bankProviderTransactionId("wise", ["legacy", "wise-csv-USD-transfer1234"]) }); },
    (ctx: ReturnType<typeof setup>) => { const oldId = bankProviderTransactionId("wise", ["legacy", "wise-csv-USD-transfer9999"]); ctx.tables.bankTransactions.push({ ...ctx.tables.bankTransactions[0], _id: "old", id: oldId }); ctx.tables.dashboardState[0].paymentAllocations[0].transactionId = oldId; }
  ];
  for (const change of changes) {
    const ctx = setup(); change(ctx); const before = structuredClone(ctx.tables);
    await assert.rejects(call(reconcile, ctx, { ...auth, matches })); assert.deepEqual(ctx.tables, before);
  }
  const ctx = setup(), before = structuredClone(ctx.tables);
  for (const args of [{ ...auth, serviceToken: "wrong", matches }, { ...auth, matches: [...matches, ...matches] }, { ...auth, matches: [...matches, { invoiceId: "missing", allocationId: "missing", transactionId: "missing" }] }]) {
    await assert.rejects(call(reconcile, ctx, args)); assert.deepEqual(ctx.tables, before);
  }
});

test("Merit history storage requires its lease and preserves a populated period on empty or invalid refresh", async () => {
  const { save } = await import("../convex/meritHistory");
  process.env.CONVEX_SERVICE_TOKEN = auth.serviceToken;
  const row = { SIHId: "1", CustomerName: "Client", DocumentDate: "20260115", TotalSum: 100 };
  const args = { serviceToken: auth.serviceToken, leaseId: "lease", fromDate: "2026-01-01", toDate: "2026-01-31", recordsJson: JSON.stringify([row]) };
  const key = "merit-history:2026-01-01:2026-01-31";
  const ctx = database({ integrationSyncJobs: [{ _id: "lease", key, leaseId: "lease", leaseExpiresAt: Date.now() + 60000 }], meritHistoryReports: [{ _id: "history", key, ...args }] });
  for (const bad of [{ ...args, leaseId: "wrong" }, { ...args, serviceToken: "wrong" }, { ...args, recordsJson: "[]" }, { ...args, recordsJson: JSON.stringify([row, row]) }]) {
    const before = structuredClone(ctx.tables);
    await assert.rejects(call(save, ctx, bad)); assert.deepEqual(ctx.tables, before);
  }
  const result = await call(save, ctx, args);
  assert.equal(result.recordsJson, args.recordsJson); assert.ok(result.fetchedAt);
});

test("source-backed historical imports create a settled invoice with original dates and no extra bank cash", async () => {
  const { importSettled } = await import("../convex/historicalPayments");
  const make = () => {
    const ctx = setup();
    ctx.tables.dashboardState[0].providers = [{ id: "client", type: "client", meritCustomerId: "customer" }];
    ctx.tables.bankTransactions[0].category = "Media buying direct";
    ctx.tables.meritHistoryReports = [{ _id: "history", key: "merit-history:2026-08-01:2026-08-31", recordsJson: JSON.stringify([
      { SIHId: "source", CustomerId: "customer", CustomerName: "Client", InvoiceNo: "2026/100", DocumentDate: "2026-08-01T00:00:00", DueDate: "2026-08-31T00:00:00", TotalSum: 100, PaidAmount: 100, Paid: true, CurrencyCode: "USD" }
    ]) }];
    return ctx;
  };
  const args = { ...auth, matches: [{ fromDate: "2026-08-01", toDate: "2026-08-31", sourceId: "source", transactionId: id }] };
  const ctx = make(), before = structuredClone(ctx.tables);
  assert.equal((await call(importSettled, ctx, args)).imported, 1);
  const state = ctx.tables.dashboardState[0], invoice = state.invoices[1], payment = state.paymentAllocations[1];
  assert.deepEqual(state.invoices[0], before.dashboardState[0].invoices[0]);
  assert.deepEqual(state.paymentAllocations[0], before.dashboardState[0].paymentAllocations[0]);
  assert.equal(invoice.issueDate, "2026-08-01"); assert.equal(invoice.dueDate, "2026-08-31");
  assert.equal(invoice.status, "paid"); assert.ok(invoice.historicalImportedAt);
  assert.equal(invoice.amount - payment.amount, 0); assert.equal(payment.paidAt, "2026-08-05");
  assert.equal(ctx.tables.bankTransactions[0].amount, 100);
  await assert.rejects(call(importSettled, ctx, { ...args, expectedUpdatedAt: state.updatedAt }), /already exists/);
  for (const edit of [
    (c: ReturnType<typeof make>) => { c.tables.bankTransactions[0].amount = 99; },
    (c: ReturnType<typeof make>) => { c.tables.bankTransactions[0].matchedInvoiceId = "elsewhere"; },
    (c: ReturnType<typeof make>) => { c.tables.dashboardState[0].paymentAllocations[0].transactionId = id; },
    (c: ReturnType<typeof make>) => { c.tables.dashboardState[0].providers[0].meritCustomerId = "wrong"; },
    (c: ReturnType<typeof make>) => { c.tables.meritHistoryReports[0].recordsJson = c.tables.meritHistoryReports[0].recordsJson.replace('"Paid":true', '"Paid":false'); }
  ]) {
    const c = make(); edit(c); const original = structuredClone(c.tables);
    await assert.rejects(call(importSettled, c, args)); assert.deepEqual(c.tables, original);
  }
});
