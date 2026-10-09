import assert from "node:assert/strict";
import test from "node:test";
import * as documents from "../convex/documents";
import * as referenceChecks from "../convex/documentRecheck";
import type { DocumentExtraction } from "../shared/financialDocuments";

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
const extraction: DocumentExtraction = { kind: "expense", entity: "dn", counterparty: "Acme", documentNumber: "ACME-101", amount: 20, currency: "USD", issueDate: "2026-08-15", dueDate: null, description: "Software", confidence: 0.99, reviewReasons: [] };
const state = () => ({ _id: "state", key: "default", updatedAt: "2026-09-01T00:00:00Z", invoices: [], expenses: [], providers: [], paymentAllocations: [] });
const tx = (id: string) => ({ _id: id, id, direction: "out", amount: 20, currency: "USD", date: "2026-08-15", status: "posted", source: "wise", connectionKey: "primary", identityVersion: 2, wiseEntity: "dn", accountName: "Digital Nudge USD", counterparty: "Acme", rawName: "ACME", description: "ACME-101" });
const doc = () => ({ _id: "document", storageId: "blob", fileName: "receipt.pdf", contentType: "application/pdf", size: 100, source: "upload", sourceContext: "", month: "2026-09", kind: "unknown", status: "processing", attemptToken: "lease", attempts: 1, createdAt: "2026-09-06T00:00:00Z" });
const setup = (transactions: Row[] = [tx("tx-1")]) => database({ dashboardState: [state()], financialDocuments: [doc()], bankTransactions: transactions, bankConnectionBindings: [{ source: "wise", connectionKey: "primary" }] });

test("processing saves a source attachment and links an expense without marking it paid", async () => {
  const db = setup(); await db.run(documents.complete, { id: "document", token: "lease", extraction });
  const saved = await db.ctx.db.get("document"), ledger = await db.ctx.db.get("state");
  assert.equal(saved.status, "matched"); assert.equal(saved.month, "2026-08"); assert.equal(saved.transactionId, "tx-1");
  assert.equal(ledger.expenses.length, 1); assert.equal(ledger.expenses[0].paymentStatus, "unpaid"); assert.equal(ledger.expenses[0].documents[0].storageId, "blob");
  assert.deepEqual(ledger.paymentAllocations, []);
});
test("ambiguous transactions remain unmatched until an explicit selection", async () => {
  process.env.CONVEX_SERVICE_TOKEN = "test-service";
  const db = setup([tx("tx-1"), tx("tx-2")]); await db.run(documents.complete, { id: "document", token: "lease", extraction });
  assert.equal((await db.ctx.db.get("document")).status, "unmatched");
  await db.run(documents.confirmMatch, { serviceToken: "test-service", id: "document", transactionId: "tx-2" });
  assert.equal((await db.ctx.db.get("document")).transactionId, "tx-2");
  assert.equal((await db.ctx.db.get("state")).expenses[0].paymentStatus, "unpaid");
});
test("document arrival attaches to an existing invoice's bank match without creating another invoice", async () => {
  const db = setup([{ ...tx("tx-1"), direction: "in", matchedInvoiceId: "invoice-1" }]);
  await db.ctx.db.patch("state", { invoices: [{ id: "invoice-1", invoiceNumber: "ACME-101", customerName: "Acme", currency: "USD", amount: 20, entity: "dn", transactionId: "tx-1", status: "open" }] });
  await db.run(documents.complete, { id: "document", token: "lease", extraction: { ...extraction, kind: "invoice" } });
  assert.equal((await db.ctx.db.get("document")).status, "matched"); assert.equal((await db.ctx.db.get("document")).invoiceId, "invoice-1");
  assert.equal((await db.ctx.db.get("state")).invoices.length, 1); assert.equal((await db.ctx.db.get("state")).invoices[0].status, "open");
  assert.equal((db.tables.get("bankLedgerRevision") ?? []).length, 2);
});
test("uncertain extraction and expired worker results cannot create ledger entries", async () => {
  const db = setup(); await db.run(documents.complete, { id: "document", token: "old-lease", extraction });
  assert.equal((await db.ctx.db.get("document")).status, "processing");
  await db.run(documents.complete, { id: "document", token: "lease", extraction: { ...extraction, entity: null } });
  assert.equal((await db.ctx.db.get("document")).status, "needs_review"); assert.equal((await db.ctx.db.get("state")).expenses.length, 0);
});
test("identical uploads deduplicate across channels and discard only the redundant blob", async () => {
  process.env.CONVEX_SERVICE_TOKEN = "test-service";
  const db = database({ financialDocuments: [{ ...doc(), contentHash: "a".repeat(64) }] });
  const result = await db.run(documents.ingest, { serviceToken: "test-service", storageId: "second-blob", contentHash: "a".repeat(64), intakeKey: "telegram:123", fileName: "forward.pdf", contentType: "application/pdf", size: 100, source: "telegram", sourceContext: "" });
  assert.deepEqual(result, { id: "document", duplicate: true }); assert.deepEqual(db.deletedFiles, ["second-blob"]); assert.equal(db.scheduled.length, 0);
});

