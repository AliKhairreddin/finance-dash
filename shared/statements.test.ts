import assert from "node:assert/strict";
import test from "node:test";
import { statementCompanies, statementAmountMinor, statementAmountDecimal, validateStatementInput, matchStatementCompany, parseStatementCsv, statementIdentity, type StatementTransactionInput, type StatementCard } from "./statements";
import * as backend from "../convex/statements";

const input = (overrides: Partial<StatementTransactionInput> = {}): StatementTransactionInput => ({ companyId: "artec", date: "2026-10-01", description: "Office supplies", source: "Test bank", account: "Account one", amount: "12.34", currency: "EUR", direction: "out", ...overrides });
test("statement companies and exact money keep currencies and precision separate", () => {
  assert.deepEqual(statementCompanies.map(company => company.name), ["AMG Holding", "Artec", "Inch Engineering", "Digital Nudge", "Inch Digital", "MZS Bouw"]);
  assert.equal(BigInt(statementAmountMinor("0.10", "EUR")) + BigInt(statementAmountMinor("0.20", "EUR")), 30n);
  assert.equal(statementAmountMinor("1.234", "KWD"), "1234");
  assert.equal(statementAmountMinor("0.00000001", "BTC"), "1");
  assert.equal(statementAmountDecimal("-1234", "EUR"), "-12.34");
  assert.throws(() => statementAmountMinor("1.01", "JPY"), /decimal/);
  assert.throws(() => statementAmountMinor("1e3", "EUR"), /exact amount/);
  assert.throws(() => validateStatementInput(input({ date: "2026-02-30" })), /date/);
  assert.throws(() => validateStatementInput(input({ amount: "0" })), /greater than zero/);
});
test("card company evidence is scoped, conflicting and never a reconciliation", () => {
  const cards: StatementCard[] = [{ _id: "one", companyId: "artec", lastFour: "0440", label: "Artec", active: true }, { _id: "two", companyId: "amg-holding", lastFour: "0440", label: "Other", active: true }];
  const row = validateStatementInput(input({ companyId: undefined, cardLastFour: "0440" }));
  const ambiguous = matchStatementCompany(row, cards);
  assert.equal(ambiguous.companyId, undefined); assert.match(ambiguous.reviewReasons.join(), /Conflicting/);
  assert.equal(matchStatementCompany(row, [cards[0]]).companyId, "artec");
  assert.equal(matchStatementCompany(row, [cards[0]], "amg-holding").companyId, undefined);
  assert.equal(matchStatementCompany(validateStatementInput(input({ companyId: undefined, description: "Invoice 0440" })), [cards[0]]).companyId, undefined);
  assert.equal("status" in ambiguous, false);
});
test("CSV mapping distinguishes invalid rows and permits explicitly unmapped columns", () => {
  const text = 'Date;Description;Amount;Currency;Reference\n2026-10-01;"Vendor; supplies";-12.34;EUR;INV1\n2026-02-30;Invalid;-3;EUR;INV2';
  const parsed = parseStatementCsv(text, { source: "Bank", companyId: "artec" }, { reference: "" });
  assert.equal(parsed.rows.length, 1); assert.equal(parsed.rows[0].description, "Vendor; supplies");
  assert.equal(parsed.rows[0].direction, "out"); assert.equal(parsed.rows[0].reference, undefined);
  assert.equal(parsed.errors.length, 1); assert.match(parsed.errors[0], /Row 3/);
  assert.equal(statementIdentity(parsed.rows[0]), undefined);
  assert.throws(() => parseStatementCsv('Date,Date,Amount\n2026-10-01,2026-10-01,1'), /duplicate headers/);
  assert.throws(() => parseStatementCsv('Date,Description,Amount\n2026-10-01,"broken,1'), /unclosed/);
});

