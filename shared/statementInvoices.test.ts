import assert from "node:assert/strict";
import test from "node:test";
import { matchingInvoiceAddress, invoiceTotals, invoiceLayout, validateInvoiceDraft, validateInvoiceAi, type InvoiceDraft } from "./statementInvoices";
const draft: InvoiceDraft = { number: "TEST-1", date: "2026-10-26", dueDate: "", customer: "Test Customer", customerAddress: "Test address", notes: "", currency: "EUR", taxMode: "included", lines: [{ transactionId: "one", description: "Service", amount: "121.00", taxPercent: "21" }] };
test("invoice totals preserve exact money for inclusive, added, zero and three-decimal tax", () => {
  assert.deepEqual(invoiceTotals(draft), { net: "100.00", tax: "21.00", total: "121.00", lines: [{ net: "100.00", tax: "21.00", total: "121.00" }] });
  assert.equal(invoiceTotals({ ...draft, taxMode: "added" }).total, "146.41");
  assert.equal(invoiceTotals({ ...draft, currency: "KWD", lines: [{ ...draft.lines[0], amount: "1.001", taxPercent: "0" }] }).total, "1.001");
  assert.equal(invoiceTotals({ ...draft, lines: Array.from({ length: 200 }, (_, i) => ({ ...draft.lines[0], transactionId: String(i), amount: "0.01", taxPercent: "0" })) }).total, "2.00");
});
test("invoice drafts reject invalid dates, duplicate selections, negative money and implicit tax", () => {
  assert.equal(validateInvoiceDraft(draft).lines.length, 1);
  assert.throws(() => validateInvoiceDraft({ ...draft, date: "2026-02-30" }));
  assert.throws(() => validateInvoiceDraft({ ...draft, lines: [draft.lines[0], draft.lines[0]] }));
  for (const line of [{ ...draft.lines[0], amount: "-1" }, { ...draft.lines[0], taxPercent: "" }, { ...draft.lines[0], taxPercent: "101" }]) assert.throws(() => validateInvoiceDraft({ ...draft, lines: [line] }));
});
test("AI cannot drop, duplicate or substitute selected invoice rows", () => {
  assert.deepEqual(validateInvoiceAi({ lines: [{ transactionId: "one", description: "New description", amount: "99999" }] }, ["one"]), [{ transactionId: "one", description: "New description" }]);
  assert.throws(() => validateInvoiceAi({ lines: [] }, ["one"]));
  assert.throws(() => validateInvoiceAi({ lines: [{ transactionId: "other", description: "Bad" }] }, ["one"]));
});
test("invoice example crops are bounded and company details must be explicit", () => {
  assert.throws(() => invoiceLayout({ headerPercent: 99, footerPercent: 0, sellerDetails: "Seller", paymentDetails: "" }));
  assert.throws(() => invoiceLayout({ headerPercent: 0, footerPercent: 0, sellerDetails: "", paymentDetails: "" }));
});


test("saved invoice contacts match only explicit names and aliases, including legal invoice names", () => {
  const address = { name: "Supplier", invoiceName: "Supplier B.V.", aliases: ["SUPPLIER NLD Apple Pay"], address: "Street 1", vat: "NL123456789B01" };
  for (const name of ["supplier", " Supplier  B.V. ", "Supplier NLD Apple Pay"]) assert.equal(matchingInvoiceAddress([address], name), address);
  assert.equal(matchingInvoiceAddress([address], "Supplier other branch"), undefined);
  assert.equal(matchingInvoiceAddress([address], ""), undefined);
});
