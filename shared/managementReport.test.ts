import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import {
  buildManagementReport,
  managementReportParserVersion,
  managementReportSheetKeys,
  parseManagementReportCsv,
  type ManagementReportSheetKey
} from "./managementReport";

function csv(rows: Array<Array<string | number>>): string {
  return rows.map((row) => row.map((value) => {
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }).join(",")).join("\r\n");
}

function businessCsv(revenue: number, marketingSpend: number, operatingSpend: number): string {
  const grossProfit = revenue - marketingSpend;
  const netProfit = grossProfit - operatingSpend;
  return csv([
    ["", "Business Unit"],
    ["", "Business Performance - May 2026"],
    ["", "Particulars", "Base", "Budget CY 2026", "31-May-26", "YTD May 2026", "Run Rate (42%)", "Sales Rate"],
    ["", "Advertising Revenue:"],
    ["", "Source A", "Ali", revenue, revenue * 0.4, revenue * 0.4, "0.10", "0.40"],
    ["", "Source B", "Ali", 0, revenue * 0.6, revenue * 0.6, "0.10", "0.60"],
    ["", "TOTAL ADVERTISING REVENUE", "", revenue, revenue, revenue, "0.42", "1"],
    ["", "Marketing Spend"],
    ["", "Channel A", "Ali", marketingSpend, marketingSpend, marketingSpend, "0.42", "1"],
    ["", "TOTAL MARKETING SPENDS + COMM", "", marketingSpend, marketingSpend, marketingSpend, "0.42", "1"],
    ["", "GROSS PROFIT", "", grossProfit, grossProfit, grossProfit, "0.42", "1"],
    ["", "GROSS PROFIT (%)", "", grossProfit / revenue, grossProfit / revenue, grossProfit / revenue, "0.42", "1"],
    ["", "Finance Spend:"],
    ["", "Software", "Bank", operatingSpend, operatingSpend, operatingSpend, "0.42", "1"],
    ["", "TOTAL SPEND", "", operatingSpend, operatingSpend, operatingSpend, "0.42", "1"],
    ["", "NET PROFIT", "", netProfit, netProfit, netProfit, "0.42", "1"],
    ["", "NET PROFIT (%)", "", netProfit / revenue, netProfit / revenue, netProfit / revenue, "0.42", "1"]
  ]);
}

