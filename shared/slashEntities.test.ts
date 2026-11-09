import assert from "node:assert/strict";
import test from "node:test";
import { fetchSelectedSlashEntities, fetchSlashEntitiesActivityBatch } from "./slashApi";
import { savedSlashVirtualBalances, slashEntities } from "./slashEntities";
import { createBankAnalyticsAccumulator } from "./analytics";
import type { AccountBalance, Transaction } from "./types";

const now = Date.parse("2026-11-09T12:00:00Z");
const options = { baseUrl: "https://api.slash.test", apiKey: "test", legalEntityId: "mojo", now, dateRange: { fromDate: "2026-11-01", toDate: "2026-11-09" } };
function source(requests: string[], unavailable?: string): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    const entity = new Headers(init?.headers).get("x-legal-entity");
    requests.push(`${entity}:${url.pathname}:${url.searchParams.get("cursor") ?? ""}`);
    if (url.pathname === "/legal-entity") return Response.json({ items: slashEntities.map(e => ({ id: e.id, name: e.legalName })), metadata: {} });
    if (entity === unavailable) return Response.json({ message: "Forbidden" }, { status: 403 });
    if (url.pathname === "/account") return Response.json({ items: [{ id: `${entity}-group`, name: "Operating", status: "open", type: "debit", balances: ["debit"] }], metadata: {} });
    if (url.pathname === "/virtual-account") return Response.json({ items: [{ virtualAccount: { id: `${entity}-virtual`, accountId: `${entity}-group`, name: "Primary", accountType: "primary" }, balance: { amountCents: 10000 }, spend: { amountCents: 0 } }], metadata: {} });
    if (url.pathname.endsWith("/balance")) return Response.json({ balances: [{ accountId: `${entity}-account`, type: "debit", available: { amountCents: 10000 }, posted: { amountCents: 10000 }, timestamp: new Date(now).toISOString() }] });
    if (url.pathname === "/transaction") return Response.json({ items: [{ id: "same-provider-id", accountId: `${entity}-account`, accountSubtype: "cash", date: "2026-11-08T12:00:00Z", description: "Receipt", amountCents: 1000, status: "posted" }], metadata: {} });
    throw new Error(`Unexpected URL ${url}`);
  };
}

test("one key reads all selected entities with bounded pagination, stable IDs, and a complete account set", async () => {
  const requests: string[] = [];
  const fetcher = source(requests);
  const first = await fetchSlashEntitiesActivityBatch({ ...options, fetcher, pageBudget: 1 });
  assert.equal(first.complete, false);
  assert.equal(first.pagesFetched, 1);
  assert.equal(first.accounts.length, 3);
  assert.deepEqual(first.accounts.map(a => a.slashEntity), ["mojo", "coveragebird", "coveragepro"]);
  assert.equal(first.accounts[0].slashVirtualAccounts?.[0].balance, 100);
  const second = await fetchSlashEntitiesActivityBatch({ ...options, dateRange: undefined, checkpoint: first.nextCheckpoint!, fetcher, pageBudget: 1 });
  assert.equal(second.transactions[0].slashEntity, "coveragebird");
  assert.equal(second.transactions[0].providerLegacyId, undefined);
  const third = await fetchSlashEntitiesActivityBatch({ ...options, dateRange: undefined, checkpoint: second.nextCheckpoint!, fetcher, pageBudget: 1 });
  assert.equal(third.complete, true);
  assert.equal(third.nextCheckpoint, null);
  assert.equal(new Set([...first.transactions, ...second.transactions, ...third.transactions].map(tx => tx.id)).size, 3);
  assert.deepEqual(requests.filter(r => r.includes(":/transaction:")), ["mojo:/transaction:", "coveragebird:/transaction:", "coveragepro:/transaction:"]);
});

test("failed entity validation writes no transactions or replacement accounts", async () => {
  let writes = 0;
  await assert.rejects(fetchSlashEntitiesActivityBatch({ ...options, fetcher: source([], "coveragebird"), onAccountsDiscovered: () => { writes++; }, onTransactionPage: () => { writes++; } }), /403/);
  assert.equal(writes, 0);
  await assert.rejects(fetchSelectedSlashEntities({ ...options, legalEntityId: "wrong", fetcher: source([]) }), /existing connection/);
  await assert.rejects(fetchSelectedSlashEntities({ ...options, fetcher: async () => Response.json({ items: [{ id: "mojo", name: "Mojo Labs LLC" }], metadata: {} }) }), /COVERAGEBIRD LLC/);
});

test("saved balances deduplicate parent cash and credit and reject missing or stale entities", async () => {
  const { accounts } = await fetchSlashEntitiesActivityBatch({ ...options, fetcher: source([]) });
  const duplicated: AccountBalance[] = [...accounts, { ...accounts[0], id: "credit", slashAccountSubtype: "credit" }];
  assert.equal(savedSlashVirtualBalances(duplicated, now).reduce((sum, a) => sum + a.balance, 0), 300);
  assert.throws(() => savedSlashVirtualBalances(accounts.slice(1), now), /Mojo Labs/);
  assert.throws(() => savedSlashVirtualBalances(accounts, now + 31 * 60000), /stale/);
});

test("Slash entity activity and cashback survive analytics checkpoint serialization independently", () => {
  const config = { fromDate: "2026-11-01", toDate: "2026-11-09", providers: [], teams: [] };
  const accumulator = createBankAnalyticsAccumulator(config);
  const tx = (entity: Transaction["slashEntity"], amount: number): Transaction => ({ id: entity!, source: "slash", slashEntity: entity, accountName: "Operating", date: "2026-11-08", description: "Purchase", rawName: "Merchant", counterparty: "Merchant", direction: "out", status: "posted", amount, currency: "USD", category: "Advertising", cashback: { amount: amount / 100, rate: 1 } });
  accumulator.addPage([tx("mojo", 100)]);
  const resumed = createBankAnalyticsAccumulator({ ...config, state: accumulator.serialize() });
  resumed.addPage([tx("coveragebird", 200), tx("coveragepro", 300)]);
  const period = resumed.finish().bankPeriod;
  assert.equal(period.sources[0].moneyOut.volume.USD, 600);
  assert.equal(period.slashEntities.find(e => e.slashEntity === "coveragebird")?.moneyOut.volume.USD, 200);
  assert.equal(period.slashEntities.find(e => e.slashEntity === "coveragepro")?.cashback.earned.USD, 3);
});
