import assert from "node:assert/strict";
import test from "node:test";
import { getFunctionName } from "convex/server";
import * as topUps from "../convex/topUps";
import { validateTopUpInput, topUpMessage, topUpTransition } from "../shared/topUps";
import { dashboardPageAllowed, dashboardHomePage, topUpReviewerCanAccess } from "../shared/dashboardAccess";
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
            const q = { gt(field: string, value: string) { conditions.push(row => fieldValue(row, field) > value); return q; }, eq(field: string, value: unknown) { conditions.push(row => fieldValue(row, field) === value); return q; }, lt(field: string, value: number) { conditions.push(row => fieldValue(row, field) < value); return q; }, gte(field: string, value: number) { conditions.push(row => fieldValue(row, field) >= value); return q; }, lte(field: string, value: number | string) { conditions.push(row => fieldValue(row, field) <= value); return q; } };
            select?.(q); rows = rows.filter(row => conditions.every(check => check(row))); return builder;
          }, order(_direction: string) { return builder; }, async paginate(options: { cursor: string | null; numItems: number }) { const offset = Number(options.cursor ?? 0); return { page: rows.slice(offset, offset + options.numItems).map(row => read(table, row)), isDone: offset + options.numItems >= rows.length, continueCursor: String(offset + options.numItems) }; }, async first() { return read(table, rows[0] ?? null); }, async unique() { assert.ok(rows.length <= 1); return read(table, rows[0] ?? null); }, async take(count: number) { return rows.slice(0, count).map(row => read(table, row)); }
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

