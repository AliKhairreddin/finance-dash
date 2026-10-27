import assert from "node:assert/strict";
import test from "node:test";
import { convexTest } from "convex-test";
import { v } from "convex/values";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { internalAction } from "../convex/_generated/server";
import { statementCompanies } from "../shared/statements";
process.env.CONVEX_SERVICE_TOKEN = "mailbox-test";
process.env.GMAIL_CLIENT_ID = "test-client"; process.env.GMAIL_CLIENT_SECRET = "test-secret"; process.env.MAILBOX_ENCRYPTION_KEY = "ab".repeat(32);
const auth = { serviceToken: "mailbox-test", actor: "Ali" };
const modules = {
  "../convex/_generated/server.ts": () => import("../convex/_generated/server"),
  "../convex/statementMailboxes.ts": () => import("../convex/statementMailboxes"),
  "../convex/statementMailboxSync.ts": async () => ({ pump: internalAction({ args: {}, returns: v.null(), handler: async () => null }), scan: internalAction({ args: { id: v.id("statementMailboxes") }, returns: v.null(), handler: async () => null }) }),
  "../convex/statementProcessing.ts": async () => ({ processDocument: internalAction({ args: { id: v.id("statementDocuments") }, returns: v.null(), handler: async () => null }) })
};
async function setup() {
  const t = convexTest(schema, modules);
  const id = await t.run(async ctx => {
    for (const actor of ["Ali", "Ali M"] as const) await ctx.db.insert("statementMembers", { actor, companyIds: statementCompanies.map(c => c.id), manage: true });
    await ctx.db.insert("statementMembers", { actor: "Alaa", companyIds: ["artec"], manage: true });
    return ctx.db.insert("statementMailboxes", { provider: "gmail", accountId: "boss@workspace.example", email: "boss@workspace.example", actor: "Ali", scanFrom: "2026-01-01", state: "queued", encryptedTokens: "encrypted", expiresAt: Date.now() + 3600000, nextRunAt: 0, leaseUntil: 0, attempts: 0, windowFrom: Date.parse("2026-01-01"), windowTo: Date.now(), scanned: 0, imported: 0, skipped: 0, issues: 0, createdAt: Date.now(), lastRequestedAt: 0 });
  }); return { t, id };
}
test("mailbox status and control require full Statements membership and never expose credentials", async () => {
  const { t, id } = await setup();
  for (const denied of [{ ...auth, actor: "Alaa" }, { ...auth, serviceToken: "wrong" }]) {
    await assert.rejects(t.query(api.statementMailboxes.status, denied)); await assert.rejects(t.mutation(api.statementMailboxes.update, { ...denied, id, action: "disconnect" }));
  }
  const view = await t.query(api.statementMailboxes.status, auth); assert.equal(view.mailboxes.length, 1); assert.doesNotMatch(JSON.stringify(view), /encrypted|test-secret|leaseToken|refresh_token/);
});
test("OAuth state is actor/provider bound, expires, and can be used once", async () => {
  const { t } = await setup(), hash = "a".repeat(64);
  await t.mutation(api.statementMailboxes.begin, { ...auth, provider: "gmail", hash, verifier: "v".repeat(64), scanFrom: "2026-01-01" });
  for (const input of [{ ...auth, actor: "Ali M", provider: "gmail" as const }, { ...auth, provider: "outlook" as const }]) await assert.rejects(t.mutation(internal.statementMailboxes.consume, { ...input, hash }));
  assert.equal((await t.mutation(internal.statementMailboxes.consume, { ...auth, provider: "gmail", hash })).scanFrom, "2026-01-01");
  await assert.rejects(t.mutation(internal.statementMailboxes.consume, { ...auth, provider: "gmail", hash }));
  await t.mutation(api.statementMailboxes.begin, { ...auth, provider: "gmail", hash, verifier: "v".repeat(64), scanFrom: "2026-01-01" });
  await t.run(async ctx => { const state = await ctx.db.query("statementMailboxStates").first(); await ctx.db.patch(state!._id, { expiresAt: 0 }); });
  await assert.rejects(t.mutation(internal.statementMailboxes.consume, { ...auth, provider: "gmail", hash }));
});
test("leases serialize scans; disconnect immediately fences stale work and erases credentials", async () => {
  const { t, id } = await setup();
  assert.ok(await t.mutation(internal.statementMailboxes.claim, { id, token: "one" }));
  assert.equal(await t.mutation(internal.statementMailboxes.claim, { id, token: "two" }), null);
  await t.mutation(api.statementMailboxes.update, { ...auth, id, action: "disconnect" });
  await assert.rejects(t.mutation(internal.statementMailboxes.saveTokens, { id, token: "one", encryptedTokens: "new", expiresAt: Date.now() }));
  await assert.rejects(t.mutation(internal.statementMailboxes.checkpoint, { id, token: "one" }));
  const row = await t.run(ctx => ctx.db.get(id)); assert.equal(row?.encryptedTokens, undefined); assert.equal(row?.state, "disconnected");
});
test("email/document checkpoints deduplicate retries and shared attachments without financial writes", async () => {
  const { t, id } = await setup(); await t.mutation(internal.statementMailboxes.claim, { id, token: "one" });
  const file = async () => ({ storageId: await t.run(ctx => ctx.storage.store(new Blob(["%PDF-fixture"]))), contentHash: "a".repeat(64), fileName: "receipt.pdf", size: 12 });
  const input = { id, token: "one", providerId: "message-1", sender: "supplier@example.com", subject: "Receipt", receivedAt: new Date().toISOString(), sourceContext: "Receipt", files: [await file()] };
  await t.mutation(internal.statementMailboxes.record, input);
  await t.mutation(internal.statementMailboxes.record, { ...input, files: [await file()] });
  await t.mutation(internal.statementMailboxes.record, { ...input, providerId: "message-2", files: [await file()] });
  const state = await t.run(async ctx => ({ mailbox: await ctx.db.get(id), documents: await ctx.db.query("statementDocuments").take(10), transactions: await ctx.db.query("statementTransactions").take(10) }));
  assert.equal(state.documents.length, 1); assert.equal(state.documents[0].quarantined, false); assert.equal(state.documents[0].status, "queued"); assert.equal(state.transactions.length, 0); assert.equal(state.mailbox?.scanned, 2); assert.equal(state.mailbox?.imported, 1);
  assert.equal(await t.query(internal.statementMailboxes.seen, { id, token: "one", providerId: "message-1" }), true);
});
test("partial failures preserve scan coverage and retry deadlines; retries are bounded", async () => {
  const { t, id } = await setup();
  await t.run(ctx => ctx.db.patch(id, { cursor: "saved-cursor", completedThrough: 100, imported: 7 }));
  for (let i = 0; i < 5; i++) {
    await t.run(ctx => ctx.db.patch(id, { nextRunAt: 0 }));
    assert.ok(await t.mutation(internal.statementMailboxes.claim, { id, token: String(i) }));
    await t.mutation(internal.statementMailboxes.failed, { id, token: String(i), message: "rate limited", reconnect: false, delay: 120000 });
  }
  const row = await t.run(ctx => ctx.db.get(id)); assert.equal(row?.state, "failed"); assert.equal(row?.cursor, "saved-cursor"); assert.equal(row?.completedThrough, 100); assert.equal(row?.imported, 7);
  assert.equal(await t.mutation(internal.statementMailboxes.claim, { id, token: "six" }), null);
});
test("freshness and explicit history scans reuse records and enforce rate-limit delays", async () => {
  const { t, id } = await setup(); await t.mutation(internal.statementMailboxes.claim, { id, token: "one" });
  await t.mutation(internal.statementMailboxes.checkpoint, { id, token: "one" });
  assert.equal(await t.mutation(internal.statementMailboxes.claim, { id, token: "two" }), null);
  await t.mutation(api.statementMailboxes.update, { ...auth, id, action: "scan", scanFrom: "2025-01-01" });
  const row = await t.run(ctx => ctx.db.get(id)); assert.equal(row?.scanFrom, "2025-01-01"); assert.equal(row?.windowFrom, Date.parse("2025-01-01"));
  await assert.rejects(t.mutation(api.statementMailboxes.update, { ...auth, id, action: "scan" }));
});
