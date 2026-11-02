import assert from "node:assert/strict";
import test from "node:test";
import { meritInvoiceCopyDetails } from "./merit";
import { invoiceCopyPayload } from "./invoiceCopies";
import { meritCopyRequest, validateMeritInvoiceCopy, verifyMeritCopyTaxes } from "./meritInvoiceCopy";
import type { Invoice } from "./types";

const multiLineMeritFixture = () => ({
  Header: { AccountingDock: 1, PriceInclVat: false, TotalAmount: 230, TaxAmount: 10, RoundingAmount: 0.01, TotalSum: 240.01, CurrencyCode: "USD", DepartmentCode: "SALES", HComment: "Header note", FComment: "Footer note", ContractNo: "CON-1" },
  Lines: [
    { ArticleCode: "SERVICE", Description: "First service", Quantity: 2, Price: 100, DiscountPct: 10, DiscountAmount: 20, AmountExclVat: 180, TaxId: "zero", TaxPct: 0, VatAmount: 0, AccountCode: "4000", DepartmentCode: "ADS", UOMName: "hours" },
    { ArticleCode: "CONSULT", Description: "Second service", Quantity: 5, Price: 10, DiscountPct: 0, DiscountAmount: 0, AmountExclVat: 50, TaxId: "standard", TaxPct: 20, VatAmount: 10, AccountCode: "4010", DepartmentCode: "", UOMName: "hours" }
  ]
});

test("multi-line duplicates retain discounts, mixed taxes, accounting codes, comments and rounding through draft serialization", () => {
  const details = meritInvoiceCopyDetails(multiLineMeritFixture());
  assert.equal(details.amount, 230);
  const source = { ...details, documentType: "sales_invoice", issueDate: "2026-10-01", dueDate: "2026-10-31", currency: "USD", externalId: "source-invoice", customerName: "Client", status: "paid" } as Invoice;
  const payload = JSON.parse(JSON.stringify(invoiceCopyPayload(source, "2026-11-01")));
  assert.equal(payload.externalId, undefined); assert.equal(payload.status, undefined);
  assert.equal(payload.issueDate, "2026-11-01"); assert.equal(payload.dueDate, "2026-12-01");
  const request = meritCopyRequest(payload.meritCopy);
  assert.equal(request.InvoiceRow.length, 2);
  assert.deepEqual(request.InvoiceRow[0], { Item: { Code: "SERVICE", Description: "First service", UOMName: "hours" }, Quantity: 2, Price: 100, DiscountPct: 10, DiscountAmount: 20, TaxId: "zero", GLAccountCode: "4000", DepartmentCode: "ADS" });
  assert.deepEqual(request.TaxAmount, [{ TaxId: "zero", Amount: 0 }, { TaxId: "standard", Amount: 10 }]);
  assert.equal(request.TotalAmount, 230); assert.equal(request.RoundingAmount, 0.01); assert.equal(request.Hcomment, "Header note");
  verifyMeritCopyTaxes(payload.meritCopy, [{ id: "zero", code: "0", name: "Zero", taxPct: 0 }, { id: "standard", code: "20", name: "Standard", taxPct: 20 }]);
  assert.throws(() => verifyMeritCopyTaxes(payload.meritCopy, [{ id: "zero", code: "0", name: "Zero", taxPct: 0 }]), /tax has changed/);
  assert.throws(() => validateMeritInvoiceCopy(payload.meritCopy, 231, "USD"), /do not match/);
  assert.throws(() => validateMeritInvoiceCopy(payload.meritCopy, 230, "EUR"), /do not match/);
});

test("incomplete totals and unsupported accounting are blocked before copying", () => {
  const mismatch = multiLineMeritFixture(); mismatch.Header.TotalAmount = 231;
  assert.throws(() => meritInvoiceCopyDetails(mismatch), /do not match/);
  const missing = multiLineMeritFixture(); delete (missing.Lines[1] as Partial<typeof missing.Lines[number]>).Quantity;
  assert.throws(() => meritInvoiceCopyDetails(missing), /incomplete/);
  const stock = multiLineMeritFixture(); Object.assign(stock.Lines[1], { BatchNo: "batch" });
  assert.throws(() => meritInvoiceCopyDetails(stock), /stock/);
});
