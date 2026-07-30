import type { CreateExpensePayload, ExpenseRecord, Payable, Transaction } from "./types";

function rounded(value: number): number {
  return Number(value.toFixed(2));
}

export function nextExpenseRecordNumber(existing: ExpenseRecord[], issueDate: string): string {
  const year = issueDate.slice(0, 4);
  const prefix = `EXP-${year}-`;
  const nextSequence = existing.reduce((largest, expense) => {
    if (!expense.recordNumber.startsWith(prefix)) return largest;
    const sequence = Number(expense.recordNumber.slice(prefix.length));
    return Number.isInteger(sequence) ? Math.max(largest, sequence) : largest;
  }, 0) + 1;
  return `${prefix}${String(nextSequence).padStart(6, "0")}`;
}

export function validateExpenseAmounts(
  payload: Pick<CreateExpensePayload, "grossAmount" | "netAmount" | "vatAmount" | "vatRate" | "vatTreatment">
): void {
  for (const [label, value] of [
    ["Gross amount", payload.grossAmount],
    ["Net amount", payload.netAmount],
    ["VAT amount", payload.vatAmount]
  ] as const) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${label} must be zero or greater`);
  }
  if (payload.grossAmount <= 0) throw new Error("Gross amount must be greater than zero");
  if (rounded(payload.netAmount + payload.vatAmount) !== rounded(payload.grossAmount)) {
    throw new Error("Net amount plus VAT amount must equal the gross amount");
  }
  if (payload.vatRate !== undefined && (!Number.isFinite(payload.vatRate) || payload.vatRate < 0 || payload.vatRate > 100)) {
    throw new Error("VAT rate must be between 0 and 100");
  }
  if (payload.vatTreatment === "standard" || payload.vatTreatment === "reduced") {
    if (payload.vatRate === undefined || payload.vatRate <= 0 || payload.vatAmount <= 0) {
      throw new Error("Taxable expenses require a positive VAT rate and VAT amount");
    }
  } else if (payload.vatAmount !== 0) {
    throw new Error("This VAT treatment cannot include a supplier-charged VAT amount");
  }
  if (payload.vatTreatment === "zero" && payload.vatRate !== 0) {
    throw new Error("Zero-rated expenses must use a 0% VAT rate");
  }
}

export function expensePayables(expenses: ExpenseRecord[]): Payable[] {
  return expenses
    .filter((expense) => expense.recordType === "supplier_bill" && expense.paymentStatus === "unpaid")
    .sort((left, right) => left.dueDate?.localeCompare(right.dueDate ?? "") || left.recordNumber.localeCompare(right.recordNumber))
    .map((expense) => {
      const month = (expense.dueDate ?? expense.issueDate).slice(0, 7);
      return {
        id: expense.id,
        supplier: expense.supplierName,
        balance: expense.grossAmount,
        currency: expense.currency,
        category: expense.category,
        monthBuckets: { [month]: expense.grossAmount },
        aliases: []
      };
    });
}

export function matchingUnpaidSupplierBills(expenses: ExpenseRecord[], transaction: Transaction): ExpenseRecord[] {
  if (transaction.direction !== "out") return [];
  return expenses
    .filter((expense) =>
      expense.recordType === "supplier_bill"
      && expense.paymentStatus === "unpaid"
      && expense.currency === transaction.currency
      && rounded(expense.grossAmount) === rounded(transaction.amount)
    )
    .sort((left, right) => left.dueDate?.localeCompare(right.dueDate ?? "") || left.recordNumber.localeCompare(right.recordNumber));
}

export function expenseForTransaction(expenses: ExpenseRecord[], transactionId: string): ExpenseRecord | undefined {
  return expenses.find((expense) => expense.transactionId === transactionId);
}
