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
