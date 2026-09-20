import assert from "node:assert/strict";
import test from "node:test";
import * as documents from "../convex/documents";
import type { DocumentExtraction } from "../shared/financialDocuments";

// A small indexed database harness exercises the registered mutation handlers.
type Row = Record<string, any>;
function database(initial: Record<string, Row[]> = {}) {
  const tables = new Map(Object.entries(initial)); let counter = 0;
  const scheduled: unknown[] = [], deletedFiles: string[] = [];
  const ctx = {
    db: {
      query(table: string) {
        let rows = tables.get(table) ?? [];
        const builder = {
          withIndex(_index: string, select?: (q: any) => unknown) {
            const conditions: Array<(row: Row) => boolean> = [];
            const q = { eq(field: string, value: unknown) { conditions.push(row => row[field] === value); return q; }, gte(field: string, value: number) { conditions.push(row => row[field] >= value); return q; }, lte(field: string, value: number | string) { conditions.push(row => row[field] <= value); return q; } };
            select?.(q); rows = rows.filter(row => conditions.every(check => check(row))); return builder;
          }, async first() { return rows[0] ?? null; }, async unique() { assert.ok(rows.length <= 1); return rows[0] ?? null; }, async take(count: number) { return rows.slice(0, count); }
        }; return builder;
      },
      async get(id: string): Promise<Row> { const row = [...tables.values()].flat().find(row => row._id === id); if (!row) return null as unknown as Row; return row; },
      async patch(id: string, patch: Row) { const row = await ctx.db.get(id); assert.ok(row, id); Object.assign(row, patch); },
      async insert(table: string, value: Row) { const row = { _id: `${table}:${++counter}`, _creationTime: Date.now(), ...value }; tables.set(table, [...(tables.get(table) ?? []), row]); return row._id; },
      async delete(id: string) { for (const [table, rows] of tables) tables.set(table, rows.filter(row => row._id !== id)); },
      system: { async get(id: string) { return { _id: id, size: 100, sha256: "a".repeat(64) }; } }
    },
    storage: { async delete(id: string) { deletedFiles.push(id); }, async getUrl(id: string) { return `https://storage.example/${id}`; } },
    scheduler: { async runAfter(...args: unknown[]) { scheduled.push(args); } }
  };
  const run = (fn: unknown, args: Row) => (fn as { _handler: (ctx: unknown, args: Row) => Promise<any> })._handler(ctx, args);
  return { ctx, tables, scheduled, deletedFiles, run };
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
  (await db.ctx.db.get("state")).invoices = [{ id: "invoice-1", invoiceNumber: "ACME-101", customerName: "Acme", currency: "USD", amount: 20, entity: "dn", transactionId: "tx-1", status: "open" }];
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
  (await db.ctx.db.get("state")).invoices = [{ id: "invoice-1", invoiceNumber: "ACME-101", customerName: "Acme", currency: "USD", amount: 20, entity: "dn", transactionId: "tx-1", status: "open" }];
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
  const candidates = await db.run(documents.candidates, { serviceToken: "test-service", id: "document" });
  assert.equal(candidates.length, 1); assert.equal(candidates[0].matchKind, "foreign_currency");
  assert.equal(candidates[0].cardLastFour, "1029"); assert.equal(candidates[0].cardHolderName, "Test Cardholder");
  assert.equal((await db.ctx.db.get("state")).expenses.length, 0);
  const changedCompany = await db.run(documents.candidates, { serviceToken: "test-service", id: "document", extraction: { ...receipt, counterparty: "Other" } });
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
    assert.deepEqual(await db.run(documents.candidates, { serviceToken: "test-service", id: "document" }), []);
    await assert.rejects(db.run(documents.confirmMatch, { serviceToken: "test-service", id: "document", transactionId: "amex-1", confirmCurrencyConversion: true }), /no longer fits/);
  }
  const { db, receipt } = amexSetup();
  await db.run(documents.complete, { id: "document", token: "lease", extraction: receipt });
  await db.ctx.db.insert("financialDocuments", { ...doc(), _id: "other-document", transactionId: "amex-1", expenseId: "other-expense", status: "matched" });
  assert.deepEqual(await db.run(documents.candidates, { serviceToken: "test-service", id: "document" }), []);
  await assert.rejects(db.run(documents.confirmMatch, { serviceToken: "test-service", id: "document", transactionId: "amex-1", confirmCurrencyConversion: true }), /already claimed/);
});

test("a receipt and invoice for the same expense share its confirmed Amex link", async () => {
  const { db, receipt } = amexSetup();
  await db.run(documents.complete, { id: "document", token: "lease", extraction: receipt });
  await db.run(documents.confirmMatch, { serviceToken: "test-service", id: "document", transactionId: "amex-1", confirmCurrencyConversion: true });
  await db.ctx.db.insert("financialDocuments", { ...doc(), _id: "second", storageId: "second-blob", fileName: "invoice.pdf" });
  await db.run(documents.complete, { id: "second", token: "lease", extraction: { ...receipt, entity: null } });
  const choices = await db.run(documents.candidates, { serviceToken: "test-service", id: "second", extraction: receipt });
  assert.equal(choices.length, 1);
  await db.run(documents.review, { serviceToken: "test-service", id: "second", extraction: receipt });
  const second = await db.ctx.db.get("second"), first = await db.ctx.db.get("document"), ledger = await db.ctx.db.get("state");
  assert.equal(second.transactionId, first.transactionId); assert.equal(second.expenseId, first.expenseId); assert.equal(second.status, "matched");
  assert.equal(ledger.expenses.length, 1); assert.equal(ledger.expenses[0].documents.length, 2);
  assert.equal(ledger.expenses[0].paymentStatus, "unpaid");
});
