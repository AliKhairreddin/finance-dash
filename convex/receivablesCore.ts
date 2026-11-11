import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { applyPaymentState, invoiceOutstanding } from "../shared/income";
import { defaultTrackerRules, sameTrackerReceipt, trackerAmounts, trackerBankEligible, trackerCents, trackerClock, trackerMatchReason, trackerMoney, trackerPayer, trackerShift, trackerTiming, trackerWeek, type TrackerItem, type TrackerReceipt } from "../shared/receivablesTracker";
import type { Invoice, PaymentAllocation } from "../shared/types";
export const trackerLimit = 2000;
export function trackerAuth(token: string) { if (!process.env.CONVEX_SERVICE_TOKEN || token !== process.env.CONVEX_SERVICE_TOKEN) throw new ConvexError("Unauthorized"); }
export function trackerReject(message: string): never { throw new ConvexError(message); }
export const trackerNow = (previous?: string) => new Date(Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0)).toISOString();
export function plain<T extends { _id: unknown; _creationTime: unknown }>(row: T): Omit<T, "_id" | "_creationTime"> { const { _id: _i, _creationTime: _c, ...data } = row; return data; }
export async function trackerState(ctx: QueryCtx | MutationCtx) { const state = await ctx.db.query("dashboardState").withIndex("by_key", q => q.eq("key", "default")).unique(); if (!state) trackerReject("Dashboard is unavailable"); return state; }
export async function trackerItems(ctx: QueryCtx | MutationCtx) { const rows = await ctx.db.query("receivableItems").withIndex("by_archived", q => q.eq("archived", false)).take(trackerLimit + 1); if (rows.length > trackerLimit) trackerReject("Tracker capacity reached; archive resolved items before continuing"); return rows; }
export async function trackerReceipts(ctx: QueryCtx | MutationCtx) { const rows = await ctx.db.query("receivableReceipts").withIndex("by_state", q => q.eq("state", "active")).take(5001); if (rows.length > 5000) trackerReject("Receipt review capacity exceeded"); return rows; }
export async function trackerSettings(ctx: QueryCtx | MutationCtx) { return await ctx.db.query("receivableSettings").withIndex("by_key", q => q.eq("key", "default")).unique(); }
export async function trackerAudit(ctx: MutationCtx, itemKey: string, actor: string, action: string, detail: string) { await ctx.db.insert("receivableAudit", { itemKey, actor, action, detail: detail.slice(0, 12000), createdAt: trackerNow() }); }
export async function trackerItemByKey(ctx: QueryCtx | MutationCtx, key: string) { return ctx.db.query("receivableItems").withIndex("by_key", q => q.eq("key", key)).unique(); }
export async function updateTrackerMirror(ctx: MutationCtx, state: Doc<"dashboardState">, items?: Doc<"receivableItems">[], receipts?: Doc<"receivableReceipts">[]) {
  items ??= await trackerItems(ctx); receipts ??= await trackerReceipts(ctx);
  const mirrors = items.filter(i => !i.invoiceId && i.kind !== "monthly" && !i.archived).flatMap(i => {
    const amounts = trackerAmounts(i, receipts, state.invoices, state.paymentAllocations);
    return amounts.outstanding > 0 ? [{ id: `tracker:${i.key}`, name: i.payer, balance: amounts.outstanding, currency: i.currency, source: "manual" as const, notes: [i.period, i.category, i.stream].filter(Boolean).join(" · "), ...(i.expectedDate ? { dueDate: i.expectedDate } : {}) }] : [];
  });
  await ctx.db.patch(state._id, { manualReceivables: [...state.manualReceivables.filter(i => !i.id.startsWith("tracker:")), ...mirrors], updatedAt: trackerNow(state.updatedAt) });
}
export async function queueTrackerEvent(ctx: MutationCtx, event: string, text: string, occurredAt: string, target: { itemKey?: string; invoiceId?: string } = {}) {
  const settings = await trackerSettings(ctx);
  if (!settings?.enabledAt || occurredAt < settings.enabledAt || settings.recipients.length === 0) return;
  for (const recipient of settings.recipients) {
    const key = `${event}:${recipient}`;
    if (await ctx.db.query("receivableDeliveries").withIndex("by_key", q => q.eq("key", key)).unique()) continue;
    await ctx.db.insert("receivableDeliveries", { key, event, ...target, recipient, text, state: "pending", attempts: 0, nextAt: Date.now(), createdAt: trackerNow() });
  }
}
export async function recordTrackerReceipt(ctx: MutationCtx, item: Doc<"receivableItems">, receipt: TrackerReceipt, state: Doc<"dashboardState">, notify: boolean) {
  if (item.review || item.archived || item.kind === "monthly" || item.invoiceId) trackerReject("Resolve this item or use its existing invoice payment workflow");
  if (receipt.currency === receipt.bankCurrency && trackerCents(receipt.amount) !== trackerCents(receipt.bankAmount)) trackerReject("Same-currency cash and receipt allocations must agree");
  const all = await trackerReceipts(ctx);
  if (await ctx.db.query("receivableReceipts").withIndex("by_key", q => q.eq("key", receipt.key)).unique()) return;
  const before = trackerAmounts(item, all, state.invoices, state.paymentAllocations);
  if (receipt.currency !== item.currency || receipt.amount <= 0 || trackerCents(receipt.amount) > trackerCents(before.outstanding)) trackerReject("Receipt exceeds the remaining amount or has the wrong currency");
  let observedAt: number | undefined;
  if (receipt.transactionId) {
    const bank = await ctx.db.query("bankTransactions").withIndex("by_transaction_id", q => q.eq("id", receipt.transactionId!)).unique();
    const binding = bank && await ctx.db.query("bankConnectionBindings").withIndex("by_source", q => q.eq("source", bank.source)).unique();
    if (!bank || !binding || bank.connectionKey !== binding.connectionKey || bank.identityVersion !== 2 || !trackerBankEligible(bank) || !["posted", "settled"].includes(bank.status) || bank.direction !== "in" || receipt.bankCurrency !== bank.currency || receipt.paidAt !== bank.date.slice(0, 10)) trackerReject("Select a current completed incoming bank receipt and its actual credited date");
    observedAt = bank._creationTime;
    const used = all.filter(a => sameTrackerReceipt(a.transactionId, bank.id)).reduce((sum, a) => sum + a.bankAmount, 0)
      + state.paymentAllocations.filter(a => sameTrackerReceipt(a.transactionId, bank.id)).reduce((sum, a) => sum + (a.currency === bank.currency ? a.amount : bank.amount), 0);
    if (state.invoices.some(i => sameTrackerReceipt(i.transactionId, bank.id) && !state.paymentAllocations.some(a => a.invoiceId === i.id && sameTrackerReceipt(a.transactionId, bank.id))) || (bank.matchedInvoiceId && !state.paymentAllocations.some(a => a.invoiceId === bank.matchedInvoiceId && sameTrackerReceipt(a.transactionId, bank.id))) || trackerCents(used + receipt.bankAmount) > trackerCents(bank.amount) || receipt.bankAmount <= 0) trackerReject("This bank receipt is already allocated or the allocation exceeds available cash");
    const entity = bank.wiseEntity ?? bank.mercuryEntity ?? bank.slashEntity;
    if (!item.entity || (entity && entity !== item.entity) || (item.accountId && bank.accountId !== item.accountId) || (!entity && !item.accountId)) trackerReject("Confirm the receiving entity and account before allocating this receipt");
  }
  await ctx.db.insert("receivableReceipts", receipt);
  await ctx.db.patch(item._id, { revision: item.revision + 1, updatedAt: trackerNow(item.updatedAt) });
  await trackerAudit(ctx, item.key, receipt.actor, "Receipt recorded", JSON.stringify(receipt));
  const after = trackerAmounts(item, [...all, receipt], state.invoices, state.paymentAllocations);
  const notifications = await trackerSettings(ctx);
  if (notify && receipt.transactionId && notifications?.enabledAt && observedAt !== undefined && observedAt >= Date.parse(notifications.enabledAt) && receipt.paidAt >= notifications.enabledAt.slice(0, 10) && after.outstanding === 0 && before.outstanding > 0) await queueTrackerEvent(ctx, `received:${item.key}:${receipt.key}`, `${item.payer} paid · ${item.currency} ${after.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}\n${receipt.paidAt} · ${receipt.bank} · ${receipt.account}\n${item.reference ?? ""}`, receipt.createdAt, { itemKey: item.key });
}

