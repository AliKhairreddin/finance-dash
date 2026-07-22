import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { config } from "dotenv";
import readXlsxFile, { type CellValue, type Sheet } from "read-excel-file/node";
import { api } from "../convex/_generated/api";
import { saveManagementReportDashboard } from "../server/managementReportStore";
import {
  buildManagementReport,
  managementReportParserVersion,
  managementReportSheetKeys,
  type ManagementReportBankEntry,
  type ManagementReportFact,
  type ManagementReportImportMetadata,
  type ManagementReportSheetKey
} from "../shared/managementReport";

config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const googleSheetIdPattern = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/;
const batchSize = 75;
const maximumWorkbookBytes = 50 * 1024 * 1024;

interface CliOptions {
  source: string;
  uploadToConvex: boolean;
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

function usage(): never {
  throw new Error(
    "Usage: npm run import:management-report -- <Google Sheet URL|spreadsheet ID|local .xlsx> [--convex]"
  );
}

function parseArgs(argv: string[]): CliOptions {
  const unknownFlags = argv.filter((argument) => argument.startsWith("--") && argument !== "--convex");
  if (unknownFlags.length > 0) throw new Error(`Unknown option${unknownFlags.length === 1 ? "" : "s"}: ${unknownFlags.join(", ")}`);
  const uploadToConvex = argv.includes("--convex");
  const positional = argv.filter((argument) => !argument.startsWith("--"));
  if (positional.length !== 1) return usage();
  return { source: positional[0], uploadToConvex };
}

function googleSheetId(source: string): string | undefined {
  const fromUrl = source.match(googleSheetIdPattern)?.[1];
  if (fromUrl) return fromUrl;
  return /^[a-zA-Z0-9_-]{20,}$/.test(source) ? source : undefined;
}

async function downloadRequired(url: string): Promise<Buffer> {
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Could not download ${url}: ${response.status} ${response.statusText}`);
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("text/html")) {
    throw new Error(`Google returned an HTML page instead of workbook data for ${url}; check sharing access.`);
  }
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > maximumWorkbookBytes) throw new Error("The workbook export exceeds the 50 MB import limit.");
  if (!response.body) throw new Error("The workbook export returned no data.");

  const chunks: Uint8Array[] = [];
  const reader = response.body.getReader();
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maximumWorkbookBytes) {
      await reader.cancel();
      throw new Error("The workbook export exceeds the 50 MB import limit.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, received);
}

async function loadWorkbook(source: string): Promise<{
  sheets: Sheet[];
  sourceName: string;
  sourceUrl?: string;
}> {
  const spreadsheetId = googleSheetId(source);
  if (!spreadsheetId) {
    const path = resolve(process.cwd(), source);
    const file = await stat(path);
    if (file.size > maximumWorkbookBytes) throw new Error("The workbook exceeds the 50 MB import limit.");
    const workbook = await readFile(path);
    return { sheets: await readXlsxFile(workbook), sourceName: basename(path) };
  }

  const sourceUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`;
  const workbook = await downloadRequired(
    `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=xlsx`
  );
  return {
    sheets: await readXlsxFile(workbook),
    sourceName: "Management Report Google Sheet",
    sourceUrl
  };
}

function formatDate(value: Date): string {
  const day = String(value.getUTCDate()).padStart(2, "0");
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    [value.getUTCMonth()];
  return `${day}-${month}-${String(value.getUTCFullYear()).slice(-2)}`;
}

function serializeCell(value: CellValue | null): string {
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

function sheetToCsv(sheet: Sheet): string {
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
  shareholders: ["1 shareholders fund", "1 shareholder s fund"],
  "vb-cp": ["2 vb cp"],
  "consolidated-bank": ["c consolidated bank"],
  "vb-acp": ["5 vb acp"],
  "vb-wag": ["3 vb wag"],
  "wag-aff": ["b wag and aff"],
  "vb-rest": ["4 vb rest"],
  plp: ["6 plp"]
};

function visibleSheetKey(name: string): ManagementReportSheetKey | undefined {
  const normalized = normalizedSheetName(name);
  return managementReportSheetKeys.find((sheetKey) => visibleSheetAliases[sheetKey].includes(normalized));
}

function supportingSheetKey(name: string): string {
  const slug = normalizedSheetName(name).replaceAll(" ", "-") || "unnamed";
  return `support-${slug}`;
}

function workbookCsvBySheet(sheets: Sheet[]): Record<ManagementReportSheetKey, string> {
  const entries = managementReportSheetKeys.map((sheetKey) => {
    const sheet = sheets.find((candidate) => visibleSheetKey(candidate.sheet) === sheetKey);
    if (!sheet) return [sheetKey, ""] as const;
    return [sheetKey, sheetToCsv(sheet)] as const;
  });
  return Object.fromEntries(entries) as Record<ManagementReportSheetKey, string>;
}

function sourceRows(sheets: Sheet[]): StoredSourceRow[] {
  return sheets.flatMap((sheet) => {
    const key = visibleSheetKey(sheet.sheet) ?? supportingSheetKey(sheet.sheet);
    return sheet.data.flatMap((row, index) => {
      const cells = trimTrailingEmpty(row.map(serializeCell));
      return cells.some(Boolean) ? [{ sheetKey: key, rowNumber: index + 1, cells }] : [];
    });
  });
}

function sheetSummaries(sheets: Sheet[]): ImportSheetSummary[] {
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

function contentHash(sheets: Sheet[]): string {
  const hash = createHash("sha256");
  hash.update(`management-report-parser:${managementReportParserVersion}`);
  hash.update("\u001c");
  for (const sheet of sheets) {
    hash.update(sheet.sheet);
    hash.update("\u001e");
    for (const row of sheet.data) {
      for (const cell of trimTrailingEmpty(row.map(serializeCell))) {
        hash.update(cell);
        hash.update("\u001f");
      }
      hash.update("\u001d");
    }
  }
  return hash.digest("hex");
}

function chunks<T>(values: T[]): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += batchSize) result.push(values.slice(index, index + batchSize));
  return result;
}

function storedFact(fact: ManagementReportFact) {
  return { ...fact, valueDecimal: String(fact.value) };
}

function storedBankEntry(entry: ManagementReportBankEntry) {
  return {
    entryId: entry.entryId,
    date: entry.date,
    bankName: entry.bankName,
    segment: entry.segment,
    amountUsd: entry.amountUsd,
    amountUsdDecimal: String(entry.amountUsd),
    sourceRow: entry.sourceRow,
    payload: entry
  };
}

async function uploadImport(args: {
  importId: string;
  hash: string;
  sourceName: string;
  sourceUrl?: string;
  importedAt: string;
  reportingThrough: string;
  summaries: ImportSheetSummary[];
  rows: StoredSourceRow[];
  facts: ManagementReportFact[];
  bankEntries: ManagementReportBankEntry[];
  dashboard: unknown;
}): Promise<void> {
  const convexUrl = process.env.CONVEX_URL?.trim();
  const importToken = process.env.MANAGEMENT_REPORT_IMPORT_TOKEN?.trim();
  if (!convexUrl) throw new Error("CONVEX_URL is required with --convex.");
  if (!importToken) throw new Error("MANAGEMENT_REPORT_IMPORT_TOKEN is required with --convex.");
  const convex = new ConvexHttpClient(convexUrl);
  const attemptId = randomUUID();
  const begun = await convex.mutation(api.managementReport.beginImport, {
    importToken,
    importId: args.importId,
    contentHash: args.hash,
    parserVersion: managementReportParserVersion,
    attemptId,
    sourceName: args.sourceName,
    sourceUrl: args.sourceUrl,
    reportingThrough: args.reportingThrough,
    importedAt: args.importedAt,
    sheetSummaries: args.summaries
  });
  if (begun.alreadyComplete) {
    process.stdout.write(`Convex already contains this workbook snapshot as ${begun.importId}.\n`);
    return;
  }

  try {
    while (true) {
      const cleanup = await convex.mutation(api.managementReport.cleanupImportBatch, {
        importToken,
        importId: begun.importId,
        attemptId,
        batchSize: 100
      });
      if (!cleanup.hasMore) break;
    }
    for (const rows of chunks(args.rows)) {
      await convex.mutation(api.managementReport.insertSourceRows, {
        importToken,
        importId: begun.importId,
        attemptId,
        rows
      });
    }
    for (const facts of chunks(args.facts.map(storedFact))) {
      await convex.mutation(api.managementReport.insertFacts, {
        importToken,
        importId: begun.importId,
        attemptId,
        facts
      });
    }
    for (const entries of chunks(args.bankEntries.map(storedBankEntry))) {
      await convex.mutation(api.managementReport.insertBankEntries, {
        importToken,
        importId: begun.importId,
        attemptId,
        entries
      });
    }
    await convex.mutation(api.managementReport.completeImport, {
      importToken,
      importId: begun.importId,
      attemptId,
      sourceRowCount: args.rows.length,
      bankEntryCount: args.bankEntries.length,
      factCount: args.facts.length,
      dashboard: args.dashboard
    });
  } catch (error) {
    await convex.mutation(api.managementReport.failImport, {
      importToken,
      importId: begun.importId,
      attemptId,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const loaded = await loadWorkbook(options.source);
  if (loaded.sheets.length === 0) throw new Error("The workbook has no sheets.");
  const hash = contentHash(loaded.sheets);
  const importId = `management-${hash.slice(0, 24)}`;
  const importedAt = new Date().toISOString();
  const metadata: ManagementReportImportMetadata = {
    importId,
    importedAt,
    sourceLabel: "Management Report workbook",
    reportName: "Management Report"
  };
  const csvBySheet = workbookCsvBySheet(loaded.sheets);
  const result = buildManagementReport(csvBySheet, metadata);
  if (result.dashboard.status === "invalid") {
    const failures = result.dashboard.checks
      .filter((check) => check.severity === "error")
      .slice(0, 5)
      .map((check) => check.message)
      .join("; ");
    throw new Error(`The workbook failed management-report validation${failures ? `: ${failures}` : "."}`);
  }
  const rows = sourceRows(loaded.sheets);
  const summaries = sheetSummaries(loaded.sheets);
  const envelope = { dashboard: result.dashboard };

  await saveManagementReportDashboard(envelope);
  process.stdout.write(
    `Prepared ${summaries.length} sheets, ${rows.length} source rows, ${result.facts.length} facts, and ${result.bankEntries.length} bank entries.\n`
  );
  if (options.uploadToConvex) {
    await uploadImport({
      importId,
      hash,
      sourceName: loaded.sourceName,
      sourceUrl: loaded.sourceUrl,
      importedAt,
      reportingThrough: result.dashboard.metadata.asOf,
      summaries,
      rows,
      facts: result.facts,
      bankEntries: result.bankEntries,
      dashboard: result.dashboard
    });
    process.stdout.write(`Imported ${importId} into Convex.\n`);
  } else {
    process.stdout.write("Saved the sanitized dashboard snapshot to .local/management-report.json (Convex upload skipped).\n");
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
