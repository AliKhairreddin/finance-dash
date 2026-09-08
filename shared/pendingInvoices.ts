import { invoiceOutstanding } from "./income";
import type { Invoice, PaymentAllocation } from "./types";

export function pendingInvoices(invoices: Invoice[], payments: PaymentAllocation[]) {
  return invoices.filter(invoice => invoice.documentType === "sales_invoice" && invoice.status !== "paid")
    .map(invoice => ({ invoice, outstanding: invoiceOutstanding(invoice, payments) }))
    .filter(row => row.outstanding > 0)
    .sort((a, b) => a.invoice.dueDate.localeCompare(b.invoice.dueDate) || a.invoice.invoiceNumber.localeCompare(b.invoice.invoiceNumber));
}
