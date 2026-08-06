import assert from "node:assert/strict";
import test from "node:test";
import type { AccountBalance, WiseStatementImport } from "./types";
import {
  normalizeImportedWiseTransactions,
  parseWiseStatementCsv,
  prepareWiseStatementImport,
  validateWiseStatementImportPayload
} from "./wiseStatements";
import { verifyWiseStatementAccount } from "./wiseEntities";
import { wiseTransactionId } from "./wiseTransactionIdentity";

const header = [
  "TransferWise ID",
  "Date",
  "Date Time",
  "Amount",
  "Currency",
  "Description",
  "Payment Reference",
  "Running Balance",
  "Exchange From",
  "Exchange To",
  "Exchange Rate",
  "Payer Name",
  "Payee Name",
  "Payee Account Number",
  "Merchant",
  "Card Last Four Digits",
  "Card Holder Full Name",
  "Attachment",
  "Note",
  "Total fees",
  "Exchange To Amount",
  "Transaction Type",
  "Transaction Details Type"
].map((value) => `"${value}"`).join(",");

function statementRow({
  amount,
  cardLastFour = "",
  description,
  dateTime = "27-07-2026 11:42:43.898",
  payer = "",
  payee = ""
}: {
  amount: string;
  cardLastFour?: string;
  description: string;
  dateTime?: string;
  payer?: string;
  payee?: string;
}): string {
  return [
    "TRANSFER-2273583228",
    "27-07-2026",
    dateTime,
    amount,
    "USD",
    description,
    "META30626",
    "1000.00",
    "",
    "",
    "",
    payer,
    payee,
    "",
    "",
    cardLastFour,
    "",
    "",
    "",
    "0.00",
    "",
    amount.startsWith("-") ? "DEBIT" : "CREDIT",
    "TRANSFER"
  ].map((value) => `"${value}"`).join(",");
}

const accounts: AccountBalance[] = [
  {
    id: "wise-65909506-114115192",
    name: "Digital nudge OÜ · Wise USD",
    source: "wise",
    wiseEntity: "dn",
    balance: 1,
    currency: "USD",
    updatedAt: "2026-07-30T00:00:00.000Z",
    status: "live"
  },
  {
    id: "wise-31035977-37067652",
    name: "LoveMeDo B.V. · Wise USD",
    source: "wise",
    wiseEntity: "lmd",
    balance: 1,
    currency: "USD",
    updatedAt: "2026-07-30T00:00:00.000Z",
    status: "live"
  },
  {
    id: "wise-31035977-37067485",
    name: "LoveMeDo B.V. · Wise EUR",
    source: "wise",
    wiseEntity: "lmd",
    balance: 50_396.06,
    currency: "EUR",
    updatedAt: "2026-07-30T11:56:58.257809Z",
    status: "live"
  }
];

test("Wise CSV ownership is verified by balance ID instead of counterparty names", () => {
  const dnFileName = "statement_114115192_USD_2026-07-01_2026-07-30.csv";
  const lmdFileName = "statement_37067652_USD_2026-07-01_2026-07-30.csv";
  const dnParsed = parseWiseStatementCsv(
    `${header}\n${statementRow({
      amount: "-99000.00",
      description: "Sent money to LOVEMEDO B.V.",
      payee: "LOVEMEDO B.V."
    })}`,
    dnFileName
  )[0];
  const lmdParsed = parseWiseStatementCsv(
    `${header}\n${statementRow({
      amount: "99000.00",
      description: "Received money from Digital nudge OÜ with reference META30626",
      payer: "Digital nudge OÜ"
    })}`,
    lmdFileName
  )[0];

  const dnPayload = prepareWiseStatementImport(
    dnParsed,
    verifyWiseStatementAccount(dnParsed.metadata, accounts, "dn")
  );
  const lmdPayload = prepareWiseStatementImport(
    lmdParsed,
    verifyWiseStatementAccount(lmdParsed.metadata, accounts, "lmd")
  );

  assert.equal(dnPayload.wiseEntity, "dn");
  assert.equal(lmdPayload.wiseEntity, "lmd");
  assert.equal(dnPayload.transactions[0].accountName, "Digital nudge OÜ · Wise USD");
  assert.equal(lmdPayload.transactions[0].accountName, "LoveMeDo B.V. · Wise USD");
  assert.notEqual(dnPayload.transactions[0].id, lmdPayload.transactions[0].id);
  assert.equal(
    lmdPayload.transactions[0].id,
    wiseTransactionId(
      "37067652",
      JSON.stringify([
        "TRANSFER-2273583228",
        "27-07-2026 11:42:43.898",
        "99000",
        "USD",
        "CREDIT",
        "TRANSFER"
      ])
    )
  );
});

