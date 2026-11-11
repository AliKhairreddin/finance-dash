import { dashboardInvoiceDeletionBlockReason } from "./invoiceDeletion";
import type { CreateManualReceivablePayload, Invoice, LedgerItem, PaymentAllocation } from "./types";

function isIsoCalendarDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export function manualReceivableFromPayload(payload: CreateManualReceivablePayload, id: string): LedgerItem {
  const name = payload.name?.trim();
  const currency = payload.currency?.trim().toUpperCase();
  if (!name || name.length > 200) throw new Error("Enter a receivable name of up to 200 characters");
  if (!Number.isFinite(payload.amount) || payload.amount <= 0) throw new Error("Receivable amount must be positive");
  if (!currency || !/^[A-Z0-9]{2,12}$/.test(currency)) throw new Error("Receivable currency is invalid");
  if (payload.dueDate && !isIsoCalendarDate(payload.dueDate)) throw new Error("Expected payment date is invalid");
  const notes = payload.notes?.trim() || undefined;
  if (notes && notes.length > 1000) throw new Error("Receivable note is too long");
  return { id, name, currency, balance: Number(payload.amount.toFixed(2)), source: "manual", notes, dueDate: payload.dueDate || undefined };
}

/** Validate the complete batch before either list changes. */
export function openItemDeletionBlockReason(invoice: Invoice, payments: PaymentAllocation[]): string | undefined {
  return dashboardInvoiceDeletionBlockReason(invoice.status === "open" ? { ...invoice, status: "draft" } : invoice, payments);
}

export function validateOpenItemDeletion(ids: string[], invoices: Invoice[], manual: LedgerItem[], payments: PaymentAllocation[]): Set<string> {
  if (!Array.isArray(ids) || !ids.length || ids.length > 200 || new Set(ids).size !== ids.length || ids.some(id => typeof id !== "string")) {
    throw new Error("Select between 1 and 200 unique open items");
  }
  for (const id of ids) {
    if (manual.some(item => item.id === id)) continue;
    const invoice = invoices.find(item => item.id === id);
    if (!invoice) throw new Error("Open item no longer exists; refresh the list");
    const reason = openItemDeletionBlockReason(invoice, payments);
    if (reason) throw new Error(`${invoice.invoiceNumber}: ${reason}`);
  }
  return new Set(ids);
}
