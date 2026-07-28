import assert from "node:assert/strict";
import test from "node:test";
import { copyInvoiceToDraft } from "./invoiceCopies";
import type { Invoice } from "./types";

test("copying an invoice creates a clean local draft and keeps editable invoice details", () => {
  const source: Invoice = {
    id: "merit-existing",
    providerId: "provider-1",
    documentType: "sales_invoice",
    origin: "revenue",
    customerName: "Example Client",
    amount: 1250,
    currency: "USD",
    status: "paid",
    meritStatus: "paid",
    meritDeliveryStatus: "delivered",
    meritDeliveryError: "old delivery error",
    sendError: "old send error",
    meritCreationReservedAt: "2026-07-01T00:00:00.000Z",
    invoiceNumber: "2026/1304",
    issueDate: "2026-07-01",
    dueDate: "2026-07-31",
    source: "merit",
    externalId: "sih-123",
    description: "Consulting services",
    transactionId: "transaction-1",
    billingRuleId: "rule-1",
    revenueRunIds: ["run-1"],
    periodStart: "2026-06-01",
    periodEnd: "2026-06-30",
    taxId: "tax-zero",
    sentAt: "2026-07-01T12:00:00.000Z",
    paidAt: "2026-07-20T00:00:00.000Z",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z"
  };

  assert.deepEqual(
    copyInvoiceToDraft(source, "2026/1305", "local-sales_invoice-copy", "2026-07-28T12:00:00.000Z"),
    {
      id: "local-sales_invoice-copy",
      providerId: "provider-1",
      documentType: "sales_invoice",
      origin: "manual",
      customerName: "Example Client",
      amount: 1250,
      currency: "USD",
      status: "draft",
      meritDeliveryStatus: "not-sent",
      invoiceNumber: "2026/1305",
      issueDate: "2026-07-01",
      dueDate: "2026-07-31",
      source: "manual",
      description: "Consulting services",
      revenueRunIds: [],
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30",
      taxId: "tax-zero",
      createdAt: "2026-07-28T12:00:00.000Z",
      updatedAt: "2026-07-28T12:00:00.000Z"
    }
  );
});
