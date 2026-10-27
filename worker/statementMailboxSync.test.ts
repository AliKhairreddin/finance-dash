import assert from "node:assert/strict";
import test, { after, mock } from "node:test";
// Convex schedules cleanup for twelve minutes later. Virtual timers keep those
// persisted jobs testable without retaining real timers in the test process.
mock.timers.enable({ apis: ["setTimeout"] });
after(() => mock.timers.reset());
import { convexTest } from "convex-test";
import { v } from "convex/values";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { internalAction } from "../convex/_generated/server";
import { statementCompanies } from "../shared/statements";
import { mailboxEncrypt, mailboxDecrypt } from "../shared/mailboxHttp";
process.env.CONVEX_SERVICE_TOKEN = "mailbox-sync-test";
process.env.GMAIL_CLIENT_ID = "app"; process.env.GMAIL_CLIENT_SECRET = "secret"; process.env.OUTLOOK_CLIENT_ID = "app"; process.env.OUTLOOK_CLIENT_SECRET = "secret"; process.env.MAILBOX_ENCRYPTION_KEY = "ab".repeat(32);
const modules = {
  "../convex/_generated/server.ts": () => import("../convex/_generated/server"),
  "../convex/statementMailboxes.ts": () => import("../convex/statementMailboxes"),
  "../convex/statementMailboxSync.ts": async () => ({ ...await import("../convex/statementMailboxSync"), pump: internalAction({ args: {}, returns: v.null(), handler: async () => null }) }),
  "../convex/statementProcessing.ts": async () => ({ processDocument: internalAction({ args: { id: v.id("statementDocuments") }, returns: v.null(), handler: async () => null }) })
};
async function setup(provider: "gmail" | "outlook") {
  const t = convexTest(schema, modules), encryptedTokens = await mailboxEncrypt(JSON.stringify({ access_token: "old-access", refresh_token: "old-refresh", expires_in: 3600 }), process.env.MAILBOX_ENCRYPTION_KEY!);
  const id = await t.run(async ctx => {
    await ctx.db.insert("statementMembers", { actor: "Ali", companyIds: statementCompanies.map(c => c.id), manage: true });
    return ctx.db.insert("statementMailboxes", { provider, accountId: "test@example.com", email: "test@example.com", actor: "Ali", scanFrom: "2026-01-01", state: "queued", encryptedTokens, expiresAt: 0, nextRunAt: 0, leaseUntil: 0, attempts: 0, windowFrom: Date.parse("2026-01-01"), windowTo: Date.now(), scanned: 0, imported: 0, skipped: 0, issues: 0, createdAt: Date.now(), lastRequestedAt: 0 });
  }); return { t, id };
}
async function cancelPending(t: ReturnType<typeof convexTest>) {
  await t.run(async ctx => { for (const job of await ctx.db.system.query("_scheduled_functions").collect()) if (job.state.kind === "pending") await ctx.scheduler.cancel(job._id); });
}
const receivedAt = Date.parse("2026-06-01T12:00:00Z");
const raw = "From: billing@example.com\r\nSubject: Your receipt\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nReceipt 123\r\nTotal EUR 19.50";
for (const provider of ["gmail", "outlook"] as const) test(`${provider} refreshes credentials, persists a receipt, and checkpoints a complete page`, async () => {
  const { t, id } = await setup(provider), originalFetch = globalThis.fetch; let rawReads = 0, tokenCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/token")) { tokenCalls++; return Response.json({ access_token: "fresh-access", refresh_token: "rotated-refresh", expires_in: 3600 }); }
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer fresh-access");
    if (url.pathname.endsWith("/messages")) return Response.json(provider === "gmail" ? { messages: [{ id: "message-one" }], resultSizeEstimate: 1 } : { value: [{ id: "message-one" }] });
    if (url.pathname.endsWith("/$value")) { rawReads++; return new Response(raw); }
    if (provider === "gmail") { rawReads++; return Response.json({ raw: Buffer.from(raw).toString("base64url"), internalDate: String(receivedAt) }); }
    return Response.json({ receivedDateTime: new Date(receivedAt).toISOString() });
  };
  try {
    await t.action(internal.statementMailboxSync.scan, { id });
    const row = await t.run(ctx => ctx.db.get(id)); assert.equal(row?.state, "connected"); assert.equal(row?.scanned, 1); assert.equal(row?.imported, 1); assert.ok(row?.completedThrough);
    const credentials = JSON.parse(await mailboxDecrypt(row!.encryptedTokens!, process.env.MAILBOX_ENCRYPTION_KEY!)); assert.equal(credentials.refresh_token, "rotated-refresh");
    const docs = await t.run(ctx => ctx.db.query("statementDocuments").take(10)); assert.equal(docs.length, 1); assert.equal(docs[0].origin, "email"); assert.equal(docs[0].receivedAt, new Date(receivedAt).toISOString());
    await t.run(ctx => ctx.db.patch(id, { nextRunAt: 0 })); await t.action(internal.statementMailboxSync.scan, { id });
    assert.equal(rawReads, 1); assert.equal(tokenCalls, 1);
  } finally { await cancelPending(t); globalThis.fetch = originalFetch; }
});
test("a malformed page cannot mark history complete or erase previous imports", async () => {
  const { t, id } = await setup("gmail"), fetch = globalThis.fetch;
  await t.run(ctx => ctx.db.patch(id, { expiresAt: Date.now() + 3600000, imported: 4, completedThrough: 42 }));
  globalThis.fetch = async () => Response.json({});
  try { await t.action(internal.statementMailboxSync.scan, { id }); const row = await t.run(ctx => ctx.db.get(id)); assert.equal(row?.state, "queued"); assert.equal(row?.imported, 4); assert.equal(row?.completedThrough, 42); assert.ok(row?.error); } finally { await cancelPending(t); globalThis.fetch = fetch; }
});
test("revoked refresh credentials require reconnect without overwriting saved tokens", async () => {
  const { t, id } = await setup("gmail"), fetch = globalThis.fetch, before = await t.run(ctx => ctx.db.get(id));
  globalThis.fetch = async () => new Response("sensitive provider detail", { status: 400 });
  try { await t.action(internal.statementMailboxSync.scan, { id }); const row = await t.run(ctx => ctx.db.get(id)); assert.equal(row?.state, "reconnect"); assert.equal(row?.encryptedTokens, before?.encryptedTokens); assert.doesNotMatch(row?.error ?? "", /sensitive/); } finally { await cancelPending(t); globalThis.fetch = fetch; }
});
test("authorization binds the selected account and reconnecting preserves its existing history", async () => {
  const { t, id } = await setup("gmail"), fetch = globalThis.fetch, hash = "c".repeat(64), auth = { serviceToken: "mailbox-sync-test", actor: "Ali" };
  await t.run(ctx => ctx.db.patch(id, { imported: 3 }));
  await t.mutation(api.statementMailboxes.begin, { ...auth, provider: "gmail", hash, verifier: "v".repeat(64), scanFrom: "2025-01-01" });
  globalThis.fetch = async input => String(input).includes("/token") ? Response.json({ access_token: "a", refresh_token: "r", expires_in: 3600, scope: "https://www.googleapis.com/auth/gmail.readonly" }) : Response.json({ emailAddress: "test@example.com" });
  try { await t.action(api.statementMailboxSync.finish, { ...auth, provider: "gmail", hash, code: "code" }); const view = await t.query(api.statementMailboxes.status, auth); assert.equal(view.mailboxes.length, 1); assert.equal(view.mailboxes[0].scanFrom, "2025-01-01"); assert.equal(view.mailboxes[0].imported, 3); } finally { await cancelPending(t); globalThis.fetch = fetch; }
});
