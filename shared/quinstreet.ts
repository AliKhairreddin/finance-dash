export const quinStreetReportingBaseUrl = "https://reporting.qmp.ai";
export const quinStreetMaximumReportRecords = 15_000;

export interface QuinStreetReportSummary {
  revenue: number;
  rowCount: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function revenueValue(row: Record<string, unknown>, field: string, index: number): number {
  if (!(field in row)) {
    throw new Error(`QuinStreet report row ${index + 1} is missing revenue column "${field}"`);
  }
  const value = row[field];
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") {
    throw new Error(`QuinStreet report row ${index + 1} has an invalid "${field}" value`);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`QuinStreet report row ${index + 1} has a non-numeric "${field}" value`);
  }
  return parsed;
}

export function summarizeQuinStreetReport(payload: unknown, revenueField: string): QuinStreetReportSummary {
  const field = revenueField.trim();
  if (!field) throw new Error("QuinStreet revenue column is required");
  if (!Array.isArray(payload) || !payload.every(isRecord)) {
    throw new Error("QuinStreet report response must be a JSON array of report rows");
  }
  if (payload.length >= quinStreetMaximumReportRecords) {
    throw new Error("QuinStreet report reached the 15,000-row API limit; use a shorter date range");
  }
  const revenue = payload.reduce((total, row, index) => total + revenueValue(row, field, index), 0);
  return { revenue: Number(revenue.toFixed(2)), rowCount: payload.length };
}
