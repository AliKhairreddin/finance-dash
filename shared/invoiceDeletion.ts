import type { Invoice, PaymentAllocation } from "./types";

export function dashboardInvoiceDeletionBlockReason(
  invoice: Invoice,
  paymentAllocations: PaymentAllocation[]
): string | undefined {
  if (invoice.status !== "draft" || invoice.externalId || invoice.origin !== "manual") {
    return "Only local manual drafts that have never been saved in Merit can be deleted from the dashboard";
  }
  if (invoice.meritDeliveryStatus !== "not-sent") {
    return "This draft already has Merit delivery state and cannot be deleted only from the dashboard";
  }
  if (invoice.meritCreationReservedAt) {
    return "This draft currently has a Merit creation request in progress";
  }
  if (invoice.billingRuleId || invoice.revenueRunIds.length > 0) {
    return "Revenue-generated drafts must be managed from their revenue run";
  }
  if (invoice.transactionId) {
    return "Drafts linked to a transaction must be unlinked before deletion";
  }
  if (paymentAllocations.some((allocation) => allocation.invoiceId === invoice.id)) {
    return "Drafts with recorded payment allocations cannot be deleted";
  }
  return undefined;
}