test("Wise CSV imports retain the card last four digits for card totals", () => {
  const fileName = "statement_37067652_USD_2026-07-01_2026-07-30.csv";
  const parsed = parseWiseStatementCsv(
    `${header}\n${statementRow({
      amount: "-125.50",
      cardLastFour: "8744",
      description: "Card transaction of 125.50 USD issued by Meta"
    })}`,
    fileName
  )[0];
  const payload = prepareWiseStatementImport(
    parsed,
    verifyWiseStatementAccount(parsed.metadata, accounts, "lmd")
  );

  assert.equal(payload.transactions[0].cardLastFour, "8744");
});

test("official Wise ledger rows may share a TransferWise ID without sharing an identity", () => {
  const fileName = "statement_37067485_EUR_2026-01-01_2026-06-30.csv";
  const debit = statementRow({
    amount: "-20.00",
    description: "Card transaction of 20.00 EUR issued by EV Charge Session",
    dateTime: "26-06-2026 09:01:27.479"
  }).replace('"USD"', '"EUR"');
  const credit = statementRow({
    amount: "20.00",
    description: "Card transaction of 20.00 EUR issued by EV Charge Session",
    dateTime: "26-06-2026 09:06:01.662"
  }).replace('"USD"', '"EUR"');
  const parsed = parseWiseStatementCsv(`${header}\n${debit}\n${credit}`, fileName)[0];
  const payload = prepareWiseStatementImport(
    parsed,
    verifyWiseStatementAccount(parsed.metadata, accounts, "lmd")
  );

  assert.equal(payload.transactions.length, 2);
  assert.equal(new Set(payload.transactions.map((transaction) => transaction.id)).size, 2);
  assert.doesNotThrow(() => validateWiseStatementImportPayload(payload, []));

  const reparsed = prepareWiseStatementImport(
    parseWiseStatementCsv(`${header}\n${debit}\n${credit}`, fileName)[0],
    verifyWiseStatementAccount(parsed.metadata, accounts, "lmd")
  );
  assert.deepEqual(
    reparsed.transactions.map((transaction) => transaction.id),
    payload.transactions.map((transaction) => transaction.id)
  );
});

test("a Wise CSV selected in the wrong entity view is rejected before import", () => {
  const fileName = "statement_37067652_USD_2026-07-01_2026-07-30.csv";
  const parsed = parseWiseStatementCsv(
    `${header}\n${statementRow({
      amount: "99000.00",
      description: "Received money from Digital nudge OÜ",
      payer: "Digital nudge OÜ"
    })}`,
    fileName
  )[0];

  assert.throws(
    () => verifyWiseStatementAccount(parsed.metadata, accounts, "dn"),
    /belongs to LMD, not DN/
  );
});

test("the original LMD EUR filename verifies against its live Wise balance", () => {
  const fileName = "statement_37067485_EUR_2026-01-01_2026-06-30.csv";
  const parsed = parseWiseStatementCsv(`${header}\n`, fileName)[0];

  assert.deepEqual(verifyWiseStatementAccount(parsed.metadata, accounts, "lmd"), {
    accountId: "wise-31035977-37067485",
    accountName: "LoveMeDo B.V. · Wise EUR",
    wiseEntity: "lmd"
  });
});

test("empty Wise balance CSVs still retain verifiable filename metadata", () => {
  const fileName = "statement_93497547_GBP_2026-07-01_2026-07-30.csv";
  const parsed = parseWiseStatementCsv(`${header}\n`, fileName)[0];

  assert.deepEqual(parsed.metadata, {
    balanceId: "93497547",
    currency: "GBP",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-30",
    fileName
  });
  assert.deepEqual(parsed.transactions, []);
});

