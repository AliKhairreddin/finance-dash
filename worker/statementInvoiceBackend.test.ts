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
const pair = { ours: { name: "AMG Holding", address: "Our street 1, Amsterdam", vat: "NL-OUR" }, other: { name: "Example Supplier", address: "Their street 2, Rotterdam", vat: "NL-THEIR" }, description: "Monthly hosting service" };
test("no-example invoices save confirmed company-pair details and preserve the correct payment direction", async () => {
  const { t, input, templateId } = await setup();
  await t.run(async ctx => { await ctx.db.delete(templateId); await ctx.db.patch(input.ids[0], { direction: "out", counterparty: "Example Supplier" }); });
  const create = { ...input, plainDetailsJson: JSON.stringify(pair), remember: true, profileRevision: 0 };
  const id = await t.mutation(api.statementInvoices.begin, create);
  const row = JSON.parse(await t.query(api.statementInvoices.get, { ...auth, id }));
  assert.equal(row.templateUrl, null); assert.equal(row.draft.customer, pair.ours.name); assert.equal(row.draft.customerVat, pair.ours.vat);
  assert.ok(row.layout.sellerDetails.includes(pair.other.vat)); assert.ok(row.layout.sellerDetails.includes(pair.other.address));
  assert.equal(row.draft.lines[0].amount, "121.00"); assert.ok(row.instructions.includes(pair.description));
  assert.equal(await t.mutation(api.statementInvoices.begin, create), id);
  const profile = JSON.parse(await t.query(api.statementInvoices.profile, { ...auth, companyId: "amg-holding", otherName: "  EXAMPLE   SUPPLIER " }));
  assert.deepEqual(profile.details, pair); assert.equal(profile.revision, 1);
  assert.equal(JSON.parse(await t.query(api.statementInvoices.profile, { ...auth, companyId: "artec", otherName: pair.other.name })), null);
  await assert.rejects(t.query(api.statementInvoices.profile, { ...auth, actor: "Alaa", companyId: "amg-holding", otherName: pair.other.name }));
  const setupData = JSON.parse(await t.query(api.statementInvoices.setup, { ...auth, ids: input.ids }));
  assert.deepEqual(setupData.profiles[0].details, pair); assert.equal(setupData.hasExample, false);
});
test("remember is optional, stale updates cannot overwrite saved details, and failed creation rolls them back", async () => {
  const { t, input } = await setup();
  const create = { ...input, plainDetailsJson: JSON.stringify(pair), remember: false, profileRevision: 0 };
  const id = await t.mutation(api.statementInvoices.begin, create);
  assert.equal(JSON.parse(await t.query(api.statementInvoices.profile, { ...auth, companyId: "amg-holding", otherName: pair.other.name })), null);
  // Duplicate invoice number fails even after attempting to save a profile: the mutation is atomic.
  await assert.rejects(t.mutation(api.statementInvoices.begin, { ...create, remember: true, requestId: crypto.randomUUID() }));
  assert.equal(JSON.parse(await t.query(api.statementInvoices.profile, { ...auth, companyId: "amg-holding", otherName: pair.other.name })), null);
  await t.mutation(api.statementInvoices.discard, { ...auth, id });
  const second = await t.mutation(api.statementInvoices.begin, { ...create, remember: true, requestId: crypto.randomUUID() });
  const row = JSON.parse(await t.query(api.statementInvoices.get, { ...auth, id: second }));
  assert.equal(row.draft.customer, pair.other.name); assert.ok(row.layout.sellerDetails.includes(pair.ours.name));
  await t.mutation(api.statementInvoices.discard, { ...auth, id: second });
  await assert.rejects(t.mutation(api.statementInvoices.begin, { ...create, remember: true, requestId: crypto.randomUUID(), plainDetailsJson: JSON.stringify({ ...pair, description: "Overwrite" }) }), /Saved company details changed/);
  const updated = await t.mutation(api.statementInvoices.begin, { ...create, remember: true, profileRevision: 1, requestId: crypto.randomUUID(), plainDetailsJson: JSON.stringify({ ...pair, description: "Updated by user" }) });
  assert.ok(updated);
  assert.equal(JSON.parse(await t.query(api.statementInvoices.profile, { ...auth, companyId: "amg-holding", otherName: pair.other.name })).details.description, "Updated by user");
});
test("failed example analysis preserves the PDF and the previous approved example, and retry is serialized", async () => {
  const { t, input, storageId } = await setup();
  const id = await t.mutation(api.statementInvoices.uploadExample, { ...auth, companyId: "amg-holding", storageId, fileName: "replacement.pdf" });
  assert.equal(await t.mutation(api.statementInvoices.claimExample, { ...auth, id, token: "one" }), true);
  assert.equal(await t.mutation(api.statementInvoices.claimExample, { ...auth, id, token: "two" }), false);
  await t.mutation(api.statementInvoices.completeExample, { ...auth, id, token: "one", error: "AI timed out" });
  const saved = JSON.parse(await t.query(api.statementInvoices.template, { ...auth, id }));
  assert.equal(saved.storageId, storageId); assert.ok(saved.url); assert.equal(saved.analysisState, "failed");
  assert.equal(JSON.parse(await t.query(api.statementInvoices.setup, { ...auth, ids: input.ids })).hasExample, true);
  assert.ok(await t.mutation(api.statementInvoices.begin, input));
  await assert.rejects(t.mutation(api.statementInvoices.approveTemplate, { ...auth, id, confirmed: true, layoutJson: '{}' }));
  assert.equal(await t.mutation(api.statementInvoices.claimExample, { ...auth, id, token: "retry" }), true);
  await assert.rejects(t.mutation(api.statementInvoices.completeExample, { ...auth, id, token: "one", error: "Late result" }));
  await t.mutation(api.statementInvoices.completeExample, { ...auth, id, token: "retry", model: "saved/model", layoutJson: JSON.stringify({ headerPercent: 0, footerPercent: 0, sellerDetails: "Read seller", paymentDetails: "" }) });
  assert.equal(JSON.parse(await t.query(api.statementInvoices.template, { ...auth, id })).analysisState, "done");
});
