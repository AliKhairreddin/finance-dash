import assert from "node:assert/strict";
import test from "node:test";
import type { Transaction } from "../shared/types";
import {
  aiProviderDirectoryForTransactions,
  canonicalProviders,
  mergeProviderDirectory,
  mergeTeamDirectory,
  mergeWiseCardHolderTeamAssignments,
  transactionAiGroupKey,
  transactionMerchantKey,
  transactionsShareMerchant
} from "./matching";

test("mergeProviderDirectory does not restore deleted default companies", () => {
  assert.deepEqual(mergeProviderDirectory([]), []);
});

test("mergeProviderDirectory keeps and normalizes companies that are actually stored", () => {
  const storedProvider = canonicalProviders[0];
  assert.deepEqual(mergeProviderDirectory([storedProvider]), [storedProvider]);
});

test("card-holder metadata does not create a responsibility assignment", () => {
  assert.deepEqual(mergeWiseCardHolderTeamAssignments([]), []);
});

test("ACP remains an offer category and is not exposed as an owner", () => {
  const owners = mergeTeamDirectory([
    { id: "team-acp", name: "ACP", createdAt: "2026-07-01T00:00:00.000Z" }
  ]);

  assert.ok(!owners.some((owner) => owner.id === "team-acp" || owner.name === "ACP"));
});

test("merchant equivalence uses the AI-normalized name and transaction direction", () => {
  const transaction = {
    id: "pizza-1",
    source: "wise",
    accountName: "USD",
    date: "2026-07-30",
    description: "POS 10983 PIZZA HUT #442 TORONTO",
    rawName: "POS 10983 PIZZA HUT #442 TORONTO",
    counterparty: "PIZZA HUT #442",
    merchantName: "Pizza Hut",
    amount: 25,
    currency: "USD",
    direction: "out",
    status: "posted",
    category: "Food and meals"
  } satisfies Transaction;
  const equivalent: Transaction = {
    ...transaction,
    id: "pizza-2",
    merchantName: "  PIZZA   HUT "
  };
  const refund: Transaction = {
    ...transaction,
    id: "pizza-refund",
    direction: "in"
  };

  assert.equal(transactionMerchantKey(transaction), "pizzahut");
  assert.equal(transactionsShareMerchant(transaction, equivalent), true);
  assert.equal(transactionsShareMerchant(transaction, refund), false);
});

test("AI groups repeated merchant descriptors while keeping generic transfers distinct", () => {
  const pizzaBase: Transaction = {
    id: "pizza-1",
    source: "slash",
    accountName: "Slash USD",
    date: "2026-07-30",
    description: "POS 10983 PIZZA HUT #442 TORONTO",
    rawName: "POS 10983 PIZZA HUT #442 TORONTO",
    counterparty: "CARD PAYMENT PIZZA HUT #442",
    amount: 25,
    currency: "USD",
    direction: "out",
    status: "posted",
    category: "Uncategorized"
  };
  const pizzaVariant: Transaction = {
    ...pizzaBase,
    id: "pizza-2",
    counterparty: "PIZZA HUT 9911",
    description: "POS 88421 PIZZA HUT STORE 109"
  };
  const transferOne: Transaction = {
    ...pizzaBase,
    id: "transfer-1",
    counterparty: "ACH TRANSFER 8842",
    rawName: "ACH TRANSFER REF 8842",
    description: "ACH TRANSFER REF 8842"
  };
  const transferTwo: Transaction = {
    ...transferOne,
    id: "transfer-2",
    counterparty: "ACH TRANSFER 9921",
    rawName: "ACH TRANSFER REF 9921",
    description: "ACH TRANSFER REF 9921"
  };

  assert.equal(transactionAiGroupKey(pizzaBase), transactionAiGroupKey(pizzaVariant));
  assert.notEqual(transactionAiGroupKey(transferOne), transactionAiGroupKey(transferTwo));
});

test("AI receives only plausible company candidates for each transaction", () => {
  const transaction: Transaction = {
    id: "cursor-1",
    source: "slash",
    accountName: "Slash USD",
    date: "2026-07-30",
    description: "CURSOR AI SUBSCRIPTION 8842",
    rawName: "CURSOR AI SUBSCRIPTION 8842",
    counterparty: "CURSOR AI",
    amount: 40,
    currency: "USD",
    direction: "out",
    status: "posted",
    category: "Uncategorized"
  };
  const selected = aiProviderDirectoryForTransactions([transaction], canonicalProviders);

  assert.ok(selected.some((provider) => provider.name.toLowerCase() === "cursor"));
  assert.ok(selected.length <= 3);
  assert.ok(selected.every((provider) => provider.type === "supplier"));
});
