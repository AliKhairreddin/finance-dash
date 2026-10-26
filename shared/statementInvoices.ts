import { statementAmountDecimal, statementAmountMinor } from "./statements";

export type InvoiceTemplateLayout = { headerPercent: number; footerPercent: number; sellerDetails: string; paymentDetails: string };
export type InvoiceLine = { transactionId: string; description: string; amount: string; taxPercent: string };
export type InvoiceDraft = { number: string; date: string; dueDate: string; customer: string; customerAddress: string; notes: string; currency: string; taxMode: "included" | "added"; lines: InvoiceLine[] };
export const invoiceSelectionLimit = 200;
export function invoiceText(value: unknown, label: string, maximum = 1000, required = false): string {
  if (typeof value !== "string" || value.length > maximum || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw new Error(`Check ${label}`);
  if (required && !value.trim()) throw new Error(`Enter ${label}`);
  return value.trim();
}
export function invoiceLayout(value: unknown): InvoiceTemplateLayout {
  const v = value as InvoiceTemplateLayout;
  if (!v || !Number.isFinite(v.headerPercent) || v.headerPercent < 0 || v.headerPercent > 30 || !Number.isFinite(v.footerPercent) || v.footerPercent < 0 || v.footerPercent > 20) throw new Error("Keep the header between 0–30% and the footer between 0–20%");
  return { headerPercent: v.headerPercent, footerPercent: v.footerPercent, sellerDetails: invoiceText(v.sellerDetails, "company details", 1000, true), paymentDetails: invoiceText(v.paymentDetails, "payment details", 1000) };
}
export function validateInvoiceDraft(value: unknown): InvoiceDraft {
  const v = value as InvoiceDraft;
  if (!v || !Array.isArray(v.lines) || !v.lines.length || v.lines.length > invoiceSelectionLimit || !["included", "added"].includes(v.taxMode)) throw new Error(`An invoice needs 1–${invoiceSelectionLimit} lines and a tax setting`);
  const date = (s: unknown, optional = false) => { if (optional && s === "") return ""; if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0, 10) !== s) throw new Error("Enter a valid date"); return s; };
  const result: InvoiceDraft = { number: invoiceText(v.number, "invoice number", 80, true), date: date(v.date), dueDate: date(v.dueDate, true), customer: invoiceText(v.customer, "customer name", 250, true), customerAddress: invoiceText(v.customerAddress, "customer address", 1000, true), notes: invoiceText(v.notes, "notes", 1500), currency: invoiceText(v.currency, "currency", 4, true), taxMode: v.taxMode, lines: v.lines.map(line => {
    const amount = statementAmountDecimal(statementAmountMinor(invoiceText(line.amount, "line amount", 40), v.currency), v.currency);
    if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(line.taxPercent) || Number(line.taxPercent) > 100) throw new Error("Enter a tax rate from 0 to 100");
    return { transactionId: invoiceText(line.transactionId, "selected transaction", 100, true), description: invoiceText(line.description, "line description", 500, true), amount, taxPercent: line.taxPercent };
  }) };
  if (new Set(result.lines.map(l => l.transactionId)).size !== result.lines.length) throw new Error("A transaction can appear only once in this invoice");
  if (result.dueDate && result.dueDate < result.date) throw new Error("The due date must be on or after the invoice date");
  return result;
}
export function invoiceTotals(draft: InvoiceDraft) {
  let net = 0n, tax = 0n;
  const lines = draft.lines.map(line => {
    const amount = BigInt(statementAmountMinor(line.amount, draft.currency));
    const rate = BigInt(Math.round(Number(line.taxPercent) * 100));
    const denominator = draft.taxMode === "included" ? 10000n + rate : 10000n;
    const lineTax = (amount * rate + denominator / 2n) / denominator;
    const lineNet = draft.taxMode === "included" ? amount - lineTax : amount;
    net += lineNet; tax += lineTax;
    return { net: statementAmountDecimal(String(lineNet), draft.currency), tax: statementAmountDecimal(String(lineTax), draft.currency), total: statementAmountDecimal(String(lineNet + lineTax), draft.currency) };
  });
  return { net: statementAmountDecimal(String(net), draft.currency), tax: statementAmountDecimal(String(tax), draft.currency), total: statementAmountDecimal(String(net + tax), draft.currency), lines };
}
export function validateInvoiceAi(value: unknown, transactionIds: string[]): Array<{ transactionId: string; description: string }> {
  const rows = (value as { lines?: unknown[] })?.lines;
  if (!Array.isArray(rows) || rows.length !== transactionIds.length) throw new Error("AI did not return every selected line. Try again");
  const result = rows.map(raw => { const row = raw as InvoiceLine; return { transactionId: invoiceText(row.transactionId, "transaction", 100, true), description: invoiceText(row.description, "AI description", 500, true) }; });
  if (new Set(result.map(r => r.transactionId)).size !== transactionIds.length || result.some(r => !transactionIds.includes(r.transactionId))) throw new Error("AI returned a different selection. Try again");
  return result;
}
