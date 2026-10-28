import assert from "node:assert/strict";
import test from "node:test";
import { defaultInvoiceDesign, invoiceIssuerKey, validateInvoiceCopy, validateInvoiceDesign } from "./statementInvoiceDesign";
import { statementCompanies } from "./statements";

test("issuer designs distinguish our companies and resolve supplier aliases across buyers", () => {
  const addresses = [{ name: "Nespresso", invoiceName: "Nespresso Nederland BV", address: "Street 1", aliases: ["Nespresso Amstelveen Apple Pay"] }];
  const supplier = invoiceIssuerKey(addresses[0].aliases[0], "inch-engineering", "out", addresses);
  assert.equal(supplier, invoiceIssuerKey("Nespresso Nederland BV", "amg-holding", "out", addresses));
  assert.equal(invoiceIssuerKey("Customer", "inch-engineering", "in", addresses), "our:inch-engineering");
  const designs = statementCompanies.map(c => defaultInvoiceDesign(`our:${c.id}`, c.name));
  assert.equal(new Set(designs.map(d => d.accent)).size, designs.length);
  assert.notDeepEqual(defaultInvoiceDesign(supplier, "Nespresso"), defaultInvoiceDesign("supplier:coca-cola", "Coca-Cola"));
  assert.deepEqual(defaultInvoiceDesign(supplier, "Nespresso"), defaultInvoiceDesign(supplier, "Nespresso"));
  for (const design of designs) assert.deepEqual(validateInvoiceDesign(design), design);
  assert.throws(() => validateInvoiceDesign({ ...designs[0], logoPath: "https://untrusted.test/logo.png" }));
  assert.throws(() => validateInvoiceDesign({ ...designs[0], accent: "red;background:url(https://bad.test)" }));
});
test("copied example layouts reject overlaps and out-of-page or incomplete mappings", () => {
  const keys = ["seller", "number", "date", "customer", "customerAddress", "lines", "net", "tax", "total"] as const;
  const copy = { width: 595, height: 842, currency: "EUR", fields: keys.map((key, i) => ({ key, x: 30, y: 30 + 80 * i, width: 500, height: 50, fontSize: 10, color: "#222222", background: "#ffffff", align: "left" as const, font: "sans" as const })), erase: [], columns: (["description", "net", "taxPercent", "total"] as const).map((key, i) => ({ key, x: 30 + 125 * i, width: 125 })) };
  assert.deepEqual(validateInvoiceCopy(copy), copy);
  // Canvas clips removal rectangles at the page edge; an empty rectangle is a safe no-op.
  assert.ok(validateInvoiceCopy({ ...copy, erase: [{ x: 0, y: 0, width: 0, height: 0 }, { x: -2, y: 0, width: 10, height: 10 }] }));
  assert.throws(() => validateInvoiceCopy({ ...copy, fields: copy.fields.slice(1) }), /must include/);
  assert.throws(() => validateInvoiceCopy({ ...copy, fields: copy.fields.map((f, i) => i === 1 ? { ...f, y: 30 } : f) }), /overlap/);
  assert.throws(() => validateInvoiceCopy({ ...copy, fields: copy.fields.map(f => ({ ...f, x: 200 })) }), /outside the page/);
  assert.throws(() => validateInvoiceCopy({ ...copy, columns: copy.columns.map(c => ({ ...c, x: 30 })) }), /overlap/);
});
