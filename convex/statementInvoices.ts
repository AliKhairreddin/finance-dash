import { applyStatementRules } from "./statementAutomation";
import { statementMember, requirePermission, requireScope, canReadScope } from "./statementAccess";
import { ConvexError, v } from "convex/values";
import { mutation, query, internalMutation, type QueryCtx, type MutationCtx } from "./_generated/server";
import type { Id, Doc } from "./_generated/dataModel";
import { statementCompany } from "./statementSchema";
import { normalizeStatementActor, statementAmountDecimal } from "../shared/statements";
import { invoiceLayout, invoiceSelectionLimit, invoiceText, validateInvoiceDraft, validateInvoiceAi, type InvoiceDraft, invoiceCompanyKey, validateInvoicePair, plainInvoiceParties, invoiceTotals } from "../shared/statementInvoices";
import { paginationOptsValidator } from "convex/server";
import { defaultInvoiceDesign, invoiceIssuerKey } from "../shared/statementInvoiceDesign";
import { statementCompanies } from "../shared/statements";
const auth = { serviceToken: v.string(), actor: v.string() };
async function access(ctx: QueryCtx | MutationCtx, a: { serviceToken: string; actor: string }, companyId?: string) {
  const member = await statementMember(ctx, a);
  if (companyId && !member.companyIds.some(id => id === companyId)) throw new ConvexError("Company access required");
  return member;
}
async function invoice(ctx: QueryCtx | MutationCtx, a: { serviceToken: string; actor: string; id: Id<"statementInvoices"> }) {
  const row = await ctx.db.get(a.id); if (!row) throw new ConvexError("Invoice not found"); const member = await access(ctx, a, row.companyId); requireScope(member, row); return row;
}
async function audit(ctx: MutationCtx, actor: string, id: string, action: string) { await ctx.db.insert("statementAudit", { actor, entityType: "invoice", entityId: id, action, details: "", createdAt: new Date().toISOString() }); }
async function addressesFor(ctx: QueryCtx | MutationCtx, companyId: Doc<"statementInvoiceTemplates">["companyId"],financialAccountId?:string) {
  const rows = (await Promise.all([companyId, "all" as const].map(scope => ctx.db.query("statementAddresses").withIndex("by_companyId", q => q.eq("companyId", scope)).take(500)))).flat();
  return rows.filter(a=>!a.financialAccountId||a.financialAccountId===financialAccountId).map(a => ({ name: a.name, invoiceName: a.invoiceName, vat: a.vat, description: a.description, aliases: a.aliases, reviewNote: a.reviewNote, address: [a.addressLine1, a.addressLine2, [a.postalCode, a.city].filter(Boolean).join(" "), a.country].filter(Boolean).join("\n") }));
}
async function issuer(ctx: QueryCtx | MutationCtx, companyId: Doc<"statementInvoiceTemplates">["companyId"], name: string) {
  const ours = statementCompanies.find(c => c.id === companyId)!;
  return invoiceIssuerKey(name, companyId, invoiceCompanyKey(name) === invoiceCompanyKey(ours.name) ? "in" : "out", await addressesFor(ctx, companyId));
}
async function exampleFor(ctx: QueryCtx | MutationCtx, member: Doc<"statementMembers">, issuerKey: string) {
  const rows = await ctx.db.query("statementInvoiceTemplates").withIndex("by_issuer_approved", q => q.eq("issuerKey", issuerKey).eq("approved", true)).order("desc").take(100);
  return rows.find(row => member.companyIds.includes(row.companyId)) ?? null;
}
async function automaticNumber(ctx: MutationCtx, companyId: Doc<"statementInvoices">["companyId"], date: string, documentType: string) {
  const year = date.slice(0, 4), issuerKey = `legal:${companyId}`;
  const prefixes = { "amg-holding": "AMG", artec: "ARTEC", "inch-engineering": "INCH", "digital-nudge": "DN", "inch-digital": "IND", "mzs-bouw": "MZS", lovemedo: "LMD" };
  const counter = await ctx.db.query("statementNumberSequences").withIndex("by_issuer_type_year", q => q.eq("issuerKey", issuerKey).eq("documentType", documentType).eq("year", year)).unique();
  const next = counter?.next ?? 1;
  if (counter) await ctx.db.patch(counter._id, { next: next + 1 }); else await ctx.db.insert("statementNumberSequences", { issuerKey, documentType, year, next: next + 1 });
  return `${prefixes[companyId]}-${documentType === "internal_support" ? "SUP" : "INV"}-${year}-${String(next).padStart(6, "0")}`;
}
async function refreshTransactionInvoice(ctx: MutationCtx, transactionId: Id<"statementTransactions">) {
  const transaction = await ctx.db.get(transactionId); if (!transaction) return;
  const links = await ctx.db.query("statementInvoiceTransactions").withIndex("by_transaction", q => q.eq("transactionId", transactionId)).order("desc").take(100);
  for (const link of links.sort((a, b) => b.createdAt - a.createdAt || b._creationTime - a._creationTime)) {
    const saved = await ctx.db.get(link.invoiceId);
    if (!saved || !["draft", "ready"].includes(saved.state) || saved.companyId !== transaction.companyId) continue;
    const source = (JSON.parse(saved.sourceJson) as Array<{transactionId: string; revision: number}>).find(s => s.transactionId === transactionId);
    if (source?.revision !== (transaction.financialRevision ?? transaction.revision)) continue;
    await ctx.db.patch(transactionId, { generatedInvoiceId: saved._id, generatedInvoiceNumber: saved.number, generatedInvoiceState: saved.state as "draft" | "ready" }); return;
  }
  await ctx.db.patch(transactionId, { generatedInvoiceId: undefined, generatedInvoiceNumber: undefined, generatedInvoiceState: undefined });
}
async function indexInvoice(ctx: MutationCtx, id: Id<"statementInvoices">) {
  const row = await ctx.db.get(id); if (!row) return;
  const links = await ctx.db.query("statementInvoiceTransactions").withIndex("by_invoice", q => q.eq("invoiceId", id)).take(201);
  for (const source of JSON.parse(row.sourceJson) as Array<{transactionId: Id<"statementTransactions">}>) {
    if (!links.some(l => l.transactionId === source.transactionId)) await ctx.db.insert("statementInvoiceTransactions", { invoiceId: id, transactionId: source.transactionId, createdAt: row.createdAt });
    await refreshTransactionInvoice(ctx, source.transactionId);
  }
}
export const backfillTransactionInvoices = internalMutation({ args: { paginationOpts: paginationOptsValidator }, returns: v.object({ isDone: v.boolean(), continueCursor: v.string() }), handler: async (ctx, a) => {
  const page = await ctx.db.query("statementInvoices").paginate({ ...a.paginationOpts, numItems: Math.min(a.paginationOpts.numItems, 20) });
  for (const row of page.page) if (["ready", "draft"].includes(row.state)) await indexInvoice(ctx, row._id);
  return { isDone: page.isDone, continueCursor: page.continueCursor };
} });
export const templates = query({ args: auth, returns: v.string(), handler: async (ctx, a) => {
  const member = await access(ctx, a), latest = new Map<string, Doc<"statementInvoiceTemplates">>();
  for (const companyId of member.companyIds) for (const row of await ctx.db.query("statementInvoiceTemplates").withIndex("by_company", q => q.eq("companyId", companyId)).order("desc").take(200)) if (!latest.has(row.issuerKey) || latest.get(row.issuerKey)!.createdAt < row.createdAt) latest.set(row.issuerKey, row);
  return JSON.stringify([...latest.values()].map(row => ({ id: row._id, companyId: row.companyId, issuerName: row.issuerName, fileName: row.fileName, layout: row.layoutJson ? JSON.parse(row.layoutJson) : null, approved: row.approved, analysisState: row.analysisState, analysisLeaseUntil: row.analysisLeaseUntil, analysisError: row.analysisError })));
} });
export const template = query({ args: { ...auth, id: v.id("statementInvoiceTemplates") }, returns: v.string(), handler: async (ctx, a) => {
  const row = await ctx.db.get(a.id); if (!row) throw new ConvexError("Example not found"); await access(ctx, a, row.companyId);
  return JSON.stringify({ ...row, url: await ctx.storage.getUrl(row.storageId) });
} });
export const saveTemplate = mutation({ args: { ...auth, companyId: statementCompany, issuerName: v.string(), storageId: v.id("_storage"), fileName: v.string(), layoutJson: v.string(), model: v.string(), costUsd: v.optional(v.number()) }, returns: v.id("statementInvoiceTemplates"), handler: async (ctx, a) => {
  const member = await access(ctx, a, a.companyId); requirePermission(member,"settings"); if (!member.manage) throw new ConvexError("Settings access required");
  const file = await ctx.db.system.get(a.storageId); if (!file || file.size > 5 * 1024 * 1024) throw new ConvexError("Use an example PDF under 5 MB");
  const id = await ctx.db.insert("statementInvoiceTemplates", { companyId: a.companyId, issuerKey: await issuer(ctx, a.companyId, a.issuerName), issuerName: invoiceText(a.issuerName, "invoice issuer", 250, true), storageId: a.storageId, fileName: invoiceText(a.fileName, "file name", 250, true), layoutJson: JSON.stringify(invoiceLayout(JSON.parse(a.layoutJson))), approved: false, actor: member.actor, createdAt: Date.now(), model: a.model, costUsd: a.costUsd });
  await audit(ctx, member.actor, id, "example_uploaded"); return id;
} });
export const uploadExample = mutation({ args: { ...auth, companyId: statementCompany, issuerName: v.string(), storageId: v.id("_storage"), fileName: v.string() }, returns: v.id("statementInvoiceTemplates"), handler: async (ctx, a) => {
  const member = await access(ctx, a, a.companyId); requirePermission(member,"settings"); if (!member.manage) throw new ConvexError("Settings access required");
  const file = await ctx.db.system.get(a.storageId); if (!file || file.size > 5 * 1024 * 1024) throw new ConvexError("Use an example PDF under 5 MB");
  const id = await ctx.db.insert("statementInvoiceTemplates", { companyId: a.companyId, issuerKey: await issuer(ctx, a.companyId, a.issuerName), issuerName: invoiceText(a.issuerName, "invoice issuer", 250, true), storageId: a.storageId, fileName: invoiceText(a.fileName, "file name", 250, true), layoutJson: "", approved: false, actor: member.actor, createdAt: Date.now(), model: "", analysisState: "failed" });
  await audit(ctx, member.actor, id, "example_uploaded"); return id;
} });
export const claimExample = mutation({ args: { ...auth, id: v.id("statementInvoiceTemplates"), token: v.string() }, returns: v.boolean(), handler: async (ctx, a) => {
  const row = await ctx.db.get(a.id); if (!row) throw new ConvexError("Example not found");
  const member = await access(ctx, a, row.companyId); requirePermission(member,"settings"); if (!member.manage) throw new ConvexError("Settings access required");
  if (row.approved || row.analysisState === "done" || (row.analysisLeaseUntil ?? 0) > Date.now()) return false;
  await ctx.db.patch(row._id, { analysisState: "reading", analysisToken: a.token, analysisLeaseUntil: Date.now() + 420000, analysisError: undefined }); return true;
} });
export const completeExample = mutation({ args: { ...auth, id: v.id("statementInvoiceTemplates"), token: v.string(), layoutJson: v.optional(v.string()), model: v.optional(v.string()), costUsd: v.optional(v.number()), error: v.optional(v.string()) }, returns: v.null(), handler: async (ctx, a) => {
  const row = await ctx.db.get(a.id); if (!row) throw new ConvexError("Example not found");
  const member = await access(ctx, a, row.companyId); requirePermission(member,"settings"); if (!member.manage || row.analysisToken !== a.token || row.analysisState !== "reading") throw new ConvexError("This example is being handled by another request");
  const result = a.error ? { analysisState: "failed" as const, analysisError: invoiceText(a.error, "error", 500) } : { analysisState: "done" as const, analysisError: undefined, layoutJson: JSON.stringify(invoiceLayout(JSON.parse(a.layoutJson!))), model: a.model!, costUsd: a.costUsd };
  await ctx.db.patch(row._id, { ...result, analysisToken: undefined, analysisLeaseUntil: 0 }); return null;
} });
export const approveTemplate = mutation({ args: { ...auth, id: v.id("statementInvoiceTemplates"), layoutJson: v.string(), confirmed: v.boolean() }, returns: v.id("statementInvoiceTemplates"), handler: async (ctx, a) => {
  const old = await ctx.db.get(a.id); if (!old) throw new ConvexError("Example not found"); const member = await access(ctx, a, old.companyId);
  requirePermission(member,"settings"); if (!member.manage || !a.confirmed) throw new ConvexError("Check the example layout before saving it");
  if (old.analysisState && old.analysisState !== "done") throw new ConvexError("Read the example successfully before checking its layout");
  const checkedLayout = invoiceLayout(JSON.parse(a.layoutJson));
  if (!checkedLayout.copy) throw new ConvexError("Read and preview the full example layout before saving it");
  const { _id, _creationTime, ...data } = old;
  const id = await ctx.db.insert("statementInvoiceTemplates", { ...data, layoutJson: JSON.stringify(checkedLayout), approved: true, actor: member.actor, createdAt: Date.now() });
  await audit(ctx, member.actor, id, "example_approved"); return id;
} });
export const list = query({ args: auth, returns: v.string(), handler: async (ctx, a) => {
  const member = await access(ctx, a), rows = [];
  for (const companyId of member.companyIds) rows.push(...await ctx.db.query("statementInvoices").withIndex("by_company", q => q.eq("companyId", companyId)).order("desc").take(101));
  return JSON.stringify({ truncated: rows.length > 100, invoices: rows.filter(r => canReadScope(member, r)).sort((x, y) => y.createdAt - x.createdAt).slice(0, 100).map(row => ({ id: row._id, companyId: row.companyId, number: JSON.parse(row.draftJson).number, state: row.state, financialAccountId: row.financialAccountId, documentType: row.documentType, date: JSON.parse(row.draftJson).date, currency: JSON.parse(row.draftJson).currency, amount: invoiceTotals(JSON.parse(row.draftJson)).total, downloadedAt: row.downloadedAt, createdAt: row.createdAt, customer: JSON.parse(row.draftJson).customer })) });
} });
async function selectedTransactions(ctx: QueryCtx | MutationCtx, a: { serviceToken: string; actor: string; ids: Id<"statementTransactions">[] }) {
  await access(ctx, a);
  if (!a.ids.length || a.ids.length > invoiceSelectionLimit || new Set(a.ids).size !== a.ids.length) throw new ConvexError(`Choose 1–${invoiceSelectionLimit} different transactions`);
  const rows = await Promise.all(a.ids.map(id => ctx.db.get(id))), first = rows[0];
  if (!first?.companyId || rows.some(row => !row || row.deletedAt || row.companyId !== first.companyId || row.currency !== first.currency || row.direction !== first.direction)) throw new ConvexError("Choose transactions from one company, one currency and one direction");
  const member = await access(ctx, a, first.companyId);
  for (const row of rows) requireScope(member, row!);
  if (rows.some(r => r!.financialAccountId !== first.financialAccountId)) throw new ConvexError("Choose one financial account for a document");
  return { rows, first, companyId: first.companyId };
}
export const setup = query({ args: { ...auth, ids: v.array(v.id("statementTransactions")) }, returns: v.string(), handler: async (ctx, a) => {
  const { rows, first, companyId } = await selectedTransactions(ctx, a);
  const profiles = (await ctx.db.query("statementInvoiceProfiles").withIndex("by_company_updated", q => q.eq("companyId", companyId)).order("desc").take(500)).filter(p=>p.financialAccountId===first.financialAccountId);
  const addresses = (await Promise.all([companyId, "all" as const].map(scope => ctx.db.query("statementAddresses").withIndex("by_companyId", q => q.eq("companyId", scope)).take(500)))).flat().filter(a=>!a.financialAccountId||a.financialAccountId===first.financialAccountId);
  const merchants = await ctx.db.query("statementMerchants").withIndex("by_company", q => q.eq("companyId", companyId)).take(500);
  const approvedMerchants = merchants.filter(m => m.approvedJson && m.financialAccountId === first.financialAccountId).map(m => { const p = JSON.parse(m.approvedJson!); return { name: m.name, invoiceName: p.canonicalName, address: p.address, description: p.description, aliases: m.aliases }; });
  const uniqueAddresses = new Map<string, typeof addresses[number]>();
  for (const address of addresses) if (!uniqueAddresses.has(invoiceCompanyKey(address.name))) uniqueAddresses.set(invoiceCompanyKey(address.name), address);
  const sellerName = first.direction === "out" ? first.counterparty ?? "" : statementCompanies.find(c => c.id === companyId)!.name;
  const example = await exampleFor(ctx, await access(ctx, a), invoiceIssuerKey(sellerName, companyId, first.direction, await addressesFor(ctx, companyId)));
  return JSON.stringify({ companyId, direction: first.direction, hasExample: example?.approved === true, exampleIssuer: example?.issuerName, profiles: profiles.slice(0, 100).map(p => ({ details: JSON.parse(p.detailsJson), revision: p.revision, updatedAt: p.updatedAt })), profilesTruncated: profiles.length > 100, addresses: [...approvedMerchants, ...[...uniqueAddresses.values()].map(a => ({ name: a.name, invoiceName: a.invoiceName, vat: a.vat, description: a.description, aliases: a.aliases, reviewNote: a.reviewNote, address: [a.addressLine1, a.addressLine2, [a.postalCode, a.city].filter(Boolean).join(" "), a.country].filter(Boolean).join("\n") }))], sources: rows.map(r => ({ transactionId: r!._id, description: r!.description, counterparty: r!.counterparty ?? "" })) });
} });
export const get = query({ args: { ...auth, id: v.id("statementInvoices"), download: v.optional(v.boolean()) }, returns: v.string(), handler: async (ctx, a) => {
  requirePermission(await access(ctx, a), a.download ? "download" : "documents");
  const row = await invoice(ctx, a), example = row.templateId ? await ctx.db.get(row.templateId) : null;
  if (!example && !row.plainLayoutJson) throw new ConvexError("Invoice layout missing or invalid");
  const templateUrl = example ? await ctx.storage.getUrl(example.storageId) : null;
  if (example && !templateUrl) throw new ConvexError("The saved example PDF is missing");
  return JSON.stringify({ ...row, draft: JSON.parse(row.draftJson), sources: JSON.parse(row.sourceJson), layout: JSON.parse(row.plainLayoutJson ?? example!.layoutJson), templateUrl, pdfUrl: row.storageId ? await ctx.storage.getUrl(row.storageId) : null });
} });
export const begin = mutation({ args: { ...auth, requestId: v.string(), ids: v.array(v.id("statementTransactions")), draftJson: v.string(), instructions: v.string(), plainDetailsJson: v.optional(v.string()), remember: v.optional(v.boolean()), profileRevision: v.optional(v.number()), regenerate: v.optional(v.boolean()) }, returns: v.id("statementInvoices"), handler: async (ctx, a) => {
  const member = await access(ctx, a); requirePermission(member, "generate");
  if (!/^[a-f0-9-]{36}$/i.test(a.requestId) || !a.ids.length || a.ids.length > invoiceSelectionLimit || new Set(a.ids).size !== a.ids.length) throw new ConvexError(`Choose 1–${invoiceSelectionLimit} different transactions`);
  const previous = await ctx.db.query("statementInvoices").withIndex("by_request", q => q.eq("requestId", a.requestId)).unique();
  if (previous) { await access(ctx, a, previous.companyId); requireScope(member, previous); if (JSON.parse(previous.sourceJson).map((s: { transactionId: string }) => s.transactionId).sort().join() !== [...a.ids].sort().join()) throw new ConvexError("Request ID already used for another selection"); return previous._id; }
  const { rows, first, companyId } = await selectedTransactions(ctx, a);
  if(companyId==="lovemedo"&&!first.financialAccountId)throw new ConvexError("Review the transaction and choose its financial account before generation");
  if(rows.some(r=>r!.reviewReasons.length))throw new ConvexError("Resolve the transaction review issues before generation");
  const policies = await ctx.db.query("statementPolicies").withIndex("by_company", q => q.eq("companyId", companyId)).take(100);
  const legalPolicy = policies.find(p => !p.financialAccountId), policy = legalPolicy ? JSON.parse(legalPolicy.settingsJson) : {};
  const documentType = first.direction === "in" && policy.salesInvoiceApproved === true ? "sales_invoice" : "internal_support";
  if (documentType === "sales_invoice" && (!policy.legalName?.trim() || !policy.legalAddress?.trim() || !policy.taxPolicy?.trim() || !/^\d{1,3}(?:\.\d{1,2})?$/.test(policy.taxRate ?? "") || Number(policy.taxRate) > 100 || !["transaction", "generation"].includes(policy.invoiceDatePolicy))) throw new ConvexError("Complete the approved legal issuer, tax and document-date policy in Settings");
  const businessKey = JSON.stringify([documentType, companyId, first.financialAccountId ?? null, rows.map(r => [r!._id, r!.financialRevision ?? r!.revision]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))]);
  const active = await ctx.db.query("statementInvoices").withIndex("by_businessKey", q => q.eq("businessKey", businessKey)).order("desc").take(100);
  const current = active.find(i => !["discarded", "cancelled", "stale", "superseded"].includes(i.state));
  if (current && !a.regenerate) return current._id;
  if (current && a.regenerate && current.state !== "ready") return current._id;
  let predecessorId = current?._id ?? active.find(i => i.state === "stale")?._id;
  // An overlapping request cannot produce a second active document for a transaction.
  for (const row of rows) {
    const links = await ctx.db.query("statementInvoiceTransactions").withIndex("by_transaction", q => q.eq("transactionId", row!._id)).take(201);
    if (links.length > 200) throw new ConvexError("Review document history before generation");
    for (const link of links) { const other = await ctx.db.get(link.invoiceId); if (other?.state === "stale" && !predecessorId) predecessorId = other._id; if (other && !["discarded", "cancelled", "stale", "superseded"].includes(other.state) && other.businessKey !== businessKey) throw new ConvexError("A selected transaction already belongs to another active document"); }
  }
  const pair = a.plainDetailsJson ? validateInvoicePair(JSON.parse(a.plainDetailsJson)) : null;
  const addresses = await addressesFor(ctx, companyId, first.financialAccountId);
  if (new Set(rows.map(r => invoiceIssuerKey(r!.counterparty ?? "", companyId, "out", addresses))).size > 1) throw new ConvexError("Choose transactions with the same other company for one invoice");
  if (!pair) throw new ConvexError("Enter approved company and counterparty details");
  if (documentType === "sales_invoice") pair.ours = { name: policy.legalName, address: policy.legalAddress, vat: policy.vat ?? "" };
  const issuerKey = `our:${companyId}`, sellerName = pair.ours.name;
  // Supporting records are issued internally. Supplier examples cannot authorize impersonation.
  const parties = plainInvoiceParties(pair, "in");
  const example = null;
  let design = await ctx.db.query("statementInvoiceDesigns").withIndex("by_issuer", q => q.eq("issuerKey", issuerKey)).unique();
  if (!design) {
    const template = ["corporate","minimal","technology","insurance","professional_services","retail","subscription"].includes(policy.businessCategory) ? policy.businessCategory : "corporate";
    const designJson=JSON.stringify({...defaultInvoiceDesign(issuerKey,sellerName),template});
    const id = await ctx.db.insert("statementInvoiceDesigns", { issuerKey, designJson,version:1,style:template,brandingAuthorized:false,createdAt: Date.now() });
    await ctx.db.insert("statementTemplateVersions",{companyId,version:1,style:template,designJson,brandingAuthorized:false,actor:member.actor,createdAt:Date.now()});design = (await ctx.db.get(id))!;
  }
  const layout = parties.layout; layout.design = JSON.parse(design.designJson); if (!design.brandingAuthorized && layout.design) { delete layout.design.logoPath; delete layout.design.logoDataUrl; delete layout.design.source; }
  if (pair && a.remember) {
    const otherKey = invoiceCompanyKey(pair.other.name), old = await ctx.db.query("statementInvoiceProfiles").withIndex("by_company_account_other", q => q.eq("companyId", companyId).eq("financialAccountId", first.financialAccountId).eq("otherKey", otherKey)).unique();
    if ((old?.revision ?? 0) !== a.profileRevision) throw new ConvexError("Saved company details changed. Close this form and open it again before saving");
    const fields = { detailsJson: JSON.stringify(pair), revision: (old?.revision ?? 0) + 1, updatedAt: Date.now(), actor: member.actor };
    const profileId = old ? (await ctx.db.patch(old._id, fields), old._id) : await ctx.db.insert("statementInvoiceProfiles", { companyId, financialAccountId:first.financialAccountId, otherKey, ...fields });
    await audit(ctx, member.actor, profileId, "company_details_saved");
  }
  const input = JSON.parse(a.draftJson) as InvoiceDraft;
  input.documentType = documentType; input.taxAssessment = documentType === "sales_invoice" ? "configured" : "unassessed"; input.taxMode = "included"; input.dueDate = "";
  input.date = documentType === "sales_invoice" && policy.invoiceDatePolicy === "generation" ? new Date().toISOString().slice(0,10) : rows.map(r => r!.date).sort().at(-1)!;
  input.number = await automaticNumber(ctx, companyId, input.date, documentType);
  const sources = rows.map(row => ({ transactionId: row!._id, revision: row!.financialRevision ?? row!.revision, date: row!.date, description: row!.description, amount: statementAmountDecimal(row!.amountMinor, first.currency), counterparty: row!.counterparty ?? "" }));
  const draft = validateInvoiceDraft({ ...input, ...(parties ? { customer: parties.customer, customerAddress: parties.customerAddress, customerVat: parties.customerVat } : {}), currency: first.currency, lines: sources.map(row => ({ transactionId: row.transactionId, description: row.description, amount: row.amount, taxPercent: documentType === "sales_invoice" ? String(policy.taxRate) : "0" })) });
  if (await ctx.db.query("statementInvoices").withIndex("by_company_number", q => q.eq("companyId", first.companyId!).eq("number", draft.number)).first()) throw new ConvexError(`Invoice number ${draft.number} is already used for this company. Open it in Created invoices, or enter a different number.`);
  const id = await ctx.db.insert("statementInvoices", { companyId, financialAccountId: first.financialAccountId, businessKey, documentType, predecessorId, templateVersion: design.version ?? 0, plainLayoutJson: JSON.stringify(layout), requestId: a.requestId, pairDetailsJson: JSON.stringify(pair), draftJson: JSON.stringify(draft), sourceJson: JSON.stringify(sources), instructions: invoiceText([pair?.description, a.instructions].filter(Boolean).join("\n"), "instructions", 2501), state: "failed", leaseUntil: 0, revision: 1, createdAt: Date.now(), updatedAt: Date.now(), actor: member.actor, number: draft.number });
  await indexInvoice(ctx, id);
  await audit(ctx, member.actor, id, "supporting_document_created"); return id;
} });
export const claim = mutation({ args: { ...auth, id: v.id("statementInvoices"), token: v.string() }, returns: v.boolean(), handler: async (ctx, a) => {
  const row = await invoice(ctx, a); requirePermission(await access(ctx, a), "generate"); if (!["failed", "preparing"].includes(row.state) || row.leaseUntil > Date.now()) return false;
  await ctx.db.patch(row._id, { state: "preparing", error: undefined, leaseToken: a.token, leaseUntil: Date.now() + 300000, updatedAt: Date.now() }); return true;
} });
export const generated = mutation({ args: { ...auth, id: v.id("statementInvoices"), token: v.string(), resultJson: v.optional(v.string()), model: v.optional(v.string()), costUsd: v.optional(v.number()), error: v.optional(v.string()) }, returns: v.null(), handler: async (ctx, a) => {
  const row = await invoice(ctx, a); requirePermission(await access(ctx, a), "generate"); if (row.leaseToken !== a.token || row.state !== "preparing") throw new ConvexError("This draft is being handled by another request");
  if (a.error) { await ctx.db.patch(row._id, { state: "failed", error: a.error.slice(0, 500), leaseUntil: 0, leaseToken: undefined }); return null; }
  const draft = validateInvoiceDraft(JSON.parse(row.draftJson)), lines = validateInvoiceAi(JSON.parse(a.resultJson!), draft.lines.map(l => l.transactionId));
  draft.lines = draft.lines.map(line => ({ ...line, description: lines.find(r => r.transactionId === line.transactionId)!.description }));
  await ctx.db.patch(row._id, { draftJson: JSON.stringify(draft), state: "draft", model: a.model, costUsd: a.costUsd, leaseToken: undefined, leaseUntil: 0, revision: row.revision + 1, updatedAt: Date.now() }); await indexInvoice(ctx, row._id); return null;
} });
export const save = mutation({ args: { ...auth, id: v.id("statementInvoices"), revision: v.number(), draftJson: v.string() }, returns: v.null(), handler: async (ctx, a) => {
  const row = await invoice(ctx, a); requirePermission(await access(ctx, a), "generate"); if (row.state !== "draft" || row.revision !== a.revision) throw new ConvexError("Reload this draft before editing");
  const draft = validateInvoiceDraft(JSON.parse(a.draftJson)), old = validateInvoiceDraft(JSON.parse(row.draftJson));
  if (draft.currency !== old.currency || draft.lines.length !== old.lines.length || draft.lines.some(l => !old.lines.some(x => x.transactionId === l.transactionId))) throw new ConvexError("Keep the selected transactions and currency");
  if (draft.number !== old.number || draft.documentType !== old.documentType || draft.taxAssessment !== old.taxAssessment || draft.lines.some(l => l.amount !== old.lines.find(x => x.transactionId === l.transactionId)!.amount || l.taxPercent !== old.lines.find(x => x.transactionId === l.transactionId)!.taxPercent) || draft.taxMode !== "included") throw new ConvexError("Keep the legal document number, recorded amounts and unassessed tax treatment");
  const duplicate = await ctx.db.query("statementInvoices").withIndex("by_company_number", q => q.eq("companyId", row.companyId).eq("number", draft.number)).first();
  if (duplicate && duplicate._id !== row._id) throw new ConvexError(`Invoice number ${draft.number} is already used for this company. Open it in Created invoices, or enter a different number.`);
  await ctx.db.patch(row._id, { draftJson: JSON.stringify(draft), number: draft.number, revision: row.revision + 1, updatedAt: Date.now() }); await indexInvoice(ctx, row._id); await audit(ctx, a.actor, row._id, "draft_updated"); return null;
} });
export const claimRender = mutation({ args: { ...auth, id: v.id("statementInvoices"), token: v.string(), release: v.optional(v.boolean()) }, returns: v.boolean(), handler: async (ctx, a) => {
  const row = await invoice(ctx,a); requirePermission(await access(ctx,a),"generate");
  if (a.release) { if (row.leaseToken === a.token) await ctx.db.patch(row._id,{leaseToken:undefined,leaseUntil:0}); return false; }
  if (row.state !== "draft" || row.leaseUntil > Date.now()) return false;
  await ctx.db.patch(row._id,{leaseToken:a.token,leaseUntil:Date.now()+300000}); return true;
} });
export const finalize = mutation({ args: { ...auth, id: v.id("statementInvoices"), revision: v.number(), storageId: v.id("_storage"), confirmed: v.boolean(), renderToken: v.optional(v.string()) }, returns: v.null(), handler: async (ctx, a) => {
  const row = await invoice(ctx, a); requirePermission(await access(ctx, a), "generate"); if (row.state === "ready") return null; if (row.leaseToken && row.leaseToken !== a.renderToken) throw new ConvexError("Another request is rendering this document"); if (row.state !== "draft" || row.revision !== a.revision) throw new ConvexError("Check the latest draft before saving the final invoice");
  const file = await ctx.db.system.get(a.storageId); if (!file || file.size > 15 * 1024 * 1024) throw new ConvexError("The invoice PDF could not be saved");
  for (const source of JSON.parse(row.sourceJson) as Array<{ transactionId: Id<"statementTransactions">; revision: number }>) { const current = await ctx.db.get(source.transactionId); if (!current || current.deletedAt || current.companyId !== row.companyId || (current.financialRevision ?? current.revision) !== source.revision) throw new ConvexError("A selected transaction changed. Create a new draft from the updated transactions"); }
  const draft = validateInvoiceDraft(JSON.parse(row.draftJson));
  const sources = JSON.parse(row.sourceJson) as Array<{ transactionId: Id<"statementTransactions"> }>;
  const stamp = new Date().toISOString();
  const docId = await ctx.db.insert("statementDocuments", { companyId: row.companyId, financialAccountId: row.financialAccountId, fileName: `${row.number}.pdf`, contentType: "application/pdf", size: file.size, storageId: a.storageId, contentHash: `generated:${row._id}`, origin: "file", status: "ready", documentType: row.documentType === "sales_invoice" ? "invoice" : "supporting", evidence: [], reviewReasons: [], attempts: 0, quarantined: false, transactionIds: sources.map(s => s.transactionId), createdAt: stamp, updatedAt: stamp, generatedInvoiceId: row._id, extracted: JSON.stringify({ amount: invoiceTotals(draft).total, currency: draft.currency }) });
  for (const source of sources) { const txn = (await ctx.db.get(source.transactionId))!;
    const links = await ctx.db.query("statementLinks").withIndex("by_transactionId", q => q.eq("transactionId", txn._id)).take(201);
    // Superseded generated allocations are removed; the original document and its audit remain.
    for (const link of links) { const old = await ctx.db.get(link.documentId); if (old?.generatedInvoiceId) await ctx.db.delete(link._id); }
    const nonGenerated = await Promise.all(links.map(async l => ({ l, doc: await ctx.db.get(l.documentId) })));
    const allocated = nonGenerated.filter(x => !x.doc?.generatedInvoiceId).reduce((sum, x) => sum + BigInt(x.l.amountMinor), 0n);
    if (allocated === 0n) await ctx.db.insert("statementLinks", { transactionId: txn._id, documentId: docId, amountMinor: txn.amountMinor, currency: txn.currency, note: "Internal supporting document; no supplier invoice or payment assertion", createdBy: a.actor, createdAt: stamp });
    await ctx.db.patch(txn._id, { documentIds: [...new Set([...txn.documentIds, docId])], documentState: "available" });
  }
  if (row.predecessorId) await ctx.db.patch(row.predecessorId, { state: "superseded", supersededBy: row._id, updatedAt: Date.now() });
  await ctx.db.patch(row._id, { state: "ready", leaseToken: undefined, leaseUntil: 0, storageId: a.storageId, revision: row.revision + 1, updatedAt: Date.now() }); await indexInvoice(ctx, row._id); for(const source of sources)await applyStatementRules(ctx,source.transactionId); await audit(ctx, a.actor, row._id, "invoice_finalized"); return null;
} });
export const discard = mutation({ args: { ...auth, id: v.id("statementInvoices") }, returns: v.null(), handler: async (ctx, a) => {
  const row = await invoice(ctx, a); requirePermission(await access(ctx, a), "generate"); if (!["draft", "failed"].includes(row.state)) throw new ConvexError("Only unfinished drafts can be discarded");
  // Retain the draft and source history while releasing its unused invoice number.
  await ctx.db.patch(row._id, { state: "discarded", number: `discarded:${row._id}`, revision: row.revision + 1, updatedAt: Date.now() }); await indexInvoice(ctx, row._id); await audit(ctx, a.actor, row._id, "draft_discarded"); return null;
} });
export const profile = query({ args: { ...auth, companyId: statementCompany, financialAccountId:v.optional(v.string()), otherName: v.string() }, returns: v.string(), handler: async (ctx, a) => {
  const member=await access(ctx, a, a.companyId);requireScope(member,a);
  const otherKey = invoiceCompanyKey(invoiceText(a.otherName, "company name", 250));
  const row = await ctx.db.query("statementInvoiceProfiles").withIndex("by_company_account_other", q => q.eq("companyId", a.companyId).eq("financialAccountId",a.financialAccountId).eq("otherKey", otherKey)).unique();
  return JSON.stringify(row ? { details: JSON.parse(row.detailsJson), revision: row.revision, updatedAt: row.updatedAt } : null);
} });

export const history = query({args:{...auth,id:v.id("statementInvoices")},returns:v.string(),handler:async(ctx,a)=>{
  const selected=await invoice(ctx,a), member=await access(ctx,a), source=JSON.parse(selected.sourceJson)[0];
  if(!source)return "[]";
  const links=await ctx.db.query("statementInvoiceTransactions").withIndex("by_transaction",q=>q.eq("transactionId",source.transactionId)).order("desc").take(200);
  const rows=[];for(const link of links){const row=await ctx.db.get(link.invoiceId);if(row&&canReadScope(member,row))rows.push({id:row._id,number:row.number,state:row.state,createdAt:row.createdAt,actor:row.actor,templateVersion:row.templateVersion,file:Boolean(row.storageId)});}
  return JSON.stringify(rows);
}});
