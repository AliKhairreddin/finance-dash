import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { config } from "dotenv";
import readXlsxFile, { type Sheet } from "read-excel-file/node";
import { saveManagementReportDashboard } from "../server/managementReportStore";
import { prepareManagementWorkbook } from "../shared/managementReportWorkbook";
import { storeManagementWorkbook } from "../shared/managementReportImport";

config({ path: resolve(process.cwd(), ".env.local"), quiet: true });

const googleSheetIdPattern = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/;
const maximumWorkbookBytes = 50 * 1024 * 1024;

interface CliOptions {
  source: string;
  uploadToConvex: boolean;
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

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const loaded = await loadWorkbook(options.source);
  const prepared = await prepareManagementWorkbook(loaded.sheets, loaded.sourceName, loaded.sourceUrl);
  await saveManagementReportDashboard({ dashboard: prepared.dashboard });
  process.stdout.write(`Prepared ${prepared.summaries.length} sheets, ${prepared.rows.length} source rows, ${prepared.facts.length} facts, and ${prepared.bankEntries.length} bank entries.\n`);
  if (options.uploadToConvex) {
    const convexUrl = process.env.CONVEX_URL?.trim();
    const importToken = process.env.MANAGEMENT_REPORT_IMPORT_TOKEN?.trim();
    if (!convexUrl) throw new Error("CONVEX_URL is required with --convex.");
    if (!importToken) throw new Error("MANAGEMENT_REPORT_IMPORT_TOKEN is required with --convex.");
    const result = await storeManagementWorkbook(new ConvexHttpClient(convexUrl), importToken, prepared);
    process.stdout.write(`${result.alreadyComplete ? "Convex already contains" : "Imported"} ${result.importId}.\n`);
  } else {
    process.stdout.write("Saved the sanitized dashboard snapshot to .local/management-report.json (Convex upload skipped).\n");
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