/** Called inside the ordinary financial-state transaction, so concurrent matchers cannot both claim cash. */
export async function guardTrackerFinancialState(ctx: MutationCtx, previous: Doc<"dashboardState"> | null, invoices: Invoice[], payments: PaymentAllocation[], manual: Doc<"dashboardState">["manualReceivables"]) {
  const oldMirrors = previous?.manualReceivables.filter(i => i.id.startsWith("tracker:")) ?? [];
  if (JSON.stringify(manual.filter(i => i.id.startsWith("tracker:"))) !== JSON.stringify(oldMirrors)) trackerReject("Edit tracked balances through Receivables tracker");
  const changed = payments.filter(a => a.transactionId && JSON.stringify(a) !== JSON.stringify(previous?.paymentAllocations.find(p => p.id === a.id)));
  const newLinks = invoices.filter(i => i.transactionId && i.transactionId !== previous?.invoices.find(old => old.id === i.id)?.transactionId);
  if (!changed.length && !newLinks.length) return;
  const [receipts, items] = await Promise.all([trackerReceipts(ctx), trackerItems(ctx)]);
  for (const invoice of newLinks) {
    if (receipts.some(r => sameTrackerReceipt(r.transactionId, invoice.transactionId)) && !changed.some(a => a.invoiceId === invoice.id && sameTrackerReceipt(a.transactionId, invoice.transactionId))) trackerReject("Receipt is already allocated in Receivables tracker");
  }
  for (const allocation of changed) {
    const bank = await ctx.db.query("bankTransactions").withIndex("by_transaction_id", q => q.eq("id", allocation.transactionId!)).unique();
    const reserved = receipts.filter(r => sameTrackerReceipt(r.transactionId, allocation.transactionId));
    if (reserved.length) {
      const bankUsed = reserved.reduce((s, r) => s + r.bankAmount, 0);
      const invoiceUsed = payments.filter(a => sameTrackerReceipt(a.transactionId, allocation.transactionId)).reduce((s, a) => s + (a.currency === bank?.currency ? a.amount : bank?.amount ?? Infinity), 0);
      if (!bank || trackerCents(bankUsed + invoiceUsed) > trackerCents(bank.amount)) trackerReject("Receipt is already allocated in Receivables tracker");
    }
    if (allocation.mode === "automatic" && bank && items.some(i => !i.invoiceId && !i.review && i.kind !== "monthly" && !trackerMatchReason(i, bank, previous?.providers.find(p => p.id === i.providerId), trackerAmounts(i, receipts, invoices, payments).outstanding))) trackerReject("This receipt also matches a tracker item; review the competing balances first");
  }

  const settings = await trackerSettings(ctx);
  if (settings?.enabledAt && previous) {
    for (const invoice of invoices) {
      const old = previous.invoices.find(i => i.id === invoice.id);
      if (!old || old.status === "paid" || invoiceOutstanding(old, previous.paymentAllocations) <= 0 || invoiceOutstanding(invoice, payments) > 0) continue;
      const additions = changed.filter(a => a.invoiceId === invoice.id && !previous.paymentAllocations.some(p => p.id === a.id));
      const latest = additions.sort((a, b) => b.paidAt.localeCompare(a.paidAt))[0];
      if (!latest?.transactionId || latest.paidAt.slice(0, 10) < settings.enabledAt.slice(0, 10)) continue;
      const bank = await ctx.db.query("bankTransactions").withIndex("by_transaction_id", q => q.eq("id", latest.transactionId!)).unique();
      if (!bank || !trackerBankEligible(bank) || bank.identityVersion !== 2 || bank._creationTime < Date.parse(settings.enabledAt) || bank.syncedAt < settings.enabledAt || bank.currency !== invoice.currency) continue;
      const binding = await ctx.db.query("bankConnectionBindings").withIndex("by_source", q => q.eq("source", bank.source)).unique();
      if (!binding || binding.connectionKey !== bank.connectionKey) continue;
      await queueTrackerEvent(ctx, `invoice-received:${invoice.id}:${additions.map(a => a.id).sort().join(":")}`, `${invoice.customerName} paid · ${invoice.currency} ${payments.filter(a => a.invoiceId === invoice.id).reduce((sum, a) => sum + a.amount, 0).toLocaleString("en-US", { minimumFractionDigits: 2 })}\n${bank.date.slice(0, 10)} · ${bank.source} · ${bank.accountName}\n${invoice.invoiceNumber}`, trackerNow(), { invoiceId: invoice.id });
    }
  }
}

