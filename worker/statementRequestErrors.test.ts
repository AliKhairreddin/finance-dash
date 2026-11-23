import assert from "node:assert/strict";
import test from "node:test";
import { handleExactApi } from "./exact";
import { handleMailboxApi } from "./statementMailboxes";

const origin = "https://statements.example";
const env = { CONVEX_URL: "https://rpc-test.convex.cloud", CONVEX_SERVICE_TOKEN: "fixture" };
const session = { username: "Ali", role: "administrator" as const };
const reference = "a86f31ac";

for (const route of [
  { handler: handleExactApi, path: "exact/sync", args: { full: true }, reason: "An update is already starting. Please wait", local: { division: -1 }, localReason: "Choose an authorized Exact company" },
  { handler: handleMailboxApi, path: "mailboxes/fakeid", args: { action: "scan" }, reason: "Reconnect this mailbox first", local: { action: "invalid" }, localReason: "Choose a mailbox action" },
]) {
  const post = (payload: object) => route.handler(new Request(`${origin}/api/statements/${route.path}`, {
    method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(payload),
  }), env, session);

  test(`${route.path} returns the reason for an expected Convex rejection`, async t => {
    t.mock.method(globalThis, "fetch", async () => Response.json({
      status: "error", errorMessage: `[Request ID: ${reference}] Server Error`, errorData: route.reason,
    }, { status: 560 }));
    const response = await post(route.args);
    assert.equal(response?.status, 400);
    assert.deepEqual(await response.json(), { message: route.reason });
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  });

  test(`${route.path} keeps backend diagnostics private and forwards a support reference when present`, async t => {
    const messages = [`[Request ID: ${reference}] Server Error\nPrivate database detail`, "Private database detail"];
    t.mock.method(globalThis, "fetch", async () => Response.json({ status: "error", errorMessage: messages.shift() }, { status: 560 }));
    for (const hasReference of [true, false]) {
      const response = await post(route.args);
      assert.equal(response?.status, 500);
      const { message } = await response.json() as { message: string };
      assert.doesNotMatch(message, /Private database detail|Server Error/);
      assert.equal(message.includes(reference), hasReference);
    }
  });

  test(`${route.path} returns local input errors`, async t => {
    const fetch = t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected request"); });
    const response = await post(route.local);
    assert.equal(response?.status, 400);
    assert.deepEqual(await response.json(), { message: route.localReason });
    assert.equal(fetch.mock.callCount(), 0);
  });
}
