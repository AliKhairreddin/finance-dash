import assert from "node:assert/strict";
import test from "node:test";
import { assertUnpaidInvoice, prepareReplacement, runReplacement, verifyReplacement, type ReplacementJob, type ReplacementPort } from "./meritReplacement";
import { reconcileMeritInvoices } from "./merit";
import type { Invoice } from "./types";
import { replacementRequest, MeritRequestRejected } from "./meritReplacementRequest";

export const before: Invoice = { id: "dashboard-invoice", externalId: "old-merit-id", invoiceNumber: "2025/42", providerId: "customer", documentType: "sales_invoice", origin: "merit", source: "merit", customerName: "Client", amount: 120, currency: "USD", status: "open", meritStatus: "open", meritDeliveryStatus: "delivered", description: "Original service", issueDate: "2026-10-01", dueDate: "2026-10-15", revenueRunIds: ["run"], transactionId: "bank-link", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" };
const after = { ...before, amount: 200, description: "Revised service", dueDate: "2026-10-30", taxId: "vat" };
const tax = { id: "vat", code: "VAT20", name: "VAT", taxPct: 20 };
const original = () => ({ Header: { SIHId: before.externalId, InvoiceNo: before.invoiceNumber, CustomerId: "customer-guid", AccountingDock: 1, Paid: false, PaidAmount: 0, TotalAmount: 100, TotalSum: 120, TaxAmount: 20, RoundingAmount: 0, CurrencyCode: "USD", CurrencyRate: 1.1, DocumentDate: "2026-10-01", TransactionDate: "2026-10-01", DueDate: "2026-10-15", HComment: "Header note", FComment: "Footer note", ReferenceNo: "123", ContractNo: "Contract" }, Lines: [{ ArticleCode: "SERVICES", AccountCode: "3000", Quantity: 1, Description: "Original service", AmountExclVat: 100, TaxId: "vat" }], Payments: [] });
const prepared = () => prepareReplacement(before, after, original(), tax);
function replacementDetail() {
  const result = original(); result.Header.SIHId = "new-merit-id"; result.Header.TotalAmount = 200; result.Header.TotalSum = 240; result.Header.TaxAmount = 40; result.Header.DueDate = after.dueDate;
  result.Lines[0].Description = after.description; result.Lines[0].AmountExclVat = 200; return result;
}
function harness() {
  const events: string[] = [];
  let deleted = false, created = false;
  const job: ReplacementJob = { id: "job", invoiceId: before.id, before: structuredClone(before), after: structuredClone(after), phase: "preparing" };
  const port: ReplacementPort = {
    details: async id => id === "new-merit-id" ? replacementDetail() : original(),
    pdf: async () => new TextEncoder().encode("%PDF-original"),
    list: async () => created ? [{ SIHId: "new-merit-id", InvoiceNo: before.invoiceNumber }] : deleted ? [] : [{ SIHId: before.externalId!, InvoiceNo: before.invoiceNumber }],
    backup: async () => { events.push("backup"); },
    phase: async (_expected, next) => { events.push(next); },
    write: async (path, payload) => { events.push(path); if (path.startsWith("/v2/deleteinvoice/")) { deleted = true; return null; } assert.equal((payload as any).InvoiceNo, before.invoiceNumber); created = true; return { SIHId: "new-merit-id" }; },
    complete: async invoice => { events.push("complete"); return invoice; },
    fail: async (_message, abort) => { events.push(abort ? "abort" : "pending"); }
  };
  return { job, port, events, markCreated() { deleted = true; created = true; } };
}
test("unpaid edit backs up before deletion, keeps invoice number and links, verifies new PDF, and never emails", async () => {
  const { job, port, events } = harness();
  const result = await runReplacement(job, port, tax);
  assert.deepEqual(events, ["backup", "deleting", "/v2/deleteinvoice/old-merit-id", "deleted", "creating", "/v2/sendinvoice", "created", "complete"]);
  assert.equal(result.id, before.id); assert.equal(result.invoiceNumber, before.invoiceNumber); assert.equal(result.transactionId, before.transactionId);
  assert.deepEqual(result.revenueRunIds, before.revenueRunIds); assert.equal(result.amount, 240); assert.equal(result.externalId, "new-merit-id"); assert.equal(result.meritDeliveryStatus, "saved");
  assert.equal(prepared().request.Hcomment, "Header note"); assert.equal(prepared().request.CurrencyRate, 1.1);
});
test("paid, partially paid, unknown payment status and complex invoices fail before deletion", async () => {
  for (const alter of [
    (d: any) => { d.Header.Paid = true; }, (d: any) => { d.Header.PaidAmount = 1; }, (d: any) => { delete d.Header.PaidAmount; },
    (d: any) => { d.Payments = [{ Amount: 1 }]; }, (d: any) => { d.Lines.push(d.Lines[0]); }, (d: any) => { d.Lines[0].DiscountPct = 10; },
    (d: any) => { d.Header.TotalSum = 999; }, (d: any) => { d.Header.OfferId = "offer"; }
  ]) {
    const { job, port, events } = harness(); const detail = original(); alter(detail); port.details = async () => detail;
    await assert.rejects(runReplacement(job, port, tax)); assert.deepEqual(events, ["abort"]);
  }
  assert.throws(() => assertUnpaidInvoice({ ...before, status: "paid" }, []), /unpaid/);
  assert.throws(() => assertUnpaidInvoice(before, [{ invoiceId: before.id, amount: 1 } as any]), /unpaid/);
});
test("backup failure or a payment during backup cannot delete the original", async () => {
  const first = harness(); first.port.backup = async () => { throw new Error("storage down"); };
  await assert.rejects(runReplacement(first.job, first.port, tax), /storage down/); assert.deepEqual(first.events, ["abort"]);
  const second = harness(); let reads = 0;
  second.port.details = async () => { const d = original(); if (++reads > 1) d.Header.PaidAmount = 1; return d; };
  await assert.rejects(runReplacement(second.job, second.port, tax), /changed/); assert.deepEqual(second.events, ["backup", "abort"]);
});
test("a lost create response is reconciled once without submitting a second invoice", async () => {
  const h = harness(); const write = h.port.write;
  h.port.write = async (path, payload) => { const result = await write(path, payload); if (path === "/v2/sendinvoice") throw new Error("timeout"); return result; };
  await assert.rejects(runReplacement(h.job, h.port, tax), /timeout/);
  assert.equal(h.job.phase, "creating");
  const result = await runReplacement(h.job, h.port, tax);
  assert.equal(result.externalId, "new-merit-id"); assert.equal(h.events.filter(e => e === "/v2/sendinvoice").length, 1);
});
test("an ambiguous create with no result stays pending and never replays the write", async () => {
  const h = harness(); Object.assign(h.job, { phase: "creating", request: prepared().request, after: prepared().after, original: original() }); h.port.list = async () => [];
  await assert.rejects(runReplacement(h.job, h.port), /uncertain outcome/); assert.deepEqual(h.events, ["pending"]);
});
test("a rejected deletion never proceeds to creation", async () => {
  const h = harness(); h.port.write = async () => null;
  await assert.rejects(runReplacement(h.job, h.port, tax), /still has the original/);
  assert.equal(h.events.includes("creating"), false);
});
test("replacement verification rejects wrong totals, numbers, accounts, customers and lines", () => {
  for (const alter of [(d: any) => { d.Header.TotalSum = 1; }, (d: any) => { d.Header.InvoiceNo = "wrong"; }, (d: any) => { d.Lines[0].AccountCode = "999"; }, (d: any) => { d.Header.CustomerId = "wrong"; }]) {
    const detail = replacementDetail(); alter(detail); assert.throws(() => verifyReplacement(detail, prepared().request), /does not match/);
  }
});
test("Merit reconciliation retains pending dashboard identity and hides replacement duplicates", () => {
  const pending = { ...before, meritReplacementId: "job" };
  assert.deepEqual(reconcileMeritInvoices([], [pending], true), [pending]);
  assert.deepEqual(reconcileMeritInvoices([{ ...before, id: "new", externalId: "new-merit-id" }], [pending], true), [pending]);
});
test("accounting writes are not retried on timeout or rate limit", async () => {
  const fetch = globalThis.fetch;
  try {
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response("limited", { status: 429 }); };
    await assert.rejects(replacementRequest(() => "https://test.invalid", "/v2/sendinvoice", {}), /429/); assert.equal(calls, 1);
  } finally { globalThis.fetch = fetch; }
});
test("explicit delete rejection unlocks the unchanged original; explicit create rejection can resume safely", async () => {
  const deletion = harness(); deletion.port.write = async () => { throw new MeritRequestRejected(403, 0); };
  await assert.rejects(runReplacement(deletion.job, deletion.port, tax), /403/);
  assert.equal(deletion.job.phase, "backed_up"); assert.equal(deletion.events.at(-1), "abort");
  const creation = harness(); const write = creation.port.write;
  creation.port.write = async (path, payload) => { if (path === "/v2/sendinvoice") throw new MeritRequestRejected(429, 60_000); return write(path, payload); };
  await assert.rejects(runReplacement(creation.job, creation.port, tax), /429/);
  assert.equal(creation.job.phase, "deleted");
  creation.port.write = write;
  const result = await runReplacement(creation.job, creation.port, tax);
  assert.equal(result.externalId, "new-merit-id");
});
test("a replacement PDF failure is recoverable without another create or delete", async () => {
  const h = harness(); const pdf = h.port.pdf;
  h.port.pdf = async id => { if (id === "new-merit-id") throw new Error("PDF unavailable"); return pdf(id); };
  await assert.rejects(runReplacement(h.job, h.port, tax), /PDF unavailable/);
  assert.equal(h.job.phase, "created");
  h.port.pdf = pdf; await runReplacement(h.job, h.port, tax);
  assert.equal(h.events.filter(e => e === "/v2/sendinvoice").length, 1);
  assert.equal(h.events.filter(e => e.startsWith("/v2/deleteinvoice/")).length, 1);
});
