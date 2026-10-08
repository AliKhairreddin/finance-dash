import assert from "node:assert/strict";
import test from "node:test";
import worker from "./handler";
import { createAuthSessionToken } from "./auth";

test("authenticated Wagner requests persist once and reuse Convex data, with existing role restrictions", async t => {
  const env = {
    AUTH_SESSION_SECRET: "session-test", PUBLIC_APP_URL: "https://finance.example",
    TELEGRAM_BOT_TOKEN: "123:test", TELEGRAM_AUTH_USERS_JSON: JSON.stringify({ media: "12345" }),
    DASHBOARD_MEDIA_SPEND_USERS: "media", TELEGRAM_TRANSACTION_REVIEWER_USERS_JSON: JSON.stringify({ reviewer: "98765" }),
    TELEGRAM_OTP_STATE: { getByName: () => ({ async pollOnboarding() { return 0; } }) },
    CONVEX_URL: "https://test.convex.cloud", CONVEX_SERVICE_TOKEN: "service", WAGNER_API_KEY: "source-key",
    ASSETS: { fetch: async () => new Response("asset") }
  } as never;
  let stored: Record<string, unknown> | undefined;
  let sourceCalls = 0;
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === "www.inchops.com") {
      sourceCalls++;
      return Response.json({ from: "2026-09-01", to: "2026-09-02", currency: "USD", group_by: ["agency"],
        data_through: "2026-10-08", generated_at: "2026-10-08T12:00:00Z",
        totals: { spend_usd: 5, commission_usd: 0.15, rows: 1 }, rows: [{ agency_id: "a", agency_name: "Agency", spend_usd: 5, commission_usd: 0.15 }] });
    }
    assert.equal(url.hostname, "test.convex.cloud");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.args[0].serviceToken, "service");
    if (body.path === "wagnerSpendCache:acquire") return Response.json({ status: "success", value: stored ? { status: "cached", ...stored } : { status: "claimed" } });
    assert.equal(body.path, "wagnerSpendCache:save");
    const { payload, savedAt, refreshAfter } = body.args[0];
    stored = { payload, savedAt, refreshAfter };
    return Response.json({ status: "success", value: null });
  });
  const url = "https://finance.example/api/media-spend/wagner?fromDate=2026-09-01&toDate=2026-09-02";
  const requestFor = async (subject: string) => new Request(url, { headers: {
    Cookie: `__Host-finance_session=${await createAuthSessionToken("session-test", "finance.example", subject)}`
  } });
  assert.equal((await worker.fetch(new Request(url), env)).status, 401);
  assert.equal((await worker.fetch(await requestFor("reviewer"), env)).status, 403);
  for (let i = 0; i < 2; i++) {
    const response = await worker.fetch(await requestFor("media"), env);
    assert.equal(response.status, 200);
    const data = await response.json() as { totals: { spend: number }; savedAt: string };
    assert.equal(data.totals.spend, 5);
    assert.ok(data.savedAt);
  }
  assert.equal(sourceCalls, 1);
});
