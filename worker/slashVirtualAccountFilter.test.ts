import assert from "node:assert/strict";
import test from "node:test";
import { ConvexHttpClient } from "convex/browser";
import { getFunctionName } from "convex/server";
import type { BankActivitySummary } from "../shared/bankMerchantGroups";
import type { Transaction, TransactionPage } from "../shared/types";
import { createAuthSessionToken } from "./auth";
import worker from "./handler";

const baseTransaction: Transaction = {
  id: "primary",
  source: "slash",
  accountId: "parent-account",
  accountName: "Slash USD",
  date: "2026-06-10",
  description: "Facebook ads",
  rawName: "Facebook ads",
  counterparty: "Facebook",
  amount: 100,
  currency: "USD",
  direction: "out",
  status: "posted",
  category: "Advertising",
  cardId: "shared-card",
  cardLastFour: "1234",
  slashVirtualAccountId: "va-primary",
  slashVirtualAccountName: "Primary Account"
};

const transactions: Transaction[] = [
  baseTransaction,
  { ...baseTransaction, id: "wagner-1", amount: 20, slashVirtualAccountId: "va-wagner", slashVirtualAccountName: "Wagner" },
  { ...baseTransaction, id: "unknown", amount: 400, slashVirtualAccountId: undefined, slashVirtualAccountName: "Wagner" },
  { ...baseTransaction, id: "wagner-2", amount: 30, slashVirtualAccountId: "va-wagner", slashVirtualAccountName: "Wagner" },
  { ...baseTransaction, id: "other-bank", source: "revolut", amount: 700, slashVirtualAccountId: "va-wagner" }
];

test("Slash virtual account filtering scopes pages, groups, cards and drill-downs by ID", async (context) => {
  context.mock.method(ConvexHttpClient.prototype, "query", async (reference: Parameters<typeof getFunctionName>[0], args: unknown) => {
    const name = getFunctionName(reference);
    if (name === "dashboard:getAnalyticsDirectory") {
      return { providers: [], teams: [], transactionCategories: [], documentedTransactionIds: [] };
    }
    if (name === "banking:getActivityCoverage") return [];
    assert.equal(name, "banking:getActivityPage");
    const options = args as { source?: string; paginationOpts: { cursor: string | null } };
    const rows = transactions.filter((transaction) => !options.source || transaction.source === options.source);
    const offset = Number(options.paginationOpts.cursor ?? 0);
    return { page: rows.slice(offset, offset + 2), isDone: offset + 2 >= rows.length, continueCursor: String(offset + 2) };
  });

  const env = {
    AUTH_SESSION_SECRET: "slash-filter-test-secret",
    PUBLIC_APP_URL: "https://finance.example",
    TELEGRAM_BOT_TOKEN: "123456:test-token",
    TELEGRAM_AUTH_USERS_JSON: JSON.stringify({ tester: "12345" }),
    TELEGRAM_OTP_STATE: { getByName() { throw new Error("Unexpected OTP request"); } },
    CONVEX_URL: "https://filter-test.convex.cloud",
    CONVEX_SERVICE_TOKEN: "test-service-token",
    SLASH_API_KEY: "test-slash-key",
    SLASH_CONNECTION_ID: "test-connection",
    SLASH_LEGAL_ENTITY_ID: "test-entity",
    SLASH_BASE_URL: "https://api.slash.com"
  } as never;
  const token = await createAuthSessionToken("slash-filter-test-secret", "finance.example", "tester");
  async function request(path: string, query: string) {
    return worker.fetch(new Request(`https://finance.example/api/transactions${path}?fromDate=2026-06-01&toDate=2026-06-30&${query}`, {
      headers: { Cookie: `__Host-finance_session=${token}` }
    }), env);
  }
  async function page(query: string): Promise<TransactionPage> {
    const response = await request("", query);
    assert.equal(response.status, 200, await response.clone().text());
    return await response.json() as TransactionPage;
  }

  const first = await page("slashVirtualAccountId=va-wagner&limit=1&order=asc");
  assert.deepEqual(first.transactions.map((transaction) => transaction.id), ["wagner-1"]);
  assert.equal(first.totalCount, 2);
  assert.equal(first.isDone, false);
  const second = await page(`slashVirtualAccountId=va-wagner&limit=1&order=asc&cursor=${first.continueCursor}`);
  assert.deepEqual(second.transactions.map((transaction) => transaction.id), ["wagner-2"]);
  assert.equal(second.isDone, true);

  const primary = await page("source=slash&slashVirtualAccountId=va-primary");
  assert.deepEqual(primary.transactions.map((transaction) => transaction.id), ["primary"]);
  assert.equal((await page("source=slash&slashVirtualAccountId=missing")).totalCount, 0);
  assert.equal((await page("source=slash&slashVirtualAccountId=va-wagner&accountId=other-parent")).totalCount, 0);
  assert.equal((await page("source=slash&sort=amount")).totalCount, 4);

  const response = await request("/summary", "source=slash&slashVirtualAccountId=va-wagner");
  assert.equal(response.status, 200, await response.clone().text());
  const summary = await response.json() as BankActivitySummary;
  assert.equal(summary.merchantGroups.length, 1);
  assert.equal(summary.merchantGroups[0].transactionCount, 2);
  assert.deepEqual(summary.merchantGroups[0].spend, { USD: 50 });
  assert.equal(summary.cardGroups.length, 1);
  assert.equal(summary.cardGroups[0].transactionCount, 2);
  assert.deepEqual(summary.cardGroups[0].spend, { USD: 50 });
  for (const [type, key] of [["merchant", summary.merchantGroups[0].key], ["card", summary.cardGroups[0].key]]) {
    const detail = await page(`source=slash&slashVirtualAccountId=va-wagner&groupType=${type}&groupKey=${encodeURIComponent(key)}`);
    assert.equal(detail.totalCount, 2);
    assert.ok(detail.transactions.every((transaction) => transaction.slashVirtualAccountId === "va-wagner"));
  }

  const invalid = await request("", `slashVirtualAccountId=${"x".repeat(257)}`);
  assert.equal(invalid.status, 400);
});
