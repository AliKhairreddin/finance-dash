import assert from "node:assert/strict";
import test from "node:test";
import { createFromTelegram, update, list } from "../convex/manualBankTransactions";
import { call, database } from "./convexTestDb";

test("Telegram identity deduplicates deliveries, preserves later edits, and retains edit history", async () => {
  const previous = process.env.CONVEX_SERVICE_TOKEN;
  process.env.CONVEX_SERVICE_TOKEN = "test-ledger";
  try {
    const ctx = database({});
    const input = { serviceToken: "test-ledger", source: "kraken", companyName: "Acme", amount: 1250, currency: "USDC", direction: "out", date: "2026-10-13", intakeKey: "telegram:123:99", sentAt: 1791945000, createdBy: "Ali" };
    const first = await call(createFromTelegram, ctx, input);
    assert.equal(first.duplicate, false);
    assert.deepEqual(await call(createFromTelegram, ctx, input), { id: first.id, duplicate: true });
    const edit = { serviceToken: "test-ledger", id: first.id, expectedRevision: 1, companyName: "Edited Company", amount: 55, currency: "EUR", direction: "in", date: "2026-09-01", updatedBy: "Ali M" };
    await call(update, ctx, edit);
    assert.equal(ctx.tables.manualBankTransactions[0].revision, 2);
    assert.equal(ctx.tables.manualBankTransactions[0].amount, 55);
    assert.equal(ctx.tables.manualBankTransactionEdits[0].before.amount, 1250);
    assert.equal(ctx.tables.manualBankTransactionEdits[0].after.currency, "EUR");
    await call(createFromTelegram, ctx, input);
    assert.equal(ctx.tables.manualBankTransactions.length, 1);
    assert.equal(ctx.tables.manualBankTransactions[0].companyName, "Edited Company");
    await assert.rejects(call(update, ctx, edit), /edited by someone else/);
    await assert.rejects(call(update, ctx, { ...edit, expectedRevision: 2, amount: -50 }), /Amount/);
    await assert.rejects(call(createFromTelegram, ctx, { ...input, serviceToken: "wrong" }), /Unauthorized/);
    await assert.rejects(call(createFromTelegram, ctx, { ...input, createdBy: "Amin" }), /Only Ali/);
    await assert.rejects(call(list, ctx, { serviceToken: "wrong" }), /Unauthorized/);
    await call(createFromTelegram, ctx, { ...input, source: "trust", intakeKey: "telegram:123:100", createdBy: "Ali M" });
    assert.equal(ctx.tables.manualBankTransactions.length, 2);
  } finally { if (previous === undefined) delete process.env.CONVEX_SERVICE_TOKEN; else process.env.CONVEX_SERVICE_TOKEN = previous; }
});

test("every manual ledger column uses an indexed global sort with bounded pagination", async () => {
  const previous = process.env.CONVEX_SERVICE_TOKEN;
  process.env.CONVEX_SERVICE_TOKEN = "test-ledger";
  try {
    for (const [sortKey, index] of Object.entries({ date: "by_source_date", companyName: "by_source_company", amount: "by_source_amount", currency: "by_source_currency", direction: "by_source_direction", createdBy: "by_source_creator" })) {
      for (const order of ["asc", "desc"]) {
        const query = { withIndex(name: string, filter: (q: unknown) => unknown) { assert.equal(name, index); filter({ eq(key: string, value: string) { assert.equal(key, "source"); assert.equal(value, "trust"); } }); return query; }, order(value: string) { assert.equal(value, order); return query; }, async paginate(options: { numItems: number; cursor: string }) { assert.equal(options.numItems, 100); assert.equal(options.cursor, "cursor"); return { page: [], continueCursor: "next", isDone: false }; } };
        assert.deepEqual(await call(list, { db: { query() { return query; } } }, { serviceToken: "test-ledger", source: "trust", sortKey, order, paginationOpts: { numItems: 10000, cursor: "cursor" } }), { page: [], continueCursor: "next", isDone: false });
      }
    }
  } finally { if (previous === undefined) delete process.env.CONVEX_SERVICE_TOKEN; else process.env.CONVEX_SERVICE_TOKEN = previous; }
});
