import assert from "node:assert/strict";
import test from "node:test";
import { ConvexHttpClient } from "convex/browser";
import { amexStatementHint, extractAmexPdf, handleAmexStatementApi, stageAmexStatement, telegramAmexOptions } from "./amexStatements";
import { handleTelegramCommand } from "./handler";
const env = { CONVEX_URL: "https://test.convex.cloud", CONVEX_SERVICE_TOKEN: "service", OPENROUTER_API_KEY: "test", PUBLIC_APP_URL: "https://finance.example", DOCUMENT_AI_MODEL: "test-model" };
const options = { currency: "EUR", dateFormat: "dmy", cardLastFour: "1234" } as const;
const file = { fileName: "Amex.pdf", bytes: new TextEncoder().encode("%PDF-1.7\nsynthetic"), source: "upload" } as const;
const extraction = { isAmexStatement: true, currency: "EUR", cardLastFour: "1234", rows: [{ date: "2026-09-15", description: "TEST VENDOR", amount: 10 }], chargesTotal: 10, creditsTotal: 0, reviewReasons: [] };
test("PDF extraction uses the configured private provider and reconciles all charge/credit rows", async t => {
  t.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const body = JSON.parse(String(init.body)); assert.equal(body.model, "test-model");
    assert.equal(body.provider.zdr, true); assert.equal(body.provider.allow_fallbacks, false);
    assert.match(body.messages[0].content, /untrusted/); assert.equal(body.plugins[0].pdf.engine, "native");
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(extraction) } }] });
  });
  const result = await extractAmexPdf(env, file, options); assert.equal(result?.rows.length, 1); assert.deepEqual(result?.reviewReasons, []);
});
test("truncated PDFs, mismatched totals and wrong document types never become importable rows", async t => {
  let finish = "length", payload: unknown = extraction;
  t.mock.method(globalThis, "fetch", async () => Response.json({ choices: [{ finish_reason: finish, message: { content: JSON.stringify(payload) } }] }));
  await assert.rejects(extractAmexPdf(env, file, options), /incomplete/);
  finish = "stop"; payload = { ...extraction, chargesTotal: 999 };
  await assert.rejects(extractAmexPdf(env, file, options), /printed statement totals/);
  payload = { isAmexStatement: false }; assert.equal(await extractAmexPdf(env, file, options), null);
  payload = { ...extraction, chargesTotal: undefined }; assert.match((await extractAmexPdf(env, file, options))!.reviewReasons.join(" "), /control totals/);
});
test("identical originals return their saved preview without extracting or storing again", async t => {
  t.mock.method(ConvexHttpClient.prototype, "query", async () => "saved-id");
  t.mock.method(globalThis, "fetch", async () => { assert.fail("Duplicate originals must not be re-extracted"); });
  assert.deepEqual(await stageAmexStatement(env, file, options), { id: "saved-id", duplicate: true });
});
test("oversized and unrelated CSVs never reach storage; review acknowledgment is server checked", async t => {
  let calls = 0;
  t.mock.method(ConvexHttpClient.prototype, "query", async () => null);
  t.mock.method(ConvexHttpClient.prototype, "mutation", async (_fn: unknown, args: { reviewed?: boolean }) => { calls++; assert.equal(args.reviewed, false); throw new Error("Review required"); });
  await assert.rejects(stageAmexStatement(env, { ...file, bytes: new Uint8Array(10 * 1024 * 1024 + 1) }, options), /10 MB/);
  await assert.rejects(stageAmexStatement(env, { ...file, fileName: "bank.csv", bytes: new TextEncoder().encode("Date,Description,Amount\n15/09/2026,Vendor,12") }, options, true), /caption/);
  assert.equal(calls, 0);
  const result = await handleAmexStatementApi(new Request("https://finance.example/api/amex/statements/saved-id/import", { method: "POST", body: '{"reviewed":"true"}' }), env);
  assert.equal(result?.status, 400); assert.equal(calls, 1);
});
test("Telegram /amex is administrator-only, explains attachment captions and uses the real bank URL", async () => {
  assert.deepEqual(telegramAmexOptions("/amex EUR 1234"), options);
  assert.equal(telegramAmexOptions("/amex USD 1234 mdy").dateFormat, "mdy");
  assert.equal(amexStatementHint("Amex_September.csv", ""), true);
  const runtime = { ...env, TELEGRAM_COMMAND_ADMIN_USERS: "Ali", TELEGRAM_COMMAND_READ_ONLY_USERS: "Amin" } as WorkerEnv;
  const reply = await handleTelegramCommand(runtime, { username: "Ali", normalizedUsername: "ali", chatId: "111" }, "administrator", "/amex");
  assert.match(String(reply), /\/amex EUR 1234/); assert.match(String(reply), /bankView=amex/);
  const denied = await handleTelegramCommand(runtime, { username: "Amin", normalizedUsername: "amin", chatId: "222" }, "read-only", "/amex");
  assert.match(String(denied), /Access denied/);
});
