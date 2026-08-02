export const analyticsPeriodModes = [
  "today",
  "yesterday",
  "this_week",
  "last_week",
  "this_month",
  "last_month",
  "month",
  "quarter",
  "ytd",
  "year",
  "custom"
] as const;

export type AnalyticsPeriodMode = (typeof analyticsPeriodModes)[number];

export interface AnalyticsPeriodSelection {
  mode: AnalyticsPeriodMode;
  year: number;
  month: number;
  quarter: number;
  fromDate?: string;
  toDate?: string;
}

export interface AnalyticsDateRange {
  fromDate: string;
  toDate: string;
}

function analyticsDateRangeKey(range: AnalyticsDateRange): string {
  return `${range.fromDate}:${range.toDate}`;
}

function uniqueAnalyticsDateRanges(ranges: AnalyticsDateRange[]): AnalyticsDateRange[] {
  const unique = new Map<string, AnalyticsDateRange>();
  for (const range of ranges) unique.set(analyticsDateRangeKey(range), range);
  return [...unique.values()];
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

function addUtcDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isoWeekStart(value: string): string {
  const day = new Date(`${value}T00:00:00Z`).getUTCDay();
  return addUtcDays(value, -(day === 0 ? 6 : day - 1));
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

  if (selection.mode === "today") {
    return { fromDate: today, toDate: today };
  }

  if (selection.mode === "yesterday") {
    const yesterday = addUtcDays(today, -1);
    return { fromDate: yesterday, toDate: yesterday };
  }

  if (selection.mode === "this_week") {
    return { fromDate: isoWeekStart(today), toDate: today };
  }

  if (selection.mode === "last_week") {
    const thisWeekStart = isoWeekStart(today);
    return {
      fromDate: addUtcDays(thisWeekStart, -7),
      toDate: addUtcDays(thisWeekStart, -1)
    };
  }

  if (selection.mode === "this_month") {
    return { fromDate: `${today.slice(0, 7)}-01`, toDate: today };
  }

  if (selection.mode === "last_month") {
    const thisMonthStart = `${today.slice(0, 7)}-01`;
    const previousMonthEnd = addUtcDays(thisMonthStart, -1);
    return {
      fromDate: `${previousMonthEnd.slice(0, 7)}-01`,
      toDate: previousMonthEnd
    };
  }

  if (selection.mode === "custom") {
    if (!selection.fromDate || !selection.toDate) {
      throw new Error("Custom analytics periods require a start and end date");
    }
    assertIsoDate(selection.fromDate);
    assertIsoDate(selection.toDate);
    if (selection.fromDate > selection.toDate) {
      throw new Error("Custom analytics period start must be on or before its end");
    }
    return { fromDate: selection.fromDate, toDate: selection.toDate };
  }

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
  if (selection.mode === "today") return "Today";
  if (selection.mode === "yesterday") return "Yesterday";
  if (selection.mode === "this_week") return "This week";
  if (selection.mode === "last_week") return "Last week";
  if (selection.mode === "this_month") return "This month";
  if (selection.mode === "last_month") return "Last month";
  if (selection.mode === "custom") return `${range.fromDate} – ${range.toDate}`;
  if (selection.mode === "ytd") return `${range.fromDate.slice(0, 4)} YTD`;
  if (selection.mode === "year") return String(selection.year);
  if (selection.mode === "quarter") return `Q${Math.min(4, Math.max(1, Math.trunc(selection.quarter)))} ${selection.year}`;
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
    year: "numeric"
  }).format(new Date(`${range.fromDate}T00:00:00Z`));
}

/** Live ranges that can change as new transactions arrive during the current day. */
export function analyticsCurrentPeriodRanges(today: string): AnalyticsDateRange[] {
  assertIsoDate(today);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const quarter = Math.floor((month - 1) / 3) + 1;
  return uniqueAnalyticsDateRanges([
    analyticsDateRange({ mode: "ytd", year, month, quarter }, today),
    analyticsDateRange({ mode: "month", year, month, quarter }, today),
    analyticsDateRange({ mode: "quarter", year, month, quarter }, today)
  ]);
}

/**
 * Bounded presets to warm while the dashboard is open. Current ranges come first,
 * followed by completed months and quarters from the current calendar year.
 */
export function analyticsPresetWarmRanges(today: string): AnalyticsDateRange[] {
  assertIsoDate(today);
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const quarter = Math.floor((month - 1) / 3) + 1;
  const ranges = analyticsCurrentPeriodRanges(today);

  for (let completedMonth = month - 1; completedMonth >= 1; completedMonth -= 1) {
    ranges.push(analyticsDateRange({ mode: "month", year, month: completedMonth, quarter }, today));
  }
  for (let completedQuarter = quarter - 1; completedQuarter >= 1; completedQuarter -= 1) {
    ranges.push(analyticsDateRange({ mode: "quarter", year, month, quarter: completedQuarter }, today));
  }

  return uniqueAnalyticsDateRanges(ranges);
}
