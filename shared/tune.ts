import { readBoundedResponseText } from "./boundedHttp";

type TuneTotals = { revenue: number; clicks: number; conversions: number };
type DateRange = { periodStart: string; periodEnd: string };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function metric(stat: Record<string, unknown>, field: string): number {
  const value = stat[field];
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") {
    throw new Error(`TUNE report is missing ${field}`);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || (field !== "payout" && (!Number.isSafeInteger(number) || number < 0))) {
    throw new Error(`TUNE report has invalid ${field}`);
  }
  return number;
}

/** Accept only a complete daily report whose rows reconcile to the provider totals. */
export function summarizeTuneReport(value: unknown, period: DateRange): TuneTotals {
  if (!record(value) || !record(value.response) || value.response.status !== 1 || value.response.errorMessage) {
    throw new Error("TUNE revenue request failed or returned an invalid response");
  }
  const report = value.response.data;
  if (!record(report) || !Array.isArray(report.data) || report.page !== 1) {
    throw new Error("TUNE report is missing report data or pagination");
  }
  // TUNE's successful no-activity response uses null counts and an empty totals array.
  if (report.count === null && report.pageCount === null && report.data.length === 0 &&
      Array.isArray(report.totals) && report.totals.length === 0) {
    return { revenue: 0, clicks: 0, conversions: 0 };
  }
  if (!Number.isSafeInteger(report.count) || report.count !== report.data.length || report.pageCount !== 1) {
    throw new Error("TUNE report is incomplete; saved revenue was not replaced");
  }
  if (!record(report.totals) || !record(report.totals.Stat)) {
    throw new Error("TUNE report is missing financial totals");
  }
  const totals: TuneTotals = { revenue: 0, clicks: 0, conversions: 0 };
  const dates = new Set<string>();
  for (const row of report.data) {
    if (!record(row) || !record(row.Stat)) throw new Error("TUNE report contains an invalid row");
    const stat = row.Stat;
    const date = stat.date;
    if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date ||
        date < period.periodStart || date > period.periodEnd || dates.has(date)) {
      throw new Error("TUNE report contains a duplicate or out-of-period date");
    }
    dates.add(date);
    totals.revenue += metric(stat, "payout");
    totals.clicks += metric(stat, "clicks");
    totals.conversions += metric(stat, "conversions");
  }
  if (Math.abs(totals.revenue - metric(report.totals.Stat, "payout")) > 0.0001 ||
      totals.clicks !== metric(report.totals.Stat, "clicks") ||
      totals.conversions !== metric(report.totals.Stat, "conversions")) {
    throw new Error("TUNE report rows do not reconcile with financial totals");
  }
  return { ...totals, revenue: Number(totals.revenue.toFixed(2)) };
}

export async function fetchTuneTotals(url: string, period: DateRange): Promise<TuneTotals> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
  } catch {
    // The URL contains a credential; never propagate fetch errors that might include it.
    throw new Error("TUNE revenue request failed or timed out");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`TUNE revenue request failed (HTTP ${response.status}); retry on the next scheduled sync`);
  }
  const text = await readBoundedResponseText(response, "TUNE", 2 * 1024 * 1024);
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error("TUNE returned invalid JSON"); }
  return summarizeTuneReport(value, period);
}
