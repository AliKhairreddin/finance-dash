import assert from "node:assert/strict";
import test from "node:test";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { internal } from "../convex/_generated/api";
const modules = { "../convex/statementInvoices.ts": () => import("../convex/statementInvoices"), "../convex/_generated/server.ts": () => import("../convex/_generated/server") };
async function fixture() {
  const t = convexTest(schema, modules);
  const saved = await t.run(async ctx => {
    await ctx.db.insert("statementMembers", { actor: "Ali", companyIds: ["inch-engineering"], manage: true, permissions: ["generate"] });
    await ctx.db.insert("statementMembers", { actor: "Alaa", companyIds: ["inch-engineering"], manage: false, permissions: ["generate"] });
    const expectedStorageId = await ctx.storage.store(new Blob(["%PDF-old"], { type: "application/pdf" }));
    const storageId = await ctx.storage.store(new Blob(["%PDF-new-render"], { type: "application/pdf" }));
    // convex-test currently omits contentType when storing Blob metadata.
    await (ctx.db as unknown as { patch(id: string, fields: Record<string, unknown>): Promise<void> }).patch(storageId, { contentType: "application/pdf" });
    const transactionId = await ctx.db.insert("statementTransactions", { companyId: "inch-engineering", date: "2026-10-10", description: "Hosting", source: "Bank", amountMinor: "12100", currency: "EUR", direction: "out", reviewReasons: [], origin: "manual", status: "pending", documentIds: [], revision: 1, createdAt: "2026-10-10", updatedAt: "2026-10-10", createdBy: "Ali", candidateKey: "one", intakeKey: "one" });
    const id = await ctx.db.insert("statementInvoices", { companyId: "inch-engineering", documentType: "internal_support", requestId: "one", draftJson: JSON.stringify({ number: "INCH-SUP-2026-000001", amount: "121.00" }), sourceJson: JSON.stringify([{ transactionId, revision: 1 }]), plainLayoutJson: "{}", instructions: "", state: "ready", leaseUntil: 0, revision: 3, createdAt: 1, updatedAt: 1, actor: "Ali", number: "INCH-SUP-2026-000001", storageId: expectedStorageId });
    const documentId = await ctx.db.insert("statementDocuments", { companyId: "inch-engineering", generatedInvoiceId: id, fileName: "INCH-SUP-2026-000001.pdf", contentType: "application/pdf", size: 8, storageId: expectedStorageId, contentHash: `generated:${id}`, origin: "file", status: "ready", documentType: "supporting", evidence: [], reviewReasons: [], attempts: 0, quarantined: false, transactionIds: [transactionId], createdAt: "2026-10-10", updatedAt: "2026-10-10" });
    await ctx.db.patch(transactionId, { documentIds: [documentId], generatedInvoiceId: id, generatedInvoiceNumber: "INCH-SUP-2026-000001", generatedInvoiceState: "ready" });
    const linkId = await ctx.db.insert("statementLinks", { transactionId, documentId, amountMinor: "12100", currency: "EUR", note: "Existing allocation", createdBy: "Ali", createdAt: "2026-10-10" });
    return { args: { actor: "Ali", id, expectedRevision: 3, expectedStorageId, storageId }, documentId, transactionId, linkId };
  });
  const snapshot = () => t.run(async ctx => ({ invoice: await ctx.db.get(saved.args.id), document: await ctx.db.get(saved.documentId), transaction: await ctx.db.get(saved.transactionId), link: await ctx.db.get(saved.linkId) }));
  return { t, ...saved, snapshot };
}
test("PDF refresh changes both file references, preserves financial records, retains the original and is idempotent", async () => {
  const { t, args, documentId, snapshot } = await fixture(), before = await snapshot();
  assert.deepEqual(await t.mutation(internal.statementInvoices.replaceRenderedPdf, args), { changed: true, documentId });
  const after = await snapshot();
  assert.deepEqual(after.transaction, before.transaction);
  assert.deepEqual(after.link, before.link);
  assert.deepEqual(after.invoice, { ...before.invoice, storageId: args.storageId, revision: 4, updatedAt: after.invoice!.updatedAt });
  assert.deepEqual(after.document, { ...before.document, storageId: args.storageId, size: 15, updatedAt: after.document!.updatedAt });
  assert.deepEqual(await t.mutation(internal.statementInvoices.replaceRenderedPdf, args), { changed: false, documentId });
  await t.run(async ctx => {
    assert.ok(await ctx.storage.getUrl(args.expectedStorageId));
    const audit = await ctx.db.query("statementAudit").withIndex("by_entityId", q => q.eq("entityId", args.id)).collect();
    assert.equal(audit.length, 1);
    assert.equal(JSON.parse(audit[0].details).previousStorageId, args.expectedStorageId);
  });
});
test("PDF refresh rejects concurrent changes and mismatched attachments without partial writes", async () => {
  const { t, args, documentId, snapshot } = await fixture();
  const before = await snapshot();
  await assert.rejects(t.mutation(internal.statementInvoices.replaceRenderedPdf, { ...args, expectedRevision: 2 }), /changed/);
  assert.deepEqual(await snapshot(), before);
  await t.run(ctx => ctx.db.patch(documentId, { storageId: args.storageId }));
  const changed = await snapshot();
  await assert.rejects(t.mutation(internal.statementInvoices.replaceRenderedPdf, args), /changed/);
  assert.deepEqual(await snapshot(), changed);
});
test("PDF refresh is limited to administrators, saved internal records and stored PDFs", async () => {
  const { t, args, snapshot } = await fixture(), before = await snapshot();
  await assert.rejects(t.mutation(internal.statementInvoices.replaceRenderedPdf, { ...args, actor: "Alaa" }), /administrator/);
  const invalid = await t.run(async ctx => {
    const id = await ctx.storage.store(new Blob(["text"], { type: "text/plain" }));
    await (ctx.db as unknown as { patch(id: string, fields: Record<string, unknown>): Promise<void> }).patch(id, { contentType: "text/plain" });
    return id;
  });
  await assert.rejects(t.mutation(internal.statementInvoices.replaceRenderedPdf, { ...args, storageId: invalid }), /PDF/);
  assert.deepEqual(await snapshot(), before);
  await t.run(ctx => ctx.db.patch(args.id, { documentType: "sales_invoice" }));
  await assert.rejects(t.mutation(internal.statementInvoices.replaceRenderedPdf, args), /internal record/);
});