function syntheticSheets(): Record<ManagementReportSheetKey, string> {
  return {
    shareholders: csv([
      ["", "Digital Nudge O.U"],
      ["", "Partner's Balance - YTD May 2026"],
      ["", "Equity", "Amount", "Amount", "Asset & Liability", "Amount", "Amount", "Particulars", "Total", "Ishan", "Amin"],
      ["", "Partner's Balance", "", 300],
      ["", "- Ishan", 100, "", "Net Working Capital", "", 300],
      ["", "- Amin", 200],
      ["", "Total Equity Balance", "", 300, "Total Assets & Liability", "", 300],
      ["", "", "", "", "", "", "", "Total Profit as of 31st May 26", 30, 10, 20]
    ]),
    "vb-cp": businessCsv(100, 60, 10),
    "consolidated-bank": csv([
      ["", "Date", "Company Name", "Bank Name", "Service Month", "Month", "Reference", "User Name", "BS/PL", "Account Type", "Nature of Expense", "Segment", "Currency", "Amount incl. VAT", "Rate to USD", "Amount", "Comment", "Reco"],
      ["", "31-May-26", "Digital Nudge", "Wise", "31-May-26", "31-May-26", "SECRET_REFERENCE", "SECRET_USER", "PL", "Income", "Offer Revenue", "Cognitive Pixel", "USD", 100, 1, 100, "", ""],
      ["", "31-May-26", "Digital Nudge", "Wise", "31-May-26", "31-May-26", "Expense reference", "Finance", "PL", "Expense", "Software", "Cognitive Pixel", "USD", 40, 1, 40, "", ""],
      ["", "14-Jun-26", "Digital Nudge", "Amex", "30-Jun-26", "30-Jun-26", "POST_CLOSE_REFERENCE", "SECRET_CARD_USER", "PL", "Expense", "Software", "ACP", "EUR", 50, "", "", "", ""]
    ]),
    "vb-acp": businessCsv(30, 20, 2),
    "vb-wag": businessCsv(200, 150, 20),
    "wag-aff": csv([
      ["", "", "Total Spend", 500, "", 500],
      ["", "", "", "", "", "", "", "Offer Redtrack 1 Cognitive", "Offer Source", "Redtrack Revenue", "Dashboard Source", "Dashboard Revenue"],
      ["", "", "", "", "", "", "", "Offer One", "Redtrack", 100, "Dashboard", 105],
      ["", "", "", "", "", "", "", "Total redtrack 1", "", 100, "", 105],
      ["", "", "", "", "", "", "", "Offer Revenue Total", "", 100, "", 105],
      ["", "", "", "", "", "", "", "", "", "", "", "", "", "ACA Offer"],
      ["", "", "", "", "", "", "", "", "", "", "", "", "", "Leadwell", 10, 11],
      ["", "", "", "", "", "", "", "", "", "", "", "", "", "ACA revenue", 10, 11],
      ["", "", "", "", "", "", "", "", "", "", "", "", "", "Final Calculation"]
    ]),
    "vb-rest": csv([
      ["", "Atlantic Ocean + Affiliates"],
      ["", "Business Performance"],
      ["", "Particulars", "Base", "Budget CY 2026", "Altanic Ocean Performance", "31-Jan-26", "28-Feb-26", "Affiliates Performance", "Sales Rate"],
      ["", "Advertising Revenue:"],
      ["", "Kissterra", "Ali", 200, 20, "", "", "", "1"],
      ["", "Affiliates - Revenue", "Ali", 300, "", 10, 20, 30, "1"],
      ["", "Marketing Spend"],
      ["", "Facebook", "Ali", 100, 10, "", "", "", "1"],
      ["", "Affiliates - Expense", "Ali", 200, "", 6, 14, 20, "1"],
      ["", "NET MARGIN", "", 200, 10, 4, 6, 11, ""]
    ]),
    plp: csv([
      ["", "Digital Nudge O.U"],
      ["", "Platform Level Profitability - YTD May 2026"],
      ["", "Months", "Platform Name", "Revenue", "Spend", "Profit", "Profit Margin", "Leads", "CPL"],
      ["", "YTD May 2026", "Facebook", 70, 50, 20, "0.285714", 10, 5],
      ["", "", "Total", 100, 80, 20, "0.20", 20, 4]
    ])
  };
}

test("RFC4180 parsing preserves embedded data and physical line spans", () => {
  const records = parseManagementReportCsv('a,b,c\r\n1,"hello, ""world""","line 1\r\nline 2"\r\n');
  assert.equal(records.length, 2);
  assert.deepEqual(records[1]?.cells, ["1", 'hello, "world"', "line 1\nline 2"]);
  assert.deepEqual([records[1]?.lineStart, records[1]?.lineEnd], [2, 3]);
  assert.throws(() => parseManagementReportCsv('a,"closed"x\n'), /Unexpected character after closing quote/);
  assert.throws(() => parseManagementReportCsv('a,"never closed'), /Unclosed quoted field/);
});

