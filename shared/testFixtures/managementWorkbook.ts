import type { Sheet } from "read-excel-file/universal";
import { zipSync, strToU8 } from "fflate";
import { parseManagementReportCsv } from "../managementReport";
import { syntheticManagementReportSheets } from "./managementReport";

const sheetNames = ["Partner's Balance", "VB - Consolidated", "1. VB - CP", "2. VB - WAG", "3. VB - HCP", "4. VB - REST", "5. VB - ACP", "6. PLP", "B. WAG & AFF", "E. Consolidated Bank"];

export function managementWorkbookSheets(): Sheet[] {
  const csv = syntheticManagementReportSheets();
  const keys = ["shareholders", "vb-consolidated", "vb-cp", "vb-wag", "vb-hcp", "vb-rest", "vb-acp", "plp", "wag-aff", "consolidated-bank"] as const;
  return keys.map((key, i) => ({ sheet: sheetNames[i], data: parseManagementReportCsv(csv[key]).map(row => row.cells) }));
}

export function managementWorkbookBytes(sheets = managementWorkbookSheets()): Uint8Array<ArrayBuffer> {
  const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
  const files: Record<string, Uint8Array> = {
    "xl/workbook.xml": strToU8(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, i) => `<sheet name="${escape(sheet.sheet)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`)
  };
  for (const [index, sheet] of sheets.entries()) {
    files[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheet.data.map((row, i) => `<row r="${i + 1}">${row.map((value, j) => {
      let column = "", n = j + 1;
      while (n > 0) { column = String.fromCharCode(65 + (n - 1) % 26) + column; n = Math.floor((n - 1) / 26); }
      return `<c r="${column}${i + 1}" t="inlineStr"><is><t>${escape(String(value ?? ""))}</t></is></c>`;
    }).join("")}</row>`).join("")}</sheetData></worksheet>`);
  }
  return new Uint8Array(zipSync(files));
}
