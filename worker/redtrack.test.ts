import assert from "node:assert/strict";
import test from "node:test";
import worker from "./handler";
import { createAuthSessionToken } from "./auth";

test("RedTrack routes enforce sessions, administrator access, valid periods and same-origin writes", async t => {
  const env = {
    AUTH_SESSION_SECRET: "redtrack-session-test", PUBLIC_APP_URL: "https://finance.example",
    TELEGRAM_BOT_TOKEN: "123:test", TELEGRAM_AUTH_USERS_JSON: JSON.stringify({ admin: "12345", media: "11111" }),
    DASHBOARD_MEDIA_SPEND_USERS: "media", TELEGRAM_TRANSACTION_REVIEWER_USERS_JSON: JSON.stringify({ reviewer: "98765" }),
    TELEGRAM_OTP_STATE: { getByName: () => ({ async pollOnboarding() { return 0; } }) },
    CONVEX_URL: "https://redtrack-test.convex.cloud", CONVEX_SERVICE_TOKEN: "service", ASSETS: { fetch: async () => new Response("asset") }
  } as never;
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    calls++;
    assert.equal(new URL(String(input)).hostname, "redtrack-test.convex.cloud");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.args[0].serviceToken, "service");
    if (body.path === "redtrack:links") return Response.json({ status: "success", value: [] });
    assert.equal(body.path, "redtrack:report");
    return Response.json({ status: "success", value: { rows: [], sources: [], syncedDates: [], savedAt: "2026-10-08T00:00:00Z" } });
  });
  const base = "https://finance.example", path = "/api/redtrack?fromDate=2026-10-01&toDate=2026-10-07";
  const request = async (subject: string, path = "/api/redtrack?fromDate=2026-10-01&toDate=2026-10-07", init: RequestInit = {}) => new Request(base + path, { ...init, headers: { ...init.headers,
    Cookie: `__Host-finance_session=${await createAuthSessionToken("redtrack-session-test", "finance.example", subject)}` } });
  assert.equal((await worker.fetch(new Request(base + path), env)).status, 401);
  for (const subject of ["media", "reviewer"]) assert.equal((await worker.fetch(await request(subject), env)).status, 403);
  assert.equal((await worker.fetch(await request("admin", "/api/redtrack?fromDate=invalid"), env)).status, 400);
  assert.equal((await worker.fetch(await request("admin", "/api/redtrack/links", { method: "PUT", body: "{}", headers: { Origin: "https://other.example" } }), env)).status, 403);
  assert.equal((await worker.fetch(await request("admin", "/api/redtrack/sync?fromDate=2026-10-01&toDate=2026-10-07", { method: "POST", headers: { Origin: "https://other.example" } }), env)).status, 403);
  assert.equal(calls, 0);
  const response = await worker.fetch(await request("admin"), env);
  assert.equal(response.status, 200); assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(calls, 2);
});
