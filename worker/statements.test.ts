import assert from "node:assert/strict";
import test from "node:test";
import puppeteer from "@cloudflare/puppeteer";
import { handleStatementApi, handleStatementProcessing, receiveStatementEmail, type StatementEnv } from "./statements";

const origin = "https://statements.thatcanadian.dev";
const env: StatementEnv = { CONVEX_URL: "https://statement-test.convex.cloud", CONVEX_SERVICE_TOKEN: "test-token", OPENROUTER_API_KEY: "test-key", BROWSER: {} as WorkerEnv["BROWSER"] };
const session = { username: "Ali", role: "administrator" as const };
const row = { companyId: "amg-holding", date: "2026-10-25", description: "Supplier payment", amount: "12.34", currency: "EUR", direction: "out", source: "Manual" };
const request = (path: string, value: unknown, method = "POST", requestOrigin = origin) => new Request(`${origin}/api/statements${path}`, { method, headers: { Origin: requestOrigin, "Content-Type": "application/json" }, body: JSON.stringify(value) });
type Rpc = { path: string; args: Array<Record<string, unknown>> };
const rpcResponse = (value: unknown) => Response.json({ status: "success", value });

test("Statement API requires an allowed authenticated actor and same-origin mutations", async () => {
  assert.equal((await handleStatementApi(new Request(`${origin}/api/statements/bootstrap`), env, null))?.status, 403);
  assert.equal((await handleStatementApi(new Request(`${origin}/api/statements/bootstrap`), env, { username: "Meet", role: "administrator" }))?.status, 403);
  assert.equal((await handleStatementApi(request("/transactions", {}, "POST", "https://evil.invalid"), env, session))?.status, 403);
  assert.equal((await handleStatementApi(request("/transactions", {}, "POST", ""), env, session))?.status, 403);
  assert.equal((await handleStatementProcessing(request("/process", {}), env)).status, 401);
  assert.equal((await handleStatementProcessing(new Request(`${origin}/api/statements/process`, { method: "POST", headers: { Authorization: "Bearer " }, body: "{}" }), { ...env, CONVEX_SERVICE_TOKEN: "" })).status, 401);
});

test("manual transactions send only validated fields and authenticated actor", async () => {
  const original = globalThis.fetch, calls: Rpc[] = [];
  globalThis.fetch = async (_input, init) => { calls.push(JSON.parse(String(init?.body))); return rpcResponse(["transaction1"]); };
  try {
    for (const invalid of [{ ...row, amount: "12.341" }, { ...row, companyId: "lmd" }, { ...row, date: "2026-02-30" }]) assert.equal((await handleStatementApi(request("/transactions", { requestId: "test-request-1", rows: [invalid] }), env, session))?.status, 400);
    assert.equal(calls.length, 0);
    assert.equal((await handleStatementApi(request("/transactions", { requestId: "test-request-1", actor: "Alaa", rows: [{ ...row, createdBy: "Alaa" }] }), env, session))?.status, 201);
    assert.equal(calls[0].path, "statements:createTransactions");
    assert.equal(calls[0].args[0].actor, "Ali");
    assert.deepEqual(calls[0].args[0].rows, [row]);
  } finally { globalThis.fetch = original; }
});

test("unassigned filters, date ranges, sorting, and pagination reach saved-data queries", async () => {
  const original = globalThis.fetch, calls: Rpc[] = [];
  globalThis.fetch = async (_input, init) => { calls.push(JSON.parse(String(init?.body))); return rpcResponse({ transactions: [], documents: [], imports: [], continueCursor: "", isDone: true }); };
  try {
    assert.equal((await handleStatementApi(new Request(`${origin}/api/statements/transactions?companyId=unassigned&from=2026-10-01&to=2026-10-25&sort=amountMinor&order=asc&trash=1`), env, session))?.status, 200);
    assert.equal(calls[0].args[0].companyId, "unassigned"); assert.equal(calls[0].args[0].sort, "amountMinor"); assert.equal(calls[0].args[0].trashed, true);
    assert.equal(calls[0].args[0].from, "2026-10-01");
    await handleStatementApi(new Request(`${origin}/api/statements/documents?cursor=page2&companyId=artec`), env, session);
    assert.equal(calls[1].args[0].cursor, "page2"); assert.equal(calls[1].args[0].companyId, "artec");
  } finally { globalThis.fetch = original; }
});

