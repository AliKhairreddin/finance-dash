import assert from "node:assert/strict";
import test from "node:test";
import { ConvexHttpClient } from "convex/browser";
import { getFunctionName } from "convex/server";
import { handleDocumentApi } from "./documentIntake";
const env = { CONVEX_URL: "https://test.convex.cloud", CONVEX_SERVICE_TOKEN: "service", OPENROUTER_API_KEY: "test", PUBLIC_APP_URL: "https://finance.example", DOCUMENT_AI_MODEL: "test-model" };
const extraction = { kind: "expense", entity: "dn", counterparty: "Cloudflare", documentNumber: "CF-1", issueDate: "2026-09-05", dueDate: null, amount: 59.08, currency: "USD", description: "Hosting", confidence: 1, reviewReasons: [] };

test("document PDF previews stream inline while ordinary downloads keep their filenames", async t => {
  const fileName = "Supplier reçu.pdf";
  const bytes = new TextEncoder().encode("%PDF-1.7 original file");
  t.mock.method(ConvexHttpClient.prototype, "query", async (fn: Parameters<typeof getFunctionName>[0], args: Record<string, unknown>) => {
    assert.equal(getFunctionName(fn), "documents:get");
    assert.deepEqual(args, { serviceToken: "service", id: "pdf-1" });
    return { document: { contentType: "application/pdf", fileName }, url: "https://storage.example/pdf-1" };
  });
  t.mock.method(globalThis, "fetch", async (url: RequestInfo | URL) => {
    assert.equal(url, "https://storage.example/pdf-1");
    return new Response(bytes);
  });
  for (const [query, disposition] of [["", "attachment"], ["?inline=1", "inline"]]) {
    const response = await handleDocumentApi(new Request(`https://finance.example/api/documents/pdf-1/file${query}`), env);
    assert.ok(response);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "application/pdf");
    assert.equal(response.headers.get("Content-Disposition"), `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
  }
});

test("document previews report missing and failed storage without returning an error body as a PDF", async t => {
  let available = false;
  let status = 503;
  t.mock.method(ConvexHttpClient.prototype, "query", async () => ({ document: { contentType: "application/pdf", fileName: "receipt.pdf" }, url: available ? "https://storage.example/pdf-1" : null }));
  const storage = t.mock.method(globalThis, "fetch", async () => new Response("Storage error", { status }));
  const send = () => handleDocumentApi(new Request("https://finance.example/api/documents/pdf-1/file?inline=1"), env);
  assert.equal((await send())?.status, 404);
  assert.equal(storage.mock.callCount(), 0);
  available = true;
  const failed = await send();
  assert.equal(failed?.status, 502);
  assert.deepEqual(await failed?.json(), { message: "Original document could not be loaded" });
  status = 404;
  assert.equal((await send())?.status, 404);
});

test("document APIs forward edited candidate details and explicit FX confirmation", async t => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const record = async (fn: Parameters<typeof getFunctionName>[0], args: Record<string, unknown>) => { calls.push({ name: getFunctionName(fn), args }); return []; };
  t.mock.method(ConvexHttpClient.prototype, "query", record);
  t.mock.method(ConvexHttpClient.prototype, "mutation", record);
  const send = (path: string, body: unknown) => handleDocumentApi(new Request(`https://finance.example/api/documents/doc-1/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), env);
  assert.equal((await send("candidates", { ...extraction, entity: null }))?.status, 200);
  assert.equal(calls[0].name, "documents:candidates");
  assert.equal((calls[0].args.extraction as typeof extraction).entity, null);
  assert.equal((await send("review", { ...extraction, transactionId: "amex-1", confirmCurrencyConversion: true }))?.status, 200);
  assert.equal(calls[1].name, "documents:review"); assert.equal(calls[1].args.transactionId, "amex-1"); assert.equal(calls[1].args.confirmCurrencyConversion, true);
  assert.deepEqual(calls[1].args.extraction, extraction);
  assert.equal((await send("match", { transactionId: "amex-1", confirmCurrencyConversion: true }))?.status, 200);
  assert.equal(calls[2].name, "documents:confirmMatch"); assert.equal(calls[2].args.confirmCurrencyConversion, true);
});

test("bulk deletion and restoration forward bounded file selections to soft-delete mutations", async t => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  t.mock.method(ConvexHttpClient.prototype, "mutation", async (fn: Parameters<typeof getFunctionName>[0], args: Record<string, unknown>) => { calls.push({ name: getFunctionName(fn), args }); return 2; });
  for (const action of ["trash", "restore"]) {
    const response = await handleDocumentApi(new Request(`https://finance.example/api/documents/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: ["one", "two"] }) }), env);
    assert.equal(response?.status, 200); assert.deepEqual(await response?.json(), { count: 2 });
    assert.equal(calls.at(-1)?.name, `documents:${action}`); assert.deepEqual(calls.at(-1)?.args.ids, ["one", "two"]);
    for (const ids of [[], [1], Array(201).fill("one")]) {
      const rejected = await handleDocumentApi(new Request(`https://finance.example/api/documents/${action}`, { method: "POST", body: JSON.stringify({ ids }) }), env);
      assert.equal(rejected?.status, 400);
    }
  }
  assert.equal(calls.length, 2, "invalid requests cannot mutate data");
  const single = await handleDocumentApi(new Request("https://finance.example/api/documents/one", { method: "DELETE" }), env);
  assert.equal(single?.status, 200); assert.equal(calls.at(-1)?.name, "documents:trash"); assert.deepEqual(calls.at(-1)?.args.ids, ["one"]);
});

test("purchase decisions and saved-file rechecks use authenticated document endpoints", async t => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  t.mock.method(ConvexHttpClient.prototype, "mutation", async (fn: Parameters<typeof getFunctionName>[0], args: Record<string, unknown>) => { calls.push({ name: getFunctionName(fn), args }); return null; });
  const response = await handleDocumentApi(new Request("https://finance.example/api/documents/one/purchase", { method: "POST", body: JSON.stringify({ otherId: "two", decision: "same" }) }), env);
  assert.equal(response?.status, 200); assert.equal(calls[0].name, "documents:resolvePurchase"); assert.equal(calls[0].args.serviceToken, "service");
  assert.equal(calls[0].args.decision, "same");
  const invalid = await handleDocumentApi(new Request("https://finance.example/api/documents/one/purchase", { method: "POST", body: JSON.stringify({ otherId: "two", decision: "delete" }) }), env);
  assert.equal(invalid?.status, 400); assert.equal(calls.length, 1);
  await handleDocumentApi(new Request("https://finance.example/api/documents/recheck", { method: "POST" }), env);
  assert.equal(calls[1].name, "documentRecheck:start");
});
