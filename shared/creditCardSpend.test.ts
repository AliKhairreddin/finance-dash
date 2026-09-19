import assert from "node:assert/strict";
import test from "node:test";
import { enrichTransactions } from "../server/matching";
import { amexStatementTransactions } from "./amexStatements";
import { createBankAnalyticsAccumulator } from "./analytics";
import { bankCardGroupKey, bankMerchantGroupKey, summarizeBankActivity } from "./bankMerchantGroups";
import { groupExpenseAnalytics } from "./expenseAnalytics";
import type { Transaction } from "./types";

async function purchaseAndRepayment(): Promise<Transaction[]> {
  const cardRows = await amexStatementTransactions({
    currency: "EUR", cardLastFour: "1003", reviewReasons: [],
    rows: [
      { date: "2026-09-01", description: "Example purchase", amount: 100 },
      { date: "2026-09-02", description: "HARTELIJK BEDANKT VOOR UW BETALING", amount: -100 }
    ]
  });
  const [bankPayment] = enrichTransactions([{
    id: "bank-payment", source: "wise", accountId: "wise-eur", accountName: "Wise EUR",
    date: "2026-09-02", description: "Paid to AMERICAN EXPRESS EUROPE S.A.",
    counterparty: "AMERICAN EXPRESS EUROPE S.A.", rawName: "AMERICAN EXPRESS EUROPE S.A.",
    amount: 100, currency: "EUR", direction: "out", status: "posted", category: "Uncategorized"
  }], [], [{
    id: "amex-repayments", category: "Internal transfer", direction: "out",
    aliases: ["american express europe s a"],
    createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z"
  }]);
  assert.equal(bankPayment.category, "Internal transfer");
  return [...cardRows, bankPayment];
}

test("a EUR 100 Amex purchase and repayment produce EUR 100 spend without repayment income", async () => {
  const transactions = await purchaseAndRepayment();
  const analytics = createBankAnalyticsAccumulator({
    fromDate: "2026-09-01", toDate: "2026-09-30", providers: [], teams: []
  });
  analytics.addPage(transactions);
  const summary = analytics.finish("2026-09-03T00:00:00Z").summary;
  assert.deepEqual(summary.moneyOut, { EUR: 100 });
  assert.deepEqual(summary.moneyIn, {});
  assert.equal(summary.internalTransferCount, 2);
  assert.equal(groupExpenseAnalytics(transactions, new Map())[0].total, 100);

  const activity = summarizeBankActivity(transactions);
  assert.equal(activity.merchantGroups.length, 1);
  assert.deepEqual(activity.merchantGroups[0].spend, { EUR: 100 });
  assert.deepEqual(activity.merchantGroups[0].credits, {});
  assert.equal(activity.cardGroups.length, 1);
  assert.deepEqual(activity.cardGroups[0].spend, { EUR: 100 });
  assert.deepEqual(activity.cardGroups[0].credits, {});
  for (const payment of transactions.slice(1)) {
    assert.equal(bankMerchantGroupKey(payment), undefined);
    assert.equal(bankCardGroupKey(payment), undefined);
  }
  // Account activity retains the actual movements for reconciliation.
  assert.deepEqual(activity.accountGroups.find(row => row.source === "wise")?.spend, { EUR: 100 });
  assert.deepEqual(activity.accountGroups.find(row => row.source === "amex")?.credits, { EUR: 100 });
});

test("Amex fees and merchant refunds remain operating activity while repayments are excluded", async () => {
  const transactions = await purchaseAndRepayment();
  transactions.push(...await amexStatementTransactions({
    currency: "EUR", cardLastFour: "1003", reviewReasons: [],
    rows: [
      { date: "2026-09-03", description: "Amex card fee", amount: 5 },
      { date: "2026-09-03", description: "Example purchase", amount: -20 }
    ]
  }));
  const activity = summarizeBankActivity(transactions);
  assert.deepEqual(activity.cardGroups[0].spend, { EUR: 105 });
  assert.deepEqual(activity.cardGroups[0].credits, { EUR: 20 });
  assert.equal(activity.cardGroups[0].transactionCount, 3);
  assert.equal(activity.merchantGroups.reduce((sum, row) => sum + (row.spend.EUR ?? 0), 0), 105);
  assert.equal(activity.merchantGroups.reduce((sum, row) => sum + (row.credits.EUR ?? 0), 0), 20);
});
