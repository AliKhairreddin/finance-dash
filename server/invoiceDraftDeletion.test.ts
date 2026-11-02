import assert from "node:assert/strict";
import test from "node:test";
import { call, database } from "./convexTestDb";
import { remove } from "../convex/invoiceDrafts";

const auth = { serviceToken: "draft-deletion-test" };
const draft = { id: "invoice", invoiceNumber: "2026/1433", status: "draft", origin: "revenue", meritDeliveryStatus: "not-sent", revenueRunIds: ["run"], transactionId: "bank" };
const setup = () => {
  process.env.CONVEX_SERVICE_TOKEN = auth.serviceToken;
  return database({ dashboardState: [{ _id: "state", key: "default", updatedAt: "2026-11-01T00:00:00Z", invoices: [draft], paymentAllocations: [],
    revenueRuns: [{ id: "run", invoiceId: "invoice", status: "drafted", revenue: 100 }], revenueAccruals: [{ id: "accrual", invoiceId: "invoice", status: "drafted", amount: 100 }] }],
    bankTransactions: [{ _id: "bank-row", id: "bank", date: "2026-10-19", amount: 100, matchedInvoiceId: "invoice", matchedProviderId: "company", confidence: 1, matchReason: "Draft created" }] });
};
test("deletion unlinks drafts atomically, preserves earned revenue and bank money, and marks the period for manual re-drafting", async () => {
  const ctx = setup();
  assert.deepEqual(await call(remove, ctx, { ...auth, invoiceIds: ["invoice"] }), [draft]);
  const state = ctx.tables.dashboardState[0], bank = ctx.tables.bankTransactions[0];
  assert.equal(state.invoices.length, 0); assert.equal(state.revenueRuns[0].revenue, 100);
  assert.equal(state.revenueRuns[0].invoiceId, undefined); assert.equal(state.revenueRuns[0].status, "pulled"); assert.ok(state.revenueRuns[0].draftDeletedAt);
  assert.equal(state.revenueAccruals[0].amount, 100); assert.equal(state.revenueAccruals[0].invoiceId, undefined);
  assert.equal(bank.amount, 100); assert.equal(bank.matchedProviderId, "company"); assert.equal(bank.matchedInvoiceId, undefined);
  assert.equal(ctx.tables.bankLedgerRevision.length, 2);
});
test("invalid batches, recorded payments, external invoices and in-flight writes preserve all records", async () => {
  for (const patch of [{ externalId: "merit" }, { meritCreationReservedAt: "now" }, { sendError: "Uncertain create" }, { meritReplacementId: "job" }, { status: "paid" }, { allocation: true }]) {
    const ctx = setup(); const { allocation, ...invoicePatch } = patch;
    Object.assign(ctx.tables.dashboardState[0].invoices[0], invoicePatch);
    if (allocation) ctx.tables.dashboardState[0].paymentAllocations.push({ invoiceId: "invoice", amount: 100 });
    const before = structuredClone(ctx.tables);
    await assert.rejects(call(remove, ctx, { ...auth, invoiceIds: ["invoice"] }));
    assert.deepEqual(ctx.tables, before);
  }
  const ctx = setup(), before = structuredClone(ctx.tables);
  for (const invoiceIds of [[], ["invoice", "missing"], ["invoice", "invoice"]]) await assert.rejects(call(remove, ctx, { ...auth, invoiceIds }));
  await assert.rejects(call(remove, ctx, { serviceToken: "wrong", invoiceIds: ["invoice"] }), /Unauthorized/);
  assert.deepEqual(ctx.tables, before);
});
