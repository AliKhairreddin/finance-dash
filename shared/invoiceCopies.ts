import type { CreateInvoicePayload, Invoice } from "./types";

export function invoiceCopyPayload(source: Invoice): CreateInvoicePayload {
  return {
    providerId: source.providerId,
    documentType: source.documentType,
    customerName: source.customerName,
    amount: source.amount,
    currency: source.currency,
    issueDate: source.issueDate,
    dueDate: source.dueDate,
    description: source.description,
    periodStart: source.periodStart,
    periodEnd: source.periodEnd,
    taxId: source.taxId
  };
}
