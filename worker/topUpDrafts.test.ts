import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { invoiceAccountQuery, prepareTopUpDraft, validatePaymentDetails } from "./topUpDrafts";
import type { TopUpPaymentDetails } from "../shared/topUps";

const privateKeyPem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const env = { CONVEX_URL: "https://test.convex.cloud", CONVEX_SERVICE_TOKEN: "test-service", TOPUP_REVOLUT_DN_ACCOUNT_ID: "source-usd", REVOLUT_CLIENT_ID: "client", REVOLUT_ISSUER: "finance.test", REVOLUT_PRIVATE_KEY_PEM: privateKeyPem, REVOLUT_REFRESH_TOKEN: "refresh", OPENROUTER_API_KEY: "test-key", DOCUMENT_AI_MODEL: "test-model", PUBLIC_APP_URL: "https://finance.test" } as unknown as WorkerEnv;
const details: TopUpPaymentDetails = { payerEntity: "dn", beneficiary: "Example Supplier LLC", iban: "", bic: "", bankCountry: "US", accountNumber: "00123456789", routingNumber: "021000021", reference: "INV-123", amount: 100, currency: "USD", notes: "" };
const recipient = { id: "supplier", name: "Example Supplier LLC", state: "created", accounts: [{ id: "supplier-usd", account_no: details.accountNumber, routing_number: details.routingNumber, bank_country: "US", currency: "USD" }] };
async function mocked(run: (state: { request: any; calls: { url: string; body: any; method?: string }[] }) => Promise<void>, options: { request?: Record<string, unknown>; recipients?: unknown[]; accounts?: unknown[]; createStatus?: number; extractionStatus?: number; ibanSearchStatus?: number; extracted?: unknown } = {}) {
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
      else if (body.path === "topUps:draftResult") { assert.equal(args.token, request.draftAttempt); Object.assign(request, { draftStatus: args.status, draftError: args.error, draftWarning: args.warning, draftId: args.draftId, paymentDetails: args.details }); }
      else throw new Error(`Unexpected Convex operation ${body.path}`);
      return Response.json({ status: "success", value });
    }
    if (url === "https://storage.test/invoice") return new Response("%PDF-1.4 invoice fixture", { headers: { "Content-Type": "application/pdf" } });
    if (url === "https://openrouter.ai/api/v1/chat/completions") return Response.json({ choices: [{ message: { content: JSON.stringify(options.extracted ?? details) } }] }, { status: options.extractionStatus ?? 200 });
    if (url.endsWith("/auth/token")) return Response.json({ access_token: "access" });
    if (url.endsWith("/accounts")) return Response.json(options.accounts ?? [{ id: "source-usd", name: "Main", currency: "USD", state: "active" }]);
    if (url.includes("/counterparties?")) return new URL(url).searchParams.has("iban") && options.ibanSearchStatus ? Response.json({ message: "Invalid bank query" }, { status: options.ibanSearchStatus }) : Response.json(options.recipients ?? [recipient]);
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
    assert.equal(lookup.searchParams.has("account_no"), false); assert.equal(lookup.searchParams.has("iban"), false); assert.ok(lookup.searchParams.get("name"));
    assert.ok(calls.filter(c => c.url.includes("/counterparties?")).every(c => !new URL(c.url).searchParams.has("account_no")));
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
test("a missing recipient or currency account reports Revolut's required account details", async () => {
  for (const recipients of [[], [{ ...recipient, accounts: [{ ...recipient.accounts[0], currency: "EUR" }] }]]) {
    await mocked(async ({ request, calls }) => {
      await prepareTopUpDraft(env, request._id); assert.equal(request.draftStatus, "needs_review");
      assert.match(request.draftError, /Revolut requires a recipient/); assert.equal(writes(calls).length, 0);
    }, { recipients });
  }
});
test("approval creates a draft despite invoice payer, currency, name or extraction warnings", async () => {
  for (const options of [
    { request: { paymentDetails: { ...details, payerEntity: "lmd" } } },
    { request: { paymentDetails: { ...details, currency: "EUR" } } },
    { request: { paymentDetails: { ...details, notes: "Ambiguous beneficiary" } } },
    { recipients: [{ ...recipient, name: "Different beneficiary" }] }
  ]) await mocked(async ({ request, calls }) => {
    await prepareTopUpDraft(env, request._id); assert.equal(request.draftStatus, "created"); assert.ok(request.draftWarning);
    assert.equal(writes(calls).length, 1); assert.equal(calls.find(c => c.url.endsWith("/payment-drafts"))!.body.payments[0].amount, request.amount);
  }, options);
});
test("inactive funding accounts are reported before attempting a draft", async () => {
  await mocked(async ({ request, calls }) => { await prepareTopUpDraft(env, request._id); assert.equal(request.draftStatus, "needs_review"); assert.match(request.draftError, /active Revolut funding account/); assert.equal(writes(calls).length, 0); }, { accounts: [{ id: "source-usd", currency: "USD", state: "inactive" }] });
});
test("saved recipient names allow drafting when invoice account details are missing or unmatched", async () => {
  for (const bankDetails of [{ iban: "", accountNumber: "", routingNumber: "" }, { ...details, accountNumber: "999999" }, { ...details, routingNumber: "021000022" }]) {
    await mocked(async ({ request, calls }) => {
      await prepareTopUpDraft(env, request._id); assert.equal(request.draftStatus, "created"); assert.match(request.draftWarning, /Recipient selected by saved Revolut name/);
      const searches = calls.filter(c => c.url.includes("/counterparties?")); assert.ok(searches.some(c => new URL(c.url).searchParams.has("name")));
      assert.equal(calls.find(c => c.url.endsWith("/payment-drafts"))!.body.payments[0].receiver.account_id, "supplier-usd");
    }, { request: { paymentDetails: { ...details, ...bankDetails } } });
  }
});
test("a failed or unavailable invoice extraction still drafts for an exact saved request recipient", async () => {
  for (const requestDetails of [undefined, { ...details, iban: "", accountNumber: "", routingNumber: "", reference: "" }]) await mocked(async ({ request, calls }) => {
    await prepareTopUpDraft(env, request._id); assert.equal(request.draftStatus, "created");
    const draft = calls.find(c => c.url.endsWith("/payment-drafts"))!.body;
    assert.equal(draft.payments[0].reference, "Top-up #3"); assert.equal(draft.payments[0].receiver.counterparty_id, recipient.id);
    assert.equal(draft.payments[0].amount, 100000); assert.match(draft.title, /Review details/);
    assert.match(request.draftWarning, /Check|check/); assert.equal(writes(calls).length, 1);
  }, { request: { amount: 100000, companyName: details.beneficiary, paymentDetails: requestDetails }, extractionStatus: 503 });
});
test("recipient matching rejects unrelated names and deduplicates accounts across searches", async () => {
  await mocked(async ({ request, calls }) => {
    await prepareTopUpDraft(env, request._id); assert.equal(request.draftStatus, "needs_review"); assert.equal(writes(calls).length, 0);
  }, { request: { companyName: "Unrelated Supplier", paymentDetails: undefined }, extractionStatus: 503 });
  await mocked(async ({ request }) => {
    await prepareTopUpDraft(env, request._id); assert.equal(request.draftStatus, "created");
  }, { request: { companyName: "Example Supplier L.L.C.", paymentDetails: { ...details, accountNumber: "", routingNumber: "" } } });
});
test("unapproved, paid, deleted and crypto requests never reach a draft write", async () => {
  for (const change of [{ status: "pending" }, { status: "paid" }, { deletedAt: "2026-10-22T20:00:00Z" }, { currency: "USDC" }]) await mocked(async ({ request, calls }) => {
    await assert.rejects(prepareTopUpDraft(env, request._id)); assert.equal(writes(calls).length, 0); assert.equal(calls.filter(c => c.url.includes("revolut.com")).length, 0);
  }, { request: change });
});
test("approval alone authorizes the request amount even if the invoice total differs or is missing", async () => {
  for (const invoiceAmount of [26261.04, 100000.01, 200000, null]) {
    await mocked(async ({ request, calls }) => {
      await prepareTopUpDraft(env, request._id);
      assert.equal(request.draftStatus, "created"); assert.equal(request.draftError, undefined);
      const draft = calls.find(c => c.url.endsWith("/payment-drafts"))!.body;
      assert.equal(draft.payments[0].amount, 100000);
      assert.equal(draft.payments[0].currency, "USD");
      assert.equal(request.paymentDetails.amount, invoiceAmount);
      assert.equal(writes(calls).length, 1);
    }, { request: { amount: 100000, draftStatus: "queued", approvedBy: "Ali M", paymentDetails: { ...details, amount: invoiceAmount } } });
  }
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


test("several saved accounts create a review draft using the strongest invoice bank match", async () => {
  await mocked(async ({ request, calls }) => {
    await prepareTopUpDraft(env, request._id); assert.equal(request.draftStatus, "created");
    assert.match(request.draftWarning, /Multiple saved accounts matched/);
    assert.equal(calls.find(c => c.url.endsWith("/payment-drafts"))!.body.payments[0].receiver.account_id, "invoice-account");
    assert.equal(writes(calls).length, 1);
  }, { recipients: [{ ...recipient, accounts: [
    { ...recipient.accounts[0], id: "other-account", account_no: "9999999", routing_number: undefined },
    { ...recipient.accounts[0], id: "invoice-account", routing_number: undefined }
  ] }] });
});
test("equally matching saved accounts use stable Revolut order and mark the draft for review", async () => {
  await mocked(async ({ request, calls }) => {
    await prepareTopUpDraft(env, request._id); assert.equal(request.draftStatus, "created");
    assert.match(request.draftWarning, /Multiple saved accounts matched/);
    assert.equal(calls.find(c => c.url.endsWith("/payment-drafts"))!.body.payments[0].receiver.counterparty_id, recipient.id);
    assert.equal(writes(calls).length, 1);
  }, { recipients: [recipient, { ...recipient, id: "supplier-two" }] });
});


test("a saved legal name can match the requested company name and still create a review draft", async () => {
  await mocked(async ({ request, calls }) => {
    await prepareTopUpDraft(env, request._id); assert.equal(request.draftStatus, "created");
    assert.match(request.draftWarning, /Recipient selected by saved Revolut name/);
    assert.equal(writes(calls).length, 1);
  }, { request: { companyName: "Example Supplier", paymentDetails: undefined }, extractionStatus: 503 });
});
test("a malformed invoice bank query still drafts using a saved recipient; authentication and rate limits are respected", async () => {
  for (const ibanSearchStatus of [400, 401, 429]) await mocked(async ({ request, calls }) => {
    await prepareTopUpDraft(env, request._id);
    assert.equal(request.draftStatus, ibanSearchStatus === 400 ? "created" : "needs_review");
    assert.equal(writes(calls).length, ibanSearchStatus === 400 ? 1 : 0);
    assert.equal(calls.filter(c => c.url.includes("/counterparties?") && new URL(c.url).searchParams.has("name")).length > 0, ibanSearchStatus === 400);
  }, { request: { paymentDetails: { ...details, iban: "BE68539007547034", accountNumber: "", routingNumber: "" } }, ibanSearchStatus });
});