test("CSV uploads preserve original files and invalid row errors without importing", async () => {
  const original = globalThis.fetch, calls: Rpc[] = [];
  globalThis.fetch = async (input, init) => {
    if (String(input) === "https://storage.invalid/upload") return Response.json({ storageId: "storage1" });
    const call: Rpc = JSON.parse(String(init?.body)); calls.push(call);
    return rpcResponse(call.path.endsWith(":generateUploadUrl") ? "https://storage.invalid/upload" : call.path.endsWith(":stageImport") ? "import1" : { _id: "import1", rows: [], errors: ["Row 2 invalid"] });
  };
  try {
    const form = new FormData(); form.set("file", new Blob(["date,description,amount,currency,direction\n2026-10-25,Acme,bad,EUR,out"], { type: "text/csv" }), "bank.csv"); form.set("source", "Bank"); form.set("companyId", "amg-holding");
    const response = await handleStatementApi(new Request(`${origin}/api/statements/imports`, { method: "POST", headers: { Origin: origin }, body: form }), env, session);
    assert.equal(response?.status, 201);
    const stage = calls.find(call => call.path.endsWith(":stageImport"))!;
    assert.equal(stage.args[0].storageId, "storage1"); assert.match(String(stage.args[0].errors), /Row 2/);
    assert.equal(calls.some(call => /confirmImport|createTransactions/.test(call.path)), false);
  } finally { globalThis.fetch = original; }
});

test("document metadata never returns the storage URL; file downloads are authenticated proxies", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => String(input) === "https://storage.invalid/private-original"
    ? new Response("%PDF-original")
    : rpcResponse({ document: { _id: "doc1", fileName: "invoice.pdf", contentType: "application/pdf" }, url: "https://storage.invalid/private-original", emailUrl: null });
  try {
    const metadata = await handleStatementApi(new Request(`${origin}/api/statements/documents/doc1`), env, session);
    assert.deepEqual(await metadata?.json(), { _id: "doc1", fileName: "invoice.pdf", contentType: "application/pdf" });
    const file = await handleStatementApi(new Request(`${origin}/api/statements/documents/doc1/file`), env, session);
    assert.equal(await file?.text(), "%PDF-original"); assert.equal(file?.headers.get("Cache-Control"), "private, no-store");
    assert.equal((await handleStatementApi(new Request(`${origin}/api/statements/documents/doc1/file`), env, null))?.status, 403);
  } finally { globalThis.fetch = original; }
});

test("forwarded email preserves raw provenance and quarantines spoofed or unverified senders", async () => {
  const original = globalThis.fetch, calls: Rpc[] = [];
  let stored = 0;
  globalThis.fetch = async (input, init) => {
    if (String(input) === "https://storage.invalid/upload") return Response.json({ storageId: `storage${++stored}` });
    const call: Rpc = JSON.parse(String(init?.body)); calls.push(call);
    return rpcResponse(call.path.endsWith(":generateUploadUrl") ? "https://storage.invalid/upload" : call.path.endsWith(":processingSettings") ? { allowedSenders: [{ email: "spoofed@example.com", actor: "Ali" }] } : { id: "doc1", duplicate: false });
  };
  const raw = "From: Trusted <trusted@example.com>\r\nTo: statements@finance.thatcanadian.dev\r\nSubject: invoice\r\nMessage-ID: <message1@example.com>\r\nAuthentication-Results: mx.cloudflare.net; dmarc=pass\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=sample\r\n\r\n--sample\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename=invoice.pdf\r\nContent-Transfer-Encoding: base64\r\n\r\nJVBERi0xLjQK\r\n--sample--\r\n";
  let rejected = "";
  const message = { from: "spoofed@example.com", to: "statements@finance.thatcanadian.dev", rawSize: raw.length, raw: new Response(raw).body!, headers: new Headers(), setReject: (reason: string) => { rejected = reason; } } as ForwardableEmailMessage;
  try {
    await receiveStatementEmail(message, env);
    assert.equal(rejected, "");
    const intake = calls.find(call => call.path.endsWith(":ingestDocument"))!;
    assert.equal(intake.args[0].quarantined, true); assert.equal(intake.args[0].emailRawStorageId, "storage1"); assert.equal(intake.args[0].messageId, "<message1@example.com>");
    assert.equal(intake.args[0].senderKnown, true);
    assert.equal(intake.args[0].actor, undefined);
    assert.equal(calls.some(call => call.path.includes("claimDocument")), false);
  } finally { globalThis.fetch = original; }
});

