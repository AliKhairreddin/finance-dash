import assert from "node:assert/strict";
import test from "node:test";
import { assignMeritStyleDraftNumbers, nextMeritInvoiceNumber } from "./invoiceNumbers";
import type { Invoice } from "./types";

function invoice(overrides: Partial<Invoice>): Invoice {
  return {
    id: "invoice",
    documentType: "sales_invoice",
    origin: "merit",
    customerName: "Client",
    amount: 100,
    currency: "USD",
    status: "open",
    meritStatus: "open",
    meritDeliveryStatus: "saved",
    invoiceNumber: "2026/1303",
    issueDate: "2026-07-20",
    dueDate: "2026-07-27",
    source: "merit",
    externalId: "merit-invoice",
    description: "Services",
    revenueRunIds: [],
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
    ...overrides
  };
}

test("next Merit invoice number follows the imported year/sequence series", () => {
  assert.equal(nextMeritInvoiceNumber([
    invoice({ id: "one", invoiceNumber: "2026/1299" }),
    invoice({ id: "two", invoiceNumber: "2026/1303" }),
    invoice({ id: "other", invoiceNumber: "2025/0999", issueDate: "2025-12-31" })
  ], "2026-07-22"), "2026/1304");
});

test("local drafts receive stable unique numbers after the current Merit sequence", () => {
  const remote = invoice({ id: "remote", invoiceNumber: "2026/1303" });
  const olderDraft = invoice({
    id: "older-draft",
    origin: "manual",
    source: "manual",
    externalId: undefined,
    status: "draft",
    meritStatus: undefined,
    meritDeliveryStatus: "not-sent",
    invoiceNumber: "FD-OLD",
    createdAt: "2026-07-21T00:00:00.000Z"
  });
  const newerDraft = invoice({
    id: "newer-draft",
    origin: "revenue",
    source: "tune",
    externalId: undefined,
    status: "draft",
    meritStatus: undefined,
    meritDeliveryStatus: "not-sent",
    invoiceNumber: "FD-NEW",
    createdAt: "2026-07-22T00:00:00.000Z"
  });

  const numbered = assignMeritStyleDraftNumbers([newerDraft, remote, olderDraft]);
  assert.equal(numbered.find((item) => item.id === olderDraft.id)?.invoiceNumber, "2026/1304");
  assert.equal(numbered.find((item) => item.id === newerDraft.id)?.invoiceNumber, "2026/1305");
  assert.deepEqual(assignMeritStyleDraftNumbers(numbered), numbered);
});

test("a live Merit collision moves the local draft to the next number", () => {
  const localDraft = invoice({
    id: "local-draft",
    origin: "manual",
    source: "manual",
    externalId: undefined,
    status: "draft",
    meritStatus: undefined,
    meritDeliveryStatus: "not-sent",
    invoiceNumber: "2026/1304"
  });
  const numbered = assignMeritStyleDraftNumbers(
    [invoice({ id: "remote-1303", invoiceNumber: "2026/1303" }), localDraft],
    [invoice({ id: "remote-1304", invoiceNumber: "2026/1304", externalId: "merit-1304" })]
  );

  assert.equal(numbered.find((item) => item.id === localDraft.id)?.invoiceNumber, "2026/1305");
});

test("numbering fails closed when Merit has not established the current-year series", () => {
  assert.throws(() => nextMeritInvoiceNumber([], "2026-07-22"), /Sync Merit/);
});