test("normalized report build is deterministic, period-safe, and redacts bank lineage", () => {
  const sheets = syntheticSheets();
  const metadata = { importedAt: "2026-07-21T12:00:00.000Z", asOf: "2026-05-31" };
  const first = buildManagementReport(sheets, metadata);
  const second = buildManagementReport(sheets, metadata);

  assert.equal(managementReportParserVersion, "1");
  assert.deepEqual(first.facts.map((fact) => fact.factId), second.facts.map((fact) => fact.factId));
  assert.deepEqual(first.bankEntries.map((entry) => entry.entryId), second.bankEntries.map((entry) => entry.entryId));
  assert.deepEqual(first.sourceRows.map((row) => row.sourceRowId), second.sourceRows.map((row) => row.sourceRowId));
  assert.equal(new Set(first.facts.map((fact) => fact.factId)).size, first.facts.length);

  const cognitivePixel = first.dashboard.businessUnits.find((unit) => unit.id === "cognitive-pixel");
  assert.ok(cognitivePixel);
  assert.equal(cognitivePixel.actual.revenue, 100, "reported subtotal is used once, not added to its detail rows");
  assert.equal(cognitivePixel.actual.grossMargin, 0.4);
  assert.equal(cognitivePixel.actual.netMargin, 0.3);
  const revenueLine = cognitivePixel.lines.find((line) => line.metric === "revenue");
  assert.equal(revenueLine?.percentages["run-rate-42"], 0.42);
  assert.equal(revenueLine?.percentages["sales-rate"], 1);

  assert.equal(first.dashboard.summary.revenue, 350, "ACP stays visible but is not double-counted above its Cognitive Pixel parent");
  assert.equal(first.dashboard.businessUnits.find((unit) => unit.id === "acp")?.actual.revenue, 30);
  assert.equal(first.dashboard.trend.find((point) => point.period === "2026-05-31")?.revenue, 300);
  const atlanticOcean = first.dashboard.businessUnits.find((unit) => unit.id === "atlantic-ocean");
  assert.equal(atlanticOcean?.latestPeriodLabel, "Atlantic Ocean Performance");
  assert.equal(atlanticOcean?.columns.find((column) => column.key === "performance")?.label, "Atlantic Ocean Performance");
  assert.ok(first.sourceRows.some((row) => row.sheetKey === "vb-rest" && row.cells.includes("Altanic Ocean Performance")));
  assert.doesNotMatch(JSON.stringify(first.dashboard), /Altanic Ocean/);
  assert.equal(first.dashboard.bank.totalEntryCount, 3);
  assert.equal(first.dashboard.bank.officialEntryCount, 2);
  assert.equal(first.dashboard.bank.postCloseEntryCount, 1);
  assert.equal(first.dashboard.bank.unconvertedEntryCount, 1);
  assert.equal(first.dashboard.summary.bankIncome, 100);
  assert.equal(first.dashboard.summary.bankExpense, 40);
  assert.equal(first.dashboard.summary.bankNet, 60);
  assert.ok(first.dashboard.checks.some((item) => item.code === "bank-post-close-rows"));
  assert.ok(first.dashboard.checks.some((item) => item.code === "bank-unconverted-rows"));
  assert.equal(first.bankEntries.at(-1)?.reference, "POST_CLOSE_REFERENCE");
  assert.equal(first.bankEntries.at(-1)?.amountUsdSource, "missing");
  assert.equal(first.dashboard.bank.recentEntries.find((entry) => entry.isPostClose)?.hasUsdAmount, false);
  assert.ok(first.dashboard.bank.recentEntries.filter((entry) => !entry.isPostClose).every((entry) => entry.hasUsdAmount));

  assert.equal(first.dashboard.platforms.find((item) => item.isTotal)?.profitMargin, 0.2);
  const acaGroup = first.dashboard.offerReconciliation.groups.find((group) => group.groupId === "offer-group:aca");
  assert.equal(acaGroup?.entries.length, 1, "the ACA reported subtotal must not be counted as another offer");
  assert.equal(acaGroup?.redtrackRevenue, 10);

  const publicJson = JSON.stringify(first.dashboard);
  assert.doesNotMatch(publicJson, /SECRET_REFERENCE|SECRET_USER|POST_CLOSE_REFERENCE|SECRET_CARD_USER/);
  assert.match(JSON.stringify(first.bankEntries), /SECRET_REFERENCE/);
  assert.match(JSON.stringify(first.sourceRows), /SECRET_CARD_USER/);
});

