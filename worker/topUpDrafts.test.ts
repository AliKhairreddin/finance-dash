import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { invoiceAccountQuery, prepareTopUpDraft, validatePaymentDetails } from "./topUpDrafts";
import type { TopUpPaymentDetails } from "../shared/topUps";

const privateKeyPem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const env = { CONVEX_URL: "https://test.convex.cloud", CONVEX_SERVICE_TOKEN: "test-service", TOPUP_REVOLUT_DN_ACCOUNT_ID: "source-usd", REVOLUT_CLIENT_ID: "client", REVOLUT_ISSUER: "finance.test", REVOLUT_PRIVATE_KEY_PEM: privateKeyPem, REVOLUT_REFRESH_TOKEN: "refresh", OPENROUTER_API_KEY: "test-key", DOCUMENT_AI_MODEL: "test-model", PUBLIC_APP_URL: "https://finance.test" } as unknown as WorkerEnv;
const details: TopUpPaymentDetails = { payerEntity: "dn", beneficiary: "Example Supplier LLC", iban: "", bic: "", bankCountry: "US", accountNumber: "00123456789", routingNumber: "021000021", reference: "INV-123", amount: 100, currency: "USD", notes: "" };
const recipient = { id: "supplier", name: "Example Supplier LLC", state: "created", accounts: [{ id: "supplier-usd", account_no: details.accountNumber, routing_number: details.routingNumber, bank_country: "US", currency: "USD" }] };
async function mocked(run: (state: { request: any; calls: { url: string; body: any; method?: string }[] }) => Promise<void>, options: { request?: Record<string, unknown>; recipients?: unknown[]; accounts?: unknown[]; createStatus?: number; extracted?: unknown } = {}) {
  const original = globalThis.fetch;
  const request: any = { _id: "request-123", number: 3, status: "approved", draftStatus: "needs_review", currency: "USD", entity: "dn", amount: 100, companyName: "Example Supplier", documentId: "doc", contentType: "application/pdf", fileName: "invoice.pdf", paymentDetails: details, ...options.request };
  const calls: { url: string; body: any; method?: string }[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input), body = init?.body && String(init.body).startsWith("{") ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body, method: init?.method });
    if (url.startsWith(env.CONVEX_URL)) {
      const args = body.args[0]; let value: unknown = null;
      if (body.path === "topUps:get") value = request;
      else if (body.path === "documents:get") value = { url: "https://storage.test/invoice" };
      else if (body.path === "topUps:claimDraft") { value = ["queued", "needs_review", "failed"].includes(request.draftStatus); if (value) { request.draftStatus = "creating"; request.draftAttempt = args.token; } }
      else if (body.path === "topUps:draftResult") { assert.equal(args.token, request.draftAttempt); Object.assign(request, { draftStatus: args.status, draftError: args.error, draftId: args.draftId, paymentDetails: args.details }); }
      else throw new Error(`Unexpected Convex operation ${body.path}`);
      return Response.json({ status: "success", value });
    }
    if (url === "https://storage.test/invoice") return new Response("%PDF-1.4 invoice fixture", { headers: { "Content-Type": "application/pdf" } });
    if (url === "https://openrouter.ai/api/v1/chat/completions") return Response.json({ choices: [{ message: { content: JSON.stringify(options.extracted ?? details) } }] });
    if (url.endsWith("/auth/token")) return Response.json({ access_token: "access" });
    if (url.endsWith("/accounts")) return Response.json(options.accounts ?? [{ id: "source-usd", name: "Main", currency: "USD", state: "active" }]);
    if (url.includes("/counterparties?")) return Response.json(options.recipients ?? [recipient]);
    if (url.endsWith("/payment-drafts") && init?.method === "POST") return Response.json({ id: "draft-3" }, { status: options.createStatus ?? 201 });
    throw new Error(`Unexpected upstream endpoint ${new URL(url).pathname}`);
  };
  try { await run({ request, calls }); } finally { globalThis.fetch = original; }
}
const writes = (calls: { url: string; method?: string }[]) => calls.filter(c => c.url.includes("revolut.com") && c.method === "POST" && !c.url.endsWith("/auth/token"));

