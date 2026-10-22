import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { handlePublicTopUps } from "./topUps";

const env = { CONVEX_URL: "https://test.convex.cloud", CONVEX_SERVICE_TOKEN: "test-service" } as WorkerEnv;
const details = {
  submissionId: "12345678-1234-1234-1234-123456789abc", entity: "dn", priority: "Normal",
  companyName: "Test supplier", commission: "3%", team: "Cognitive", member: "Test member",
  amount: 2000, currency: "USD", openBalance: -20, lastThreeDaysSpend: 0, expectedThreeDaysSpend: 1000,
  paymentMethod: "Wise", wiseLink: "", notes: "", bmNames: [], accountNames: []
};
function submission(input = details) {
  const body = new FormData();
  body.set("details", JSON.stringify(input));
  body.set("invoice", new File(["%PDF-1.7\nTest fixture"], "test-invoice.pdf", { type: "application/pdf" }));
  body.set("website", "");
  return new Request("https://finance.test/api/public/top-ups", { method: "POST", headers: { Origin: "https://finance.test" }, body });
}
type BackendOptions = { errorData?: string; failCreate?: boolean; previous?: { number: number; status: string } };
function backend(t: TestContext, options: BackendOptions = {}) {
  const calls: Array<{ path: string; args: any }> = [];
  let uploads = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    if (url === "https://storage.test/upload") {
      uploads++;
      assert.equal(init.headers && (init.headers as Record<string, string>)["Content-Type"], "application/pdf");
      assert.ok((init.body as Blob).size > 0);
      return Response.json({ storageId: "stored-invoice" });
    }
    assert.ok(url.startsWith(env.CONVEX_URL));
    const body = JSON.parse(String(init.body)); const args = body.args[0];
    calls.push({ path: body.path, args });
    if (body.path === "topUps:create" && options.failCreate) return Response.json({
      status: "error", errorMessage: "[Request ID: example] Server Error\nUncaught ConvexError: rejected\n at handler (...)",
      ...(options.errorData !== undefined ? { errorData: options.errorData } : {})
    }, { status: 560 });
    const value = body.path === "topUps:rateLimit" ? true
      : body.path === "topUps:bySubmission" ? options.previous ?? null
      : body.path === "dashboard:generateExpenseDocumentUploadUrl" ? "https://storage.test/upload"
      : body.path === "documents:ingest" ? { id: "document", duplicate: false }
      : body.path === "topUps:create" ? { number: 2, status: "pending" }
      : assert.fail(`Unexpected backend call: ${body.path}`);
    return Response.json({ status: "success", value });
  });
  return { calls, uploads: () => uploads };
}

test("a complete multipart submission saves its invoice and request and confirms the request number", async t => {
  const mock = backend(t);
  const response = await handlePublicTopUps(submission(), env);
  assert.equal(response?.status, 201);
  assert.deepEqual(await response?.json(), { number: 2, status: "pending" });
  assert.equal(mock.uploads(), 1);
  assert.deepEqual(mock.calls.find(c => c.path === "topUps:create")?.args.input, details);
  assert.equal(mock.calls.find(c => c.path === "topUps:create")?.args.documentId, "document");
  assert.match(mock.calls.find(c => c.path === "documents:ingest")?.args.contentHash, /^[a-f0-9]{64}$/);
  assert.ok(mock.calls.every(c => c.args.serviceToken === env.CONVEX_SERVICE_TOKEN));
});

test("Convex rejection messages survive request metadata and remain actionable in the public response", async t => {
  const message = "Company no longer exists. Search again.";
  backend(t, { failCreate: true, errorData: message });
  const response = await handlePublicTopUps(submission(), env);
  assert.equal(response?.status, 400);
  assert.deepEqual(await response?.json(), { message });
});

test("unexpected or empty backend failures never return a blank message or internal stack", async t => {
  for (const errorData of [undefined, "", "   "]) {
    backend(t, { failCreate: true, errorData });
    const response = await handlePublicTopUps(submission(), env);
    assert.equal(response?.status, 400);
    assert.deepEqual(await response?.json(), { message: "Request could not be saved. Please try again." });
    t.mock.restoreAll();
  }
});

test("retrying a saved submission confirms the same request without uploading or creating it again", async t => {
  const mock = backend(t, { previous: { number: 2, status: "pending" } });
  const response = await handlePublicTopUps(submission(), env);
  assert.equal(response?.status, 200);
  assert.deepEqual(await response?.json(), { number: 2, status: "pending" });
  assert.equal(mock.uploads(), 0);
  assert.deepEqual(mock.calls.map(c => c.path), ["topUps:rateLimit", "topUps:bySubmission"]);
});

test("the spend minimum returns a visible validation error before storing an invoice", async t => {
  const mock = backend(t);
  const response = await handlePublicTopUps(submission({ ...details, expectedThreeDaysSpend: 0 }), env);
  assert.equal(response?.status, 400);
  assert.deepEqual(await response?.json(), { message: "Expected next three days spend must be at least 1,000 USD" });
  assert.equal(mock.uploads(), 0);
  assert.deepEqual(mock.calls.map(c => c.path), ["topUps:rateLimit"]);
});

test("a crypto request can submit without an invoice or ad spend balances", async t => {
  const mock = backend(t);
  const { entity, commission, openBalance, lastThreeDaysSpend, expectedThreeDaysSpend, ...base } = details;
  const input = { ...base, currency: "USDC", paymentMethod: "Crypto", network: "Ethereum", walletAddress: "0x1234567890123456789012345678901234567890" };
  const body = new FormData(); body.set("details", JSON.stringify(input));
  const response = await handlePublicTopUps(new Request("https://finance.test/api/public/top-ups", { method: "POST", headers: { Origin: "https://finance.test" }, body }), env);
  assert.equal(response?.status, 201); assert.equal(mock.uploads(), 0);
  assert.deepEqual(mock.calls.find(c => c.path === "topUps:create")?.args.input, input);
  assert.equal(mock.calls.find(c => c.path === "topUps:create")?.args.documentId, undefined);
});
