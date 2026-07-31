import type { Transaction } from "./types";
import { transactionBusinessCategory } from "./categories";

export function isInternalTransferTransaction(transaction: Transaction): boolean {
  return transactionBusinessCategory(transaction.category) === "Internal transfer";
}

export function isSlashDailyCardPayment(transaction: Transaction): boolean {
  return transaction.source === "slash"
    && /daily credit card payment|payment from platinum account/i.test(
      `${transaction.counterparty} ${transaction.description}`
    );
}

export function transactionCounterpartyLabel(transaction: Transaction): string {
  return isSlashDailyCardPayment(transaction)
    ? "Slash card payment"
    : transaction.merchantName ?? transaction.counterparty;
}

export function transactionMovementLabel(transaction: Transaction): string {
  if (transaction.source !== "slash") return transaction.direction === "in" ? "In" : "Out";

  if (isSlashDailyCardPayment(transaction)) {
    if (transaction.slashAccountSubtype === "credit") {
      return transaction.direction === "in" ? "Card paid" : "Payment reversed";
    }
    return transaction.direction === "out" ? "Cash sent" : "Cash returned";
  }

  if (transaction.slashAccountSubtype === "credit") {
    return transaction.direction === "out" ? "Card spend" : "Card credit";
  }
  return transaction.direction === "in" ? "Cash in" : "Cash out";
}
