import assert from "node:assert/strict";
import test from "node:test";
import { invoiceAi } from "./statementInvoiceAi";
import { invoiceHtml, invoiceTemplateHtml } from "./statementInvoicePdf";
import { handleStatementInvoices } from "./statementInvoices";
import type { InvoiceDraft } from "../shared/statementInvoices";
const draft: InvoiceDraft = { number: "TEST-1", date: "2026-10-26", dueDate: "", customer: '<img src="https://bad.test">', customerAddress: "Amsterdam", notes: "", currency: "EUR", taxMode: "included", lines: [{ transactionId: "one", description: "<script>bad()</script>", amount: "121.00", taxPercent: "21" }] };
test("invoice HTML escapes document/user text and does not include source transaction metadata", () => {
  const html = invoiceHtml(draft, { headerPercent: 10, footerPercent: 10, sellerDetails: "Seller", paymentDetails: "" }, true);
  assert.ok(html.includes("&lt;script&gt;")); assert.ok(!html.includes("<img src=")); assert.ok(!html.includes("transactionId")); assert.ok(html.includes("121.00")); assert.ok(html.includes("DRAFT"));
  assert.ok(!invoiceHtml(draft, { headerPercent: 0, footerPercent: 0, sellerDetails: "Seller", paymentDetails: "" }, false).includes("DRAFT —"));
});
test("example branding is rasterized into bounded strips rather than embedding hidden old invoice text", () => {
  const html = invoiceTemplateHtml(new TextEncoder().encode("%PDF-test"), 10, 10);
  assert.ok(html.includes("cropped.toDataURL('image/png')")); assert.ok(html.includes("isEvalSupported:false")); assert.ok(html.includes("pdf.numPages>5"));
});
test("invoice AI uses only the exact saved model with ZDR and rejects incomplete replies", async () => {
  const original = globalThis.fetch; let payload: Record<string, unknown> = {};
  globalThis.fetch = async (_url, init) => { payload = JSON.parse(String(init?.body)); return Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"lines":[]}' } }], usage: { cost: 0.001 } }); };
  try { const result = await invoiceAi("test", "saved/exact-model", "Test", {}); assert.equal(result.model, "saved/exact-model"); assert.equal(payload.model, "saved/exact-model"); assert.deepEqual(payload.provider, { zdr: true, data_collection: "deny", allow_fallbacks: false });
    globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: "length", message: { content: '{"lines":[]}' } }] }); await assert.rejects(invoiceAi("test", "saved/exact-model", "Test", {}));
  } finally { globalThis.fetch = original; }
});
test("invoice routes reject missing membership and cross-site writes before accessing services", async () => {
  const env = {} as WorkerEnv, url = "https://statements.thatcanadian.dev/api/statements/created-invoices";
  assert.equal((await handleStatementInvoices(new Request(url), env, null))?.status, 403);
  assert.equal((await handleStatementInvoices(new Request(url, { method: "POST", headers: { Origin: "https://bad.test" } }), env, { username: "Ali", role: "administrator" }))?.status, 403);
});
