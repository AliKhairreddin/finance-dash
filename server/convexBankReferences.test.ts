import assert from "node:assert/strict";
import test from "node:test";
import { backfillWiseReferences } from "../convex/banking";
import { call, database } from "./convexTestDb";

test("Wise reference backfill previews and changes only recoverable notes, preserving financial data", async () => {
  const previous = process.env.CONVEX_SERVICE_TOKEN;
  process.env.CONVEX_SERVICE_TOKEN = "test-references";
  try {
    const ctx = database({ bankLedgerCutover: [{ _id: "cutover", key: "default", status: "ready" }], bankTransactions: [
      { _id: "one", source: "wise", id: "wise1", date: "2026-09-01", amount: 123, currency: "USD", direction: "out", category: "Software", description: "Sent money to Acme with reference INV 20 (fee: 1.13 USD)" },
      { _id: "two", source: "wise", id: "wise2", date: "2026-09-01", amount: 50, currency: "EUR", direction: "in", description: "Received money from Client with reference New", reference: "Saved" },
      { _id: "three", source: "wise", id: "wise3", date: "2026-09-01", amount: 2, currency: "USD", direction: "out", description: "Wise Charges for: TRANSFER-123" }
    ] });
    const originalQuery = ctx.db.query;
    ctx.db.query = (table: string) => {
      if (table !== "bankTransactions") return originalQuery(table);
      const query = {
        withIndex(name: string, filter: (index: unknown) => unknown) { assert.equal(name, "by_source"); filter({ eq(key: string, value: string) { assert.equal(key, "source"); assert.equal(value, "wise"); } }); return query; },
        async paginate(options: { numItems: number }) { assert.equal(options.numItems, 200); return { page: structuredClone(ctx.tables.bankTransactions), isDone: true, continueCursor: "done" }; }
      };
      return query as never;
    };
    const before = structuredClone(ctx.tables.bankTransactions);
    assert.equal((await call(backfillWiseReferences, ctx, { serviceToken: "test-references", dryRun: true, cursor: null })).changed, 1);
    assert.deepEqual(ctx.tables.bankTransactions, before);
    assert.equal((await call(backfillWiseReferences, ctx, { serviceToken: "test-references", dryRun: false, cursor: null })).changed, 1);
    assert.deepEqual(ctx.tables.bankTransactions, [{ ...before[0], reference: "INV 20" }, before[1], before[2]]);
    assert.equal((await call(backfillWiseReferences, ctx, { serviceToken: "test-references", dryRun: false, cursor: null })).changed, 0);
    await assert.rejects(call(backfillWiseReferences, ctx, { serviceToken: "wrong", dryRun: false, cursor: null }), /UNAUTHORIZED/);
  } finally { if (previous === undefined) delete process.env.CONVEX_SERVICE_TOKEN; else process.env.CONVEX_SERVICE_TOKEN = previous; }
});
