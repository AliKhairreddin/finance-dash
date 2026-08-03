import assert from "node:assert/strict";
import test from "node:test";
import { PDFDocument } from "pdf-lib";
import { generateSlashExpenseActivityPdf, slashExpensePdfFileName } from "./slashExpensePdf";
import { groupSlashTransactions } from "./slashMerchantGroups";
import type { Transaction } from "./types";

function transaction(index: number): Transaction {
  return {
    id: `slash-meta-${index}`,
    source: "slash",
    slashAccountSubtype: "credit",
    accountName: "Slash Platinum Credit",
    date: `2026-07-${String((index % 28) + 1).padStart(2, "0")}`,
    description: `META ADS CAMPAIGN ${index}`,
    rawName: index % 2 === 0 ? "Facebook Ads" : "Meta Platforms",
    counterparty: index % 2 === 0 ? "Facebook Ads" : "Meta Platforms",
    amount: 10 + index,
    currency: "USD",
    direction: "out",
    status: "posted",
    category: "Advertising"
  };
}

test("Slash expense report includes every grouped transaction across multiple PDF pages", async () => {
  const group = groupSlashTransactions(Array.from({ length: 80 }, (_, index) => transaction(index)))[0];
  const bytes = await generateSlashExpenseActivityPdf(
    group,
    { fromDate: "2026-07-01", toDate: "2026-07-31" },
    new Date("2026-08-01T12:00:00.000Z")
  );

  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 2);
  assert.equal(pdf.getTitle(), "Meta - Slash expense activity - 2026-07-01 to 2026-07-31");
  assert.equal(
    slashExpensePdfFileName(group, { fromDate: "2026-07-01", toDate: "2026-07-31" }),
    "slash-meta-2026-07-01-to-2026-07-31.pdf"
  );
});
