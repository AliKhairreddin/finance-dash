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

test("Exact authorization exchanges the code, verifies the user, and saves only encrypted tokens", async () => {
  const t = await setup(), original = globalThis.fetch, calls: string[] = [];
  const credentials = { access_token: "private-access-token", refresh_token: "private-refresh-token", expires_in: 600 };
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
      assert.deepEqual(JSON.parse(await exactDecrypt(connection.encryptedTokens, process.env.EXACT_ENCRYPTION_KEY!)), credentials);
      assert.equal(await ctx.db.query("exactOAuthStates").first(), null);
      for (const job of await ctx.db.system.query("_scheduled_functions").take(10)) await ctx.scheduler.cancel(job._id);
    });
  } finally { globalThis.fetch = original; }
});

test("Exact authorization reports the failing stage without exposing provider secrets or retrying the code", async () => {
  const t = await setup(), original = globalThis.fetch, originalError = console.error;
  const logs: unknown[][] = []; let calls = 0;
  console.error = (...args: unknown[]) => { logs.push(args); };
  globalThis.fetch = async () => { calls++; return Response.json({ error: "invalid_grant", error_description: "private-code private-secret" }, { status: 400 }); };
  try {
    await assert.rejects(t.action(api.exactSync.finishAuthorization, { ...auth, hash, code: "private-code" }), /Exact rejected the connection credentials or approval code/);
    const status = await t.query(api.exact.status, auth);
    assert.equal(status.connected, false);
    assert.match(status.error ?? "", /app credentials and callback URL/);
    assert.equal(calls, 1);
    assert.match(JSON.stringify(logs), /token_exchange/);
    assert.equal(JSON.stringify({ logs, status }).includes("private-"), false);
    assert.equal(await t.run(async ctx => Boolean((await ctx.db.query("exactConnections").first())?.encryptedTokens)), false);
  } finally { globalThis.fetch = original; console.error = originalError; }
});
