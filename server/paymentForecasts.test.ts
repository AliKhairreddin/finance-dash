import assert from "node:assert/strict";
import test from "node:test";
import { ConvexError } from "convex/values";
import { get } from "../convex/paymentForecasts";
import { call } from "./convexTestDb";
import { financeOperatingDate } from "../shared/operatingDate";
import { bankProviderTransactionId } from "../shared/providerIdentity";
import { bankSources } from "../shared/banks";

const auth = { serviceToken: "payment-forecast-test" };
function setup(isDone = true, sources = ["slash"]) {
  process.env.CONVEX_SERVICE_TOKEN = auth.serviceToken;
  const transaction = { id: bankProviderTransactionId("slash", ["account", "receipt"]), source: "slash", connectionKey: "active", identityVersion: 2, date: financeOperatingDate(), direction: "in", status: "posted", amount: 100, currency: "USD", category: "Media buying direct", counterparty: "MediaAlpha", merchantName: "QuoteLab" };
  const reads: { table: string; index?: string; bounds?: unknown[]; limit?: number }[] = [];
  const db = { query(table: string) {
    const read: typeof reads[number] = { table }; reads.push(read);
    const range = { eq: (...args: unknown[]) => { read.bounds = [...read.bounds ?? [], args]; return range; }, gte: (...args: unknown[]) => { read.bounds = [...read.bounds ?? [], args]; return range; }, lt: (...args: unknown[]) => { read.bounds = [...read.bounds ?? [], args]; return range; } };
    const query = {
      withIndex(index: string, fn: (value: typeof range) => unknown) { read.index = index; fn(range); return query; },
      async unique() { return { providers: [], invoices: [], paymentAllocations: [] }; },
      async take(limit: number) { read.limit = limit; return sources.map(source => ({ source, connectionKey: "active" })).slice(0, limit); },
      async paginate(options: { numItems: number; maximumRowsRead: number; maximumBytesRead: number }) {
        assert.equal(options.numItems, 3000); assert.equal(options.maximumRowsRead, 3000); assert.ok(options.maximumBytesRead <= 6 * 1024 * 1024);
        return { isDone, continueCursor: "cursor", page: [transaction, { ...transaction, id: bankProviderTransactionId("slash", ["account", "old-connection"]), connectionKey: "retired" }, { ...transaction, id: bankProviderTransactionId("slash", ["account", "old-identity"]), identityVersion: 1 }] };
      }
    }; return query;
  } };
  return { db, reads };
}

test("payment history reads the indexed saved ledger, restricts active connections and current identities", async () => {
  const ctx = setup();
  const report = await call(get, ctx, auth);
  assert.equal(report.complete, true);
  assert.equal(report.clients.length, 1);
  assert.equal(report.clients[0].received, 100);
  assert.equal(report.clients[0].receiptCount, 1);
  assert.deepEqual(ctx.reads.map(read => read.table).sort(), ["bankConnectionBindings", "bankTransactions", "dashboardState"]);
  const bank = ctx.reads.find(read => read.table === "bankTransactions")!;
  assert.equal(bank.index, "by_direction_date_id");
  assert.equal(bank.bounds?.length, 3);
});

test("bounded incomplete history is exposed without misleading partial totals", async () => {
  const report = await call(get, setup(false), auth);
  assert.equal(report.complete, false);
  assert.deepEqual(report.clients, []);
});

test("payment forecasts accept all six bank connections and still reject an excess binding", async () => {
  const sources = bankSources.map(source => source.id);
  const report = await call(get, setup(true, sources), auth);
  assert.equal(report.clients[0].received, 100);
  await assert.rejects(call(get, setup(true, [...sources, "unexpected"]), auth), /BANK_CONNECTION_BINDING_LIMIT_EXCEEDED/);
});

test("payment history requires the service credential before accessing financial data", async () => {
  const ctx = setup();
  await assert.rejects(call(get, ctx, { serviceToken: "wrong" }), error => error instanceof ConvexError);
  assert.deepEqual(ctx.reads, []);
});