test("archiving an invoice preserves its existing fee-adjusted bank link without upgrading confidence", async () => {
  const db = setup([{ ...tx("tx-1"), direction: "in", amount: 19.5, date: "2026-03-01", matchedInvoiceId: "invoice-1", invoiceMatchSource: "ai", invoiceMatchConfidence: 0.98 }]);
  await db.ctx.db.patch("state", { invoices: [{ id: "invoice-1", invoiceNumber: "ACME-101", customerName: "Acme", currency: "USD", amount: 20, entity: "dn", transactionId: "tx-1", status: "open" }] });
  await db.ctx.db.patch("document", { source: "archive", invoiceId: "invoice-1" });
  await db.run(documents.complete, { id: "document", token: "lease", extraction: { ...extraction, kind: "invoice" } });
  assert.equal((await db.ctx.db.get("document")).status, "matched");
  assert.match((await db.ctx.db.get("document")).matchReason, /existing bank match/);
  assert.equal((await db.ctx.db.get("tx-1")).invoiceMatchConfidence, 0.98);
  assert.equal((await db.ctx.db.get("state")).invoices[0].status, "open");
});

test("invoice PDF downloads select the PDF when an earlier original is an image", async () => {
  process.env.CONVEX_SERVICE_TOKEN = "test-service";
  const db = database({ financialDocuments: [{ ...doc(), contentType: "image/png", invoiceId: "invoice-1", fileName: "original.png" }, { ...doc(), _id: "pdf", storageId: "pdf-blob", invoiceId: "invoice-1", fileName: "invoice.pdf" }] });
  const result = await db.run(documents.forInvoice, { serviceToken: "test-service", invoiceId: "invoice-1" });
  assert.equal(result.id, "pdf"); assert.equal(result.contentType, "application/pdf");
});

function amexSetup() {
  const charge = { ...tx("amex-1"), source: "amex", wiseEntity: undefined, accountName: "Amex •1003", cardLastFour: "1029", cardHolderName: "Test Cardholder", counterparty: "CLOUDFLARE SAN FRANCISCO", rawName: "CLOUDFLARE SAN FRANCISCO", description: "CLOUDFLARE SAN FRANCISCO", currency: "EUR", amount: 52.28 };
  const db = setup([charge]);
  db.tables.set("bankConnectionBindings", [{ source: "amex", connectionKey: "primary" }]);
  const receipt = { ...extraction, counterparty: "Cloudflare, Inc.", amount: 59.08 };
  process.env.CONVEX_SERVICE_TOKEN = "test-service";
  return { db, receipt };
}

test("company review exposes Amex FX candidates and confirms company plus bank link in one save", async () => {
  const { db, receipt } = amexSetup();
  await db.run(documents.complete, { id: "document", token: "lease", extraction: { ...receipt, entity: null } });
  assert.equal((await db.ctx.db.get("document")).status, "needs_review");
  const { rows: candidates } = await db.run(documents.candidates, { serviceToken: "test-service", id: "document" });
  assert.equal(candidates.length, 1); assert.equal(candidates[0].matchKind, "foreign_currency");
  assert.equal(candidates[0].cardLastFour, "1029"); assert.equal(candidates[0].cardHolderName, "Test Cardholder");
  assert.equal((await db.ctx.db.get("state")).expenses.length, 0);
  const { rows: changedCompany } = await db.run(documents.candidates, { serviceToken: "test-service", id: "document", extraction: { ...receipt, counterparty: "Other" } });
  assert.equal(changedCompany.length, 0, "Candidates use the edited document details");
  await assert.rejects(db.run(documents.review, { serviceToken: "test-service", id: "document", extraction: { ...receipt, entity: null }, transactionId: "amex-1", confirmCurrencyConversion: true }), /Choose Digital Nudge/);
  await assert.rejects(db.run(documents.review, { serviceToken: "test-service", id: "document", extraction: receipt, transactionId: "amex-1" }), /Confirm the bank charge/);
  await db.run(documents.review, { serviceToken: "test-service", id: "document", extraction: receipt, transactionId: "amex-1", confirmCurrencyConversion: true });
  const saved = await db.ctx.db.get("document"), ledger = await db.ctx.db.get("state");
  assert.equal(saved.status, "matched"); assert.equal(saved.entity, "dn"); assert.equal(saved.transactionId, "amex-1");
  assert.match(saved.matchReason, /59.08 USD document \/ 52.28 EUR bank charge/);
  assert.equal(ledger.expenses.length, 1); assert.equal(ledger.expenses[0].grossAmount, 59.08); assert.equal(ledger.expenses[0].currency, "USD");
  assert.equal(ledger.expenses[0].paymentStatus, "unpaid"); assert.deepEqual(ledger.paymentAllocations, []);
  assert.equal((await db.ctx.db.get("amex-1")).amount, 52.28);
});

