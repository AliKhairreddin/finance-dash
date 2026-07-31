export const analyticsPeriodModes = ["month", "quarter", "ytd", "year"] as const;

export type AnalyticsPeriodMode = (typeof analyticsPeriodModes)[number];

export interface AnalyticsPeriodSelection {
  mode: AnalyticsPeriodMode;
  year: number;
  month: number;
  quarter: number;
}

export interface AnalyticsDateRange {
  fromDate: string;
  toDate: string;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function assertIsoDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Expected an ISO date, received "${value}"`);
  }
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function throughToday(fromDate: string, toDate: string, today: string): AnalyticsDateRange {
  return {
    fromDate,
    toDate: fromDate <= today && toDate > today ? today : toDate
  };
}

export function analyticsDateRange(
  selection: AnalyticsPeriodSelection,
  today: string
): AnalyticsDateRange {
  assertIsoDate(today);
  const currentYear = Number(today.slice(0, 4));
  const year = Math.trunc(selection.year);

  if (selection.mode === "ytd") {
    return {
      fromDate: `${currentYear}-01-01`,
      toDate: today
    };
  }

  if (selection.mode === "year") {
    return throughToday(`${year}-01-01`, `${year}-12-31`, today);
  }

  if (selection.mode === "quarter") {
    const quarter = Math.min(4, Math.max(1, Math.trunc(selection.quarter)));
    const startMonth = (quarter - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    return throughToday(
      `${year}-${pad2(startMonth)}-01`,
      `${year}-${pad2(endMonth)}-${pad2(lastDayOfMonth(year, endMonth))}`,
      today
    );
  }

  const month = Math.min(12, Math.max(1, Math.trunc(selection.month)));
  return throughToday(
    `${year}-${pad2(month)}-01`,
    `${year}-${pad2(month)}-${pad2(lastDayOfMonth(year, month))}`,
    today
  );
}

export function analyticsPeriodLabel(
  selection: AnalyticsPeriodSelection,
  today: string
): string {
  const range = analyticsDateRange(selection, today);
  if (selection.mode === "ytd") return `${range.fromDate.slice(0, 4)} YTD`;
  if (selection.mode === "year") return String(selection.year);
  if (selection.mode === "quarter") return `Q${Math.min(4, Math.max(1, Math.trunc(selection.quarter)))} ${selection.year}`;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
    year: "numeric"
  }).format(new Date(`${range.fromDate}T00:00:00Z`));
}
