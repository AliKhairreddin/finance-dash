import { financeOperatingDate } from "./operatingDate";

export function meritHistoryKey(fromDate: string, toDate: string): string {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!valid(fromDate) || !valid(toDate) || fromDate > toDate || toDate > financeOperatingDate()
    || Date.parse(toDate) - Date.parse(fromDate) > 89 * 86_400_000) throw new Error("Choose a valid historical period of at most 90 days");
  return `merit-history:${fromDate}:${toDate}`;
}

/** Keep the source response intact; missing or malformed results never replace saved history. */
export function validateMeritHistory(records: unknown, fromDate: string, toDate: string): string {
  meritHistoryKey(fromDate, toDate);
  if (!Array.isArray(records) || records.length > 2000) throw new Error("Merit history is incomplete or exceeds the period limit");
  const ids = new Set<string>();
  for (const row of records) {
    const date = String(row?.DocumentDate ?? row?.InvoiceDate ?? "").replace(/\D/g, "").slice(0, 8);
    if (typeof row?.SIHId !== "string" || !row.SIHId || ids.has(row.SIHId) || typeof row.CustomerName !== "string"
      || !/^\d{8}$/.test(date) || date < fromDate.replaceAll("-", "") || date > toDate.replaceAll("-", "")
      || !Number.isFinite(row.TotalSum ?? row.TotalAmount)) throw new Error("Merit history contains invalid, duplicate, or out-of-period invoices");
    ids.add(row.SIHId);
  }
  const json = JSON.stringify(records);
  if (new TextEncoder().encode(json).byteLength > 800_000) throw new Error("Merit history is too large; select a shorter period");
  return json;
}