export async function reconcileTrackerInvoices(ctx: MutationCtx, state: Doc<"dashboardState">, forecasts: { invoiceId: string; date: string; basis: string }[]) {
  const items = await trackerItems(ctx), now = trackerNow(), week = trackerWeek(trackerClock().date);
  const settings = await trackerSettings(ctx), rules = settings?.rules ?? defaultTrackerRules;
  const { resolveTrackerDate } = await import("../shared/receivablesTracker");
  for (const invoice of state.invoices.filter(i => i.documentType === "sales_invoice" && i.status !== "draft" && !i.meritReplacementId)) {
    const existing = items.find(i => i.invoiceId === invoice.id);
    if (!existing && (invoice.status === "paid" || invoiceOutstanding(invoice, state.paymentAllocations) <= 0)) continue;
    const forecast = forecasts.find(f => f.invoiceId === invoice.id);
    if (existing) {
      if (existing.amount !== invoice.amount || existing.currency !== invoice.currency || (!existing.expectedDate && forecast)) await ctx.db.patch(existing._id, { amount: invoice.amount, currency: invoice.currency, ...(!existing.expectedDate ? resolveTrackerDate({ week: existing.week, payer: existing.payer, forecast }, []) : {}), updatedAt: now });
      continue;
    }
    if (items.length >= trackerLimit) trackerReject("Tracker capacity reached");
    const item: TrackerItem = { key: `invoice:${invoice.id}`, payer: invoice.customerName, providerId: invoice.providerId, entity: invoice.entity, currency: invoice.currency, amount: invoice.amount, kind: "invoice", invoiceId: invoice.id, reference: invoice.invoiceNumber, period: invoice.periodStart?.slice(0, 7), week, ...resolveTrackerDate({ week, payer: invoice.customerName, forecast }, []), payerSent: false, sent: true, archived: false, revision: 1, createdAt: now, updatedAt: now };
    await ctx.db.insert("receivableItems", item);
  }
  for (const task of items.filter(i => i.kind === "monthly" && i.invoiceId)) {
    const invoice = state.invoices.find(i => i.id === task.invoiceId);
    const sent = Boolean(invoice?.sentAt || invoice?.meritDeliveryStatus === "delivered");
    if (task.sent !== sent) await ctx.db.patch(task._id, { sent, updatedAt: now });
  }
  // Tasks are operational reminders only. They never create an accounting balance.
  for (const payer of ["SF Ishan", "Madrivo Makar", "Llama | Cyclopps Global Ltd.", "Healthy Labs"]) {
    const period = trackerClock().date.slice(0, 7), key = `monthly:${trackerPayer(payer)}:${payer}:${period}`;
    if (await trackerItemByKey(ctx, key)) continue;
    const matches = state.invoices.filter(i => i.documentType === "sales_invoice" && trackerPayer(i.customerName) === trackerPayer(payer) && i.issueDate.startsWith(period));
    // Channel-specific tasks require an explicit stream match, never just a shared payer.
    const match = matches.length === 1 && !/Ishan|Makar/.test(payer) ? matches[0] : undefined;
    await ctx.db.insert("receivableItems", { key, payer, currency: match?.currency ?? "", amount: 0, kind: "monthly", stream: payer, period, week, invoiceId: match?.id, sent: Boolean(match?.sentAt || match?.meritDeliveryStatus === "delivered"), payerSent: false, archived: false, revision: 1, createdAt: now, updatedAt: now });
  }
}
export async function trackerReminderEvents(ctx: MutationCtx) {
  const settings = await trackerSettings(ctx); if (!settings?.enabledAt) return;
  const { date, time } = trackerClock();
  const minute = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  if (minute(time) < minute(settings.reminderTime) || minute(time) >= minute(settings.reminderTime) + 15) return;
  const state = await trackerState(ctx), items = await trackerItems(ctx), receipts = await trackerReceipts(ctx), now = trackerNow();
  const open = items.filter(i => !i.review && trackerAmounts(i, receipts, state.invoices, state.paymentAllocations).outstanding > 0);
  const tariq = open.filter(i => i.kind === "tariq" && i.checkedDate !== date);
  if ([1, 3, 5].includes(new Date(`${date}T12:00:00Z`).getUTCDay()) && tariq.length) await queueTrackerEvent(ctx, `tariq:${date}`, `Ask Tariq if he received any payment\n${tariq.map(i => i.payer).join(" · ")}`, now);
  const overdue = open.filter(i => trackerTiming(i, 1, date) === "Overdue");
  // One event per expectation/date, grouped into one digest per recipient at delivery time.
  for (const item of overdue) await queueTrackerEvent(ctx, `overdue:${item.key}:${item.expectedDate}`, `Expected overdue · ${item.payer} · ${item.currency} ${trackerAmounts(item, receipts, state.invoices, state.paymentAllocations).outstanding}\nExpected ${item.expectedDate}`, now);
  for (const item of items.filter(i => i.kind === "monthly" && !i.sent)) await queueTrackerEvent(ctx, `invoice-task:${item.key}`, `Invoice to send · ${item.payer} · ${item.period}`, now);
}
export { applyPaymentState, trackerShift };