const handler = (fn: object) => {
  const run: unknown = Reflect.get(fn, "_handler");
  if (typeof run !== "function") throw new Error("Missing handler");
  return (ctx: unknown, args: unknown): Promise<any> => run(ctx, args);
};
function memory() {
  const tables = new Map<string, Array<Record<string, any>>>();
  const table = (name: string) => { if (!tables.has(name)) tables.set(name, []); return tables.get(name)!; };
  const scheduled: unknown[] = [], deletedFiles: string[] = [];
  const ctx = {
    db: {
      query(name: string) {
        const conditions: Array<(row: Record<string, any>) => boolean> = [];
        const range = { eq(key: string, value: unknown) { conditions.push(row => row[key] === value); return range; }, gte(key: string, value: any) { conditions.push(row => row[key] >= value); return range; }, lte(key: string, value: any) { conditions.push(row => row[key] <= value); return range; } };
        const selected = () => table(name).filter(row => conditions.every(condition => condition(row)));
        const query = { withIndex(_name: string, fn?: (q: typeof range) => unknown) { fn?.(range); return query; }, order() { return query; }, unique: async () => { const rows = selected(); assert.ok(rows.length <= 1); return rows[0] ?? null; }, first: async () => selected()[0] ?? null, take: async (limit: number) => selected().slice(0, limit), paginate: async ({ cursor, numItems }: { cursor?: string | null; numItems: number }) => { const start = Number(cursor ?? 0), rows = selected(); return { page: rows.slice(start, start + numItems), continueCursor: String(start + numItems), isDone: start + numItems >= rows.length }; } };
        return query;
      },
      get: async (id: string) => [...tables.values()].flat().find(row => row._id === id) ?? null,
      insert: async (name: string, value: Record<string, unknown>) => { const id = `${name}:${table(name).length}`; table(name).push({ ...value, _id: id, _creationTime: Date.now() }); return id; },
      patch: async (id: string, value: Record<string, unknown>) => { const row = [...tables.values()].flat().find(row => row._id === id); assert.ok(row); Object.assign(row, value); },
      delete: async (id: string) => { for (const rows of tables.values()) { const index = rows.findIndex(row => row._id === id); if (index >= 0) rows.splice(index, 1); } }
    },
    storage: { delete: async (id: string) => { deletedFiles.push(id); }, getUrl: async (id: string) => `https://storage.example/${id}`, generateUploadUrl: async () => "https://storage.example/upload" },
    scheduler: { runAfter: async (...args: unknown[]) => { scheduled.push(args); } }
  };
  return { ctx, table, scheduled, deletedFiles, tables };
}
const auth = { serviceToken: "statement-test-token", actor: "Ali" };
async function fixture() {
  process.env.CONVEX_SERVICE_TOKEN = auth.serviceToken;
  const result = memory();
  result.table("bankTransactions").push({ _id: "legacy-bank", amount: 999 });
  result.table("dashboardState").push({ _id: "existing-dashboard", invoices: [{ id: "preserve-invoice" }], aiSettings: { provider: "openrouter", model: "test/model" } });
  await handler(backend.initialize)(result.ctx, auth); return result;
}
test("module initialization is idempotent and enforces actors and company isolation", async () => {
  const { ctx, table } = await fixture(); await handler(backend.initialize)(ctx, auth);
  assert.equal(table("statementMembers").length, 3); assert.deepEqual(table("statementCards").map(row => row.lastFour), ["5196", "4440", "6805"]);
  await assert.rejects(handler(backend.bootstrap)(ctx, { ...auth, actor: "Mallory" }), /cannot access/);
  await assert.rejects(handler(backend.bootstrap)(ctx, { ...auth, serviceToken: "invalid" }), /Unauthorized/);
  const [id] = await handler(backend.createTransactions)(ctx, { ...auth, requestId: "valid-request-000001", rows: [input({ companyId: "amg-holding" })] });
  table("statementMembers").find(row => row.actor === "Ali")!.companyIds = ["artec"];
  await assert.rejects(handler(backend.updateTransaction)(ctx, { ...auth, id, expectedRevision: 1, fields: input() }), /access/);
  const result = await handler(backend.listTransactions)(ctx, auth); assert.equal(result.transactions.length, 0);
  const doc = await handler(backend.ingestDocument)(ctx, { serviceToken: auth.serviceToken, storageId: "file", contentHash: "a".repeat(64), fileName: "mixed.pdf", contentType: "application/pdf", size: 500, origin: "email", quarantined: true });
  await assert.rejects(handler(backend.getDocument)(ctx, { ...auth, id: doc.id }), /access/);
  assert.deepEqual(table("bankTransactions"), [{ _id: "legacy-bank", amount: 999 }]);
  assert.equal(table("dashboardState")[0].invoices[0].id, "preserve-invoice");
  await assert.rejects(handler(backend.saveCard)(ctx, { ...auth, companyId: "artec", lastFour: "1003", label: "excluded", active: true }), /valid card/);
});
test("manual request replay is idempotent while weak duplicates stay visible and provider conflicts fail", async () => {
  const { ctx, table } = await fixture();
  const command = { ...auth, requestId: "valid-request-000001", rows: [input()] };
  const [first] = await handler(backend.createTransactions)(ctx, command); assert.deepEqual(await handler(backend.createTransactions)(ctx, command), [first]);
  await assert.rejects(handler(backend.createTransactions)(ctx, { ...command, rows: [input({ amount: "50" })] }), /different transaction details/);
  const [second] = await handler(backend.createTransactions)(ctx, { ...command, requestId: "valid-request-000002" });
  assert.notEqual(first, second); assert.match(table("statementTransactions")[1].reviewReasons.join(), /Possible duplicate/);
  const providerCommand = { ...command, requestId: "valid-request-000003", rows: [input({ providerId: "provider-123" })] };
  const [stable] = await handler(backend.createTransactions)(ctx, providerCommand);
  assert.deepEqual(await handler(backend.createTransactions)(ctx, { ...providerCommand, requestId: "valid-request-000004" }), [stable]);
  await assert.rejects(handler(backend.createTransactions)(ctx, { ...providerCommand, requestId: "valid-request-000005", rows: [input({ providerId: "provider-123", amount: "99" })] }), /conflicting financial/);
  assert.equal(table("statementTransactions").length, 3);
});
test("imports block invalid rows and resume committed bounded batches without duplicating", async () => {
  const { ctx, table } = await fixture();
  const rows = Array.from({ length: 105 }, (_, i) => validateStatementInput(input({ providerId: `row-${i}`, description: `Row ${i}` })));
  const id = await handler(backend.stageImport)(ctx, { ...auth, fileName: "statement.csv", contentHash: "b".repeat(64), companyId: "artec", origin: "file", rows, reviewReasons: [], errors: ["Row 9 invalid"], storageId: "original-csv" });
  await assert.rejects(handler(backend.confirmImport)(ctx, { ...auth, id, reviewed: true }), /invalid row/);
  assert.equal(table("statementTransactions").length, 0);
  await handler(backend.updateImport)(ctx, { ...auth, id, rows, errors: [], reviewReasons: [] });
  await assert.rejects(handler(backend.confirmImport)(ctx, { ...auth, id, reviewed: false }), /Review/);
  await handler(backend.confirmImport)(ctx, { ...auth, id, reviewed: true });
  assert.equal(await handler(backend.processImportBatch)(ctx, { id }), false); assert.equal(table("statementTransactions").length, 50);
  await handler(backend.failImport)(ctx, { id, error: "Interrupted" });
  await handler(backend.confirmImport)(ctx, { ...auth, id, reviewed: true });
  await handler(backend.processImportBatch)(ctx, { id }); await handler(backend.processImportBatch)(ctx, { id });
  assert.equal(table("statementTransactions").length, 105); assert.equal(table("statementImports")[0].status, "imported");
  assert.equal(await handler(backend.processImportBatch)(ctx, { id }), true); assert.equal(table("statementTransactions").length, 105);
  const detail = await handler(backend.getImport)(ctx, { ...auth, id }); assert.equal("storageId" in detail, false);
  const list = await handler(backend.listImports)(ctx, auth); assert.equal(list.imports[0].transactionCount, 105); assert.equal("rows" in list.imports[0], false);
});
test("quarantined emails preserve originals and lease tokens reject stale processing", async () => {
  const { ctx, table, deletedFiles } = await fixture();
  const command = { serviceToken: auth.serviceToken, storageId: "pdf1", emailRawStorageId: "shared-email", contentHash: "c".repeat(64), fileName: "invoice.pdf", contentType: "application/pdf", size: 500, origin: "email", quarantined: false, sender: "unknown@example.com" };
  const { id } = await handler(backend.ingestDocument)(ctx, command);
  assert.equal(await handler(backend.claimDocument)(ctx, { serviceToken: auth.serviceToken, id }), null);
  await assert.rejects(handler(backend.retryDocument)(ctx, { ...auth, id }), /Explicit approval/);
  await handler(backend.retryDocument)(ctx, { ...auth, id, releaseQuarantine: true });
  const claim = await handler(backend.claimDocument)(ctx, { serviceToken: auth.serviceToken, id }); assert.ok(claim.attemptToken);
  assert.equal(await handler(backend.claimDocument)(ctx, { serviceToken: auth.serviceToken, id }), null);
  table("statementDocuments")[0].leaseUntil = 0;
  const recovered = await handler(backend.claimDocument)(ctx, { serviceToken: auth.serviceToken, id }); assert.notEqual(recovered.attemptToken, claim.attemptToken);
  await handler(backend.completeDocument)(ctx, { serviceToken: auth.serviceToken, id, attemptToken: claim.attemptToken, documentType: "invoice", evidence: [], reviewReasons: [], extracted: '{}' });
  assert.equal(table("statementDocuments")[0].status, "processing");
  await handler(backend.completeDocument)(ctx, { serviceToken: auth.serviceToken, id, attemptToken: recovered.attemptToken, documentType: "invoice", evidence: [], reviewReasons: [], extracted: '{"amount":"100","currency":"EUR"}' });
  assert.equal(table("statementTransactions").length, 0, "An invoice cannot create a bank transaction");
  await handler(backend.ingestDocument)(ctx, { ...command, storageId: "pdf2" });
  assert.deepEqual(deletedFiles, ["pdf2"], "A duplicate attachment must never remove shared raw email provenance");
});
test("reviewed allocations enforce document totals, currency, completion and reopening", async () => {
  const { ctx, table } = await fixture();
  const { id: docId } = await handler(backend.ingestDocument)(ctx, { ...auth, storageId: "invoice", contentHash: "d".repeat(64), fileName: "invoice.pdf", contentType: "application/pdf", size: 500, origin: "file", companyId: "artec", quarantined: false });
  const claim = await handler(backend.claimDocument)(ctx, { serviceToken: auth.serviceToken, id: docId });
  await handler(backend.completeDocument)(ctx, { serviceToken: auth.serviceToken, id: docId, attemptToken: claim.attemptToken, companyId: "artec", documentType: "invoice", evidence: [], reviewReasons: [], extracted: '{}' });
  await assert.rejects(handler(backend.reviewDocument)(ctx, { ...auth, id: docId, companyId: "artec", documentType: "invoice", reviewed: true }), /amount and currency/);
  await handler(backend.reviewDocument)(ctx, { ...auth, id: docId, companyId: "artec", documentType: "invoice", amount: "100", currency: "EUR", reviewed: true });
  const ids = await handler(backend.createTransactions)(ctx, { ...auth, requestId: "allocation-request-0001", rows: [input({ amount: "70", description: "First payment" }), input({ amount: "40", description: "Second payment" }), input({ amount: "10", currency: "USD", description: "Wrong currency" })] });
  await assert.rejects(handler(backend.transactionActions)(ctx, { ...auth, ids: [ids[0]], action: "complete" }), /Reconcile/);
  await handler(backend.linkDocument)(ctx, { ...auth, id: docId, transactionId: ids[0], amount: "70" });
  await assert.rejects(handler(backend.linkDocument)(ctx, { ...auth, id: docId, transactionId: ids[1], amount: "40" }), /document's remaining amount/);
  await handler(backend.linkDocument)(ctx, { ...auth, id: docId, transactionId: ids[1], amount: "30" });
  await assert.rejects(handler(backend.transactionActions)(ctx, { ...auth, ids: [ids[1]], action: "reconcile" }), /complete transaction amount/);
  await assert.rejects(handler(backend.linkDocument)(ctx, { ...auth, id: docId, transactionId: ids[2], amount: "10" }), /currencies must match/);
  await handler(backend.transactionActions)(ctx, { ...auth, ids: [ids[0]], action: "reconcile" });
  await handler(backend.transactionActions)(ctx, { ...auth, ids: [ids[0]], action: "complete" });
  assert.equal(table("statementTransactions")[0].status, "completed");
  await handler(backend.transactionActions)(ctx, { ...auth, ids: [ids[0]], action: "reopen", reason: "Correct evidence" });
  assert.equal(table("statementTransactions")[0].status, "pending");
  assert.equal(table("dashboardState")[0].invoices[0].id, "preserve-invoice");
});

test("company conflicts stay unassigned and Retry-After prevents premature retries", async () => {
  const { ctx, table } = await fixture();
  const { id } = await handler(backend.ingestDocument)(ctx, { ...auth, storageId: "conflict", contentHash: "e".repeat(64), fileName: "conflict.pdf", contentType: "application/pdf", size: 500, origin: "file", companyId: "artec", quarantined: false });
  const claim = await handler(backend.claimDocument)(ctx, { serviceToken: auth.serviceToken, id });
  await handler(backend.failDocument)(ctx, { serviceToken: auth.serviceToken, id, attemptToken: claim.attemptToken, error: "Rate limited", retryAfterMs: 60_000 });
  assert.equal(table("statementDocuments")[0].status, "queued");
  await assert.rejects(handler(backend.retryDocument)(ctx, { ...auth, id }), /rate limited/);
  assert.equal(await handler(backend.claimDocument)(ctx, { serviceToken: auth.serviceToken, id }), null);
  await handler(backend.callbackFailed)(ctx, { id, error: "Old callback timed out" });
  assert.equal(table("statementDocuments")[0].status, "queued", "A stale callback must preserve Retry-After scheduling");
  table("statementDocuments")[0].leaseUntil = 0;
  const retry = await handler(backend.claimDocument)(ctx, { serviceToken: auth.serviceToken, id });
  await handler(backend.completeDocument)(ctx, { serviceToken: auth.serviceToken, id, attemptToken: retry.attemptToken, documentType: "invoice", evidence: [], reviewReasons: ["Conflicting card companies"], extracted: '{}' });
  assert.equal(table("statementDocuments")[0].companyId, undefined, "A conflicting extraction must not restore upload company context");
});

test("mixed statement row owners remain distinct and original files require full access", async () => {
  const { ctx, table } = await fixture();
  const rows = [validateStatementInput(input({ companyId: "artec" })), validateStatementInput(input({ companyId: "amg-holding", description: "Other owner" }))];
  const id = await handler(backend.stageImport)(ctx, { ...auth, fileName: "mixed.csv", contentHash: "f".repeat(64), origin: "file", rows, reviewReasons: [], errors: [], storageId: "mixed-original" });
  assert.equal(table("statementImports")[0].companyId, undefined);
  assert.deepEqual(table("statementImports")[0].rows.map((row: any) => row.companyId), ["artec", "amg-holding"]);
  table("statementMembers").find(row => row.actor === "Ali")!.companyIds = ["artec"];
  await assert.rejects(handler(backend.getImportFile)(ctx, { ...auth, id }), /access/);
  const listed = await handler(backend.listImports)(ctx, auth); assert.equal(listed.imports.length, 0);
});
