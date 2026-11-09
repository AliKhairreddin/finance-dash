import assert from "node:assert/strict";
import test from "node:test";
import { ConvexHttpClient } from "convex/browser";
import { getFunctionName } from "convex/server";
import type { BankActivitySummary } from "../shared/bankMerchantGroups";
import type { Transaction, TransactionPage } from "../shared/types";
import { createAuthSessionToken } from "./auth";
import worker from "./handler";

test("Mercury entity scopes sorted transaction pages, summaries and drill-downs without upstream requests", async context => {
  const transactions: Transaction[] = ["mojo", "coveragebird", "coveragepro", "coveragebird"].map((entity, index) => ({
    id: `row-${index}`, source: "mercury", mercuryEntity: entity as Transaction["mercuryEntity"], accountId: `account-${entity}`,
    accountName: `${entity} Checking`, date: "2026-11-09", description: "Software", rawName: "Supplier", counterparty: "Supplier",
    amount: (index + 1) * 10, currency: "USD", direction: "out", status: "posted", category: "Software"
  }));
  context.mock.method(ConvexHttpClient.prototype, "query", async (reference: Parameters<typeof getFunctionName>[0], args: unknown) => {
    const name = getFunctionName(reference);
    if (name === "dashboard:getAnalyticsDirectory") return { providers: [], teams: [], transactionCategories: [], documentedTransactionIds: [] };
    if (name === "banking:getActivityCoverage") return [];
    assert.equal(name, "banking:getActivityPage");
    const options = args as { paginationOpts: { cursor: string | null } };
    const offset = Number(options.paginationOpts.cursor ?? 0);
    return { page: transactions.slice(offset, offset + 2), isDone: offset + 2 >= transactions.length, continueCursor: String(offset + 2) };
  });
  const env = { AUTH_SESSION_SECRET: "mercury-filter-test-secret", PUBLIC_APP_URL: "https://finance.example", TELEGRAM_BOT_TOKEN: "123:test",
    TELEGRAM_AUTH_USERS_JSON: JSON.stringify({ tester: "12345" }), TELEGRAM_OTP_STATE: { getByName() { throw new Error("Unexpected OTP request"); } }, CONVEX_URL: "https://filter-test.convex.cloud", CONVEX_SERVICE_TOKEN: "test",
    MERCURY_API_TOKEN: "mojo", MERCURY_COVERAGEBIRD_API_TOKEN: "bird", MERCURY_COVERAGEPRO_API_TOKEN: "pro", MERCURY_CONNECTION_ID: "mojo-labs" } as never;
  const token = await createAuthSessionToken("mercury-filter-test-secret", "finance.example", "tester");
  const request = (path: string, query: string) => worker.fetch(new Request(`https://finance.example/api/transactions${path}?source=mercury&fromDate=2026-11-01&toDate=2026-11-09&${query}`, { headers: { Cookie: `__Host-finance_session=${token}` } }), env);
  const response = await request("", "mercuryEntity=coveragebird&sort=amount&order=desc&limit=1");
  assert.equal(response.status, 200, await response.clone().text());
  const first = await response.json() as TransactionPage;
  assert.equal(first.totalCount, 2);
  assert.deepEqual(first.transactions.map(row => row.id), ["row-3"]);
  const second = await (await request("", `mercuryEntity=coveragebird&sort=amount&order=desc&limit=1&cursor=${first.continueCursor}`)).json() as TransactionPage;
  assert.deepEqual(second.transactions.map(row => row.id), ["row-1"]);
  const summary = await (await request("/summary", "mercuryEntity=coveragebird")).json() as BankActivitySummary;
  assert.deepEqual(summary.merchantGroups[0].spend, { USD: 60 });
  const detail = await (await request("", `mercuryEntity=coveragebird&groupType=merchant&groupKey=${encodeURIComponent(summary.merchantGroups[0].key)}`)).json() as TransactionPage;
  assert.ok(detail.transactions.every(row => row.mercuryEntity === "coveragebird"));
  assert.equal((await request("", "mercuryEntity=unknown")).status, 400);
  const internal = await worker.fetch(new Request("https://finance.example/api/internal/mercury/entities"), env);
  assert.equal(internal.status, 401);
});
