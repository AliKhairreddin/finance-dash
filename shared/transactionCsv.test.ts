import assert from "node:assert/strict";
import test from "node:test";
import { buildTransactionCsv, transactionCsvFileName } from "./transactionCsv";
import type { Transaction } from "./types";

const transaction: Transaction = {
  id: "wise-transaction-1",
  source: "wise",
  accountName: "Operating USD",
  date: "2026-07-30",
  description: 'Subscription, "annual"',
  rawName: "=HYPERLINK(\"https://example.com\")",
  counterparty: "Example Software",
  amount: 1234.56,
  currency: "USD",
  cashback: {
    amount: 18.52,
    rate: 1.5
  },
  direction: "out",
  status: "posted",
  category: "Software",
  merchantName: "Example Software",
  merchantKey: "examplesoftware",
  classificationComplete: true,
  categorySource: "ai",
  categoryConfidence: 0.91,
  categoryReason: "Known SaaS merchant",
  matchedProviderId: "provider-1",
  companyMatchSource: "ai",
  companyConfidence: 0.94,
  companyMatchReason: "Known supplier",
  matchedInvoiceId: "invoice-1",
  teamId: "team-1",
  confidence: 0.94,
  matchReason: "Known supplier"
};

test("buildTransactionCsv creates an Excel-compatible transaction export", () => {
  const csv = buildTransactionCsv([transaction], {
    providersById: new Map([["provider-1", { name: "Example, Inc." }]]),
    teamsById: new Map([["team-1", { name: "Operations" }]])
  });

  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /^﻿"Date","Source","Account"/);
  assert.match(csv, /"Subscription, ""annual"""/);
  assert.match(csv, /"'=HYPERLINK\(""https:\/\/example\.com""\)"/);
  assert.match(csv, /,1234\.56,/);
  assert.match(csv, /,18\.52,1\.5,/);
  assert.match(csv, /"Operations","Example, Inc\."/);
  assert.match(csv, /"Category reason","Owner","Company"/);
  assert.doesNotMatch(csv, /"Card holder"/);
  assert.match(csv, /"Software","Yes","ai",0\.91,"Known SaaS merchant"/);
  assert.match(csv, /"Example, Inc\.","ai",0\.94,"Known supplier","invoice-1","wise-transaction-1"$/);
});

test("buildTransactionCsv preserves an empty export as a header-only CSV", () => {
  const csv = buildTransactionCsv([], {
    providersById: new Map(),
    teamsById: new Map()
  });

  assert.equal(csv.split("\r\n").length, 1);
  assert.match(csv, /"Transaction ID"$/);
});

test("transactionCsvFileName normalizes the tab name and date", () => {
  assert.equal(
    transactionCsvFileName("Revolut Business", new Date("2026-07-30T16:00:00.000Z")),
    "bank-transactions-revolut-business-2026-07-30.csv"
  );
});
