import assert from "node:assert/strict";
import test from "node:test";
import type { AccountBalance, WiseStatementImport } from "./types";
import { wiseStatementAccountCoverage } from "./wiseEntities";

const accounts: AccountBalance[] = [
  {
    id: "wise-22-2201",
    name: "Digital Nudge · Wise USD",
    source: "wise",
    wiseEntity: "dn",
    balance: 250,
    currency: "USD",
    updatedAt: "2026-08-31T14:00:00.000Z",
    status: "live"
  },
  {
    id: "wise-11-1101",
    name: "Love Me Do · Wise EUR",
    source: "wise",
    wiseEntity: "lmd",
    balance: 125,
    currency: "EUR",
    updatedAt: "2026-08-31T14:00:00.000Z",
    status: "live"
  }
];

const imports: WiseStatementImport[] = [
  {
    id: "wise-import-2201-usd-january",
    balanceId: "2201",
    wiseEntity: "dn",
    accountName: "Digital Nudge · Wise USD",
    currency: "USD",
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    fileName: "statement_2201_USD_2026-01-01_2026-01-31.csv",
    transactionCount: 12,
    importedAt: "2026-02-01T10:00:00.000Z"
  },
  {
    id: "wise-import-2201-usd-august",
    balanceId: "2201",
    wiseEntity: "dn",
    accountName: "Digital Nudge · Wise USD",
    currency: "USD",
    periodStart: "2026-08-01",
    periodEnd: "2026-08-31",
    fileName: "statement_2201_USD_2026-08-01_2026-08-31.csv",
    transactionCount: 20,
    importedAt: "2026-08-31T15:45:00.000Z"
  }
];

test("summarizes Wise statement coverage and latest upload by live account", () => {
  assert.deepEqual(wiseStatementAccountCoverage(accounts, imports, "all"), [
    {
      accountName: "Digital Nudge · Wise USD",
      balanceId: "2201",
      currency: "USD",
      wiseEntity: "dn",
      periodStart: "2026-01-01",
      periodEnd: "2026-08-31",
      importedAt: "2026-08-31T15:45:00.000Z"
    },
    {
      accountName: "Love Me Do · Wise EUR",
      balanceId: "1101",
      currency: "EUR",
      wiseEntity: "lmd"
    }
  ]);
});

test("filters Wise statement coverage with the selected entity", () => {
  assert.deepEqual(
    wiseStatementAccountCoverage(accounts, imports, "lmd").map((coverage) => coverage.balanceId),
    ["1101"]
  );
});

test("keeps imported coverage visible when live Wise balances are unavailable", () => {
  const importWithoutLiveAccount: WiseStatementImport = {
    ...imports[0],
    accountName: undefined
  };

  assert.deepEqual(wiseStatementAccountCoverage([], [importWithoutLiveAccount], "all"), [{
    balanceId: "2201",
    currency: "USD",
    wiseEntity: "dn",
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    importedAt: "2026-02-01T10:00:00.000Z"
  }]);
});
