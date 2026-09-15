import assert from "node:assert/strict";
import test from "node:test";
import { stage, start, batch, discard, get, fail } from "../convex/amexStatements";
import { amexStatementTransactions } from "../shared/amexStatements";

const handler = (fn: object) => {
  const run: unknown = Reflect.get(fn, "_handler");
  if (typeof run !== "function") throw new Error("Missing handler");
  return (ctx: unknown, args: unknown) => run(ctx, args);
};
function memory() {
  const tables = new Map<string, Array<Record<string, unknown>>>();
  const table = (name: string) => { if (!tables.has(name)) tables.set(name, []); return tables.get(name)!; };
  table("bankLedgerCutover").push({ _id: "cutover", key: "default", status: "ready" });
  const scheduled: unknown[] = [], deletedFiles: string[] = [];
  const ctx = {
    db: {
      query(name: string) {
        const conditions: Array<[string, unknown]> = [];
        const range = { eq(key: string, value: unknown) { conditions.push([key, value]); return range; } };
        const selected = () => table(name).filter(row => conditions.every(([key, value]) => row[key] === value));
        const query = { withIndex(_name: string, fn: (q: typeof range) => unknown) { fn(range); return query; }, order() { return query; }, unique: async () => selected()[0] ?? null, first: async () => selected()[0] ?? null, take: async (limit: number) => selected().slice(0, limit) };
        return query;
      },
      get: async (id: string) => [...tables.values()].flat().find(row => row._id === id) ?? null,
      insert: async (name: string, value: Record<string, unknown>) => { const id = `${name}:${table(name).length}`; table(name).push({ ...value, _id: id, _creationTime: Date.now() }); return id; },
      patch: async (id: string, value: Record<string, unknown>) => { const row = [...tables.values()].flat().find(row => row._id === id); assert.ok(row); Object.assign(row, value); },
      delete: async (id: string) => { for (const rows of tables.values()) { const index = rows.findIndex(row => row._id === id); if (index >= 0) rows.splice(index, 1); } }
    },
    storage: { delete: async (id: string) => { deletedFiles.push(id); }, getUrl: async () => "https://storage.example/original.csv" },
    scheduler: { runAfter: async (...args: unknown[]) => { scheduled.push(args); } }
  };
  return { ctx, table, scheduled, deletedFiles };
}
test("Amex imports resume bounded batches and preserve classification on overlapping uploads", async () => {
  const oldToken = process.env.CONVEX_SERVICE_TOKEN; process.env.CONVEX_SERVICE_TOKEN = "test-token";
  try {
    const { ctx, table } = memory();
    const data = { currency: "EUR", cardLastFour: "1234", reviewReasons: [], rows: Array.from({ length: 205 }, (_, i) => ({ date: "2026-09-15", description: `Vendor ${i}`, amount: i + 1 })) };
    const transactions = await amexStatementTransactions(data);
    const args = { ...data, rows: data.rows.map((row, i) => ({ ...row, id: transactions[i].id })), serviceToken: "test-token", storageId: "file1", contentHash: "a".repeat(64), fileName: "Amex.csv", contentType: "text/csv", source: "upload" };
    await assert.rejects(handler(stage)(ctx, { ...args, serviceToken: "wrong" }), /Unauthorized/);
    const { id } = await handler(stage)(ctx, args);
    assert.equal(table("bankTransactions").length, 0);
    await handler(start)(ctx, { serviceToken: "test-token", id, reviewed: false });
    assert.equal(await handler(batch)(ctx, { id }), false); assert.equal(table("bankTransactions").length, 100);
    await handler(fail)(ctx, { id, error: "Temporary interruption" });
    await handler(start)(ctx, { serviceToken: "test-token", id, reviewed: false });
    assert.equal(await handler(batch)(ctx, { id }), false); assert.equal(table("bankTransactions").length, 200);
    assert.equal(await handler(batch)(ctx, { id }), true); assert.equal(table("bankTransactions").length, 205);
    assert.equal(await handler(batch)(ctx, { id }), false);
    assert.equal(table("bankAccounts").length, 0, "Statements must not invent live balances");
    const first = table("bankTransactions")[0]; Object.assign(first, { category: "Software", categorySource: "manual", teamId: "team1", matchedProviderId: "provider1", classificationComplete: true });
    const second = await handler(stage)(ctx, { ...args, contentHash: "b".repeat(64), storageId: "file2", fileName: "Overlap.pdf" });
    await handler(start)(ctx, { serviceToken: "test-token", id: second.id, reviewed: false });
    for (let i = 0; i < 3; i++) await handler(batch)(ctx, { id: second.id });
    const detail = await handler(get)(ctx, { serviceToken: "test-token", id: second.id });
    assert.equal(detail.record.inserted, 0); assert.equal(detail.record.duplicates, 205); assert.equal(table("bankTransactions").length, 205);
    assert.equal(first.category, "Software"); assert.equal(first.teamId, "team1"); assert.equal(first.matchedProviderId, "provider1");
    const duplicate = await handler(stage)(ctx, args); assert.equal(duplicate.id, id); assert.equal(duplicate.duplicate, true);
    await assert.rejects(handler(discard)(ctx, { serviceToken: "test-token", id }), /Only an unimported/);
  } finally { if (oldToken === undefined) delete process.env.CONVEX_SERVICE_TOKEN; else process.env.CONVEX_SERVICE_TOKEN = oldToken; }
});
test("uncertain statements cannot auto-import and unimported previews can be discarded", async () => {
  const oldToken = process.env.CONVEX_SERVICE_TOKEN; process.env.CONVEX_SERVICE_TOKEN = "test-token";
  try {
    const { ctx, table, deletedFiles } = memory();
    const data = { currency: "EUR", cardLastFour: "1234", reviewReasons: ["Check the original"], rows: [{ date: "2026-09-15", description: "Vendor", amount: 12 }] };
    const [transaction] = await amexStatementTransactions(data);
    const { id } = await handler(stage)(ctx, { ...data, rows: [{ ...data.rows[0], id: transaction.id }], serviceToken: "test-token", storageId: "file1", contentHash: "a".repeat(64), fileName: "Amex.pdf", contentType: "application/pdf", source: "telegram" });
    await assert.rejects(handler(start)(ctx, { serviceToken: "test-token", id, reviewed: false }), /Review this statement/);
    assert.equal(table("bankTransactions").length, 0);
    await handler(discard)(ctx, { serviceToken: "test-token", id }); assert.deepEqual(deletedFiles, ["file1"]); assert.equal(table("amexStatementImports").length, 0);
  } finally { if (oldToken === undefined) delete process.env.CONVEX_SERVICE_TOKEN; else process.env.CONVEX_SERVICE_TOKEN = oldToken; }
});
