import assert from "node:assert/strict";
import test from "node:test";
import { fetchMercuryActivityBatch } from "./mercuryApi";
import { calculateApproximateUsdTotals } from "./income";
import { createBankAnalyticsAccumulator } from "./analytics";
import { cashFlowCashAccountGroups, cashFlowCashAccountOrder, cashFlowUsdTotal } from "./cashFlowReport";
import { bankConnectionKey } from "./bankConnectionIdentity";
import { isCurrentBankTransactionId } from "./providerIdentity";
import { buildTelegramCashReport, cashReportCopyButton } from "../worker/telegramCashReport";
import { enrichTransactions } from "../server/matching";
import type { CashFlowLine } from "./types";

const accountId = "00000000-0000-4000-8000-000000000001";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const account = { id: accountId, name: "Mercury Checking", type: "mercury", kind: "checking", currentBalance: 1281.29, createdAt: "2025-09-05T16:44:03Z" };
const transaction = (n: number, patch: Record<string, unknown> = {}) => ({
  id: id(n), accountId, amount: 100, status: "sent", kind: "other", counterpartyName: "Client",
  createdAt: "2026-10-01T12:00:00Z", postedAt: "2026-10-02T12:00:00Z", ...patch
});
const options = { apiToken: "test-token", dateRange: { fromDate: "2026-10-01", toDate: "2026-10-06" }, now: Date.parse("2026-10-06T12:00:00Z") };
const response = (data: unknown) => new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });

function provider(transactions: Record<string, unknown>[]) {
  return (async (input, init) => {
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer test-token");
    assert.equal(init?.redirect, "error");
    const url = new URL(String(input));
    assert.equal(url.origin, "https://api.mercury.com");
    return url.pathname.endsWith("accounts") ? response({ accounts: [account], page: {} }) : response({ transactions, page: {} });
  }) as typeof fetch;
}

test("the first Mercury sync starts at account opening and freezes the entire history in its checkpoint", async () => {
  const dates: string[] = [];
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("accounts")) return response({ accounts: [account], page: {} });
    dates.push(url.searchParams.get("start") ?? url.searchParams.get("postedStart")!);
    return response({ transactions: [transaction(1, { createdAt: "2025-12-11T12:00:00Z", postedAt: "2025-12-11T12:00:00Z" })], page: {} });
  };
  const first = await fetchMercuryActivityBatch({ apiToken: "test-token", now: options.now, fetcher, pageBudget: 1 });
  assert.deepEqual(first.dateRange, { fromDate: "2025-09-05", toDate: "2026-10-06" });
  assert.equal(first.transactions.length, 1);
  const second = await fetchMercuryActivityBatch({ apiToken: "test-token", now: options.now + 86400000, fetcher, checkpoint: first.nextCheckpoint! });
  assert.equal(second.complete, true);
  assert.deepEqual(second.dateRange, first.dateRange);
  assert.deepEqual(dates, ["2025-09-05T00:00:00.000Z", "2025-09-05T00:00:00.000Z"]);
});

test("Mercury resumes provider cursors and finds older-created activity posted in the requested period", async () => {
  const requests: URL[] = [];
  const fetcher: typeof fetch = async input => {
    const url = new URL(String(input)); requests.push(url);
    if (url.pathname.endsWith("accounts")) return response({ accounts: [account], page: {} });
    if (url.searchParams.has("postedStart")) return response({ transactions: [transaction(3, { createdAt: "2026-09-01T12:00:00Z" })], page: {} });
    return url.searchParams.has("start_after")
      ? response({ transactions: [transaction(2, { status: "pending", postedAt: null })], page: {} })
      : response({ transactions: [transaction(1)], page: { nextPage: id(1) } });
  };
  const first = await fetchMercuryActivityBatch({ ...options, fetcher, pageBudget: 1 });
  assert.equal(first.complete, false);
  const second = await fetchMercuryActivityBatch({ ...options, fetcher, checkpoint: first.nextCheckpoint!, pageBudget: 1 });
  assert.equal(second.complete, false);
  const third = await fetchMercuryActivityBatch({ ...options, fetcher, checkpoint: second.nextCheckpoint!, pageBudget: 1 });
  assert.equal(third.complete, true);
  assert.equal(third.nextCheckpoint, null);
  assert.equal(third.transactions[0].date, "2026-10-02");
  assert.equal(second.transactions[0].status, "pending");
  assert.equal(requests.filter(url => url.searchParams.has("start_after"))[0].searchParams.get("start_after"), id(1));
  assert.ok(first.transactions.every(row => isCurrentBankTransactionId("mercury", row.id)));
});