test("a known Wise balance cannot be reassigned to another entity", () => {
  const fileName = "statement_37067652_USD_2026-07-01_2026-07-30.csv";
  const parsed = parseWiseStatementCsv(
    `${header}\n${statementRow({
      amount: "99000.00",
      description: "Received money from Digital nudge OÜ",
      payer: "Digital nudge OÜ"
    })}`,
    fileName
  )[0];
  const payload = prepareWiseStatementImport(
    parsed,
    verifyWiseStatementAccount(parsed.metadata, accounts, "lmd")
  );
  const existingImports: WiseStatementImport[] = [{
    id: "wise-import-existing",
    balanceId: "37067652",
    wiseEntity: "dn",
    accountName: "Digital nudge OÜ · Wise USD",
    currency: "USD",
    periodStart: "2026-06-01",
    periodEnd: "2026-06-30",
    fileName: "existing.csv",
    transactionCount: 1,
    importedAt: "2026-07-01T00:00:00.000Z"
  }];

  assert.throws(
    () => validateWiseStatementImportPayload(payload, existingImports),
    /already assigned to DN/
  );
});

test("Wise CSV keeps zero-value provider rows and rejects invalid calendar dates", () => {
  const fileName = "statement_114115192_USD_2026-07-01_2026-07-30.csv";
  const parsed = parseWiseStatementCsv(
    `${header}\n${statementRow({ amount: "0.00", description: "Zero-value provider row" })}`,
    fileName
  )[0];
  assert.equal(parsed.transactions.length, 1);
  assert.equal(parsed.transactions[0].amount, 0);

  const invalidDateRow = statementRow({ amount: "1.00", description: "Invalid date" })
    .replace('"27-07-2026"', '"31-02-2026"');
  assert.throws(
    () => parseWiseStatementCsv(`${header}\n${invalidDateRow}`, fileName),
    /valid ISO calendar date/
  );
});

test("Wise import normalization rejects every malformed row instead of silently dropping it", () => {
  const fileName = "statement_114115192_USD_2026-07-01_2026-07-30.csv";
  const parsed = parseWiseStatementCsv(
    `${header}\n${statementRow({ amount: "10.00", description: "Valid transaction" })}`,
    fileName
  )[0];
  const payload = prepareWiseStatementImport(
    parsed,
    verifyWiseStatementAccount(parsed.metadata, accounts, "dn")
  );
  const transaction = payload.transactions[0];
  const malformedTransactions = [
    { ...transaction, id: "" },
    { ...transaction, date: "" },
    { ...transaction, date: "2026-02-30" },
    { ...transaction, amount: Number.NaN },
    { ...transaction, currency: "EUR" },
    { ...transaction, status: "pending" as const },
    { ...transaction, description: "" }
  ];

  for (const malformed of malformedTransactions) {
    assert.throws(
      () => normalizeImportedWiseTransactions({ ...payload, transactions: [malformed] }),
      /Wise import transaction|identity/
    );
  }
});

test("Wise import validation bounds transaction count and serialized payload bytes", () => {
  const fileName = "statement_114115192_USD_2026-07-01_2026-07-30.csv";
  const parsed = parseWiseStatementCsv(
    `${header}\n${statementRow({ amount: "10.00", description: "Valid transaction" })}`,
    fileName
  )[0];
  const payload = prepareWiseStatementImport(
    parsed,
    verifyWiseStatementAccount(parsed.metadata, accounts, "dn")
  );
  const transaction = payload.transactions[0];

  assert.throws(
    () => validateWiseStatementImportPayload({
      ...payload,
      transactions: Array.from({ length: 5_001 }, () => transaction)
    }, []),
    /exceeds 5000 transactions/
  );

  assert.throws(
    () => validateWiseStatementImportPayload({
      ...payload,
      transactions: Array.from({ length: 3_000 }, () => ({
        ...transaction,
        description: "x".repeat(900)
      }))
    }, []),
    /payload exceeds 2097152 bytes/
  );
});
