import type { Invoice } from "./types";

const maximumMeritPdfBase64Length = 24 * 1024 * 1024;

function fileNamePart(value: string, maximumLength: number): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maximumLength)
    .replace(/-+$/g, "");
}

export function invoicePdfFileName(
  invoice: Pick<Invoice, "amount" | "currency" | "customerName" | "invoiceNumber">
): string {
  const customer = fileNamePart(invoice.customerName, 80) || "invoice";
  const amount = Number.isFinite(invoice.amount) ? invoice.amount.toFixed(2) : "amount";
  const currency = fileNamePart(invoice.currency, 12) || "currency";
  const invoiceNumber = fileNamePart(invoice.invoiceNumber, 50) || "number";
  return `${customer}-${amount}-${currency}-${invoiceNumber}.pdf`;
}

export function decodeMeritInvoicePdf(value: unknown): Uint8Array<ArrayBuffer> {
  if (typeof value !== "string") throw new Error("Merit did not return an invoice PDF");
  const encoded = value.replace(/\s+/g, "");
  if (
    encoded.length === 0
    || encoded.length > maximumMeritPdfBase64Length
    || encoded.length % 4 !== 0
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
  ) {
    throw new Error("Merit returned an invalid invoice PDF");
  }

  let binary: string;
  try {
    binary = atob(encoded);
  } catch {
    throw new Error("Merit returned an invalid invoice PDF");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
    throw new Error("Merit returned an invalid invoice PDF");
  }
  return bytes;
}
