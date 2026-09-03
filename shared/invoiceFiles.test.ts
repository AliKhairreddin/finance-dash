import assert from "node:assert/strict";
import test from "node:test";
import { decodeMeritInvoicePdf, invoicePdfFileName } from "./invoiceFiles";

test("invoice PDF filenames include customer, amount, currency, and invoice number", () => {
  assert.equal(
    invoicePdfFileName({
      customerName: "Acme & Partners OÜ",
      amount: 1250,
      currency: "USD",
      invoiceNumber: "2026/1304"
    }),
    "acme-partners-ou-1250.00-usd-2026-1304.pdf"
  );
});

test("Merit invoice PDF decoding accepts PDFs and rejects other base64 content", () => {
  const pdf = Buffer.from("%PDF-1.7\ninvoice", "utf8").toString("base64");
  assert.equal(new TextDecoder().decode(decodeMeritInvoicePdf(pdf)), "%PDF-1.7\ninvoice");
  assert.throws(
    () => decodeMeritInvoicePdf(Buffer.from("not a PDF", "utf8").toString("base64")),
    /invalid invoice PDF/
  );
});
