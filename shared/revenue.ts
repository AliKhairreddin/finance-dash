import type { RevenueMetrics, RevenuePartner, RevenuePeriodPreset, RevenueRun } from "./types";

const dayMs = 24 * 60 * 60 * 1000;

const weekdayByName: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
};

export interface RevenuePeriod {
  preset: RevenuePeriodPreset;
  periodStart: string;
  periodEnd: string;
  timezone: string;
}

export function resolveRevenuePeriod({
  periodPreset = "last-week",
  periodStart,
  periodEnd,
  timezone = "America/New_York",
  now = new Date()
}: {
  periodPreset?: RevenuePeriodPreset;
  periodStart?: string;
  periodEnd?: string;
  timezone?: string;
  now?: Date;
}): RevenuePeriod {
  if (periodPreset === "custom" && isDateOnly(periodStart) && isDateOnly(periodEnd)) {
    return { preset: periodPreset, periodStart, periodEnd, timezone };
  }

  const current = zonedDateStamp(now, timezone);

  if (periodPreset === "last-7-days") {
    return {
      preset: periodPreset,
      periodStart: addDays(current.date, -6),
      periodEnd: current.date,
      timezone
    };
  }

  if (periodPreset === "this-month") {
    return {
      preset: periodPreset,
      periodStart: `${current.year}-${pad2(current.month)}-01`,
      periodEnd: current.date,
      timezone
    };
  }

  const daysSinceMonday = (current.weekday + 6) % 7;
  const thisMonday = addDays(current.date, -daysSinceMonday);
  return {
    preset: "last-week",
    periodStart: addDays(thisMonday, -7),
    periodEnd: addDays(thisMonday, -1),
    timezone
  };
}

export function calculateInvoiceDueDate(periodEnd: string, invoiceDueDays: number): string {
  return addDays(periodEnd, Math.max(0, invoiceDueDays));
}

export function calculateTuneHourOffset(timezone: string, networkTimezone: string, date: string): number {
  const selectedOffset = timezoneOffsetMinutes(timezone, date);
  const networkOffset = timezoneOffsetMinutes(networkTimezone, date);
  return Math.round((selectedOffset - networkOffset) / 60);
}

export function calculateRevenueMetrics(partners: RevenuePartner[], runs: RevenueRun[]): RevenueMetrics {
  const billableRuns = runs.filter((run) => run.status !== "failed" && run.status !== "skipped");
  const invoicedRuns = runs.filter((run) => run.status === "invoiced");
  const pendingRuns = runs.filter((run) => run.status === "pulled" || run.status === "mock");
  const lastRunAt = runs.reduce<string | undefined>((latest, run) => (!latest || run.createdAt > latest ? run.createdAt : latest), undefined);

  return {
    totalRevenue: billableRuns.reduce((sum, run) => sum + run.revenue, 0),
    invoicedRevenue: invoicedRuns.reduce((sum, run) => sum + run.revenue, 0),
    pendingRevenue: pendingRuns.reduce((sum, run) => sum + run.revenue, 0),
    failedRuns: runs.filter((run) => run.status === "failed").length,
    partnerCount: partners.filter((partner) => partner.enabled).length,
    lastRunAt
  };
}

function timezoneOffsetMinutes(timezone: string, date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const anchor = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(anchor);
  const zonedAsUtc = Date.UTC(
    Number(parts.find((part) => part.type === "year")?.value),
    Number(parts.find((part) => part.type === "month")?.value) - 1,
    Number(parts.find((part) => part.type === "day")?.value),
    Number(parts.find((part) => part.type === "hour")?.value) % 24,
    Number(parts.find((part) => part.type === "minute")?.value),
    Number(parts.find((part) => part.type === "second")?.value)
  );
  return (zonedAsUtc - anchor.getTime()) / 60000;
}

function zonedDateStamp(now: Date, timezone: string): { date: string; year: number; month: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);

  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  const weekdayName = parts.find((part) => part.type === "weekday")?.value ?? "Mon";

  return {
    date: `${year}-${pad2(month)}-${pad2(day)}`,
    year,
    month,
    weekday: weekdayByName[weekdayName] ?? 1
  };
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) + days * dayMs).toISOString().slice(0, 10);
}

function isDateOnly(value?: string): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
