import type { Invoice, PaymentAllocation, RevenueRun, RevenueAccrual } from "./types";

export function dashboardInvoiceDeletionBlockReason(
  invoice: Invoice,
  paymentAllocations: PaymentAllocation[]
): string | undefined {
  if (invoice.status !== "draft" || invoice.externalId || invoice.origin === "merit") {
    return "Only local drafts that have never been saved in Merit can be deleted from the dashboard";
  }
  if (invoice.meritDeliveryStatus !== "not-sent") {
    return "This draft already has Merit delivery state and cannot be deleted only from the dashboard";
  }
  if (invoice.meritCreationReservedAt) {
    return "This draft currently has a Merit creation request in progress";
  }
  if (invoice.sendError) return "Review the previous Merit creation attempt before deleting this draft";
  if (invoice.meritReplacementId) return "This invoice has a Merit replacement in progress";
  if (paymentAllocations.some((allocation) => allocation.invoiceId === invoice.id)) {
    return "Drafts with recorded payment allocations cannot be deleted";
  }
  return undefined;
}

/** Retain earned revenue and allow explicit re-drafting without automatic recreation. */
export function unlinkDeletedInvoiceDrafts(invoices: Invoice[], runs: RevenueRun[], accruals: RevenueAccrual[], at: string) {
  const ids = new Set(invoices.map(invoice => invoice.id));
  const runIds = new Set(invoices.flatMap(invoice => invoice.revenueRunIds));
  return {
    revenueRuns: runs.map(run => {
      if (!runIds.has(run.id) && !(run.invoiceId && ids.has(run.invoiceId))) return run;
      const { invoiceId: _invoiceId, externalInvoiceId: _externalId, error: _error, ...rest } = run;
      return { ...rest, status: "pulled" as const, draftDeletedAt: at };
    }),
    revenueAccruals: accruals.map(accrual => {
      if (!accrual.invoiceId || !ids.has(accrual.invoiceId)) return accrual;
      const { invoiceId: _invoiceId, ...rest } = accrual;
      return { ...rest, status: "accruing" as const, updatedAt: at };
    })
  };
}

export function dashboardInvoiceDeletionBatchBlockReason(
  invoices: Invoice[],
  paymentAllocations: PaymentAllocation[]
): string | undefined {
  if (invoices.length === 0) {
    return "Select at least one dashboard draft to delete";
  }
  for (const invoice of invoices) {
    const reason = dashboardInvoiceDeletionBlockReason(invoice, paymentAllocations);
    if (reason) return `${invoice.invoiceNumber}: ${reason}`;
  }
  return undefined;
}