test("durable PDF processing uses saved model and stages evidence without inventing invoice transactions", async t => {
  const original = globalThis.fetch, calls: Rpc[] = [];
  let model: unknown;
  const processingEnv: StatementEnv = { ...env };
  t.mock.method(puppeteer, "launch", async () => ({
    newPage: async () => ({ setCacheEnabled: async () => {}, setContent: async () => {}, waitForSelector: async () => {}, $eval: async () => JSON.stringify({ pages: [{ page: 1, text: "Invoice Acme EUR 12.34" }], method: "pdf-text", warnings: [] }) }), close: async () => {}
  }) as unknown as Awaited<ReturnType<typeof puppeteer.launch>>);
  globalThis.fetch = async (input, init) => {
    if (String(input) === "https://storage.invalid/original") return new Response("%PDF-1.4");
    if (String(input).includes("openrouter.ai")) {
      const sent = JSON.parse(String(init?.body)); model = sent.model;
      assert.deepEqual(sent.provider, { zdr: true, data_collection: "deny", allow_fallbacks: false });
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ documentType: "invoice", amount: "12.34", currency: "EUR", pageCount: 1, complete: true, rows: [row], evidence: [] }) } }] });
    }
    const call: Rpc = JSON.parse(String(init?.body)); calls.push(call);
    if (call.path.endsWith(":claimDocument")) return rpcResponse({ document: { _id: "doc1", contentType: "application/pdf", fileName: "invoice.pdf" }, url: "https://storage.invalid/original", attemptToken: "attempt1" });
    if (call.path.endsWith(":processingSettings")) return rpcResponse({ aiSettingsJson: JSON.stringify({ provider: "openrouter", model: "deepseek/deepseek-v4-flash" }), cards: [], allowedSenders: [] });
    return rpcResponse(null);
  };
  try {
    const result = await handleStatementProcessing(new Request(`${origin}/api/statements/process`, { method: "POST", headers: { Authorization: "Bearer test-token" }, body: JSON.stringify({ id: "doc1" }) }), processingEnv);
    assert.equal(result.status, 200); assert.equal(model, "deepseek/deepseek-v4-flash");
    const completed = calls.find(call => call.path.endsWith(":completeDocument"))!;
    assert.equal(completed.args[0].rows, undefined); assert.equal(completed.args[0].documentType, "invoice");
    assert.match(String(completed.args[0].reviewReasons), /cannot create a bank transaction/);
  } finally { globalThis.fetch = original; }
});

test("document processing fails closed without saved model and records the failed attempt", async () => {
  const original = globalThis.fetch, calls: Rpc[] = [];
  globalThis.fetch = async (input, init) => {
    assert.ok(!String(input).includes("openrouter.ai"));
    const call: Rpc = JSON.parse(String(init?.body)); calls.push(call);
    if (call.path.endsWith(":claimDocument")) return rpcResponse({ document: { _id: "doc1", contentType: "application/pdf", fileName: "invoice.pdf" }, url: "https://storage.invalid/original", attemptToken: "attempt1" });
    return rpcResponse(call.path.endsWith(":processingSettings") ? { aiSettingsJson: "null", cards: [], allowedSenders: [] } : null);
  };
  try {
    const response = await handleStatementProcessing(new Request(`${origin}/api/statements/process`, { method: "POST", headers: { Authorization: "Bearer test-token" }, body: '{"id":"doc1"}' }), env);
    assert.equal(response.status, 502); const failed = calls.find(call => call.path.endsWith(":failDocument"))!;
    assert.match(String(failed.args[0].error), /save an AI model/); assert.equal(failed.args[0].attemptToken, "attempt1");
  } finally { globalThis.fetch = original; }
});

test("manual preview corrections keep blocking coverage errors until explicitly reviewed", async () => {
  const original = globalThis.fetch, calls: Rpc[] = [];
  globalThis.fetch = async (_input, init) => {
    const call: Rpc = JSON.parse(String(init?.body)); calls.push(call);
    return rpcResponse(call.path.endsWith(":getImport") ? { _id: "import1", rows: [], reviewReasons: ["Check source"], errors: ["Incomplete extraction"] } : null);
  };
  try {
    assert.equal((await handleStatementApi(request("/imports/import1", { rows: [row], reviewed: false }, "PATCH"), env, session))?.status, 200);
    let update = calls.find(call => call.path.endsWith(":updateImport"))!;
    assert.deepEqual(update.args[0].errors, ["Incomplete extraction"]);
    calls.length = 0;
    await handleStatementApi(request("/imports/import1", { rows: [row], reviewed: true }, "PATCH"), env, session);
    update = calls.find(call => call.path.endsWith(":updateImport"))!;
    assert.deepEqual(update.args[0].errors, []); assert.deepEqual(update.args[0].reviewReasons, ["Check source"]);
  } finally { globalThis.fetch = original; }
});
