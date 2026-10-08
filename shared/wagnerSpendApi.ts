import { readBoundedResponseJson } from "./boundedHttp";
import {
  validateWagnerDateRange, wagnerBreakdowns, wagnerFilters, wagnerValueLabels, wagnerRefreshAfter,
  type WagnerBreakdown, type WagnerDimensions, type WagnerSpendResponse, type WagnerSpendRow
} from "./wagnerSpend";

export type WagnerCacheEntry = { payload: string; savedAt: number; refreshAfter: number | null };
export type WagnerSpendCache = {
  acquire(key: string, attemptId: string): Promise<({ status: "cached" } & WagnerCacheEntry) | { status: "claimed" | "busy" }>;
  save(key: string, attemptId: string, entry: WagnerCacheEntry): Promise<void>;
  release(key: string, attemptId: string): Promise<void>;
};

class WagnerApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function invalid(): never { throw new WagnerApiError(502, "Wagner returned an invalid spend response. Please retry."); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function amount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : invalid();
}
function nullableText(value: unknown): string | null {
  return value === null || (typeof value === "string" && value.length > 0) ? value : invalid();
}
function text(value: unknown): string { return nullableText(value) ?? invalid(); }
function isoDate(value: unknown): string {
  const date = text(value);
  try { validateWagnerDateRange(date, date); } catch { return invalid(); }
  return date;
}
function totalCost(spend: number, commission: number): number { return Math.round((spend + commission) * 100) / 100; }

export function parseWagnerSpend(value: unknown, fromDate: string, toDate: string, groupBy: WagnerBreakdown): WagnerSpendResponse {
  const data = record(value);
  if (data.from !== fromDate || data.to !== toDate || data.currency !== "USD"
    || !Array.isArray(data.group_by) || data.group_by.length !== 1 || data.group_by[0] !== groupBy
    || !Array.isArray(data.rows) || data.rows.length > 10_000) return invalid();
  const totals = record(data.totals);
  if (totals.rows !== data.rows.length) return invalid();
  const spend = amount(totals.spend_usd), commission = amount(totals.commission_usd);
  const keys = new Set<string>();
  const rows: WagnerSpendRow[] = data.rows.map(value => {
    const row = record(value);
    const named = ["agency", "ad_account", "buyer", "team"].includes(groupBy);
    const id = nullableText(row[named ? `${groupBy}_id` : groupBy]);
    const name = named ? nullableText(row[`${groupBy}_name`]) : id;
    if (groupBy === "date" && (isoDate(id) < fromDate || isoDate(id) > toDate)) return invalid();
    const key = id ?? "none";
    if (keys.has(key)) return invalid();
    keys.add(key);
    const spend = amount(row.spend_usd), commission = amount(row.commission_usd);
    return {
      key, label: name ? (wagnerValueLabels[name] ?? name) : "Unassigned",
      accountId: groupBy === "ad_account" ? nullableText(row.meta_act_id) ?? id : null,
      spend, commission, total: totalCost(spend, commission)
    };
  });
  // Each source row is rounded separately; retain exact source totals and allow only cent-rounding drift.
  for (const [field, exact] of [["spend", spend], ["commission", commission]] as const) {
    if (Math.abs(rows.reduce((sum, row) => sum + row[field], 0) - exact) > (rows.length + 1) * 0.005 + 0.000001) return invalid();
  }
  const generatedAt = text(data.generated_at);
  if (!Number.isFinite(Date.parse(generatedAt))) return invalid();
  return {
    fromDate, toDate, groupBy, currency: "USD", generatedAt,
    dataThrough: data.data_through === null ? null : isoDate(data.data_through),
    totals: { spend, commission, total: totalCost(spend, commission) }, rows
  };
}

export function parseWagnerDimensions(value: unknown): WagnerDimensions {
  const data = record(value);
  const fields = { agency: "agencies", ad_account: "ad_accounts", buyer: "buyers", team: "teams", source: "sources", vertical: "verticals", category: "categories" } as const;
  const entries = wagnerFilters.map(filter => {
    const items = data[fields[filter]];
    if (!Array.isArray(items) || items.length > 10_000) return invalid();
    return [filter, items.map(item => {
      const row = record(item), id = nullableText(row.id), name = nullableText(row.name);
      return { value: id ?? "none", label: name ? (wagnerValueLabels[name] ?? name) : "Unassigned" };
    }).sort((a, b) => a.label.localeCompare(b.label))];
  });
  return Object.fromEntries(entries) as WagnerDimensions;
}

