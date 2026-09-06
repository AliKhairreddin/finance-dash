import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internal } from "./_generated/api";
import { mutation, query, internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { documentEntity, documentExtraction, financialDocumentValidator } from "./documentSchema";
import { documentMatchCandidates, documentMaximumBytes, documentContentTypes, validateExtraction, type DocumentExtraction } from "../shared/financialDocuments";
import { bumpBankLedgerRevision } from "./dashboard";
import { wiseEntityFromAccountName } from "../shared/wiseEntities";

function authorize(token: string): void {
  if (!process.env.CONVEX_SERVICE_TOKEN || token !== process.env.CONVEX_SERVICE_TOKEN) throw new ConvexError("Unauthorized");
}
const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const nowIso = () => new Date().toISOString();

async function moveFolder(ctx: MutationCtx, previous: { entity?: "dn" | "lmd"; month: string } | null, next: { entity?: "dn" | "lmd"; month: string }): Promise<void> {
  const keyFor = (value: typeof next) => `${value.entity ?? "unassigned"}:${value.month}`;
  if (previous && keyFor(previous) === keyFor(next)) return;
  for (const [value, delta] of [[previous, -1], [next, 1]] as const) {
    if (!value) continue;
    const key = keyFor(value);
    const folder = await ctx.db.query("documentFolders").withIndex("by_key", q => q.eq("key", key)).unique();
    if (folder) await ctx.db.patch(folder._id, { count: Math.max(0, folder.count + delta) });
    else if (delta > 0) await ctx.db.insert("documentFolders", { key, entity: value.entity, month: value.month, count: 1 });
  }
}

export const settings = query({
  args: { serviceToken: v.string() }, returns: v.object({ allowedSenders: v.array(v.string()) }),
  handler: async (ctx, args) => { authorize(args.serviceToken); const value = await ctx.db.query("documentSettings").withIndex("by_key", q => q.eq("key", "default")).unique(); return { allowedSenders: value?.allowedSenders ?? [] }; }
});
export const saveSettings = mutation({
  args: { serviceToken: v.string(), allowedSenders: v.array(v.string()) }, returns: v.null(),
  handler: async (ctx, args) => {
    authorize(args.serviceToken);
    const allowedSenders = [...new Set(args.allowedSenders.map(s => s.trim().toLowerCase()))];
    if (allowedSenders.length > 30 || allowedSenders.some(s => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) || s.length > 254)) throw new ConvexError("Enter valid sender email addresses");
    const row = await ctx.db.query("documentSettings").withIndex("by_key", q => q.eq("key", "default")).unique();
    if (row) await ctx.db.patch(row._id, { allowedSenders }); else await ctx.db.insert("documentSettings", { key: "default", allowedSenders });
    return null;
  }
});
export const folders = query({
  args: { serviceToken: v.string() }, returns: v.array(v.object({ entity: v.optional(documentEntity), month: v.string(), count: v.number() })),
  handler: async (ctx, args) => { authorize(args.serviceToken); return (await ctx.db.query("documentFolders").withIndex("by_key").take(1000)).filter(row => row.count > 0).map(({ entity, month, count }) => ({ entity, month, count })); }
});
export const list = query({
  args: { serviceToken: v.string(), entity: v.optional(v.union(documentEntity, v.literal("unassigned"))), month: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  returns: v.object({ page: v.array(financialDocumentValidator), isDone: v.boolean(), continueCursor: v.string(), splitCursor: v.optional(v.union(v.string(), v.null())), pageStatus: v.optional(v.union(v.literal("SplitRecommended"), v.literal("SplitRequired"), v.null())) }),
  handler: async (ctx, args) => {
    authorize(args.serviceToken);
    const rows = args.entity ? ctx.db.query("financialDocuments").withIndex("by_entity_month", q => { const scoped = q.eq("entity", args.entity === "unassigned" ? undefined : args.entity); return args.month ? scoped.eq("month", args.month) : scoped; })
      : args.month ? ctx.db.query("financialDocuments").withIndex("by_month", q => q.eq("month", args.month!)) : ctx.db.query("financialDocuments");
    return rows.order("desc").paginate({ ...args.paginationOpts, numItems: Math.min(200, args.paginationOpts.numItems) });
  }
});
export const get = query({
  args: { serviceToken: v.string(), id: v.id("financialDocuments") }, returns: v.union(v.object({ document: financialDocumentValidator, url: v.union(v.string(), v.null()) }), v.null()),
  handler: async (ctx, args) => { authorize(args.serviceToken); const document = await ctx.db.get(args.id); return document ? { document, url: await ctx.storage.getUrl(document.storageId) } : null; }
});
export const ingest = mutation({
  args: { serviceToken: v.string(), storageId: v.id("_storage"), contentHash: v.string(), intakeKey: v.string(), fileName: v.string(), contentType: v.string(), size: v.number(), source: v.union(v.literal("upload"), v.literal("email"), v.literal("telegram"), v.literal("archive")), invoiceId: v.optional(v.string()), sourceContext: v.string(), sender: v.optional(v.string()), entity: v.optional(documentEntity) },
  returns: v.object({ id: v.id("financialDocuments"), duplicate: v.boolean() }),
  handler: async (ctx, args) => {
    authorize(args.serviceToken);
    if (!/^[a-f0-9]{64}$/.test(args.contentHash) || args.size <= 0 || args.size > documentMaximumBytes || !documentContentTypes.includes(args.contentType as typeof documentContentTypes[number]) || args.fileName.length > 240 || args.sourceContext.length > 12000 || args.intakeKey.length > 512) throw new ConvexError("Invalid document upload");
    if (args.invoiceId) {
      const state = await ctx.db.query("dashboardState").withIndex("by_key", q => q.eq("key", "default")).unique();
      if (!state?.invoices.some(i => i.id === args.invoiceId && i.documentType === "sales_invoice")) throw new ConvexError("Sales invoice not found");
    }
    const metadata = await ctx.db.system.get(args.storageId);
    if (!metadata || metadata.size !== args.size) throw new ConvexError("Stored file is missing or incomplete");
    const duplicate = await ctx.db.query("financialDocuments").withIndex("by_content_hash", q => q.eq("contentHash", args.contentHash)).first()
      ?? await ctx.db.query("financialDocuments").withIndex("by_intake_key", q => q.eq("intakeKey", args.intakeKey)).first();
    if (duplicate) { if (duplicate.storageId !== args.storageId) await ctx.storage.delete(args.storageId); return { id: duplicate._id, duplicate: true }; }
    const { serviceToken: _, ...input } = args;
    const now = nowIso();
    const month = now.slice(0, 7);
    const id = await ctx.db.insert("financialDocuments", { ...input, kind: "unknown", month, status: "queued", attempts: 0, createdAt: now, updatedAt: now });
    await moveFolder(ctx, null, { entity: args.entity, month });
    await ctx.scheduler.runAfter(0, internal.documentProcessing.process, { id });
    return { id, duplicate: false };
  }
});

async function bankCandidates(ctx: QueryCtx | MutationCtx, extraction: DocumentExtraction, requireIdentity: boolean) {
  if (!extraction.amount || !extraction.currency) return { rows: [], limited: false };
  const rows = await ctx.db.query("bankTransactions").withIndex("by_direction_currency_amount", q => q
    .eq("direction", extraction.kind === "invoice" ? "in" : "out").eq("currency", extraction.currency!)
    .gte("amount", extraction.amount! - 0.009).lte("amount", extraction.amount! + 0.009)).take(201);
  const connections = await ctx.db.query("bankConnectionBindings").take(10);
  return { limited: rows.length === 201, rows: documentMatchCandidates(extraction,
    rows.filter(t => connections.some(c => c.source === t.source && c.connectionKey === t.connectionKey)), requireIdentity) };
}

async function unclaimed(ctx: QueryCtx | MutationCtx, transactionId: string, document: Doc<"financialDocuments">, invoiceId?: string, expenseId?: string) {
  const claims = await ctx.db.query("financialDocuments").withIndex("by_transaction", q => q.eq("transactionId", transactionId)).take(20);
  return claims.length < 20 && claims.every(claim => claim._id === document._id || (invoiceId && claim.invoiceId === invoiceId) || (expenseId && claim.expenseId === expenseId));
}

async function recordAndMatch(ctx: MutationCtx, document: Doc<"financialDocuments">, extracted: DocumentExtraction, manualTransactionId?: string): Promise<void> {
  const extraction = validateExtraction(extracted);
  const now = nowIso();
  const next = { entity: extraction.entity ?? undefined, month: extraction.issueDate?.slice(0, 7) ?? document.month };
  const state = await ctx.db.query("dashboardState").withIndex("by_key", q => q.eq("key", "default")).unique();
  if (!state) throw new ConvexError("Dashboard is not initialized");
  if (document.invoiceId && extraction.kind !== "invoice" || document.expenseId && extraction.kind !== "expense") extraction.reviewReasons.push("Document type differs from its existing record");
  const provider = state.providers.find(p => p.type === (extraction.kind === "invoice" ? "client" : "supplier") && [p.name, p.legalName, ...p.aliases].some(name => name && normalized(name) === normalized(extraction.counterparty)));
  const existingInvoice = extraction.kind === "invoice" ? state.invoices.find(i => i.id === document.invoiceId || (extraction.documentNumber && normalized(i.invoiceNumber) === normalized(extraction.documentNumber) && i.currency === extraction.currency && Math.abs(i.amount - (extraction.amount ?? 0)) < 0.01 && (!i.entity || i.entity === extraction.entity) && (i.providerId && i.providerId === provider?.id || normalized(i.customerName) === normalized(extraction.counterparty)))) : undefined;
  let existingExpense = extraction.kind === "expense" ? state.expenses.find(e => e.id === document.expenseId || (extraction.documentNumber && normalized(e.sourceDocumentNumber ?? "") === normalized(extraction.documentNumber) && e.currency === extraction.currency && Math.abs(e.grossAmount - (extraction.amount ?? 0)) < 0.01 && (!e.entity || e.entity === extraction.entity) && normalized(e.supplierName) === normalized(extraction.counterparty))) : undefined;
  const existing = existingInvoice ?? existingExpense;
  const existingAmount = existingInvoice?.amount ?? existingExpense?.grossAmount;
  if (existing && (existing.currency !== extraction.currency || Math.abs((existingAmount ?? 0) - (extraction.amount ?? 0)) > 0.009 || existing.entity && existing.entity !== extraction.entity)) extraction.reviewReasons.push("Details differ from the existing invoice or expense");
  await moveFolder(ctx, document, next);
  await ctx.db.patch(document._id, { ...next, kind: extraction.kind, extraction, processedAt: document.processedAt ?? now, updatedAt: now, error: undefined, attemptToken: undefined });
  if (extraction.reviewReasons.length || !extraction.amount || !extraction.currency || !extraction.issueDate || !extraction.entity) {
    if (manualTransactionId) throw new ConvexError("Review the document details before matching");
    await ctx.db.patch(document._id, { status: "needs_review" }); return;
  }
  let invoiceId = existingInvoice?.id ?? document.invoiceId;
  let expenseId = existingExpense?.id ?? document.expenseId;
  const existingTransactionId = existing?.transactionId;
  let inherited: Doc<"bankTransactions"> | null = null;
  if (document.source === "archive" && document.invoiceId && existingInvoice?.transactionId) {
    const transaction = await ctx.db.query("bankTransactions").withIndex("by_transaction_id", q => q.eq("id", existingInvoice.transactionId!)).unique();
    if (transaction && transaction.matchedInvoiceId === invoiceId && transaction.direction === "in" && ["posted", "settled"].includes(transaction.status) && transaction.currency === extraction.currency && (!transaction.wiseEntity || transaction.wiseEntity === extraction.entity)) {
      const binding = await ctx.db.query("bankConnectionBindings").withIndex("by_source_connection", q => q.eq("source", transaction.source).eq("connectionKey", transaction.connectionKey!)).unique();
      if (binding) inherited = transaction;
    }
  }
  const candidates = await bankCandidates(ctx, extraction, !manualTransactionId);
  const available = [];
  for (const transaction of candidates.rows) {
    if ((!transaction.matchedInvoiceId || transaction.matchedInvoiceId === invoiceId) && await unclaimed(ctx, transaction.id, document, invoiceId, expenseId)) available.push(transaction);
  }
  const match = inherited ?? (manualTransactionId ? available.find(t => t.id === manualTransactionId)
    : available.find(t => t.id === existingTransactionId) ?? (!candidates.limited && available.length === 1 ? available[0] : undefined));
  if (manualTransactionId && !match) throw new ConvexError("This transaction no longer fits the document or is already claimed");
  // Never replace a separate link on an existing accounting record silently.
  if (existingTransactionId && (!match || match.id !== existingTransactionId)) {
    await ctx.db.patch(document._id, { invoiceId, expenseId, status: "needs_review", matchReason: "An existing bank link needs review before this document can be attached" }); return;
  }
  let invoices = state.invoices;
  let expenses = state.expenses;
  if (extraction.kind === "invoice") {
    invoiceId ??= `document-invoice-${document._id}`;
    invoices = existingInvoice ? invoices.map(i => i.id === invoiceId ? { ...i, entity: extraction.entity!, ...(match ? { transactionId: match.id } : {}), updatedAt: now } : i) : [...invoices, {
      id: invoiceId, entity: extraction.entity, providerId: provider?.id, documentType: "sales_invoice" as const, origin: "manual" as const, customerName: extraction.counterparty,
      amount: extraction.amount, currency: extraction.currency, status: "open" as const, meritDeliveryStatus: "not-sent" as const, invoiceNumber: extraction.documentNumber || `DOC-${document._id.slice(-8)}`,
      issueDate: extraction.issueDate, dueDate: extraction.dueDate ?? extraction.issueDate, source: "manual" as const, description: extraction.description, revenueRunIds: [], transactionId: match?.id, createdAt: now, updatedAt: now
    }];
  } else {
    existingExpense ??= match ? expenses.find(e => e.transactionId === match.id) : undefined;
    expenseId = existingExpense?.id ?? expenseId ?? `document-expense-${document._id}`;
    const attachment = { id: `source-${document._id}`, kind: "vendor_receipt" as const, fileName: document.fileName, contentType: document.contentType, size: document.size, storageId: String(document.storageId), createdAt: document.createdAt };
    expenses = existingExpense ? expenses.map(e => e.id === expenseId ? { ...e, entity: extraction.entity!, documents: e.documents.some(d => d.storageId === document.storageId) ? e.documents : [...e.documents, attachment], ...(match ? { transactionId: match.id } : {}), updatedAt: now } : e) : [...expenses, {
      id: expenseId, entity: extraction.entity, recordNumber: `EXP-${document._id.slice(-8).toUpperCase()}`, recordType: "supplier_bill" as const, paymentStatus: "unpaid" as const,
      providerId: provider?.id, supplierName: extraction.counterparty, sourceDocumentNumber: extraction.documentNumber || undefined, issueDate: extraction.issueDate, dueDate: extraction.dueDate ?? undefined,
      category: "Uncategorized", businessPurpose: "", description: extraction.description, netAmount: extraction.amount, vatAmount: 0, grossAmount: extraction.amount, vatTreatment: "not_applicable" as const, currency: extraction.currency,
      documents: [attachment], transactionId: match?.id, createdAt: now, updatedAt: now
    }];
  }
  await ctx.db.patch(state._id, { invoices, expenses, updatedAt: new Date(Math.max(Date.now(), Date.parse(state.updatedAt) + 1)).toISOString() });
  const reason = inherited ? "Linked to the invoice’s existing bank match; payment status unchanged" : match ? manualTransactionId ? "Match confirmed by the finance team; payment remains unchanged" : "Exact total and currency, document date, company ownership, and counterparty/reference evidence" : available.length > 1 ? "Several bank transactions fit; review required" : "Waiting for a unique matching bank transaction";
  await ctx.db.patch(document._id, { invoiceId, expenseId, status: match ? "matched" : "unmatched", transactionId: match?.id, matchReason: reason, matchedAt: match ? now : undefined, nextMatchAt: match ? undefined : new Date(Date.now() + 5 * 60_000).toISOString() });
  if (match && invoiceId && !inherited) {
    const stored = await ctx.db.query("bankTransactions").withIndex("by_transaction_id", q => q.eq("id", match.id)).unique();
    if (stored) { await ctx.db.patch(stored._id, { matchedInvoiceId: invoiceId, invoiceMatchSource: manualTransactionId ? "manual" : "exact", invoiceMatchConfidence: 1, invoiceMatchReason: reason }); await bumpBankLedgerRevision(ctx, [stored.date]); }
  }
}

export const candidates = query({
  args: { serviceToken: v.string(), id: v.id("financialDocuments") },
  returns: v.array(v.object({ id: v.string(), date: v.string(), counterparty: v.string(), accountName: v.string(), amount: v.number(), currency: v.string() })),
  handler: async (ctx, args) => {
    authorize(args.serviceToken); const doc = await ctx.db.get(args.id); if (!doc?.extraction || doc.status !== "unmatched") return [];
    const candidates = await bankCandidates(ctx, doc.extraction, false); const rows = [];
    for (const tx of candidates.rows) if ((!tx.matchedInvoiceId || tx.matchedInvoiceId === doc.invoiceId) && await unclaimed(ctx, tx.id, doc, doc.invoiceId, doc.expenseId)) rows.push({ id: tx.id, date: tx.date, counterparty: tx.counterparty, accountName: tx.accountName, amount: tx.amount, currency: tx.currency });
    return rows.slice(0, 60);
  }
});
export const confirmMatch = mutation({
  args: { serviceToken: v.string(), id: v.id("financialDocuments"), transactionId: v.string() }, returns: v.null(),
  handler: async (ctx, args) => { authorize(args.serviceToken); const doc = await ctx.db.get(args.id); if (!doc?.extraction || doc.status !== "unmatched") throw new ConvexError("Only unmatched documents can be linked"); await recordAndMatch(ctx, doc, doc.extraction, args.transactionId); return null; }
});
export const discard = mutation({
  args: { serviceToken: v.string(), id: v.id("financialDocuments") }, returns: v.null(),
  handler: async (ctx, args) => {
    authorize(args.serviceToken); const doc = await ctx.db.get(args.id); if (!doc) return null;
    if (doc.invoiceId || doc.expenseId || !["needs_review", "failed"].includes(doc.status)) throw new ConvexError("Only unrecorded documents can be discarded");
    const key = `${doc.entity ?? "unassigned"}:${doc.month}`; const folder = await ctx.db.query("documentFolders").withIndex("by_key", q => q.eq("key", key)).unique();
    if (folder) await ctx.db.patch(folder._id, { count: Math.max(0, folder.count - 1) });
    await ctx.storage.delete(doc.storageId); await ctx.db.delete(doc._id); return null;
  }
});
export const forInvoice = query({
  args: { serviceToken: v.string(), invoiceId: v.string() }, returns: v.union(v.object({ id: v.id("financialDocuments"), fileName: v.string(), contentType: v.string(), url: v.union(v.string(), v.null()) }), v.null()),
  handler: async (ctx, args) => { authorize(args.serviceToken); const doc = await ctx.db.query("financialDocuments").withIndex("by_invoice", q => q.eq("invoiceId", args.invoiceId)).first(); return doc ? { id: doc._id, fileName: doc.fileName, contentType: doc.contentType, url: await ctx.storage.getUrl(doc.storageId) } : null; }
});

export const claim = internalMutation({
  args: { id: v.id("financialDocuments"), token: v.string() }, returns: v.boolean(),
  handler: async (ctx, { id, token }) => { const doc = await ctx.db.get(id); if (!doc || doc.status !== "queued") return false; await ctx.db.patch(id, { status: "processing", attemptToken: token, attempts: doc.attempts + 1, updatedAt: nowIso() }); await ctx.scheduler.runAfter(150_000, internal.documents.recover, { id, token }); return true; }
});
export const complete = internalMutation({
  args: { id: v.id("financialDocuments"), token: v.string(), extraction: documentExtraction }, returns: v.null(),
  handler: async (ctx, args) => { const doc = await ctx.db.get(args.id); if (doc?.attemptToken === args.token && doc.status === "processing") await recordAndMatch(ctx, doc, args.extraction); return null; }
});
export const recover = internalMutation({
  args: { id: v.id("financialDocuments"), token: v.string(), error: v.optional(v.string()) }, returns: v.null(),
  handler: async (ctx, args) => { const doc = await ctx.db.get(args.id); if (!doc || doc.attemptToken !== args.token || doc.status !== "processing") return null; const retry = doc.attempts < 3; await ctx.db.patch(doc._id, { status: retry ? "queued" : "failed", attemptToken: undefined, error: args.error?.slice(0, 400) ?? "Processing timed out", updatedAt: nowIso() }); if (retry) await ctx.scheduler.runAfter(5_000 * doc.attempts, internal.documentProcessing.process, { id: doc._id }); return null; }
});
export const retry = mutation({
  args: { serviceToken: v.string(), id: v.id("financialDocuments") }, returns: v.null(),
  handler: async (ctx, args) => { authorize(args.serviceToken); const doc = await ctx.db.get(args.id); if (!doc || !["failed", "needs_review"].includes(doc.status) || doc.invoiceId || doc.expenseId) throw new ConvexError("This document cannot be reprocessed"); await ctx.db.patch(doc._id, { status: "queued", attempts: 0, error: undefined }); await ctx.scheduler.runAfter(0, internal.documentProcessing.process, { id: doc._id }); return null; }
});
export const review = mutation({
  args: { serviceToken: v.string(), id: v.id("financialDocuments"), extraction: documentExtraction }, returns: v.null(),
  handler: async (ctx, args) => { authorize(args.serviceToken); const doc = await ctx.db.get(args.id); if (!doc || !["needs_review", "failed"].includes(doc.status)) throw new ConvexError("Only unrecorded documents can be reviewed"); const extraction = validateExtraction({ ...args.extraction, confidence: 1, reviewReasons: [] }); if (extraction.reviewReasons.length) throw new ConvexError(extraction.reviewReasons.join(". ")); await recordAndMatch(ctx, doc, extraction); return null; }
});
export const rematch = mutation({
  args: { serviceToken: v.string(), id: v.optional(v.id("financialDocuments")) }, returns: v.number(),
  handler: async (ctx, args) => { authorize(args.serviceToken); const rows = args.id ? [await ctx.db.get(args.id)] : await ctx.db.query("financialDocuments").withIndex("by_status_next_match", q => q.eq("status", "unmatched").lte("nextMatchAt", nowIso())).take(20); let count = 0; for (const doc of rows) { if (!doc?.extraction || !(doc.status === "unmatched" || args.id && doc.source === "archive" && doc.invoiceId && doc.status === "needs_review" && doc.extraction.reviewReasons.length === 0)) continue; await recordAndMatch(ctx, doc, doc.extraction); count++; } return count; }
});

// Backfill the archive from existing protected expense files, without copying their bytes.
export const archiveExpenses = mutation({
  args: { serviceToken: v.string() }, returns: v.number(),
  handler: async (ctx, args) => {
    authorize(args.serviceToken); const state = await ctx.db.query("dashboardState").withIndex("by_key", q => q.eq("key", "default")).unique(); if (!state) return 0;
    let count = 0;
    for (const expense of state.expenses) {
      for (const file of expense.documents) {
        const intakeKey = `archive:${file.storageId}`;
        if (await ctx.db.query("financialDocuments").withIndex("by_storage", q => q.eq("storageId", file.storageId as Id<"_storage">)).first()) continue;
        if (await ctx.db.query("financialDocuments").withIndex("by_intake_key", q => q.eq("intakeKey", intakeKey)).first()) continue;
        const storageId = ctx.db.system.normalizeId("_storage", file.storageId); if (!storageId) continue;
        const metadata = await ctx.db.system.get(storageId); if (!metadata) continue;
        const tx = expense.transactionId ? await ctx.db.query("bankTransactions").withIndex("by_transaction_id", q => q.eq("id", expense.transactionId!)).first() : null;
        const entity = expense.entity ?? tx?.wiseEntity ?? (tx ? wiseEntityFromAccountName(tx.accountName) : undefined);
        const month = expense.issueDate.slice(0, 7);
        await ctx.db.insert("financialDocuments", { storageId, contentHash: /^[a-f0-9]{64}$/.test(metadata.sha256) ? metadata.sha256 : Array.from(atob(metadata.sha256), c => c.charCodeAt(0).toString(16).padStart(2, "0")).join(""), intakeKey, fileName: file.fileName, contentType: file.contentType, size: file.size, source: "archive", sourceContext: "", entity, month, kind: "expense", status: expense.transactionId ? "matched" : "needs_review", expenseId: expense.id, transactionId: expense.transactionId, attempts: 0, createdAt: file.createdAt, updatedAt: nowIso(), extraction: { kind: "expense", entity: entity ?? null, counterparty: expense.supplierName, documentNumber: expense.sourceDocumentNumber ?? "", issueDate: expense.issueDate, dueDate: expense.dueDate ?? null, amount: expense.grossAmount, currency: expense.currency, description: expense.description, confidence: 1, reviewReasons: entity ? [] : ["Choose the company"] } });
        await moveFolder(ctx, null, { entity, month }); if (++count >= 40) return count;
      }
    }
    return count;
  }
});

export const backfillInvoiceLinks = mutation({
  args: { serviceToken: v.string() }, returns: v.number(),
  handler: async (ctx, args) => { authorize(args.serviceToken); const state = await ctx.db.query("dashboardState").withIndex("by_key", q => q.eq("key", "default")).unique(); if (!state) return 0; let changed = 0; const invoices = []; for (const invoice of state.invoices) { const txs = invoice.transactionId ? [] : await ctx.db.query("bankTransactions").withIndex("by_matched_invoice", q => q.eq("matchedInvoiceId", invoice.id)).take(2); if (txs.length === 1) { invoices.push({ ...invoice, transactionId: txs[0].id }); changed++; } else invoices.push(invoice); } if (changed) await ctx.db.patch(state._id, { invoices, updatedAt: nowIso() }); return changed; }
});


export const missingInvoiceOriginals = query({
  args: { serviceToken: v.string() }, returns: v.array(v.string()),
  handler: async (ctx, args) => {
    authorize(args.serviceToken); const state = await ctx.db.query("dashboardState").withIndex("by_key", q => q.eq("key", "default")).unique();
    const missing = [];
    for (const invoice of state?.invoices ?? []) {
      if (!invoice.externalId || invoice.documentType !== "sales_invoice") continue;
      const original = await ctx.db.query("financialDocuments").withIndex("by_invoice", q => q.eq("invoiceId", invoice.id)).first();
      if (!original) missing.push(invoice.id);
      if (missing.length >= 200) break;
    }
    return missing;
  }
});