test("automatic processing and rematching never silently accept foreign-currency suggestions", async () => {
  const { db, receipt } = amexSetup();
  await db.run(documents.complete, { id: "document", token: "lease", extraction: receipt });
  await db.run(documents.rematch, { serviceToken: "test-service", id: "document" });
  assert.equal((await db.ctx.db.get("document")).status, "unmatched");
  await assert.rejects(db.run(documents.confirmMatch, { serviceToken: "test-service", id: "document", transactionId: "amex-1" }), /Confirm the bank charge/);
  await db.run(documents.confirmMatch, { serviceToken: "test-service", id: "document", transactionId: "amex-1", confirmCurrencyConversion: true });
  assert.equal((await db.ctx.db.get("document")).status, "matched");
  assert.equal((await db.ctx.db.get("state")).expenses.length, 1);
});

test("Amex matches recheck active identities, claims, company and posted status at confirmation", async () => {
  for (const changes of [{ connectionKey: "disconnected" }, { identityVersion: 1 }, { wiseEntity: "lmd" }, { status: "pending" }]) {
    const { db, receipt } = amexSetup();
    await db.run(documents.complete, { id: "document", token: "lease", extraction: receipt });
    await db.ctx.db.patch("amex-1", changes);
    assert.deepEqual(await db.run(documents.candidates, { serviceToken: "test-service", id: "document" }), { rows: [], limited: false });
    await assert.rejects(db.run(documents.confirmMatch, { serviceToken: "test-service", id: "document", transactionId: "amex-1", confirmCurrencyConversion: true }), /no longer fits/);
  }
  const { db, receipt } = amexSetup();
  await db.run(documents.complete, { id: "document", token: "lease", extraction: receipt });
  await db.ctx.db.insert("financialDocuments", { ...doc(), _id: "other-document", transactionId: "amex-1", expenseId: "other-expense", status: "matched" });
  assert.deepEqual(await db.run(documents.candidates, { serviceToken: "test-service", id: "document" }), { rows: [], limited: false });
  await assert.rejects(db.run(documents.confirmMatch, { serviceToken: "test-service", id: "document", transactionId: "amex-1", confirmCurrencyConversion: true }), /already claimed/);
});

test("a receipt and invoice for the same expense share its confirmed Amex link", async () => {
  const { db, receipt } = amexSetup();
  await db.run(documents.complete, { id: "document", token: "lease", extraction: receipt });
  await db.run(documents.confirmMatch, { serviceToken: "test-service", id: "document", transactionId: "amex-1", confirmCurrencyConversion: true });
  await db.ctx.db.insert("financialDocuments", { ...doc(), _id: "second", storageId: "second-blob", fileName: "invoice.pdf" });
  await db.run(documents.complete, { id: "second", token: "lease", extraction: { ...receipt, entity: null } });
  assert.equal((await db.ctx.db.get("second")).status, "matched", "supporting files inherit the accepted purchase without another manual review");
  const second = await db.ctx.db.get("second"), first = await db.ctx.db.get("document"), ledger = await db.ctx.db.get("state");
  assert.equal(second.transactionId, first.transactionId); assert.equal(second.expenseId, first.expenseId); assert.equal(second.status, "matched");
  assert.equal(ledger.expenses.length, 1); assert.equal(ledger.expenses[0].documents.length, 2);
  assert.equal(ledger.expenses[0].paymentStatus, "unpaid");
});

test("semantic copies with renamed suppliers reuse one expense and retain both source files", async () => {
  const db = setup([]);
  await db.run(documents.complete, { id: "document", token: "lease", extraction });
  await db.ctx.db.insert("financialDocuments", { ...doc(), _id: "copy", storageId: "copy-blob", fileName: "forwarded.pdf" });
  await db.run(documents.complete, { id: "copy", token: "lease", extraction: { ...extraction, counterparty: "Acme, LLC" } });
  const ledger = await db.ctx.db.get("state");
  assert.equal(ledger.expenses.length, 1);
  assert.equal((await db.ctx.db.get("copy")).expenseId, ledger.expenses[0].id);
  assert.deepEqual(ledger.expenses[0].documents.map((d: Row) => d.storageId).sort(), ["blob", "copy-blob"]);
});

test("bulk trash and restore preserve originals, financial records and bank links", async () => {
  process.env.CONVEX_SERVICE_TOKEN = "test-service";
  const db = setup(); await db.run(documents.complete, { id: "document", token: "lease", extraction });
  const before = structuredClone(await db.ctx.db.get("state")), bank = structuredClone(await db.ctx.db.get("tx-1"));
  const args = { serviceToken: "test-service", ids: ["document", "document"] };
  assert.equal(await db.run(documents.trash, args), 1);
  assert.ok((await db.ctx.db.get("document")).deletedAt);
  assert.equal(await db.run(documents.trash, args), 0, "trash is idempotent");
  assert.equal((db.tables.get("documentFolders") ?? []).find(f => f.key === "dn:2026-08")?.count, 0);
  assert.equal(await db.run(documents.rematch, { serviceToken: "test-service", id: "document" }), 0);
  assert.deepEqual(await db.run(documents.candidates, { serviceToken: "test-service", id: "document" }), { rows: [], limited: false });
  assert.deepEqual(await db.ctx.db.get("state"), before); assert.deepEqual(await db.ctx.db.get("tx-1"), bank);
  assert.equal((await db.run(documents.get, { serviceToken: "test-service", id: "document" })).url, "https://storage.example/blob");
  assert.equal(await db.run(documents.restore, args), 1); assert.equal(await db.run(documents.restore, args), 0);
  assert.equal((await db.ctx.db.get("document")).deletedAt, undefined);
  assert.equal((db.tables.get("documentFolders") ?? []).find(f => f.key === "dn:2026-08")?.count, 1);
  assert.deepEqual(db.deletedFiles, []); assert.deepEqual(await db.ctx.db.get("state"), before);
});