const input = () => ({ submissionId: "12345678-1234-1234-1234-123456789abc", entity: "dn", priority: "Urgent", companyName: "Example Supplier", commission: "3%", team: "Cognitive", member: "Example member", amount: 20800, currency: "USD", openBalance: -11111.38, lastThreeDaysSpend: 1500, expectedThreeDaysSpend: 2000, paymentMethod: "Bank Transfer", wiseLink: "", notes: "", bmNames: ["BM"], accountNames: ["Account"] });
const auth = { serviceToken: "topup-test-token" };
function setup() { process.env.CONVEX_SERVICE_TOKEN = auth.serviceToken; return database({ dashboardState: [{ _id: "state", key: "default", providers: [], teams: [], expenses: [], invoices: [], paymentAllocations: [] }], financialDocuments: [{ _id: "doc", fileName: "invoice.pdf", contentType: "application/pdf" }] }); }
test("both spend forecasts are required USD amounts; expected spend has a 1,000 USD minimum", () => {
  const valid = validateTopUpInput(input()); assert.equal(valid.openBalance, -11111.38);
  assert.equal(validateTopUpInput({ ...input(), lastThreeDaysSpend: 0, expectedThreeDaysSpend: 1000 }).lastThreeDaysSpend, 0);
  for (const field of ["lastThreeDaysSpend", "expectedThreeDaysSpend", "commission", "team", "member", "companyName"]) { const bad: any = input(); delete bad[field]; assert.throws(() => validateTopUpInput(bad)); }
  for (const value of [null, "", -1, Infinity, 1.001]) assert.throws(() => validateTopUpInput({ ...input(), expectedThreeDaysSpend: value }));
  for (const value of [0, 0.01, 999, 999.99]) assert.throws(() => validateTopUpInput({ ...input(), expectedThreeDaysSpend: value }), /at least 1,000 USD/);
  for (const value of [1000, 1000.01]) assert.equal(validateTopUpInput({ ...input(), expectedThreeDaysSpend: value }).expectedThreeDaysSpend, value);
  for (const wiseLink of ["javascript:alert(1)", "https://wise.com.evil.test/pay", "https://user:pass@wise.com/pay"]) assert.throws(() => validateTopUpInput({ ...input(), wiseLink }));
});
test("request creation deduplicates submissions and leaves providers and financial ledgers untouched", async () => {
  const db = setup(); const r = await db.run(topUps.create, { ...auth, input: input(), documentId: "doc" });
  const repeat = await db.run(topUps.create, { ...auth, input: input(), documentId: "doc" }); assert.equal(repeat._id, r._id); assert.equal((db.tables.get("topUpRequests") ?? []).length, 1);
  assert.equal((await db.ctx.db.get("state")).providers.length, 0); assert.equal((await db.ctx.db.get("state")).expenses.length, 0); assert.equal(db.scheduled.length, 1);
});
test("Revolut requests queue an unsent draft on approval; card and crypto payments do not", async () => {
  for (const paymentMethod of ["Revolut", "Bank Transfer", "", "Card", "Crypto"]) {
    const db = setup();
    const saved = await db.run(topUps.create, { ...auth, input: { ...input(), paymentMethod }, documentId: "doc" });
    const approved = await db.run(topUps.transition, { ...auth, id: saved._id, version: 1, action: "approve", actor: "Ali M" });
    const shouldDraft = ["Revolut", "Bank Transfer", ""].includes(paymentMethod);
    assert.equal(approved.draftStatus, shouldDraft ? "queued" : "not_applicable");
    assert.equal(db.scheduled.filter((job: any) => getFunctionName(job[1]) === "topUpProcessing:draft").length, shouldDraft ? 1 : 0);
    assert.equal(approved.amount, saved.amount);
    assert.deepEqual((await db.ctx.db.get("state")).paymentAllocations, []);
  }
});
test("new requests reject the removed Wise payment method with a specific error", async () => {
  const db = setup();
  await assert.rejects(db.run(topUps.create, { ...auth, input: { ...input(), paymentMethod: "Wise" }, documentId: "doc" }), /Select a payment method: Revolut/);
  assert.equal(db.tables.get("topUpRequests"), undefined);
});
test("approval creates a new supplier once; version checks reject duplicate approvals, old buttons, and edits after approval", async () => {
  const db = setup(); const r = await db.run(topUps.create, { ...auth, input: input(), documentId: "doc" });
  const updated = await db.run(topUps.transition, { ...auth, id: r._id, version: 1, action: "adjust", actor: "Amin", amount: 21000 }); assert.equal(updated.originalAmount, 20800); assert.equal(updated.amount, 21000);
  await assert.rejects(db.run(topUps.transition, { ...auth, id: r._id, version: 1, action: "approve", actor: "Amin" }), /changed/);
  const approved = await db.run(topUps.transition, { ...auth, id: r._id, version: 2, action: "approve", actor: "Amin" }); assert.equal(approved.status, "approved"); assert.equal(approved.approvedBy, "Amin");
  assert.equal((await db.ctx.db.get("state")).providers.length, 1); assert.equal(approved.draftStatus, "queued");
  await assert.rejects(db.run(topUps.transition, { ...auth, id: r._id, version: 3, action: "adjust", actor: "Amin", amount: 1 }), /changed/);
  const paid = await db.run(topUps.transition, { ...auth, id: r._id, version: 3, action: "paid", actor: "Ali M" }); assert.equal(paid.status, "paid"); assert.equal(paid.paidBy, "Ali M");
  assert.deepEqual((await db.ctx.db.get("state")).paymentAllocations, []); assert.equal((await db.ctx.db.get("state")).invoices.length, 0);
});
test("an existing provider is reused on approval, including an alias, and the selected canonical name is preserved", async () => {
  const db = setup(); await db.ctx.db.patch("state", { providers: [{ id: "provider", name: "Existing supplier", aliases: ["Example Supplier"] }] });
  const r = await db.run(topUps.create, { ...auth, input: input(), documentId: "doc" }); const approved = await db.run(topUps.transition, { ...auth, id: r._id, version: 1, action: "approve", actor: "Amin" }); assert.equal(approved.providerId, "provider"); assert.equal((await db.ctx.db.get("state")).providers.length, 1);
  await db.ctx.db.insert("financialDocuments", { _id: "doc2", fileName: "second-invoice.pdf", contentType: "application/pdf" });
  const selected = await db.run(topUps.create, { ...auth, input: { ...input(), submissionId: "22345678-1234-1234-1234-123456789abc", providerId: "provider" }, documentId: "doc2" }); assert.equal(selected.companyName, "Existing supplier");
});
test("draft claims prevent concurrent writes and interrupted drafts cannot be retried or marked paid", async () => {
  const db = setup(); const r = await db.run(topUps.create, { ...auth, input: input(), documentId: "doc" }); await db.run(topUps.transition, { ...auth, id: r._id, version: 1, action: "approve", actor: "Amin" });
  assert.equal(await db.run(topUps.claimDraft, { ...auth, id: r._id, token: "one" }), true); assert.equal(await db.run(topUps.claimDraft, { ...auth, id: r._id, token: "two" }), false);
  await db.run(topUps.draftResult, { ...auth, id: r._id, token: "two", status: "created", draftId: "wrong" }); assert.equal((await db.ctx.db.get(r._id)).draftId, undefined);
  await db.run(topUps.recoverDraft, { id: r._id, token: "one" }); assert.equal((await db.ctx.db.get(r._id)).draftStatus, "uncertain");
  assert.equal(await db.run(topUps.claimDraft, { ...auth, id: r._id, token: "three" }), false);
  await assert.rejects(db.run(topUps.transition, { ...auth, id: r._id, version: 2, action: "paid", actor: "Ali M" }), /changed/);
});
test("rate limits are durable and bounded; expired windows reset", async () => {
  const db = setup(); assert.equal(await db.run(topUps.rateLimit, { ...auth, key: "test-ip-hash", limit: 2 }), true); assert.equal(await db.run(topUps.rateLimit, { ...auth, key: "test-ip-hash", limit: 2 }), true); assert.equal(await db.run(topUps.rateLimit, { ...auth, key: "test-ip-hash", limit: 2 }), false);
  const row = db.tables.get("topUpRateLimits")![0]; row.expiresAt = 0; assert.equal(await db.run(topUps.rateLimit, { ...auth, key: "test-ip-hash", limit: 2 }), true);
});
test("delivery leases deduplicate jobs, persist failure states and recover interruptions", async () => {
  const db = setup(); const r = await db.run(topUps.create, { ...auth, input: input(), documentId: "doc" });
  assert.equal(await db.run(topUps.claimDelivery, { id: r._id, version: 1, token: "one" }), true); assert.equal(await db.run(topUps.claimDelivery, { id: r._id, version: 1, token: "two" }), false);
  await db.run(topUps.deliveryResult, { id: r._id, version: 1, token: "one", error: "Telegram unavailable" }); assert.equal((await db.ctx.db.get(r._id)).notificationError, "Telegram unavailable");
  assert.equal(await db.run(topUps.claimDelivery, { id: r._id, version: 1, token: "three" }), true); await db.run(topUps.recoverDelivery, { id: r._id, version: 1, token: "three" }); assert.match((await db.ctx.db.get(r._id)).notificationError, /interrupted/);
});
test("Alaa's role exposes only Top-up requests and Documents and blocks bank data and approval endpoints", () => {
  assert.equal(dashboardHomePage("top-up-reviewer"), "top-ups"); for (const page of ["top-ups", "documents"]) assert.equal(dashboardPageAllowed("top-up-reviewer", page), true);
  for (const page of ["overview", "banks", "invoices", "providers", "settings", "redtrack"]) assert.equal(dashboardPageAllowed("top-up-reviewer", page), false);
  for (const path of ["/api/top-ups", "/api/top-ups/summary", "/api/top-ups/abc/invoice", "/api/documents"]) assert.equal(topUpReviewerCanAccess(new Request(`https://finance.test${path}`)), true);
  for (const path of ["/api/dashboard", "/api/transactions", "/api/top-ups/abc/draft-options"]) assert.equal(topUpReviewerCanAccess(new Request(`https://finance.test${path}`)), false);
  for (const path of ["/api/top-ups/abc/action", "/api/top-ups/abc/draft", "/api/top-ups/abc/delete", "/api/top-ups/abc/restore", "/api/sync"]) assert.equal(topUpReviewerCanAccess(new Request(`https://finance.test${path}`, { method: "POST" })), false);
});
test("Telegram message includes both USD spend fields, signed balance, and status", () => {
  const text = topUpMessage({ ...input(), number: 352, status: "pending", createdAt: "2026-10-17T20:09:40Z" } as any, "https://finance.test/invoice", "@AminGhossein");
  for (const expected of ["New Topup Request #352", "-11,111.38 USD", "Last 3 days spend: 1,500 USD", "Expected next 3 days spend: 2,000 USD", "Status: Pending", "@AminGhossein"]) assert.ok(text.includes(expected), expected);
  assert.match(text, /📉 Last 3 days spend: 1,500 USD\n\n📈 Expected next 3 days spend: 2,000 USD/);
  assert.throws(() => topUpTransition("pending", "paid", "queued"));
});

