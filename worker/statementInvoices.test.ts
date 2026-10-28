import assert from "node:assert/strict";
import test from "node:test";
import { invoiceAi } from "./statementInvoiceAi";
import { invoiceHtml, invoiceTemplateHtml } from "./statementInvoicePdf";
import { handleStatementInvoices } from "./statementInvoices";
import type { InvoiceDraft } from "../shared/statementInvoices";
import { invoiceCopyHtml } from "./statementInvoiceCopy";
import { defaultInvoiceDesign } from "../shared/statementInvoiceDesign";
const draft: InvoiceDraft = { number: "TEST-1", date: "2026-10-26", dueDate: "", customer: '<img src="https://bad.test">', customerAddress: "Amsterdam", notes: "", currency: "EUR", taxMode: "included", lines: [{ transactionId: "one", description: "<script>bad()</script>", amount: "121.00", taxPercent: "21" }] };
test("invoice HTML escapes document/user text and does not include source transaction metadata", () => {
  const html = invoiceHtml(draft, { headerPercent: 10, footerPercent: 10, sellerDetails: "Seller", paymentDetails: "" }, true);
  assert.ok(html.includes("&lt;script&gt;")); assert.ok(!html.includes("<img src=")); assert.ok(!html.includes("transactionId")); assert.ok(html.includes("121.00")); assert.ok(html.includes("DRAFT"));
  assert.ok(!invoiceHtml(draft, { headerPercent: 0, footerPercent: 0, sellerDetails: "Seller", paymentDetails: "" }, false).includes("DRAFT —"));
});
test("example branding is rasterized into bounded strips rather than embedding hidden old invoice text", () => {
  const html = invoiceTemplateHtml(new TextEncoder().encode("%PDF-test"), 10, 10);
  assert.ok(html.includes("paint.fillRect")); assert.ok(html.includes("cropped.toDataURL('image/png')")); assert.ok(html.includes("isEvalSupported:false")); assert.ok(html.includes("pdf.numPages>5"));
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
test("invoice routes show production Convex error data without starting AI", async () => {
  const original = globalThis.fetch, calls: string[] = [];
  const env = { CONVEX_URL: "https://invoice-test.convex.cloud", CONVEX_SERVICE_TOKEN: "test" } as WorkerEnv;
  const url = "https://statements.thatcanadian.dev/api/statements/created-invoices";
  try {
    for (const reason of ["Invoice number 22409 is already used for this company. Open it in Created invoices, or enter a different number.", "Saved company details changed. Close this form and open it again before saving"]) {
      globalThis.fetch = async (_url, init) => {
        const payload = JSON.parse(String(init?.body)); calls.push(payload.path);
        assert.equal(payload.path, "statementInvoices:begin");
        return Response.json({ status: "error", errorMessage: "[Request ID: df3f86da489b2735] Server Error", errorData: reason }, { status: 560 });
      };
      const response = await handleStatementInvoices(new Request(url, { method: "POST", headers: { Origin: new URL(url).origin, "Content-Type": "application/json" }, body: JSON.stringify({ requestId: crypto.randomUUID(), ids: ["transaction"], draft }) }), env, { username: "Ali", role: "administrator" });
      assert.equal(response?.status, 400); assert.deepEqual(await response?.json(), { message: reason });
      assert.equal(response?.headers.get("Cache-Control"), "private, no-store");
    }
    assert.equal(calls.length, 2);
  } finally { globalThis.fetch = original; }
});
test("unexpected invoice server failures keep a support reference without exposing backend details", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ status: "error", errorMessage: "[Request ID: df3f86da489b2735] Server Error\nPrivate backend details" }, { status: 560 });
  try {
    const response = await handleStatementInvoices(new Request("https://statements.thatcanadian.dev/api/statements/created-invoices"), { CONVEX_URL: "https://invoice-test.convex.cloud", CONVEX_SERVICE_TOKEN: "test" } as WorkerEnv, { username: "Ali", role: "administrator" });
    assert.equal(response?.status, 500);
    assert.deepEqual(await response?.json(), { message: "The invoice request could not finish. Try again. If it happens again, share this reference: df3f86da489b2735" });
  } finally { globalThis.fetch = original; }
});
test("invoice AI body deadlines cancel stalled streams and reject oversized responses", async () => {
  const { readInvoiceAiBody } = await import("./statementInvoiceAi");
  let cancelled = false;
  const stalled = new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  await assert.rejects(readInvoiceAiBody(stalled, 10), /taking too long/); assert.equal(cancelled, true);
  await assert.rejects(readInvoiceAiBody(new Response("x".repeat(1_000_001))), /too large/);
  assert.equal(await readInvoiceAiBody(new Response('{"ok":true}')), '{"ok":true}');
});
test("customer VAT appears on PDFs as escaped text", () => {
  const html = invoiceHtml({ ...draft, customerVat: "<VAT>" }, { headerPercent: 0, footerPercent: 0, sellerDetails: "Supplier\nVAT: NL-123", paymentDetails: "" }, true);
  assert.ok(html.includes("VAT: &lt;VAT&gt;")); assert.ok(html.includes("VAT: NL-123"));
});
test("company PDFs use white paper with local verified logos and stable restrained accents", () => {
  const html = invoiceHtml(draft, { headerPercent: 0, footerPercent: 0, sellerDetails: "AR-TEC", paymentDetails: "", design: defaultInvoiceDesign("our:artec", "Artec") }, false);
  assert.ok(html.includes("background:white")); assert.ok(html.includes("/invoice-brands/artec.png"));
  assert.ok(html.includes("solid #eba11c")); assert.ok(!html.includes("background:#eba11c"));
  assert.ok(html.includes("&lt;script&gt;"));
});
test("example copies replace mapped values, escape new text and keep the original image design", () => {
  const keys = ["seller", "number", "date", "customer", "customerAddress", "lines", "net", "tax", "total"] as const;
  const copy = { width: 595, height: 842, currency: "EUR", fields: keys.map((key, i) => ({ key, x: 30, y: 30 + 80 * i, width: 500, height: 50, fontSize: 10, color: "#222222", background: "#ffffff", align: "left" as const, font: "sans" as const })), erase: [{ x: 25, y: 25, width: 505, height: 750 }], columns: (["description", "net", "taxPercent", "total"] as const).map((key, i) => ({ key, x: 25 * i, width: 25 })) };
  const layout = { headerPercent: 0, footerPercent: 0, sellerDetails: "Seller <Company>", paymentDetails: "", copy };
  const html = invoiceCopyHtml(draft, layout, "data:image/png;base64,AAAA", true);
  assert.ok(html.includes('class="original"')); assert.ok(html.includes('class="erase"')); assert.ok(html.includes("Seller &lt;Company&gt;"));
  assert.ok(html.includes('data-copy-field="number"')); assert.ok(html.includes("TEST-1")); assert.ok(html.includes("2026-10-26"));
  assert.ok(html.includes("100.00")); assert.ok(html.includes("21.00")); assert.ok(html.includes("121.00"));
  assert.ok(!html.includes('<script>bad()')); assert.ok(!html.includes("transactionId"));
  assert.throws(() => invoiceCopyHtml({ ...draft, notes: "No room" }, layout, "data:image/png;base64,AAAA", false), /notes area/);
  assert.throws(() => invoiceCopyHtml(draft, layout, "https://bad.test/image.png", false), /image is missing/);
});
