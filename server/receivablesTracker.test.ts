import test from "node:test";
import assert from "node:assert/strict";
import { call, database } from "./convexTestDb";
import * as tracker from "../convex/receivables";
import { guardTrackerFinancialState } from "../convex/receivablesCore";
import { bankProviderTransactionId } from "../shared/providerIdentity";
import { trackerWeek, trackerClock, type TrackerItem, type TrackerReportRow, type TrackerReceipt } from "../shared/receivablesTracker";
const auth = { serviceToken: "tracker-test" }, actor = { ...auth, actor: "finance" };
const now = new Date().toISOString(), date = trackerClock().date, week = trackerWeek(date);
const provider = { id: "p", name: "LeadPier", aliases: [], tags: [], type: "client", source: "manual", createdAt: now };
const item: TrackerItem = { key: "lead", payer: "LeadPier", providerId: "p", entity: "dn", currency: "USD", amount: 1000, kind: "tariq", expectedDate: date, week, payerSent: false, sent: false, archived: false, revision: 1, createdAt: now, updatedAt: now };
const bank = { _id: "bank", _creationTime: Date.now(), id: bankProviderTransactionId("revolut", ["account", "receipt", "leg"]), source: "revolut", wiseEntity: "dn", accountName: "Main", accountId: "account", date, amount: 1000, currency: "USD", direction: "in", status: "settled", category: "Media buying direct", description: "Revenue", counterparty: "LeadPier", rawName: "LeadPier", matchedProviderId: "p", companyMatchSource: "manual", identityVersion: 2, connectionKey: "live", syncedAt: now };
const invoice = { id: "invoice", providerId: "p", customerName: "LeadPier", entity: "dn", amount: 1000, currency: "USD", documentType: "sales_invoice", status: "open", invoiceNumber: "2026/1", issueDate: date, dueDate: date, source: "merit", origin: "merit", meritDeliveryStatus: "saved", description: "Service", revenueRunIds: [], createdAt: now, updatedAt: now };
function setup() { process.env.CONVEX_SERVICE_TOKEN = auth.serviceToken; return database({ dashboardState: [{ _id: "state", key: "default", updatedAt: now, providers: [provider], invoices: [], paymentAllocations: [], manualReceivables: [] }], receivableItems: [{ ...item, _id: "item" }], receivableReceipts: [], bankConnectionBindings: [{ source: "revolut", connectionKey: "live" }, { source: "wise", connectionKey: "broken-feed" }], bankTransactions: [bank] }); }
function receipt(change: Partial<TrackerReceipt> = {}): TrackerReceipt { return { key: "receipt", itemKey: item.key, transactionId: bank.id, amount: 1000, currency: "USD", bankAmount: 1000, bankCurrency: "USD", paidAt: date, bank: "revolut", account: "Main", evidence: "Finance verified wire", actor: "ignored", state: "active", createdAt: now, ...change }; }
test("saved healthy receipt settles once even with an unrelated failed/stale bank feed", async () => {
  const ctx = setup(); assert.equal((await call(tracker.match, ctx, auth)).matched, 1); assert.equal(ctx.tables.receivableReceipts.length, 1); assert.equal(ctx.tables.dashboardState[0].manualReceivables.length, 0);
  assert.equal((await call(tracker.match, ctx, auth)).matched, 0); assert.equal(ctx.tables.receivableReceipts.length, 1);
  assert.equal(ctx.tables.receivableDeliveries?.length ?? 0, 0);
});
test("competing invoice or duplicate candidate does not auto settle a tracker item", async () => {
  for (const conflict of ["invoice", "bank", "item"]) {
    const ctx = setup(); if (conflict === "invoice") ctx.tables.dashboardState[0].invoices.push(invoice); else if (conflict === "bank") ctx.tables.bankTransactions.push({ ...bank, _id: "bank2", id: bankProviderTransactionId("revolut", ["account", "receipt2", "leg"]) }); else ctx.tables.receivableItems.push({ ...item, _id: "item2", key: "other" });
    assert.equal((await call(tracker.match, ctx, auth)).matched, 0);
  }
});
test("partial cash, replay, reversal and later invoice use one shared availability", async () => {
  const ctx = setup(); await call(tracker.allocate, ctx, { ...actor, receipt: receipt({ amount: 300, bankAmount: 300 }) });
  assert.equal(ctx.tables.dashboardState[0].manualReceivables[0].balance, 700);
  await call(tracker.allocate, ctx, { ...actor, receipt: receipt({ amount: 300, bankAmount: 300 }) }); assert.equal(ctx.tables.receivableReceipts.length, 1);
  await assert.rejects(call(tracker.allocate, ctx, { ...actor, receipt: receipt({ key: "excess", amount: 800, bankAmount: 800 }) }), /remaining amount/);
  const state = ctx.tables.dashboardState[0];
  await assert.rejects(guardTrackerFinancialState(ctx as any, state as any, [invoice] as any, [{ id: "invoice-receipt", invoiceId: invoice.id, transactionId: bank.id, amount: 1000, currency: "USD", mode: "manual" }] as any, state.manualReceivables), /already allocated/);
  await call(tracker.reverse, ctx, { ...actor, key: "receipt", reason: "Wrong date / evidence; undo and record correct receipt" }); assert.equal(ctx.tables.dashboardState[0].manualReceivables[0].balance, 1000); assert.equal(ctx.tables.receivableReceipts[0].state, "reversed");
  await call(tracker.allocate, ctx, { ...actor, receipt: receipt({ key: "correct" }) }); state.invoices.push(invoice);
  await call(tracker.linkInvoice, ctx, { ...actor, key: item.key, invoiceId: invoice.id }); assert.equal(state.manualReceivables.length, 0); assert.equal(state.paymentAllocations.length, 1); assert.equal(state.invoices[0].status, "paid"); assert.equal(state.invoices[0].paidAt, date);
  assert.equal(ctx.tables.receivableReceipts[1].state, "transferred"); await call(tracker.linkInvoice, ctx, { ...actor, key: item.key, invoiceId: invoice.id }); assert.equal(state.paymentAllocations.length, 1);
});
test("wrong entity, currency, pending/internal and previously consumed bank receipts reject", async () => {
  for (const change of [{ wiseEntity: "lmd" }, { currency: "EUR" }, { status: "pending" }, { category: "Internal transfer" }, { connectionKey: "old" }]) { const ctx = setup(); Object.assign(ctx.tables.bankTransactions[0], change); await assert.rejects(call(tracker.allocate, ctx, { ...actor, receipt: receipt() })); }
  const ctx = setup(); ctx.tables.dashboardState[0].paymentAllocations.push({ invoiceId: "other", transactionId: bank.id, amount: 1000, currency: "USD" }); await assert.rejects(call(tracker.allocate, ctx, { ...actor, receipt: receipt() }), /already allocated/);
});
function reportRow(change: Partial<TrackerReportRow> = {}): TrackerReportRow { return { key: "row", week, section: "earnings", payer: "LeadPier", providerId: "p", entity: "dn", amount: 100, currency: "USD", period: date.slice(0, 7), source: "ACP", category: "Leads", paid: false, confidence: "reviewed", raw: "private source values", ...change }; }
async function report(ctx: ReturnType<typeof setup>, key: string, rows: TrackerReportRow[]) { return call(tracker.previewReport, ctx, { ...actor, key, week, origin: "Test", rows, files: [] }); }
test("cumulative weekly source revisions preserve actual cash and the original expectation", async () => {
  const ctx = setup(); ctx.tables.receivableItems = [];
  await report(ctx, "report1", [reportRow(), reportRow({ key: "hcp", source: "HCP", amount: 50 })]);
  await call(tracker.saveReport, ctx, { ...actor, key: "report1", rowKeys: ["row", "hcp"] });
  const saved = ctx.tables.receivableItems[0]; assert.equal(saved.amount, 150); assert.equal(ctx.tables.dashboardState[0].manualReceivables[0].balance, 150);
  await call(tracker.allocate, ctx, { ...actor, receipt: receipt({ key: "part", itemKey: saved.key, transactionId: undefined, amount: 100, bankAmount: 100 }) }); assert.equal(ctx.tables.dashboardState[0].manualReceivables[0].balance, 50);
  await report(ctx, "report2", [reportRow({ amount: 120, paid: true })]); await call(tracker.saveReport, ctx, { ...actor, key: "report2", rowKeys: ["row"] });
  assert.equal(ctx.tables.receivableItems.length, 1); assert.equal(saved.amount, 170); assert.equal(ctx.tables.dashboardState[0].manualReceivables[0].balance, 70); assert.equal(saved.expectedDate, ctx.tables.receivableItems[0].expectedDate);
  assert.equal((await call(tracker.saveReport, ctx, { ...actor, key: "report2", rowKeys: ["row"] })).accepted, 0);
});
test("partial report save is resumable, source totals visible, and duplicate invoices stay pending", async () => {
  const ctx = setup(); ctx.tables.dashboardState[0].invoices = [{ ...invoice, invoiceNumber: "duplicate" }, { ...invoice, id: "second", invoiceNumber: "duplicate" }];
  const r = await call(tracker.previewReport, ctx, { ...actor, key: "review", week, origin: "Test", files: [], summary: 2100, rows: [reportRow({ section: "invoice", reference: "duplicate", amount: 1000, line: "a" }), reportRow({ key: "good", amount: 100 })] });
  assert.equal(r.gap, 1000); assert.match(r.rows[0].issue, /unique live invoice/);
  await call(tracker.saveReport, ctx, { ...actor, key: "review", rowKeys: ["good"] });
  const revised = await call(tracker.previewReport, ctx, { ...actor, key: "review", week, origin: "Test", files: [], rows: [reportRow({ section: "invoice", reference: "duplicate", amount: 1000, line: "a", invoiceId: "invoice" }), reportRow({ key: "good", amount: 999 })] });
  assert.equal(revised.rows[1].amount, 100); assert.equal(revised.accepted.length, 1); assert.equal(revised.rows[0].issue, undefined);
});
test("notifications are per recipient, historical enablement is silent, retries and uncertain delivery are independent", async () => {
  const ctx = setup(); await call(tracker.saveSettings, ctx, { ...actor, recipients: ["one", "two"], reminderTime: "09:00", rules: [] });
  await call(tracker.match, ctx, auth); assert.equal(ctx.tables.receivableDeliveries?.length ?? 0, 0);
  const ctx2 = setup(); ctx2.tables.receivableSettings = [{ _id: "settings", key: "default", recipients: ["one", "two"], reminderTime: "09:00", rules: [], enabledAt: new Date(Date.now() - 86400000).toISOString(), updatedAt: now }];
  await call(tracker.match, ctx2, auth); assert.equal(ctx2.tables.receivableDeliveries.length, 2);
  const jobs = await call(tracker.deliveryClaim, ctx2, auth); await call(tracker.deliveryComplete, ctx2, { ...auth, key: jobs[0].key, lease: jobs[0].lease, outcome: "sent" }); await call(tracker.deliveryComplete, ctx2, { ...auth, key: jobs[1].key, lease: jobs[1].lease, outcome: "retry", retryAfter: 60 });
  assert.deepEqual(ctx2.tables.receivableDeliveries.map(d => d.state), ["sent", "retry"]); assert.equal((await call(tracker.deliveryClaim, ctx2, auth)).length, 0);
  ctx2.tables.receivableDeliveries[1].nextAt = Date.now() - 1; const retry = await call(tracker.deliveryClaim, ctx2, auth); assert.equal(retry.length, 1);
  ctx2.tables.receivableDeliveries[1].nextAt = Date.now() - 1; await call(tracker.deliveryClaim, ctx2, auth); assert.equal(ctx2.tables.receivableDeliveries[1].state, "uncertain");
  await assert.rejects(call(tracker.retryDelivery, ctx2, { ...actor, key: jobs[1].key, confirmedNotDelivered: false }));
});
test("rejecting a candidate and checking Tariq never settles a balance", async () => {
  const ctx = setup(); await call(tracker.checked, ctx, { ...actor, key: item.key }); await call(tracker.rejectCandidate, ctx, { ...actor, key: item.key, transactionId: bank.id, reason: "Another stream" }); assert.equal((await call(tracker.match, ctx, auth)).matched, 0); assert.equal(ctx.tables.receivableItems[0].checkedDate, date); assert.equal(ctx.tables.receivableReceipts.length, 0);
});
test("an explicit bank reversal reopens the tracked balance without erasing prior evidence", async () => {
  const ctx = setup(); await call(tracker.match, ctx, auth); ctx.tables.bankTransactions[0].status = "voided"; await call(tracker.match, ctx, auth);
  assert.equal(ctx.tables.receivableReceipts[0].state, "reversed"); assert.equal(ctx.tables.dashboardState[0].manualReceivables[0].balance, 1000); assert.match(ctx.tables.receivableItems[0].review, /corrected/);
});
test("a reversed receipt cancels its pending payment confirmation", async () => {
  const ctx = setup(); ctx.tables.receivableSettings = [{ _id: "settings", key: "default", recipients: ["ali", "ali m", "alaa"], reminderTime: "09:00", rules: [], enabledAt: new Date(Date.now() - 86400000).toISOString(), updatedAt: now }];
  await call(tracker.match, ctx, auth); assert.equal(ctx.tables.receivableDeliveries.length, 3);
  await call(tracker.reverse, ctx, { ...actor, key: ctx.tables.receivableReceipts[0].key, reason: "Reversed payment" });
  assert.equal((await call(tracker.deliveryClaim, ctx, auth)).length, 0); assert.ok(ctx.tables.receivableDeliveries.every(d => d.state === "disabled"));
});
test("a monthly send task cannot be completed by an unrelated payer invoice", async () => {
  const ctx = setup(); Object.assign(ctx.tables.receivableItems[0], { kind: "monthly", payer: "SF Ishan", providerId: undefined, amount: 0 }); ctx.tables.dashboardState[0].invoices.push(invoice);
  await assert.rejects(call(tracker.linkInvoice, ctx, { ...actor, key: item.key, invoiceId: invoice.id }), /payer and billing entity/);
});
