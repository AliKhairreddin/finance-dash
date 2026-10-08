import { readBoundedResponseJson } from "./boundedHttp";
import { redTrackCurrency, redTrackTimezone, validateRedTrackDates, type RedTrackRow, type RedTrackSource } from "./redtrack";

const pageSize = 1000;
const maximumRows = 8_000;
const reportFields = "date,network,network_id,offer,offer_id,source,source_id,campaign,campaign_id,revenue,conversions,total_revenue,total_conversions";
export class RedTrackRateLimitError extends Error {
  constructor(readonly retryAt: number) { super("RedTrack's request limit was reached. Try again after the provider's cooldown."); }
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("RedTrack returned an invalid report.");
  return value as Record<string, unknown>;
}
function label(value: unknown, empty: string): string {
  if (value === undefined || value === "") return empty;
  if (typeof value !== "string" || value.length > 500) throw new Error("RedTrack returned an invalid label.");
  return value.trim() || empty;
}
function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("RedTrack returned an incomplete revenue report. Please retry.");
  return value;
}

function requester(apiKey: string, fetcher: typeof fetch) {
  if (!apiKey) throw new Error("RedTrack is not connected. Configure its API key in the backend.");
  return async function get(path: string, parameters: Record<string, string>): Promise<unknown[]> {
    const url = new URL(path, "https://api.redtrack.io");
    url.search = new URLSearchParams(parameters).toString();
    const response = await fetcher(url, { headers: { "X-Auth-Token": apiKey, Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) {
      void response.body?.cancel();
      if (response.status === 401 || response.status === 403) throw new Error("RedTrack rejected access. Check the API key and account permissions.");
      if (response.status === 429) {
        const retry = response.headers.get("Retry-After");
        const retryAt = retry && /^\d+$/.test(retry) ? Date.now() + Number(retry) * 1000 : retry ? Date.parse(retry) : NaN;
        throw new RedTrackRateLimitError(Number.isFinite(retryAt) ? Math.max(Date.now() + 1000, retryAt) : Date.now() + 60_000);
      }
      throw new Error(`RedTrack is unavailable (HTTP ${response.status}). Please retry.`);
    }
    const body = await readBoundedResponseJson<unknown>(response, "RedTrack", 12_000_000);
    // These two endpoints document a bare array (null for an empty directory).
    if (path === "/networks" && body === null) return [];
    if (!Array.isArray(body)) throw new Error("RedTrack returned an invalid report.");
    return body;
  };
}

export async function fetchRedTrackRows(apiKey: string, fromDate: string, toDate: string, fetcher: typeof fetch = fetch): Promise<RedTrackRow[]> {
  validateRedTrackDates(fromDate, toDate);
  const get = requester(apiKey, fetcher);
  const rows: RedTrackRow[] = [], seen = new Set<string>();
  // Do not use total=true: the live API applies pagination twice to items on
  // later pages. Bare report pages contain the complete rows and all metrics.
  for (let page = 1; ; page++) {
    const batch = await get("/report", { date_from: fromDate, date_to: toDate, timezone: redTrackTimezone,
      group: "date,network,offer,source,campaign", fields: reportFields, click_time: "false", page: String(page), per: String(pageSize) });
    if (rows.length + batch.length > maximumRows) throw new Error("This RedTrack report is too large. Choose a shorter date range.");
    for (const item of batch) {
      const raw = record(item);
      const date = label(raw.date, "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < fromDate || date > toDate) throw new Error("RedTrack returned a row outside the requested period.");
      const row: RedTrackRow = {
        key: "", date, offerSourceId: label(raw.network_id, ""), offerSource: label(raw.network, "Unassigned offer source"),
        offerId: label(raw.offer_id, ""), offer: label(raw.offer, "Unassigned offer"),
        trafficChannelId: label(raw.source_id, ""), trafficChannel: label(raw.source, "Unassigned traffic channel"),
        campaignId: label(raw.campaign_id, ""), campaign: label(raw.campaign, "Unassigned campaign"),
        revenue: number(raw.revenue), conversions: number(raw.conversions),
        allRevenue: number(raw.total_revenue), allConversions: number(raw.total_conversions)
      };
      if (![row.conversions, row.allConversions].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error("RedTrack returned invalid conversion counts.");
      row.key = JSON.stringify([date, row.offerSourceId || row.offerSource, row.offerId || row.offer, row.trafficChannelId || row.trafficChannel, row.campaignId || row.campaign]);
      if (seen.has(row.key)) throw new Error("RedTrack repeated report rows. Refresh or choose a shorter period.");
      seen.add(row.key); rows.push(row);
    }
    // When pagination is disabled, RedTrack returns the entire result.
    if (batch.length !== pageSize) break;
  }
  // An independent daily rollup detects truncated pages and changing reports
  // before any saved day is replaced, including empty results.
  const controls = await get("/report", { date_from: fromDate, date_to: toDate, timezone: redTrackTimezone,
    group: "date", fields: "date,revenue,conversions,total_revenue,total_conversions", click_time: "false", page: "1", per: String(pageSize) });
  const totals = new Map<string, number[]>();
  for (const row of rows) {
    const total = totals.get(row.date) ?? [0, 0, 0, 0];
    [row.revenue, row.conversions, row.allRevenue, row.allConversions].forEach((value, index) => { total[index] += value; });
    totals.set(row.date, total);
  }
  const controlDates = new Set<string>();
  for (const item of controls) {
    const raw = record(item), date = label(raw.date, "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < fromDate || date > toDate || controlDates.has(date)) throw new Error("RedTrack returned invalid daily control totals.");
    controlDates.add(date);
    const expected = [number(raw.revenue), number(raw.conversions), number(raw.total_revenue), number(raw.total_conversions)];
    const actual = totals.get(date) ?? [0, 0, 0, 0];
    if (actual.some((value, index) => Math.abs(value - expected[index]) > (index % 2 === 0 ? 0.001 : 0))) {
      throw new Error("RedTrack detail and daily totals do not match, possibly because revenue changed during sync. Saved data was not replaced. Retry the sync.");
    }
    totals.delete(date);
  }
  if ([...totals.values()].some(values => values.some(value => value !== 0))) throw new Error("RedTrack omitted daily control totals. Saved data was not replaced.");
  if (new TextEncoder().encode(JSON.stringify(rows)).length > 4_000_000) throw new Error("Choose a shorter date range; this revenue report is too large.");
  return rows;
}

export async function fetchRedTrackSources(apiKey: string, fetcher: typeof fetch = fetch): Promise<RedTrackSource[]> {
  const get = requester(apiKey, fetcher), sources: RedTrackSource[] = [];
  for (let page = 1; ; page++) {
    const batch = await get("/networks", { page: String(page), per: String(pageSize) });
    if (sources.length + batch.length > 2000) throw new Error("The RedTrack source directory exceeds the supported size.");
    for (const item of batch) {
      const raw = record(item), id = label(raw.id, "");
      if (!/^[a-f0-9]{24}$/.test(id) || sources.some(source => source.id === id)) throw new Error("RedTrack returned an invalid offer source directory.");
      sources.push({ id, name: label(raw.title, id) });
    }
    if (batch.length < pageSize) break;
  }
  return sources;
}

export async function fetchRedTrackReport(apiKey: string, fromDate: string, toDate: string, fetcher: typeof fetch = fetch) {
  const rows = await fetchRedTrackRows(apiKey, fromDate, toDate, fetcher), sources = await fetchRedTrackSources(apiKey, fetcher);
  return { rows, sources, fromDate, toDate, currency: redTrackCurrency, timezone: redTrackTimezone, fetchedAt: new Date().toISOString() };
}
