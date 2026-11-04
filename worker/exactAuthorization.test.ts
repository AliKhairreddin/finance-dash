import assert from "node:assert/strict";
import test from "node:test";
import { convexTest } from "convex-test";
import { v } from "convex/values";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { internalAction } from "../convex/_generated/server";
import { statementCompanies } from "../shared/statements";
import { exactDecrypt } from "../shared/exactHttp";

process.env.CONVEX_SERVICE_TOKEN = "test-service";
process.env.EXACT_CLIENT_ID = "test-client";
process.env.EXACT_CLIENT_SECRET = "test-secret";
process.env.EXACT_ENCRYPTION_KEY = "11".repeat(32);
const auth = { serviceToken: "test-service", actor: "Ali" };
const hash = "a".repeat(64);
const modules = {
  "../convex/_generated/server.ts": () => import("../convex/_generated/server"),
  "../convex/exact.ts": () => import("../convex/exact"),
  "../convex/exactSync.ts": async () => ({
    ...await import("../convex/exactSync"),
    pump: internalAction({ args: {}, returns: v.null(), handler: async () => null })
  })
};
async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async ctx => {
    await ctx.db.insert("statementMembers", { actor: "Ali", companyIds: statementCompanies.map(c => c.id), manage: true, permissions: ["view", "settings", "documents", "import", "download"], accountIds: ["revolut-lmd", "amex-lmd", "wise-lmd"] });
  });
  await t.mutation(api.exact.createOAuthState, { ...auth, hash });
  return t;
}

for (const expiresIn of [600, "600"]) test(`Exact authorization accepts ${typeof expiresIn} token expiry and saves encrypted credentials`, async () => {
  const t = await setup(), original = globalThis.fetch, calls: string[] = [];
  const credentials = { access_token: "private-access-token", refresh_token: "private-refresh-token", expires_in: expiresIn };
  globalThis.fetch = async (input, init) => {
    const url = String(input); calls.push(url);
    if (url.endsWith("/api/oauth2/token")) {
      assert.equal(init?.method, "POST");
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get("code"), "private-code");
      assert.equal(body.get("redirect_uri"), "https://statements.thatcanadian.dev/api/statements/exact/callback");
      return Response.json(credentials);
    }
    assert.match(url, /\/api\/v1\/current\/Me\?/);
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer private-access-token");
    return Response.json({ d: { results: [{ UserID: "test-user", FullName: "Test User", CurrentDivision: 3503006 }] } });
  };
  try {
    await t.action(api.exactSync.finishAuthorization, { ...auth, hash, code: "private-code" });
    const status = await t.query(api.exact.status, auth);
    assert.equal(status.connected, true);
    assert.equal(status.user, "Test User");
    assert.equal(calls.length, 2);
    await t.run(async ctx => {
      const connection = await ctx.db.query("exactConnections").first();
      assert.ok(connection?.encryptedTokens);
      assert.equal(JSON.stringify(connection).includes("private-"), false);
      assert.deepEqual(JSON.parse(await exactDecrypt(connection.encryptedTokens, process.env.EXACT_ENCRYPTION_KEY!)), { ...credentials, expires_in: 600 });
      assert.ok(connection.expiresAt! > Date.now() + 590_000);
      assert.ok(connection.expiresAt! <= Date.now() + 600_000);
      assert.equal(await ctx.db.query("exactOAuthStates").first(), null);
      for (const job of await ctx.db.system.query("_scheduled_functions").take(10)) await ctx.scheduler.cancel(job._id);
    });
  } finally { globalThis.fetch = original; }
});

for (const expiresIn of ["600 seconds", "0", "9007199254740993", -1, null]) test(`Exact authorization rejects invalid expiry ${JSON.stringify(expiresIn)}`, async () => {
  const t = await setup(), original = globalThis.fetch, originalError = console.error;
  let calls = 0;
  console.error = () => undefined;
  globalThis.fetch = async () => { calls++; return Response.json({ access_token: "private-access-token", refresh_token: "private-refresh-token", expires_in: expiresIn }); };
  try {
    await assert.rejects(t.action(api.exactSync.finishAuthorization, { ...auth, hash, code: "private-code" }), /could not complete the connection token exchange/);
    assert.equal(calls, 1);
    assert.equal((await t.query(api.exact.status, auth)).connected, false);
    assert.equal(await t.run(async ctx => Boolean((await ctx.db.query("exactConnections").first())?.encryptedTokens)), false);
  } finally { globalThis.fetch = original; console.error = originalError; }
});

for (const failure of [
  { status: 400, message: /Exact rejected the connection credentials or approval code/ },
  { status: 503, message: /Exact's sign-in service is temporarily unavailable/ }
]) test(`Exact authorization reports HTTP ${failure.status} without exposing secrets or retrying the code`, async () => {
  const t = await setup(), original = globalThis.fetch, originalError = console.error;
  const logs: unknown[][] = []; let calls = 0;
  console.error = (...args: unknown[]) => { logs.push(args); };
  globalThis.fetch = async () => { calls++; return Response.json({ error: "invalid_grant", error_description: "private-code private-secret" }, { status: failure.status }); };
  try {
    await assert.rejects(t.action(api.exactSync.finishAuthorization, { ...auth, hash, code: "private-code" }), failure.message);
    const status = await t.query(api.exact.status, auth);
    assert.equal(status.connected, false);
    assert.match(status.error ?? "", failure.message);
    assert.equal(calls, 1);
    assert.match(JSON.stringify(logs), /token_exchange/);
    assert.equal(JSON.stringify({ logs, status }).includes("private-"), false);
    assert.equal(await t.run(async ctx => Boolean((await ctx.db.query("exactConnections").first())?.encryptedTokens)), false);
  } finally { globalThis.fetch = original; console.error = originalError; }
});
