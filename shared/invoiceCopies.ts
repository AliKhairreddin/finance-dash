import type { CreateInvoicePayload, Invoice } from "./types";
import { financeOperatingDate, shiftFinanceOperatingDate } from "./operatingDate";

function paymentTermDays(source: Invoice): number {
  const issueDate = Date.parse(`${source.issueDate}T00:00:00.000Z`);
  const dueDate = Date.parse(`${source.dueDate}T00:00:00.000Z`);
  if (!Number.isFinite(issueDate) || !Number.isFinite(dueDate)) return 0;
  return Math.max(0, Math.round((dueDate - issueDate) / 86_400_000));
}

export function invoiceCopyPayload(source: Invoice, issueDate = financeOperatingDate()): CreateInvoicePayload {
  return {
    providerId: source.providerId,
    documentType: source.documentType,
    customerName: source.customerName,
    amount: source.amount,
    currency: source.currency,
    issueDate,
    dueDate: shiftFinanceOperatingDate(issueDate, paymentTermDays(source)),
    description: source.description,
    periodStart: source.periodStart,
    periodEnd: source.periodEnd,
    taxId: source.taxId
  };
}
