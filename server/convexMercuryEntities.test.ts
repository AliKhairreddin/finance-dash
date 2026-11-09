import assert from "node:assert/strict";
import test from "node:test";
import { assignMercuryEntities } from "../convex/banking";
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
