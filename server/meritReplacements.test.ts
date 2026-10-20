import assert from "node:assert/strict";
import test from "node:test";
import { claim, backup, phase, complete, fail } from "../convex/meritReplacements";
import { saveState } from "../convex/dashboard";
import { begin } from "../convex/integrationSync";
import { database, call } from "./convexTestDb";

const invoice = { id: "invoice", invoiceNumber: "2025/42", externalId: "old", providerId: "client", documentType: "sales_invoice", origin: "merit", source: "merit", status: "open", meritStatus: "open", meritDeliveryStatus: "delivered", amount: 100, currency: "USD", customerName: "Customer", description: "Original", issueDate: "2026-10-01", dueDate: "2026-10-15", transactionId: "transaction", revenueRunIds: ["run"], createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" };
function setup() {
  const db = database({ dashboardState: [{ _id: "state", _creationTime: 0, key: "default", invoices: [invoice], paymentAllocations: [], revenueRuns: [{ id: "run", invoiceId: invoice.id, externalInvoiceId: "old" }], updatedAt: invoice.updatedAt }] });
  Object.assign(db.db, { system: { get: async (id: string) => id === "bad" ? null : { size: 100, contentType: id === "original" ? "application/json" : "application/pdf" } } });
  return { ...db, ctx: { db: db.db }, auth: { serviceToken: "test-token", id: "operation", token: "owner" } };
}
async function token(run: () => Promise<void>) {
  const old = process.env.CONVEX_SERVICE_TOKEN; process.env.CONVEX_SERVICE_TOKEN = "test-token";
  try { await run(); } finally { if (old === undefined) delete process.env.CONVEX_SERVICE_TOKEN; else process.env.CONVEX_SERVICE_TOKEN = old; }
}
test("replacement reservation is exclusive, fenced, and rejects dashboard payments before locking", () => token(async () => {
  const h = setup(); const args = { ...h.auth, invoiceId: invoice.id, expectedUpdatedAt: invoice.updatedAt, after: invoice };
  await call(claim, h.ctx, args);
  await assert.rejects(call(claim, h.ctx, args), /pending replacement/);
  await assert.rejects(call(claim, h.ctx, { ...h.auth, invoiceId: invoice.id }), /still running/);
  await assert.rejects(call(phase, h.ctx, { ...h.auth, token: "other", expected: "preparing", next: "deleting" }), /elsewhere/);
  assert.equal(h.tables.dashboardState[0].invoices[0].meritReplacementId, "operation");
  const paid = setup(); paid.tables.dashboardState[0].paymentAllocations = [{ invoiceId: invoice.id, amount: 1 }];
  await assert.rejects(call(claim, paid.ctx, args), /unpaid/);
  assert.equal(paid.tables.meritInvoiceReplacements, undefined);
}));
test("destruction requires confirmed immutable backups and completion preserves every dashboard link", () => token(async () => {
  const h = setup(); const after = { ...invoice, amount: 200, description: "Changed" };
  await call(claim, h.ctx, { ...h.auth, invoiceId: invoice.id, expectedUpdatedAt: invoice.updatedAt, after });
  await assert.rejects(call(phase, h.ctx, { ...h.auth, expected: "preparing", next: "deleting" }), /Invalid/);
  await assert.rejects(call(backup, h.ctx, { ...h.auth, originalStorageId: "bad", pdfStorageId: "pdf", requestJson: "{}", after }), /not safely stored/);
  await call(backup, h.ctx, { ...h.auth, originalStorageId: "original", pdfStorageId: "pdf", requestJson: "{}", after });
  await assert.rejects(call(backup, h.ctx, { ...h.auth, originalStorageId: "original", pdfStorageId: "pdf", requestJson: "{}", after }), /already exists/);
  for (const [expected, next] of [["backed_up", "deleting"], ["deleting", "deleted"], ["deleted", "creating"], ["creating", "created"]]) await call(phase, h.ctx, { ...h.auth, expected, next, ...(next === "created" ? { externalId: "new" } : {}) });
  await assert.rejects(call(fail, h.ctx, { ...h.auth, abort: true, message: "error" }), /Cannot discard/);
  const result = await call(complete, h.ctx, { ...h.auth, invoice: { ...after, externalId: "new", id: "untrusted-id", transactionId: "wrong", invoiceNumber: "wrong", revenueRunIds: [] }, currentPdfStorageId: "current-pdf" });
  assert.equal(result.id, invoice.id); assert.equal(result.invoiceNumber, invoice.invoiceNumber); assert.equal(result.transactionId, invoice.transactionId); assert.deepEqual(result.revenueRunIds, invoice.revenueRunIds);
  assert.equal(result.amount, 200); assert.equal(result.externalId, "new"); assert.equal(result.meritReplacementId, undefined); assert.equal(result.meritPdfStorageId, "current-pdf");
  assert.equal(h.tables.dashboardState[0].revenueRuns[0].externalInvoiceId, "new");
  assert.equal(h.tables.meritInvoiceReplacements[0].phase, "completed"); assert.equal(h.tables.meritInvoiceReplacements[0].pdfStorageId, "pdf");
}));
test("generic dashboard saves cannot erase a pending replacement, its links, or add payments", () => token(async () => {
  const h = setup(); await call(claim, h.ctx, { ...h.auth, invoiceId: invoice.id, expectedUpdatedAt: invoice.updatedAt, after: invoice });
  const saved = h.tables.dashboardState[0];
  await assert.rejects(call(saveState, h.ctx, { serviceToken: "test-token", expectedUpdatedAt: saved.updatedAt, invoices: [], paymentAllocations: [] }), /replacement is pending/);
  await assert.rejects(call(saveState, h.ctx, { serviceToken: "test-token", expectedUpdatedAt: saved.updatedAt, invoices: saved.invoices, paymentAllocations: [{ invoiceId: invoice.id, amount: 1 }] }), /replacement is pending/);
}));
test("pre-delete failures unlock safely; expired owners cannot modify a recovered operation", () => token(async () => {
  const h = setup(); await call(claim, h.ctx, { ...h.auth, invoiceId: invoice.id, expectedUpdatedAt: invoice.updatedAt, after: invoice });
  h.tables.meritInvoiceReplacements[0].leaseUntil = 0;
  await call(claim, h.ctx, { ...h.auth, invoiceId: invoice.id, token: "new-owner" });
  await assert.rejects(call(fail, h.ctx, { ...h.auth, abort: true, message: "error" }), /elsewhere/);
  await call(fail, h.ctx, { ...h.auth, token: "new-owner", abort: true, message: "storage failure" });
  assert.equal(h.tables.dashboardState[0].invoices[0].meritReplacementId, undefined);
  assert.equal(h.tables.meritInvoiceReplacements[0].phase, "aborted");
}));
test("Merit sync and invoice replacement cannot overlap in either order", () => token(async () => {
  const h = setup(); await call(begin, h.ctx, { serviceToken: "test-token", key: "merit", leaseId: "sync" });
  await assert.rejects(call(claim, h.ctx, { ...h.auth, invoiceId: invoice.id, expectedUpdatedAt: invoice.updatedAt, after: invoice }), /sync is running/);
  h.tables.integrationSyncJobs[0].leaseExpiresAt = 0;
  await call(claim, h.ctx, { ...h.auth, invoiceId: invoice.id, expectedUpdatedAt: invoice.updatedAt, after: invoice });
  await assert.rejects(call(begin, h.ctx, { serviceToken: "test-token", key: "merit", leaseId: "next" }), /replacement is pending/);
}));
