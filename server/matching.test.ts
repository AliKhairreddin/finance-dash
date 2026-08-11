import assert from "node:assert/strict";
import test from "node:test";
import type { Transaction, TransactionCategoryRule } from "../shared/types";
import {
  aiProviderDirectoryForTransactions,
  canonicalProviders,
  finalizeDeterministicCategorization,
  learnAliases,
  learnCategoryAliases,
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

test("provider aliases stay bounded and exclude volatile bank references", () => {
  const provider = canonicalProviders.find((item) => item.id === "platform-meta-facebook-ads");
  if (!provider) throw new Error("Meta provider fixture is missing");
  const polluted = {
    ...provider,
    aliases: [
      ...provider.aliases,
      ...Array.from({ length: 9_000 }, (_, index) => `FACEBK *REF${String(index).padStart(8, "0")}`)
    ]
  };

  const normalized = mergeProviderDirectory([polluted])[0];
  assert.deepEqual(normalized.aliases, provider.aliases);

  const learned = learnAliases(
    provider,
    Array.from({ length: 200 }, (_, index) => `Stable merchant alias ${index}`)
  );
  assert.equal(learned.aliases.length, 128);
  assert.deepEqual(learnAliases(provider, ["FACEBK *USAYZY9EJ2"]), provider);
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
  const facebookChargeOne: Transaction = {
    ...pizzaBase,
    id: "facebook-1",
    counterparty: "FACEBK *USAYZY9EJ2",
    rawName: "FACEBK *USAYZY9EJ2",
    description: "FACEBK *USAYZY9EJ2"
  };
  const facebookChargeTwo: Transaction = {
    ...facebookChargeOne,
    id: "facebook-2",
    counterparty: "FACEBK *QPM47X2LNB",
    rawName: "FACEBK *QPM47X2LNB",
    description: "FACEBK *QPM47X2LNB"
  };
  const facebookAdCharge: Transaction = {
    ...facebookChargeOne,
    id: "facebook-ad-1",
    counterparty: "FACEBOOKAD* LJDQF2EUL4",
    rawName: "FACEBOOKAD* LJDQF2EUL4",
    description: "FACEBOOKAD* LJDQF2EUL4"
  };

  assert.equal(transactionAiGroupKey(pizzaBase), transactionAiGroupKey(pizzaVariant));
  assert.equal(transactionAiGroupKey(facebookChargeOne), transactionAiGroupKey(facebookChargeTwo));
  assert.equal(transactionAiGroupKey(facebookChargeOne), transactionAiGroupKey(facebookAdCharge));
  assert.notEqual(transactionAiGroupKey(transferOne), transactionAiGroupKey(transferTwo));
});

test("saved Facebook rules complete known charges without an AI request", () => {
  const pending: Transaction = {
    id: "facebook-pending-1",
    source: "slash",
    accountName: "Business Platinum Credit",
    date: "2026-08-06",
    description: "FACEBK *USAYZY9EJ2",
    rawName: "FACEBK *USAYZY9EJ2",
    counterparty: "FACEBK *USAYZY9EJ2",
    amount: 9,
    currency: "USD",
    direction: "out",
    status: "posted",
    category: "Slash"
  };
  const categoryRule: TransactionCategoryRule = {
    id: "category-rule-out-ad-spend",
    category: "Ad spend",
    direction: "out",
    aliases: ["facebook"],
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z"
  };

  const categorized = finalizeDeterministicCategorization(
    pending,
    canonicalProviders,
    [categoryRule]
  );

  assert.equal(categorized.category, "Ad spend");
  assert.equal(categorized.matchedProviderId, "platform-meta-facebook-ads");
  assert.equal(categorized.merchantName, "Meta / Facebook Ads");
  assert.equal(categorized.merchantKey, "metafacebookads");
  assert.equal(categorized.classificationComplete, true);
});

test("Slash daily card payments always finalize as internal transfers", () => {
  const payment: Transaction = {
    id: "slash-card-payment",
    source: "slash",
    slashAccountSubtype: "cash",
    accountName: "Business Platinum Cash",
    date: "2026-08-10",
    description: "Daily Credit Card Payment",
    rawName: "Daily Credit Card Payment",
    counterparty: "Daily Credit Card Payment",
    amount: 18_230.63,
    currency: "USD",
    direction: "out",
    status: "posted",
    category: "Software",
    categorySource: "manual",
    merchantName: "Amex",
    matchedProviderId: "provider-amex",
    classificationComplete: true
  };
  const poisonedRule: TransactionCategoryRule = {
    id: "category-rule-out-software",
    category: "Software",
    direction: "out",
    aliases: ["card_payment"],
    createdAt: "2026-08-02T00:00:00.000Z",
    updatedAt: "2026-08-02T00:00:00.000Z"
  };

  const categorized = finalizeDeterministicCategorization(payment, canonicalProviders, [poisonedRule]);

  assert.equal(categorized.category, "Internal transfer");
  assert.equal(categorized.categorySource, "rule");
  assert.equal(categorized.categoryConfidence, 1);
  assert.equal(categorized.categoryReason, "Slash daily card payment");
  assert.equal(categorized.merchantName, "Slash card payment");
  assert.equal(categorized.merchantKey, "slashcardpayment");
  assert.equal(categorized.matchedProviderId, undefined);
  assert.equal(categorized.classificationComplete, true);
});

test("category learning ignores generic bank activity types", () => {
  const transaction: Transaction = {
    id: "revolut-google-workspace",
    source: "revolut",
    accountName: "Revolut USD",
    date: "2026-08-02",
    description: "card_payment",
    rawName: "Google Workspace",
    counterparty: "Google Workspace",
    amount: 20,
    currency: "USD",
    direction: "out",
    status: "posted",
    category: "Software",
    merchantName: "Google Workspace"
  };

  const [rule] = learnCategoryAliases([], transaction, "Software", "2026-08-02T00:00:00.000Z");

  assert.deepEqual(rule.aliases, ["Google Workspace"]);
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