test("distinct submissions can reuse an invoice, including an invoice on a deleted request", async () => {
  const db = setup(); const original = await db.run(topUps.create, { ...auth, input: input(), documentId: "doc" });
  const second = await db.run(topUps.create, { ...auth, input: { ...input(), submissionId: "22345678-1234-1234-1234-123456789abc" }, documentId: "doc" });
  assert.notEqual(original._id, second._id); assert.notEqual(original.number, second.number);
  await db.run(topUps.setDeleted, { ...auth, id: original._id, version: 1, deleted: true, actor: "Ali" });
  const third = await db.run(topUps.create, { ...auth, input: { ...input(), submissionId: "32345678-1234-1234-1234-123456789abc" }, documentId: "doc" });
  assert.equal(third.documentId, original.documentId); assert.equal(db.tables.get("topUpRequests")?.length, 3);
});
test("interrupted draft reconciliation requires a checked result and preserves the approval", async () => { const db = setup(); const r = await db.run(topUps.create, { ...auth, input: input(), documentId: "doc" }); await db.run(topUps.transition, { ...auth, id: r._id, version: 1, action: "approve", actor: "Amin" }); await db.ctx.db.patch(r._id, { draftStatus: "uncertain" }); await assert.rejects(db.run(topUps.reconcileDraft, { ...auth, id: r._id, actor: "Ali M", confirmedNoDraft: false }), /Check Revolut/); await db.run(topUps.reconcileDraft, { ...auth, id: r._id, actor: "Ali M", confirmedNoDraft: true }); const saved = await db.ctx.db.get(r._id); assert.equal(saved.draftStatus, "needs_review"); assert.equal(saved.status, "approved"); });

