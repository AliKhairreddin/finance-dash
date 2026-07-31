import assert from "node:assert/strict";
import test from "node:test";
import type { AccountBalance, WiseStatementImport } from "./types";
import {
  parseWiseStatementCsv,
  prepareWiseStatementImport,
  validateWiseStatementImportPayload
} from "./wiseStatements";
import { verifyWiseStatementAccount } from "./wiseEntities";

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
  description,
  payer = "",
  payee = ""
}: {
  amount: string;
  description: string;
  payer?: string;
  payee?: string;
}): string {
  return [
    "TRANSFER-2273583228",
    "27-07-2026",
    "27-07-2026 11:42:43.898",
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
    "",
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
  assert.match(lmdPayload.transactions[0].id, /^wise-csv-lmd-/);
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
