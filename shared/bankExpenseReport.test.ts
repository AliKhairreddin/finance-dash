import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { bankExpenseReportFileName, generateBankExpenseReportPdf } from "./bankExpenseReport";
import { groupBankTransactions } from "./bankMerchantGroups";
import type { Transaction } from "./types";

function transaction(index: number): Transaction {
  const cardLastFour = index % 2 === 0 ? "8744" : "1003";
  return {
    id: `slash-meta-${index}`,
    source: "slash",
    slashAccountSubtype: "credit",
    accountId: `slash-card-${cardLastFour}`,
    accountName: "Slash Platinum Credit",
    cardId: `card-${cardLastFour}`,
    cardLastFour,
    date: `2026-07-${String((index % 28) + 1).padStart(2, "0")}`,
    description: `META ADS PAYMENT ${index}`,
    rawName: index % 2 === 0 ? "Facebook Ads" : "Meta Platforms",
    counterparty: index % 2 === 0 ? "Facebook Ads" : "Meta Platforms",
    amount: 10 + index,
    currency: "USD",
    direction: "out",
    status: "posted",
    category: "Advertising",
    cashback: { amount: Math.round((10 + index) * 4) / 100, rate: 0.04 }
  };
}

test("internal billing report includes an overview and every card transaction across pages", async () => {
  const group = groupBankTransactions(Array.from({ length: 80 }, (_, index) => transaction(index)))[0];
  const bytes = await generateBankExpenseReportPdf(
    group,
    { fromDate: "2026-07-01", toDate: "2026-07-31" },
    new Date("2026-08-01T12:00:00.000Z")
  );

  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 5);
  assert.equal(pdf.getTitle(), "Meta - internal billing report - 2026-07-01 to 2026-07-31");
  assert.equal(group.cardGroups.length, 2);
  assert.equal(group.cardGroups.reduce((total, card) => total + card.transactionCount, 0), 80);
  assert.equal(
    bankExpenseReportFileName(group, { fromDate: "2026-07-01", toDate: "2026-07-31" }),
    "meta-internal-billing-report-2026-07-01-to-2026-07-31.pdf"
  );
});

test("per-card report rejects merchant activity without verified card metadata", async () => {
  const withoutCard = transaction(1);
  delete withoutCard.cardId;
  delete withoutCard.cardLastFour;
  const group = groupBankTransactions([withoutCard])[0];

  await assert.rejects(
    generateBankExpenseReportPdf(group, { fromDate: "2026-07-01", toDate: "2026-07-31" }),
    /missing verified card metadata/
  );
});
