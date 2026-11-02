import assert from "node:assert/strict";
import test from "node:test";
import { draftKissterraWeek, kissterraBillingPartners, meritRevenueLinesRequest, validateRevenueInvoiceEdit } from "./kissterraBilling";
import { kissterraFixture } from "./kissterraBilling.fixture";
import { reconcileMeritInvoices } from "./merit";
import { invoiceCopyPayload } from "./invoiceCopies";

test("Kissterra produces one weekly draft with positive account rows and a reconciled total", () => {
  const f = kissterraFixture();
  const invoice = draftKissterraWeek(f.state, f.partners, f.runs, f.period, f.now)!;
  assert.equal(f.state.invoices.length, 2);
  assert.equal(invoice.amount, 259024.93);
  assert.equal(invoice.status, "draft");
  assert.equal(invoice.meritDeliveryStatus, "not-sent");
  assert.deepEqual(invoice.revenueLines?.map(l => [l.accountId, l.amount]), [["1777", 258845], ["2036", 179.93]]);
  assert.deepEqual(invoice.revenueRunIds, f.runs.slice(0, 2).map(r => r.id));
  assert.deepEqual(f.state.revenueRuns.map(r => r.status), ["drafted", "drafted", "pulled", "pulled"]);
  assert.equal(new Set(f.state.revenueRuns.filter(r => r.status === "drafted").map(r => r.invoiceId)).size, 1);
  assert.equal(draftKissterraWeek(f.state, [...f.partners].reverse(), f.runs, f.period, f.now)?.id, invoice.id);
  assert.equal(f.state.invoices.length, 2);
  const request = meritRevenueLinesRequest(invoice, { id: "zero-tax", code: "VAT0", name: "Zero VAT", taxPct: 0 }, () => "SERVICE");
  assert.equal(request.InvoiceRow.length, 2);
  request.InvoiceRow.forEach((row, i) => {
    assert.ok(row.Item.Description.includes(f.partners[i].name));
    assert.ok(row.Item.Description.includes("2026-10-26 - 2026-11-01"));
    assert.ok(row.Item.Description.length <= 150);
    assert.equal(row.Quantity, 1);
  });
  assert.equal(request.TotalAmount, request.InvoiceRow.reduce((sum, row) => sum + row.Price, 0));
  assert.deepEqual(request.TaxAmount, [{ TaxId: "zero-tax", Amount: 0 }]);
});

test("missing, failed, incomplete, mismatched, or nonfinite account reports block the entire combined invoice", () => {
  for (const scenario of ["missing", "failed", "incomplete", "currency", "nonfinite", "duplicate", "customer", "open"]) {
    const f = kissterraFixture();
    if (scenario === "missing") f.runs.pop();
    if (scenario === "failed") f.runs[3].status = "failed";
    if (scenario === "incomplete") f.runs[3].periodEnd = "2026-10-31";
    if (scenario === "currency") f.runs[3].currency = "EUR";
    if (scenario === "nonfinite") f.runs[3].revenue = NaN;
    if (scenario === "duplicate") f.runs.push(f.runs[0]);
    if (scenario === "customer") f.partners[3].providerId = "different";
    assert.throws(() => draftKissterraWeek(f.state, f.partners, f.runs, f.period, scenario === "open" ? new Date("2026-11-01T00:00:00Z") : f.now));
    assert.equal(f.state.invoices.length, 1, scenario);
  }
});

test("all zero weeks and deliberately deleted drafts create no invoice", () => {
  const f = kissterraFixture();
  assert.equal(draftKissterraWeek(f.state, f.partners, f.runs.map(r => ({ ...r, revenue: 0 })), f.period, f.now), undefined);
  f.runs[0].draftDeletedAt = f.now.toISOString();
  assert.equal(draftKissterraWeek(f.state, f.partners, f.runs, f.period, f.now), undefined);
  assert.equal(f.state.invoices.length, 1);
});

test("future approved accounts join the group without affecting other networks", () => {
  const f = kissterraFixture();
  const dudu = { ...f.partners[0], id: "revenue-kissterra-2074", name: "Kissterra — Dudu Media (Account ID: 2074)", affiliateId: "2074" };
  f.partners.push(dudu);
  f.runs.push({ ...f.runs[0], id: "run-2074", partnerId: dudu.id, partnerName: dudu.name, revenue: 25 });
  f.state.revenueRuns = f.runs;
  assert.equal(kissterraBillingPartners([...f.partners, { ...f.partners[0], source: "tune", networkIdEnv: "OTHER_NETWORK" }, { ...dudu, enabled: false }]).length, 5);
  const invoice = draftKissterraWeek(f.state, f.partners, f.runs, f.period, f.now)!;
  assert.deepEqual(invoice.revenueLines?.map(l => l.accountId), ["1777", "2036", "2074"]);
  assert.equal(invoice.amount, 259049.93);
});

test("saved lines survive Merit refresh and cannot be flattened by edits or local duplication", () => {
  const f = kissterraFixture();
  const invoice = draftKissterraWeek(f.state, f.partners, f.runs, f.period, f.now)!;
  const synced = reconcileMeritInvoices([{ ...invoice, revenueLines: undefined, externalId: "merit-id", description: "Merit invoice" }], [{ ...invoice, externalId: "merit-id" }], true)[0];
  assert.deepEqual(synced.revenueLines, invoice.revenueLines);
  assert.doesNotThrow(() => validateRevenueInvoiceEdit(invoice, { ...invoice, dueDate: "2026-11-15" }));
  assert.throws(() => validateRevenueInvoiceEdit(invoice, { ...invoice, amount: invoice.amount + 1 }), /fixed/);
  assert.throws(() => validateRevenueInvoiceEdit(invoice, { ...invoice, periodStart: "2026-10-19" }), /fixed/);
  assert.throws(() => invoiceCopyPayload(invoice), /account lines/);
  assert.throws(() => meritRevenueLinesRequest({ ...invoice, amount: invoice.amount + 1 }, { id: "tax", code: "0", name: "0", taxPct: 0 }, () => "SERVICE"), /reconcile/);
});

test("existing historical account invoices cannot be duplicated by grouped billing", () => {
  const f = kissterraFixture();
  const invoice = draftKissterraWeek(f.state, f.partners, f.runs, f.period, f.now)!;
  const old = { ...invoice, id: "old-account-invoice", billingRuleId: f.partners[0].id, revenueLines: undefined, revenueRunIds: [f.runs[0].id], externalId: "issued" };
  f.state.invoices = [old];
  assert.equal(draftKissterraWeek(f.state, f.partners, f.runs, f.period, f.now)?.id, old.id);
  assert.deepEqual(f.state.invoices, [old]);
});
