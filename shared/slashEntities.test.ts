import assert from "node:assert/strict";
import test from "node:test";
import { fetchSelectedSlashEntities, fetchSlashEntitiesActivityBatch } from "./slashApi";
import { savedSlashVirtualBalances, slashEntities } from "./slashEntities";
import { createBankAnalyticsAccumulator } from "./analytics";
import type { AccountBalance, Transaction } from "./types";

const now = Date.parse("2026-11-09T12:00:00Z");
const options = { baseUrl: "https://api.slash.test", apiKey: "test", legalEntityId: "mojo", now, dateRange: { fromDate: "2026-11-01", toDate: "2026-11-09" }, accountOwnership: {
  mojo: { groupIds: ["mojo-group"], accountIds: ["mojo-account"] },
  coveragebird: { groupIds: ["coveragebird-group"], accountIds: ["coveragebird-account"] },
  coveragepro: { groupIds: ["coveragepro-group"], accountIds: ["coveragepro-account"] }
} };
function source(requests: string[], unavailable?: string): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    if (!headers.get("user-agent")) return new Response("Forbidden", { status: 403 });
    const entity = headers.get("x-legal-entity");
    if (url.pathname === "/account" || url.pathname === "/transaction") assert.equal(url.searchParams.get("filter:legalEntityId"), entity);
    if (url.pathname === "/virtual-account") assert.equal(url.searchParams.get("filter:accountId"), `${entity}-group`);
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
  await assert.rejects(fetchSelectedSlashEntities({ ...options, fetcher: async () => Response.json({ items: [{ id: "mojo", name: "Mojo Labs LLC" }], metadata: {} }) }), /CoverageBird LLC/);
});

test("combined balance responses are separated by verified entity IDs and unknown identities stop writes", async () => {
  const standard = source([]);
  const balances = slashEntities.map((entity, index) => ({ accountId: `${entity.id}-account`, type: "debit", available: { amountCents: (index + 1) * 10000 }, posted: { amountCents: (index + 1) * 10000 }, timestamp: new Date(now).toISOString() }));
  const fetcher: typeof fetch = (input, init) => new URL(String(input)).pathname.endsWith("/balance")
    ? Promise.resolve(Response.json({ balances })) : standard(input, init);
  const result = await fetchSlashEntitiesActivityBatch({ ...options, fetcher });
  assert.deepEqual(result.accounts.map(account => [account.slashEntity, account.balance]), [["mojo", 100], ["coveragebird", 200], ["coveragepro", 300]]);
  let writes = 0;
  const unknown: typeof fetch = (input, init) => new URL(String(input)).pathname.endsWith("/balance")
    ? Promise.resolve(Response.json({ balances: [...balances, { ...balances[0], accountId: "unverified" }] })) : standard(input, init);
  await assert.rejects(fetchSlashEntitiesActivityBatch({ ...options, fetcher: unknown, onAccountsDiscovered: () => { writes++; }, onTransactionPage: () => { writes++; } }), /unverified account identity/);
  assert.equal(writes, 0);
});

test("Slash groups preserve multiple underlying cash, debit, and credit accounts", async () => {
  const standard = source([]);
  const rows = [
    { accountId: "mojo-account", type: "debit" },
    { accountId: "mojo-debit-2", type: "debit" },
    { accountId: "mojo-cash-1", type: "cash" },
    { accountId: "mojo-cash-2", type: "cash" },
    { accountId: "mojo-credit-1", type: "credit" },
    { accountId: "mojo-credit-2", type: "credit" }
  ].map((row, index) => ({ ...row, available: { amountCents: (index + 1) * 100 }, posted: { amountCents: (index + 1) * 100 }, timestamp: new Date(now).toISOString() }));
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/account" && new Headers(init?.headers).get("x-legal-entity") === "mojo") return Response.json({ items: [{ id: "mojo-group", name: "Operating", status: "open", type: "debit", balances: ["cash", "credit", "debit"] }], metadata: {} });
    if (url.pathname === "/account/mojo-group/balance") return Response.json({ balances: rows });
    if (url.pathname === "/transaction" && new Headers(init?.headers).get("x-legal-entity") === "mojo") return Response.json({
      items: rows.map((row, index) => ({ id: `tx-${index}`, accountId: row.accountId, accountSubtype: row.type === "credit" ? "credit" : "cash", date: "2026-11-08T12:00:00Z", description: "Receipt", amountCents: 100, status: "posted" })), metadata: {}
    });
    return standard(input, init);
  };
  const multiOptions = { ...options, accountOwnership: { ...options.accountOwnership, mojo: { groupIds: ["mojo-group"], accountIds: rows.map(row => row.accountId) } } };
  const result = await fetchSlashEntitiesActivityBatch({ ...multiOptions, fetcher });
  const mojoAccounts = result.accounts.filter(account => account.slashEntity === "mojo");
  assert.equal(mojoAccounts.length, 6);
  assert.equal(mojoAccounts.reduce((sum, account) => sum + account.balance, 0), 21);
  assert.deepEqual(new Set(result.transactions.filter(tx => tx.slashEntity === "mojo").map(tx => tx.accountId)), new Set(mojoAccounts.map(account => account.id)));
  let writes = 0;
  const duplicate: typeof fetch = (input, init) => new URL(String(input)).pathname === "/account/mojo-group/balance"
    ? Promise.resolve(Response.json({ balances: [...rows, rows[0]] })) : fetcher(input, init);
  await assert.rejects(fetchSlashEntitiesActivityBatch({ ...multiOptions, fetcher: duplicate, onAccountsDiscovered: () => { writes++; } }), /duplicate account balance identities/);
  assert.equal(writes, 0);
  const ambiguous: typeof fetch = (input, init) => new URL(String(input)).pathname === "/transaction"
    ? Promise.resolve(Response.json({ items: [{ id: "ambiguous", accountId: "mojo-group", accountSubtype: "cash", date: "2026-11-08T12:00:00Z", description: "Receipt", amountCents: 100, status: "posted" }], metadata: {} })) : fetcher(input, init);
  await assert.rejects(fetchSlashEntitiesActivityBatch({ ...multiOptions, fetcher: ambiguous, onTransactionPage: () => { writes++; } }), /unknown account mojo-group/);
  assert.equal(writes, 0);
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
