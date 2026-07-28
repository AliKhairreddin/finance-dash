import type { Invoice } from "./types";

export function copyInvoiceToDraft(
  source: Invoice,
  invoiceNumber: string,
  id: string,
  createdAt: string
): Invoice {
  return {
    id,
    providerId: source.providerId,
    documentType: source.documentType,
    origin: "manual",
    customerName: source.customerName,
    amount: source.amount,
    currency: source.currency,
    status: "draft",
    meritDeliveryStatus: "not-sent",
    invoiceNumber,
    issueDate: source.issueDate,
    dueDate: source.dueDate,
    source: "manual",
    description: source.description,
    revenueRunIds: [],
    periodStart: source.periodStart,
    periodEnd: source.periodEnd,
    taxId: source.taxId,
    createdAt,
    updatedAt: createdAt
  };
}