const realFixtureRoot = "/tmp/codex-finance-dash-management-report-20260721";
const realFixtureNames: Record<ManagementReportSheetKey, string> = {
  shareholders: "shareholders.csv",
  "vb-cp": "vb-cp.csv",
  "consolidated-bank": "consolidated-bank.csv",
  "vb-acp": "vb-acp.csv",
  "vb-wag": "vb-wag.csv",
  "wag-aff": "wag-aff.csv",
  "vb-rest": "vb-rest.csv",
  plp: "plp.csv"
};
const hasRealFixtures = managementReportSheetKeys.every((key) => existsSync(`${realFixtureRoot}/${realFixtureNames[key]}`));

test("real management-report snapshot reconciles across all eight sheets", { skip: !hasRealFixtures }, () => {
  const sheets = Object.fromEntries(managementReportSheetKeys.map((key) => [
    key,
    readFileSync(`${realFixtureRoot}/${realFixtureNames[key]}`, "utf8")
  ])) as Record<ManagementReportSheetKey, string>;
  const result = buildManagementReport(sheets, {
    importedAt: "2026-07-21T12:00:00.000Z",
    asOf: "2026-05-31",
    sourceLabel: "Local validation snapshot"
  });

  assert.equal(result.sourceRows.length, 5_808);
  assert.equal(result.dashboard.bank.totalEntryCount, 3_123);
  assert.equal(result.dashboard.bank.officialEntryCount, 3_109);
  assert.equal(result.dashboard.bank.postCloseEntryCount, 14);
  assert.equal(result.dashboard.bank.unconvertedEntryCount, 14);
  assert.equal(new Set(result.facts.map((fact) => fact.factId)).size, result.facts.length);
  assert.equal(result.dashboard.checks.filter((item) => item.severity === "error").length, 0);

  const byUnit = new Map(result.dashboard.businessUnits.map((unit) => [unit.id, unit]));
  assert.equal(byUnit.get("cognitive-pixel")?.actual.revenue, 7_549_793);
  assert.equal(byUnit.get("cognitive-pixel")?.actual.netProfit, 353_437);
  assert.equal(byUnit.get("wagner")?.actual.netProfit, 205_791);
  assert.equal(byUnit.get("acp")?.actual.netProfit, 26_403);
  assert.equal(byUnit.get("atlantic-ocean")?.actual.netProfit, 346);
  assert.equal(byUnit.get("affiliates")?.actual.netProfit, 5_049);
  const consolidatedUnits = result.dashboard.businessUnits.filter((unit) => unit.parentTeamId === undefined);
  assert.equal(result.dashboard.summary.revenue, consolidatedUnits.reduce((total, unit) => total + unit.actual.revenue, 0));
  assert.equal(result.dashboard.summary.netProfit, consolidatedUnits.reduce((total, unit) => total + unit.actual.netProfit, 0));
  assert.notEqual(
    result.dashboard.summary.revenue,
    result.dashboard.businessUnits.reduce((total, unit) => total + unit.actual.revenue, 0),
    "ACP is reported independently but must not inflate the consolidated total"
  );
  assert.equal(result.dashboard.ownership.totalEquityBalance, 2_140_718);

  const ytdPlatform = result.dashboard.platforms.find((item) => item.isTotal && /ytd/i.test(item.periodLabel));
  assert.equal(ytdPlatform?.revenue, 7_757_594);
  assert.equal(ytdPlatform?.profit, 1_273_897);
  assert.equal(ytdPlatform?.profitMargin, 0.16);
  assert.equal(result.dashboard.offerReconciliation.redtrackRevenue, 4_353_772.28);
  assert.equal(result.dashboard.offerReconciliation.dashboardRevenue, 4_307_059.66);
  assert.ok(result.dashboard.checks.some((item) => item.code === "bank-post-close-rows"));
  assert.ok(result.dashboard.checks.some((item) => item.code === "bank-unconverted-rows"));
});
