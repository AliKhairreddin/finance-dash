import assert from "node:assert/strict";
import test from "node:test";
import { createFromTelegram, createFromDashboard, update, remove, list } from "../convex/manualBankTransactions";
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
        const filters: Array<[string, unknown]> = [];
        const indexQuery = { eq(key: string, value: unknown) { filters.push([key, value]); return indexQuery; } };
        const query = { withIndex(name: string, filter: (q: unknown) => unknown) { assert.equal(name, index); filter(indexQuery); return query; }, order(value: string) { assert.equal(value, order); return query; }, async paginate(options: { numItems: number; cursor: string }) { assert.equal(options.numItems, 100); assert.equal(options.cursor, "cursor"); return { page: [], continueCursor: "next", isDone: false }; } };
        assert.deepEqual(await call(list, { db: { query() { return query; } } }, { serviceToken: "test-ledger", source: "trust", sortKey, order, paginationOpts: { numItems: 10000, cursor: "cursor" } }), { page: [], continueCursor: "next", isDone: false });
        assert.deepEqual(filters, [["source", "trust"], ["deletedAt", undefined]]);
      }
    }
  } finally { if (previous === undefined) delete process.env.CONVEX_SERVICE_TOKEN; else process.env.CONVEX_SERVICE_TOKEN = previous; }
});

test("dashboard creation retries preserve edits; deletion retains audit and blocks recreation or stale edits", async () => {
  const previous = process.env.CONVEX_SERVICE_TOKEN;
  process.env.CONVEX_SERVICE_TOKEN = "test-ledger";
  try {
    const ctx = database({});
    const input = { serviceToken: "test-ledger", source: "trust", companyName: "  Example Ltd  ", amount: 250.5, currency: "eur", direction: "in", date: "2026-10-01", requestId: "97b12036-41f5-4bf5-a2d8-8c19178843d0", createdBy: "Meet" };
    await assert.rejects(call(createFromDashboard, ctx, { ...input, serviceToken: "wrong" }), /Unauthorized/);
    await assert.rejects(call(createFromDashboard, ctx, { ...input, requestId: "bad" }), /request ID/);
    await assert.rejects(call(createFromDashboard, ctx, { ...input, amount: -1 }), /Amount/);
    await assert.rejects(call(createFromDashboard, ctx, { ...input, createdBy: "" }), /Creator/);
    const first = await call(createFromDashboard, ctx, input);
    assert.equal(first.duplicate, false);
    const row = ctx.tables.manualBankTransactions[0];
    assert.equal(row.companyName, "Example Ltd");
    assert.equal(row.currency, "EUR");
    assert.equal(row.date, "2026-10-01");
    assert.equal(row.createdBy, "Meet");
    const edit = { serviceToken: "test-ledger", id: first.id, expectedRevision: 1, companyName: "Edited company", amount: 100, currency: "USDC", direction: "out", date: "2026-10-02", updatedBy: "Ali" };
    await call(update, ctx, edit);
    assert.deepEqual(await call(createFromDashboard, ctx, input), { id: first.id, duplicate: true });
    assert.equal(row.amount, 100);
    const deletion = { serviceToken: "test-ledger", id: first.id, expectedRevision: 2, deletedBy: "Ali M" };
    await assert.rejects(call(remove, ctx, { ...deletion, serviceToken: "wrong" }), /Unauthorized/);
    await assert.rejects(call(remove, ctx, { ...deletion, deletedBy: "" }), /Editor/);
    await assert.rejects(call(remove, ctx, { ...deletion, expectedRevision: 1 }), /edited by someone else/);
    assert.equal(row.deletedAt, undefined);
    await call(remove, ctx, deletion);
    const deletedAt = row.deletedAt;
    assert.ok(deletedAt);
    assert.equal(row.deletedBy, "Ali M");
    assert.equal(row.amount, 100);
    assert.equal(row.revision, 3);
    assert.equal(ctx.tables.manualBankTransactionEdits.length, 1);
    await call(remove, ctx, deletion);
    assert.equal(row.deletedAt, deletedAt);
    assert.equal(row.revision, 3);
    await assert.rejects(call(update, ctx, { ...edit, expectedRevision: 3 }), /deleted/);
    assert.deepEqual(await call(createFromDashboard, ctx, input), { id: first.id, duplicate: true });
    assert.equal(ctx.tables.manualBankTransactions.length, 1);
    await call(createFromDashboard, ctx, { ...input, source: "kraken" });
    assert.equal(ctx.tables.manualBankTransactions.length, 2);

    // Page through the fake database with the actual query's source/deletion predicates.
    const query = ctx.db.query.bind(ctx.db);
    const listCtx = { db: { query(table: string) { const q = query(table); return Object.assign(q, { async paginate() { return { page: await q.take(100), isDone: true, continueCursor: "" }; } }); } } };
    const page = (source: string) => call(list, listCtx, { serviceToken: "test-ledger", source, sortKey: "date", order: "desc", paginationOpts: { numItems: 50, cursor: null } });
    assert.equal((await page("trust")).page.length, 0);
    const kraken = (await page("kraken")).page;
    assert.equal(kraken.length, 1);
    assert.equal(kraken[0].deletedAt, undefined);
    assert.equal("intakeKey" in kraken[0], false);

    const telegram = { serviceToken: "test-ledger", source: "trust", companyName: "Telegram company", amount: 10, currency: "USDC", direction: "out", date: "2026-10-14", intakeKey: "telegram:123:101", sentAt: 1791945000, createdBy: "Ali" };
    const sent = await call(createFromTelegram, ctx, telegram);
    await call(remove, ctx, { ...deletion, id: sent.id, expectedRevision: 1 });
    assert.deepEqual(await call(createFromTelegram, ctx, telegram), { id: sent.id, duplicate: true });
    assert.equal((await page("trust")).page.length, 0);
    assert.equal(ctx.tables.manualBankTransactions.length, 3);
  } finally { if (previous === undefined) delete process.env.CONVEX_SERVICE_TOKEN; else process.env.CONVEX_SERVICE_TOKEN = previous; }
});
