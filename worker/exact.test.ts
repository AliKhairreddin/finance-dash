import assert from "node:assert/strict";
import test from "node:test";
import { exactCallbackLanding, handleExactApi } from "./exact";
const origin = "https://statements.thatcanadian.dev", env = { CONVEX_URL: "https://test.convex.cloud", CONVEX_SERVICE_TOKEN: "service-test" }, session = { username: "Ali", role: "administrator" as const };
const req = (path: string, value: unknown, source = origin) => new Request(`${origin}/api/statements/exact${path}`, { method: "POST", headers: { Origin: source, "Content-Type": "application/json" }, body: JSON.stringify(value) });
const result = (value: unknown) => Response.json({ status: "success", value });
test("Exact API rejects unauthorized actors and cross-origin financial changes before contacting Convex", async () => {
  assert.equal((await handleExactApi(new Request(`${origin}/api/statements/exact/status`), env, null))?.status, 403);
  assert.equal((await handleExactApi(new Request(`${origin}/api/statements/exact/status`), env, { ...session, username: "Meet" }))?.status, 403);
  assert.equal((await handleExactApi(req("/operations", {}, "https://evil.example"), env, session))?.status, 403);
});
test("Exact ordinary page reads use saved data and authenticated actor only", async () => {
  const original = globalThis.fetch; const calls: Array<{ path: string; args: Array<Record<string, unknown>> }> = [];
  globalThis.fetch = async (_url, init) => { calls.push(JSON.parse(String(init?.body))); return result({ records: [], datasets: [], truncated: false }); };
  try { await handleExactApi(new Request(`${origin}/api/statements/exact/records?division=3503005&kind=invoices&actor=Alaa`), env, session); assert.equal(calls.length, 1); assert.equal(calls[0].path, "exact:records"); assert.equal(calls[0].args[0].actor, "Ali"); assert.equal(calls[0].args[0].division, 3503005); } finally { globalThis.fetch = original; }
});
test("Exact OAuth callback requires matching browser state and cleans the callback URL", async () => {
  const original = globalThis.fetch; let calls = 0; globalThis.fetch = async () => { calls++; return result(null); };
  try {
    const state = "a".repeat(72);
    for (const cookie of ["", "__Host-exact-state=wrong"]) { const response = await handleExactApi(new Request(`${origin}/api/statements/exact/callback?state=${state}&code=private`, { headers: { Cookie: cookie } }), env, session); assert.equal(response?.status, 303); assert.equal(response?.headers.get("Location"), "/?view=exact&exactResult=authorization_failed"); }
    assert.equal(calls, 0);
    const response = await handleExactApi(new Request(`${origin}/api/statements/exact/callback?state=${state}&code=private`, { headers: { Cookie: `__Host-exact-state=${state}` } }), env, session);
    assert.equal(calls, 1); assert.equal(response?.headers.get("Location"), "/?view=exact&exactResult=connected"); assert.match(response?.headers.get("Set-Cookie") ?? "", /Max-Age=0/);
  } finally { globalThis.fetch = original; }
});

test("Exact callback restores same-site navigation without changing Strict session cookies", async () => {
  const state = "a".repeat(72), target = `${origin}/api/statements/exact/callback?state=${state}&code=%22%3E%3Cscript%3Eevil%3C/script%3E`;
  const landing = exactCallbackLanding(new Request(target, { headers: { Cookie: `__Host-exact-state=${state}` } }));
  assert.equal(landing?.status, 200);
  assert.equal(landing?.headers.get("Set-Cookie"), null);
  assert.match(landing?.headers.get("Content-Security-Policy") ?? "", /form-action 'self'/);
  const html = await landing!.text(); assert.match(html, /name="resume" value="1"/); assert.ok(!html.includes("<script>evil"));
  assert.equal(exactCallbackLanding(new Request(target + "&resume=1")), null);
  assert.equal(exactCallbackLanding(new Request(target))?.status, 303);
});
