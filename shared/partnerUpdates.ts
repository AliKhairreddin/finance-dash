import { pendingInvoices } from "./pendingInvoices";
import type { CashFlowSnapshot, DashboardSnapshot, FxRate } from "./types";

export const partnerUpdateRecipients = ["Amin", "Sani", "Ben", "Ali", "Ali M"] as const;
export const partnerUpdateReportKinds = ["cash-flow", "open-invoices"] as const;
export type PartnerReportKind = typeof partnerUpdateReportKinds[number];
export type PartnerDeliveryState = "pending" | "sending" | "sent" | "failed" | "unconfirmed";
export interface PartnerUpdateStatus {
  id: string;
  requestedBy: string;
  createdAt: string;
  cashFlowDate: string;
  status: "queued" | "preparing" | "sending" | "complete" | "partial" | "failed";
  recipients: Array<{ name: string; status: PartnerDeliveryState; error?: string }>;
  error?: string;
}
export interface PartnerInvoiceRow {
  name: string;
  reference: string;
  status: string;
  amount: number;
  currency: string;
  dueDate?: string;
  notes?: string;
}
export interface PartnerReportData {
  capturedAt: string;
  cashFlow: CashFlowSnapshot;
  history: CashFlowSnapshot[];
  rates: FxRate[];
  invoices: PartnerInvoiceRow[];
}

export function canSharePartnerUpdates(username: string | undefined): boolean {
  return ["ali", "ali m"].includes(username?.trim().toLowerCase().replace(/\s+/g, " ") ?? "");
}

export type PartnerUpdateSource = Pick<DashboardSnapshot, "invoices" | "paymentAllocations" | "providers" | "receivables" | "asOf" | "cashFlowSnapshots" | "fxRates">;

export function partnerInvoiceRows(dashboard: PartnerUpdateSource): PartnerInvoiceRow[] {
  return [
    ...pendingInvoices(dashboard.invoices, dashboard.paymentAllocations).map(({ invoice, outstanding }) => ({
      name: dashboard.providers.find(provider => provider.id === invoice.providerId)?.name ?? invoice.customerName,
      reference: invoice.invoiceNumber,
      status: invoice.status === "draft" ? "Draft" : "Open",
      amount: outstanding,
      currency: invoice.currency,
      dueDate: invoice.dueDate,
      notes: invoice.description
    })),
    ...dashboard.receivables.filter(item => item.source === "manual").map(item => ({
      name: item.name, reference: "Manual receivable", status: "Receivable", amount: item.balance,
      currency: item.currency, dueDate: item.dueDate, notes: item.notes
    }))
  ].sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || a.name.localeCompare(b.name));
}

export function buildPartnerReportData(dashboard: PartnerUpdateSource): PartnerReportData {
  const cashFlow = [...dashboard.cashFlowSnapshots].sort((a, b) =>
    b.asOfDate.localeCompare(a.asOfDate) || b.updatedAt.localeCompare(a.updatedAt)
  )[0];
  if (!cashFlow) throw new Error("Save a cash-flow snapshot before sharing with partners.");
  return { capturedAt: dashboard.asOf, cashFlow, history: dashboard.cashFlowSnapshots, rates: dashboard.fxRates, invoices: partnerInvoiceRows(dashboard) };
}

export function partnerUpdateSummary(status: PartnerUpdateStatus): string {
  const heading = status.status === "complete" ? "Cash flow and open invoices sent"
    : status.status === "partial" ? "Partner update partially delivered"
    : status.status === "failed" ? "Partner update failed" : "Preparing partner update";
  const names = status.recipients.map(recipient => `${recipient.name}: ${recipient.status === "sent" ? "both images sent" : recipient.status === "unconfirmed" ? "delivery unconfirmed — check Telegram" : recipient.status}${recipient.error ? ` (${recipient.error})` : ""}`);
  return [heading, `Cash flow: ${status.cashFlowDate}`, ...names, status.error].filter(Boolean).join("\n");
}
