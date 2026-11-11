import { bumpBankLedgerRevision } from "./dashboard";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { trackerDelivery, trackerItem, trackerReceipt, trackerReport, trackerReportRow, trackerRule } from "./receivablesSchema";
import { defaultTrackerRules, resolveTrackerDate, sameTrackerReceipt, trackerAmounts, trackerBankEligible, trackerCents, trackerClock, trackerGroupKey, trackerMatchReason, trackerMoney, trackerPayer, trackerProvider, trackerSourceKey, trackerWeek, validTrackerDate, type TrackerItem, type TrackerReportRow } from "../shared/receivablesTracker";
import { applyPaymentState, invoiceOutstanding } from "../shared/income";
import { plain, queueTrackerEvent, recordTrackerReceipt, reconcileTrackerInvoices, trackerAudit, trackerAuth, trackerItemByKey, trackerItems, trackerLimit, trackerNow, trackerReceipts, trackerReject, trackerReminderEvents, trackerSettings, trackerState, updateTrackerMirror } from "./receivablesCore";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
const auth = { serviceToken: v.string() }, actor = { ...auth, actor: v.string() };
function bounded(value: string, limit = 300) { if (!value.trim() || value.length > limit) trackerReject("Invalid or oversized value"); }
async function reportRows(ctx: QueryCtx | MutationCtx, rows: TrackerReportRow[]) {
  if (rows.length > 500 || JSON.stringify(rows).length > 500_000 || !rows.length) trackerReject("Use 1–500 rows, within 500 KB");
  const state = await trackerState(ctx);
  return rows.map(row => {
    const r = { ...row, ...(row.section === "monthly" && !row.period ? { period: row.week.slice(0, 7) } : {}) }; const issues: string[] = r.issue ? [r.issue] : [];
    if (!r.payer || r.payer.length > 200 || r.raw.length > 6000 || !Number.isFinite(r.amount) || r.amount < 0 || r.amount > 1e9) issues.push("Confirm payer / amount");
    if (!validTrackerDate(r.week) || trackerWeek(r.week) !== r.week) issues.push("Select reporting Monday");
    if (r.expected && !validTrackerDate(r.expected)) issues.push("Confirm expected date");
    const provider = r.providerId ? state.providers.find(p => p.id === r.providerId && p.type === "client") : trackerProvider(r.payer, state.providers);
    r.providerId = provider?.id;
    const candidates = r.invoiceId ? state.invoices.filter(i => i.id === r.invoiceId) : r.section === "invoice" ? state.invoices.filter(i => i.invoiceNumber === r.reference && i.documentType === "sales_invoice") : [];
    const exact = candidates.filter(i => trackerCents(i.amount) === trackerCents(r.amount) && (!provider || i.providerId === provider.id));
    const invoice = exact.length === 1 ? exact[0] : candidates.length === 1 && !r.line ? candidates[0] : undefined;
    if (invoice) {
      if (provider && provider.id !== invoice.providerId) issues.push("Invoice belongs to another client");
      if (r.currency && r.currency !== invoice.currency) issues.push("Original currency differs from the invoice");
      if (r.entity && invoice.entity && r.entity !== invoice.entity) issues.push("Receiving entity differs from the invoice");
      r.invoiceId = invoice.id; r.providerId = invoice.providerId; r.entity = invoice.entity; r.currency = invoice.currency;
      if (r.section === "invoice" && trackerCents(invoice.amount) !== trackerCents(r.amount) && (!r.displayedCurrency || r.displayedCurrency === invoice.currency)) issues.push("Report amount differs from current invoice; current invoice is authoritative");
      if (invoice.meritReplacementId) issues.push("Invoice replacement is pending");
    } else if (r.section === "invoice") issues.push("No unique live invoice; resolve number / amount against Merit");
    if (!r.providerId) issues.push("Select a known client");
    if (!r.invoiceId && r.section !== "monthly") {
      if (!r.entity || !["dn", "lmd", "mojo", "coveragebird", "coveragepro", "olm"].includes(r.entity)) issues.push("Confirm receiving legal entity");
      if (!r.currency || !/^[A-Z]{3}$/.test(r.currency)) issues.push("Confirm original currency; displayed USD is not proof");
      if (r.section === "earnings" && (!/^\d{4}-\d{2}$/.test(r.period ?? "") || !["Leads", "Clicks"].includes(r.category ?? "") || !["ACP", "HCP"].includes(r.source ?? ""))) issues.push("Confirm earnings period, ACP/HCP source and Leads/Clicks category");
      if (!r.paid && state.invoices.some(i => i.providerId === r.providerId && i.documentType === "sales_invoice" && i.currency === r.currency && ((r.period && i.periodStart?.startsWith(r.period)) || trackerCents(i.amount) === trackerCents(r.amount)))) issues.push("Possible existing invoice for this balance; choose its stable invoice ID");
    }
    if (/total|summary|remarketing|minerva|spend/i.test(`${r.payer} ${r.category ?? ""}`)) issues.push("Summary / excluded revenue: retain as report evidence only");
    r.issue = issues.length ? [...new Set(issues)].join(" · ") : undefined;
    return r;
  });
}
export const list = query({ args: auth, returns: v.object({ items: v.array(trackerItem), receipts: v.array(trackerReceipt), rules: v.array(trackerRule), recipients: v.array(v.string()), enabledAt: v.optional(v.string()), reminderTime: v.string(), deliveries: v.array(trackerDelivery) }), handler: async (ctx, args) => {
  trackerAuth(args.serviceToken); const [items, receipts, settings, deliveries] = await Promise.all([trackerItems(ctx), trackerReceipts(ctx), trackerSettings(ctx), ctx.db.query("receivableDeliveries").order("desc").take(100)]);
  return { items: items.map(plain), receipts: receipts.map(plain), rules: settings?.rules ?? defaultTrackerRules, recipients: settings?.recipients ?? [], enabledAt: settings?.enabledAt, reminderTime: settings?.reminderTime ?? "09:00", deliveries: deliveries.map(plain) };
} });
export const detail = query({ args: { ...auth, key: v.string() }, returns: v.object({ sources: v.array(trackerReportRow), receipts: v.array(trackerReceipt), audit: v.array(v.object({ actor: v.string(), action: v.string(), detail: v.string(), createdAt: v.string() })) }), handler: async (ctx, args) => {
  trackerAuth(args.serviceToken); const [sources, receipts, audit] = await Promise.all([ctx.db.query("receivableSources").withIndex("by_item", q => q.eq("itemKey", args.key)).take(501), ctx.db.query("receivableReceipts").withIndex("by_item", q => q.eq("itemKey", args.key)).take(501), ctx.db.query("receivableAudit").withIndex("by_item", q => q.eq("itemKey", args.key)).order("desc").take(100)]);
  if (sources.length > 500 || receipts.length > 500) trackerReject("Detail capacity exceeded");
  return { sources: sources.map(s => s.row), receipts: receipts.map(plain), audit: audit.map(a => ({ actor: a.actor, action: a.action, detail: a.detail, createdAt: a.createdAt })) };
} });
export const saveItem = mutation({ args: { ...actor, item: trackerItem, expectedRevision: v.optional(v.number()) }, returns: v.string(), handler: async (ctx, args) => {
  trackerAuth(args.serviceToken); const state = await trackerState(ctx), existing = await trackerItemByKey(ctx, args.item.key); bounded(args.actor); bounded(args.item.key); bounded(args.item.payer);
  if (existing && existing.revision !== args.expectedRevision) trackerReject("Item changed; reload before saving");
  const item = { ...args.item, updatedAt: trackerNow(), createdAt: existing?.createdAt ?? trackerNow(), revision: (existing?.revision ?? 0) + 1 };
  if (!validTrackerDate(item.week) || trackerWeek(item.week) !== item.week || (item.expectedDate && !validTrackerDate(item.expectedDate))) trackerReject("Choose valid dates and a reporting Monday");
  if (item.invoiceId) {
    const invoice = state.invoices.find(i => i.id === item.invoiceId);
    if (!invoice || invoice.meritReplacementId || invoice.documentType !== "sales_invoice") trackerReject("Select an available sales invoice");
    if (existing?.invoiceId !== item.invoiceId) trackerReject("Use Link invoice to attach a receipt without duplicating the balance");
    Object.assign(item, { amount: invoice.amount, currency: invoice.currency, providerId: invoice.providerId, entity: invoice.entity });
  } else if (item.kind !== "monthly") {
    if (!state.providers.some(p => p.id === item.providerId && p.type === "client") || !item.entity || !/^[A-Z]{3}$/.test(item.currency) || item.amount <= 0 || !Number.isFinite(item.amount) || item.amount > 1e9) trackerReject("Choose a known client, entity, original currency and positive amount");
    if (existing && trackerAmounts(existing, await trackerReceipts(ctx), state.invoices, state.paymentAllocations).received > item.amount) trackerReject("Revised amount is below received cash; review its allocations first");
    if (!existing && state.invoices.some(i => i.providerId === item.providerId && i.currency === item.currency && trackerCents(i.amount) === trackerCents(item.amount) && invoiceOutstanding(i, state.paymentAllocations) > 0)) trackerReject("An invoice already represents this balance; link it instead");
  }
  if (existing && existing.expectedDate !== item.expectedDate) { item.dateOverride = true; item.dateBasis = "Manual override"; item.dateConfidence = "confirmed"; }
  if (existing) await ctx.db.patch(existing._id, item); else { if ((await trackerItems(ctx)).length >= trackerLimit) trackerReject("Tracker is full"); await ctx.db.insert("receivableItems", item); }
  await trackerAudit(ctx, item.key, args.actor, existing ? "Item updated" : "Item created", JSON.stringify({ before: existing ? plain(existing) : null, after: item }));
  await updateTrackerMirror(ctx, state); return item.key;
} });
export const checked = mutation({ args: { ...actor, key: v.string() }, returns: v.null(), handler: async (ctx, args) => {
  trackerAuth(args.serviceToken); const item = await trackerItemByKey(ctx, args.key); if (!item || item.kind !== "tariq") trackerReject("Choose a Tariq follow-up");
  await ctx.db.patch(item._id, { checkedDate: trackerClock().date, revision: item.revision + 1, updatedAt: trackerNow() }); await trackerAudit(ctx, item.key, args.actor, "Checked today", "Payment status unchanged"); return null;
} });
export const allocate = mutation({ args: { ...actor, receipt: trackerReceipt }, returns: v.null(), handler: async (ctx, args) => {
  trackerAuth(args.serviceToken); const item = await trackerItemByKey(ctx, args.receipt.itemKey); if (!item) trackerReject("Item not found");
  if (!validTrackerDate(args.receipt.paidAt) || args.receipt.paidAt > trackerClock().date || !args.receipt.evidence.trim() || args.receipt.evidence.length > 2000 || !Number.isFinite(args.receipt.bankAmount)) trackerReject("Enter the actual receipt date and evidence");
  const state = await trackerState(ctx); await recordTrackerReceipt(ctx, item, { ...args.receipt, actor: args.actor, state: "active", createdAt: trackerNow() }, state, true); await updateTrackerMirror(ctx, state); return null;
} });
export const reverse = mutation({ args: { ...actor, key: v.string(), reason: v.string() }, returns: v.null(), handler: async (ctx, args) => {
  trackerAuth(args.serviceToken); bounded(args.reason, 2000); const receipt = await ctx.db.query("receivableReceipts").withIndex("by_key", q => q.eq("key", args.key)).unique();
  if (!receipt || receipt.state !== "active") trackerReject("Select an active receipt; transferred invoice receipts use invoice payment review");
  await ctx.db.patch(receipt._id, { state: "reversed", reversedAt: trackerNow(), reversalReason: args.reason }); await trackerAudit(ctx, receipt.itemKey, args.actor, "Receipt reversed", JSON.stringify({ receipt: receipt.key, reason: args.reason })); await updateTrackerMirror(ctx, await trackerState(ctx)); return null;
} });
export const linkInvoice = mutation({ args: { ...actor, key: v.string(), invoiceId: v.string() }, returns: v.null(), handler: async (ctx, args) => {
  trackerAuth(args.serviceToken); const state = await trackerState(ctx), item = await trackerItemByKey(ctx, args.key), invoice = state.invoices.find(i => i.id === args.invoiceId);
  if (!item || !invoice || invoice.documentType !== "sales_invoice" || invoice.meritReplacementId) trackerReject("Choose an available item and sales invoice");
  if (item.invoiceId && item.invoiceId !== invoice.id) trackerReject("This item is already linked to another invoice");
  if (item.kind === "monthly" && ((item.providerId ? item.providerId !== invoice.providerId : trackerPayer(item.payer) !== trackerPayer(invoice.customerName)) || (item.entity && invoice.entity && item.entity !== invoice.entity))) trackerReject("Choose an invoice for this task’s payer and billing entity");
  if (item.kind !== "monthly" && (item.providerId !== invoice.providerId || item.currency !== invoice.currency || trackerCents(item.amount) !== trackerCents(invoice.amount) || (invoice.entity && item.entity !== invoice.entity))) trackerReject("Invoice client, original currency, entity and amount must match the collectible balance");
  const receipts = (await trackerReceipts(ctx)).filter(r => r.itemKey === item.key);
  if (receipts.length && state.paymentAllocations.some(a => a.invoiceId === invoice.id)) trackerReject("Invoice already has payments; review those before transferring receipts");
  const payments = [...state.paymentAllocations];
  for (const r of receipts) {
    if (r.bankCurrency !== r.currency || trackerCents(r.bankAmount) !== trackerCents(r.amount)) trackerReject("Review FX allocations in the invoice payment workflow before linking");
    payments.push({ id: `tracker:${r.key}`, invoiceId: invoice.id, transactionId: r.transactionId, amount: r.amount, currency: r.currency, paidAt: r.paidAt, source: ["wise", "revolut", "slash", "mercury", "amex"].includes(r.bank) ? r.bank as "wise" | "revolut" | "slash" | "mercury" | "amex" : "other", mode: "manual", accountName: r.account, reference: r.reference, note: r.evidence, createdAt: r.createdAt });
    await ctx.db.patch(r._id, { state: "transferred" });
  }
  const other = await ctx.db.query("receivableItems").withIndex("by_invoice", q => q.eq("invoiceId", invoice.id)).take(3);
  for (const duplicate of other.filter(i => i.key !== item.key && i.kind === "invoice")) await ctx.db.patch(duplicate._id, { archived: true });
  await ctx.db.patch(item._id, { invoiceId: invoice.id, sent: Boolean(invoice.sentAt || invoice.meritDeliveryStatus === "delivered"), revision: item.revision + 1, updatedAt: trackerNow(), review: undefined });
  const next = { ...state, invoices: receipts.length ? applyPaymentState(state.invoices, payments) : state.invoices, paymentAllocations: payments };
  const linkedDates: string[] = [];
  for (const receipt of receipts.filter(r => r.transactionId)) {
    const bank = await ctx.db.query("bankTransactions").withIndex("by_transaction_id", q => q.eq("id", receipt.transactionId!)).unique();
    const invoiceCash = payments.filter(a => a.invoiceId === invoice.id && sameTrackerReceipt(a.transactionId, receipt.transactionId)).reduce((sum, a) => sum + a.amount, 0);
    if (bank && bank.currency === invoice.currency && trackerCents(bank.amount) === trackerCents(invoiceCash)) {
      await ctx.db.patch(bank._id, { matchedInvoiceId: invoice.id, invoiceMatchSource: "manual", invoiceMatchConfidence: 1, invoiceMatchReason: "Existing tracker receipt transferred to its invoice" }); linkedDates.push(bank.date);
      if (receipts.length === 1) next.invoices = next.invoices.map(i => i.id === invoice.id ? { ...i, transactionId: bank.id } : i);
    }
  }
  if (linkedDates.length) await bumpBankLedgerRevision(ctx, linkedDates);
  await ctx.db.patch(state._id, { invoices: next.invoices, paymentAllocations: payments }); await updateTrackerMirror(ctx, next); await trackerAudit(ctx, item.key, args.actor, "Invoice linked", JSON.stringify({ invoiceId: invoice.id, transferredReceipts: receipts.map(r => r.key) })); return null;
} });
export const previewReport = mutation({ args: { ...actor, key: v.string(), week: v.string(), origin: v.string(), rows: v.array(trackerReportRow), summary: v.optional(v.number()), files: trackerReport.fields.files }, returns: trackerReport, handler: async (ctx, args) => {
  trackerAuth(args.serviceToken); bounded(args.actor); bounded(args.key); if (!validTrackerDate(args.week) || trackerWeek(args.week) !== args.week || args.files.length > 12) trackerReject("Choose a reporting Monday and at most 12 attachments");
  const existing = await ctx.db.query("receivableReports").withIndex("by_key", q => q.eq("key", args.key)).unique();
  if (existing && existing.actor !== args.actor) trackerReject("This draft belongs to another user");
  const rows = await reportRows(ctx, args.rows.map(row => existing?.accepted.includes(row.key) ? existing.rows.find(r => r.key === row.key)! : row));
  const detail = trackerMoney(rows.filter(r => !r.paid && !/total|summary|remarketing|minerva|spend/i.test(`${r.payer} ${r.category ?? ""}`)).reduce((s, r) => s + r.amount, 0));
  const gap = args.summary === undefined ? undefined : trackerMoney(args.summary - detail);
  const duplicate = rows.filter((r, i) => rows.some((o, j) => j !== i && trackerSourceKey(r) === trackerSourceKey(o)));
  const report = { key: args.key, actor: args.actor, week: args.week, origin: args.origin, rows, accepted: existing?.accepted ?? [], summary: args.summary, detail, gap, issues: [...(gap ? [`Source summary differs from detailed open rows by ${gap.toFixed(2)}; missing detail is not a receivable`] : []), ...(duplicate.length ? ["Duplicate source lines need distinct line IDs"] : [])], files: args.files, createdAt: existing?.createdAt ?? trackerNow(), updatedAt: trackerNow() };
  if (existing) await ctx.db.patch(existing._id, report); else await ctx.db.insert("receivableReports", report); return report;
} });
export const reports = query({ args: actor, returns: v.array(trackerReport), handler: async (ctx, args) => { trackerAuth(args.serviceToken); return (await ctx.db.query("receivableReports").withIndex("by_actor", q => q.eq("actor", args.actor)).order("desc").take(30)).map(plain); } });
export const saveReport = mutation({ args: { ...actor, key: v.string(), rowKeys: v.array(v.string()) }, returns: v.object({ accepted: v.number(), pending: v.number() }), handler: async (ctx, args) => {
  trackerAuth(args.serviceToken); const report = await ctx.db.query("receivableReports").withIndex("by_key", q => q.eq("key", args.key)).unique(); if (!report || report.actor !== args.actor) trackerReject("Draft not found for this user");
  if (report.issues.some(i => i.startsWith("Duplicate"))) trackerReject("Resolve duplicate source keys first");
  const rows = await reportRows(ctx, report.rows), chosen = rows.filter(r => args.rowKeys.includes(r.key) && !report.accepted.includes(r.key));
  if (chosen.some(r => r.issue)) trackerReject("Only validated rows can be saved; resolve highlighted fields first");
  const state = await trackerState(ctx), settings = await trackerSettings(ctx), now = trackerNow();
  const touched = new Set<string>();
  for (const row of chosen) {
    const sourceKey = trackerSourceKey(row), previous = await ctx.db.query("receivableSources").withIndex("by_key", q => q.eq("key", sourceKey)).unique();
    if (previous && previous.row.week > row.week) trackerReject("A newer weekly source is already saved; historical uploads cannot overwrite it");
    const key = previous?.itemKey ?? trackerGroupKey(row); const item = await trackerItemByKey(ctx, key);
    if (item && row.invoiceId && item.invoiceId !== row.invoiceId) trackerReject("Use Link invoice on the existing tracker item before revising its report");
    const recognized = previous?.recognized || !row.paid;
    if (previous) await ctx.db.patch(previous._id, { row, reportKey: report.key, updatedAt: now, recognized });
    else await ctx.db.insert("receivableSources", { key: sourceKey, itemKey: key, row, reportKey: report.key, updatedAt: now, recognized });
    if (row.paid && !item) continue;
    touched.add(key);
    if (!item) {
      if ((await trackerItems(ctx)).length >= trackerLimit) trackerReject("Tracker is full");
      const invoice = state.invoices.find(i => i.id === row.invoiceId);
      await ctx.db.insert("receivableItems", { key, payer: row.payer, providerId: row.providerId, entity: row.entity, currency: invoice?.currency ?? row.currency ?? "", amount: invoice?.amount ?? 0, kind: row.section, period: row.period, category: row.category, stream: row.stream, invoiceId: row.invoiceId, reference: row.reference, accountId: row.accountId, week: row.week, ...resolveTrackerDate({ week: row.week, payer: row.payer, explicit: row.expected, stream: row.stream }, settings?.rules ?? defaultTrackerRules), payerSent: row.paid, sent: Boolean(invoice?.sentAt || invoice?.meritDeliveryStatus === "delivered"), archived: false, revision: 1, createdAt: now, updatedAt: now });
    }
    await trackerAudit(ctx, key, args.actor, "Weekly source updated", JSON.stringify({ report: report.key, source: sourceKey, previous: previous?.row, current: row }));
  }
  for (const key of touched) {
    const item = (await trackerItemByKey(ctx, key))!, sources = await ctx.db.query("receivableSources").withIndex("by_item", q => q.eq("itemKey", key)).take(501);
    if (sources.length > 500) trackerReject("Too many source lines for this balance");
    if (item.invoiceId && sources.some(s => s.row.section === "earnings") && trackerCents(sources.filter(s => s.recognized).reduce((sum, s) => sum + s.row.amount, 0)) !== trackerCents(item.amount)) trackerReject("Combined earnings sources must equal the linked invoice balance; review all source lines together");
    const amount = item.invoiceId ? item.amount : trackerMoney(sources.filter(s => s.recognized).reduce((s, r) => s + r.row.amount, 0));
    const receipts = await trackerReceipts(ctx), received = trackerAmounts(item, receipts, state.invoices, state.paymentAllocations).received;
    await ctx.db.patch(item._id, { amount, payerSent: sources.filter(s => s.recognized).length > 0 && sources.filter(s => s.recognized).every(s => s.row.paid), review: amount < received ? "Revised source amount is below received cash; review allocations" : undefined, revision: item.revision + 1, updatedAt: now });
  }
  const accepted = [...new Set([...report.accepted, ...chosen.map(r => r.key)])]; await ctx.db.patch(report._id, { rows, accepted, updatedAt: now }); await updateTrackerMirror(ctx, state); return { accepted: chosen.length, pending: rows.length - accepted.length };
} });
export const saveSettings = mutation({ args: { ...actor, recipients: v.array(v.string()), reminderTime: v.string(), rules: v.array(trackerRule) }, returns: v.null(), handler: async (ctx, args) => {
  trackerAuth(args.serviceToken); if (args.recipients.length > 3 || new Set(args.recipients).size !== args.recipients.length || !/^([01]\d|2[0-3]):[0-5]\d$/.test(args.reminderTime) || args.rules.length > 100 || args.rules.some(r => !r.payer || r.label.length > 200 || r.slots.some(s => !Number.isInteger(s) || s < (r.kind === "monthly" ? 1 : 0) || s > (r.kind === "monthly" ? 31 : 6)))) trackerReject("Choose up to three eligible recipients, a local time, and valid calendar slots");
  const old = await trackerSettings(ctx), now = trackerNow(), settings = { key: "default", recipients: args.recipients, reminderTime: args.reminderTime, rules: args.rules, enabledAt: args.recipients.length > 0 ? old?.enabledAt ?? now : undefined, updatedAt: now };
  if (old) await ctx.db.patch(old._id, settings); else await ctx.db.insert("receivableSettings", settings);
  await trackerAudit(ctx, "settings", args.actor, "Settings updated", JSON.stringify(settings)); return null;
} });
export const maintain = mutation({ args: { ...auth, forecasts: v.array(v.object({ invoiceId: v.string(), date: v.string(), basis: v.string() })) }, returns: v.null(), handler: async (ctx, args) => { trackerAuth(args.serviceToken); if (args.forecasts.length > 2000) trackerReject("Forecast limit exceeded"); await reconcileTrackerInvoices(ctx, await trackerState(ctx), args.forecasts); await trackerReminderEvents(ctx); return null; } });
export const match = mutation({ args: auth, returns: v.object({ matched: v.number(), complete: v.boolean(), candidates: v.number() }), handler: async (ctx, args) => {
  trackerAuth(args.serviceToken); const state = await trackerState(ctx), items = await trackerItems(ctx), receipts = await trackerReceipts(ctx);
  const bindings = await ctx.db.query("bankConnectionBindings").take(6); if (bindings.length > 5) trackerReject("Unexpected bank connection scope");
  const cutoff = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10);
  const rows = await ctx.db.query("bankTransactions").withIndex("by_direction_date_id", q => q.eq("direction", "in").gte("date", cutoff)).take(3001);
  if (rows.length > 3000) return { matched: 0, complete: false, candidates: 0 };
  const banks = rows.filter(t => t.identityVersion === 2 && bindings.some(b => b.source === t.source && b.connectionKey === t.connectionKey) && trackerBankEligible(t));
  let corrected = false;
  for (const receipt of receipts.filter(r => r.transactionId)) {
    const bank = await ctx.db.query("bankTransactions").withIndex("by_transaction_id", q => q.eq("id", receipt.transactionId!)).unique();
    // Absence or failed coverage never erases receipt evidence. Only an explicit source correction does.
    if (!bank || !bindings.some(b => b.source === bank.source && b.connectionKey === bank.connectionKey)) continue;
    const used = receipts.filter(r => sameTrackerReceipt(r.transactionId, bank.id)).reduce((s, r) => s + r.bankAmount, 0);
    if (bank.status === "voided" || bank.direction !== "in" || bank.currency !== receipt.bankCurrency || trackerCents(bank.amount) < trackerCents(used)) {
      const reason = "Saved bank record was reversed or its amount/currency was corrected; review receipt evidence";
      await ctx.db.patch(receipt._id, { state: "reversed", reversedAt: trackerNow(), reversalReason: reason });
      const item = items.find(i => i.key === receipt.itemKey);
      if (item) await ctx.db.patch(item._id, { review: reason, revision: item.revision + 1, updatedAt: trackerNow() });
      await trackerAudit(ctx, receipt.itemKey, "scheduled matcher", "Source receipt corrected", JSON.stringify({ transactionId: bank.id, reason })); corrected = true;
    }
  }
  const available = banks.filter(t => !t.matchedInvoiceId && !state.invoices.some(i => sameTrackerReceipt(i.transactionId, t.id)) && !state.paymentAllocations.some(a => sameTrackerReceipt(a.transactionId, t.id)) && !receipts.some(a => sameTrackerReceipt(a.transactionId, t.id)));
  const open = items.filter(i => !i.invoiceId && !i.review && i.kind !== "monthly" && trackerAmounts(i, receipts, state.invoices, state.paymentAllocations).outstanding > 0);
  const pairs = open.flatMap(item => available.filter(t => !trackerMatchReason(item, t, state.providers.find(p => p.id === item.providerId), trackerAmounts(item, receipts, state.invoices, state.paymentAllocations).outstanding)).map(bank => ({ item, bank })));
  let matched = 0;
  for (const { item, bank } of pairs) {
    if (pairs.filter(p => p.item.key === item.key).length !== 1 || pairs.filter(p => p.bank.id === bank.id).length !== 1) continue;
    if (state.invoices.some(i => i.documentType === "sales_invoice" && i.status !== "paid" && i.providerId === item.providerId && i.currency === item.currency && trackerCents(invoiceOutstanding(i, state.paymentAllocations)) === trackerCents(bank.amount))) continue;
    const settings = await trackerSettings(ctx);
    await recordTrackerReceipt(ctx, item, { key: `bank:${bank.id}:${item.key}`, itemKey: item.key, transactionId: bank.id, amount: bank.amount, currency: bank.currency, bankAmount: bank.amount, bankCurrency: bank.currency, paidAt: bank.date.slice(0, 10), bank: bank.source, account: bank.accountName, reference: bank.reference, evidence: "Unique completed credit: payer, entity/account, currency, exact remaining amount and expected date window", actor: "scheduled matcher", state: "active", createdAt: trackerNow() }, state, Boolean(settings?.enabledAt && bank.syncedAt > settings.enabledAt && bank.date.slice(0, 10) >= settings.enabledAt.slice(0, 10)));
    matched++;
  }
  if (matched || corrected) await updateTrackerMirror(ctx, state); return { matched, complete: true, candidates: pairs.length };
} });
export const reserved = query({ args: { ...auth, transactionIds: v.array(v.string()) }, returns: v.array(v.string()), handler: async (ctx, args) => {
  trackerAuth(args.serviceToken); if (args.transactionIds.length > 3000) trackerReject("Candidate limit exceeded");
  const state = await trackerState(ctx), items = await trackerItems(ctx), receipts = await trackerReceipts(ctx), blocked: string[] = [];
  for (const id of args.transactionIds) {
    if (receipts.some(r => sameTrackerReceipt(r.transactionId, id))) { blocked.push(id); continue; }
    const bank = await ctx.db.query("bankTransactions").withIndex("by_transaction_id", q => q.eq("id", id)).unique();
    if (bank && items.some(i => !i.invoiceId && !i.review && i.kind !== "monthly" && !trackerMatchReason(i, bank, state.providers.find(p => p.id === i.providerId), trackerAmounts(i, receipts, state.invoices, state.paymentAllocations).outstanding))) blocked.push(id);
  }
  return blocked;
} });
export const candidateReceipts = query({ args: { ...auth, key: v.string() }, returns: v.array(v.object({ id: v.string(), date: v.string(), payer: v.string(), amount: v.number(), currency: v.string(), bank: v.string(), account: v.string(), reason: v.string() })), handler: async (ctx, args) => {
  trackerAuth(args.serviceToken); const item = await trackerItemByKey(ctx, args.key); if (!item) trackerReject("Item not found");
  const state = await trackerState(ctx), receipts = await trackerReceipts(ctx);
  const banks = await ctx.db.query("bankTransactions").withIndex("by_direction_currency_amount", q => q.eq("direction", "in").eq("currency", item.currency)).order("desc").take(1000);
  return banks.filter(t => t.matchedProviderId === item.providerId || trackerPayer(t.counterparty) === trackerPayer(item.payer)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 30).map(t => ({ id: t.id, date: t.date.slice(0, 10), payer: t.counterparty, amount: t.amount, currency: t.currency, bank: t.source, account: t.accountName, reason: receipts.some(a => sameTrackerReceipt(a.transactionId, t.id)) || state.paymentAllocations.some(a => sameTrackerReceipt(a.transactionId, t.id)) ? "Already allocated; review available cash" : trackerMatchReason(item, t, state.providers.find(p => p.id === item.providerId), trackerAmounts(item, receipts, state.invoices, state.paymentAllocations).outstanding) ?? "Exact candidate; confirm unique collectible balance" }));
} });
export const deliveryClaim = mutation({ args: auth, returns: v.array(trackerDelivery), handler: async (ctx, args) => {
  trackerAuth(args.serviceToken); const now = Date.now();
  const pending = await ctx.db.query("receivableDeliveries").withIndex("by_state_next", q => q.eq("state", "pending").lte("nextAt", now)).take(20);
  const retry = await ctx.db.query("receivableDeliveries").withIndex("by_state_next", q => q.eq("state", "retry").lte("nextAt", now)).take(20 - pending.length);
  const stale = await ctx.db.query("receivableDeliveries").withIndex("by_state_next", q => q.eq("state", "sending").lte("nextAt", now)).take(20);
  for (const d of stale) await ctx.db.patch(d._id, { state: "uncertain", error: "Delivery was interrupted after claim; inspect the private chat before retrying" });
  const claimed = [];
  for (const d of [...pending, ...retry]) {
    if (d.itemKey || d.invoiceId) {
      const state = await trackerState(ctx), item = d.itemKey ? await trackerItemByKey(ctx, d.itemKey) : undefined;
      const invoice = d.invoiceId ? state.invoices.find(i => i.id === d.invoiceId) : undefined;
      const valid = item ? trackerAmounts(item, await trackerReceipts(ctx), state.invoices, state.paymentAllocations).outstanding === 0 : invoice ? invoiceOutstanding(invoice, state.paymentAllocations) === 0 : false;
      if (!valid) { await ctx.db.patch(d._id, { state: "disabled", error: "Receipt was corrected before notification delivery" }); continue; }
    }
    const row = { ...plain(d), state: "sending" as const, lease: crypto.randomUUID(), attempts: d.attempts + 1, nextAt: now + 120000 }; await ctx.db.patch(d._id, row); claimed.push(row);
  }
  return claimed;
} });
export const deliveryComplete = mutation({ args: { ...auth, key: v.string(), lease: v.string(), outcome: v.union(v.literal("sent"), v.literal("retry"), v.literal("uncertain"), v.literal("disabled")), error: v.optional(v.string()), retryAfter: v.optional(v.number()) }, returns: v.null(), handler: async (ctx, args) => {
  trackerAuth(args.serviceToken); const row = await ctx.db.query("receivableDeliveries").withIndex("by_key", q => q.eq("key", args.key)).unique(); if (!row || row.lease !== args.lease || row.state !== "sending") return null;
  await ctx.db.patch(row._id, { state: args.outcome === "retry" && row.attempts >= 5 ? "disabled" : args.outcome, error: args.error?.slice(0, 300), sentAt: args.outcome === "sent" ? trackerNow() : undefined, nextAt: Date.now() + Math.max(60, Math.min(86400, args.retryAfter ?? 60 * 2 ** row.attempts)) * 1000 }); return null;
} });
export const retryDelivery = mutation({ args: { ...actor, key: v.string(), confirmedNotDelivered: v.boolean() }, returns: v.null(), handler: async (ctx, args) => { trackerAuth(args.serviceToken); const row = await ctx.db.query("receivableDeliveries").withIndex("by_key", q => q.eq("key", args.key)).unique(); if (!row || !["uncertain", "disabled"].includes(row.state) || !args.confirmedNotDelivered) trackerReject("Confirm that this message was not delivered before retrying"); await ctx.db.patch(row._id, { state: "pending", attempts: 0, nextAt: Date.now(), error: undefined }); await trackerAudit(ctx, "notifications", args.actor, "Delivery retry confirmed", row.key); return null; } });
export const intake = mutation({ args: { ...actor, week: v.optional(v.string()), mediaGroupId: v.optional(v.string()), cancel: v.optional(v.boolean()) }, returns: v.union(v.null(), v.object({ week: v.string(), mediaGroupId: v.optional(v.string()) })), handler: async (ctx, args) => {
  trackerAuth(args.serviceToken); const old = await ctx.db.query("receivableIntakes").withIndex("by_actor", q => q.eq("actor", args.actor)).unique();
  if (args.cancel) { if (old) await ctx.db.delete(old._id); return null; }
  if (args.week) { if (!validTrackerDate(args.week) || trackerWeek(args.week) !== args.week) trackerReject("Select a Monday"); const row = { actor: args.actor, week: args.week, mediaGroupId: args.mediaGroupId, expires: Date.now() + (args.mediaGroupId ? 300000 : 1800000) }; if (old) await ctx.db.patch(old._id, row); else await ctx.db.insert("receivableIntakes", row); return { week: args.week, mediaGroupId: args.mediaGroupId }; }
  return old && old.expires > Date.now() ? { week: old.week, mediaGroupId: old.mediaGroupId } : null;
} });
export const reportFile = query({ args: { ...actor, key: v.string(), storageId: v.id("_storage") }, returns: v.object({ url: v.string(), name: v.string(), contentType: v.string() }), handler: async (ctx, args) => { trackerAuth(args.serviceToken); const report = await ctx.db.query("receivableReports").withIndex("by_key", q => q.eq("key", args.key)).unique(); if (!report || (report.actor !== args.actor && !report.accepted.length)) trackerReject("Report is private to its author until saved"); const file = report.files.find(f => f.storageId === args.storageId); if (!file) trackerReject("File not found"); const url = await ctx.storage.getUrl(file.storageId); if (!url) trackerReject("File unavailable"); return { url, name: file.name, contentType: file.contentType }; } });
export const reminders = mutation({ args: auth, returns: v.null(), handler: async (ctx, args) => { trackerAuth(args.serviceToken); await trackerReminderEvents(ctx); return null; } });
export const rejectCandidate = mutation({ args: { ...actor, key: v.string(), transactionId: v.string(), reason: v.string() }, returns: v.null(), handler: async (ctx, args) => { trackerAuth(args.serviceToken); bounded(args.reason, 2000); const item = await trackerItemByKey(ctx, args.key); if (!item) trackerReject("Item not found"); const rejectedTransactions = [...new Set([...(item.rejectedTransactions ?? []), args.transactionId])]; if (rejectedTransactions.length > 200) trackerReject("Candidate rejection limit exceeded"); await ctx.db.patch(item._id, { rejectedTransactions, revision: item.revision + 1, updatedAt: trackerNow() }); await trackerAudit(ctx, item.key, args.actor, "Candidate rejected", JSON.stringify({ transactionId: args.transactionId, reason: args.reason })); return null; } });