test("Mercury cash and settled operating transactions participate in totals, Analytics and cash reports", async () => {
  const activity = await fetchMercuryActivityBatch({ ...options, fetcher: provider([
    transaction(1), transaction(2, { amount: -25 }),
    transaction(3, { amount: -500, kind: "internalTransfer" }),
    transaction(4, { amount: 900, status: "pending", postedAt: null }),
    transaction(5, { amount: 1000, status: "failed" }),
    transaction(6, { amount: -77240.98, kind: "outgoingPayment", counterpartyName: "Digital nudge OÜ" })
  ]) });
  assert.equal(activity.transactions.length, 6, "creation/posted passes deduplicate exact transaction IDs");
  assert.equal(calculateApproximateUsdTotals(activity.accounts, [], []).accountsUsd, 1281.29);
  const accumulator = createBankAnalyticsAccumulator({ ...options.dateRange, providers: [], teams: [] });
  const enriched = enrichTransactions(activity.transactions, [], [{ id: "company-rule", category: "Software", aliases: ["digital nudge"], createdAt: "2026-10-06", updatedAt: "2026-10-06" }]);
  assert.equal(enriched.find(row => row.counterparty === "Digital nudge OÜ")?.category, "Intercompany transfer");
  accumulator.addPage(enriched.map(row => row.category === "Uncategorized" ? { ...row, category: row.direction === "in" ? "Revenue" : "Software" } : row));
  const analytics = accumulator.finish("2026-10-06T12:00:00Z");
  assert.equal(analytics.bankPeriod.sources.find(row => row.source === "mercury")?.moneyIn.transactionCount, 1);
  assert.equal(analytics.bankPeriod.sources.find(row => row.source === "mercury")?.moneyOut.transactionCount, 1);
  assert.equal(analytics.sources.find(row => row.source === "mercury")?.transactionCount, 2);
  const report = buildTelegramCashReport({ accounts: activity.accounts.map(row => ({ ...row, syncedAt: row.updatedAt })), slashAccounts: [], rates: [], asOf: "2026-10-06T12:00:00Z" });
  assert.match(report, /Mercury ≈ USD 1,281\.29/);
  assert.match(cashReportCopyButton(report)!.text, /Mercury ≈ USD 1,281\.29/);
});

test("Mercury rejects malformed pages, unknown accounts and repeated cursors before claiming complete coverage", async () => {
  await assert.rejects(fetchMercuryActivityBatch({ ...options, fetcher: provider([transaction(1, { amount: "100" })]) }), /invalid transaction amount/);
  await assert.rejects(fetchMercuryActivityBatch({ ...options, fetcher: provider([transaction(1, { accountId: id(999) })]) }), /undiscovered account/);
  await assert.rejects(fetchMercuryActivityBatch({ ...options, fetcher: async input => String(input).includes("/accounts?") ? response({ accounts: [account], page: {} }) : response({ transactions: [transaction(1)], page: { nextPage: id(1) } }) }), /did not advance/);
  await assert.rejects(fetchMercuryActivityBatch({ ...options, fetcher: async () => new Response("secret provider detail", { status: 401 }) }), /^Error: Mercury API request failed \(401\)$/);
});

test("cash account summaries preserve all source balances in the specified order, leaving missing slots empty", () => {
  const names = [...cashFlowCashAccountOrder].reverse();
  const lines: CashFlowLine[] = names.map((name, index) => ({ id: String(index), name, amount: index + 1, currency: "USD" }));
  const original = structuredClone(lines);
  assert.deepEqual(cashFlowCashAccountGroups(lines).map(group => group.name), cashFlowCashAccountOrder);
  assert.deepEqual(lines, original);
  assert.equal(cashFlowCashAccountGroups(lines).reduce((total, group) => total + cashFlowUsdTotal(group.lines, []), 0), cashFlowUsdTotal(lines, []));
  assert.deepEqual(cashFlowCashAccountGroups([], true).map(group => group.lines), names.map(() => []));
  assert.deepEqual(cashFlowCashAccountGroups([]), []);
});

test("Mercury connection identity remains stable across token rotation and separate from other banks", async () => {
  const key = await bankConnectionKey({ MERCURY_CONNECTION_ID: "mojo-labs" }, "mercury");
  assert.match(key!, /^[0-9a-f]{64}$/);
  assert.notEqual(key, await bankConnectionKey({ MERCURY_CONNECTION_ID: "other-company" }, "mercury"));
  assert.equal(await bankConnectionKey({}, "mercury"), null);
});
