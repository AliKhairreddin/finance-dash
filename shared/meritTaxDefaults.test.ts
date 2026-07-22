import assert from "node:assert/strict";
import test from "node:test";
import { inferMeritTaxDefault, type MeritInvoiceTaxSample } from "./meritTaxDefaults";

function sample(invoiceNumber: string, taxIds: string[], issueDate = `2026-07-${invoiceNumber.padStart(2, "0")}`): MeritInvoiceTaxSample {
  return { invoiceId: invoiceNumber, invoiceNumber, issueDate, taxIds };
}

test("Merit tax default uses the strict majority tax from the five most recent invoices", () => {
  const result = inferMeritTaxDefault([
    sample("01", ["tax-old"], "2026-06-01"),
    sample("02", ["tax-standard"]),
    sample("03", ["tax-standard"]),
    sample("04", ["tax-other"]),
    sample("05", ["tax-standard"]),
    sample("06", ["tax-other"])
  ]);

  assert.deepEqual({
    status: result.status,
    defaultMeritTaxId: result.defaultMeritTaxId,
    sampledInvoiceCount: result.sampledInvoiceCount,
    usableInvoiceCount: result.usableInvoiceCount,
    supportingInvoiceCount: result.supportingInvoiceCount
  }, {
      status: "inferred",
      defaultMeritTaxId: "tax-standard",
      sampledInvoiceCount: 5,
      usableInvoiceCount: 5,
      supportingInvoiceCount: 3
  });
});

test("Merit tax default does not guess when recent history has no strict majority", () => {
  const result = inferMeritTaxDefault([
    sample("01", ["tax-a"]),
    sample("02", ["tax-a"]),
    sample("03", ["tax-b"]),
    sample("04", ["tax-b"]),
    sample("05", ["tax-c"])
  ]);

  assert.equal(result.status, "ambiguous");
  assert.equal(result.defaultMeritTaxId, undefined);
});

test("Merit tax default excludes invoices that use multiple taxes from voting", () => {
  const result = inferMeritTaxDefault([
    sample("01", ["tax-a", "tax-b"]),
    sample("02", ["tax-a"]),
    sample("03", ["tax-a"])
  ]);

  assert.deepEqual({
    status: result.status,
    defaultMeritTaxId: result.defaultMeritTaxId,
    sampledInvoiceCount: result.sampledInvoiceCount,
    usableInvoiceCount: result.usableInvoiceCount,
    supportingInvoiceCount: result.supportingInvoiceCount
  }, {
      status: "inferred",
      defaultMeritTaxId: "tax-a",
      sampledInvoiceCount: 3,
      usableInvoiceCount: 2,
      supportingInvoiceCount: 2
  });
});

test("Merit tax default reports no history when no invoice has a usable tax", () => {
  const result = inferMeritTaxDefault([sample("01", []), sample("02", ["tax-a", "tax-b"])]);

  assert.equal(result.status, "no-tax-history");
  assert.equal(result.defaultMeritTaxId, undefined);
});
