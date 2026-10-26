import { ConvexError, v } from "convex/values";
import { mutation, query, type QueryCtx, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { statementCompany } from "./statementSchema";
import { normalizeStatementActor, statementAmountDecimal } from "../shared/statements";
import { invoiceLayout, invoiceSelectionLimit, invoiceText, validateInvoiceDraft, validateInvoiceAi, type InvoiceDraft } from "../shared/statementInvoices";
const auth = { serviceToken: v.string(), actor: v.string() };
async function access(ctx: QueryCtx | MutationCtx, a: { serviceToken: string; actor: string }, companyId?: string) {
  if (!process.env.CONVEX_SERVICE_TOKEN || a.serviceToken !== process.env.CONVEX_SERVICE_TOKEN) throw new ConvexError("Unauthorized");
  const actor = normalizeStatementActor(a.actor), member = await ctx.db.query("statementMembers").withIndex("by_actor", q => q.eq("actor", actor)).unique();
  if (!member || (companyId && !member.companyIds.some(id => id === companyId))) throw new ConvexError("You do not have access to this company");
  return member;
}
async function invoice(ctx: QueryCtx | MutationCtx, a: { serviceToken: string; actor: string; id: Id<"statementInvoices"> }) {
  const row = await ctx.db.get(a.id); if (!row) throw new ConvexError("Invoice not found"); await access(ctx, a, row.companyId); return row;
}
async function audit(ctx: MutationCtx, actor: string, id: string, action: string) { await ctx.db.insert("statementAudit", { actor, entityType: "invoice", entityId: id, action, details: "", createdAt: new Date().toISOString() }); }
export const templates = query({ args: auth, returns: v.string(), handler: async (ctx, a) => {
  const member = await access(ctx, a), rows = [];
  for (const companyId of member.companyIds) { const row = await ctx.db.query("statementInvoiceTemplates").withIndex("by_company", q => q.eq("companyId", companyId)).order("desc").first(); if (row) rows.push({ id: row._id, companyId, fileName: row.fileName, layout: JSON.parse(row.layoutJson), approved: row.approved }); }
  return JSON.stringify(rows);
} });
export const template = query({ args: { ...auth, id: v.id("statementInvoiceTemplates") }, returns: v.string(), handler: async (ctx, a) => {
  const row = await ctx.db.get(a.id); if (!row) throw new ConvexError("Example not found"); await access(ctx, a, row.companyId);
  return JSON.stringify({ ...row, url: await ctx.storage.getUrl(row.storageId) });
} });
export const saveTemplate = mutation({ args: { ...auth, companyId: statementCompany, storageId: v.id("_storage"), fileName: v.string(), layoutJson: v.string(), model: v.string(), costUsd: v.optional(v.number()) }, returns: v.id("statementInvoiceTemplates"), handler: async (ctx, a) => {
  const member = await access(ctx, a, a.companyId); if (!member.manage) throw new ConvexError("Settings access required");
  const file = await ctx.db.system.get(a.storageId); if (!file || file.size > 5 * 1024 * 1024) throw new ConvexError("Use an example PDF under 5 MB");
  const id = await ctx.db.insert("statementInvoiceTemplates", { companyId: a.companyId, storageId: a.storageId, fileName: invoiceText(a.fileName, "file name", 250, true), layoutJson: JSON.stringify(invoiceLayout(JSON.parse(a.layoutJson))), approved: false, actor: member.actor, createdAt: Date.now(), model: a.model, costUsd: a.costUsd });
  await audit(ctx, member.actor, id, "example_uploaded"); return id;
} });
export const approveTemplate = mutation({ args: { ...auth, id: v.id("statementInvoiceTemplates"), layoutJson: v.string(), confirmed: v.boolean() }, returns: v.id("statementInvoiceTemplates"), handler: async (ctx, a) => {
  const old = await ctx.db.get(a.id); if (!old) throw new ConvexError("Example not found"); const member = await access(ctx, a, old.companyId);
  if (!member.manage || !a.confirmed) throw new ConvexError("Check the example layout before saving it");
  const { _id, _creationTime, ...data } = old;
  const id = await ctx.db.insert("statementInvoiceTemplates", { ...data, layoutJson: JSON.stringify(invoiceLayout(JSON.parse(a.layoutJson))), approved: true, actor: member.actor, createdAt: Date.now() });
  await audit(ctx, member.actor, id, "example_approved"); return id;
} });
export const list = query({ args: auth, returns: v.string(), handler: async (ctx, a) => {
  const member = await access(ctx, a), rows = [];
  for (const companyId of member.companyIds) rows.push(...await ctx.db.query("statementInvoices").withIndex("by_company", q => q.eq("companyId", companyId)).order("desc").take(101));
  return JSON.stringify({ truncated: rows.length > 100, invoices: rows.sort((x, y) => y.createdAt - x.createdAt).slice(0, 100).map(row => ({ id: row._id, companyId: row.companyId, number: JSON.parse(row.draftJson).number, state: row.state, createdAt: row.createdAt, customer: JSON.parse(row.draftJson).customer })) });
} });
export const get = query({ args: { ...auth, id: v.id("statementInvoices") }, returns: v.string(), handler: async (ctx, a) => {
  const row = await invoice(ctx, a), example = await ctx.db.get(row.templateId); if (!example) throw new ConvexError("Invoice example missing");
  return JSON.stringify({ ...row, draft: JSON.parse(row.draftJson), sources: JSON.parse(row.sourceJson), layout: JSON.parse(example.layoutJson), templateUrl: await ctx.storage.getUrl(example.storageId), pdfUrl: row.storageId ? await ctx.storage.getUrl(row.storageId) : null });
} });
export const begin = mutation({ args: { ...auth, requestId: v.string(), ids: v.array(v.id("statementTransactions")), draftJson: v.string(), instructions: v.string() }, returns: v.id("statementInvoices"), handler: async (ctx, a) => {
  const member = await access(ctx, a);
  if (!/^[a-f0-9-]{36}$/i.test(a.requestId) || !a.ids.length || a.ids.length > invoiceSelectionLimit || new Set(a.ids).size !== a.ids.length) throw new ConvexError(`Choose 1–${invoiceSelectionLimit} different transactions`);
  const previous = await ctx.db.query("statementInvoices").withIndex("by_request", q => q.eq("requestId", a.requestId)).unique();
  if (previous) { await access(ctx, a, previous.companyId); if (previous.actor !== member.actor) throw new ConvexError("Request already used"); return previous._id; }
  const rows = await Promise.all(a.ids.map(id => ctx.db.get(id))), first = rows[0];
  if (!first?.companyId || rows.some(row => !row || row.deletedAt || row.companyId !== first.companyId || row.currency !== first.currency || row.direction !== first.direction)) throw new ConvexError("Choose transactions from one company, one currency and one direction");
  await access(ctx, a, first.companyId);
  const example = await ctx.db.query("statementInvoiceTemplates").withIndex("by_company", q => q.eq("companyId", first.companyId!)).order("desc").first();
  if (!example?.approved) throw new ConvexError("Upload and check this company’s invoice example in Settings first");
  const input = JSON.parse(a.draftJson) as InvoiceDraft;
  const sources = rows.map(row => ({ transactionId: row!._id, revision: row!.revision, date: row!.date, description: row!.description, amount: statementAmountDecimal(row!.amountMinor, first.currency), counterparty: row!.counterparty ?? "" }));
  const draft = validateInvoiceDraft({ ...input, currency: first.currency, lines: sources.map(row => ({ transactionId: row.transactionId, description: row.description, amount: row.amount, taxPercent: input.lines?.[0]?.taxPercent ?? "" })) });
  if (await ctx.db.query("statementInvoices").withIndex("by_company_number", q => q.eq("companyId", first.companyId!).eq("number", draft.number)).first()) throw new ConvexError("This company already has an invoice with that number");
  const id = await ctx.db.insert("statementInvoices", { companyId: first.companyId, templateId: example._id, requestId: a.requestId, draftJson: JSON.stringify(draft), sourceJson: JSON.stringify(sources), instructions: invoiceText(a.instructions, "instructions", 2000), state: "failed", leaseUntil: 0, revision: 1, createdAt: Date.now(), updatedAt: Date.now(), actor: member.actor, number: draft.number });
  await audit(ctx, member.actor, id, "draft_created"); return id;
} });
export const claim = mutation({ args: { ...auth, id: v.id("statementInvoices"), token: v.string() }, returns: v.boolean(), handler: async (ctx, a) => {
  const row = await invoice(ctx, a); if (row.state === "ready" || row.state === "draft" || row.state === "discarded" || row.leaseUntil > Date.now()) return false;
  await ctx.db.patch(row._id, { state: "preparing", error: undefined, leaseToken: a.token, leaseUntil: Date.now() + 180000, updatedAt: Date.now() }); return true;
} });
export const generated = mutation({ args: { ...auth, id: v.id("statementInvoices"), token: v.string(), resultJson: v.optional(v.string()), model: v.optional(v.string()), costUsd: v.optional(v.number()), error: v.optional(v.string()) }, returns: v.null(), handler: async (ctx, a) => {
  const row = await invoice(ctx, a); if (row.leaseToken !== a.token || row.state !== "preparing") throw new ConvexError("This draft is being handled by another request");
  if (a.error) { await ctx.db.patch(row._id, { state: "failed", error: a.error.slice(0, 500), leaseUntil: 0, leaseToken: undefined }); return null; }
  const draft = validateInvoiceDraft(JSON.parse(row.draftJson)), lines = validateInvoiceAi(JSON.parse(a.resultJson!), draft.lines.map(l => l.transactionId));
  draft.lines = draft.lines.map(line => ({ ...line, description: lines.find(r => r.transactionId === line.transactionId)!.description }));
  await ctx.db.patch(row._id, { draftJson: JSON.stringify(draft), state: "draft", model: a.model, costUsd: a.costUsd, leaseToken: undefined, leaseUntil: 0, revision: row.revision + 1, updatedAt: Date.now() }); return null;
} });
export const save = mutation({ args: { ...auth, id: v.id("statementInvoices"), revision: v.number(), draftJson: v.string() }, returns: v.null(), handler: async (ctx, a) => {
  const row = await invoice(ctx, a); if (row.state !== "draft" || row.revision !== a.revision) throw new ConvexError("Reload this draft before editing");
  const draft = validateInvoiceDraft(JSON.parse(a.draftJson)), old = validateInvoiceDraft(JSON.parse(row.draftJson));
  if (draft.currency !== old.currency || draft.lines.length !== old.lines.length || draft.lines.some(l => !old.lines.some(x => x.transactionId === l.transactionId))) throw new ConvexError("Keep the selected transactions and currency");
  const duplicate = await ctx.db.query("statementInvoices").withIndex("by_company_number", q => q.eq("companyId", row.companyId).eq("number", draft.number)).first();
  if (duplicate && duplicate._id !== row._id) throw new ConvexError("This invoice number is already used");
  await ctx.db.patch(row._id, { draftJson: JSON.stringify(draft), number: draft.number, revision: row.revision + 1, updatedAt: Date.now() }); await audit(ctx, a.actor, row._id, "draft_updated"); return null;
} });
export const finalize = mutation({ args: { ...auth, id: v.id("statementInvoices"), revision: v.number(), storageId: v.id("_storage"), confirmed: v.boolean() }, returns: v.null(), handler: async (ctx, a) => {
  const row = await invoice(ctx, a); if (!a.confirmed || row.state !== "draft" || row.revision !== a.revision) throw new ConvexError("Check the latest draft before saving the final invoice");
  const file = await ctx.db.system.get(a.storageId); if (!file || file.size > 15 * 1024 * 1024) throw new ConvexError("The invoice PDF could not be saved");
  for (const source of JSON.parse(row.sourceJson) as Array<{ transactionId: Id<"statementTransactions">; revision: number }>) { const current = await ctx.db.get(source.transactionId); if (!current || current.deletedAt || current.companyId !== row.companyId || current.revision !== source.revision) throw new ConvexError("A selected transaction changed. Create a new draft from the updated transactions"); }
  await ctx.db.patch(row._id, { state: "ready", storageId: a.storageId, revision: row.revision + 1, updatedAt: Date.now() }); await audit(ctx, a.actor, row._id, "invoice_finalized"); return null;
} });
export const discard = mutation({ args: { ...auth, id: v.id("statementInvoices") }, returns: v.null(), handler: async (ctx, a) => {
  const row = await invoice(ctx, a); if (!["draft", "failed"].includes(row.state)) throw new ConvexError("Only unfinished drafts can be discarded");
  // Retain the draft and source history while releasing its unused invoice number.
  await ctx.db.patch(row._id, { state: "discarded", number: `discarded:${row._id}`, revision: row.revision + 1, updatedAt: Date.now() }); await audit(ctx, a.actor, row._id, "draft_discarded"); return null;
} });
