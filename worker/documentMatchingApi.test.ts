import assert from "node:assert/strict";
import test from "node:test";
import { ConvexHttpClient } from "convex/browser";
import { getFunctionName } from "convex/server";
import { handleDocumentApi } from "./documentIntake";
const env = { CONVEX_URL: "https://test.convex.cloud", CONVEX_SERVICE_TOKEN: "service", OPENROUTER_API_KEY: "test", PUBLIC_APP_URL: "https://finance.example", DOCUMENT_AI_MODEL: "test-model" };
const extraction = { kind: "expense", entity: "dn", counterparty: "Cloudflare", documentNumber: "CF-1", issueDate: "2026-09-05", dueDate: null, amount: 59.08, currency: "USD", description: "Hosting", confidence: 1, reviewReasons: [] };
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
