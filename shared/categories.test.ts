import assert from "node:assert/strict";
import test from "node:test";
import {
  isReviewOnlyTransactionCategory,
  sanitizeStoredTransactionCategories,
  sanitizeStoredTransactionCategoryRules,
  transactionBusinessCategory
} from "./categories";
import type { Transaction, TransactionCategoryRule } from "./types";

test("merchant category codes are treated as uncategorized review values", () => {
  assert.equal(isReviewOnlyTransactionCategory("5734"), true);
  assert.equal(transactionBusinessCategory("5734"), "Uncategorized");
  assert.equal(transactionBusinessCategory("5734 Software"), "5734 Software");
});

test("stored merchant category codes are removed from transactions and category memory", () => {
  const transaction: Transaction = {
    id: "slash-transaction-1",
    source: "slash",
    accountName: "Operating",
    date: "2026-07-29",
    description: "CARD PURCHASE",
    rawName: "Example Merchant",
    counterparty: "Example Merchant",
    amount: 20,
    currency: "USD",
    direction: "out",
    status: "posted",
    category: "5734"
  };
  const invalidRule: TransactionCategoryRule = {
    id: "category-rule-out-5734",
    category: "5734",
    direction: "out",
    aliases: ["Example Merchant"],
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z"
  };
  const validRule: TransactionCategoryRule = {
    ...invalidRule,
    id: "category-rule-out-software-subscription",
    category: "Software subscription"
  };

  assert.deepEqual(sanitizeStoredTransactionCategories([transaction]), [
    { ...transaction, category: "Uncategorized" }
  ]);
  assert.deepEqual(sanitizeStoredTransactionCategoryRules([invalidRule, validRule]), [validRule]);
});
