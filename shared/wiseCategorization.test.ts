import assert from "node:assert/strict";
import test from "node:test";
import { wiseMovementCategory, wiseMovementClassification } from "./wiseCategorization";
import { initialTransactionCategories, sanitizeStoredTransactionCategoryRules } from "./categories";
import { transactionCategoryDescriptions } from "./categoryGuidance";
import { isInternalTransferTransaction, isNonOperatingMovementTransaction } from "./transactionPresentation";
import { profitDistributionContribution } from "./distribution";
import { enrichTransactions, finalizeDeterministicCategorization, learnCategoryAliases, transactionAiGroupKey } from "../server/matching";
import type { Transaction, TransactionCategoryRule } from "./types";

function transaction(description: string, overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "wise-test", source: "wise", wiseEntity: "lmd", accountName: "LOVEMEDO B.V.",
    date: "2026-09-04", description, rawName: "Wise", counterparty: "Wise",
    amount: 3465.88, currency: "USD", direction: "out", status: "posted",
    category: "Bank fees", categorySource: "manual", merchantName: "Wise",
    ...overrides
  };
}

const memory: TransactionCategoryRule[] = [{
  id: "bad-wise-rule", category: "Bank fees", direction: "out", aliases: ["Wise"],
  createdAt: "2026-09-01", updatedAt: "2026-09-01"
}];

test("both conversion legs override old manual/broad bank rules, even when the principal mentions a fee", () => {
  for (const direction of ["in", "out"] as const) {
    const tx = transaction("Converted 3,465.88 USD to 3,000.00 EUR (fee: 10.08 USD)", { direction });
    const result = finalizeDeterministicCategorization(tx, [], memory);
    assert.equal(result.category, "Currency conversion");
    assert.equal(result.classificationComplete, true);
    assert.equal(result.categorySource, "rule");
    assert.equal(result.amount, tx.amount);
    assert.equal(result.id, tx.id);
  }
});

test("Wise charges are fees regardless of size, and jar movements are internal transfers", () => {
  for (const amount of [1.13, 10_000]) {
    assert.equal(enrichTransactions([transaction("Wise Charges for: BALANCE-6000817735", { amount })], [], memory)[0].category, "Bank fees");
  }
  for (const description of ["Moved 5,000.00 EUR to Amin - jar", "Moved 5,000.00 EUR from EUR"]) {
    assert.equal(wiseMovementCategory(transaction(description))?.category, "Internal transfer");
  }
});

test("bank names, small amounts, invoice references and fee mentions do not identify a movement", () => {
  for (const description of [
    "Sent money to Mojo Labs LLC (fee: 1.13 USD)",
    "Received money from Unrelated Company with reference invoice 123",
    "Card transaction of 3.00 USD issued by Wise Software",
    "Invoice for currency conversion consulting",
    "Converted 50.00 USD to 50.00 USD"
  ]) assert.equal(wiseMovementClassification(transaction(description, { amount: 1 })), undefined);
  assert.equal(wiseMovementClassification(transaction("Converted 10.00 USD to 9.00 EUR", { source: "slash" })), undefined);
  assert.equal(wiseMovementClassification(transaction("Converted 10.00 USD to 9.00 EUR", { status: "voided" })), undefined);
  const parent = enrichTransactions([transaction("Sent money to Mojo Labs LLC (fee: 1.13 USD)", {
    category: "Uncategorized", categorySource: undefined
  })], [], memory)[0];
  assert.equal(parent.category, "Uncategorized");
});

test("owner-confirmed DN/LMD funding is intercompany; transfers to another account of the same company are internal", () => {
  for (const [wiseEntity, description, expected] of [
    ["dn", "Sent money to LOVEMEDO B.V. (fee: 1.13 USD)", "Intercompany transfer"],
    ["lmd", "Received money from Digital nudge OÜ with reference", "Intercompany transfer"],
    ["lmd", "Sent money to Digital Nudge OÜ", "Intercompany transfer"],
    ["dn", "Received money from LOVEMEDO B.V. with reference Funding", "Intercompany transfer"],
    ["lmd", "Sent money to LoveMeDo B.V.", "Internal transfer"],
    ["dn", "Sent money to Digital Nudge OÜ", "Internal transfer"]
  ] as const) {
    assert.equal(wiseMovementClassification(transaction(description, { wiseEntity }))?.category, expected);
  }
  assert.equal(wiseMovementCategory(transaction("Sent money to LOVEMEDO B.V. OTHER", { wiseEntity: "dn" })), undefined);
  assert.equal(wiseMovementCategory(transaction("Sent money to LOVEMEDO B.V.", { wiseEntity: undefined })), undefined);
  assert.equal(wiseMovementCategory(transaction("Wise Charges for: TRANSFER-1", { wiseEntity: "dn" }))?.category, "Bank fees");
});

test("old labels do not become classification evidence and broad Wise aliases are neither learned nor retained", () => {
  const tx = transaction("Unidentified bank activity", { categorySource: "ai" });
  assert.notEqual(enrichTransactions([tx], [], memory)[0].categorySource, "rule");
  assert.deepEqual(sanitizeStoredTransactionCategoryRules(memory), []);
  const learned = learnCategoryAliases([], tx, "Bank fees");
  assert.ok(learned.every((rule) => !rule.aliases.includes("Wise")));
});

test("AI groups distinguish bank fees, conversion principal and other transfers at the same bank", () => {
  const descriptions = ["Wise Charges for: BALANCE-1", "Converted 100 USD to 90 EUR", "Moved 90 EUR to EUR jar", "Sent money to DN"];
  assert.equal(new Set(descriptions.map((description) => transactionAiGroupKey(transaction(description)))).size, 4);
});

test("every built-in category has a definition and conversions/funding stay outside profit", () => {
  for (const category of initialTransactionCategories) assert.ok(transactionCategoryDescriptions[category.name], category.name);
  for (const category of ["Currency conversion", "Internal transfer", "Intercompany transfer", "Capital movement"]) {
    for (const direction of ["in", "out"] as const) {
      const tx = transaction("Movement", { category, direction });
      assert.equal(isNonOperatingMovementTransaction(tx), true);
      const contribution = profitDistributionContribution(tx);
      assert.equal(contribution.revenue, 0);
      assert.equal(contribution.generalCosts, 0);
    }
  }
  assert.equal(isInternalTransferTransaction(transaction("Movement", { category: "Intercompany transfer" })), false);
  assert.equal(profitDistributionContribution(transaction("Wise Charges for: BALANCE-1", { amount: 1.13 })).generalCosts, 1.13);
});
