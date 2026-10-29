import { fullStatementManagement } from "./statementAccess";
import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { mutation, query, internalMutation, internalQuery, type QueryCtx, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { mailboxProvider, mailboxView } from "./statementMailboxSchema";
import { mailboxScanDate, type MailProvider } from "../shared/statementMailboxes";
import { normalizeStatementActor, statementCompanies } from "../shared/statements";
const auth = { serviceToken: v.string(), actor: v.string() };
const claimArgs = { id: v.id("statementMailboxes"), token: v.string() };
export const mailboxConfigured = (provider: MailProvider) => Boolean(process.env[provider === "gmail" ? "GMAIL_CLIENT_ID" : "OUTLOOK_CLIENT_ID"] && process.env[provider === "gmail" ? "GMAIL_CLIENT_SECRET" : "OUTLOOK_CLIENT_SECRET"] && /^[a-f0-9]{64}$/i.test(process.env.MAILBOX_ENCRYPTION_KEY ?? ""));
async function member(ctx: QueryCtx | MutationCtx, actor: string) {
  const normalized = normalizeStatementActor(actor), row = await ctx.db.query("statementMembers").withIndex("by_actor", q => q.eq("actor", normalized)).unique();
  if (!row || !fullStatementManagement(row)) throw new ConvexError("Full Statements management access is required for mailbox connections");
  return normalized;
}
async function access(ctx: QueryCtx | MutationCtx, args: { serviceToken: string; actor: string }) {
  if (!process.env.CONVEX_SERVICE_TOKEN || args.serviceToken !== process.env.CONVEX_SERVICE_TOKEN) throw new ConvexError("Unauthorized");
  return member(ctx, args.actor);
}
async function lease(ctx: QueryCtx | MutationCtx, id: Id<"statementMailboxes">, token: string) {
  const row = await ctx.db.get(id);
  if (!row || row.leaseToken !== token || row.leaseUntil <= Date.now() || row.state !== "scanning") throw new ConvexError("Mailbox scan stopped or expired");
  await member(ctx, row.actor);
  return row;
}
export const status = query({ args: auth, returns: v.object({ providers: v.object({ gmail: v.boolean(), outlook: v.boolean() }), mailboxes: v.array(mailboxView) }), handler: async (ctx, args) => {
  await access(ctx, args);
  const rows = await ctx.db.query("statementMailboxes").take(101);
  if (rows.length > 100) throw new ConvexError("Mailbox limit exceeded");
  return { providers: { gmail: mailboxConfigured("gmail"), outlook: mailboxConfigured("outlook") }, mailboxes: rows.map(({ _id: id, provider, email, actor, scanFrom, state, scanned, imported, skipped, issues, latestIssue, error, lastCompletedAt, completedThrough, nextRunAt }) => ({ id, provider, email, actor, scanFrom, state, scanned, imported, skipped, issues, latestIssue, error, lastCompletedAt, completedThrough, nextRunAt })) };
} });
export const begin = mutation({ args: { ...auth, provider: mailboxProvider, hash: v.string(), verifier: v.string(), scanFrom: v.string() }, returns: v.string(), handler: async (ctx, args) => {
  const actor = await access(ctx, args);
  if (!mailboxConfigured(args.provider)) throw new ConvexError(`${args.provider === "gmail" ? "Google" : "Microsoft"} app setup is required before connecting mailboxes`);
  const scanFrom = mailboxScanDate(args.scanFrom);
  if (!/^[a-f0-9]{64}$/.test(args.hash) || !/^[A-Za-z0-9_-]{43,128}$/.test(args.verifier)) throw new ConvexError("Invalid mailbox authorization request");
  for (const row of await ctx.db.query("statementMailboxStates").withIndex("by_expiresAt", q => q.lt("expiresAt", Date.now())).take(100)) await ctx.db.delete(row._id);
  await ctx.db.insert("statementMailboxStates", { hash: args.hash, provider: args.provider, actor, scanFrom, verifier: args.verifier, expiresAt: Date.now() + 10 * 60_000 });
  return process.env[args.provider === "gmail" ? "GMAIL_CLIENT_ID" : "OUTLOOK_CLIENT_ID"]!;
} });
export const consume = internalMutation({ args: { ...auth, provider: mailboxProvider, hash: v.string() }, returns: v.object({ scanFrom: v.string(), verifier: v.string() }), handler: async (ctx, args) => {
  const actor = await access(ctx, args), row = await ctx.db.query("statementMailboxStates").withIndex("by_hash", q => q.eq("hash", args.hash)).unique();
  if (!row || row.expiresAt <= Date.now() || row.actor !== actor || row.provider !== args.provider) throw new ConvexError("Mailbox authorization expired; connect again");
  await ctx.db.delete(row._id);
  return { scanFrom: row.scanFrom, verifier: row.verifier };
} });
export const connected = internalMutation({ args: { ...auth, provider: mailboxProvider, accountId: v.string(), email: v.string(), scanFrom: v.string(), encryptedTokens: v.string(), expiresAt: v.number() }, returns: v.null(), handler: async (ctx, args) => {
  const actor = await access(ctx, args), now = Date.now();
  const existing = await ctx.db.query("statementMailboxes").withIndex("by_provider_and_accountId", q => q.eq("provider", args.provider).eq("accountId", args.accountId)).unique();
  if (!existing && (await ctx.db.query("statementMailboxes").take(100)).length >= 100) throw new ConvexError("At most 100 mailboxes can be connected");
  const scanFrom = mailboxScanDate(args.scanFrom);
  const fields = { provider: args.provider, accountId: args.accountId, email: args.email, actor, scanFrom, encryptedTokens: args.encryptedTokens, expiresAt: args.expiresAt, state: "queued" as const, nextRunAt: now, leaseToken: undefined, leaseUntil: 0, attempts: 0, windowFrom: Date.parse(scanFrom), windowTo: now, cursor: undefined, completedThrough: undefined, lastCompletedAt: undefined, lastReconciledAt: undefined, error: undefined, createdAt: existing?.createdAt ?? now, lastRequestedAt: now, scanned: existing?.scanned ?? 0, imported: existing?.imported ?? 0, skipped: existing?.skipped ?? 0, issues: existing?.issues ?? 0 };
  const id = existing ? existing._id : await ctx.db.insert("statementMailboxes", fields);
  if (existing) await ctx.db.patch(id, fields);
  await ctx.db.insert("statementAudit", { entityType: "mailbox", entityId: id, actor, action: "connected", details: `${args.provider}: ${args.email}; scan from ${scanFrom}; automatic AI analysis approved`, createdAt: new Date().toISOString() });
  await ctx.scheduler.runAfter(0, internal.statementMailboxSync.pump, {});
  return null;
} });
export const update = mutation({ args: { ...auth, id: v.id("statementMailboxes"), action: v.union(v.literal("disconnect"), v.literal("scan")), scanFrom: v.optional(v.string()) }, returns: v.null(), handler: async (ctx, args) => {
  const actor = await access(ctx, args), row = await ctx.db.get(args.id), now = Date.now();
  if (!row) throw new ConvexError("Mailbox not found");
  if (args.action === "disconnect") await ctx.db.patch(row._id, { state: "disconnected", encryptedTokens: undefined, expiresAt: 0, leaseToken: undefined, leaseUntil: 0, cursor: undefined, error: undefined, nextRunAt: Number.MAX_SAFE_INTEGER });
  else {
    if (!row.encryptedTokens || row.state === "reconnect") throw new ConvexError("Reconnect this mailbox first");
    if (row.leaseUntil > now) throw new ConvexError("A mailbox scan is already running");
    if (row.nextRunAt > now && row.error && row.state !== "failed") throw new ConvexError("The provider requested a delay; wait until the next attempt");
    if (now - row.lastRequestedAt < 60_000) throw new ConvexError("Wait one minute before requesting another scan");
    const scanFrom = mailboxScanDate(args.scanFrom ?? row.scanFrom);
    await ctx.db.patch(row._id, { scanFrom, windowFrom: Date.parse(scanFrom), windowTo: now, cursor: undefined, completedThrough: undefined, state: "queued", nextRunAt: now, attempts: 0, error: undefined, lastRequestedAt: now });
    await ctx.scheduler.runAfter(0, internal.statementMailboxSync.pump, {});
  }
  await ctx.db.insert("statementAudit", { entityType: "mailbox", entityId: row._id, actor, action: args.action, details: args.scanFrom ?? "", createdAt: new Date().toISOString() });
  return null;
} });
export const due = internalQuery({ args: {}, returns: v.array(v.id("statementMailboxes")), handler: async ctx => (await ctx.db.query("statementMailboxes").withIndex("by_nextRunAt", q => q.lte("nextRunAt", Date.now())).take(20)).map(row => row._id) });
export const claim = internalMutation({ args: claimArgs, returns: v.union(v.string(), v.null()), handler: async (ctx, args) => {
  const row = await ctx.db.get(args.id), now = Date.now();
  if (!row || !row.encryptedTokens || ["failed", "reconnect", "disconnected"].includes(row.state) || row.nextRunAt > now || row.leaseUntil > now) return null;
  try { await member(ctx, row.actor); } catch { await ctx.db.patch(row._id, { state: "disconnected", encryptedTokens: undefined, nextRunAt: Number.MAX_SAFE_INTEGER, leaseUntil: 0, leaseToken: undefined }); return null; }
  const daily = !row.lastReconciledAt || row.lastReconciledAt < now - 86_400_000;
  const window = row.state === "connected" ? { windowFrom: Math.max(Date.parse(row.scanFrom), (row.completedThrough ?? now) - (daily ? 7 * 86_400_000 : 60 * 60_000)), windowTo: now, cursor: undefined, ...(daily ? { lastReconciledAt: now } : {}) } : {};
  const fields = { ...window, state: "scanning" as const, leaseToken: args.token, leaseUntil: now + 8 * 60_000, nextRunAt: now + 8 * 60_000 };
  await ctx.db.patch(row._id, fields);
  return JSON.stringify({ ...row, ...fields });
} });
export const saveTokens = internalMutation({ args: { ...claimArgs, encryptedTokens: v.string(), expiresAt: v.number() }, returns: v.null(), handler: async (ctx, args) => { await lease(ctx, args.id, args.token); await ctx.db.patch(args.id, { encryptedTokens: args.encryptedTokens, expiresAt: args.expiresAt }); return null; } });
export const seen = internalQuery({ args: { ...claimArgs, providerId: v.string() }, returns: v.boolean(), handler: async (ctx, args) => { await lease(ctx, args.id, args.token); return Boolean(await ctx.db.query("statementMailboxMessages").withIndex("by_mailboxId_and_providerId", q => q.eq("mailboxId", args.id).eq("providerId", args.providerId)).unique()); } });
// Document creation and provider-message checkpoint are one transaction. A stale
// action cannot import after disconnect, and a replay never schedules duplicate AI.
export const record = internalMutation({ args: { ...claimArgs, providerId: v.string(), sender: v.string(), subject: v.string(), receivedAt: v.string(), sourceContext: v.string(), emailRawStorageId: v.optional(v.id("_storage")), issue: v.optional(v.string()), files: v.array(v.object({ storageId: v.id("_storage"), contentHash: v.string(), fileName: v.string(), size: v.number() })) }, returns: v.null(), handler: async (ctx, args) => {
  const row = await lease(ctx, args.id, args.token);
  if (args.files.length > 10 || args.sourceContext.length > 12000 || args.subject.length > 500 || args.providerId.length > 1000 || args.files.some(file => !/^[a-f0-9]{64}$/.test(file.contentHash) || file.size <= 0 || file.size > 15 * 1024 * 1024 || file.fileName.length > 240)) throw new ConvexError("Invalid mailbox document batch");
  const previous = await ctx.db.query("statementMailboxMessages").withIndex("by_mailboxId_and_providerId", q => q.eq("mailboxId", args.id).eq("providerId", args.providerId)).unique();
  if (previous) { for (const file of args.files) await ctx.storage.delete(file.storageId); return null; }
  const ids: Id<"statementDocuments">[] = []; let imported = 0;
  for (const file of args.files) {
    const existing = await ctx.db.query("statementDocuments").withIndex("by_contentHash", q => q.eq("contentHash", file.contentHash)).unique();
    if (existing) { await ctx.storage.delete(file.storageId); ids.push(existing._id); continue; }
    const now = new Date().toISOString();
    const id = await ctx.db.insert("statementDocuments", { ...file, contentType: "application/pdf", origin: "email", status: "queued", documentType: "unknown", sourceContext: args.sourceContext, emailRawStorageId: args.emailRawStorageId, sender: args.sender, subject: args.subject, messageId: `${row.provider}:${row.accountId}:${args.providerId}`.slice(0, 1000), receivedAt: args.receivedAt, evidence: [], reviewReasons: ["Imported from a connected mailbox; verify extracted fields against the original"], attempts: 0, quarantined: false, transactionIds: [], createdAt: now, updatedAt: now });
    ids.push(id); imported++;
    await ctx.db.insert("statementAudit", { entityType: "document", entityId: id, actor: row.actor, action: "mailbox_import", details: `${row.provider}: ${row.email}`, createdAt: now });
    await ctx.scheduler.runAfter(0, internal.statementProcessing.processDocument, { id });
  }
  await ctx.db.insert("statementMailboxMessages", { mailboxId: row._id, providerId: args.providerId, documents: ids, emailRawStorageId: args.emailRawStorageId, issue: args.issue?.slice(0, 500), processedAt: Date.now() });
  await ctx.db.patch(row._id, { scanned: row.scanned + 1, imported: row.imported + imported, skipped: row.skipped + (ids.length ? 0 : 1), issues: row.issues + (args.issue ? 1 : 0), ...(args.issue ? { latestIssue: `${args.subject || "Email"}: ${args.issue}`.slice(0, 500) } : {}) });
  return null;
} });
export const checkpoint = internalMutation({ args: { ...claimArgs, cursor: v.optional(v.string()) }, returns: v.null(), handler: async (ctx, args) => {
  const row = await lease(ctx, args.id, args.token), now = Date.now();
  await ctx.db.patch(row._id, { cursor: args.cursor, state: args.cursor ? "queued" : "connected", leaseToken: undefined, leaseUntil: 0, attempts: 0, error: undefined, nextRunAt: now + (args.cursor ? 3000 : 5 * 60_000), ...(!args.cursor ? { completedThrough: row.windowTo, lastCompletedAt: now } : {}) });
  if (args.cursor) await ctx.scheduler.runAfter(3000, internal.statementMailboxSync.scan, { id: row._id });
  return null;
} });
export const failed = internalMutation({ args: { ...claimArgs, message: v.string(), reconnect: v.boolean(), delay: v.number(), resetCursor: v.optional(v.boolean()) }, returns: v.null(), handler: async (ctx, args) => {
  const row = await ctx.db.get(args.id);
  if (!row || row.leaseToken !== args.token) return null;
  const attempts = row.attempts + 1, stopped = args.reconnect || attempts >= 5;
  await ctx.db.patch(row._id, { state: args.reconnect ? "reconnect" : stopped ? "failed" : "queued", error: args.message.slice(0, 500), attempts, leaseToken: undefined, leaseUntil: 0, nextRunAt: stopped ? Number.MAX_SAFE_INTEGER : Date.now() + Math.max(args.delay, 60_000 * 2 ** (attempts - 1)), ...(args.resetCursor ? { cursor: undefined } : {}) });
  return null;
} });
export const cleanupUploads = internalMutation({ args: { files: v.array(v.object({ storageId: v.id("_storage"), contentHash: v.string() })) }, returns: v.null(), handler: async (ctx, args) => {
  for (const file of args.files) {
    const document = await ctx.db.query("statementDocuments").withIndex("by_contentHash", q => q.eq("contentHash", file.contentHash)).unique();
    if (document?.storageId !== file.storageId) await ctx.storage.delete(file.storageId);
  }
  return null;
} });
