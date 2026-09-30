import readXlsxFile from "read-excel-file/universal";
import {
  buildManagementReport, managementReportParserVersion, managementReportSheetKeys,
  type ManagementReportSheetKey
} from "./managementReport";

export const managementWorkbookMaximumBytes = 10 * 1024 * 1024;

// The reader returns Date instances even though its published cell type declares DateConstructor.
type WorkbookCell = string | number | boolean | Date | DateConstructor | null;
export interface ManagementWorkbookSheet {
  sheet: string;
  data: WorkbookCell[][];
}

interface ImportSheetSummary {
  key: string;
  label: string;
  rowCount: number;
  nonEmptyRowCount: number;
  visibility: "visible" | "hidden";
  role: "report" | "supporting";
}

interface StoredSourceRow {
  sheetKey: string;
  rowNumber: number;
  cells: string[];
}

function formatDate(value: Date): string {
  const day = String(value.getUTCDate()).padStart(2, "0");
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    [value.getUTCMonth()];
  return `${day}-${month}-${String(value.getUTCFullYear()).slice(-2)}`;
}

function serializeCell(value: WorkbookCell): string {
  if (value === null) return "";
  if (value instanceof Date) return formatDate(value);
  return String(value);
}

function trimTrailingEmpty(cells: string[]): string[] {
  let end = cells.length;
  while (end > 0 && cells[end - 1] === "") end -= 1;
  return cells.slice(0, end);
}

function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function sheetToCsv(sheet: ManagementWorkbookSheet): string {
  return sheet.data
    .map((row) => trimTrailingEmpty(row.map(serializeCell)).map(csvEscape).join(","))
    .join("\r\n");
}

function normalizedSheetName(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("&", "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const visibleSheetAliases: Record<ManagementReportSheetKey, string[]> = {
  shareholders: ["partners balance", "partner s balance"],
  "vb-consolidated": ["vb consolidated"],
  "vb-cp": ["1 vb cp"],
  "vb-wag": ["2 vb wag"],
  "vb-hcp": ["3 vb hcp"],
  "vb-rest": ["4 vb rest"],
  "vb-acp": ["5 vb acp"],
  plp: ["6 plp"],
  "wag-aff": ["b wag and aff"],
  "consolidated-bank": ["e consolidated bank"]
};

function visibleSheetKey(name: string): ManagementReportSheetKey | undefined {
  const normalized = normalizedSheetName(name);
  return managementReportSheetKeys.find((sheetKey) => visibleSheetAliases[sheetKey].includes(normalized));
}

function supportingSheetKey(name: string): string {
  const slug = normalizedSheetName(name).replaceAll(" ", "-") || "unnamed";
  return `support-${slug}`;
}

function workbookCsvBySheet(sheets: ManagementWorkbookSheet[]): Record<ManagementReportSheetKey, string> {
  const entries = managementReportSheetKeys.map((sheetKey) => {
    const sheet = sheets.find((candidate) => visibleSheetKey(candidate.sheet) === sheetKey);
    if (!sheet) return [sheetKey, ""] as const;
    return [sheetKey, sheetToCsv(sheet)] as const;
  });
  return Object.fromEntries(entries) as Record<ManagementReportSheetKey, string>;
}

function sourceRows(sheets: ManagementWorkbookSheet[]): StoredSourceRow[] {
  return sheets.flatMap((sheet) => {
    const key = visibleSheetKey(sheet.sheet) ?? supportingSheetKey(sheet.sheet);
    return sheet.data.flatMap((row, index) => {
      const cells = trimTrailingEmpty(row.map(serializeCell));
      return cells.some(Boolean) ? [{ sheetKey: key, rowNumber: index + 1, cells }] : [];
    });
  });
}

function sheetSummaries(sheets: ManagementWorkbookSheet[]): ImportSheetSummary[] {
  return sheets.map((sheet) => {
    const visibleKey = visibleSheetKey(sheet.sheet);
    return {
      key: visibleKey ?? supportingSheetKey(sheet.sheet),
      label: sheet.sheet,
      rowCount: sheet.data.length,
      nonEmptyRowCount: sheet.data.filter((row) => row.some((cell) => cell !== null && String(cell).trim() !== "")).length,
      visibility: visibleKey ? "visible" : "hidden",
      role: visibleKey ? "report" : "supporting"
    };
  });
}

async function contentHash(sheets: ManagementWorkbookSheet[]): Promise<string> {
  const parts: string[] = [];
  parts.push(`management-report-parser:${managementReportParserVersion}`);
  parts.push("\u001c");
  for (const sheet of sheets) {
    parts.push(sheet.sheet);
    parts.push("\u001e");
    for (const row of sheet.data) {
      for (const cell of trimTrailingEmpty(row.map(serializeCell))) {
        parts.push(cell);
        parts.push("\u001f");
      }
      parts.push("\u001d");
    }
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join("")));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}

export async function prepareManagementWorkbook(sheets: ManagementWorkbookSheet[], sourceName: string, sourceUrl?: string) {
  if (sheets.length === 0) throw new Error("The workbook has no sheets.");
  const hash = await contentHash(sheets);
  const importId = `management-${hash.slice(0, 24)}`;
  const importedAt = new Date().toISOString();
  const result = buildManagementReport(workbookCsvBySheet(sheets), {
    importId, importedAt, sourceLabel: "Management Report workbook", reportName: "Management Report"
  });
  if (result.dashboard.status === "invalid") {
    const failures = result.dashboard.checks.filter(check => check.severity === "error").slice(0, 5).map(check => check.message).join("; ");
    throw new Error(`The workbook failed management-report validation${failures ? `: ${failures}` : "."}`);
  }
  return {
    importId, hash, importedAt, sourceName, sourceUrl,
    reportingThrough: result.dashboard.metadata.asOf,
    summaries: sheetSummaries(sheets), rows: sourceRows(sheets),
    facts: result.facts, bankEntries: result.bankEntries, dashboard: result.dashboard
  };
}

export type PreparedManagementWorkbook = Awaited<ReturnType<typeof prepareManagementWorkbook>>;

export async function readManagementWorkbook(bytes: Uint8Array<ArrayBuffer>, fileName: string) {
  if (!fileName.toLowerCase().endsWith(".xlsx")) throw new Error("Choose a management report .xlsx workbook.");
  if (!bytes.length) throw new Error("The workbook is empty.");
  if (bytes.byteLength > managementWorkbookMaximumBytes) throw new Error("The workbook exceeds the 10 MB upload limit.");
  let sheets: ManagementWorkbookSheet[];
  try { sheets = await readXlsxFile(bytes.buffer); }
  catch { throw new Error("The file could not be read as an Excel .xlsx workbook."); }
  return prepareManagementWorkbook(sheets, fileName);
}