/** Called only behind the dashboard's session and role checks. The source key never reaches the browser. */
export async function handleWagnerSpendApi(url: URL, apiKey: string | undefined, cache: WagnerSpendCache): Promise<Response> {
  const reply = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
  let claimedKey: string | undefined;
  const attemptId = crypto.randomUUID();
  try {
    const dimensions = url.pathname.endsWith("/dimensions");
    const upstream = new URL(`https://www.inchops.com/api/finance/v1/${dimensions ? "dimensions" : "spend"}`);
    let fromDate = "", toDate = "", groupBy: WagnerBreakdown = "agency";
    if (!dimensions) {
      fromDate = url.searchParams.get("fromDate") ?? "";
      toDate = url.searchParams.get("toDate") ?? "";
      try { validateWagnerDateRange(fromDate, toDate); }
      catch (error) { throw new WagnerApiError(400, (error as Error).message); }
      const group = url.searchParams.get("groupBy") ?? "agency";
      if (!wagnerBreakdowns.includes(group as WagnerBreakdown)) throw new WagnerApiError(400, "Choose a valid Wagner spend breakdown.");
      groupBy = group as WagnerBreakdown;
      upstream.searchParams.set("from", fromDate);
      upstream.searchParams.set("to", toDate);
      upstream.searchParams.set("group_by", groupBy);
      for (const filter of wagnerFilters) {
        const value = url.searchParams.get(filter);
        if (!value) continue;
        if (value.length > 500 || /[\x00-\x1f]/.test(value)) throw new WagnerApiError(400, "Wagner spend filter is invalid.");
        upstream.searchParams.set(filter, value.split(",").map(item => item.trim().toLowerCase()).filter(Boolean).sort().join(","));
      }
    }
    const key = `wagner:v1:${upstream.pathname}?${upstream.searchParams}`;
    let cached = await cache.acquire(key, attemptId);
    for (let wait = 0; cached.status === "busy" && wait < 8; wait++) {
      await new Promise(resolve => setTimeout(resolve, 250));
      cached = await cache.acquire(key, attemptId);
    }
    if (cached.status === "busy") throw new WagnerApiError(409, "This Wagner report is being saved. Please retry shortly.");
    const parse = (value: unknown) => dimensions ? parseWagnerDimensions(value) : parseWagnerSpend(value, fromDate, toDate, groupBy);
    const result = (data: ReturnType<typeof parse>, entry: WagnerCacheEntry) => dimensions ? data : {
      ...data, savedAt: new Date(entry.savedAt).toISOString(), refreshAfter: entry.refreshAfter === null ? null : new Date(entry.refreshAfter).toISOString()
    };
    if (cached.status === "cached") return reply(result(parse(JSON.parse(cached.payload)), cached));
    claimedKey = key;
    if (!apiKey?.trim()) throw new WagnerApiError(503, "Wagner spend is not configured.");
    const response = await fetch(upstream, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      redirect: "error", signal: AbortSignal.timeout(30_000)
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new WagnerApiError(502, response.status === 401 || response.status === 403
        ? "Wagner rejected the API credentials. Ask an administrator to update the connection."
        : response.status === 429 ? "Wagner is rate limiting requests. Please retry shortly."
        : "Wagner spend is unavailable. Please retry shortly.");
    }
    const data = await readBoundedResponseJson(response, "Wagner", 4 * 1024 * 1024);
    const parsed = parse(data);
    const savedAt = Date.now();
    const entry = {
      payload: JSON.stringify(data), savedAt,
      refreshAfter: wagnerRefreshAfter(savedAt, dimensions ? null : toDate, dimensions ? null : (parsed as WagnerSpendResponse).dataThrough)
    };
    await cache.save(key, attemptId, entry);
    claimedKey = undefined;
    return reply(result(parsed, entry));
  } catch (error) {
    if (claimedKey) await cache.release(claimedKey, attemptId).catch(() => undefined);
    return reply({ message: error instanceof WagnerApiError ? error.message : "Wagner spend could not be loaded. Please retry." }, error instanceof WagnerApiError ? error.status : 502);
  }
}
