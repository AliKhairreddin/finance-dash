import assert from "node:assert/strict";
import test from "node:test";
import { readManagementWorkbook, prepareManagementWorkbook } from "./managementReportWorkbook";
import { managementWorkbookBytes, managementWorkbookSheets } from "./testFixtures/managementWorkbook";

test("Excel upload produces the same validated snapshot and content identity as the CLI", async () => {
  const sheets = managementWorkbookSheets();
  const direct = await prepareManagementWorkbook(sheets, "report.xlsx");
  const uploaded = await readManagementWorkbook(managementWorkbookBytes(sheets), "renamed-report.xlsx");
  assert.equal(uploaded.hash, direct.hash);
  assert.equal(uploaded.importId, direct.importId);
  assert.deepEqual(uploaded.dashboard.summary, direct.dashboard.summary);
  assert.deepEqual(uploaded.rows, direct.rows);
  assert.deepEqual(uploaded.facts, direct.facts);
  assert.deepEqual(uploaded.bankEntries, direct.bankEntries);
  assert.equal(uploaded.reportingThrough, "2026-05-31");
  assert.notEqual(uploaded.dashboard.status, "invalid");
});

test("supporting workbook sheets retain source rows without becoming report columns", async () => {
  const sheets = [...managementWorkbookSheets(), { sheet: "Internal notes", data: [[new Date("2026-05-31T00:00:00Z"), "note", null]] }];
  const prepared = await prepareManagementWorkbook(sheets, "report.xlsx");
  assert.deepEqual(prepared.rows.at(-1), { sheetKey: "support-internal-notes", rowNumber: 1, cells: ["31-May-26", "note"] });
  assert.equal(prepared.summaries.at(-1)?.role, "supporting");
});

test("invalid or unrelated uploads are rejected before a report can be saved", async () => {
  await assert.rejects(readManagementWorkbook(new Uint8Array([1]), "report.pdf"), /\.xlsx/);
  await assert.rejects(readManagementWorkbook(new Uint8Array(), "report.xlsx"), /empty/);
  await assert.rejects(readManagementWorkbook(new Uint8Array(10 * 1024 * 1024 + 1), "report.xlsx"), /10 MB/);
  await assert.rejects(readManagementWorkbook(new Uint8Array([1, 2]), "report.xlsx"), /could not be read/);
  await assert.rejects(readManagementWorkbook(managementWorkbookBytes([{ sheet: "Unrelated", data: [["hello"]] }]), "report.xlsx"), /Consolidated is required/);
});

test("renumbered tabs, additional business units and dated partner subtotals are read from the workbook", async () => {
  const sheets = managementWorkbookSheets();
  const company = sheets.find(s => s.sheet === "VB - Consolidated")!;
  company.sheet = "VB - Consol";
  const acp = sheets.find(s => s.sheet === "5. VB - ACP")!;
  acp.sheet = "3. VB - ACP";
  sheets.push({ sheet: "5. VB - Data Grande", data: acp.data });
  const equity = sheets[0].data;
  const i = equity.findIndex(row => row[1] === "- Amin");
  equity.splice(i, 1, ["", "Amin:"], ["", " - Profit", 250], ["", "- Withdrawal (till 10 Jun 26)", -50, 200]);
  const report = await prepareManagementWorkbook(sheets, "updated.xlsx");
  const amin = report.dashboard.ownership.balances.find(row => row.canonicalName === "Amin");
  assert.equal(amin?.balance, 200);
  assert.equal(amin?.balanceAsOf, "2026-06-10");
  assert.equal(report.dashboard.businessUnits.find(unit => unit.id === "data-grande")?.actual.netProfit, 8);
  equity[i + 2][3] = null;
  await assert.rejects(prepareManagementWorkbook(sheets, "incomplete.xlsx"), /Missing reported balance for Amin/);
});