test("trash preflights the whole batch, requires authorization and validates size", async () => {
  process.env.CONVEX_SERVICE_TOKEN = "test-service";
  const db = setup(); await db.ctx.db.insert("financialDocuments", { ...doc(), _id: "ready", status: "unmatched" });
  const args = { serviceToken: "test-service", ids: ["ready", "document"] };
  await assert.rejects(db.run(documents.trash, args), /finish processing/);
  assert.equal((await db.ctx.db.get("ready")).deletedAt, undefined);
  await assert.rejects(db.run(documents.trash, { ...args, ids: ["ready", "missing"] }), /no longer exists/);
  assert.equal((await db.ctx.db.get("ready")).deletedAt, undefined);
  for (const fn of [documents.trash, documents.restore]) {
    await assert.rejects(db.run(fn, { ...args, serviceToken: "incorrect" }), /Unauthorized/);
    await assert.rejects(db.run(fn, { ...args, ids: [] }), /1 and 200/);
    await assert.rejects(db.run(fn, { ...args, ids: Array(201).fill("ready") }), /1 and 200/);
  }
});

test("trashed queued files cannot process and restoring schedules work again", async () => {
  process.env.CONVEX_SERVICE_TOKEN = "test-service";
  const db = setup([]); await db.ctx.db.patch("document", { status: "queued" });
  await db.run(documents.trash, { serviceToken: "test-service", ids: ["document"] });
  assert.equal(await db.run(documents.claim, { id: "document", token: "new" }), false);
  await db.run(documents.complete, { id: "document", token: "lease", extraction });
  assert.equal((await db.ctx.db.get("state")).expenses.length, 0);
  await assert.rejects(db.run(documents.review, { serviceToken: "test-service", id: "document", extraction }), /unrecorded/);
  await assert.rejects(db.run(documents.retry, { serviceToken: "test-service", id: "document" }), /reprocessed/);
  await db.run(documents.restore, { serviceToken: "test-service", ids: ["document"] });
  assert.equal(db.scheduled.length, 1);
  assert.equal(await db.run(documents.claim, { id: "document", token: "new" }), true);
});

test("trashing an earlier copy never permits the same purchase to create another expense", async () => {
  process.env.CONVEX_SERVICE_TOKEN = "test-service";
  const db = setup([]); await db.run(documents.complete, { id: "document", token: "lease", extraction });
  await db.run(documents.trash, { serviceToken: "test-service", ids: ["document"] });
  await db.ctx.db.insert("financialDocuments", { ...doc(), _id: "copy", storageId: "copy-blob" });
  await db.run(documents.complete, { id: "copy", token: "lease", extraction: { ...extraction, counterparty: "Acme LLC" } });
  assert.equal((await db.ctx.db.get("state")).expenses.length, 1);
  assert.equal((await db.ctx.db.get("copy")).expenseId, (await db.ctx.db.get("document")).expenseId);
  assert.ok((await db.ctx.db.get("document")).deletedAt);
});

test("same filename or reused invoice number in another month does not reuse an expense", async () => {
  const db = setup([]); await db.run(documents.complete, { id: "document", token: "lease", extraction });
  await db.ctx.db.insert("financialDocuments", { ...doc(), _id: "next-month", storageId: "next-blob" });
  await db.run(documents.complete, { id: "next-month", token: "lease", extraction: { ...extraction, issueDate: "2026-09-15" } });
  assert.equal((await db.ctx.db.get("state")).expenses.length, 2);
  assert.notEqual((await db.ctx.db.get("next-month")).expenseId, (await db.ctx.db.get("document")).expenseId);
});

test("copies associated with conflicting existing records stop for review", async () => {
  const db = setup([]);
  for (const id of ["one", "two"]) await db.ctx.db.insert("financialDocuments", { ...doc(), _id: id, kind: "expense", status: "unmatched", extraction, expenseId: id });
  await db.run(documents.complete, { id: "document", token: "lease", extraction });
  assert.equal((await db.ctx.db.get("document")).status, "needs_review");
  assert.match((await db.ctx.db.get("document")).extraction.reviewReasons.join(" "), /different accounting records/);
  assert.equal((await db.ctx.db.get("state")).expenses.length, 0);
});

test("duplicate searches never silently create records after reaching the candidate limit", async () => {
  const db = setup([]);
  for (let index = 0; index < 101; index++) await db.ctx.db.insert("financialDocuments", { ...doc(), _id: `old-${index}`, kind: "expense", status: "unmatched", extraction: { ...extraction, counterparty: `Vendor ${index}` } });
  await db.run(documents.complete, { id: "document", token: "lease", extraction });
  assert.equal((await db.ctx.db.get("document")).status, "needs_review");
  assert.match((await db.ctx.db.get("document")).extraction.reviewReasons.join(" "), /Too many similar/);
  assert.equal((await db.ctx.db.get("state")).expenses.length, 0);
});