test("deleting is recoverable, excludes active counts, invalidates actions and keeps invoice and ledger intact", async () => {
  const db = setup(), r = await db.run(topUps.create, { ...auth, input: input(), documentId: "doc" });
  await db.run(topUps.adjustmentPrompt, { ...auth, id: r._id, version: 1, promptId: 44, userId: "333" });
  const state = await db.ctx.db.get("state"), doc = await db.ctx.db.get("doc"); db.resetIo();
  const removed = await db.run(topUps.setDeleted, { ...auth, id: r._id, version: 1, deleted: true, actor: "Ali" });
  assert.equal(removed.deletedBy, "Ali"); assert.ok(removed.deletedAt); assert.equal(removed.version, 2); assert.equal(removed.events.at(-1).action, "deleted");
  assert.equal(db.io.ledgerReads + db.io.ledgerWrites, 0);
  assert.deepEqual(await db.ctx.db.get("state"), state); assert.deepEqual(await db.ctx.db.get("doc"), doc); assert.deepEqual(db.deletedFiles, []);
  assert.deepEqual(await db.run(topUps.summary, auth), { pending: 0, approved: 0, capped: false });
  const pageArgs = { ...auth, paginationOpts: { cursor: null, numItems: 20 } };
  assert.deepEqual((await db.run(topUps.list, pageArgs)).page, []);
  assert.equal((await db.run(topUps.deletedList, pageArgs)).page[0]._id, r._id);
  for (const version of [1, 2]) await assert.rejects(db.run(topUps.transition, { ...auth, id: r._id, version, action: "approve", actor: "Amin" }), /changed/);
  assert.equal(await db.run(topUps.findAdjustment, { ...auth, promptId: 44, userId: "333" }), null);
  await assert.rejects(db.run(topUps.adjustmentPrompt, { ...auth, id: r._id, version: 2, promptId: 45, userId: "333" }), /changed/);
  await assert.rejects(db.run(topUps.setDeleted, { ...auth, id: r._id, version: 1, deleted: false, actor: "Ali" }), /changed/);
  const restored = await db.run(topUps.setDeleted, { ...auth, id: r._id, version: 2, deleted: false, actor: "Ali" });
  assert.equal(restored.deletedAt, undefined); assert.equal(restored.status, "pending"); assert.equal(restored.version, 3);
  assert.equal((await db.run(topUps.summary, auth)).pending, 1);
  assert.equal(db.tables.get("topUpDeliveries")?.find(d => d.version === 2)?.deletedSnapshot, undefined);
  assert.equal((db.tables.get("topUpDeliveries") ?? []).length, 3);
});
test("deletion and draft claims exclude one another; existing drafts are retained for review", async () => {
  const db = setup(), r = await db.run(topUps.create, { ...auth, input: input(), documentId: "doc" });
  await db.run(topUps.transition, { ...auth, id: r._id, version: 1, action: "approve", actor: "Amin" });
  await db.run(topUps.setDeleted, { ...auth, id: r._id, version: 2, deleted: true, actor: "Ali" });
  assert.equal(await db.run(topUps.claimDraft, { ...auth, id: r._id, token: "blocked" }), false);
  await db.run(topUps.setDeleted, { ...auth, id: r._id, version: 3, deleted: false, actor: "Ali" });
  assert.equal(await db.run(topUps.claimDraft, { ...auth, id: r._id, token: "active" }), true);
  for (const draftStatus of ["creating", "uncertain"]) { await db.ctx.db.patch(r._id, { draftStatus }); await assert.rejects(db.run(topUps.setDeleted, { ...auth, id: r._id, version: 4, deleted: true, actor: "Ali" }), /reconcile/); }
  await db.ctx.db.patch(r._id, { draftStatus: "created", draftId: "existing-draft" });
  const removed = await db.run(topUps.setDeleted, { ...auth, id: r._id, version: 4, deleted: true, actor: "Ali" });
  assert.equal(removed.draftId, "existing-draft");
  await assert.rejects(db.run(topUps.setDeleted, { ...auth, serviceToken: "wrong", id: r._id, version: 5, deleted: false, actor: "Ali" }), /Unauthorized/);
});

