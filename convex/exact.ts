import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { query, mutation, internalQuery, internalMutation, type QueryCtx, type MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { exactData, exactKind, exactCompanyFields, exactDatasetFields, exactRecordFields } from "./exactSchema";
import { statementActor } from "./statementSchema";
import { exactKinds, exactResources, exactDeleteKinds, exactWritePayload, exactGuid, type ExactWriteKind, type ExactKind } from "../shared/exact";
import { normalizeStatementActor, statementCompanies } from "../shared/statements";

const auth = { serviceToken: v.string(), actor: v.string() };
function service(token: string) { if (!process.env.CONVEX_SERVICE_TOKEN || token !== process.env.CONVEX_SERVICE_TOKEN) throw new ConvexError("Unauthorized"); }
async function access(ctx: QueryCtx | MutationCtx, args: { serviceToken: string; actor: string }) {
  service(args.serviceToken);
  const actor = normalizeStatementActor(args.actor);
  const member = await ctx.db.query("statementMembers").withIndex("by_actor", q => q.eq("actor", actor)).unique();
  // Exact is an explicitly shared accounting workspace for these three full-access members.
  if (!member?.manage || !statementCompanies.every(c => member.companyIds.includes(c.id))) throw new ConvexError("Full Statements access is required for Exact");
  return actor;
}
const connection = (ctx: QueryCtx | MutationCtx) => ctx.db.query("exactConnections").withIndex("by_key", q => q.eq("key", "primary")).unique();
const dataset = (ctx: QueryCtx | MutationCtx, division: number, kind: ExactKind) => ctx.db.query("exactDatasets").withIndex("by_division_and_kind", q => q.eq("division", division).eq("kind", kind)).unique();
async function company(ctx: QueryCtx | MutationCtx, division: number) {
  const row = await ctx.db.query("exactCompanies").withIndex("by_division", q => q.eq("division", division)).unique();
  if (!row?.active) throw new ConvexError("This company is not authorized for Exact");
  return row;
}
async function lease(ctx: MutationCtx, token: string) {
  const row = await connection(ctx);
  if (!row || row.leaseToken !== token || row.leaseUntil < Date.now()) throw new ConvexError("Exact request lease expired");
  return row;
}
const publicDataset = (row: Doc<"exactDatasets">) => ({ division: row.division, kind: row.kind, state: row.state, lastCompletedAt: row.lastCompletedAt, error: row.error, nextRunAt: row.nextRunAt });
const datasetView = v.object({ division: v.number(), kind: exactKind, state: v.string(), lastCompletedAt: v.optional(v.number()), error: v.optional(v.string()), nextRunAt: v.number() });
const configured = () => Boolean(process.env.EXACT_CLIENT_ID && process.env.EXACT_CLIENT_SECRET && process.env.EXACT_ENCRYPTION_KEY);
export const status = query({ args: auth, returns: v.object({ configured: v.boolean(), connected: v.boolean(), state: v.string(), error: v.optional(v.string()), user: v.optional(v.string()), lastDiscoveryAt: v.optional(v.number()), companies: v.array(v.object({ division: v.number(), name: v.string(), code: v.string(), currency: v.string(), active: v.boolean() })), datasets: v.array(datasetView) }), handler: async (ctx, args) => {
  await access(ctx, args); const c = await connection(ctx);
  const companies = await ctx.db.query("exactCompanies").take(1001);
  if (companies.length > 1000) throw new ConvexError("Exact company scope exceeds the supported 1,000-company limit");
  const datasets = await ctx.db.query("exactDatasets").take(14001);
  return { configured: configured(), connected: c?.state === "connected", state: c?.state ?? "not_connected", error: c?.error, user: c?.user, lastDiscoveryAt: c?.lastDiscoveryAt,
    companies: companies.filter(x => x.active).map(({ division, name, code, currency, active }) => ({ division, name, code, currency, active })), datasets: datasets.map(publicDataset) };
} });
export const records = query({ args: { ...auth, division: v.optional(v.number()), kind: exactKind }, returns: v.object({ records: v.array(v.object({ id: v.string(), division: v.number(), kind: exactKind, providerId: v.string(), parentId: v.string(), data: exactData, updatedAt: v.number() })), truncated: v.boolean(), datasets: v.array(datasetView) }), handler: async (ctx, args) => {
  await access(ctx, args); const c = await connection(ctx);
  if (c?.state !== "connected") throw new ConvexError("Connect Exact to access its records");
  if (!c.lastDiscoveryAt || c.lastDiscoveryAt < Date.now() - 26 * 60 * 60 * 1000) throw new ConvexError("Exact company permissions need to be refreshed before viewing records");
  const companies = args.division ? [await company(ctx, args.division)] : (await ctx.db.query("exactCompanies").take(1001)).filter(x => x.active);
  const result: Array<{ id: string; division: number; kind: ExactKind; providerId: string; parentId: string; data: Doc<"exactRecords">["data"]; updatedAt: number }> = [], datasets: ReturnType<typeof publicDataset>[] = [];
  let remaining = 2001, truncated = false;
  for (const co of companies) {
    const ds = await dataset(ctx, co.division, args.kind); if (!ds) continue;
    datasets.push(publicDataset(ds));
    if (ds.state === "access_denied") continue;
    if (remaining <= 0) { truncated = true; continue; }
    const rows = await ctx.db.query("exactRecords").withIndex("by_division_and_kind_and_generation_and_providerId", q => q.eq("division", co.division).eq("kind", args.kind).eq("generation", ds.generation)).take(remaining);
    remaining -= rows.length;
    for (const row of rows) if (!row.deleted && (!["invoices", "purchases"].includes(args.kind) || row.data.LineNumber === 0)) result.push({ id: row._id, division: row.division, kind: row.kind, providerId: row.providerId, parentId: row.parentId, data: row.data, updatedAt: row.updatedAt });
  }
  return { records: result.slice(0, 2000), truncated: truncated || remaining === 0, datasets };
} });
export const resync = mutation({ args: { ...auth, division: v.optional(v.number()), full: v.boolean() }, returns: v.null(), handler: async (ctx, args) => {
  const actor = await access(ctx, args), c = await connection(ctx);
  if (c?.state !== "connected") throw new ConvexError("Connect Exact first");
  if (args.full && c.leaseUntil > Date.now()) throw new ConvexError("A synchronization is in progress. Try again when it finishes");
  if (c.resyncRun) throw new ConvexError("An update is already starting. Please wait");
  if (args.division) await company(ctx, args.division);
  const run = Date.now();
  await ctx.db.patch(c._id, { resyncRun: run });
  await ctx.db.insert("statementAudit", { entityType: "exact", entityId: String(args.division ?? "all"), actor, action: args.full ? "full_reconciliation_requested" : "sync_requested", details: "Company permissions and saved data refresh; 15-minute data freshness limit applies", createdAt: new Date().toISOString() });
  await ctx.scheduler.runAfter(0, internal.exact.resyncBatch, { run, division: args.division, full: args.full, cursor: null }); return null;
} });
export const resyncBatch = internalMutation({ args: { run: v.number(), division: v.optional(v.number()), full: v.boolean(), cursor: v.union(v.string(), v.null()) }, returns: v.null(), handler: async (ctx, args) => {
  const c = await connection(ctx); if (!c || c.resyncRun !== args.run) return null;
  const page = await ctx.db.query("exactDatasets").paginate({ cursor: args.cursor, numItems: 100 });
  for (const ds of page.page) {
    if ((args.division && ds.division !== args.division) || ds.state === "access_removed" || (ds.lastCompletedAt && ds.lastCompletedAt > args.run - 15 * 60_000)) continue;
    const abandoned = args.full ? ds.buildingGeneration : undefined;
    await ctx.db.patch(ds._id, { nextRunAt: Date.now(), state: "queued", error: undefined, attempts: 0, ...(args.full ? { buildingGeneration: crypto.randomUUID(), cursor: "1", nextUrl: undefined, pages: 0 } : {}) });
    if (abandoned) await ctx.scheduler.runAfter(0, internal.exact.cleanGeneration, { division: ds.division, kind: ds.kind, generation: abandoned });
  }
  if (!page.isDone) await ctx.scheduler.runAfter(0, internal.exact.resyncBatch, { ...args, cursor: page.continueCursor });
  else { await ctx.db.patch(c._id, { resyncRun: undefined, lastDiscoveryAt: undefined }); await ctx.scheduler.runAfter(0, internal.exactSync.pump, {}); }
  return null;
} });
export const createOAuthState = mutation({ args: { ...auth, hash: v.string() }, returns: v.null(), handler: async (ctx, args) => {
  const actor = await access(ctx, args); if (!configured()) throw new ConvexError("Exact app credentials have not been configured");
  if (!/^[a-f0-9]{64}$/.test(args.hash)) throw new ConvexError("Invalid authorization state");
  const expired = await ctx.db.query("exactOAuthStates").withIndex("by_expiresAt", q => q.lt("expiresAt", Date.now())).take(50);
  for (const row of expired) await ctx.db.delete(row._id);
  await ctx.db.insert("exactOAuthStates", { hash: args.hash, actor, expiresAt: Date.now() + 10 * 60_000 }); return null;
} });
export const consumeOAuthState = internalMutation({ args: { ...auth, hash: v.string() }, returns: v.null(), handler: async (ctx, args) => {
  const actor = await access(ctx, args), row = await ctx.db.query("exactOAuthStates").withIndex("by_hash", q => q.eq("hash", args.hash)).unique();
  if (!row || row.actor !== actor || row.expiresAt < Date.now()) throw new ConvexError("Authorization expired. Start Connect Exact again");
  await ctx.db.delete(row._id); return null;
} });
export const authorizationClient = query({ args: auth, returns: v.string(), handler: async (ctx, args) => { await access(ctx, args); if (!configured()) throw new ConvexError("Exact app credentials have not been configured"); return process.env.EXACT_CLIENT_ID!; } });
export const queueOperation = mutation({ args: { ...auth, requestId: v.string(), division: v.number(), kind: v.union(v.literal("accounts"), v.literal("invoices"), v.literal("purchases"), v.literal("documents")), providerId: v.optional(v.string()), expectedModified: v.optional(v.string()), inputJson: v.string(), confirmed: v.boolean() }, returns: v.id("exactOperations"), handler: async (ctx, args) => {
  const actor = await access(ctx, args); await company(ctx, args.division);
  const c = await connection(ctx); if (c?.state !== "connected" || !c.lastDiscoveryAt || c.lastDiscoveryAt < Date.now() - 26 * 3600_000) throw new ConvexError("Reconnect or synchronize Exact before making changes");
  if (!args.confirmed || !/^[a-f0-9-]{36}$/i.test(args.requestId) || args.inputJson.length > 30000) throw new ConvexError("Review and confirm this Exact change");
  const payload = exactWritePayload(args.kind, JSON.parse(args.inputJson), Boolean(args.providerId));
  const prior = await ctx.db.query("exactOperations").withIndex("by_requestId", q => q.eq("requestId", args.requestId)).unique();
  if (prior) { if (prior.actor !== actor || prior.division !== args.division || prior.kind !== args.kind || prior.providerId !== args.providerId || prior.payloadJson !== JSON.stringify(payload)) throw new ConvexError("Request identifier was already used for a different change"); return prior._id; }
  if (args.providerId) exactGuid(args.providerId);
  // Every foreign reference must belong to the selected company, from a completed saved dataset.
  const references: Array<[ExactKind, string]> = [];
  if (payload.Type) references.push(["documentTypes", String(payload.Type)]);
  if (payload.OrderedBy || payload.Supplier || payload.Account) references.push(["accounts", String(payload.OrderedBy ?? payload.Supplier ?? payload.Account)]);
  if (payload.Journal) {
    const ds = await dataset(ctx, args.division, "journals");
    if (!ds?.lastCompletedAt || ["access_denied", "failed"].includes(ds.state)) throw new ConvexError("Update the account books first");
    const journals = await ctx.db.query("exactRecords").withIndex("by_division_and_kind_and_generation_and_providerId", q => q.eq("division", args.division).eq("kind", "journals").eq("generation", ds.generation)).take(1001);
    if (!journals.some(j => !j.deleted && j.data.Code === payload.Journal && !j.data.IsBlocked && j.data.Type === (args.kind === "invoices" ? 20 : 22))) throw new ConvexError("Select an available journal for this company and invoice type");
  }
  const lines = (payload.SalesInvoiceLines ?? payload.PurchaseEntryLines ?? []) as Array<Record<string, unknown>>;
  if (lines.length) {
    const ds = await dataset(ctx, args.division, "vatCodes");
    if (!ds?.lastCompletedAt || ["access_denied", "failed"].includes(ds.state)) throw new ConvexError("Update this company’s tax codes first");
    const codes = await ctx.db.query("exactRecords").withIndex("by_division_and_kind_and_generation_and_providerId", q => q.eq("division", args.division).eq("kind", "vatCodes").eq("generation", ds.generation)).take(1001);
    for (const line of lines) if (!codes.some(r => !r.deleted && !r.data.IsBlocked && r.data.Code === line.VATCode)) throw new ConvexError("Choose an available tax code for this company");
  }
  for (const line of (payload.SalesInvoiceLines ?? payload.PurchaseEntryLines ?? []) as Array<Record<string, unknown>>) { references.push(["glAccounts", String(line.GLAccount)]); if (line.Item) references.push(["items", String(line.Item)]); }
  for (const [kind, id] of references) { const ds = await dataset(ctx, args.division, kind); if (!ds?.lastCompletedAt || ["access_denied", "failed"].includes(ds.state)) throw new ConvexError("Synchronize the company reference data first"); const r = await ctx.db.query("exactRecords").withIndex("by_division_and_kind_and_generation_and_providerId", q => q.eq("division", args.division).eq("kind", kind).eq("generation", ds.generation).eq("providerId", id)).unique(); if (!r || r.deleted || r.data.IsBlocked || (kind === "documentTypes" && !r.data.DocumentIsCreatable)) throw new ConvexError("A reference does not belong to this company or is blocked"); }
  if (args.providerId) {
    const ds = await dataset(ctx, args.division, args.kind); if (!ds || ds.state === "access_denied") throw new ConvexError("Update this company first");
    const candidates = await ctx.db.query("exactRecords").withIndex("by_division_and_kind_and_generation_and_parentId", q => q.eq("division", args.division).eq("kind", args.kind).eq("generation", ds.generation).eq("parentId", args.providerId!)).take(201);
    const found = candidates.filter(r => !["invoices", "purchases"].includes(args.kind) || r.data.LineNumber === 0);
    if (!found.length || found[0].deleted) throw new ConvexError("The record is not available in this company");
    if ((args.kind === "invoices" && found[0].data.Status !== 20) || (args.kind === "purchases" && found[0].data.Status !== 20)) throw new ConvexError("Only open invoices and bills can be edited");
    if (!args.expectedModified || args.expectedModified !== String(found[0].data.Modified)) throw new ConvexError("Refresh the record before editing");
  }
  const id = await ctx.db.insert("exactOperations", { requestId: args.requestId, actor, division: args.division, kind: args.kind, method: args.providerId ? "PUT" : "POST", providerId: args.providerId, expectedModified: args.expectedModified, payloadJson: JSON.stringify(payload), state: "queued", createdAt: Date.now(), updatedAt: Date.now() });
  await ctx.db.insert("statementAudit", { entityType: "exact", entityId: id, actor, action: "change_confirmed", details: JSON.stringify({ division: args.division, kind: args.kind, method: args.providerId ? "PUT" : "POST", providerId: args.providerId }), createdAt: new Date().toISOString() });
  await ctx.scheduler.runAfter(0, internal.exactSync.pump, {}); return id;
} });
export const operations = query({ args: auth, returns: v.array(v.object({ id: v.string(), division: v.number(), kind: v.string(), state: v.string(), message: v.optional(v.string()), createdAt: v.number() })), handler: async (ctx, args) => { await access(ctx, args); return (await ctx.db.query("exactOperations").order("desc").take(50)).map(r => ({ id: r._id, division: r.division, kind: r.kind, state: r.state, message: r.message, createdAt: r.createdAt })); } });
export const uploadUrl = mutation({ args: auth, returns: v.string(), handler: async (ctx, args) => { await access(ctx, args); return ctx.storage.generateUploadUrl(); } });
export const queueAttachment = mutation({ args: { ...auth, requestId: v.string(), division: v.number(), documentId: v.string(), storageId: v.id("_storage"), fileName: v.string(), confirmed: v.boolean() }, returns: v.id("exactOperations"), handler: async (ctx, args) => {
  const actor = await access(ctx, args); await company(ctx, args.division); const c = await connection(ctx);
  if (c?.state !== "connected" || !c.lastDiscoveryAt || c.lastDiscoveryAt < Date.now() - 26 * 3600_000 || !args.confirmed) throw new ConvexError("Connect Exact and confirm the attachment");
  exactGuid(args.documentId); if (!/^[a-f0-9-]{36}$/i.test(args.requestId) || !args.fileName || args.fileName.length > 200 || /[\x00-\x1f/\\]/.test(args.fileName)) throw new ConvexError("Invalid file name or request");
  const file = await ctx.db.system.get(args.storageId); if (!file || file.size > 3 * 1024 * 1024) throw new ConvexError("Choose a file no larger than 3 MB");
  const ds = await dataset(ctx, args.division, "documents"); if (!ds?.lastCompletedAt || ds.state === "access_denied") throw new ConvexError("Update documents first");
  const doc = await ctx.db.query("exactRecords").withIndex("by_division_and_kind_and_generation_and_providerId", q => q.eq("division", args.division).eq("kind", "documents").eq("generation", ds.generation).eq("providerId", args.documentId)).unique();
  if (!doc || doc.deleted) throw new ConvexError("Document is unavailable in this company");
  const payloadJson = JSON.stringify({ Document: args.documentId, FileName: args.fileName, storageId: args.storageId });
  const prior = await ctx.db.query("exactOperations").withIndex("by_requestId", q => q.eq("requestId", args.requestId)).unique();
  if (prior) { if (prior.actor !== actor || prior.division !== args.division || prior.kind !== "attachment" || prior.payloadJson !== payloadJson) throw new ConvexError("Request identifier was already used"); return prior._id; }
  const id = await ctx.db.insert("exactOperations", { requestId: args.requestId, actor, division: args.division, kind: "attachment", method: "POST", payloadJson, state: "queued", createdAt: Date.now(), updatedAt: Date.now() });
  await ctx.scheduler.runAfter(0, internal.exactSync.pump, {}); return id;
} });
export const fileAccess = internalQuery({ args: { ...auth, division: v.number(), providerId: v.string() }, returns: v.string(), handler: async (ctx, args) => {
  await access(ctx, args); await company(ctx, args.division); const c = await connection(ctx);
  if (c?.state !== "connected" || !c.lastDiscoveryAt || c.lastDiscoveryAt < Date.now() - 26 * 3600_000) throw new ConvexError("Refresh the Exact connection first");
  const ds = await dataset(ctx, args.division, "attachments"); if (!ds?.lastCompletedAt || ds.state === "access_denied") throw new ConvexError("Update files first");
  const row = await ctx.db.query("exactRecords").withIndex("by_division_and_kind_and_generation_and_providerId", q => q.eq("division", args.division).eq("kind", "attachments").eq("generation", ds.generation).eq("providerId", exactGuid(args.providerId))).unique();
  if (!row || row.deleted) throw new ConvexError("Attachment not available");
  if (typeof row.data.FileSize === "number" && row.data.FileSize > 3 * 1024 * 1024) throw new ConvexError("Download files larger than 3 MB from Exact");
  return String(row.data.FileName ?? "attachment");
} });

// Only internal actions can retrieve encrypted credentials and drive the serialized queue.
export const claim = internalMutation({ args: { token: v.string(), connecting: v.optional(v.boolean()) }, returns: v.union(v.null(), v.string()), handler: async (ctx, args) => {
  let c = await connection(ctx); const now = Date.now();
  if (!c && args.connecting) { const id = await ctx.db.insert("exactConnections", { key: "primary", state: "not_connected", leaseUntil: 0, nextAllowedAt: 0 }); c = await ctx.db.get(id); }
  if (!c || c.leaseUntil > now || c.nextAllowedAt > now || (!args.connecting && c.state !== "connected")) return null;
  const abandoned = await ctx.db.query("exactOperations").withIndex("by_state", q => q.eq("state", "running")).take(10);
  for (const op of abandoned) await ctx.db.patch(op._id, { state: "uncertain", message: "The result could not be confirmed. Check Exact before submitting this change again.", updatedAt: now });
  await ctx.db.patch(c._id, { leaseToken: args.token, leaseUntil: now + 90_000 });
  return JSON.stringify(c);
} });
export const saveConnection = internalMutation({ args: { token: v.string(), encryptedTokens: v.string(), expiresAt: v.number(), userId: v.optional(v.string()), user: v.optional(v.string()), currentDivision: v.optional(v.number()) }, returns: v.null(), handler: async (ctx, args) => {
  const c = await lease(ctx, args.token);
  if (args.userId && c.userId && args.userId !== c.userId) throw new ConvexError("Reconnect the same Exact user; changing owners requires a separate data review");
  await ctx.db.patch(c._id, { encryptedTokens: args.encryptedTokens, expiresAt: args.expiresAt, state: "connected", error: undefined, ...(args.userId ? { userId: args.userId, user: args.user, currentDivision: args.currentDivision, lastDiscoveryAt: undefined, discoveryRun: undefined, discoveryPage: undefined, discoveryFinalizing: undefined } : {}) }); return null;
} });
export const release = internalMutation({ args: { token: v.string(), delay: v.number(), error: v.optional(v.string()), reconnect: v.optional(v.boolean()) }, returns: v.null(), handler: async (ctx, args) => {
  const c = await connection(ctx); if (!c || c.leaseToken !== args.token) return null;
  await ctx.db.patch(c._id, { leaseUntil: 0, leaseToken: undefined, nextAllowedAt: Date.now() + args.delay, ...(args.error ? { error: args.error } : {}), ...(args.reconnect ? { state: "reconnect_required" } : {}) });
  if (!args.reconnect) await ctx.scheduler.runAfter(Math.max(1300, args.delay), internal.exactSync.pump, {}); return null;
} });
export const work = internalQuery({ args: {}, returns: v.string(), handler: async ctx => {
  const c = await connection(ctx); if (!c) return JSON.stringify({ type: "none" });
  if (c.discoveryFinalizing || c.resyncRun) return JSON.stringify({ type: "none" });
  if (!c.lastDiscoveryAt || c.lastDiscoveryAt < Date.now() - 24 * 3600_000) return JSON.stringify({ type: "discover", connection: c });
  const op = await ctx.db.query("exactOperations").withIndex("by_state", q => q.eq("state", "queued")).first();
  if (op) return JSON.stringify({ type: "operation", operation: op });
  const ds = await ctx.db.query("exactDatasets").withIndex("by_nextRunAt", q => q.lte("nextRunAt", Date.now())).first();
  return JSON.stringify(ds ? { type: "dataset", dataset: ds } : { type: "none" });
} });
export const discovered = internalMutation({ args: { token: v.string(), run: v.number(), rows: v.array(v.object(exactCompanyFields)), next: v.optional(v.string()) }, returns: v.null(), handler: async (ctx, args) => {
  const c = await lease(ctx, args.token);
  for (const row of args.rows) { const old = await ctx.db.query("exactCompanies").withIndex("by_division", q => q.eq("division", row.division)).unique(); if (old) await ctx.db.patch(old._id, { ...row, active: old.active }); else await ctx.db.insert("exactCompanies", { ...row, active: false }); }
  if (args.next) { await ctx.db.patch(c._id, { discoveryPage: args.next, discoveryRun: args.run }); return null; }
  await ctx.db.patch(c._id, { discoveryRun: args.run, discoveryPage: undefined, discoveryFinalizing: true });
  await ctx.scheduler.runAfter(0, internal.exact.finishDiscoveryBatch, { run: args.run, cursor: null }); return null;
} });
export const finishDiscoveryBatch = internalMutation({ args: { run: v.number(), cursor: v.union(v.string(), v.null()) }, returns: v.null(), handler: async (ctx, args) => {
  const c = await connection(ctx); if (!c || c.discoveryRun !== args.run || !c.discoveryFinalizing) return null;
  const page = await ctx.db.query("exactCompanies").paginate({ cursor: args.cursor, numItems: 20 });
  for (const co of page.page) {
    const active = co.discoveredAt === args.run; await ctx.db.patch(co._id, { active });
    for (const kind of exactKinds) {
      const old = await dataset(ctx, co.division, kind);
      if (!active) { if (old) await ctx.db.patch(old._id, { nextRunAt: Number.MAX_SAFE_INTEGER, state: "access_removed", error: "Exact no longer authorizes this company" }); continue; }
      if (!old) await ctx.db.insert("exactDatasets", { division: co.division, kind, generation: "empty", buildingGeneration: crypto.randomUUID(), cursor: "1", state: "queued", nextRunAt: Date.now(), attempts: 0, pages: 0 });
      else if (!co.active || old.state === "access_removed" || (old.lastCompletedAt && old.lastCompletedAt < Date.now() - 50 * 86400_000) || (co.moveDate && exactMoveTime(co.moveDate) > (old.lastCompletedAt ?? 0))) await ctx.db.patch(old._id, { buildingGeneration: crypto.randomUUID(), cursor: "1", nextUrl: undefined, state: "queued", nextRunAt: Date.now(), attempts: 0, pages: 0 });
    }
  }
  if (!page.isDone) await ctx.scheduler.runAfter(0, internal.exact.finishDiscoveryBatch, { run: args.run, cursor: page.continueCursor });
  else { await ctx.db.patch(c._id, { lastDiscoveryAt: Date.now(), discoveryRun: undefined, discoveryPage: undefined, discoveryFinalizing: undefined, error: undefined }); await ctx.scheduler.runAfter(1500, internal.exactSync.pump, {}); }
  return null;
} });
function exactMoveTime(value: string) { const match = /\/Date\((\d+)/.exec(value); return match ? Number(match[1]) : Date.parse(value); }
export const beginDataset = internalMutation({ args: { token: v.string(), id: v.id("exactDatasets") }, returns: v.object({ _id: v.id("exactDatasets"), ...exactDatasetFields }), handler: async (ctx, args) => {
  await lease(ctx, args.token); const ds = await ctx.db.get(args.id); if (!ds) throw new ConvexError("Dataset missing"); await company(ctx, ds.division);
  const patch = { state: "syncing", error: undefined, ...(!exactResources[ds.kind].sync && !ds.buildingGeneration ? { buildingGeneration: crypto.randomUUID(), nextUrl: undefined, pages: 0 } : {}) };
  await ctx.db.patch(ds._id, patch); const { _creationTime: _time, ...value } = { ...ds, ...patch }; return value;
} });
export const applyPage = internalMutation({ args: { token: v.string(), id: v.id("exactDatasets"), rows: v.array(exactData), cursor: v.string(), next: v.optional(v.string()), commitPage: v.boolean() }, returns: v.null(), handler: async (ctx, args) => {
  await lease(ctx, args.token); const ds = await ctx.db.get(args.id); if (!ds) throw new ConvexError("Dataset missing");
  if (args.rows.length > 1000 || JSON.stringify(args.rows).length > 3_000_000 || ds.pages >= 100000) throw new ConvexError("Exact response exceeded safe synchronization bounds");
  const generation = ds.buildingGeneration ?? ds.generation;
  for (const data of args.rows) {
    if (ds.kind === "deleted") {
      const kind = exactDeleteKinds[Number(data.EntityType)]; if (!kind) continue;
      const target = await dataset(ctx, ds.division, kind); if (!target) continue;
      for (const gen of [...new Set([target.generation, target.buildingGeneration].filter((x): x is string => Boolean(x)))]) {
        const key = String(data.EntityKey).toLowerCase();
        const byId = await ctx.db.query("exactRecords").withIndex("by_division_and_kind_and_generation_and_providerId", q => q.eq("division", ds.division).eq("kind", kind).eq("generation", gen).eq("providerId", key)).unique();
        const children = await ctx.db.query("exactRecords").withIndex("by_division_and_kind_and_generation_and_parentId", q => q.eq("division", ds.division).eq("kind", kind).eq("generation", gen).eq("parentId", key)).take(201);
        if (children.length > 200) throw new ConvexError("Large deleted document requires full reconciliation");
        for (const row of [byId, ...children]) if (row && !row.deleted) await ctx.db.patch(row._id, { deleted: true, updatedAt: Date.now() });
      }
      continue;
    }
    const providerId = String(data[exactResources[ds.kind].key]).toLowerCase(), parentId = String(data.InvoiceID ?? data.EntryID ?? data.Document ?? providerId).toLowerCase();
    const old = await ctx.db.query("exactRecords").withIndex("by_division_and_kind_and_generation_and_providerId", q => q.eq("division", ds.division).eq("kind", ds.kind).eq("generation", generation).eq("providerId", providerId)).unique();
    const fields = { division: ds.division, kind: ds.kind, generation, providerId, parentId, data, deleted: false, updatedAt: Date.now() };
    if (old) await ctx.db.patch(old._id, fields); else await ctx.db.insert("exactRecords", fields);
  }
  if (!args.commitPage) return null;
  const completed = !args.next;
  await ctx.db.patch(ds._id, { cursor: args.cursor, nextUrl: args.next, state: completed ? "ready" : "syncing", attempts: 0, pages: ds.pages + 1, nextRunAt: completed ? Date.now() + (exactResources[ds.kind].sync || ["receivables", "payables"].includes(ds.kind) ? 3600_000 : 24 * 3600_000) : Date.now(), ...(completed ? { generation, buildingGeneration: undefined, lastCompletedAt: Date.now(), pages: 0 } : {}) });
  if (completed && ds.buildingGeneration && ds.generation !== "empty" && ds.generation !== generation) await ctx.scheduler.runAfter(0, internal.exact.cleanGeneration, { division: ds.division, kind: ds.kind, generation: ds.generation });
  return null;
} });
export const cleanGeneration = internalMutation({ args: { division: v.number(), kind: exactKind, generation: v.string() }, returns: v.null(), handler: async (ctx, args) => { const ds = await dataset(ctx, args.division, args.kind); if (!ds || ds.generation === args.generation || ds.buildingGeneration === args.generation) return null; const rows = await ctx.db.query("exactRecords").withIndex("by_division_and_kind_and_generation_and_providerId", q => q.eq("division", args.division).eq("kind", args.kind).eq("generation", args.generation)).take(200); for (const row of rows) await ctx.db.delete(row._id); if (rows.length === 200) await ctx.scheduler.runAfter(0, internal.exact.cleanGeneration, args); return null; } });
export const datasetFailed = internalMutation({ args: { token: v.string(), id: v.id("exactDatasets"), message: v.string(), delay: v.number(), denied: v.boolean() }, returns: v.null(), handler: async (ctx, args) => { await lease(ctx, args.token); const ds = await ctx.db.get(args.id); if (ds) await ctx.db.patch(ds._id, { state: args.denied ? "access_denied" : "failed", error: args.message, attempts: ds.attempts + 1, nextRunAt: Date.now() + Math.max(args.delay, args.denied || ds.attempts >= 2 ? 24 * 3600_000 : 60_000 * 2 ** ds.attempts) }); return null; } });
export const operationState = internalMutation({ args: { token: v.string(), id: v.id("exactOperations"), state: v.union(v.literal("running"), v.literal("succeeded"), v.literal("failed"), v.literal("uncertain")), message: v.optional(v.string()) }, returns: v.null(), handler: async (ctx, args) => {
  await lease(ctx, args.token); const op = await ctx.db.get(args.id); if (!op) throw new ConvexError("Operation missing");
  if (args.state === "running") {
    await company(ctx, op.division);
    const member = await ctx.db.query("statementMembers").withIndex("by_actor", q => q.eq("actor", op.actor)).unique();
    if (!member?.manage || !statementCompanies.every(co => member.companyIds.includes(co.id))) throw new ConvexError("This user no longer has access to make changes in Exact");
  }
  await ctx.db.patch(op._id, { state: args.state, message: args.message, updatedAt: Date.now() });
  if (args.state !== "running") { await ctx.db.insert("statementAudit", { entityType: "exact", entityId: op._id, actor: op.actor, action: `change_${args.state}`, details: args.message ?? "", createdAt: new Date().toISOString() }); const ds = await dataset(ctx, op.division, op.kind === "attachment" ? "attachments" : op.kind); if (ds) await ctx.db.patch(ds._id, { nextRunAt: Date.now() }); }
  return null;
} });
