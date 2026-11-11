import test from "node:test";
import assert from "node:assert/strict";
import { defaultTrackerRules, parseTrackerCsv, resolveTrackerDate, sameTrackerReceipt, trackerAmounts, trackerClock, trackerGroupKey, trackerMatchReason, trackerSourceKey, trackerTiming, trackerWeek, type TrackerItem } from "./receivablesTracker";
import type { Provider, Transaction } from "./types";
import { bankProviderTransactionId } from "./providerIdentity";
const item: TrackerItem = { key: "lead", payer: "LeadPier", providerId: "p", entity: "dn", currency: "USD", amount: 1000, kind: "manual", expectedDate: "2026-11-10", week: "2026-11-09", payerSent: false, sent: false, archived: false, revision: 1, createdAt: "2026-11-09", updatedAt: "2026-11-09" };
const provider: Provider = { id: "p", name: "LeadPier", type: "client", tags: [], aliases: [], source: "manual", createdAt: "2026-01-01" };
const bank: Transaction = { id: bankProviderTransactionId("revolut", ["account", "receipt", "leg"]), source: "revolut", wiseEntity: "dn", accountName: "USD", date: "2026-11-10", amount: 1000, currency: "USD", direction: "in", status: "settled", category: "Media buying direct", description: "Payment", counterparty: "LeadPier", rawName: "LeadPier" };
test("Beirut dates have Tuesday due, Wednesday grace, Thursday overdue and preserve old dates", () => {
  assert.equal(trackerTiming(item, 1000, "2026-11-10"), "Due today"); assert.equal(trackerTiming(item, 1000, "2026-11-11"), "Grace day"); assert.equal(trackerTiming(item, 1000, "2026-11-12"), "Overdue");
  assert.equal(resolveTrackerDate({ week: "2026-11-16", payer: "LeadPier", existing: item }).expectedDate, "2026-11-10");
  assert.equal(resolveTrackerDate({ week: "2026-11-09", payer: "LeadPier" }).expectedDate, "2026-11-10");
  assert.equal(trackerWeek("2026-11-01"), "2026-10-26");
  assert.equal(trackerClock(new Date("2026-07-01T21:30:00Z")).date, "2026-07-02"); assert.equal(trackerClock(new Date("2026-11-01T21:30:00Z")).date, "2026-11-01");
});
test("ambiguous slots and historical hints never invent dates or terms", () => {
  for (const payer of ["BuyGoods", "ClickBank", "QuinStreet", "SmartFinancial", "Tinera"]) assert.equal(resolveTrackerDate({ week: item.week, payer }).expectedDate, undefined);
  assert.equal(resolveTrackerDate({ week: item.week, payer: "BuyGoods", slot: 4 }).expectedDate, "2026-11-13");
  assert.equal(resolveTrackerDate({ week: item.week, payer: "SmartFinancial", cycleMonth: "2026-12" }).expectedDate, "2026-12-03");
  assert.equal(resolveTrackerDate({ week: item.week, payer: "QuinStreet", explicit: "2026-11-16" }).expectedDate, "2026-11-16");
  assert.equal(resolveTrackerDate({ week: item.week, payer: "Custom", cycleMonth: "2026-02" }, [{ payer: "Custom", kind: "monthly", slots: [31], approved: true, label: "31st" }]).expectedDate, undefined);
  assert.equal(defaultTrackerRules.filter(r => r.kind === "hint").some(r => r.approved), false);
});
test("a unique LeadPier USD1000 candidate requires payer, currency, scope and booked external cash", () => {
  assert.equal(trackerMatchReason(item, bank, provider, 1000), undefined);
  for (const change of [{ currency: "EUR" }, { wiseEntity: "lmd" }, { status: "pending" }, { amount: 999 }, { counterparty: "Other", rawName: "Other", description: "LeadPier recipient" }, { category: "Internal transfer" }, { reference: "refund" }, { date: "2026-06-01" }]) assert.ok(trackerMatchReason(item, { ...bank, ...change } as Transaction, provider, 1000));
  assert.ok(trackerMatchReason({ ...item, entity: undefined }, bank, provider, 1000));
  assert.ok(trackerMatchReason({ ...item, rejectedTransactions: [bank.id] }, bank, provider, 1000));
});
test("payer sent does not settle; manual cash survives partial and cumulative updates", () => {
  assert.equal(trackerAmounts({ ...item, payerSent: true }, [], [], []).outstanding, 1000);
  assert.equal(trackerAmounts({ ...item, payerSent: true }, [], [], []).status, "Paid by payer / awaiting receipt");
  const receipts = [{ itemKey: item.key, state: "active", amount: 300 }] as any;
  assert.deepEqual(trackerAmounts(item, receipts, [], []), { amount: 1000, received: 300, outstanding: 700, currency: "USD", status: "Partially received" });
  assert.equal(trackerAmounts({ ...item, amount: 1200 }, receipts, [], []).outstanding, 900);
});
test("source identities survive weekly changes and ACP/HCP aggregate by period and type", () => {
  const rows = parseTrackerCsv('week,section,payer,amount,currency,period,source,category,paid\n2026-11-09,earnings,QuinStreet,5148.19,USD,2026-11,ACP,Leads,0\n2026-11-09,earnings,QuinStreet,455.11,USD,2026-11,HCP,Leads,0\n2026-11-09,earnings,QuinStreet,14864.20,USD,2026-11,ACP,Clicks,0\n2026-11-09,earnings,QuinStreet,550.38,USD,2026-11,HCP,Clicks,0', item.week);
  assert.equal(trackerGroupKey(rows[0]), trackerGroupKey(rows[1])); assert.notEqual(trackerGroupKey(rows[0]), trackerGroupKey(rows[2]));
  assert.equal(Number((rows[0].amount + rows[1].amount).toFixed(2)), 5603.30); assert.equal(Number((rows[2].amount + rows[3].amount).toFixed(2)), 15414.58);
  assert.equal(trackerSourceKey(rows[0]), trackerSourceKey({ ...rows[0], week: "2026-11-16", amount: 9999 }));
  assert.notEqual(trackerSourceKey(rows[0]), trackerSourceKey(rows[1]));
  assert.equal(sameTrackerReceipt(bank.id, bank.id), true);
});
test("CSV retains duplicate invoice source lines and does not treat missing status as paid", () => {
  const rows = parseTrackerCsv('payer,amount,reference,line,paid\nKissterra,10,2026/1439,a,0\nKissterra,20,2026/1439,b,0\n"Client, Inc",30,,,', item.week);
  assert.notEqual(trackerSourceKey(rows[0]), trackerSourceKey(rows[1])); assert.ok(rows[2].issue); assert.equal(rows[2].payer, "Client, Inc");
});
