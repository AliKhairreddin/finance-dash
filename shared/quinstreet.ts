export const quinStreetReportingBaseUrl = "https://reporting.qmp.ai";
export const quinStreetMaximumReportRecords = 15_000;

export interface QuinStreetReportSummary {
  revenue: number;
  rowCount: number;
}

interface QuinStreetReportOptions {
  categoryField: string;
  categoryValue: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function requiredColumnIndex(columns: string[], field: string): number {
  const index = columns.indexOf(field);
  if (index === -1) throw new Error(`QuinStreet report is missing column "${field}"`);
  return index;
}

function requiredCell(row: Record<string, unknown>, columnIndex: number, field: string, rowIndex: number): unknown {
  const key = String(columnIndex);
  if (!(key in row)) throw new Error(`QuinStreet report row ${rowIndex + 1} is missing column "${field}"`);
  return row[key];
}

function revenueValue(value: unknown, field: string, rowIndex: number): number {
  if (value === null) return 0;
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") {
    throw new Error(`QuinStreet report row ${rowIndex + 1} has an invalid "${field}" value`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`QuinStreet report row ${rowIndex + 1} has a non-numeric "${field}" value`);
  }
  return parsed;
}

function reportRecordCount(value: unknown): number {
  const recordCount = typeof value === "number" || typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isInteger(recordCount) || recordCount < 0) {
    throw new Error("QuinStreet report has an invalid numberOfRecords value");
  }
  return recordCount;
}

export function summarizeQuinStreetReport(
  payload: unknown,
  revenueField: string,
  options: QuinStreetReportOptions
): QuinStreetReportSummary {
  const field = revenueField.trim();
  const categoryField = options.categoryField.trim();
  const categoryValue = options.categoryValue.trim();
  if (!field) throw new Error("QuinStreet revenue column is required");
  if (!categoryField || !categoryValue) throw new Error("QuinStreet category column and value are required");
  if (!isRecord(payload) || !isRecord(payload.data)) {
    throw new Error("QuinStreet report response must contain a data object");
  }

  const { columns, records, numberOfRecords } = payload.data;
  if (!Array.isArray(columns) || !columns.every((column) => typeof column === "string" && column.trim())) {
    throw new Error("QuinStreet report response must contain a string columns array");
  }
  if (!Array.isArray(records) || !records.every(isRecord)) {
    throw new Error("QuinStreet report response must contain an indexed records array");
  }

  const recordCount = reportRecordCount(numberOfRecords);
  if (recordCount >= quinStreetMaximumReportRecords || records.length >= quinStreetMaximumReportRecords) {
    throw new Error("QuinStreet report reached the 15,000-row API limit; use a shorter date range");
  }
  if (recordCount !== records.length) {
    throw new Error("QuinStreet report record count does not match the returned rows");
  }

  const revenueIndex = requiredColumnIndex(columns, field);
  const categoryIndex = requiredColumnIndex(columns, categoryField);
  const normalizedCategory = categoryValue.toLocaleLowerCase();
  let rowCount = 0;
  const revenue = records.reduce((total, row, rowIndex) => {
    const category = requiredCell(row, categoryIndex, categoryField, rowIndex);
    if (typeof category !== "string") {
      throw new Error(`QuinStreet report row ${rowIndex + 1} has an invalid "${categoryField}" value`);
    }
    if (category.trim().toLocaleLowerCase() !== normalizedCategory) return total;
    rowCount += 1;
    return total + revenueValue(requiredCell(row, revenueIndex, field, rowIndex), field, rowIndex);
  }, 0);

  return { revenue: Number(revenue.toFixed(2)), rowCount };
}
