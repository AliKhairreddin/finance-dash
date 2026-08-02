import assert from "node:assert/strict";
import test from "node:test";
import {
  expenseForTransaction,
  expensePayables,
  matchingUnpaidSupplierBills,
  nextExpenseRecordNumber,
  validateExpenseAmounts
} from "./expenses";
import type { ExpenseRecord, Transaction } from "./types";

const expense: ExpenseRecord = {
  id: "expense-1",
  recordNumber: "EXP-2026-000001",
  recordType: "supplier_bill",
  paymentStatus: "unpaid",
  supplierName: "Example OU",
  sourceDocumentNumber: "INV-100",
  issueDate: "2026-07-01",
  dueDate: "2026-07-31",
  category: "Software",
  businessPurpose: "Finance operations software",
  description: "Monthly subscription",
  netAmount: 100,
  vatAmount: 24,
  grossAmount: 124,
  vatRate: 24,
  vatTreatment: "standard",
  currency: "EUR",
  documents: [],
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z"
};

const transaction: Transaction = {
  id: "bank-1",
  source: "wise",
  accountName: "Wise EUR",
  date: "2026-07-20",
  description: "Example OU INV-100",
  rawName: "EXAMPLE OU",
  counterparty: "Example OU",
  amount: 124,
  currency: "EUR",
  direction: "out",
  status: "posted",
  category: "Software"
};

test("expense record numbers are sequential within the issue year", () => {
  assert.equal(nextExpenseRecordNumber([expense], "2026-07-30"), "EXP-2026-000002");
  assert.equal(nextExpenseRecordNumber([expense], "2027-01-02"), "EXP-2027-000001");
});

test("expense amount validation requires net plus VAT to equal gross", () => {
  assert.doesNotThrow(() => validateExpenseAmounts({
    netAmount: 100,
    vatAmount: 24,
    grossAmount: 124,
    vatRate: 24,
    vatTreatment: "standard"
  }));
  assert.throws(
    () => validateExpenseAmounts({
      netAmount: 100,
      vatAmount: 20,
      grossAmount: 124,
      vatRate: 24,
      vatTreatment: "standard"
    }),
    /must equal/
  );
  assert.throws(
    () => validateExpenseAmounts({
      netAmount: 100,
      vatAmount: 24,
      grossAmount: 124,
      vatRate: 24,
      vatTreatment: "reverse_charge"
    }),
    /cannot include/
  );
});

test("unpaid supplier bills become payables and match exact outgoing payments", () => {
  assert.deepEqual(expensePayables([expense]), [{
    id: "expense-1",
    supplier: "Example OU",
    balance: 124,
    currency: "EUR",
    category: "Software",
    monthBuckets: { "2026-07": 124 },
    aliases: []
  }]);
  assert.deepEqual(matchingUnpaidSupplierBills([expense], transaction).map((item) => item.id), ["expense-1"]);
  assert.equal(expenseForTransaction([{ ...expense, transactionId: transaction.id }], transaction.id)?.id, expense.id);
});
