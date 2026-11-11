import assert from "node:assert/strict";
import test from "node:test";
import { fetchFlexAccounts, fetchFlexActivityBatch, flexApiVersion, FlexRateLimitError, normalizeFlexTransaction } from "./flexApi";
import { flexBalanceObservations, flexCardObservations } from "./flexAlerts";
import { calculateApproximateUsdTotals } from "./income";
import { bankConnectionKey } from "./bankConnectionIdentity";
import { accountBalanceGroups } from "./accountBalanceGroups";

const org = "00000000-0000-4000-8000-000000000001";
const cash = "00000000-0000-4000-8000-000000000002";
const credit = "00000000-0000-4000-8000-000000000003";
const txId = "00000000-0000-4000-8000-000000000004";
const card = "00000000-0000-4000-8000-000000000005";
const now = Date.parse("2026-11-11T16:00:00Z");
const at = new Date(now).toISOString();
const amount = (value: number, currency = "USD") => ({ amount: value, scale: 2, currency });
const entry = (value: number) => ({ amount: amount(value), asOf: at });
function account(id = cash, type = "banking") {
  return { id, organizationId: org, type, status: "active", name: type, currency: "USD", createdAt: "2026-01-01T00:00:00Z", lastModifiedAt: at,
    balances: { available: entry(1500000), ...(type === "rewardCard" ? { owed: entry(25000) } : {}) } };
}
const side = (id: string, type = "banking") => ({ id, organizationId: org, type });
function transaction() {
  return { id: txId, organizationId: org, type: "card-purchase", status: "settled", direction: "out", date: at,
    amount: amount(12345), sourceAmount: amount(12345), destinationAmount: amount(12345), sourceFinancialAccount: side(cash),
    destination: { name: "Example Merchant" }, attributes: { cardId: card, cardLastFour: "1234", personName: "Example Holder" },
    createdAt: at, lastModifiedAt: at };
}
function response(data: unknown[], sortBy = "createdAt", nextToken?: string) {
  return { data, metadata: { pageSize: 100, sort: "asc", sortBy, hasMore: Boolean(nextToken), ...(nextToken ? { nextToken } : {}) } };
}
function options(payloads: unknown[], urls: URL[] = []) {
  return { apiKey: "test-secret", organizationId: org, now, wait: async () => {}, fetcher: (async (input, init) => {
    urls.push(new URL(String(input)));
    assert.equal(init?.headers && new Headers(init.headers).get("flex-version"), flexApiVersion);
    assert.equal(init?.redirect, "manual");
    assert.equal(init?.method ?? "GET", "GET");
    assert(payloads.length, "unexpected provider request");
    const value = payloads.shift();
    return value instanceof Response ? value : new Response(JSON.stringify(value), { headers: { "flex-version": flexApiVersion } });
  }) as typeof fetch };
}
test("Flex uses native currency scale, preserves balance timestamps, and excludes available credit from cash", async () => {
  const result = await fetchFlexAccounts(options([response([account(), account(credit, "rewardCard")])]));
  assert.equal(result.accounts[0].balance, 15000);
  assert.equal(result.accounts[1].balance, -250);
  assert.equal(result.accounts[1].flex?.available, 15000);
  assert.equal(result.accounts[0].updatedAt, at);
  assert.equal(calculateApproximateUsdTotals(result.accounts, [], []).totalUsd, 15000);
  assert.deepEqual(accountBalanceGroups(result.accounts, []).map(g => g.id), ["flex", "flex-credit"]);
});
test("Flex follows account cursors and rejects empty, partial, foreign, duplicate or unavailable account snapshots", async () => {
  const urls: URL[] = [];
  const result = await fetchFlexAccounts(options([response([account()], "createdAt", "cursor-2"), response([account(credit, "rewardCard")])], urls));
  assert.equal(result.accounts.length, 2); assert.equal(urls[1].searchParams.get("nextToken"), "cursor-2");
  for (const rows of [[], [account(), account()], [{ ...account(), organizationId: credit }], [{ ...account(), balances: { available: { unavailable: { reason: "derivation_failed", retryable: true } } } }]]) {
    await assert.rejects(fetchFlexAccounts(options([response(rows)])), /Flex/);
  }
  await assert.rejects(fetchFlexAccounts(options([{ data: [account()], metadata: { hasMore: true } }])), /pagination/);
});
test("Flex rejects invalid scales, missing currency, unsafe integers and unconfirmed API versions", async () => {
  for (const invalid of [{ amount: Number.MAX_SAFE_INTEGER + 1, scale: 2, currency: "USD" }, { amount: 1, scale: -1, currency: "USD" }, { amount: 1, scale: 2, currency: "EUR" }]) {
    await assert.rejects(fetchFlexAccounts(options([response([{ ...account(), balances: { available: { amount: invalid, asOf: at } } }])])), /money/);
  }
  await assert.rejects(fetchFlexAccounts(options([new Response(JSON.stringify(response([account()])))])), /version/);
});
test("Flex 429 honors the full Retry-After and performs no inline retries", async () => {
  const urls: URL[] = []; const start = Date.now();
  await assert.rejects(fetchFlexAccounts(options([new Response("", { status: 429, headers: { "Retry-After": "7200" } })], urls)), error => error instanceof FlexRateLimitError && error.retryAt >= start + 7200_000);
  assert.equal(urls.length, 1);
});
test("Flex transactions distinguish purchases, refunds, pending and declined attempts", async () => {
  const discovered = await fetchFlexAccounts(options([response([account()])]));
  const map = new Map(discovered.accounts.map(a => [a.id, a]));
  const normal = normalizeFlexTransaction(transaction(), map, org)[0];
  assert.equal(normal.amount, 123.45); assert.equal(normal.direction, "out"); assert.equal(normal.status, "posted");
  assert.equal(normal.cardHolderName, "Example Holder"); assert.equal(normal.flex?.modifiedAt, at);
  const refund = normalizeFlexTransaction({ ...transaction(), status: "refund-cleared" }, map, org)[0];
  assert.equal(refund.direction, "in"); assert.equal(refund.status, "posted"); assert.equal(refund.id, normal.id);
  const declined = normalizeFlexTransaction({ ...transaction(), status: "declined" }, map, org)[0];
  assert.equal(declined.status, "voided");
  assert.equal(normalizeFlexTransaction({ ...transaction(), status: "authorized" }, map, org)[0].status, "pending");
  assert.throws(() => normalizeFlexTransaction({ ...transaction(), status: "invented" }, map, org), /status/);
  assert.throws(() => normalizeFlexTransaction({ ...transaction(), organizationId: cash }, map, org), /organization/);
});
test("Flex internal transfers have separate stable legs and do not become operational expense", async () => {
  const discovered = await fetchFlexAccounts(options([response([account(), account(credit, "rewardCard")])]));
  const map = new Map(discovered.accounts.map(a => [a.id, a]));
  const rows = normalizeFlexTransaction({ ...transaction(), type: "repayment", direction: "internal", destinationFinancialAccount: side(credit, "rewardCard") }, map, org);
  assert.equal(rows.length, 2); assert.notEqual(rows[0].id, rows[1].id);
  assert.deepEqual(rows.map(r => r.direction), ["out", "in"]);
  assert(rows.every(row => row.category === "Internal transfer"));
});
test("Flex collateral-to-loan card activity is one expense and never invents a cash balance", async () => {
  const discovered = await fetchFlexAccounts(options([response([account()])]));
  const directory = new Map(discovered.accounts.map(a => [a.id, a]));
  const rows = normalizeFlexTransaction({ ...transaction(), direction: "internal", sourceFinancialAccount: { ...side(credit, "other"), nickname: "Collateral" }, destinationFinancialAccount: { ...side(txId, "other"), nickname: "Loan" } }, directory, org);
  assert.equal(rows.length, 1); assert.equal(rows[0].direction, "out"); assert.equal(rows[0].category, "Flex");
  assert.equal(rows[0].accountId, `flex-${credit}`); assert.match(rows[0].accountName!, /Collateral/);
  assert.equal(directory.size, 1);
});
test("Flex rejects out-of-range data before saving a page or claiming coverage", async () => {
  let saved = false;
  await assert.rejects(fetchFlexActivityBatch({ ...options([response([account()]), response([transaction()], "date")]),
    dateRange: { fromDate: "2026-11-01", toDate: "2026-11-02" }, onTransactionPage: async () => { saved = true; } }), /outside/);
  assert.equal(saved, false);
});
test("Flex checkpoints freeze query parameters and resume without losing pages", async () => {
  const first = await fetchFlexActivityBatch({ ...options([response([account()]), response([transaction()], "date", "cursor-2")]), pageBudget: 1 });
  assert.equal(first.complete, false); assert(first.nextCheckpoint);
  const urls: URL[] = [];
  const second = await fetchFlexActivityBatch({ ...options([response([account()]), response([], "date")], urls), checkpoint: first.nextCheckpoint, now: now + 86400_000 });
  assert.equal(second.complete, true); assert.equal(second.nextCheckpoint, null);
  assert.equal(second.modifiedThrough, at); assert.equal(second.dateRange.fromDate, "2026-01-01");
  assert.equal(urls[1].searchParams.get("nextToken"), "cursor-2");
  assert.equal(urls[1].searchParams.get("dateBefore"), "2026-11-11T23:59:59.999Z");
});
test("Flex picks up old corrections via lastModifiedAt without claiming new historical coverage", async () => {
  const urls: URL[] = [];
  const result = await fetchFlexActivityBatch({ ...options([response([account()]), response([], "date"), response([{ ...transaction(), date: "2026-02-02T00:00:00Z" }], "lastModifiedAt")], urls),
    dateRange: { fromDate: "2026-11-10", toDate: "2026-11-11" }, modifiedAfter: "2026-11-11T15:00:00Z" });
  assert.equal(result.transactions[0].date, "2026-02-02");
  assert.equal(urls[2].searchParams.get("lastModifiedAfter"), "2026-11-11T15:00:00Z");
  assert.equal(urls[2].searchParams.get("dateAfter"), null);
  assert.equal(result.dateRange.fromDate, "2026-11-10");
});
test("Flex connection identity survives key rotation and isolates organizations", async () => {
  assert.notEqual(await bankConnectionKey({ FLEX_ORGANIZATION_ID: org }, "flex"), await bankConnectionKey({ FLEX_ORGANIZATION_ID: cash }, "flex"));
  assert.equal(await bankConnectionKey({}, "flex"), null);
});
test("Flex alerts exclude old history, refunds, and stale balances and label credit honestly", async () => {
  const discovered = await fetchFlexAccounts(options([response([account(), account(credit, "rewardCard")])]));
  const tx = normalizeFlexTransaction({ ...transaction(), status: "declined" }, new Map(discovered.accounts.map(a => [a.id, a])), org)[0];
  assert.equal(flexCardObservations([tx], "2026-11-11T16:01:00Z", ["Ali"], now).length, 0);
  assert.equal(flexCardObservations([tx], "2026-11-11T15:00:00Z", ["Ali"], now)[0].active, true);
  assert.equal(flexCardObservations([{ ...tx, direction: "in" }], "2026-11-11T15:00:00Z", ["Ali"], now).length, 0);
  assert.equal(flexBalanceObservations(discovered.accounts, 10000, ["Ali"], now + 3600_000).length, 0);
  assert.match(flexBalanceObservations(discovered.accounts, 20000, ["Ali"], now)[1].message, /Available credit/);
});
