import assert from "node:assert/strict";
import test from "node:test";
import worker from "./handler";
import { createAuthSessionToken } from "./auth";

test("invoice deletion routes use atomic mutations and show production validation reasons", async t => {
  const secret = "draft-deletion-session-test";
  const token = await createAuthSessionToken(secret, "finance.example", "admin");
  const env = {
    CONVEX_URL: "https://deletion-test.convex.cloud", CONVEX_SERVICE_TOKEN: "service",
    AUTH_SESSION_SECRET: secret, TELEGRAM_AUTH_USERS_JSON: JSON.stringify({ admin: "12345" }),
    TELEGRAM_BOT_TOKEN: "test", TELEGRAM_OTP_STATE: { getByName: () => ({}) }
  } as never;
  let rejection: string | undefined;
  const calls: Array<{ path: string; args: Record<string, unknown>[] }> = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), "https://deletion-test.convex.cloud/api/mutation");
    const body = JSON.parse(String(init?.body));
    calls.push(body);
    return rejection
      ? Response.json({ status: "error", errorMessage: "[Request ID: test] Server Error", errorData: rejection }, { status: 560 })
      : Response.json({ status: "success", value: body.path === "invoiceDrafts:remove" ? [] : null });
  });
  for (const [path, fn, payload] of [
    ["/api/receivables", "invoiceDrafts:removeOpenItems", { ids: ["invoice", "manual"] }],
    ["/api/invoices", "invoiceDrafts:remove", { invoiceIds: ["invoice"] }]
  ] as const) {
    const request = (origin = "https://finance.example", cookie = `__Host-finance_session=${token}`) => new Request(`https://finance.example${path}`, {
      method: "DELETE", headers: { Origin: origin, Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify(payload)
    });
    const before = calls.length;
    assert.equal((await worker.fetch(request("https://other.example"), env)).status, 403);
    assert.equal((await worker.fetch(request("https://finance.example", ""), env)).status, 401);
    assert.equal(calls.length, before);
    rejection = "TEST-1: Drafts with recorded payment allocations cannot be deleted";
    const blocked = await worker.fetch(request(), env);
    assert.equal(blocked.status, 409);
    assert.deepEqual(await blocked.json(), { message: rejection });
    rejection = undefined;
    const response = await worker.fetch(request(), env);
    assert.equal(response.status, 200);
    assert.equal(calls.length, before + 2);
    for (const call of calls.slice(before)) {
      assert.equal(call.path, fn);
      assert.deepEqual(call.args, [{ serviceToken: "service", ...payload }]);
    }
  }
});
