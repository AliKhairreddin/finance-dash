import assert from "node:assert/strict";
import test from "node:test";
import { handleRevolutAuthorization } from "./revolutAuthorization";

const env = { CONVEX_SERVICE_TOKEN: "service-test", REVOLUT_ENVIRONMENT: "production", REVOLUT_CLIENT_ID: "client-test", REVOLUT_ISSUER: "finance.thatcanadian.dev" } as WorkerEnv;
const request = (body: unknown, token = "service-test") => new Request("https://finance.test/api/internal/revolut/authorize", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
test("production reauthorization rejects browser sessions, wrong service credentials and invalid codes", async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("Must not call Revolut"); };
  try {
    for (const token of ["", "wrong"]) assert.equal((await handleRevolutAuthorization(request({ code: "code" }, token), env)).status, 401);
    for (const code of [null, "", "x".repeat(2001)]) assert.equal((await handleRevolutAuthorization(request({ code }), env)).status, 400);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});
test("reauthorization uses the stored signing key and returns a non-cacheable token without upstream error details", async () => {
  const keys = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const key = Buffer.from(await crypto.subtle.exportKey("pkcs8", keys.privateKey)).toString("base64");
  const configured = { ...env, REVOLUT_PRIVATE_KEY_PEM: `-----BEGIN PRIVATE KEY-----\n${key}\n-----END PRIVATE KEY-----` };
  const original = globalThis.fetch; let fail = false;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://b2b.revolut.com/api/1.0/auth/token");
    const body = new URLSearchParams(String(init?.body));
    assert.equal(body.get("grant_type"), "authorization_code"); assert.equal(body.get("code"), "short-lived-code"); assert.ok(body.get("client_assertion"));
    return fail ? new Response("secret-upstream-detail", { status: 400 }) : Response.json({ access_token: "access-test", refresh_token: "refresh-test" });
  };
  try {
    const response = await handleRevolutAuthorization(request({ code: "short-lived-code" }), configured);
    assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "no-store"); assert.deepEqual(await response.json(), { refreshToken: "refresh-test" });
    fail = true; const error = await handleRevolutAuthorization(request({ code: "short-lived-code" }), configured);
    assert.equal(error.status, 400); assert.doesNotMatch(await error.text(), /secret-upstream-detail/);
  } finally { globalThis.fetch = original; }
});