test("US invoice identifiers preserve leading zeroes and require a valid ABA routing checksum", () => {
  const normalized = validatePaymentDetails({ ...details, bankCountry: "us", accountNumber: "0012 3456-789", routingNumber: "021-000-021" });
  assert.deepEqual(invoiceAccountQuery(normalized), { account_no: "00123456789" });
  for (const routingNumber of ["021000022", "000000000", "123", "abc"]) assert.throws(() => invoiceAccountQuery({ ...details, routingNumber }), /ABA routing/);
  for (const change of [{ bankCountry: "CA" }, { currency: "EUR" }, { accountNumber: "123" }]) assert.throws(() => invoiceAccountQuery({ ...details, ...change }), /bank details/);
  assert.throws(() => invoiceAccountQuery({ ...details, iban: "BE68539007547034" }), /one invoice beneficiary account format/);
});
test("an exact saved US recipient creates one unsent draft from Main USD with the invoice reference", async () => {
  await mocked(async ({ request, calls }) => {
    await prepareTopUpDraft(env, request._id);
    assert.equal(request.draftStatus, "created"); assert.equal(request.draftId, "draft-3");
    const lookup = new URL(calls.find(c => c.url.includes("/counterparties?"))!.url);
    assert.equal(lookup.searchParams.get("account_no"), details.accountNumber); assert.equal(lookup.searchParams.has("iban"), false);
    assert.deepEqual(writes(calls).map(c => new URL(c.url).pathname), ["/api/1.0/payment-drafts"]);
    assert.deepEqual(writes(calls)[0] && calls.find(c => c.url.endsWith("/payment-drafts"))!.body, { title: "Top-up #3 · Example Supplier", payments: [{ account_id: "source-usd", receiver: { counterparty_id: "supplier", account_id: "supplier-usd" }, amount: 100, currency: "USD", reference: "INV-123" }] });
    assert.equal(calls.filter(c => c.url.includes("openrouter.ai")).length, 0);
    await assert.rejects(prepareTopUpDraft(env, request._id), /already exists/);
    assert.equal(writes(calls).length, 1);
  });
});
test("IBAN invoices still match the exact saved currency account", async () => {
  await mocked(async ({ request }) => { await prepareTopUpDraft(env, request._id); assert.equal(request.draftStatus, "created"); }, {
    request: { paymentDetails: { ...details, iban: "BE68539007547034", bankCountry: "BE", accountNumber: "", routingNumber: "" } },
    recipients: [{ ...recipient, accounts: [{ id: "supplier-usd", iban: "BE68539007547034", currency: "USD" }] }]
  });
});
test("missing, ambiguous, or mismatched saved US accounts stop before any draft write", async () => {
  for (const recipients of [[], [recipient, recipient], ...[{ routing_number: "123456789" }, { account_no: "999999" }, { bank_country: "CA" }, { currency: "EUR" }].map(change => [{ ...recipient, accounts: [{ ...recipient.accounts[0], ...change }] }])]) {
    await mocked(async ({ request, calls }) => {
      await prepareTopUpDraft(env, request._id); assert.equal(request.draftStatus, "needs_review"); assert.match(request.draftError, /Exactly one saved recipient/); assert.equal(writes(calls).length, 0);
    }, { recipients });
  }
});
test("invoice mismatches, recipient names and inactive funding accounts require review", async () => {
  for (const options of [
    { request: { paymentDetails: { ...details, amount: 99 } } },
    { request: { paymentDetails: { ...details, payerEntity: "lmd" } } },
    { request: { paymentDetails: { ...details, notes: "Ambiguous beneficiary" } } },
    { recipients: [{ ...recipient, name: "Different beneficiary" }] },
    { accounts: [{ id: "source-usd", currency: "USD", state: "inactive" }] }
  ]) await mocked(async ({ request, calls }) => { await prepareTopUpDraft(env, request._id); assert.equal(request.draftStatus, "needs_review"); assert.equal(writes(calls).length, 0); }, options);
});
test("explicit invoice review uses the approved amount and verified account rather than replacing it with invoice total", async () => {
  await mocked(async ({ request, calls }) => {
    await prepareTopUpDraft(env, request._id, { review: { details, sourceAccountId: "source-usd", reviewed: true } });
    assert.equal(request.draftStatus, "created"); assert.equal(calls.find(c => c.url.endsWith("/payment-drafts"))!.body.payments[0].amount, 90);
  }, { request: { amount: 90 } });
});
test("an intentional re-extraction reads the invoice once and replaces incomplete saved bank details", async () => {
  await mocked(async ({ request, calls }) => {
    await prepareTopUpDraft(env, request._id, { reextract: true });
    assert.equal(request.draftStatus, "created"); assert.deepEqual(request.paymentDetails, details);
    const extraction = calls.find(c => c.url.includes("openrouter.ai"))!.body;
    assert.equal(calls.filter(c => c.url === "https://storage.test/invoice").length, 1);
    assert.match(extraction.messages[0].content, /ABA routing number/);
    assert.equal(extraction.provider.zdr, true);
  }, { request: { paymentDetails: { ...details, bankCountry: undefined, accountNumber: undefined, routingNumber: undefined, notes: "Incomplete previous extraction" } } });
});
test("a failed draft POST is not retried and an uncertain result blocks future writes", async () => {
  await mocked(async ({ request, calls }) => {
    await prepareTopUpDraft(env, request._id); assert.equal(request.draftStatus, "uncertain");
    await assert.rejects(prepareTopUpDraft(env, request._id), /already exists/);
    assert.equal(writes(calls).length, 1);
  }, { createStatus: 503 });
  await mocked(async ({ request, calls }) => { await prepareTopUpDraft(env, request._id); assert.equal(request.draftStatus, "needs_review"); assert.equal(writes(calls).length, 1); }, { createStatus: 400 });
});
