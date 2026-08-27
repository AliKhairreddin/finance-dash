export const mediaSpendSource = "lemonmax" as const;
export const mediaSpendCurrency = "USD" as const;
export const mediaSpendMaximumRangeDays = 92;

export interface MediaSpendRow {
  key: string;
  source: typeof mediaSpendSource;
  workspace: number;
  date: string;
  platform: string;
  businessManagerId: string;
  businessManagerName: string;
  accountId: string;
  accountName: string;
  spend: number;
  currency: string;
  syncedAt: string;
}

export type MediaSpendSyncStatus = "never" | "running" | "healthy" | "failed";

export interface MediaSpendSyncState {
  status: MediaSpendSyncStatus;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  coveredThrough?: string;
  requestedFrom?: string;
  requestedTo?: string;
  rowCount?: number;
  totalSpend?: number;
  lastError?: string;
}

export interface MediaSpendSummary {
  totalSpend: number;
  days: number;
  platforms: number;
  businessManagers: number;
  accounts: number;
}

export interface MediaSpendApiResponse {
  version: 1;
  fromDate: string;
  toDate: string;
  currency: string;
  configured: boolean;
  missingConfiguration: string[];
  rows: MediaSpendRow[];
  summary: MediaSpendSummary;
  sync: MediaSpendSyncState;
}

type LemonMaxSpendPayload = {
  success: true;
  message: string;
  data: unknown[];
};

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validIsoDate(value: string): boolean {
  if (!isoDatePattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function requiredString(
  row: Record<string, unknown>,
  field: string,
  rowNumber: number,
  maximumLength = 500
): string {
  const value = row[field];
  if (
    typeof value !== "string"
    || value !== value.trim()
    || value.length === 0
    || value.length > maximumLength
    || /[\u0000-\u001f\u007f-\u009f]/u.test(value)
  ) {
    throw new Error(`LemonMax row ${rowNumber} has an invalid ${field}`);
  }
  return value;
}

function mediaSpendRowKey(row: Pick<
  MediaSpendRow,
  "accountId" | "businessManagerId" | "date" | "platform" | "workspace"
>): string {
  return [
    row.date,
    String(row.workspace),
    row.platform,
    row.businessManagerId,
    row.accountId
  ].map(encodeURIComponent).join(":");
}

export function parseLemonMaxSpendSummary(
  value: unknown,
  expectedDate: string,
  currency: string,
  syncedAt: string
): MediaSpendRow[] {
  return parseLemonMaxSpendSummaryRange(value, expectedDate, expectedDate, currency, syncedAt);
}

export function parseLemonMaxSpendSummaryRange(
  value: unknown,
  expectedFromDate: string,
  expectedToDate: string,
  currency: string,
  syncedAt: string
): MediaSpendRow[] {
  if (!validIsoDate(expectedFromDate) || !validIsoDate(expectedToDate) || expectedFromDate > expectedToDate) {
    throw new Error("LemonMax expected date range is invalid");
  }
  if (!/^[A-Z0-9]{2,12}$/.test(currency)) throw new Error("LemonMax spend currency is invalid");
  if (Number.isNaN(Date.parse(syncedAt))) throw new Error("LemonMax sync timestamp is invalid");
  if (!isRecord(value) || value.success !== true || typeof value.message !== "string" || !Array.isArray(value.data)) {
    throw new Error("LemonMax returned an invalid account spend summary");
  }

  const payload = value as LemonMaxSpendPayload;
  const keys = new Set<string>();
  return payload.data.map((item, index) => {
    const rowNumber = index + 1;
    if (!isRecord(item)) throw new Error(`LemonMax row ${rowNumber} is invalid`);

    const workspace = item.Workspace;
    const spend = item.Spend;
    if (!Number.isSafeInteger(workspace) || Number(workspace) < 0) {
      throw new Error(`LemonMax row ${rowNumber} has an invalid Workspace`);
    }
    if (typeof spend !== "number" || !Number.isFinite(spend)) {
      throw new Error(`LemonMax row ${rowNumber} has an invalid Spend`);
    }

    const date = requiredString(item, "Date", rowNumber, 10);
    if (!validIsoDate(date) || date < expectedFromDate || date > expectedToDate) {
      throw new Error(`LemonMax row ${rowNumber} does not match the requested date range`);
    }

    const parsed: MediaSpendRow = {
      key: "",
      source: mediaSpendSource,
      workspace: Number(workspace),
      date,
      platform: requiredString(item, "Platform", rowNumber, 80),
      businessManagerId: requiredString(item, "BM ID", rowNumber, 160),
      businessManagerName: requiredString(item, "BM Name", rowNumber),
      accountId: requiredString(item, "Account ID", rowNumber, 160),
      accountName: requiredString(item, "Account Name", rowNumber),
      spend,
      currency,
      syncedAt
    };
    parsed.key = mediaSpendRowKey(parsed);
    if (keys.has(parsed.key)) throw new Error(`LemonMax returned duplicate row ${rowNumber}`);
    keys.add(parsed.key);
    return parsed;
  });
}

export function mediaSpendYesterdayInIndia(now: Date | number): string {
  const timestamp = typeof now === "number" ? now : now.getTime();
  const indiaDate = new Date(timestamp + 330 * 60 * 1_000).toISOString().slice(0, 10);
  const yesterday = new Date(`${indiaDate}T00:00:00.000Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  return yesterday.toISOString().slice(0, 10);
}

export function validateMediaSpendDateRange(fromDate: string, toDate: string): void {
  if (!validIsoDate(fromDate) || !validIsoDate(toDate) || fromDate > toDate) {
    throw new Error("Media spend date range is invalid");
  }
  const from = Date.parse(`${fromDate}T00:00:00.000Z`);
  const to = Date.parse(`${toDate}T00:00:00.000Z`);
  const days = Math.floor((to - from) / 86_400_000) + 1;
  if (days > mediaSpendMaximumRangeDays) {
    throw new Error(`Media spend date range cannot exceed ${mediaSpendMaximumRangeDays} days`);
  }
}

export function summarizeMediaSpend(rows: readonly MediaSpendRow[]): MediaSpendSummary {
  return {
    totalSpend: rows.reduce((total, row) => total + row.spend, 0),
    days: new Set(rows.map((row) => row.date)).size,
    platforms: new Set(rows.map((row) => row.platform)).size,
    businessManagers: new Set(rows.map((row) => `${row.platform}:${row.businessManagerId}`)).size,
    accounts: new Set(rows.map((row) => `${row.platform}:${row.accountId}`)).size
  };
}
