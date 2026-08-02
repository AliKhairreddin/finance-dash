import assert from "node:assert/strict";
import test from "node:test";
import { expenseAnalyticsLabel, groupExpenseAnalytics } from "./expenseAnalytics";
import type { Transaction } from "./types";

function expense(
  id: string,
  counterparty: string,
  amount: number,
  category = "Software",
  matchedProviderId?: string
): Transaction {
  return {
    id,
    source: "wise",
    accountName: "Wise USD",
    date: "2026-07-29",
    description: counterparty,
    rawName: counterparty,
    counterparty,
    amount,
    currency: "USD",
    direction: "out",
    status: "posted",
    category,
    ...(matchedProviderId ? { matchedProviderId } : {})
  };
}

test("expense analytics uses the official company name when one is assigned", () => {
  const transaction = expense("cursor-1", "CURSOR AI 1234", 90, "Software", "provider-cursor");

  assert.equal(expenseAnalyticsLabel(transaction, "Cursor"), "Cursor");
  assert.deepEqual(groupExpenseAnalytics([transaction], new Map([["provider-cursor", "Cursor"]])), [
    {
      currency: "USD",
      total: 90,
      categories: [
        {
          category: "Software",
          amount: 90,
          transactionCount: 1,
          attributions: [{ label: "Cursor", amount: 90, transactionCount: 1 }]
        }
      ]
    }
  ]);
});

test("expense analytics groups repeated unassigned transaction titles once and sums their spend", () => {
  const transactions = [
    expense("openai-1", "OPENAI *CHATGPT", 4),
    expense("openai-2", "openai *chatgpt", 6),
    expense("cursor-1", "CURSOR AI 1234", 90, "Software", "provider-cursor"),
    {
      ...expense("income-1", "Revenue customer", 1_000),
      direction: "in" as const
    },
    expense("card-payment", "Daily Credit Card Payment", 34_740.24, "Internal transfer"),
    expense("owner-transfer", "Owner transfer", 20_000, "Capital movement")
  ];

  assert.deepEqual(groupExpenseAnalytics(transactions, new Map([["provider-cursor", "Cursor"]])), [
    {
      currency: "USD",
      total: 100,
      categories: [
        {
          category: "Software",
          amount: 100,
          transactionCount: 3,
          attributions: [
            { label: "Cursor", amount: 90, transactionCount: 1 },
            { label: "OPENAI *CHATGPT", amount: 10, transactionCount: 2 }
          ]
        }
      ]
    }
  ]);
});

test("expense analytics groups noisy bank descriptors by the AI merchant name without a company match", () => {
  const transactions = [
    { ...expense("pizza-1", "POS 10983 PIZZA HUT #442 TORONTO", 25), merchantName: "Pizza Hut", merchantKey: "pizzahut" },
    { ...expense("pizza-2", "CARD 8841 PIZZAHUT 000442 CA", 35), merchantName: "PizzaHut", merchantKey: "pizzahut" }
  ];

  assert.deepEqual(groupExpenseAnalytics(transactions, new Map()), [
    {
      currency: "USD",
      total: 60,
      categories: [
        {
          category: "Software",
          amount: 60,
          transactionCount: 2,
          attributions: [{ label: "Pizza Hut", amount: 60, transactionCount: 2 }]
        }
      ]
    }
  ]);
});
