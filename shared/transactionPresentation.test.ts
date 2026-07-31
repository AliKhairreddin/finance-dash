import assert from "node:assert/strict";
import test from "node:test";
import type { Transaction } from "./types";
import {
  isInternalTransferTransaction,
  transactionCounterpartyLabel,
  transactionMovementLabel
} from "./transactionPresentation";

function slashTransaction(
  id: string,
  direction: Transaction["direction"],
  slashAccountSubtype: NonNullable<Transaction["slashAccountSubtype"]>,
  description: string,
  category = "Internal transfer"
): Transaction {
  return {
    id,
    source: "slash",
    slashAccountSubtype,
    accountName: `Business Platinum ${slashAccountSubtype === "cash" ? "Cash" : "Credit"}`,
    date: "2026-07-30",
    description,
    rawName: description,
    counterparty: description,
    amount: 34_740.24,
    currency: "USD",
    direction,
    status: "posted",
    category,
    merchantName: "Amex"
  };
}

test("Slash daily card payments name both internal sides plainly", () => {
  const cashSide = slashTransaction("cash-side", "out", "cash", "Daily Credit Card Payment - 1234");
  const cardSide = slashTransaction("card-side", "in", "credit", "Daily Credit Card Payment - 1234");

  assert.equal(transactionMovementLabel(cashSide), "Cash sent");
  assert.equal(transactionMovementLabel(cardSide), "Card paid");
  assert.equal(transactionCounterpartyLabel(cardSide), "Slash card payment");
  assert.equal(isInternalTransferTransaction(cardSide), true);
});

test("Slash card purchases remain spend instead of internal payments", () => {
  const purchase = slashTransaction("purchase", "out", "credit", "CARD PURCHASE", "Software subscription");

  assert.equal(transactionMovementLabel(purchase), "Card spend");
  assert.equal(transactionCounterpartyLabel(purchase), "Amex");
  assert.equal(isInternalTransferTransaction(purchase), false);
});
