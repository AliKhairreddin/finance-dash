import assert from "node:assert/strict";
import test from "node:test";
import { assignMercuryEntities, repairEntityAccountNames } from "../convex/banking";
import { call, database } from "./convexTestDb";

test("Mercury metadata migration preserves IDs, values, matches, and ownership and resumes in bounded batches", async () => {
  const previous = process.env.CONVEX_SERVICE_TOKEN;
  process.env.CONVEX_SERVICE_TOKEN = "test";
  try {
    const key = "a".repeat(64);
    const rows = Array.from({ length: 201 }, (_, i) => ({ _id: `row-${i}`, id: `transaction-${i}`, source: "mercury", accountId: "cash-account", accountName: "Operating", connectionKey: key, date: "2026-09-01", amount: 25, teamId: "team", matchedInvoiceId: "invoice", category: "Advertising" }));
    const db = database({ bankConnectionBindings: [{ _id: "binding", source: "mercury", connectionKey: key }], bankTransactions: rows });
    const args = { serviceToken: "test", connectionKey: key, accounts: [{ id: "cash-account", entity: "mojo" }] };
    assert.deepEqual(await call(assignMercuryEntities, db, args), { updated: 200, done: false });
    assert.deepEqual(await call(assignMercuryEntities, db, args), { updated: 1, done: true });
    assert.deepEqual(db.tables.bankTransactions, rows.map(row => ({ ...row, mercuryEntity: "mojo", accountName: "Mojo Labs LLC · Operating" })));
    assert.deepEqual(await call(assignMercuryEntities, db, args), { updated: 0, done: true });
    const unknown = database({ bankConnectionBindings: [{ _id: "binding", source: "mercury", connectionKey: key }], bankTransactions: [{ ...rows[0], accountId: "unknown" }] });
    await assert.rejects(call(assignMercuryEntities, unknown, args), /verified entity/);
    assert.equal(unknown.tables.bankTransactions[0].mercuryEntity, undefined);
  } finally { if (previous === undefined) delete process.env.CONVEX_SERVICE_TOKEN; else process.env.CONVEX_SERVICE_TOKEN = previous; }
});

test("legal-name repair paginates both banks and preserves every field except the incorrect name", async () => {
  const previous = process.env.CONVEX_SERVICE_TOKEN;
  process.env.CONVEX_SERVICE_TOKEN = "test";
  try {
    for (const source of ["mercury", "slash"] as const) for (const entity of ["coveragebird", "coveragepro"] as const) {
      const key = "a".repeat(64);
      const field = source === "mercury" ? "mercuryEntity" : "slashEntity";
      const original = entity === "coveragebird" ? "CoverageBird" : "CoverageBird Pro";
      const legalName = entity === "coveragebird" ? "CoverageBird LLC" : "CoveragePro LLC";
      const rows = Array.from({ length: 201 }, (_, i) => ({ _id: `row-${i}`, id: `transaction-${i}`, source, [field]: entity, accountId: "cash-account", accountName: `${original} · Operating`, connectionKey: key, date: "2026-11-01", amount: 25, teamId: "team", matchedInvoiceId: "invoice", category: "Advertising" }));
      const account = { _id: "account", id: "cash-account", source, [field]: entity, name: `${original} · Operating`, connectionKey: key, balance: 123.45, syncedAt: "2026-11-09T12:00:00Z" };
      const unrelated = { ...rows[0], _id: "unrelated", id: "unrelated", [field]: "mojo", accountName: "Mojo Labs LLC · Operating" };
      const ctx = database({ bankConnectionBindings: [{ _id: "binding", source, connectionKey: key }], bankTransactions: [...rows, unrelated], bankAccounts: [account] });
      const query = ctx.db.query;
      ctx.db.query = table => {
        const result = query(table);
        return Object.assign(result, { async paginate(options: { numItems: number; cursor: string | null }) {
          const offset = Number(options.cursor ?? 0);
          const available = await result.take(offset + options.numItems + 1);
          return { page: available.slice(offset, offset + options.numItems), isDone: available.length <= offset + options.numItems, continueCursor: String(offset + options.numItems) };
        } });
      };
      const args = { serviceToken: "test", source, entity, connectionKey: key, paginationOpts: { numItems: 200, cursor: null } };
      await assert.rejects(call(repairEntityAccountNames, ctx, { ...args, serviceToken: "wrong" }), /UNAUTHORIZED/);
      await assert.rejects(call(repairEntityAccountNames, ctx, { ...args, connectionKey: "b".repeat(64) }), /CONNECTION/);
      assert.deepEqual(await call(repairEntityAccountNames, ctx, args), { accountsUpdated: 1, transactionsUpdated: 200, isDone: false, continueCursor: "200" });
      assert.deepEqual(await call(repairEntityAccountNames, ctx, { ...args, paginationOpts: { numItems: 200, cursor: "200" } }), { accountsUpdated: 0, transactionsUpdated: 1, isDone: true, continueCursor: "400" });
      assert.deepEqual(ctx.tables.bankTransactions, [...rows.map(row => ({ ...row, accountName: `${legalName} · Operating` })), unrelated]);
      assert.deepEqual(ctx.tables.bankAccounts, [{ ...account, name: `${legalName} · Operating` }]);
      assert.deepEqual(await call(repairEntityAccountNames, ctx, args), { accountsUpdated: 0, transactionsUpdated: 0, isDone: false, continueCursor: "200" });
    }
  } finally { if (previous === undefined) delete process.env.CONVEX_SERVICE_TOKEN; else process.env.CONVEX_SERVICE_TOKEN = previous; }
});
