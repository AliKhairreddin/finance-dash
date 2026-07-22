export const managementReportSheetKeys = [
  "shareholders",
  "vb-cp",
  "consolidated-bank",
  "vb-acp",
  "vb-wag",
  "wag-aff",
  "vb-rest",
  "plp"
] as const;

/** Increment whenever normalized import semantics change. */
export const managementReportParserVersion = "2" as const;

export type ManagementReportSheetKey = (typeof managementReportSheetKeys)[number];

export interface ManagementReportSheetDefinition {
  key: ManagementReportSheetKey;
  title: string;
  gid: string;
  kind: "ownership" | "business-performance" | "bank-ledger" | "offer-reconciliation" | "platform-profitability";
}

export const managementReportSheetDefinitions: Record<ManagementReportSheetKey, ManagementReportSheetDefinition> = {
  shareholders: { key: "shareholders", title: "1. Shareholder's Fund", gid: "1247494965", kind: "ownership" },
  "vb-cp": { key: "vb-cp", title: "2. VB - CP", gid: "1514461595", kind: "business-performance" },
  "consolidated-bank": { key: "consolidated-bank", title: "C. Consolidated Bank", gid: "739792447", kind: "bank-ledger" },
  "vb-acp": { key: "vb-acp", title: "5. VB - ACP", gid: "1819366902", kind: "business-performance" },
  "vb-wag": { key: "vb-wag", title: "3. VB - Wag", gid: "215542753", kind: "business-performance" },
  "wag-aff": { key: "wag-aff", title: "B. Wag & Aff", gid: "681261509", kind: "offer-reconciliation" },
  "vb-rest": { key: "vb-rest", title: "4. VB - Rest", gid: "123277687", kind: "business-performance" },
  plp: { key: "plp", title: "6. PLP", gid: "763974701", kind: "platform-profitability" }
};

export interface ManagementReportImportMetadata {
  importedAt: string;
  sourceLabel?: string;
  reportName?: string;
  importId?: string;
  asOf?: string;
}

export interface ManagementReportCsvRecord {
  recordNumber: number;
  lineStart: number;
  lineEnd: number;
  cells: string[];
}

export interface ManagementReportSourceRow extends ManagementReportCsvRecord {
  sourceRowId: string;
  sheetKey: ManagementReportSheetKey;
}

export type ManagementReportCheckSeverity = "info" | "warning" | "error";

export interface ManagementReportCheck {
  code: string;
  severity: ManagementReportCheckSeverity;
  message: string;
  sheetKey?: ManagementReportSheetKey;
  sourceRow?: number;
  actual?: number | string;
  expected?: number | string;
}

export interface ManagementReportSheetSummary {
  key: ManagementReportSheetKey;
  title: string;
  gid: string;
  status: "ready" | "ready-with-warnings" | "missing" | "invalid";
  logicalRowCount: number;
  nonEmptyRowCount: number;
  parsedRecordCount: number;
  latestDate?: string;
  checks: ManagementReportCheck[];
}

export type ManagementReportFactUnit = "currency" | "percent" | "count" | "rate" | "number";

export interface ManagementReportFact {
  factId: string;
  scope: string;
  scopeId: string;
  metric: string;
  period: string;
  value: number;
  unit: ManagementReportFactUnit;
  currency?: string;
  scenario?: string;
  section?: string;
  dimension?: string;
  sourceSheet: ManagementReportSheetKey;
  sourceRow: number;
  payload?: Record<string, unknown>;
}

export interface ManagementReportBankEntry {
  entryId: string;
  date: string;
  companyName: string;
  bankName: string;
  serviceMonth?: string;
  month?: string;
  reference?: string;
  userName?: string;
  balanceSheetOrProfitLoss?: string;
  accountType: string;
  nature: string;
  segment: string;
  currency: string;
  amountIncludingVat: number;
  rateToUsd?: number;
  amountUsd: number;
  amountUsdSource: "sheet" | "computed" | "missing";
  comment?: string;
  reconciliation?: string;
  isPostClose: boolean;
  isIncludedInOfficialPeriod: boolean;
  sourceSheet: "consolidated-bank";
  sourceRow: number;
  sourceRowId: string;
}

export interface ManagementReportRecentBankEntry {
  entryId: string;
  date: string;
  companyName: string;
  bankName: string;
  segment: string;
  nature: string;
  accountType: string;
  currency: string;
  amountIncludingVat: number;
  amountUsd: number;
  hasUsdAmount: boolean;
  isPostClose: boolean;
}

export interface ManagementReportBankAggregate {
  id: string;
  dimension: "bank" | "segment" | "month" | "account-type" | "nature" | "currency";
  key: string;
  label: string;
  entryCount: number;
  incomeUsd: number;
  expenseUsd: number;
  netUsd: number;
  unconvertedCount: number;
  postCloseCount: number;
}

export interface ManagementReportBusinessColumn {
  key: string;
  label: string;
  kind: "budget" | "revised-budget" | "month" | "quarter" | "annual" | "ytd" | "performance" | "run-rate" | "sales-rate" | "other";
  period?: string;
  sourceColumn: number;
}

export interface ManagementReportBusinessLine {
  lineId: string;
  label: string;
  base?: string;
  section: string;
  subsection?: string;
  metric?: string;
  values: Record<string, number>;
  percentages: Record<string, number>;
  isSubtotal: boolean;
  isRatio: boolean;
  sourceSheet: ManagementReportSheetKey;
  sourceRow: number;
}

export interface ManagementReportBusinessActual {
  revenue: number;
  marketingSpend: number;
  grossProfit: number;
  grossMargin: number;
  operatingSpend: number;
  ebitda?: number;
  netProfit: number;
  netMargin: number;
}

export interface ManagementReportBusinessSummary extends ManagementReportBusinessActual {
  budgetRevenue?: number;
  revisedBudgetRevenue?: number;
  budgetNetProfit?: number;
  revisedBudgetNetProfit?: number;
  netAfterWithdrawals?: number;
}

export interface ManagementReportBusinessMonth {
  period: string;
  label: string;
  revenue: number;
  marketingSpend: number;
  operatingSpend: number;
  grossProfit: number;
  netProfit: number;
}

export interface ManagementReportBusinessUnit {
  id: string;
  name: string;
  kind: "team" | "offer" | "affiliate";
  parentTeamId?: string;
  active: boolean;
  sourceSheet: ManagementReportSheetKey;
  reportLabel: string;
  currency: "USD";
  latestPeriod: string;
  latestPeriodLabel: string;
  columns: ManagementReportBusinessColumn[];
  lines: ManagementReportBusinessLine[];
  actual: ManagementReportBusinessActual;
  summary: ManagementReportBusinessSummary;
  monthly: ManagementReportBusinessMonth[];
}

export interface ManagementReportShareholderBalance {
  id: string;
  name: string;
  canonicalName: string;
  balance: number;
  profitBalance?: number;
  profitWithdrawals?: number;
  currency: "USD";
  sourceRow: number;
}

export interface ManagementReportAssetLiabilityLine {
  lineId: string;
  section: "equity" | "assets-liabilities";
  label: string;
  amount?: number;
  secondaryAmount?: number;
  isTotal: boolean;
  sourceRow: number;
}

export interface ManagementReportProfitAllocation {
  allocationId: string;
  label: string;
  total: number;
  byShareholder: Record<string, number>;
  sourceRow: number;
}

export interface ManagementReportOwnership {
  currency: "USD";
  reportLabel: string;
  totalPartnerBalance: number;
  totalEquityBalance: number;
  totalAssetsAndLiabilities: number;
  balances: ManagementReportShareholderBalance[];
  assetsLiabilities: ManagementReportAssetLiabilityLine[];
  profitAllocations: ManagementReportProfitAllocation[];
}

export interface ManagementReportPlatformPerformance {
  platformMetricId: string;
  period: string;
  periodLabel: string;
  platform: string;
  revenue: number;
  spend: number;
  profit: number;
  profitMargin: number;
  leads: number;
  cpl: number;
  isTotal: boolean;
  sourceRow: number;
}

export interface ManagementReportOfferReconciliationEntry {
  offerId: string;
  groupId: string;
  groupName: string;
  businessUnitId: string;
  offerName: string;
  redtrackSource?: string;
  redtrackRevenue: number;
  dashboardSource?: string;
  dashboardRevenue: number;
  variance: number;
  sourceRow: number;
}

export interface ManagementReportOfferReconciliationGroup {
  groupId: string;
  name: string;
  businessUnitId: string;
  redtrackRevenue: number;
  dashboardRevenue: number;
  variance: number;
  entries: ManagementReportOfferReconciliationEntry[];
  sourceRow: number;
}

export interface ManagementReportReconciliationMetric {
  metric: string;
  ourDashboard: number;
  theirDashboard: number;
  variance: number;
  byBusinessUnit: Record<string, number>;
  sourceRow: number;
}

export interface ManagementReportOfferReconciliation {
  reportLabel: string;
  managerSpendSource: number;
  managerSpendDashboard: number;
  managerSpendVariance: number;
  redtrackRevenue: number;
  dashboardRevenue: number;
  variance: number;
  groups: ManagementReportOfferReconciliationGroup[];
  finalCalculation: ManagementReportReconciliationMetric[];
}

export interface ManagementReportKpi {
  id: string;
  label: string;
  value: number;
  unit: "currency" | "percent" | "count";
  currency?: "USD";
  tone?: "neutral" | "positive" | "negative" | "warning";
  detail?: string;
}

export interface ManagementReportSummary {
  currency: "USD";
  revenue: number;
  marketingSpend: number;
  operatingSpend: number;
  grossProfit: number;
  netProfit: number;
  netMargin: number;
  shareholderEquity: number;
  platformRevenue: number;
  platformSpend: number;
  platformProfit: number;
  bankIncome: number;
  bankExpense: number;
  bankNet: number;
  offerRevenue: number;
  offerVariance: number;
}

export interface ManagementReportTrendPoint {
  period: string;
  label: string;
  revenue: number;
  marketingSpend: number;
  operatingSpend: number;
  grossProfit: number;
  netProfit: number;
}

export interface ManagementReportDashboard {
  metadata: {
    importId: string;
    importedAt: string;
    sourceLabel: string;
    reportName: string;
    asOf: string;
    officialBankThrough: string;
  };
  status: "ready" | "ready-with-warnings" | "invalid";
  sheetSummaries: ManagementReportSheetSummary[];
  checks: ManagementReportCheck[];
  kpis: ManagementReportKpi[];
  summary: ManagementReportSummary;
  trend: ManagementReportTrendPoint[];
  businessUnits: ManagementReportBusinessUnit[];
  ownership: ManagementReportOwnership;
  platforms: ManagementReportPlatformPerformance[];
  offers: ManagementReportOfferReconciliationEntry[];
  offerReconciliation: ManagementReportOfferReconciliation;
  bank: {
    officialThrough: string;
    totalEntryCount: number;
    officialEntryCount: number;
    postCloseEntryCount: number;
    unconvertedEntryCount: number;
    aggregates: ManagementReportBankAggregate[];
    recentEntries: ManagementReportRecentBankEntry[];
  };
}