async function unmatchedBatch(size: number, kind: "expense" | "invoice" = "expense") {
  const db = setup([]);
  db.tables.set("financialDocuments", []);
  for (let index = 0; index < size; index++) {
    const id = `document-${index}`;
    await db.ctx.db.insert("financialDocuments", { ...doc(), _id: id, storageId: `blob-${index}` });
    await db.run(documents.complete, { id, token: "lease", extraction: { ...extraction, kind, amount: 20 + index, documentNumber: `ACME-${index}` } });
    await db.ctx.db.patch(id, { nextMatchAt: "2000-01-01T00:00:00.000Z" });
  }
  db.resetIo();
  return db;
}

test("twenty unchanged rematches read the ledger once and do not rewrite accounting records", async () => {
  process.env.CONVEX_SERVICE_TOKEN = "test-service";
  const db = await unmatchedBatch(20);
  const before = await db.ctx.db.get("state");
  db.resetIo();
  const startedAt = Date.now();
  assert.equal(await db.run(documents.rematch, { serviceToken: "test-service" }), 20);
  assert.equal(db.io.ledgerReads, 1);
  assert.equal(db.io.ledgerWrites, 0);
  assert.equal(db.io.ledgerReadBytes, Buffer.byteLength(JSON.stringify(before)));
  assert.equal(db.io.ledgerWriteBytes, 0);
  assert.deepEqual(await db.ctx.db.get("state"), before, "No timestamp or accounting changes when no bank match exists");
  for (const document of db.tables.get("financialDocuments")!) {
    assert.equal(document.status, "unmatched");
    assert.ok(Date.parse(document.nextMatchAt) >= startedAt + 5 * 60_000);
    assert.ok(Date.parse(document.nextMatchAt) <= Date.now() + 5 * 60_000);
  }
  db.resetIo();
  assert.equal(await db.run(documents.rematch, { serviceToken: "test-service" }), 0);
  assert.equal(db.io.ledgerReads, 0, "An empty or not-yet-due batch does not load the ledger");
  assert.equal(db.io.ledgerWrites, 0);
});

test("unchanged invoice retries preserve invoice and dashboard revisions", async () => {
  process.env.CONVEX_SERVICE_TOKEN = "test-service";
  const db = await unmatchedBatch(3, "invoice");
  const before = await db.ctx.db.get("state");
  db.resetIo();
  assert.equal(await db.run(documents.rematch, { serviceToken: "test-service" }), 3);
  assert.equal(db.io.ledgerReads, 1);
  assert.equal(db.io.ledgerWrites, 0);
  assert.deepEqual(await db.ctx.db.get("state"), before);
});

test("batched rematches retain every new bank link with one accounting write", async () => {
  process.env.CONVEX_SERVICE_TOKEN = "test-service";
  for (const kind of ["expense", "invoice"] as const) {
    const db = await unmatchedBatch(20, kind);
    for (let index = 0; index < 20; index++) {
      await db.ctx.db.insert("bankTransactions", { ...tx(`tx-${index}`), direction: kind === "invoice" ? "in" : "out", amount: 20 + index });
    }
    db.resetIo();
    assert.equal(await db.run(documents.rematch, { serviceToken: "test-service" }), 20);
    assert.equal(db.io.ledgerReads, 1);
    assert.equal(db.io.ledgerWrites, 1);
    const ledger = await db.ctx.db.get("state");
    const records = kind === "invoice" ? ledger.invoices : ledger.expenses;
    assert.equal(records.length, 20);
    for (let index = 0; index < 20; index++) {
      const document = await db.ctx.db.get(`document-${index}`);
      assert.equal(document.status, "matched");
      assert.equal(document.transactionId, `tx-${index}`);
      assert.equal(document.nextMatchAt, undefined);
      const record = records.find((row: Row) => row.id === (document.invoiceId ?? document.expenseId));
      assert.equal(record.transactionId, document.transactionId);
      assert.equal(kind === "invoice" ? record.status : record.paymentStatus, kind === "invoice" ? "open" : "unpaid");
      if (kind === "invoice") assert.equal((await db.ctx.db.get(`tx-${index}`)).matchedInvoiceId, record.id);
      else assert.equal(record.documents[0].storageId, `blob-${index}`);
    }
    assert.deepEqual(ledger.paymentAllocations, []);
  }
});

test("documents sharing a purchase in one batch reuse the record and keep all attachments", async () => {
  process.env.CONVEX_SERVICE_TOKEN = "test-service";
  const db = setup([]);
  db.tables.set("financialDocuments", ["first", "second"].map(id => ({ ...doc(), _id: id, storageId: `${id}-blob`, kind: "expense", extraction, status: "unmatched", nextMatchAt: "2000-01-01T00:00:00.000Z" })));
  assert.equal(await db.run(documents.rematch, { serviceToken: "test-service" }), 2);
  assert.equal(db.io.ledgerReads, 1);
  assert.equal(db.io.ledgerWrites, 1);
  const first = await db.ctx.db.get("first"), second = await db.ctx.db.get("second");
  assert.equal(first.expenseId, second.expenseId);
  const ledger = await db.ctx.db.get("state");
  assert.equal(ledger.expenses.length, 1);
  assert.deepEqual(ledger.expenses[0].documents.map((file: Row) => file.storageId).sort(), ["first-blob", "second-blob"]);
});

