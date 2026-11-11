import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { Transaction, TransactionPage } from "../shared/types";
import { createAuthSessionToken } from "./auth";
import worker from "./handler";

const env = {
  AUTH_SESSION_SECRET: "bank-export-test-secret",
  PUBLIC_APP_URL: "https://finance.example",
  TELEGRAM_BOT_TOKEN: "123:test",
  TELEGRAM_AUTH_USERS_JSON: JSON.stringify({ tester: "12345" }),
  TELEGRAM_OTP_STATE: { getByName() { throw new Error("Unexpected OTP request"); } },
  CONVEX_URL: "https://bank-export-test.convex.cloud", CONVEX_SERVICE_TOKEN: "test-token",
  SLASH_API_KEY: "test", SLASH_LEGAL_ENTITY_ID: "test", SLASH_BASE_URL: "https://api.slash.com", SLASH_CONNECTION_ID: "primary",
  REVOLUT_CLIENT_ID: "test", REVOLUT_ISSUER: "test", REVOLUT_PRIVATE_KEY_PEM: "test", REVOLUT_REFRESH_TOKEN: "test", REVOLUT_CONNECTION_ID: "primary"
} as unknown as Parameters<typeof worker.fetch>[1];
const period = "fromDate=2026-09-01&toDate=2026-09-30";
const rows: Transaction[] = Array.from({ length: 245 }, (_, index) => ({
  id: `transaction-${index}`, source: index % 2 ? "slash" : "revolut", accountId: "account",
  accountName: "Test account", date: index % 2 ? "2026-09-01" : "2026-09-30", amount: index + 1,
  currency: "USD", direction: "out", status: "posted", counterparty: "Test merchant",
  description: "Test purchase", rawName: "Test purchase", category: "Software"
}));
const fixtures: Transaction[] = [...rows,
  { ...rows[0], id: "before", date: "2026-08-31" },
  { ...rows[0], id: "after", date: "2026-10-01" },
  { ...rows[0], id: "other-bank", source: "wise" },
  { ...rows[0], id: "other-category", category: "Travel" }
];
async function request(path: string, query = `${period}&source=slash,revolut`) {
  const token = await createAuthSessionToken(env.AUTH_SESSION_SECRET!, "finance.example", "tester");
  return worker.fetch(new Request(`https://finance.example/api/transactions${path}?${query}`, {
    headers: { cookie: `__Host-finance_session=${token}` }
  }), env);
}
function storage(t: TestContext, options: { missing?: boolean; brokenCursor?: boolean; failSecondPage?: boolean } = {}) {
  const calls: Array<{ path: string; args: Record<string, any> }> = [];
  t.mock.method(globalThis, "fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.equal(String(input), `${env.CONVEX_URL}/api/query`, "only saved Convex data may be read");
    const body = JSON.parse(String(init?.body));
    calls.push(body);
    const args = body.args[0];
    let value: unknown;
    if (body.path === "dashboard:getAnalyticsDirectory") value = { providers: [], teams: [], transactionCategories: [], documentedTransactionIds: [] };
    else if (body.path === "banking:getActivityCoverage") value = [
      { source: "slash", missingRanges: options.missing ? [{ fromDate: "2026-09-01", toDate: "2026-09-30" }] : [] },
      { source: "wise", missingRanges: [{ fromDate: "2026-09-01", toDate: "2026-09-30" }] }
    ].filter(item => !args.source || item.source === args.source);
    else if (body.path === "banking:getActivityPage") {
      assert.equal(args.fromDate, "2026-09-01"); assert.equal(args.toDate, "2026-09-30");
      const eligible = fixtures.filter(row => (!args.source || row.source === args.source) && row.date >= args.fromDate && row.date <= args.toDate);
      const offset = Number(args.paginationOpts.cursor ?? 0);
      if (options.failSecondPage && offset > 0) throw new Error("Saved storage unavailable");
      const page = eligible.slice(offset, offset + 60);
      const isDone = offset + page.length >= eligible.length;
      value = { page, isDone, continueCursor: options.brokenCursor || isDone ? "" : String(offset + page.length) };
    } else assert.fail(`Unexpected storage call ${body.path}`);
    return Response.json({ status: "success", value });
  });
  return calls;
}

test("multi-bank pages and summaries use both source indexes and retain date/category/sort filters", async t => {
  const calls = storage(t);
  const query = `${period}&source=slash,revolut,slash&category=Software&sort=amount&order=asc&limit=100`;
  const first = await request("", query);
  assert.equal(first.status, 200);
  const page = await first.json() as TransactionPage;
  assert.equal(page.totalCount, 245); assert.equal(page.transactions.length, 100);
  assert.deepEqual(page.transactions.map(row => row.amount), Array.from({ length: 100 }, (_, i) => i + 1));
  const next = await request("", `${query}&cursor=${page.continueCursor}`);
  assert.deepEqual((await next.json() as TransactionPage).transactions.map(row => row.amount), Array.from({ length: 100 }, (_, i) => i + 101));
  assert.deepEqual(page.coverage, [{ source: "slash", missingRanges: [] }]);
  const summary = await request("/summary", query);
  assert.equal(summary.status, 200);
  assert.equal((await summary.json() as { transactionCount: number }).transactionCount, 245);
  const sources = new Set(calls.filter(call => call.path === "banking:getActivityPage").map(call => call.args[0].source));
  assert.deepEqual(sources, new Set(["revolut", "slash"]));
});

test("export includes every matching row beyond the visible page, with inclusive dates and current sort", async t => {
  storage(t);
  const response = await request("/export", `${period}&source=slash,revolut&category=Software&sort=amount&order=desc&limit=100&cursor=activity-offset:100`);
  assert.equal(response.status, 200);
  const result = await response.json() as TransactionPage;
  assert.equal(result.totalCount, 245); assert.equal(result.isDone, true); assert.equal(result.continueCursor, null);
  assert.deepEqual(result.transactions.map(row => row.amount), Array.from({ length: 245 }, (_, i) => 245 - i));
  assert.deepEqual(new Set(result.transactions.map(row => row.date)), new Set(["2026-09-01", "2026-09-30"]));
});

test("single-bank export retains date, search and direction filters", async t => {
  storage(t);
  const response = await request("/export", `${period}&source=slash&search=no-match&direction=out`);
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json() as TransactionPage).transactions, []);
});

test("export refuses missing history, broken pagination, and failed subsequent reads", async t => {
  for (const options of [{ missing: true }, { brokenCursor: true }, { failSecondPage: true }]) {
    await t.test(JSON.stringify(options), async child => {
      storage(child, options);
      const response = await request("/export");
      assert.ok(response.status >= 400);
      const payload = await response.json() as Record<string, unknown>;
      assert.equal(payload.transactions, undefined);
      assert.equal(typeof payload.message, "string");
    });
  }
});

test("multi-bank source validation rejects unknown sources before accessing storage", async () => {
  for (const path of ["", "/summary", "/export"]) {
    const response = await request(path, `${period}&source=slash,unknown`);
    assert.equal(response.status, 400);
  }
});
