import { invoicePdfFileName } from "../../shared/invoiceFiles";
import type { Invoice } from "../../shared/types";

export async function downloadInvoicePdfFile(invoice: Invoice, apiBase: string): Promise<void> {
  const response = await fetch(`${apiBase}/invoices/${encodeURIComponent(invoice.id)}/pdf`);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new Error(body?.message || "Invoice PDF could not be downloaded");
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = invoicePdfFileName(invoice);
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
