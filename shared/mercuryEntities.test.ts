import assert from "node:assert/strict";
import test from "node:test";
import { fetchMercuryEntitiesActivityBatch } from "./mercuryApi";
import { assertSavedMercuryBalances, mercuryConnections, mercuryEntities } from "./mercuryEntities";
import { createBankAnalyticsAccumulator } from "./analytics";
import { buildTelegramCashReport, cashReportCopyButton } from "../worker/telegramCashReport";
import type { Transaction } from "./types";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const connections = mercuryEntities.map(entity => ({ entity: entity.id, apiToken: `token-${entity.id}` }));
const options = { connections, dateRange: { fromDate: "2026-10-01", toDate: "2026-11-09" }, now: Date.parse("2026-11-09T12:00:00Z") };
function provider(onRequest?: (entity: string, url: URL) => void): typeof fetch {
  return async (input, init) => {
    const token = new Headers(init?.headers).get("Authorization");
    const index = connections.findIndex(connection => `Bearer ${connection.apiToken}` === token);
    assert.notEqual(index, -1);
    const entity = mercuryEntities[index];
    const url = new URL(String(input));
    onRequest?.(entity.id, url);
    return Response.json(url.pathname.endsWith("accounts") ? { accounts: [{ id: uuid(index + 1), name: "Checking", legalBusinessName: entity.legalName, type: "mercury", kind: "checking", currentBalance: index * 100, createdAt: "2026-10-01T00:00:00Z" }], page: {} }
      : { transactions: [{ id: uuid(10), accountId: uuid(index + 1), amount: index + 10, status: "sent", kind: "other", counterpartyName: "Client", createdAt: "2026-11-01T00:00:00Z", postedAt: "2026-11-01T00:00:00Z" }], page: {} });
  };
}

test("Mercury traverses all three businesses with one shared page budget, stable IDs and resumable coverage", async () => {
  const transactions = new Map<string, Transaction>();
  const phases: string[] = [];
  const fetcher = provider((entity, url) => { if (url.pathname.endsWith("transactions")) phases.push(`${entity}:${url.searchParams.has("postedStart")}`); });
  let checkpoint: string | undefined;
  for (let batch = 0; batch < 3; batch++) {
    const result = await fetchMercuryEntitiesActivityBatch({ ...options, fetcher, pageBudget: 2, checkpoint,
      onAccountsDiscovered(accounts) { assert.equal(accounts.length, 3); assert.deepEqual(accounts.map(account => account.mercuryEntity), ["mojo", "coveragebird", "coveragepro"]); }
    });
    assert.equal(result.pagesFetched, 2);
    assert.equal(result.complete, batch === 2);
    assert.deepEqual(result.dateRange, options.dateRange);
    for (const transaction of result.transactions) transactions.set(transaction.id, transaction);
    checkpoint = result.nextCheckpoint ?? undefined;
  }
  assert.deepEqual(phases, ["mojo:false", "mojo:true", "coveragebird:false", "coveragebird:true", "coveragepro:false", "coveragepro:true"]);
  assert.equal(transactions.size, 3, "same provider transaction UUID in distinct accounts is not conflated");
  assert.deepEqual([...transactions.values()].map(row => row.mercuryEntity), ["mojo", "coveragebird", "coveragepro"]);
  assert.equal([...transactions.values()][0].accountId, `mercury-${uuid(1)}`);
});

test("failed or mismatched business access cannot publish a partial account snapshot", async () => {
  let writes = 0;
  const good = provider();
  for (const mode of ["failed", "wrong-owner", "duplicate", "unknown-owner"]) {
    await assert.rejects(fetchMercuryEntitiesActivityBatch({ ...options, fetcher: async (input, init) => {
      const response = await good(input, init);
      if (!String(input).includes("/accounts?") || !new Headers(init?.headers).get("Authorization")?.includes("coveragepro")) return response;
      if (mode === "failed") return new Response("private details", { status: 401 });
      const data = await response.json();
      if (mode === "duplicate") data.accounts[0].id = uuid(1);
      else data.accounts[0].legalBusinessName = mode === "wrong-owner" ? "Mojo Labs LLC" : "Unknown LLC";
      return Response.json(data);
    }, onAccountsDiscovered() { writes++; }, onTransactionPage() { writes++; } }), /failed \(401\)|configured business|overlap|unrecognized/);
  }
  assert.equal(writes, 0);
  assert.throws(() => mercuryConnections({ MERCURY_API_TOKEN: "existing" }), /MERCURY_COVERAGEBIRD_API_TOKEN/);
});

test("entity analytics survive checkpoint restoration and Telegram totals include each business once", async () => {
  const result = await fetchMercuryEntitiesActivityBatch({ ...options, fetcher: provider(), pageBudget: 10 });
  assert.equal(result.complete, true);
  const analyticsOptions = { ...options.dateRange, providers: [], teams: [] };
  const accumulator = createBankAnalyticsAccumulator(analyticsOptions);
  accumulator.addPage(result.transactions.map(row => ({ ...row, category: "Revenue" })));
  const restored = createBankAnalyticsAccumulator({ ...analyticsOptions, state: accumulator.serialize() });
  const metrics = restored.finish("2026-11-09T12:00:00Z").bankPeriod;
  assert.equal(metrics.mercuryEntities.length, 3);
  assert.deepEqual(metrics.mercuryEntities.map(row => row.moneyIn.volume.USD).sort(), [10, 11, 12]);
  const report = buildTelegramCashReport({ accounts: result.accounts.map(row => ({ ...row, syncedAt: row.updatedAt })), slashAccounts: [], rates: [], asOf: "2026-11-09T12:00:00Z" });
  assert.match(report, /Bank total ≈ USD 300\.00/);
  assert.match(report, /Mercury · Mojo Labs LLC ≈ USD 0\.00/);
  assert.match(report, /Mercury · CoverageBird LLC ≈ USD 100\.00/);
  assert.match(report, /Mercury · CoveragePro LLC ≈ USD 200\.00/);
  assert.equal(cashReportCopyButton(report)?.text, "Mercury ≈ USD 300.00");
  const saved = result.accounts.map(row => ({ ...row, syncedAt: row.updatedAt }));
  assert.doesNotThrow(() => assertSavedMercuryBalances(saved, options.now));
  assert.throws(() => assertSavedMercuryBalances(saved.slice(1), options.now), /Mojo Labs LLC.*not synced/);
  assert.throws(() => assertSavedMercuryBalances(saved, options.now + 31 * 60_000), /stale/);
  assert.throws(() => assertSavedMercuryBalances(saved.map(row => ({ ...row, mercuryEntity: undefined })), options.now), /ownership/);
});
