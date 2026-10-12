import assert from "node:assert/strict";
import test from "node:test";
import * as contracts from "../convex/companyDocuments";
// A small indexed database harness exercises the registered mutation handlers.
type Row = Record<string, any>;
function database(initial: Record<string, Row[]> = {}) {
  const tables = new Map(Object.entries(initial)); let counter = 0;
  const scheduled: unknown[] = [], deletedFiles: string[] = [];
  const io = { ledgerReads: 0, ledgerWrites: 0, ledgerReadBytes: 0, ledgerWriteBytes: 0 };
  const read = (table: string, row: Row | null) => {
    if (table === "dashboardState" && row) {
      io.ledgerReads++;
      io.ledgerReadBytes += Buffer.byteLength(JSON.stringify(row));
    }
    return structuredClone(row);
  };
  const ctx = {
    db: {
      query(table: string) {
        let rows = tables.get(table) ?? [];
        const builder = {
          withIndex(_index: string, select?: (q: any) => unknown) {
            const conditions: Array<(row: Row) => boolean> = [];
            const fieldValue = (row: Row, field: string): any => field.split(".").reduce<any>((value, part) => value?.[part], row);
            const q = { eq(field: string, value: unknown) { conditions.push(row => fieldValue(row, field) === value); return q; }, gte(field: string, value: number) { conditions.push(row => fieldValue(row, field) >= value); return q; }, lte(field: string, value: number | string) { conditions.push(row => fieldValue(row, field) <= value); return q; } };
            select?.(q); rows = rows.filter(row => conditions.every(check => check(row))); return builder;
          }, async paginate(options: { cursor: string | null; numItems: number }) { const offset = Number(options.cursor ?? 0); return { page: rows.slice(offset, offset + options.numItems).map(row => read(table, row)), isDone: offset + options.numItems >= rows.length, continueCursor: String(offset + options.numItems) }; }, async first() { return read(table, rows[0] ?? null); }, async unique() { assert.ok(rows.length <= 1); return read(table, rows[0] ?? null); }, async take(count: number) { return rows.slice(0, count).map(row => read(table, row)); }
        }; return builder;
      },
      async get(id: string): Promise<Row> { for (const [table, rows] of tables) { const row = rows.find(row => row._id === id); if (row) return read(table, row)!; } return null as unknown as Row; },
      async patch(id: string, patch: Row) {
        const row = [...tables.values()].flat().find(row => row._id === id); assert.ok(row, id);
        Object.assign(row, structuredClone(patch));
        if ((tables.get("dashboardState") ?? []).includes(row)) {
          io.ledgerWrites++;
          io.ledgerWriteBytes += Buffer.byteLength(JSON.stringify(row));
        }
      },
      async insert(table: string, value: Row) { const row = { _id: `${table}:${++counter}`, _creationTime: Date.now(), ...value }; tables.set(table, [...(tables.get(table) ?? []), row]); return row._id; },
      async delete(id: string) { for (const [table, rows] of tables) tables.set(table, rows.filter(row => row._id !== id)); },
      system: { async get(id: string) { return { _id: id, size: 100, sha256: "a".repeat(64) }; } }
    },
    storage: { async delete(id: string) { deletedFiles.push(id); }, async getUrl(id: string) { return `https://storage.example/${id}`; } },
    scheduler: { async runAfter(...args: unknown[]) { scheduled.push(args); } }
  };
  const run = (fn: unknown, args: Row) => (fn as { _handler: (ctx: unknown, args: Row) => Promise<any> })._handler(ctx, args);
  return { ctx, tables, scheduled, deletedFiles, run, io, resetIo() { for (const key of Object.keys(io) as Array<keyof typeof io>) io[key] = 0; } };
}
const extraction = { parties: [{ name: "Acme LLC", email: "", taxId: "", registrationNumber: "" }], confidence: 0.99, reason: "Printed party" };
const setup = () => { process.env.CONVEX_SERVICE_TOKEN = "test"; return database({ dashboardState: [{ _id: "state", key: "default", providers: [{ id: "acme", name: "Acme", aliases: [] }, { id: "other", name: "Other", aliases: [] }], invoices: [], expenses: [] }] }); };
const input = { serviceToken: "test", storageId: "blob", contentHash: "a".repeat(64), fileName: "contract.pdf", contentType: "application/pdf", size: 100, source: "email", sourceContext: "Forwarded contract" };
test("contract intake is durable, deduplicated and never writes financial ledger records", async () => {
  const db = setup(), before = structuredClone(await db.ctx.db.get("state"));
  const first = await db.run(contracts.ingest, input);
  const second = await db.run(contracts.ingest, { ...input, storageId: "duplicate" });
  assert.equal(second.id, first.id); assert.equal(second.duplicate, true); assert.deepEqual(db.deletedFiles, ["duplicate"]); assert.equal(db.scheduled.length, 1);
  assert.equal(await db.run(contracts.claim, { id: first.id, token: "lease" }), true);
  assert.equal(await db.run(contracts.claim, { id: first.id, token: "other-lease" }), false);
  await db.run(contracts.complete, { id: first.id, token: "lease", extraction });
  assert.equal((await db.ctx.db.get(first.id)).providerId, "acme"); assert.equal((await db.ctx.db.get(first.id)).status, "assigned");
  assert.deepEqual(await db.ctx.db.get("state"), before);
});
test("manual assignment wins over an in-flight recognition result and watchdog", async () => {
  const db = setup(); const { id } = await db.run(contracts.ingest, input);
  await db.run(contracts.claim, { id, token: "lease" });
  await db.run(contracts.assign, { serviceToken: "test", id, providerId: "other" });
  await db.run(contracts.complete, { id, token: "lease", extraction });
  await db.run(contracts.recover, { id, token: "lease", error: "timeout" });
  assert.equal((await db.ctx.db.get(id)).providerId, "other"); assert.equal((await db.ctx.db.get(id)).status, "assigned");
});
test("failed recognition retries at most three times and preserves the original in the review inbox", async () => {
  const db = setup(); const { id } = await db.run(contracts.ingest, input);
  for (let i = 0; i < 3; i++) { await db.run(contracts.claim, { id, token: `lease${i}` }); await db.run(contracts.recover, { id, token: `lease${i}`, error: "Rate limited", retryAfterMs: 60000 }); }
  const doc = await db.ctx.db.get(id); assert.equal(doc.status, "needs_review"); assert.equal(doc.attempts, 3); assert.equal(doc.storageId, "blob"); assert.deepEqual(db.deletedFiles, []);
  assert.equal(await db.run(contracts.claim, { id, token: "extra" }), false);
  await db.run(contracts.retry, { serviceToken: "test", id }); assert.equal((await db.ctx.db.get(id)).attempts, 0);
});
test("explicit uploads assign unknown copies but cannot silently move already filed contracts", async () => {
  const db = setup(); const { id } = await db.run(contracts.ingest, input);
  await db.run(contracts.ingest, { ...input, storageId: "second", providerId: "acme" });
  assert.equal((await db.ctx.db.get(id)).providerId, "acme");
  await db.run(contracts.ingest, { ...input, storageId: "third", providerId: "other" });
  assert.equal((await db.ctx.db.get(id)).providerId, "acme");
  await db.run(contracts.assign, { serviceToken: "test", id, providerId: null });
  assert.equal((await db.ctx.db.get(id)).status, "needs_review");
});
test("unknown companies and unauthorized callers cannot read or assign contracts", async () => {
  const db = setup(); const { id } = await db.run(contracts.ingest, input);
  await assert.rejects(db.run(contracts.assign, { serviceToken: "test", id, providerId: "missing" }), /Company not found/);
  await assert.rejects(db.run(contracts.get, { serviceToken: "wrong", id }), /Unauthorized/);
  await assert.rejects(db.run(contracts.ingest, { ...input, serviceToken: "wrong" }), /Unauthorized/);
});
