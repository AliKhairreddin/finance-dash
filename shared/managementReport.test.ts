import assert from "node:assert/strict";
import test from "node:test";
import { syntheticManagementReportSheets } from "./testFixtures/managementReport";

import {
  buildManagementReport,
  managementReportParserVersion,
  parseManagementReportCsv
} from "./managementReport";

test("RFC4180 parsing preserves embedded data and physical line spans", () => {
  const records = parseManagementReportCsv('a,b,c\r\n1,"hello, ""world""","line 1\r\nline 2"\r\n');
  assert.equal(records.length, 2);
  assert.deepEqual(records[1]?.cells, ["1", 'hello, "world"', "line 1\nline 2"]);
  assert.deepEqual([records[1]?.lineStart, records[1]?.lineEnd], [2, 3]);
  assert.throws(() => parseManagementReportCsv('a,"closed"x\n'), /Unexpected character after closing quote/);
  assert.throws(() => parseManagementReportCsv('a,"never closed'), /Unclosed quoted field/);
});

test("normalized report build is deterministic, period-safe, and redacts bank lineage", () => {
  const sheets = syntheticManagementReportSheets();
  const metadata = { importedAt: "2026-07-21T12:00:00.000Z", asOf: "2026-05-31" };
  const first = buildManagementReport(sheets, metadata);
  const second = buildManagementReport(sheets, metadata);

  assert.equal(managementReportParserVersion, "4");
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

  assert.equal(first.dashboard.summary.revenue, 390, "the consolidated workbook tab is authoritative for headline totals");
  assert.equal(first.dashboard.consolidated.actual.netProfit, 89);
  assert.equal(first.dashboard.businessUnits.find((unit) => unit.id === "acp")?.actual.revenue, 30);
  const hcp = first.dashboard.businessUnits.find((unit) => unit.id === "hcp");
  assert.equal(hcp?.kind, "offer");
  assert.equal(hcp?.actual.netProfit, 1);
  assert.equal(first.dashboard.trend.find((point) => point.period === "2026-05-31")?.revenue, 390);
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
  assert.doesNotMatch(publicJson, /sourceRowId/);
  assert.match(JSON.stringify(first.bankEntries), /SECRET_REFERENCE/);
  assert.match(JSON.stringify(first.sourceRows), /SECRET_CARD_USER/);
});