test("direct request creation rejects expected spend below 1,000 USD before saving anything", async () => {
  const db = setup();
  await assert.rejects(db.run(topUps.create, { ...auth, input: { ...input(), expectedThreeDaysSpend: 999.99 }, documentId: "doc" }), /at least 1,000 USD/);
  assert.equal(db.tables.get("topUpRequests"), undefined); assert.equal(db.tables.get("topUpDeliveries"), undefined); assert.equal(db.scheduled.length, 0);
});

const cryptoInput = (currency = "USDC", amount = 100) => {
  const { entity, commission, openBalance, lastThreeDaysSpend, expectedThreeDaysSpend, ...base } = input();
  return { ...base, currency, amount, paymentMethod: "Crypto", network: currency === "BTC" ? "Bitcoin" : "Ethereum", walletAddress: "0x1234567890123456789012345678901234567890" };
};
test("crypto requests omit ad spend fields and accept fractional crypto amounts", () => {
  for (const [currency, amount] of [["USDC", 0.000001], ["USDT", 100.123456], ["BTC", 0.00000001]] as const) {
    const valid = validateTopUpInput(cryptoInput(currency, amount));
    assert.equal(valid.amount, amount); assert.equal(valid.currency, currency);
    for (const field of ["entity", "commission", "openBalance", "lastThreeDaysSpend", "expectedThreeDaysSpend"]) assert.ok(!(field in valid));
  }
  for (const bad of [{ walletAddress: "" }, { team: "" }, { walletAddress: "wallet with spaces" }, { paymentMethod: "Bank Transfer" }, { amount: 0 }, { amount: 0.0000001 }]) assert.throws(() => validateTopUpInput({ ...cryptoInput(), ...bad }));
  assert.throws(() => validateTopUpInput(cryptoInput("BTC", 0.000000001)));
});
test("crypto requests save without an invoice, follow approval/payment status, and never queue a bank draft", async () => {
  const db = setup(); const saved = await db.run(topUps.create, { ...auth, input: cryptoInput("BTC", 0.00001234) });
  assert.equal(saved.documentId, undefined); assert.equal(saved.draftStatus, "not_applicable");
  const adjusted = await db.run(topUps.transition, { ...auth, id: saved._id, version: 1, action: "adjust", amount: 0.00002345, actor: "Ali" });
  assert.equal(adjusted.amount, 0.00002345);
  const approved = await db.run(topUps.transition, { ...auth, id: saved._id, version: 2, action: "approve", actor: "Ali M" });
  assert.equal(approved.status, "approved"); assert.equal(approved.draftStatus, "not_applicable");
  assert.equal((await db.ctx.db.get("state")).providers.length, 0);
  assert.equal(await db.run(topUps.claimDraft, { ...auth, id: saved._id, token: "never" }), false);
  const paid = await db.run(topUps.transition, { ...auth, id: saved._id, version: 3, action: "paid", actor: "Ali M" });
  assert.equal(paid.status, "paid"); assert.equal(paid.amount, adjusted.amount);
  await assert.rejects(db.run(topUps.create, { ...auth, input: { ...input(), submissionId: "22345678-1234-1234-1234-123456789abc" } }), /Upload an invoice/);
});
test("crypto Telegram messages show wallet, network and full precision without ad spend or absent invoice links", () => {
  const text = topUpMessage({ ...cryptoInput("BTC", 0.00001234), number: 3, status: "pending", createdAt: "2026-10-22T12:00:00Z" } as any, "", "@AminGhossein");
  for (const expected of ["Purchase Request #3", "0.00001234 BTC", "Network: Bitcoin", "Wallet: 0x", "Cognitive →", "@AminGhossein"]) assert.ok(text.includes(expected), expected);
  assert.doesNotMatch(text, /Open Balance|days spend|Commission|View Invoice/);
});

