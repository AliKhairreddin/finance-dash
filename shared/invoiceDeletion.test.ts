import assert from "node:assert/strict";
import test from "node:test";
import {
  dashboardInvoiceDeletionBatchBlockReason,
  dashboardInvoiceDeletionBlockReason
} from "./invoiceDeletion";
import type { Invoice, PaymentAllocation } from "./types";

function localDraft(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "local-draft",
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
    createdAt: "2026-07-28T12:00:00.000Z",
    updatedAt: "2026-07-28T12:00:00.000Z",
    ...overrides
  };
}

function blockReason(invoice: Invoice, allocations: PaymentAllocation[] = []): string {
  const reason = dashboardInvoiceDeletionBlockReason(invoice, allocations);
  assert.ok(reason);
  return reason;
}

function batchBlockReason(invoices: Invoice[], allocations: PaymentAllocation[] = []): string {
  const reason = dashboardInvoiceDeletionBatchBlockReason(invoices, allocations);
  assert.ok(reason);
  return reason;
}

test("local unsent manual drafts can be deleted from the dashboard", () => {
  assert.equal(dashboardInvoiceDeletionBlockReason(localDraft(), []), undefined);
});

test("Merit invoices and workflow-linked drafts cannot be deleted only from the dashboard", () => {
  assert.match(
    blockReason(localDraft({
      origin: "merit",
      status: "open",
      externalId: "merit-invoice"
    })),
    /Only local manual drafts/
  );
  assert.match(
    blockReason(localDraft({ revenueRunIds: ["run-1"] })),
    /revenue run/
  );
  assert.match(
    blockReason(localDraft({ transactionId: "transaction-1" })),
    /transaction/
  );
  assert.match(
    blockReason(localDraft({ meritCreationReservedAt: "2026-07-28T12:00:00.000Z" })),
    /in progress/
  );
});

test("drafts with payment allocations cannot be deleted", () => {
  const allocations: PaymentAllocation[] = [{
    id: "allocation-1",
    invoiceId: "local-draft",
    amount: 100,
    currency: "USD",
    paidAt: "2026-07-28",
    source: "wise",
    mode: "manual",
    createdAt: "2026-07-28T12:00:00.000Z"
  }];
  assert.match(blockReason(localDraft(), allocations), /payment allocations/);
});

test("bulk deletion accepts only a non-empty batch of eligible dashboard drafts", () => {
  assert.equal(
    dashboardInvoiceDeletionBatchBlockReason(
      [localDraft(), localDraft({ id: "second-draft", invoiceNumber: "2026/1306" })],
      []
    ),
    undefined
  );
  assert.match(batchBlockReason([]), /at least one/);
  assert.match(
    batchBlockReason(
      [
        localDraft(),
        localDraft({
          id: "merit-invoice",
          invoiceNumber: "2026/1307",
          origin: "merit",
          status: "open",
          externalId: "merit-invoice"
        })
      ],
      []
    ),
    /2026\/1307: Only local manual drafts/
  );
});
