export const wagnerBreakdowns = ["agency", "ad_account", "buyer", "team", "source", "vertical", "category", "date"] as const;
export type WagnerBreakdown = typeof wagnerBreakdowns[number];
export const wagnerFilters = ["agency", "ad_account", "buyer", "team", "source", "vertical", "category"] as const;
export type WagnerFilter = typeof wagnerFilters[number];
export const wagnerLabels: Record<WagnerBreakdown, string> = {
  agency: "Agency", ad_account: "Ad account", buyer: "Media buyer", team: "Subteam",
  source: "Platform", vertical: "Vertical", category: "Category", date: "Date"
};
export const wagnerValueLabels: Record<string, string> = {
  facebook: "Meta", newsbreak: "NewsBreak", bigo: "Bigo Ads", vsl: "VSL",
  home_improvement: "Home improvement", insurance: "Insurance", unknown: "Unknown"
};
export type WagnerSpendRow = {
  key: string; label: string; accountId: string | null; spend: number; commission: number; total: number;
};
export type WagnerSpendResponse = {
  fromDate: string; toDate: string; groupBy: WagnerBreakdown; currency: "USD";
  dataThrough: string | null; generatedAt: string;
  totals: { spend: number; commission: number; total: number };
  rows: WagnerSpendRow[];
};
export type WagnerDimensions = Record<WagnerFilter, { value: string; label: string }[]>;
export type WagnerStoredSpendResponse = WagnerSpendResponse & { savedAt: string; refreshAfter: string | null };

// Recent dates can still be corrected upstream. Historical reports become permanent only
// after a successful fetch beyond that window; incomplete coverage is never frozen.
export function wagnerRefreshAfter(now: number, toDate: string | null, dataThrough: string | null): number | null {
  if (toDate === null) return now + 24 * 60 * 60 * 1_000;
  const finalizedAt = Date.parse(`${toDate}T00:00:00Z`) + 15 * 86_400_000;
  return now >= finalizedAt && dataThrough !== null && dataThrough >= toDate ? null : now + 60 * 60 * 1_000;
}

export function validateWagnerDateRange(fromDate: string, toDate: string): void {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!valid(fromDate) || !valid(toDate) || fromDate > toDate) throw new Error("Choose a valid Wagner spend period.");
  if ((Date.parse(toDate) - Date.parse(fromDate)) / 86_400_000 >= 400) throw new Error("Wagner spend periods cannot exceed 400 days.");
}

export function wagnerSpendCsv(data: WagnerSpendResponse, rows = data.rows): string {
  const account = data.groupBy === "ad_account";
  const values = [
    [wagnerLabels[data.groupBy], ...(account ? ["Account ID"] : []), "Spend (USD)", "Commission (USD)", "Total cost (USD)"],
    ...rows.map(row => [row.label, ...(account ? [row.accountId ?? ""] : []), row.spend.toFixed(2), row.commission.toFixed(2), row.total.toFixed(2)])
  ];
  return "\uFEFF" + values.map(row => row.map(value => {
    const safe = /^[=+\-@\t\r]/.test(value.trimStart()) ? `'${value}` : value;
    return `"${safe.replaceAll('"', '""')}"`;
  }).join(",")).join("\r\n");
}