test("purchase requests accept an optional network and another cryptocurrency without sender or ad spend fields", () => {
  const valid = validateTopUpInput({ ...cryptoInput("ETH", 0.12345678), network: "" });
  assert.equal(valid.currency, "ETH"); assert.equal(valid.network, ""); assert.equal(valid.entity, undefined);
  assert.equal(valid.team, "Cognitive");
  assert.throws(() => validateTopUpInput({ ...input(), entity: undefined }), /Select Send From/);
});
test("member suggestions come from the selected team's saved requests and omit deleted requests", async () => {
  const db = setup();
  await db.run(topUps.create, { ...auth, input: { ...input(), member: "Mehul" }, documentId: "doc" });
  await db.run(topUps.create, { ...auth, input: { ...input(), member: "Alex", team: "Wagner", submissionId: "22345678-1234-1234-1234-123456789abc" }, documentId: "doc" });
  const result = await db.run(topUps.options, { ...auth, search: "", team: "Cognitive" });
  assert.deepEqual(result.members, ["Mehul"]);
  const row = db.tables.get("topUpRequests")![0];
  await db.run(topUps.setDeleted, { ...auth, id: row._id, version: 1, deleted: true, actor: "Ali" });
  assert.deepEqual((await db.run(topUps.options, { ...auth, search: "", team: "Cognitive" })).members, []);
});