test("claims made earlier in a batch cannot be reused by another purchase", async () => {
  process.env.CONVEX_SERVICE_TOKEN = "test-service";
  const db = await unmatchedBatch(2);
  const second = await db.ctx.db.get("document-1");
  await db.ctx.db.patch(second._id, { extraction: { ...second.extraction, amount: 20 } });
  const ledger = await db.ctx.db.get("state");
  await db.ctx.db.patch("state", { expenses: ledger.expenses.map((row: Row) => ({ ...row, grossAmount: 20, netAmount: 20 })) });
  await db.ctx.db.insert("bankTransactions", tx("shared-tx"));
  db.resetIo();
  assert.equal(await db.run(documents.rematch, { serviceToken: "test-service" }), 2);
  assert.equal((await db.ctx.db.get("document-0")).transactionId, "shared-tx");
  assert.equal((await db.ctx.db.get("document-1")).status, "unmatched");
  assert.equal((await db.ctx.db.get("document-1")).transactionId, undefined);
  assert.equal(db.io.ledgerReads, 1);
  assert.equal(db.io.ledgerWrites, 1);
});

test("later rematches re-read accounting edits and retain the review safeguard", async () => {
  process.env.CONVEX_SERVICE_TOKEN = "test-service";
  const db = await unmatchedBatch(1);
  await db.run(documents.rematch, { serviceToken: "test-service", id: "document-0" });
  const ledger = await db.ctx.db.get("state");
  await db.ctx.db.patch("state", { expenses: ledger.expenses.map((row: Row) => ({ ...row, grossAmount: 50, description: "Edited by finance" })) });
  const edited = await db.ctx.db.get("state");
  await db.ctx.db.insert("bankTransactions", tx("new-tx"));
  db.resetIo();
  assert.equal(await db.run(documents.rematch, { serviceToken: "test-service", id: "document-0" }), 1);
  assert.equal(db.io.ledgerReads, 1);
  assert.equal(db.io.ledgerWrites, 0);
  const document = await db.ctx.db.get("document-0");
  assert.equal(document.status, "needs_review");
  assert.equal(document.transactionId, undefined);
  assert.match(document.extraction.reviewReasons.join(" "), /Details differ/);
  assert.deepEqual(await db.ctx.db.get("state"), edited);
});

test("document search returns bank/reference details past the old dropdown cap without changing match eligibility", async () => {
  process.env.CONVEX_SERVICE_TOKEN = "test-service";
  const transactions = Array.from({ length: 80 }, (_, i) => ({ ...tx(`tx-${i}`), accountId: "wise-usd" }));
  const db = setup([...transactions, { ...tx("pending"), status: "pending" }, { ...tx("other-company"), wiseEntity: "lmd" }, { ...tx("claimed"), matchedInvoiceId: "other-invoice" }]);
  await db.ctx.db.patch("document", { status: "needs_review", extraction });
  const result = await db.run(documents.candidates, { serviceToken: "test-service", id: "document" });
  assert.equal(result.rows.length, 80);
  assert.equal(result.limited, false);
  assert.equal(result.rows[0].source, "wise");
  assert.equal(result.rows[0].description, "ACME-101");
  assert.equal(result.rows[0].accountId, "wise-usd");
  assert.deepEqual((await db.ctx.db.get("state")).expenses, []);
});

test("document search reports bounded history instead of silently presenting it as complete", async () => {
  process.env.CONVEX_SERVICE_TOKEN = "test-service";
  const db = setup(Array.from({ length: 202 }, (_, i) => tx(`tx-${i}`)));
  await db.ctx.db.patch("document", { status: "needs_review", extraction });
  const result = await db.run(documents.candidates, { serviceToken: "test-service", id: "document" });
  assert.equal(result.limited, true);
  assert.equal(result.rows.length, 201);
});

const identity = (type: "invoice" | "receipt", invoiceNumber = "ACME-101") => ({ type, invoiceNumber, receiptNumber: type === "receipt" ? "9999-8888" : "", orderNumber: "", paymentReference: "", confidence: .99 });

