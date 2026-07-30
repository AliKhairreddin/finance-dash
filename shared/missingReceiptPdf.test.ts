import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { generateMissingReceiptDeclarationPdf } from "./missingReceiptPdf";
import type { ExpenseRecord, Transaction } from "./types";

const transaction: Transaction = {
  id: "wise-expense-100",
  source: "wise",
  accountName: "Wise EUR operating",
  date: "2026-07-29",
  description: "Creative services",
  rawName: "NORTH STAR STUDIO",
  counterparty: "North Star Studio",
  amount: 620,
  currency: "EUR",
  direction: "out",
  status: "posted",
  category: "Creative production"
};

const expense: ExpenseRecord = {
  id: "expense-test",
  recordNumber: "EXP-2026-000123",
  recordType: "paid_expense",
  paymentStatus: "paid",
  transactionId: transaction.id,
  supplierName: "North Star Studio",
  supplierRegistrationNumber: "12345678",
  issueDate: "2026-07-29",
  transactionDate: "2026-07-29",
  paidAt: "2026-07-29",
  category: "Creative production",
  businessPurpose: "Campaign creative assets for the July launch",
  description: "Design and production services",
  netAmount: 620,
  vatAmount: 0,
  grossAmount: 620,
  vatTreatment: "not_applicable",
  currency: "EUR",
  missingDocumentReason: "Supplier did not provide an invoice after two written requests.",
  declarationConfirmedAt: "2026-07-30T12:00:00.000Z",
  documents: [],
  createdAt: "2026-07-30T12:00:00.000Z",
  updatedAt: "2026-07-30T12:00:00.000Z"
};

test("missing source document generator produces a titled, readable PDF", async () => {
  const bytes = await generateMissingReceiptDeclarationPdf(expense, transaction);
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 1);
  assert.equal(pdf.getTitle(), "EXP-2026-000123 - Missing source document declaration");
});
