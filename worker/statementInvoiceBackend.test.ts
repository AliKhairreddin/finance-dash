import assert from "node:assert/strict";
import test from "node:test";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { statementCompanies } from "../shared/statements";
process.env.CONVEX_SERVICE_TOKEN = "invoice-test";
const auth = { serviceToken: "invoice-test", actor: "Ali" };
const modules = { "../convex/_generated/server.ts": () => import("../convex/_generated/server"), "../convex/statementInvoices.ts": () => import("../convex/statementInvoices") };
async function setup() {
  const t = convexTest(schema, modules);
  const fixture = await t.run(async ctx => {
    await ctx.db.insert("statementMembers", { actor: "Ali", companyIds: statementCompanies.map(c => c.id), manage: true });
    await ctx.db.insert("statementMembers", { actor: "Alaa", companyIds: ["artec"], manage: false });
    const storageId = await ctx.storage.store(new Blob(["%PDF-sample"], { type: "application/pdf" }));
    const templateId = await ctx.db.insert("statementInvoiceTemplates", { companyId: "amg-holding", storageId, fileName: "test.pdf", layoutJson: JSON.stringify({ headerPercent: 10, footerPercent: 10, sellerDetails: "Test seller", paymentDetails: "" }), approved: true, createdAt: Date.now(), actor: "Ali", model: "saved/model" });
    const base = { date: "2026-10-26", description: "Test service", source: "Test bank", amountMinor: "12100", currency: "EUR", direction: "in" as const, reviewReasons: [], origin: "manual" as const, status: "pending" as const, documentIds: [], revision: 1, createdAt: "2026-10-26", updatedAt: "2026-10-26", createdBy: "Ali", candidateKey: "test", intakeKey: "test" };
    const id = await ctx.db.insert("statementTransactions", { ...base, companyId: "amg-holding" }), other = await ctx.db.insert("statementTransactions", { ...base, companyId: "artec" });
    return { storageId, templateId, id, other };
  });
  const input = { ...auth, requestId: crypto.randomUUID(), ids: [fixture.id], instructions: "Describe the work simply", draftJson: JSON.stringify({ number: "TEST-001", date: "2026-10-26", dueDate: "", customer: "Customer", customerAddress: "Address", notes: "", currency: "USD", taxMode: "included", lines: [{ taxPercent: "21", amount: "999" }] }) };
  return { t, ...fixture, input };
}
test("invoice drafts use saved amounts, reject mixed-company selections and enforce access", async () => {
  const { t, input, other } = await setup();
  await assert.rejects(t.mutation(api.statementInvoices.begin, { ...input, ids: [...input.ids, other] }));
  await assert.rejects(t.mutation(api.statementInvoices.begin, { ...input, actor: "Alaa" }));
  const id = await t.mutation(api.statementInvoices.begin, input), row = JSON.parse(await t.query(api.statementInvoices.get, { ...auth, id }));
  assert.equal(row.draft.currency, "EUR"); assert.equal(row.draft.lines[0].amount, "121.00");
  await assert.rejects(t.query(api.statementInvoices.get, { ...auth, actor: "Alaa", id }));
  assert.equal(await t.mutation(api.statementInvoices.begin, input), id);
  await assert.rejects(t.mutation(api.statementInvoices.begin, { ...input, requestId: crypto.randomUUID() }));
});
test("invoice AI claims serialize generation and cannot change amounts or the selection", async () => {
  const { t, input } = await setup(), id = await t.mutation(api.statementInvoices.begin, input);
  assert.equal(await t.mutation(api.statementInvoices.claim, { ...auth, id, token: "one" }), true);
  assert.equal(await t.mutation(api.statementInvoices.claim, { ...auth, id, token: "two" }), false);
  await assert.rejects(t.mutation(api.statementInvoices.generated, { ...auth, id, token: "one", resultJson: '{"lines":[]}' }));
  await t.mutation(api.statementInvoices.generated, { ...auth, id, token: "one", model: "saved/model", resultJson: JSON.stringify({ lines: [{ transactionId: input.ids[0], description: "Clear wording", amount: "999" }] }) });
  const row = JSON.parse(await t.query(api.statementInvoices.get, { ...auth, id })); assert.equal(row.state, "draft"); assert.equal(row.draft.lines[0].amount, "121.00"); assert.equal(row.draft.lines[0].description, "Clear wording");
  await assert.rejects(t.mutation(api.statementInvoices.save, { ...auth, id, revision: 1, draftJson: row.draftJson }));
});
test("final invoices require review and unchanged source records, then become immutable", async () => {
  const { t, input, storageId } = await setup(), id = await t.mutation(api.statementInvoices.begin, input);
  await t.mutation(api.statementInvoices.claim, { ...auth, id, token: "one" });
  await t.mutation(api.statementInvoices.generated, { ...auth, id, token: "one", resultJson: JSON.stringify({ lines: [{ transactionId: input.ids[0], description: "Service" }] }) });
  await assert.rejects(t.mutation(api.statementInvoices.finalize, { ...auth, id, revision: 2, storageId, confirmed: false }));
  await t.run(async ctx => { await ctx.db.patch(input.ids[0], { revision: 2 }); });
  await assert.rejects(t.mutation(api.statementInvoices.finalize, { ...auth, id, revision: 2, storageId, confirmed: true }));
  await t.run(async ctx => { await ctx.db.patch(input.ids[0], { revision: 1 }); });
  await t.mutation(api.statementInvoices.finalize, { ...auth, id, revision: 2, storageId, confirmed: true });
  const row = JSON.parse(await t.query(api.statementInvoices.get, { ...auth, id })); assert.equal(row.state, "ready");
  await assert.rejects(t.mutation(api.statementInvoices.save, { ...auth, id, revision: 3, draftJson: row.draftJson }));
  await assert.rejects(t.mutation(api.statementInvoices.discard, { ...auth, id }));
});
test("discarding a draft preserves its history and releases the unused number", async () => {
  const { t, input } = await setup(), id = await t.mutation(api.statementInvoices.begin, input);
  await t.mutation(api.statementInvoices.discard, { ...auth, id });
  assert.equal(JSON.parse(await t.query(api.statementInvoices.get, { ...auth, id })).state, "discarded");
  assert.notEqual(await t.mutation(api.statementInvoices.begin, { ...input, requestId: crypto.randomUUID() }), id);
});