test("invoice and receipt references create one purchase in either arrival order, across emails", async () => {
  for (const receiptFirst of [false, true]) {
    const db = setup();
    const invoice = { ...extraction, identity: identity("invoice") };
    const receipt = { ...extraction, documentNumber: "9999-8888", entity: null, confidence: .7, identity: identity("receipt") };
    await db.ctx.db.patch("document", { source: "email", sourceContext: "Forwarded email A", fileName: receiptFirst ? "receipt.pdf" : "invoice.pdf" });
    await db.run(documents.complete, { id: "document", token: "lease", extraction: receiptFirst ? receipt : invoice });
    await db.ctx.db.insert("financialDocuments", { ...doc(), _id: "later", storageId: "later-blob", source: "email", sourceContext: "Forwarded email B", fileName: receiptFirst ? "invoice.pdf" : "receipt.pdf" });
    await db.run(documents.complete, { id: "later", token: "lease", extraction: receiptFirst ? invoice : receipt });
    const ledger = await db.ctx.db.get("state"), first = await db.ctx.db.get("document"), later = await db.ctx.db.get("later");
    assert.equal(ledger.expenses.length, 1); assert.equal(ledger.expenses[0].documents.length, 2);
    assert.equal(ledger.expenses[0].paymentStatus, "unpaid");
    assert.equal(first.purchaseId, later.purchaseId); assert.equal(first.expenseId, later.expenseId);
    assert.equal(first.status, "matched"); assert.equal(later.status, "matched");
    assert.equal(first.transactionId, "tx-1"); assert.equal(later.transactionId, "tx-1");
  }
});

async function uncertainPair() {
  process.env.CONVEX_SERVICE_TOKEN = "test-service";
  const db = setup();
  await db.ctx.db.patch("document", { fileName: "invoice.pdf" });
  await db.run(documents.complete, { id: "document", token: "lease", extraction: { ...extraction, identity: identity("invoice") } });
  await db.ctx.db.insert("financialDocuments", { ...doc(), _id: "receipt", storageId: "receipt-blob", fileName: "receipt.pdf" });
  await db.run(documents.complete, { id: "receipt", token: "lease", extraction: { ...extraction, documentNumber: "9999-8888", identity: identity("receipt", "") } });
  return db;
}

test("a possible supporting file waits for a decision instead of duplicating an expense", async () => {
  const db = await uncertainPair();
  assert.equal((await db.ctx.db.get("state")).expenses.length, 1);
  const receipt = await db.ctx.db.get("receipt");
  assert.equal(receipt.status, "needs_review"); assert.equal(receipt.expenseId, undefined);
  assert.deepEqual(receipt.purchaseReviewIds, ["document"]);
  await db.run(documents.review, { serviceToken: "test-service", id: "receipt", extraction: receipt.extraction });
  assert.equal((await db.ctx.db.get("state")).expenses.length, 1, "editing metadata cannot bypass the purchase decision");
  await db.run(documents.resolvePurchase, { serviceToken: "test-service", id: "receipt", otherId: "document", decision: "same" });
  const linked = await db.ctx.db.get("receipt"), original = await db.ctx.db.get("document");
  assert.equal(linked.expenseId, original.expenseId); assert.equal(linked.transactionId, original.transactionId);
  assert.equal((await db.ctx.db.get("state")).expenses[0].documents.length, 2);
  assert.deepEqual(linked.purchaseReviewIds, []);
});

test("Separate purchases is remembered during subsequent rematches and copies", async () => {
  const db = await uncertainPair();
  await db.run(documents.resolvePurchase, { serviceToken: "test-service", id: "receipt", otherId: "document", decision: "separate" });
  assert.equal((await db.ctx.db.get("state")).expenses.length, 2);
  await db.run(documents.rematch, { serviceToken: "test-service", id: "receipt" });
  const receipt = await db.ctx.db.get("receipt");
  assert.equal(receipt.status, "unmatched"); assert.deepEqual(receipt.separateFrom, ["document"]);
  await db.ctx.db.insert("financialDocuments", { ...doc(), _id: "copy", storageId: "copy-blob", fileName: "invoice-copy.pdf" });
  await db.run(documents.complete, { id: "copy", token: "lease", extraction: { ...extraction, identity: identity("invoice") } });
  const copy = await db.ctx.db.get("copy");
  assert.ok(copy.separateFrom.includes("receipt"));
  assert.equal((await db.ctx.db.get("state")).expenses.length, 2);
  await db.run(documents.rematch, { serviceToken: "test-service", id: "receipt" });
  assert.equal((await db.ctx.db.get("receipt")).status, "unmatched");
});

test("manual grouping refuses conflicting accounting links or companies", async () => {
  for (const changes of [{ expenseId: "other-expense" }, { entity: "lmd" }]) {
    const db = await uncertainPair();
    await db.ctx.db.patch("receipt", changes);
    await assert.rejects(db.run(documents.resolvePurchase, { serviceToken: "test-service", id: "receipt", otherId: "document", decision: "same" }), /different expenses|company/);
    assert.notEqual((await db.ctx.db.get("receipt")).purchaseId, (await db.ctx.db.get("document")).purchaseId);
  }
  const db = await uncertainPair();
  await assert.rejects(db.run(documents.resolvePurchase, { serviceToken: "wrong", id: "receipt", otherId: "document", decision: "same" }), /Unauthorized/);
});