export interface ManagementReportBuildResult {
  dashboard: ManagementReportDashboard;
  facts: ManagementReportFact[];
  bankEntries: ManagementReportBankEntry[];
  sourceRows: ManagementReportSourceRow[];
}

export class ManagementReportCsvError extends Error {
  constructor(
    message: string,
    readonly line: number,
    readonly column: number
  ) {
    super(`${message} at line ${line}, column ${column}`);
    this.name = "ManagementReportCsvError";
  }
}

/** RFC4180 parser that preserves logical record numbers and physical line spans. */
export function parseManagementReportCsv(text: string): ManagementReportCsvRecord[] {
  const input = text.startsWith("\ufeff") ? text.slice(1) : text;
  const records: ManagementReportCsvRecord[] = [];
  let row: string[] = [];
  let field = "";
  let line = 1;
  let column = 1;
  let lineStart = 1;
  let inQuotes = false;
  let afterQuote = false;
  let touched = false;

  const finishField = () => {
    row.push(field);
    field = "";
    afterQuote = false;
  };
  const finishRecord = (lineEnd: number) => {
    finishField();
    records.push({
      recordNumber: records.length + 1,
      lineStart,
      lineEnd,
      cells: row
    });
    row = [];
    touched = false;
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];

    if (inQuotes) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
          column += 2;
          touched = true;
          continue;
        }
        inQuotes = false;
        afterQuote = true;
        column += 1;
        continue;
      }
      if (character === "\r" || character === "\n") {
        if (character === "\r" && input[index + 1] === "\n") index += 1;
        field += "\n";
        line += 1;
        column = 1;
        touched = true;
        continue;
      }
      field += character;
      column += 1;
      touched = true;
      continue;
    }

    if (afterQuote) {
      if (character === ",") {
        finishField();
        touched = true;
        column += 1;
        continue;
      }
      if (character === "\r" || character === "\n") {
        finishRecord(line);
        if (character === "\r" && input[index + 1] === "\n") index += 1;
        line += 1;
        column = 1;
        lineStart = line;
        continue;
      }
      if (character === " " || character === "\t") {
        column += 1;
        continue;
      }
      throw new ManagementReportCsvError("Unexpected character after closing quote", line, column);
    }

    if (character === '"') {
      if (field.length > 0) throw new ManagementReportCsvError("Quote inside an unquoted field", line, column);
      inQuotes = true;
      touched = true;
      column += 1;
      continue;
    }
    if (character === ",") {
      finishField();
      touched = true;
      column += 1;
      continue;
    }
    if (character === "\r" || character === "\n") {
      finishRecord(line);
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      line += 1;
      column = 1;
      lineStart = line;
      continue;
    }
    field += character;
    touched = true;
    column += 1;
  }

  if (inQuotes) throw new ManagementReportCsvError("Unclosed quoted field", line, column);
  if (touched || row.length > 0 || field.length > 0) finishRecord(line);
  return records;
}

function normalizedText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function normalizedKey(value: string): string {
  return normalizedText(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown";
}

function atlanticOceanDisplayLabel(value: string | undefined): string {
  return normalizedText(value).replace(/\b(?:altan|atlan)(?:ic|tic)?\s+ocean\b/gi, "Atlantic Ocean");
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, "0");
}

function sourceRowId(sheetKey: ManagementReportSheetKey, record: ManagementReportCsvRecord): string {
  return `management-report:${sheetKey}:row-${record.recordNumber}:${stableHash(record.cells.join("\u001f"))}`;
}

function factId(parts: Array<string | number>): string {
  const value = parts.join("\u001f");
  return `management-report-fact:${stableHash(value)}:${normalizedKey(String(parts[1] ?? "fact"))}`;
}

function isNonEmptyRecord(record: ManagementReportCsvRecord): boolean {
  return record.cells.some((cell) => normalizedText(cell).length > 0);
}

function numberFromCell(value: string | undefined): number | undefined {
  const raw = normalizedText(value);
  if (!raw) return undefined;
  if (/^[\$€£]?\s*-\s*$/.test(raw)) return 0;
  const parenthesized = /^\(.*\)$/.test(raw);
  const numeric = raw
    .replace(/[()]/g, "")
    .replace(/[$€£,%]/g, "")
    .replace(/,/g, "")
    .replace(/\s+/g, "")
    .replace(/[^0-9.+-]/g, "");
  if (!numeric || numeric === "+" || numeric === "-") return undefined;
  const parsed = Number(numeric);
  if (!Number.isFinite(parsed)) return undefined;
  return parenthesized ? -Math.abs(parsed) : parsed;
}

function percentageFromCell(value: string | undefined, acceptRawDecimal = false): number | undefined {
  const raw = normalizedText(value);
  if (!raw.endsWith("%") && !acceptRawDecimal) return undefined;
  const parsed = numberFromCell(raw);
  if (parsed === undefined) return undefined;
  return raw.endsWith("%") ? parsed / 100 : parsed;
}

const monthByShortName: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12
};

function isoDateFromCell(value: string | undefined): string | undefined {
  const raw = normalizedText(value);
  const match = raw.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2}|\d{4})$/);
  if (!match) return undefined;
  const day = Number(match[1]);
  const month = monthByShortName[match[2].toLowerCase()];
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  if (!month || day < 1 || day > 31) return undefined;
  const result = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const date = new Date(`${result}T00:00:00Z`);
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day ? result : undefined;
}

