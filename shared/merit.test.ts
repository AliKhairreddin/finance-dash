import assert from "node:assert/strict";
import test from "node:test";
import {
  linkMeritInvoiceProviders,
  meritInvoicePeriods,
  meritProviderId,
  meritProvidersFromResponse,
  reconcileMeritInvoices,
  reconcileMeritProviders
} from "./merit";
import type { Invoice, Provider } from "./types";

function invoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "invoice-1",
    documentType: "sales_invoice",
    origin: "merit",
    customerName: "Client",
    amount: 100,
    currency: "EUR",
    status: "open",
    meritStatus: "open",
    meritDeliveryStatus: "saved",
    invoiceNumber: "M-1",
    issueDate: "2026-07-01",
    dueDate: "2026-07-31",
    source: "merit",
    externalId: "external-1",
    description: "Merit invoice M-1",
    revenueRunIds: [],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides
  };
}

test("Merit customer responses retain invoice-relevant identity, contact, billing, and metadata", () => {
  const [provider] = meritProvidersFromResponse(
    {
      CustomerId: "customer-1",
      Name: "Client OÜ",
      RegNo: "12345678",
      VatRegNo: "EE123456789",
      Contact: "Jane Doe",
      PhoneNo: "+372 5555 5555",
      PhoneNo2: "+372 5555 5556",
      Address: "Main Street 1",
      City: "Tallinn",
      County: "Harju",
      PostalCode: "10111",
      CountryName: "Estonia",
      CountryCode: "EE",
      Email: "billing@example.com",
      CurrencyCode: "eur",
      PaymentDeadLine: 14,
      CustomerGroupId: "group-1",
      CustomerGroupName: "Export",
      BankName: "Example Bank",
      BankAccount: "EE001234",
      SalesInvLang: "EN",
      RefNoBase: "1001",
      NotTDCustomer: false,
      ChangedDate: "20260720",
      Comments: [{ CommDate: "20260701", Comment: "Use billing email" }],
      Dimensions: [{ Id: "dimension-row", DimId: 12, DimValueId: "value-1", DimCode: "TEAM" }]
    },
    "customer",
    "2026-07-22T00:00:00.000Z"
  );

  assert.equal(provider.id, meritProviderId("customer", "customer-1"));
  assert.equal(provider.meritCustomerId, "customer-1");
  assert.equal(provider.type, "client");
  assert.equal(provider.address, "Main Street 1, Tallinn, Harju, 10111, Estonia");
  assert.equal(provider.defaultCurrency, "EUR");
  assert.equal(provider.paymentTermsDays, 14);
  assert.equal(provider.meritDetails?.registrationNumber, "12345678");
  assert.equal(provider.meritDetails?.bankAccount, "EE001234");
  assert.deepEqual(provider.meritDetails?.comments, [{ date: "20260701", text: "Use billing email" }]);
  assert.deepEqual(provider.meritDetails?.dimensions, [{
    id: "dimension-row",
    dimensionId: "12",
    dimensionValueId: "value-1",
    code: "TEAM"
  }]);
});

test("Merit provider reconciliation enriches manual matches and treats them as authoritative Merit records", () => {
  const manual = {
    id: "manual-client",
    name: "Client OÜ",
    type: "client",
    tags: ["Revenue"],
    aliases: ["CLIENT OU"],
    source: "manual",
    createdAt: "2026-01-01T00:00:00.000Z"
  } satisfies Provider;
  const [remote] = meritProvidersFromResponse({ CustomerId: "customer-1", Name: "Client OÜ", CurrencyCode: "EUR" }, "customer");

  const enriched = reconcileMeritProviders([manual], [remote], "customer");
  assert.equal(enriched.length, 1);
  assert.equal(enriched[0].id, manual.id);
  assert.equal(enriched[0].source, "merit");
  assert.equal(enriched[0].meritCustomerId, "customer-1");
  assert.deepEqual(enriched[0].tags.sort(), ["Merit", "Revenue"]);

  const afterRemoteDeletion = reconcileMeritProviders(enriched, [], "customer");
  assert.deepEqual(afterRemoteDeletion, []);

  const remoteOnly = reconcileMeritProviders([], [remote], "customer");
  assert.deepEqual(reconcileMeritProviders(remoteOnly, [], "customer"), []);
});

test("authoritative Merit invoice reconciliation drops remote deletions but preserves local drafts", () => {
  const deletedRemote = invoice({ id: "deleted", externalId: "deleted" });
  const localDraft = invoice({
    id: "draft",
    source: "manual",
    origin: "manual",
    externalId: undefined,
    status: "draft",
    meritStatus: undefined,
    meritDeliveryStatus: "not-sent"
  });

  assert.deepEqual(reconcileMeritInvoices([], [deletedRemote, localDraft], true), [localDraft]);
  assert.deepEqual(reconcileMeritInvoices([], [deletedRemote, localDraft], false), [deletedRemote, localDraft]);
});

test("live Merit invoices retain local workflow metadata and link to the reconciled company", () => {
  const live = invoice({
    id: "merit-external-1",
    providerId: meritProviderId("customer", "customer-1"),
    meritStatus: "paid",
    meritDeliveryStatus: "saved"
  });
  const persisted = invoice({
    id: "local-draft-id",
    providerId: "manual-client",
    meritDeliveryStatus: "delivery-failed",
    meritDeliveryError: "Previous delivery error"
  });
  const provider = {
    id: "manual-client",
    name: "Client",
    type: "client",
    tags: [],
    aliases: [],
    meritCustomerId: "customer-1",
    source: "manual",
    createdAt: "2026-01-01T00:00:00.000Z"
  } satisfies Provider;

  assert.equal(linkMeritInvoiceProviders([live], [provider])[0].providerId, provider.id);
  assert.deepEqual(reconcileMeritInvoices([live], [persisted], true), [{ ...persisted, meritStatus: "paid" }]);
});

test("Merit invoice periods cover the oldest stored remote invoice in contiguous three-month-safe windows", () => {
  const periods = meritInvoicePeriods([invoice({ issueDate: "2026-01-01" })], "2026-07-22");
  assert.deepEqual(periods, [
    { periodStart: "2026-01-01", periodEnd: "2026-03-31" },
    { periodStart: "2026-04-01", periodEnd: "2026-06-29" },
    { periodStart: "2026-06-30", periodEnd: "2026-07-22" }
  ]);
});