test("matching a grouped purchase once updates every original", async () => {
  process.env.CONVEX_SERVICE_TOKEN = "test-service";
  const db = setup([]);
  await db.run(documents.complete, { id: "document", token: "lease", extraction: { ...extraction, identity: identity("invoice") } });
  await db.ctx.db.insert("financialDocuments", { ...doc(), _id: "receipt", storageId: "receipt-blob" });
  await db.run(documents.complete, { id: "receipt", token: "lease", extraction: { ...extraction, documentNumber: "9999-8888", identity: identity("receipt") } });
  db.tables.set("bankTransactions", [tx("tx-1")]);
  await db.run(documents.confirmMatch, { serviceToken: "test-service", id: "document", transactionId: "tx-1" });
  assert.equal((await db.ctx.db.get("receipt")).transactionId, "tx-1");
  assert.equal((await db.ctx.db.get("receipt")).status, "matched");
  assert.equal((await db.ctx.db.get("state")).expenses.length, 1);
});

async function recheckSetup() {
  const db = await uncertainPair();
  await db.ctx.db.patch("receipt", { referenceVersion: undefined });
  await db.ctx.db.insert("documentRechecks", { _id: "recheck", key: "purchase-references-v1", runId: "run", status: "running", cursor: "2", exhausted: true,
    currentId: "receipt", token: "check", attempts: 1, checked: 0, skipped: 0, failed: 0, startedAt: "2026-10-08", updatedAt: "2026-10-08" });
  return db;
}

test("historical reference check adds supporting files without changing financial values or payment state", async () => {
  const db = await recheckSetup();
  const original = (await db.ctx.db.get("state")).expenses[0];
  original.paymentStatus = "paid"; original.paidAt = "2026-09-01"; original.vatAmount = 3; original.netAmount = 17;
  await db.ctx.db.patch("state", { expenses: [original], paymentAllocations: [{ id: "saved-allocation" }] });
  await db.run(referenceChecks.complete, { runId: "run", token: "check", extraction: { ...extraction, documentNumber: "9999-8888", identity: identity("receipt") } });
  const ledger = await db.ctx.db.get("state"), result = ledger.expenses[0];
  assert.equal(ledger.expenses.length, 1); assert.equal(result.documents.length, 2);
  for (const field of ["grossAmount", "vatAmount", "netAmount", "paymentStatus", "paidAt", "transactionId", "id"]) assert.equal(result[field], original[field], field);
  assert.deepEqual(ledger.paymentAllocations, [{ id: "saved-allocation" }]);
  assert.equal((await db.ctx.db.get("receipt")).referenceVersion, 1);
  assert.equal((await db.ctx.db.get("recheck")).checked, 1);
});

test("reference check discrepancies preserve good data and report failure", async () => {
  const db = await recheckSetup();
  const before = await db.ctx.db.get("receipt"), ledger = await db.ctx.db.get("state");
  await db.run(referenceChecks.complete, { runId: "run", token: "check", extraction: { ...extraction, amount: 999, identity: identity("receipt") } });
  const after = await db.ctx.db.get("receipt");
  assert.deepEqual(after.extraction, before.extraction); assert.equal(after.referenceVersion, undefined);
  assert.match(after.referenceError, /disagrees/); assert.deepEqual(await db.ctx.db.get("state"), ledger);
  assert.equal((await db.ctx.db.get("recheck")).failed, 1);
});

test("historical rechecks do not create expenses for unrecorded documents", async () => {
  const db = await recheckSetup();
  await db.ctx.db.patch("state", { expenses: [] });
  await db.ctx.db.patch("document", { expenseId: undefined, transactionId: undefined, status: "needs_review" });
  await db.run(referenceChecks.complete, { runId: "run", token: "check", extraction: { ...extraction, identity: identity("receipt") } });
  assert.equal((await db.ctx.db.get("state")).expenses.length, 0);
});

test("reference jobs deduplicate starts, serialize requests, and reject expired completions", async () => {
  process.env.CONVEX_SERVICE_TOKEN = "test-service";
  const db = setup();
  await db.run(documents.complete, { id: "document", token: "lease", extraction });
  assert.deepEqual(await db.run(referenceChecks.start, { serviceToken: "test-service" }), { started: true });
  assert.deepEqual(await db.run(referenceChecks.start, { serviceToken: "test-service" }), { started: false });
  const job = db.tables.get("documentRechecks")![0];
  assert.equal(await db.run(referenceChecks.claim, { runId: job.runId, token: "first" }), "document");
  assert.equal(await db.run(referenceChecks.claim, { runId: job.runId, token: "concurrent" }), null);
  await db.run(referenceChecks.complete, { runId: job.runId, token: "expired", extraction: { ...extraction, identity: identity("invoice") } });
  assert.equal((await db.ctx.db.get("document")).referenceVersion, undefined);
  await db.run(referenceChecks.recover, { runId: job.runId, token: "first", error: "Rate limited", retryAfterMs: 60_000 });
  assert.equal(await db.run(referenceChecks.claim, { runId: job.runId, token: "too-soon" }), null);
  await db.ctx.db.patch(job._id, { leaseUntil: 0 });
  assert.equal(await db.run(referenceChecks.claim, { runId: job.runId, token: "retry" }), "document");
  await db.ctx.db.patch(job._id, { attempts: 3 });
  await db.run(referenceChecks.recover, { runId: job.runId, token: "retry", error: "Failed after three attempts" });
  assert.equal((await db.ctx.db.get(job._id)).failed, 1);
  assert.match((await db.ctx.db.get("document")).referenceError, /three attempts/);
});
