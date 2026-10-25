import assert from "node:assert/strict";
import test from "node:test";
import { assignStatementDocumentCompany, extractStatementDetails, StatementAiError, statementRetryDelay, validateStatementExtraction, verifiedStatementEvidence } from "./statementExtraction";

const pages = [{ page: 1, text: "AMG Holding\nVisa card ending in 5196\nInvoice 4440\n2026-10-20 Acme 125.25 EUR debit" }];
const row = { date: "2026-10-20", description: "Acme", amount: "125.25", currency: "EUR", direction: "out", source: "Bank", cardLastFour: "5196" };
const extraction = { documentType: "bank_statement", pageCount: 1, complete: true, rows: [row], evidence: [
  { field: "cardLastFour", value: "5196", quote: "Visa card ending in 5196", page: 1 },
  { field: "rows.0", value: "125.25", quote: "2026-10-20 Acme 125.25 EUR debit", page: 1 }
] };

test("statement card evidence requires a real quote in payment-card context", () => {
  assert.deepEqual(verifiedStatementEvidence([
    { field: "cardLastFour", value: "5196", quote: "Visa card ending in 5196", page: 1 },
    { field: "cardLastFour", value: "4440", quote: "Invoice 4440", page: 1 },
    { field: "cardLastFour", value: "6805", quote: "Visa card ending in 6805", page: 1 },
    { field: "cardLastFour", value: "5196", quote: "Visa card ending in 5196", page: 2 }
  ], pages), [{ field: "cardLastFour", value: "5196", quote: "Visa card ending in 5196", page: 1 }]);
});

test("account suffixes, masks, and unsupported company quotes cannot assign companies", () => {
  const source = [{ page: 1, text: "Account ending in 5196\nAccount ****4440\nInvoice ending 6805\nAcme supplier" }];
  assert.deepEqual(verifiedStatementEvidence([
    { field: "cardLastFour", value: "5196", quote: "Account ending in 5196", page: 1 },
    { field: "cardLastFour", value: "4440", quote: "Account ****4440", page: 1 },
    { field: "cardLastFour", value: "6805", quote: "Invoice ending 6805", page: 1 },
    { field: "companyId", value: "amg-holding", quote: "Acme supplier", page: 1 }
  ], source), []);
});

test("invoice extraction never manufactures bank transactions", () => {
  const result = validateStatementExtraction({ ...extraction, documentType: "invoice" }, pages);
  assert.deepEqual(result.rows, []);
  assert.match(result.reviewReasons.join(" "), /cannot create a bank transaction/);
});

test("company evidence conflicts remain unassigned and row suggestions need literal support", () => {
  const result = validateStatementExtraction({ ...extraction, companyId: "amg-holding", evidence: [
    ...extraction.evidence, { field: "companyId", value: "amg-holding", quote: "AMG Holding", page: 1 }
  ], rows: [{ ...row, companyId: "artec" }] }, pages, "inch-engineering");
  assert.equal(result.companyId, undefined);
  assert.equal(result.rows[0].companyId, undefined);
  assert.match(result.reviewReasons.join(" "), /conflicts/);
});

test("exact amounts are retained and incomplete coverage cannot be labeled complete", () => {
  const result = validateStatementExtraction({ ...extraction, printedTransactionCount: 2 }, pages);
  assert.equal(result.rows[0].amountMinor, "12525");
  assert.equal(result.complete, false);
  assert.match(result.reviewReasons.join(" "), /coverage/);
  const invalid = validateStatementExtraction({ ...extraction, rows: [{ ...row, amount: "125.251" }] }, pages);
  assert.equal(invalid.rows.length, 0);
  assert.equal(invalid.complete, false);
});

test("printed totals are reconciled using exact minor units and native currencies", () => {
  const source = [{ page: 1, text: `${pages[0].text}\nTotal debits EUR 130.25` }];
  const result = validateStatementExtraction({ ...extraction, totals: [{ currency: "EUR", moneyOut: "130.25" }], evidence: [...extraction.evidence, { field: "totals.0.moneyOut", value: "130.25", quote: "Total debits EUR 130.25", page: 1 }] }, source);
  assert.equal(result.complete, false);
  assert.match(result.reviewReasons.join(" "), /do not match printed EUR totals/);
});

