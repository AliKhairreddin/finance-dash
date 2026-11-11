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