function monthEnd(year: number, month: number): string {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function periodFromLabel(value: string | undefined): string | undefined {
  const raw = normalizedText(value);
  const date = isoDateFromCell(raw);
  if (date) return date;
  const monthYear = raw.match(/(?:ytd\s+)?([A-Za-z]{3,9})\s+(\d{4})/i);
  if (monthYear) {
    const month = monthByShortName[monthYear[1].slice(0, 3).toLowerCase()];
    if (month) return monthEnd(Number(monthYear[2]), month);
  }
  const year = raw.match(/^\d{4}$/)?.[0];
  return year ? `${year}-12-31` : undefined;
}

function rounded(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function sum(values: Array<number | undefined>): number {
  return rounded(values.reduce<number>((total, value) => total + (value ?? 0), 0));
}

function rowCell(record: ManagementReportCsvRecord, index: number): string {
  return record.cells[index] ?? "";
}

function check(
  sheetKey: ManagementReportSheetKey,
  code: string,
  severity: ManagementReportCheckSeverity,
  message: string,
  extra: Partial<ManagementReportCheck> = {}
): ManagementReportCheck {
  return { sheetKey, code, severity, message, ...extra };
}

interface BusinessParseResult {
  units: ManagementReportBusinessUnit[];
  checks: ManagementReportCheck[];
  parsedRecordCount: number;
}

function businessColumnKind(label: string): ManagementReportBusinessColumn["kind"] {
  const normalized = normalizedText(label).toLowerCase();
  if (normalized.includes("revised budget")) return "revised-budget";
  if (normalized.includes("budget")) return "budget";
  if (normalized.includes("actual") && normalized.includes("quarter")) return "quarter";
  if (normalized.includes("ytd")) return "ytd";
  if (normalized.includes("performance")) return "performance";
  if (normalized.includes("run rate")) return "run-rate";
  if (normalized.includes("sales rate")) return "sales-rate";
  if (isoDateFromCell(normalized)) return "month";
  if (/^\d{4}$/.test(normalized)) return "annual";
  return "other";
}

function businessColumns(header: ManagementReportCsvRecord): ManagementReportBusinessColumn[] {
  const counts = new Map<string, number>();
  const columns: ManagementReportBusinessColumn[] = [];
  for (let index = 3; index < header.cells.length; index += 1) {
    const label = normalizedText(header.cells[index]);
    if (!label) continue;
    const baseKey = normalizedKey(label);
    const count = (counts.get(baseKey) ?? 0) + 1;
    counts.set(baseKey, count);
    const kind = businessColumnKind(label);
    columns.push({
      key: count === 1 ? baseKey : `${baseKey}-${count}`,
      label,
      kind,
      period: periodFromLabel(label),
      sourceColumn: index + 1
    });
  }
  return columns;
}

function standardizedBusinessMetric(label: string): string | undefined {
  const normalized = normalizedText(label).toLowerCase().replace(/\s+/g, " ");
  const ratio = normalized.includes("(%)");
  if (normalized.startsWith("total advertising revenue")) return ratio ? "revenue-margin" : "revenue";
  if (normalized.startsWith("total marketing spend")) return ratio ? "marketing-spend-margin" : "marketing-spend";
  if (normalized === "gross profit" || normalized === "gross profit (%)") return ratio ? "gross-margin" : "gross-profit";
  if (normalized === "total spend") return "operating-spend";
  if (normalized === "ebitda" || normalized === "ebitda (%)") return ratio ? "ebitda-margin" : "ebitda";
  if (normalized === "net profit" || normalized === "net profit (%)") return ratio ? "net-margin" : "net-profit";
  if (normalized === "net margin" || normalized === "net margin (%)") return ratio ? "net-margin" : "net-profit";
  if (normalized === "net" || normalized === "net (%)") return ratio ? "net-after-withdrawals-margin" : "net-after-withdrawals";
  return undefined;
}

function businessSectionHeading(label: string): { section: string; subsection?: string } | undefined {
  const normalized = normalizedText(label).toLowerCase().replace(/:$/, "");
  if (normalized === "advertising revenue") return { section: "revenue" };
  if (normalized === "leads" || normalized === "clicks") return { section: "revenue", subsection: normalized };
  if (normalized === "marketing spend") return { section: "marketing-spend" };
  if (normalized === "finance spend") return { section: "operating-spend", subsection: "finance" };
  if (normalized === "withdrawal") return { section: "withdrawal" };
  return undefined;
}

function lineValue(line: ManagementReportBusinessLine | undefined, key: string | undefined): number {
  return key && line ? (line.values[key] ?? 0) : 0;
}

function linePercentage(line: ManagementReportBusinessLine | undefined, key: string | undefined): number {
  return key && line ? (line.percentages[key] ?? 0) : 0;
}

function businessUnitFromTable(
  sheetKey: "vb-cp" | "vb-wag" | "vb-acp",
  records: ManagementReportCsvRecord[]
): BusinessParseResult {
  const checks: ManagementReportCheck[] = [];
  const header = records.find((record) => normalizedText(rowCell(record, 1)).toLowerCase() === "particulars");
  if (!header) {
    return {
      units: [],
      checks: [check(sheetKey, "business-header-missing", "error", "Could not find the Particulars header row.")],
      parsedRecordCount: 0
    };
  }

  const definitions = {
    "vb-cp": { id: "cognitive-pixel", name: "Cognitive Pixel", kind: "team" as const, active: true },
    "vb-wag": { id: "wagner", name: "Wagner", kind: "team" as const, active: true },
    "vb-acp": { id: "acp", name: "ACP", kind: "offer" as const, parentTeamId: "cognitive-pixel", active: true }
  };
  const definition = definitions[sheetKey];
  const columns = businessColumns(header);
  const lines: ManagementReportBusinessLine[] = [];
  let section = "other";
  let subsection: string | undefined;

  for (const record of records.slice(header.recordNumber)) {
    const label = normalizedText(rowCell(record, 1));
    if (!label) continue;
    const heading = businessSectionHeading(label);
    if (heading) {
      section = heading.section;
      subsection = heading.subsection;
      continue;
    }

    const normalizedLabel = label.toLowerCase();
    const isExplicitRatioRow = normalizedLabel.includes("(%)");
    const values: Record<string, number> = {};
    const percentages: Record<string, number> = {};
    for (const column of columns) {
      const cell = rowCell(record, column.sourceColumn - 1);
      const percentage = percentageFromCell(
        cell,
        isExplicitRatioRow || column.kind === "run-rate" || column.kind === "sales-rate"
      );
      if (percentage !== undefined) percentages[column.key] = percentage;
      else {
        const value = numberFromCell(cell);
        if (value !== undefined) values[column.key] = value;
      }
    }
    if (Object.keys(values).length === 0 && Object.keys(percentages).length === 0) continue;

    const metric = standardizedBusinessMetric(label);
    const isRatio = isExplicitRatioRow || (Object.keys(values).length === 0 && Object.keys(percentages).length > 0);
    const lineSection = metric ? "summary" : section;
    lines.push({
      lineId: `business-line:${sheetKey}:${record.recordNumber}:${stableHash(label)}`,
      label,
      base: normalizedText(rowCell(record, 2)) || undefined,
      section: lineSection,
      subsection,
      metric,
      values,
      percentages,
      isSubtotal: Boolean(metric) || /^total\b/i.test(label),
      isRatio,
      sourceSheet: sheetKey,
      sourceRow: record.recordNumber
    });

    if (metric === "gross-profit") {
      section = "operating-spend";
      subsection = undefined;
    }
  }

  const lineByMetric = new Map(lines.filter((line) => line.metric).map((line) => [line.metric!, line]));
  const latestColumn = columns.find((column) => column.kind === "ytd")
    ?? columns.find((column) => column.kind === "performance")
    ?? [...columns].reverse().find((column) => column.kind === "month" || column.kind === "annual");
  if (!latestColumn) checks.push(check(sheetKey, "latest-period-missing", "error", "No YTD or performance column was found."));
  const latestKey = latestColumn?.key;
  const budgetColumn = columns.find((column) => column.kind === "budget");
  const revisedBudgetColumn = columns.find((column) => column.kind === "revised-budget");
  const revenueLine = lineByMetric.get("revenue");
  const marketingLine = lineByMetric.get("marketing-spend");
  const grossProfitLine = lineByMetric.get("gross-profit");
  const operatingSpendLine = lineByMetric.get("operating-spend");
  const ebitdaLine = lineByMetric.get("ebitda");
  const netProfitLine = lineByMetric.get("net-profit");
  const netMarginLine = lineByMetric.get("net-margin");
  const netAfterWithdrawalsLine = lineByMetric.get("net-after-withdrawals");
  const grossMarginLine = lineByMetric.get("gross-margin");
  const actual: ManagementReportBusinessActual = {
    revenue: lineValue(revenueLine, latestKey),
    marketingSpend: lineValue(marketingLine, latestKey),
    grossProfit: lineValue(grossProfitLine, latestKey),
    grossMargin: linePercentage(grossMarginLine, latestKey),
    operatingSpend: lineValue(operatingSpendLine, latestKey),
    ...(ebitdaLine ? { ebitda: lineValue(ebitdaLine, latestKey) } : {}),
    netProfit: lineValue(netProfitLine, latestKey),
    netMargin: linePercentage(netMarginLine, latestKey)
  };
  const summary: ManagementReportBusinessSummary = {
    ...actual,
    budgetRevenue: budgetColumn ? lineValue(revenueLine, budgetColumn.key) : undefined,
    revisedBudgetRevenue: revisedBudgetColumn ? lineValue(revenueLine, revisedBudgetColumn.key) : undefined,
    budgetNetProfit: budgetColumn ? lineValue(netProfitLine, budgetColumn.key) : undefined,
    revisedBudgetNetProfit: revisedBudgetColumn ? lineValue(netProfitLine, revisedBudgetColumn.key) : undefined,
    netAfterWithdrawals: netAfterWithdrawalsLine ? lineValue(netAfterWithdrawalsLine, latestKey) : undefined
  };
  const monthly: ManagementReportBusinessMonth[] = columns
    .filter((column) => column.kind === "month" && column.period)
    .map((column) => ({
      period: column.period!,
      label: column.label,
      revenue: lineValue(revenueLine, column.key),
      marketingSpend: lineValue(marketingLine, column.key),
      operatingSpend: lineValue(operatingSpendLine, column.key),
      grossProfit: lineValue(grossProfitLine, column.key),
      netProfit: lineValue(netProfitLine, column.key)
    }));
  const reportLabel = normalizedText(rowCell(records[2] ?? records[1], 1)) || "Business Performance";
  const unit: ManagementReportBusinessUnit = {
    ...definition,
    sourceSheet: sheetKey,
    reportLabel,
    currency: "USD",
    latestPeriod: latestColumn?.period ?? periodFromLabel(reportLabel) ?? "unknown",
    latestPeriodLabel: latestColumn?.label ?? reportLabel,
    columns,
    lines,
    actual,
    summary,
    monthly
  };
  if (!revenueLine || !netProfitLine) {
    checks.push(check(sheetKey, "business-summary-incomplete", "error", "Revenue or net-profit totals are missing."));
  }
  return { units: [unit], checks, parsedRecordCount: lines.length };
}

function restBusinessUnits(
  records: ManagementReportCsvRecord[],
  reportAsOf: string
): BusinessParseResult {
  const sheetKey = "vb-rest" as const;
  const checks: ManagementReportCheck[] = [];
  const header = records.find((record) => normalizedText(rowCell(record, 1)).toLowerCase() === "particulars");
  if (!header) return { units: [], checks: [check(sheetKey, "business-header-missing", "error", "Could not find the Particulars header row.")], parsedRecordCount: 0 };
  const budgetIndex = header.cells.findIndex((cell) => normalizedText(cell).toLowerCase().includes("budget"));
  const atlanticIndex = header.cells.findIndex((cell) => /altan|atlan/i.test(normalizedText(cell)) && normalizedText(cell).toLowerCase().includes("performance"));
  const affiliatesIndex = header.cells.findIndex((cell) => normalizedText(cell).toLowerCase().includes("affiliates") && normalizedText(cell).toLowerCase().includes("performance"));
  const affiliateMonthIndices = header.cells
    .map((cell, index) => ({ index, period: isoDateFromCell(normalizedText(cell)), label: normalizedText(cell) }))
    .filter((item) => Boolean(item.period));
  if (budgetIndex < 0 || atlanticIndex < 0 || affiliatesIndex < 0) {
    checks.push(check(sheetKey, "split-columns-missing", "error", "Atlantic Ocean and Affiliates performance columns could not be identified."));
    return { units: [], checks, parsedRecordCount: 0 };
  }

  const rows = records.filter((record) => normalizedText(rowCell(record, 1)));
  const detailByLabel = new Map(rows.map((record) => [normalizedText(rowCell(record, 1)).toLowerCase(), record]));
  const unitFromRows = (
    id: "atlantic-ocean" | "affiliates",
    name: string,
    kind: "team" | "affiliate",
    active: boolean,
    relevant: (label: string) => boolean,
    performanceIndex: number
  ): ManagementReportBusinessUnit => {
    const rawPerformanceLabel = normalizedText(rowCell(header, performanceIndex));
    const performanceLabel = id === "atlantic-ocean"
      ? atlanticOceanDisplayLabel(rawPerformanceLabel)
      : rawPerformanceLabel;
    const revenueDetails = rows.filter((record) => {
      const label = normalizedText(rowCell(record, 1));
      return relevant(label) && (/kissterra/i.test(label) || /revenue/i.test(label)) && !/^total/i.test(label);
    });
    const spendDetails = rows.filter((record) => {
      const label = normalizedText(rowCell(record, 1));
      return relevant(label) && (/facebook/i.test(label) || /expense/i.test(label)) && !/^total/i.test(label);
    });
    const revenue = sum(revenueDetails.map((record) => numberFromCell(rowCell(record, performanceIndex))));
    const marketingSpend = sum(spendDetails.map((record) => numberFromCell(rowCell(record, performanceIndex))));
    const netRecord = detailByLabel.get("net margin");
    const netProfit = netRecord ? (numberFromCell(rowCell(netRecord, performanceIndex)) ?? rounded(revenue - marketingSpend)) : rounded(revenue - marketingSpend);
    const budgetRevenue = sum(revenueDetails.map((record) => numberFromCell(rowCell(record, budgetIndex))));
    const budgetMarketing = sum(spendDetails.map((record) => numberFromCell(rowCell(record, budgetIndex))));
    const monthly = id === "affiliates"
      ? affiliateMonthIndices.map((column) => {
          const monthRevenue = sum(revenueDetails.map((record) => numberFromCell(rowCell(record, column.index))));
          const monthSpend = sum(spendDetails.map((record) => numberFromCell(rowCell(record, column.index))));
          return {
            period: column.period!,
            label: column.label,
            revenue: monthRevenue,
            marketingSpend: monthSpend,
            operatingSpend: 0,
            grossProfit: rounded(monthRevenue - monthSpend),
            netProfit: rounded(monthRevenue - monthSpend)
          };
        })
      : [];
    const columns: ManagementReportBusinessColumn[] = [
      { key: "budget-cy-2026", label: normalizedText(rowCell(header, budgetIndex)), kind: "budget", period: "2026-12-31", sourceColumn: budgetIndex + 1 },
      ...(id === "affiliates"
        ? affiliateMonthIndices.map((column) => ({ key: normalizedKey(column.label), label: column.label, kind: "month" as const, period: column.period, sourceColumn: column.index + 1 }))
        : []),
      { key: "performance", label: performanceLabel, kind: "performance", period: reportAsOf, sourceColumn: performanceIndex + 1 }
    ];
    const lines: ManagementReportBusinessLine[] = [...revenueDetails, ...spendDetails].map((record) => {
      const label = normalizedText(rowCell(record, 1));
      const isRevenue = /kissterra|revenue/i.test(label);
      const values: Record<string, number> = {};
      const budget = numberFromCell(rowCell(record, budgetIndex));
      const performance = numberFromCell(rowCell(record, performanceIndex));
      if (budget !== undefined) values["budget-cy-2026"] = budget;
      if (performance !== undefined) values.performance = performance;
      for (const column of affiliateMonthIndices) {
        const value = numberFromCell(rowCell(record, column.index));
        if (value !== undefined) values[normalizedKey(column.label)] = value;
      }
      return {
        lineId: `business-line:${sheetKey}:${id}:${record.recordNumber}`,
        label,
        base: normalizedText(rowCell(record, 2)) || undefined,
        section: isRevenue ? "revenue" : "marketing-spend",
        values,
        percentages: {},
        isSubtotal: false,
        isRatio: false,
        sourceSheet: sheetKey,
        sourceRow: record.recordNumber
      };
    });
    const summaryLine = (
      metric: "revenue" | "marketing-spend" | "net-profit",
      label: string,
      source: ManagementReportCsvRecord,
      budget: number,
      performance: number,
      monthlyValues: ManagementReportBusinessMonth[]
    ): ManagementReportBusinessLine => {
      const values: Record<string, number> = { "budget-cy-2026": budget, performance };
      for (const month of monthlyValues) values[normalizedKey(month.label)] = metric === "revenue" ? month.revenue : metric === "marketing-spend" ? month.marketingSpend : month.netProfit;
      return {
        lineId: `business-line:${sheetKey}:${id}:${metric}`,
        label,
        section: "summary",
        metric,
        values,
        percentages: {},
        isSubtotal: true,
        isRatio: false,
        sourceSheet: sheetKey,
        sourceRow: source.recordNumber
      };
    };
    const revenueSource = revenueDetails[0];
    const spendSource = spendDetails[0];
    if (revenueSource) lines.push(summaryLine("revenue", "TOTAL ADVERTISING REVENUE", revenueSource, budgetRevenue, revenue, monthly));
    if (spendSource) lines.push(summaryLine("marketing-spend", "TOTAL MARKETING SPENDS + COMM", spendSource, budgetMarketing, marketingSpend, monthly));
    if (netRecord) lines.push(summaryLine("net-profit", "NET MARGIN", netRecord, rounded(budgetRevenue - budgetMarketing), netProfit, monthly));
    const actual: ManagementReportBusinessActual = {
      revenue,
      marketingSpend,
      grossProfit: netProfit,
      grossMargin: revenue === 0 ? 0 : netProfit / revenue,
      operatingSpend: 0,
      netProfit,
      netMargin: revenue === 0 ? 0 : netProfit / revenue
    };
    return {
      id,
      name,
      kind,
      active,
      sourceSheet: sheetKey,
      reportLabel: "Business Performance",
      currency: "USD",
      latestPeriod: reportAsOf,
      latestPeriodLabel: performanceLabel,
      columns,
      lines,
      actual,
      summary: {
        ...actual,
        budgetRevenue,
        budgetNetProfit: rounded(budgetRevenue - budgetMarketing)
      },
      monthly
    };
  };

  const atlantic = unitFromRows(
    "atlantic-ocean",
    "Atlantic Ocean",
    "team",
    false,
    (label) => !/affliat|affiliate/i.test(label),
    atlanticIndex
  );
  const affiliates = unitFromRows(
    "affiliates",
    "Affiliates",
    "affiliate",
    true,
    (label) => /affliat|affiliate/i.test(label),
    affiliatesIndex
  );
  const netMarginRecord = detailByLabel.get("net margin");
  const combinedNet = netMarginRecord ? numberFromCell(rowCell(netMarginRecord, affiliatesIndex)) : undefined;
  if (combinedNet !== undefined && Math.abs(combinedNet - affiliates.actual.netProfit) > 1) {
    checks.push(check(sheetKey, "affiliate-net-reconciliation", "warning", "Affiliate detail rows do not reconcile to the reported net margin.", { actual: affiliates.actual.netProfit, expected: combinedNet }));
  }
  return { units: [atlantic, affiliates], checks, parsedRecordCount: atlantic.lines.length + affiliates.lines.length };
}

interface BankParseResult {
  entries: ManagementReportBankEntry[];
  aggregates: ManagementReportBankAggregate[];
  recentEntries: ManagementReportRecentBankEntry[];
  checks: ManagementReportCheck[];
  latestDate?: string;
}

function bankHeaderIndex(header: ManagementReportCsvRecord, name: string): number {
  const normalizedName = normalizedKey(name);
  return header.cells.findIndex((cell) => normalizedKey(cell) === normalizedName);
}

function parseBankLedger(
  records: ManagementReportCsvRecord[],
  sourceRowsByNumber: Map<number, ManagementReportSourceRow>,
  officialThrough: string
): BankParseResult {
  const sheetKey = "consolidated-bank" as const;
  const checks: ManagementReportCheck[] = [];
  const header = records.find((record) =>
    normalizedText(rowCell(record, 1)).toLowerCase() === "date"
    && normalizedText(rowCell(record, 2)).toLowerCase() === "company name"
  );
  if (!header) {
    return {
      entries: [],
      aggregates: [],
      recentEntries: [],
      checks: [check(sheetKey, "bank-header-missing", "error", "Could not find the Consolidated Bank header row.")]
    };
  }
  const indices = {
    date: bankHeaderIndex(header, "Date"),
    company: bankHeaderIndex(header, "Company Name"),
    bank: bankHeaderIndex(header, "Bank Name"),
    serviceMonth: bankHeaderIndex(header, "Service Month"),
    month: bankHeaderIndex(header, "Month"),
    reference: bankHeaderIndex(header, "Reference"),
    user: bankHeaderIndex(header, "User Name"),
    bspl: bankHeaderIndex(header, "BS/PL"),
    accountType: bankHeaderIndex(header, "Account Type"),
    nature: bankHeaderIndex(header, "Nature of Expense"),
    segment: bankHeaderIndex(header, "Segment"),
    currency: bankHeaderIndex(header, "Currency"),
    nativeAmount: bankHeaderIndex(header, "Amount incl. VAT"),
    rate: bankHeaderIndex(header, "Rate to USD"),
    amountUsd: bankHeaderIndex(header, "Amount"),
    comment: bankHeaderIndex(header, "Comment"),
    reconciliation: bankHeaderIndex(header, "Reco")
  };
  if (Object.values(indices).some((index) => index < 0)) {
    checks.push(check(sheetKey, "bank-columns-incomplete", "error", "One or more required Consolidated Bank columns are missing."));
  }

  const entries: ManagementReportBankEntry[] = [];
  for (const record of records.slice(header.recordNumber)) {
    const date = isoDateFromCell(rowCell(record, indices.date));
    if (!date) continue;
    const amountIncludingVat = numberFromCell(rowCell(record, indices.nativeAmount)) ?? 0;
    const rateToUsd = numberFromCell(rowCell(record, indices.rate));
    const reportedAmountUsd = numberFromCell(rowCell(record, indices.amountUsd));
    const isPostClose = date > officialThrough;
    const canComputeOfficialAmount = !isPostClose && rateToUsd !== undefined && rateToUsd > 0;
    const amountUsdSource: ManagementReportBankEntry["amountUsdSource"] = reportedAmountUsd !== undefined
      ? "sheet"
      : canComputeOfficialAmount
        ? "computed"
        : "missing";
    const amountUsd = reportedAmountUsd !== undefined
      ? reportedAmountUsd
      : canComputeOfficialAmount
        ? rounded(amountIncludingVat * rateToUsd!)
        : 0;
    const source = sourceRowsByNumber.get(record.recordNumber)!;
    entries.push({
      entryId: `management-report-bank:${date}:${record.recordNumber}:${stableHash(record.cells.join("\u001f"))}`,
      date,
      companyName: normalizedText(rowCell(record, indices.company)),
      bankName: normalizedText(rowCell(record, indices.bank)),
      serviceMonth: isoDateFromCell(rowCell(record, indices.serviceMonth)) ?? (normalizedText(rowCell(record, indices.serviceMonth)) || undefined),
      month: isoDateFromCell(rowCell(record, indices.month)) ?? (normalizedText(rowCell(record, indices.month)) || undefined),
      reference: normalizedText(rowCell(record, indices.reference)) || undefined,
      userName: normalizedText(rowCell(record, indices.user)) || undefined,
      balanceSheetOrProfitLoss: normalizedText(rowCell(record, indices.bspl)) || undefined,
      accountType: normalizedText(rowCell(record, indices.accountType)) || "Unclassified",
      nature: normalizedText(rowCell(record, indices.nature)) || "Unclassified",
      segment: normalizedText(rowCell(record, indices.segment)) || "Unassigned",
      currency: normalizedText(rowCell(record, indices.currency)).toUpperCase() || "USD",
      amountIncludingVat,
      rateToUsd,
      amountUsd,
      amountUsdSource,
      comment: normalizedText(rowCell(record, indices.comment)) || undefined,
      reconciliation: normalizedText(rowCell(record, indices.reconciliation)) || undefined,
      isPostClose,
      isIncludedInOfficialPeriod: !isPostClose,
      sourceSheet: sheetKey,
      sourceRow: record.recordNumber,
      sourceRowId: source.sourceRowId
    });
  }

  const postClose = entries.filter((entry) => entry.isPostClose);
  const unconverted = entries.filter((entry) => entry.amountUsdSource === "missing");
  if (postClose.length > 0) {
    checks.push(check(
      sheetKey,
      "bank-post-close-rows",
      "warning",
      `${postClose.length} bank rows dated after the ${officialThrough} management-report close were retained but excluded from official aggregates.`,
      { actual: postClose.length, expected: 0 }
    ));
  }
  if (unconverted.length > 0) {
    checks.push(check(
      sheetKey,
      "bank-unconverted-rows",
      "warning",
      `${unconverted.length} bank rows have no reported or eligible computed USD amount.`,
      { actual: unconverted.length, expected: 0 }
    ));
  }

  const aggregateMap = new Map<string, ManagementReportBankAggregate>();
  const addAggregate = (
    dimension: ManagementReportBankAggregate["dimension"],
    keyValue: string,
    entry: ManagementReportBankEntry
  ) => {
    const key = keyValue || "Unassigned";
    const id = `${dimension}:${normalizedKey(key)}`;
    const aggregate = aggregateMap.get(id) ?? {
      id,
      dimension,
      key,
      label: key,
      entryCount: 0,
      incomeUsd: 0,
      expenseUsd: 0,
      netUsd: 0,
      unconvertedCount: 0,
      postCloseCount: 0
    };
    aggregate.entryCount += 1;
    if (entry.isPostClose) aggregate.postCloseCount += 1;
    if (entry.amountUsdSource === "missing") aggregate.unconvertedCount += 1;
    if (entry.isIncludedInOfficialPeriod) {
      const accountType = entry.accountType.toLowerCase();
      if (accountType === "income") aggregate.incomeUsd = rounded(aggregate.incomeUsd + entry.amountUsd);
      else if (accountType.includes("expense")) aggregate.expenseUsd = rounded(aggregate.expenseUsd + entry.amountUsd);
      aggregate.netUsd = rounded(aggregate.incomeUsd - aggregate.expenseUsd);
    }
    aggregateMap.set(id, aggregate);
  };
  for (const entry of entries) {
    addAggregate("bank", entry.bankName, entry);
    addAggregate("segment", entry.segment, entry);
    addAggregate("month", entry.month ?? entry.date.slice(0, 7), entry);
    addAggregate("account-type", entry.accountType, entry);
    addAggregate("nature", entry.nature, entry);
    addAggregate("currency", entry.currency, entry);
  }
  const aggregates = [...aggregateMap.values()].sort((left, right) =>
    left.dimension.localeCompare(right.dimension) || right.entryCount - left.entryCount || left.label.localeCompare(right.label)
  );
  const recentEntries: ManagementReportRecentBankEntry[] = [...entries]
    .sort((left, right) => right.date.localeCompare(left.date) || right.sourceRow - left.sourceRow)
    .slice(0, 50)
    .map((entry) => ({
      entryId: entry.entryId,
      date: entry.date,
      companyName: entry.companyName,
      bankName: entry.bankName,
      segment: entry.segment,
      nature: entry.nature,
      accountType: entry.accountType,
      currency: entry.currency,
      amountIncludingVat: entry.amountIncludingVat,
      amountUsd: entry.amountUsd,
      hasUsdAmount: entry.amountUsdSource !== "missing",
      isPostClose: entry.isPostClose
    }));
  return {
    entries,
    aggregates,
    recentEntries,
    checks,
    latestDate: entries.reduce<string | undefined>((latest, entry) => !latest || entry.date > latest ? entry.date : latest, undefined)
  };
}

interface OwnershipParseResult {
  ownership: ManagementReportOwnership;
  checks: ManagementReportCheck[];
  parsedRecordCount: number;
}

function canonicalShareholderName(value: string): string {
  const normalized = normalizedText(value).replace(/^[-–—]\s*/, "").toLowerCase();
  if (normalized === "ishaan" || normalized === "ishan") return "Ishan";
  if (normalized === "benos" || normalized === "ben") return "Ben";
  if (normalized === "sanjin") return "Sanjin";
  if (normalized === "amin") return "Amin";
  return normalizedText(value).replace(/^[-–—]\s*/, "");
}

function firstNumberAfter(record: ManagementReportCsvRecord, index: number, width = 3): number | undefined {
  for (let offset = 1; offset <= width; offset += 1) {
    const value = numberFromCell(rowCell(record, index + offset));
    if (value !== undefined) return value;
  }
  return undefined;
}

function emptyOwnership(): ManagementReportOwnership {
  return {
    currency: "USD",
    reportLabel: "Shareholder's Fund",
    totalPartnerBalance: 0,
    totalEquityBalance: 0,
    totalAssetsAndLiabilities: 0,
    balances: [],
    assetsLiabilities: [],
    profitAllocations: []
  };
}

function parseOwnership(records: ManagementReportCsvRecord[]): OwnershipParseResult {
  const sheetKey = "shareholders" as const;
  const checks: ManagementReportCheck[] = [];
  const header = records.find((record) => record.cells.some((cell) => normalizedText(cell).toLowerCase() === "equity"));
  if (!header) {
    return { ownership: emptyOwnership(), checks: [check(sheetKey, "ownership-header-missing", "error", "Could not find the ownership header row.")], parsedRecordCount: 0 };
  }
  const equityIndex = header.cells.findIndex((cell) => normalizedText(cell).toLowerCase() === "equity");
  const assetIndex = header.cells.findIndex((cell) => normalizedText(cell).toLowerCase().includes("asset & liability"));
  const particularsIndex = header.cells.findIndex((cell) => normalizedText(cell).toLowerCase() === "particulars");
  const totalIndex = header.cells.findIndex((cell, index) => index > particularsIndex && normalizedText(cell).toLowerCase() === "total");
  const shareholderColumns = header.cells
    .map((cell, index) => ({ index, name: normalizedText(cell), canonicalName: canonicalShareholderName(cell) }))
    .filter((item) => item.index > totalIndex && item.name);

  const lines: ManagementReportAssetLiabilityLine[] = [];
  for (const record of records.slice(header.recordNumber)) {
    const equityLabel = normalizedText(rowCell(record, equityIndex));
    if (equityLabel) {
      const amounts = [numberFromCell(rowCell(record, equityIndex + 1)), numberFromCell(rowCell(record, equityIndex + 2))];
      lines.push({
        lineId: `ownership:equity:${record.recordNumber}`,
        section: "equity",
        label: equityLabel,
        amount: amounts[0],
        secondaryAmount: amounts[1],
        isTotal: /total/i.test(equityLabel),
        sourceRow: record.recordNumber
      });
    }
    const assetLabel = assetIndex >= 0 ? normalizedText(rowCell(record, assetIndex)) : "";
    if (assetLabel) {
      const amounts = [numberFromCell(rowCell(record, assetIndex + 1)), numberFromCell(rowCell(record, assetIndex + 2))];
      lines.push({
        lineId: `ownership:assets-liabilities:${record.recordNumber}`,
        section: "assets-liabilities",
        label: assetLabel,
        amount: amounts[0],
        secondaryAmount: amounts[1],
        isTotal: /total/i.test(assetLabel),
        sourceRow: record.recordNumber
      });
    }
  }

  const profitAllocations: ManagementReportProfitAllocation[] = particularsIndex < 0
    ? []
    : records.slice(header.recordNumber).flatMap((record) => {
        const label = normalizedText(rowCell(record, particularsIndex));
        if (!label) return [];
        const byShareholder: Record<string, number> = {};
        for (const shareholder of shareholderColumns) {
          const value = numberFromCell(rowCell(record, shareholder.index));
          if (value !== undefined) byShareholder[shareholder.canonicalName] = value;
        }
        const total = totalIndex >= 0 ? (numberFromCell(rowCell(record, totalIndex)) ?? sum(Object.values(byShareholder))) : sum(Object.values(byShareholder));
        if (Object.keys(byShareholder).length === 0 && total === 0) return [];
        return [{
          allocationId: `profit-allocation:${record.recordNumber}:${stableHash(label)}`,
          label,
          total,
          byShareholder,
          sourceRow: record.recordNumber
        }];
      });
  const latestProfit = [...profitAllocations].reverse().find((allocation) => /total profit as of/i.test(allocation.label));
  const withdrawals = profitAllocations.find((allocation) => /less:\s*profit withdrawals/i.test(allocation.label));
  const balances: ManagementReportShareholderBalance[] = shareholderColumns.map((shareholder) => {
    const source = records.find((record) => canonicalShareholderName(rowCell(record, equityIndex)) === shareholder.canonicalName);
    return {
      id: normalizedKey(shareholder.canonicalName),
      name: shareholder.name,
      canonicalName: shareholder.canonicalName,
      balance: source ? (firstNumberAfter(source, equityIndex) ?? 0) : 0,
      profitBalance: latestProfit?.byShareholder[shareholder.canonicalName],
      profitWithdrawals: withdrawals?.byShareholder[shareholder.canonicalName],
      currency: "USD",
      sourceRow: source?.recordNumber ?? header.recordNumber
    };
  });
  const partnerBalanceLine = lines.find((line) => line.section === "equity" && normalizedText(line.label).toLowerCase() === "partner's balance");
  const totalEquityLine = lines.find((line) => line.section === "equity" && /total equity balance/i.test(line.label));
  const totalAssetsLine = lines.find((line) => line.section === "assets-liabilities" && /total assets/i.test(line.label));
  const totalPartnerBalance = partnerBalanceLine?.secondaryAmount ?? partnerBalanceLine?.amount ?? sum(balances.map((balance) => balance.balance));
  const totalEquityBalance = totalEquityLine?.secondaryAmount ?? totalEquityLine?.amount ?? 0;
  const totalAssetsAndLiabilities = totalAssetsLine?.secondaryAmount ?? totalAssetsLine?.amount ?? 0;
  const balanceDifference = Math.abs(sum(balances.map((balance) => balance.balance)) - totalPartnerBalance);
  if (balanceDifference > 2) {
    checks.push(check(sheetKey, "partner-balances-do-not-reconcile", "warning", "Individual partner balances do not reconcile to the reported partner balance.", {
      actual: sum(balances.map((balance) => balance.balance)),
      expected: totalPartnerBalance
    }));
  }
  if (Math.abs(totalEquityBalance - totalAssetsAndLiabilities) > 1) {
    checks.push(check(sheetKey, "balance-sheet-out-of-balance", "error", "Total equity does not equal total assets and liabilities.", {
      actual: totalEquityBalance,
      expected: totalAssetsAndLiabilities
    }));
  }
  return {
    ownership: {
      currency: "USD",
      reportLabel: normalizedText(rowCell(records[2] ?? records[1], 1)) || "Shareholder's Fund",
      totalPartnerBalance,
      totalEquityBalance,
      totalAssetsAndLiabilities,
      balances,
      assetsLiabilities: lines,
      profitAllocations
    },
    checks,
    parsedRecordCount: lines.length + profitAllocations.length
  };
}

interface PlatformParseResult {
  platforms: ManagementReportPlatformPerformance[];
  checks: ManagementReportCheck[];
  parsedRecordCount: number;
}

function parsePlatforms(records: ManagementReportCsvRecord[]): PlatformParseResult {
  const sheetKey = "plp" as const;
  const checks: ManagementReportCheck[] = [];
  const header = records.find((record) => normalizedText(rowCell(record, 1)).toLowerCase() === "months");
  if (!header) return { platforms: [], checks: [check(sheetKey, "platform-header-missing", "error", "Could not find the platform profitability header row.")], parsedRecordCount: 0 };
  const indices = {
    period: header.cells.findIndex((cell) => normalizedText(cell).toLowerCase() === "months"),
    platform: header.cells.findIndex((cell) => normalizedText(cell).toLowerCase() === "platform name"),
    revenue: header.cells.findIndex((cell) => normalizedText(cell).toLowerCase() === "revenue"),
    spend: header.cells.findIndex((cell) => normalizedText(cell).toLowerCase() === "spend"),
    profit: header.cells.findIndex((cell) => normalizedText(cell).toLowerCase() === "profit"),
    profitMargin: header.cells.findIndex((cell) => normalizedText(cell).toLowerCase() === "profit margin"),
    leads: header.cells.findIndex((cell) => normalizedText(cell).toLowerCase() === "leads"),
    cpl: header.cells.findIndex((cell) => normalizedText(cell).toLowerCase() === "cpl")
  };
  if (Object.values(indices).some((index) => index < 0)) checks.push(check(sheetKey, "platform-columns-incomplete", "error", "One or more platform profitability columns are missing."));
  const platforms: ManagementReportPlatformPerformance[] = [];
  let periodLabel = "";
  let period = "unknown";
  for (const record of records.slice(header.recordNumber)) {
    const nextPeriodLabel = normalizedText(rowCell(record, indices.period));
    if (nextPeriodLabel) {
      periodLabel = nextPeriodLabel;
      period = periodFromLabel(nextPeriodLabel) ?? normalizedKey(nextPeriodLabel);
    }
    const platform = normalizedText(rowCell(record, indices.platform));
    if (!platform) continue;
    const revenue = numberFromCell(rowCell(record, indices.revenue));
    const spend = numberFromCell(rowCell(record, indices.spend));
    const profit = numberFromCell(rowCell(record, indices.profit));
    if (revenue === undefined && spend === undefined && profit === undefined) continue;
    platforms.push({
      platformMetricId: `platform:${period}:${normalizedKey(platform)}:${record.recordNumber}`,
      period,
      periodLabel,
      platform,
      revenue: revenue ?? 0,
      spend: spend ?? 0,
      profit: profit ?? 0,
      profitMargin: percentageFromCell(rowCell(record, indices.profitMargin), true) ?? 0,
      leads: numberFromCell(rowCell(record, indices.leads)) ?? 0,
      cpl: numberFromCell(rowCell(record, indices.cpl)) ?? 0,
      isTotal: normalizedText(platform).toLowerCase() === "total",
      sourceRow: record.recordNumber
    });
  }
  if (!platforms.some((item) => item.isTotal && /ytd/i.test(item.periodLabel))) {
    checks.push(check(sheetKey, "platform-ytd-total-missing", "error", "The YTD platform total row is missing."));
  }
  return { platforms, checks, parsedRecordCount: platforms.length };
}

interface OfferParseResult {
  reconciliation: ManagementReportOfferReconciliation;
  offers: ManagementReportOfferReconciliationEntry[];
  checks: ManagementReportCheck[];
  parsedRecordCount: number;
}

function emptyOfferReconciliation(): ManagementReportOfferReconciliation {
  return {
    reportLabel: "Wagner & Affiliates",
    managerSpendSource: 0,
    managerSpendDashboard: 0,
    managerSpendVariance: 0,
    redtrackRevenue: 0,
    dashboardRevenue: 0,
    variance: 0,
    groups: [],
    finalCalculation: []
  };
}

function offerBusinessUnit(label: string): string {
  const normalized = normalizedText(label).toLowerCase();
  if (normalized.includes("cognitive")) return "cognitive-pixel";
  if (normalized.includes("wagner")) return "wagner";
  if (normalized.includes("atlantic")) return "atlantic-ocean";
  if (normalized.includes("aca")) return "affiliates";
  return "unassigned";
}

function parseOfferReconciliation(records: ManagementReportCsvRecord[]): OfferParseResult {
  const sheetKey = "wag-aff" as const;
  const checks: ManagementReportCheck[] = [];
  const firstNamedBlock = records.find((record) => normalizedText(rowCell(record, 2)).toLowerCase() === "cognitive");
  const topRecords = firstNamedBlock ? records.filter((record) => record.recordNumber < firstNamedBlock.recordNumber) : records;
  const firstOfferHeader = topRecords.find((record) => /^offer redtrack/i.test(normalizedText(rowCell(record, 7))));
  if (!firstOfferHeader) {
    return {
      reconciliation: emptyOfferReconciliation(),
      offers: [],
      checks: [check(sheetKey, "offer-header-missing", "error", "Could not find the top-block offer reconciliation header.")],
      parsedRecordCount: 0
    };
  }

  const groups: ManagementReportOfferReconciliationGroup[] = [];
  let current: ManagementReportOfferReconciliationGroup | undefined;
  let reportedRedtrackRevenue = 0;
  let reportedDashboardRevenue = 0;
  for (const record of topRecords.filter((item) => item.recordNumber >= firstOfferHeader.recordNumber)) {
    const label = normalizedText(rowCell(record, 7));
    if (/^offer redtrack/i.test(label)) {
      if (current) groups.push(current);
      const businessUnitId = offerBusinessUnit(label);
      current = {
        groupId: `offer-group:${businessUnitId}:${record.recordNumber}`,
        name: label,
        businessUnitId,
        redtrackRevenue: 0,
        dashboardRevenue: 0,
        variance: 0,
        entries: [],
        sourceRow: record.recordNumber
      };
      continue;
    }
    if (/^total redtrack/i.test(label) && current) {
      current.redtrackRevenue = numberFromCell(rowCell(record, 9)) ?? sum(current.entries.map((entry) => entry.redtrackRevenue));
      current.dashboardRevenue = numberFromCell(rowCell(record, 11)) ?? sum(current.entries.map((entry) => entry.dashboardRevenue));
      current.variance = rounded(current.dashboardRevenue - current.redtrackRevenue);
      groups.push(current);
      current = undefined;
      continue;
    }
    if (/^offer revenue total/i.test(label)) {
      reportedRedtrackRevenue = numberFromCell(rowCell(record, 9)) ?? 0;
      reportedDashboardRevenue = numberFromCell(rowCell(record, 11)) ?? 0;
      continue;
    }
    if (!label || !current) continue;
    const redtrackRevenue = numberFromCell(rowCell(record, 9));
    const dashboardRevenue = numberFromCell(rowCell(record, 11));
    if (redtrackRevenue === undefined && dashboardRevenue === undefined) continue;
    current.entries.push({
      offerId: `offer:${current.businessUnitId}:${record.recordNumber}:${stableHash(label)}`,
      groupId: current.groupId,
      groupName: current.name,
      businessUnitId: current.businessUnitId,
      offerName: label,
      redtrackSource: normalizedText(rowCell(record, 8)) || undefined,
      redtrackRevenue: redtrackRevenue ?? 0,
      dashboardSource: normalizedText(rowCell(record, 10)) || undefined,
      dashboardRevenue: dashboardRevenue ?? 0,
      variance: rounded((dashboardRevenue ?? 0) - (redtrackRevenue ?? 0)),
      sourceRow: record.recordNumber
    });
  }
  if (current) {
    current.redtrackRevenue = sum(current.entries.map((entry) => entry.redtrackRevenue));
    current.dashboardRevenue = sum(current.entries.map((entry) => entry.dashboardRevenue));
    current.variance = rounded(current.dashboardRevenue - current.redtrackRevenue);
    groups.push(current);
  }

  const acaHeader = topRecords.find((record) => normalizedText(rowCell(record, 13)).toLowerCase() === "aca offer");
  const finalHeader = topRecords.find((record) => normalizedText(rowCell(record, 13)).toLowerCase() === "final calculation");
  if (acaHeader) {
    const entries: ManagementReportOfferReconciliationEntry[] = [];
    for (const record of topRecords) {
      if (record.recordNumber <= acaHeader.recordNumber) continue;
      if (finalHeader && record.recordNumber >= finalHeader.recordNumber) break;
      const label = normalizedText(rowCell(record, 13));
      const ours = numberFromCell(rowCell(record, 14));
      const theirs = numberFromCell(rowCell(record, 15));
      // This is the reported subtotal for the ACA detail immediately above it.
      if (/^aca revenue$/i.test(label)) continue;
      if (!label || (ours === undefined && theirs === undefined)) continue;
      entries.push({
        offerId: `offer:aca:${record.recordNumber}:${stableHash(label)}`,
        groupId: "offer-group:aca",
        groupName: "ACA Offer",
        businessUnitId: "affiliates",
        offerName: label,
        redtrackRevenue: ours ?? 0,
        dashboardRevenue: theirs ?? 0,
        variance: rounded((theirs ?? 0) - (ours ?? 0)),
        sourceRow: record.recordNumber
      });
    }
    if (entries.length > 0) {
      const redtrackRevenue = sum(entries.map((entry) => entry.redtrackRevenue));
      const dashboardRevenue = sum(entries.map((entry) => entry.dashboardRevenue));
      groups.push({
        groupId: "offer-group:aca",
        name: "ACA Offer",
        businessUnitId: "affiliates",
        redtrackRevenue,
        dashboardRevenue,
        variance: rounded(dashboardRevenue - redtrackRevenue),
        entries,
        sourceRow: acaHeader.recordNumber
      });
    }
  }

  const finalCalculation: ManagementReportReconciliationMetric[] = [];
  if (finalHeader) {
    const headings = topRecords.find((record) => record.recordNumber > finalHeader.recordNumber && record.cells.slice(17).some((cell) => normalizedText(cell)));
    const unitByIndex = new Map<number, string>();
    if (headings) {
      for (let index = 17; index < headings.cells.length; index += 1) {
        const heading = normalizedText(rowCell(headings, index));
        if (heading) unitByIndex.set(index, offerBusinessUnit(heading));
      }
    }
    for (const record of topRecords) {
      if (record.recordNumber <= (headings?.recordNumber ?? finalHeader.recordNumber)) continue;
      const metric = normalizedText(rowCell(record, 13));
      const ourDashboard = numberFromCell(rowCell(record, 14));
      const theirDashboard = numberFromCell(rowCell(record, 15));
      if (!metric || (ourDashboard === undefined && theirDashboard === undefined)) continue;
      const byBusinessUnit: Record<string, number> = {};
      for (let index = 17; index < record.cells.length; index += 1) {
        const value = numberFromCell(rowCell(record, index));
        if (value === undefined) continue;
        const unit = unitByIndex.get(index) ?? `other-${index + 1}`;
        byBusinessUnit[unit] = value;
      }
      finalCalculation.push({
        metric,
        ourDashboard: ourDashboard ?? 0,
        theirDashboard: theirDashboard ?? 0,
        variance: numberFromCell(rowCell(record, 16)) ?? rounded((theirDashboard ?? 0) - (ourDashboard ?? 0)),
        byBusinessUnit,
        sourceRow: record.recordNumber
      });
    }
  }

  const managerTotal = topRecords.find((record) => normalizedText(rowCell(record, 2)).toLowerCase() === "total spend");
  const managerSpendSource = managerTotal ? (numberFromCell(rowCell(managerTotal, 3)) ?? 0) : 0;
  const managerSpendDashboard = managerTotal ? (numberFromCell(rowCell(managerTotal, 5)) ?? 0) : 0;
  if (reportedRedtrackRevenue === 0 && reportedDashboardRevenue === 0) {
    const nonAcaGroups = groups.filter((group) => group.groupId !== "offer-group:aca");
    reportedRedtrackRevenue = sum(nonAcaGroups.map((group) => group.redtrackRevenue));
    reportedDashboardRevenue = sum(nonAcaGroups.map((group) => group.dashboardRevenue));
    checks.push(check(sheetKey, "offer-grand-total-derived", "warning", "Offer grand totals were derived because the reported total row was missing."));
  }
  const offers = groups.flatMap((group) => group.entries);
  return {
    reconciliation: {
      reportLabel: normalizedText(rowCell(topRecords[0], 2)) || "All",
      managerSpendSource,
      managerSpendDashboard,
      managerSpendVariance: rounded(managerSpendDashboard - managerSpendSource),
      redtrackRevenue: reportedRedtrackRevenue,
      dashboardRevenue: reportedDashboardRevenue,
      variance: rounded(reportedDashboardRevenue - reportedRedtrackRevenue),
      groups,
      finalCalculation
    },
    offers,
    checks,
    parsedRecordCount: offers.length + finalCalculation.length
  };
}

function factsFromBusinessUnits(units: ManagementReportBusinessUnit[]): ManagementReportFact[] {
  const facts: ManagementReportFact[] = [];
  for (const unit of units) {
    const columnByKey = new Map(unit.columns.map((column) => [column.key, column]));
    for (const line of unit.lines) {
      for (const [key, value] of Object.entries(line.values)) {
        const column = columnByKey.get(key);
        const metric = line.metric ?? normalizedKey(line.label);
        const period = column?.period ?? unit.latestPeriod;
        facts.push({
          factId: factId([unit.id, metric, period, key, line.sourceSheet, line.sourceRow]),
          scope: unit.kind,
          scopeId: unit.id,
          metric,
          period,
          value,
          unit: "currency",
          currency: "USD",
          scenario: column?.kind ?? key,
          section: line.section,
          dimension: line.metric ? undefined : line.label,
          sourceSheet: line.sourceSheet,
          sourceRow: line.sourceRow,
          payload: { label: line.label, isSubtotal: line.isSubtotal, columnLabel: column?.label ?? key }
        });
      }
      for (const [key, value] of Object.entries(line.percentages)) {
        const column = columnByKey.get(key);
        const metric = line.metric ?? `${normalizedKey(line.label)}-percent`;
        const period = column?.period ?? unit.latestPeriod;
        facts.push({
          factId: factId([unit.id, metric, period, key, line.sourceSheet, line.sourceRow]),
          scope: unit.kind,
          scopeId: unit.id,
          metric,
          period,
          value,
          unit: "percent",
          scenario: column?.kind ?? key,
          section: line.section,
          dimension: line.metric ? undefined : line.label,
          sourceSheet: line.sourceSheet,
          sourceRow: line.sourceRow,
          payload: { label: line.label, isSubtotal: line.isSubtotal, columnLabel: column?.label ?? key }
        });
      }
    }
  }
  return facts;
}

function factsFromOwnership(ownership: ManagementReportOwnership, reportAsOf: string): ManagementReportFact[] {
  const facts: ManagementReportFact[] = [];
  for (const balance of ownership.balances) {
    facts.push({
      factId: factId([balance.id, "shareholder-balance", balance.sourceRow]),
      scope: "shareholder",
      scopeId: balance.id,
      metric: "shareholder-balance",
      period: reportAsOf,
      value: balance.balance,
      unit: "currency",
      currency: "USD",
      scenario: "actual",
      section: "equity",
      sourceSheet: "shareholders",
      sourceRow: balance.sourceRow
    });
    if (balance.profitBalance !== undefined) {
      facts.push({
        factId: factId([balance.id, "profit-balance", balance.sourceRow]),
        scope: "shareholder",
        scopeId: balance.id,
        metric: "profit-balance",
        period: reportAsOf,
        value: balance.profitBalance,
        unit: "currency",
        currency: "USD",
        scenario: "actual",
        section: "profit-allocation",
        sourceSheet: "shareholders",
        sourceRow: balance.sourceRow
      });
    }
  }
  for (const line of ownership.assetsLiabilities) {
    const amount = line.secondaryAmount ?? line.amount;
    if (amount === undefined) continue;
    facts.push({
      factId: factId([line.lineId, "balance-sheet", line.sourceRow]),
      scope: "company",
      scopeId: "digital-nudge-ou",
      metric: line.isTotal ? `total-${normalizedKey(line.label)}` : normalizedKey(line.label),
      period: reportAsOf,
      value: amount,
      unit: "currency",
      currency: "USD",
      scenario: "actual",
      section: line.section,
      dimension: line.label,
      sourceSheet: "shareholders",
      sourceRow: line.sourceRow,
      payload: { isTotal: line.isTotal }
    });
  }
  return facts;
}

function factsFromPlatforms(platforms: ManagementReportPlatformPerformance[]): ManagementReportFact[] {
  const facts: ManagementReportFact[] = [];
  const metrics: Array<keyof Pick<ManagementReportPlatformPerformance, "revenue" | "spend" | "profit" | "profitMargin" | "leads" | "cpl">> = [
    "revenue", "spend", "profit", "profitMargin", "leads", "cpl"
  ];
  for (const platform of platforms) {
    for (const metric of metrics) {
      const isPercent = metric === "profitMargin";
      const isCount = metric === "leads";
      const isCurrency = metric === "revenue" || metric === "spend" || metric === "profit" || metric === "cpl";
      facts.push({
        factId: factId([platform.platformMetricId, metric]),
        scope: "platform",
        scopeId: normalizedKey(platform.platform),
        metric: normalizedKey(metric),
        period: platform.period,
        value: platform[metric],
        unit: isPercent ? "percent" : isCount ? "count" : isCurrency ? "currency" : "number",
        currency: isCurrency ? "USD" : undefined,
        scenario: "actual",
        section: "platform-profitability",
        sourceSheet: "plp",
        sourceRow: platform.sourceRow,
        payload: { platform: platform.platform, isTotal: platform.isTotal }
      });
    }
  }
  return facts;
}

function factsFromOffers(offers: ManagementReportOfferReconciliationEntry[], reportAsOf: string): ManagementReportFact[] {
  return offers.flatMap((offer) => ([
    {
      factId: factId([offer.offerId, "redtrack-revenue"]),
      scope: "offer",
      scopeId: offer.offerId,
      metric: "redtrack-revenue",
      period: reportAsOf,
      value: offer.redtrackRevenue,
      unit: "currency" as const,
      currency: "USD",
      scenario: "redtrack",
      section: "offer-reconciliation",
      dimension: offer.businessUnitId,
      sourceSheet: "wag-aff" as const,
      sourceRow: offer.sourceRow,
      payload: { offerName: offer.offerName, groupName: offer.groupName }
    },
    {
      factId: factId([offer.offerId, "dashboard-revenue"]),
      scope: "offer",
      scopeId: offer.offerId,
      metric: "dashboard-revenue",
      period: reportAsOf,
      value: offer.dashboardRevenue,
      unit: "currency" as const,
      currency: "USD",
      scenario: "dashboard",
      section: "offer-reconciliation",
      dimension: offer.businessUnitId,
      sourceSheet: "wag-aff" as const,
      sourceRow: offer.sourceRow,
      payload: { offerName: offer.offerName, groupName: offer.groupName }
    },
    {
      factId: factId([offer.offerId, "revenue-variance"]),
      scope: "offer",
      scopeId: offer.offerId,
      metric: "revenue-variance",
      period: reportAsOf,
      value: offer.variance,
      unit: "currency" as const,
      currency: "USD",
      scenario: "reconciliation",
      section: "offer-reconciliation",
      dimension: offer.businessUnitId,
      sourceSheet: "wag-aff" as const,
      sourceRow: offer.sourceRow,
      payload: { offerName: offer.offerName, groupName: offer.groupName }
    }
  ]));
}

function buildTrend(units: ManagementReportBusinessUnit[]): ManagementReportTrendPoint[] {
  const byPeriod = new Map<string, ManagementReportTrendPoint>();
  for (const unit of units.filter((item) => item.parentTeamId === undefined)) {
    for (const month of unit.monthly) {
      const current = byPeriod.get(month.period) ?? {
        period: month.period,
        label: month.label,
        revenue: 0,
        marketingSpend: 0,
        operatingSpend: 0,
        grossProfit: 0,
        netProfit: 0
      };
      current.revenue = rounded(current.revenue + month.revenue);
      current.marketingSpend = rounded(current.marketingSpend + month.marketingSpend);
      current.operatingSpend = rounded(current.operatingSpend + month.operatingSpend);
      current.grossProfit = rounded(current.grossProfit + month.grossProfit);
      current.netProfit = rounded(current.netProfit + month.netProfit);
      byPeriod.set(month.period, current);
    }
  }
  return [...byPeriod.values()].sort((left, right) => left.period.localeCompare(right.period));
}

function emptySummary(): ManagementReportSummary {
  return {
    currency: "USD",
    revenue: 0,
    marketingSpend: 0,
    operatingSpend: 0,
    grossProfit: 0,
    netProfit: 0,
    netMargin: 0,
    shareholderEquity: 0,
    platformRevenue: 0,
    platformSpend: 0,
    platformProfit: 0,
    bankIncome: 0,
    bankExpense: 0,
    bankNet: 0,
    offerRevenue: 0,
    offerVariance: 0
  };
}

export function buildManagementReport(
  csvBySheet: Record<ManagementReportSheetKey, string>,
  metadata: ManagementReportImportMetadata
): ManagementReportBuildResult {
  const recordsBySheet = new Map<ManagementReportSheetKey, ManagementReportCsvRecord[]>();
  const sourceRowsBySheet = new Map<ManagementReportSheetKey, Map<number, ManagementReportSourceRow>>();
  const sheetSummaries = new Map<ManagementReportSheetKey, ManagementReportSheetSummary>();
  const sourceRows: ManagementReportSourceRow[] = [];

  for (const key of managementReportSheetKeys) {
    const definition = managementReportSheetDefinitions[key];
    const csv = csvBySheet[key];
    if (typeof csv !== "string" || csv.trim().length === 0) {
      const missingCheck = check(key, "sheet-missing", "error", `${definition.title} was not included in the import.`);
      sheetSummaries.set(key, {
        key,
        title: definition.title,
        gid: definition.gid,
        status: "missing",
        logicalRowCount: 0,
        nonEmptyRowCount: 0,
        parsedRecordCount: 0,
        checks: [missingCheck]
      });
      continue;
    }
    try {
      const records = parseManagementReportCsv(csv);
      recordsBySheet.set(key, records);
      const rowMap = new Map<number, ManagementReportSourceRow>();
      for (const record of records.filter(isNonEmptyRecord)) {
        const sourceRow: ManagementReportSourceRow = {
          ...record,
          sourceRowId: sourceRowId(key, record),
          sheetKey: key
        };
        rowMap.set(record.recordNumber, sourceRow);
        sourceRows.push(sourceRow);
      }
      sourceRowsBySheet.set(key, rowMap);
      sheetSummaries.set(key, {
        key,
        title: definition.title,
        gid: definition.gid,
        status: "ready",
        logicalRowCount: records.length,
        nonEmptyRowCount: rowMap.size,
        parsedRecordCount: 0,
        checks: []
      });
    } catch (error) {
      const csvError = error instanceof Error ? error.message : "Unknown CSV parsing error";
      const invalidCheck = check(key, "csv-invalid", "error", csvError);
      sheetSummaries.set(key, {
        key,
        title: definition.title,
        gid: definition.gid,
        status: "invalid",
        logicalRowCount: 0,
        nonEmptyRowCount: 0,
        parsedRecordCount: 0,
        checks: [invalidCheck]
      });
    }
  }

  const updateSummary = (
    key: ManagementReportSheetKey,
    parsedRecordCount: number,
    checks: ManagementReportCheck[],
    latestDate?: string
  ) => {
    const summary = sheetSummaries.get(key)!;
    summary.parsedRecordCount = parsedRecordCount;
    summary.checks.push(...checks);
    summary.latestDate = latestDate;
    if (summary.status !== "missing" && summary.status !== "invalid") {
      summary.status = summary.checks.some((item) => item.severity === "error")
        ? "invalid"
        : summary.checks.some((item) => item.severity === "warning")
          ? "ready-with-warnings"
          : "ready";
    }
  };

  const businessUnits: ManagementReportBusinessUnit[] = [];
  for (const key of ["vb-cp", "vb-wag", "vb-acp"] as const) {
    const records = recordsBySheet.get(key);
    if (!records) continue;
    const result = businessUnitFromTable(key, records);
    businessUnits.push(...result.units);
    updateSummary(key, result.parsedRecordCount, result.checks);
  }
  const inferredAsOf = businessUnits
    .map((unit) => unit.latestPeriod)
    .filter((period) => /^\d{4}-\d{2}-\d{2}$/.test(period))
    .sort()
    .at(-1);
  const reportAsOf = metadata.asOf ?? inferredAsOf ?? "1970-01-01";
  if (reportAsOf === "1970-01-01") {
    const cpSummary = sheetSummaries.get("vb-cp");
    cpSummary?.checks.push(check("vb-cp", "report-close-missing", "error", "The official management-report close date could not be inferred; pass metadata.asOf."));
    if (cpSummary) cpSummary.status = "invalid";
  }
  const restRecords = recordsBySheet.get("vb-rest");
  if (restRecords) {
    const result = restBusinessUnits(restRecords, reportAsOf);
    businessUnits.push(...result.units);
    updateSummary("vb-rest", result.parsedRecordCount, result.checks);
  }

  let ownership = emptyOwnership();
  const ownershipRecords = recordsBySheet.get("shareholders");
  if (ownershipRecords) {
    const result = parseOwnership(ownershipRecords);
    ownership = result.ownership;
    updateSummary("shareholders", result.parsedRecordCount, result.checks);
  }

  let platforms: ManagementReportPlatformPerformance[] = [];
  const platformRecords = recordsBySheet.get("plp");
  if (platformRecords) {
    const result = parsePlatforms(platformRecords);
    platforms = result.platforms;
    updateSummary("plp", result.parsedRecordCount, result.checks, platforms.map((item) => item.period).filter((period) => /^\d{4}/.test(period)).sort().at(-1));
  }

  let offers: ManagementReportOfferReconciliationEntry[] = [];
  let offerReconciliation = emptyOfferReconciliation();
  const offerRecords = recordsBySheet.get("wag-aff");
  if (offerRecords) {
    const result = parseOfferReconciliation(offerRecords);
    offers = result.offers;
    offerReconciliation = result.reconciliation;
    updateSummary("wag-aff", result.parsedRecordCount, result.checks);
  }

  let bankResult: BankParseResult = { entries: [], aggregates: [], recentEntries: [], checks: [] };
  const bankRecords = recordsBySheet.get("consolidated-bank");
  if (bankRecords) {
    bankResult = parseBankLedger(bankRecords, sourceRowsBySheet.get("consolidated-bank")!, reportAsOf);
    updateSummary("consolidated-bank", bankResult.entries.length, bankResult.checks, bankResult.latestDate);
  }

  const facts = [
    ...factsFromBusinessUnits(businessUnits),
    ...factsFromOwnership(ownership, reportAsOf),
    ...factsFromPlatforms(platforms),
    ...factsFromOffers(offers, reportAsOf)
  ];
  const duplicateFactCount = facts.length - new Set(facts.map((item) => item.factId)).size;
  if (duplicateFactCount > 0) {
    const summary = sheetSummaries.get("vb-cp")!;
    summary.checks.push(check("vb-cp", "duplicate-fact-ids", "error", `${duplicateFactCount} generated fact IDs are duplicated.`));
    summary.status = "invalid";
  }

  const summary = emptySummary();
  const consolidatedBusinessUnits = businessUnits.filter((unit) => unit.parentTeamId === undefined);
  summary.revenue = sum(consolidatedBusinessUnits.map((unit) => unit.actual.revenue));
  summary.marketingSpend = sum(consolidatedBusinessUnits.map((unit) => unit.actual.marketingSpend));
  summary.operatingSpend = sum(consolidatedBusinessUnits.map((unit) => unit.actual.operatingSpend));
  summary.grossProfit = sum(consolidatedBusinessUnits.map((unit) => unit.actual.grossProfit));
  summary.netProfit = sum(consolidatedBusinessUnits.map((unit) => unit.actual.netProfit));
  summary.netMargin = summary.revenue === 0 ? 0 : summary.netProfit / summary.revenue;
  summary.shareholderEquity = ownership.totalEquityBalance;
  const ytdPlatformTotal = platforms.find((item) => item.isTotal && /ytd/i.test(item.periodLabel));
  summary.platformRevenue = ytdPlatformTotal?.revenue ?? 0;
  summary.platformSpend = ytdPlatformTotal?.spend ?? 0;
  summary.platformProfit = ytdPlatformTotal?.profit ?? 0;
  const officialBankEntries = bankResult.entries.filter((entry) => entry.isIncludedInOfficialPeriod);
  summary.bankIncome = sum(officialBankEntries.filter((entry) => entry.accountType.toLowerCase() === "income").map((entry) => entry.amountUsd));
  summary.bankExpense = sum(officialBankEntries.filter((entry) => entry.accountType.toLowerCase().includes("expense")).map((entry) => entry.amountUsd));
  summary.bankNet = rounded(summary.bankIncome - summary.bankExpense);
  summary.offerRevenue = offerReconciliation.dashboardRevenue;
  summary.offerVariance = offerReconciliation.variance;

  const kpis: ManagementReportKpi[] = [
    { id: "ytd-revenue", label: "YTD revenue", value: summary.revenue, unit: "currency", currency: "USD", tone: "neutral" },
    { id: "ytd-net-profit", label: "YTD net profit", value: summary.netProfit, unit: "currency", currency: "USD", tone: summary.netProfit >= 0 ? "positive" : "negative" },
    { id: "net-margin", label: "Net margin", value: summary.netMargin, unit: "percent", tone: summary.netMargin >= 0 ? "positive" : "negative" },
    { id: "shareholder-equity", label: "Shareholder equity", value: summary.shareholderEquity, unit: "currency", currency: "USD", tone: "neutral" },
    { id: "platform-profit", label: "Platform profit", value: summary.platformProfit, unit: "currency", currency: "USD", tone: summary.platformProfit >= 0 ? "positive" : "negative" },
    { id: "offer-variance", label: "Offer reconciliation variance", value: summary.offerVariance, unit: "currency", currency: "USD", tone: Math.abs(summary.offerVariance) < 1 ? "positive" : "warning" }
  ];

  const checks = managementReportSheetKeys.flatMap((key) => sheetSummaries.get(key)!.checks);
  const status: ManagementReportDashboard["status"] = checks.some((item) => item.severity === "error")
    ? "invalid"
    : checks.some((item) => item.severity === "warning")
      ? "ready-with-warnings"
      : "ready";
  const importId = metadata.importId ?? `management-report:${stableHash([
    managementReportParserVersion,
    metadata.importedAt,
    ...managementReportSheetKeys.map((key) => `${key}:${stableHash(csvBySheet[key] ?? "")}`)
  ].join("|"))}`;
  const dashboard: ManagementReportDashboard = {
    metadata: {
      importId,
      importedAt: metadata.importedAt,
      sourceLabel: metadata.sourceLabel ?? "Manual management report upload",
      reportName: metadata.reportName ?? "Management Report",
      asOf: reportAsOf,
      officialBankThrough: reportAsOf
    },
    status,
    sheetSummaries: managementReportSheetKeys.map((key) => sheetSummaries.get(key)!),
    checks,
    kpis,
    summary,
    trend: buildTrend(businessUnits),
    businessUnits,
    ownership,
    platforms,
    offers,
    offerReconciliation,
    bank: {
      officialThrough: reportAsOf,
      totalEntryCount: bankResult.entries.length,
      officialEntryCount: officialBankEntries.length,
      postCloseEntryCount: bankResult.entries.filter((entry) => entry.isPostClose).length,
      unconvertedEntryCount: bankResult.entries.filter((entry) => entry.amountUsdSource === "missing").length,
      aggregates: bankResult.aggregates,
      recentEntries: bankResult.recentEntries
    }
  };
  return { dashboard, facts, bankEntries: bankResult.entries, sourceRows };
}