test("card mapping does not assume last-four uniqueness or ignore mapping scope", () => {
  const result = validateStatementExtraction(extraction, pages);
  assignStatementDocumentCompany(result, [{ _id: "one", companyId: "amg-holding", lastFour: "5196", label: "AMG", active: true }, { _id: "two", companyId: "artec", lastFour: "5196", label: "Artec", active: true }]);
  assert.equal(result.companyId, undefined); assert.match(result.reviewReasons.join(" "), /conflict/);
  const scoped = validateStatementExtraction(extraction, pages);
  assignStatementDocumentCompany(scoped, [{ _id: "one", companyId: "amg-holding", lastFour: "5196", label: "AMG", source: "Specific bank", active: true }]);
  assert.equal(scoped.companyId, undefined);
  assignStatementDocumentCompany(scoped, [{ _id: "one", companyId: "amg-holding", lastFour: "5196", label: "AMG", active: true }, { _id: "two", companyId: "artec", lastFour: "5196", label: "Other bank", source: "Specific bank", active: true }]);
  assert.equal(scoped.companyId, undefined);
});

test("document extraction uses only saved model, text, and enforced zero-retention policy", async () => {
  const original = globalThis.fetch;
  let payload: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => { payload = JSON.parse(String(init?.body)); return Response.json({ id: "test-generation", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(extraction) } }], usage: { cost: 0.001 } }); };
  try {
    const result = await extractStatementDetails({ apiKey: "test", model: "deepseek/deepseek-v4-flash", pages, fileName: "statement.pdf" });
    assert.equal(payload?.model, "deepseek/deepseek-v4-flash");
    assert.deepEqual(payload?.provider, { zdr: true, data_collection: "deny", allow_fallbacks: false });
    assert.equal(payload?.plugins, undefined);
    assert.equal(result.generationId, "test-generation");
    assert.equal(result.costUsd, 0.001);
  } finally { globalThis.fetch = original; }
});

test("truncated AI answers and blank model configuration fail without records", async () => {
  await assert.rejects(extractStatementDetails({ apiKey: "test", model: "", pages, fileName: "test.pdf" }), /Configure/);
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: "length", message: { content: "{}" } }] });
  try { await assert.rejects(extractStatementDetails({ apiKey: "test", model: "saved-model", pages, fileName: "test.pdf" }), /incomplete/); }
  finally { globalThis.fetch = original; }
});

test("AI generation may finish after the bank response deadline", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
  const stream = new ReadableStream<Uint8Array>({ start(controller) { streamController = controller; } });
  t.mock.method(globalThis, "fetch", async () => new Response(stream));
  const pending = extractStatementDetails({ apiKey: "test", model: "deepseek/deepseek-v4-flash", pages, fileName: "statement.pdf" });
  await new Promise<void>(resolve => setImmediate(resolve));
  t.mock.timers.tick(15_000);
  streamController!.enqueue(new TextEncoder().encode(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(extraction) } }] })));
  streamController!.close();
  assert.equal((await pending).extraction.rows[0].amountMinor, "12525");
});

test("stalled AI response bodies remain retryable and cancel their stream", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let cancelled = false;
  t.mock.method(globalThis, "fetch", async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  const pending = extractStatementDetails({ apiKey: "test", model: "saved-model", pages, fileName: "statement.pdf" });
  const rejected = assert.rejects(pending, error => error instanceof StatementAiError && error.retryAfterMs === 30_000);
  await new Promise<void>(resolve => setImmediate(resolve));
  t.mock.timers.tick(60_000);
  await rejected;
  assert.equal(cancelled, true);
});

test("HTTP 200 provider errors reject partial extraction and retain retry deadlines", async t => {
  const content = JSON.stringify(extraction);
  const responses = [
    { error: { code: 502 }, choices: [{ finish_reason: "stop", message: { content } }] },
    { choices: [{ error: { code: 429 }, finish_reason: "error", message: { content } }] },
    { choices: [{ finish_reason: "content_filter", message: { content } }] }
  ];
  t.mock.method(globalThis, "fetch", async () => Response.json(responses.shift(), { headers: { "Retry-After": "7200" } }));
  for (const retryAfterMs of [7_200_000, 7_200_000, undefined]) {
    await assert.rejects(extractStatementDetails({ apiKey: "test", model: "saved-model", pages, fileName: "statement.pdf" }), error => error instanceof StatementAiError && error.retryAfterMs === retryAfterMs);
  }
});

test("rate-limited extraction respects the provider retry deadline while preserving originals", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("rate limited", { status: 429, headers: { "Retry-After": "3600" } });
  try { await assert.rejects(extractStatementDetails({ apiKey: "test", model: "saved-model", pages, fileName: "test.pdf" }), error => error instanceof Error && "retryAfterMs" in error && error.retryAfterMs === 3_600_000); }
  finally { globalThis.fetch = original; }
  assert.equal(statementRetryDelay("Sun, 25 Oct 2026 20:00:00 GMT", 429, Date.parse("2026-10-25T18:00:00Z")), 7_200_000);
  assert.equal(statementRetryDelay(null, 503), 30_000);
  assert.equal(statementRetryDelay("10", 403), undefined);
});
