import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InfoPopover } from "@/components/ui/finance-visuals";
import { compareTableValues, SortableTableHead, type TableSortDirection } from "@/components/ui/sortable-table-head";
import { useUrlState } from "@/lib/url-state";
import type { QuinStreetMonthlyRow } from "../../../shared/quinstreetMonthly";
const apiBase = import.meta.env.VITE_API_BASE || "/api";
async function request<T>(path: string, method = "GET", signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, { method, signal });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.message || "Sync failed");
  return body as T;
}
type SyncStatus = { lastSuccessAt?: string; error?: string; running: boolean; retryAt: number } | null;
export function MeritSyncButton({ onSynced }: { onSynced: () => Promise<void> }) {
  const [status, setStatus] = useState<SyncStatus>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void request<SyncStatus>("/merit/sync", "GET", controller.signal).then(setStatus).catch(error => {
      if (!controller.signal.aborted) setError(error.message);
    });
    return () => controller.abort();
  }, []);
  async function sync() {
    setBusy(true); setError(null); setMessage(null);
    try {
      const next = await request<SyncStatus>("/merit/sync", "POST");
      setStatus(next);
      await onSynced();
      if (next?.error) setError(next.error);
      else setMessage(next?.running ? "Merit sync is already running." : next?.lastSuccessAt
        ? `Merit saved data · ${new Date(next.lastSuccessAt).toLocaleString()}` : "Merit sync is cooling down. Try again shortly.");
    } catch (error) { setError(error instanceof Error ? error.message : "Merit sync failed"); }
    finally { setBusy(false); }
  }
  return <div className="income-sync-control">
    <div className="row-actions"><Button className="secondary-button" type="button" disabled={busy} onClick={() => void sync()}>{busy ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} Sync with Merit</Button>
      <InfoPopover label="Merit sync">Imports invoices, customers, suppliers, and tax codes, then matches invoice payments. Runs automatically every 15 minutes; manual and scheduled requests share a five-minute cooldown. Last successful import: {status?.lastSuccessAt ? new Date(status.lastSuccessAt).toLocaleString() : "not recorded"}.</InfoPopover></div>
    {(error || status?.error) && <small className="inline-error" role="alert">{error || status?.error}</small>}
    {message && <small role="status">{message}</small>}
  </div>;
}
const columns = ["partnerName", "periodEnd", "revenue", "currency", "fetchedAt", "status"] as const;
type Column = typeof columns[number];
export function QuinStreetMonthlyReport() {
  const [rows, setRows] = useState<QuinStreetMonthlyRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useUrlState<Column>("qsMtdSort", "partnerName", { allowedValues: columns });
  const [direction, setDirection] = useUrlState<TableSortDirection>("qsMtdOrder", "asc", { allowedValues: ["asc", "desc"] });
  useEffect(() => {
    const controller = new AbortController();
    void request<QuinStreetMonthlyRow[]>("/revenue/quinstreet-mtd", "GET", controller.signal).then(setRows).catch(error => {
      if (!controller.signal.aborted) setError(error.message);
    });
    return () => controller.abort();
  }, []);
  const status = (row: QuinStreetMonthlyRow) => row.error ? "Sync failed" : row.running ? "Syncing" : row.revenue === null ? "Pending" : "Saved";
  const sorted = [...rows].sort((a, b) => compareTableValues(sort === "status" ? status(a) : a[sort] ?? undefined, sort === "status" ? status(b) : b[sort] ?? undefined, direction));
  async function sync() {
    setBusy(true); setError(null);
    try { setRows(await request<QuinStreetMonthlyRow[]>("/revenue/quinstreet-mtd", "POST")); }
    catch (error) { setError(error instanceof Error ? error.message : "QuinStreet sync failed"); }
    finally { setBusy(false); }
  }
  return <section className="panel">
    <div className="panel-header"><div className="row-actions"><h2>QuinStreet month to date</h2><InfoPopover label="QuinStreet monthly report">Every Monday at 09:00 Asia/Beirut, saves the 1st through the previous Sunday in each rule’s billing timezone. These cumulative reports do not create invoices or add to receivables. Refresh reconciles source corrections and shares a five-minute cooldown.</InfoPopover></div><Button className="secondary-button" disabled={busy} onClick={() => void sync()}>{busy ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} Refresh QuinStreet</Button></div>
    {error && <div className="inline-error" role="alert">{error}</div>}
    <div className="table-wrap"><table className="data-table"><thead><tr>{columns.map((key, index) => <SortableTableHead key={key} activeSortKey={sort} direction={direction} sortKey={key} onSort={next => { if (next === sort) setDirection(direction === "asc" ? "desc" : "asc"); else { setSort(next); setDirection("asc"); } }}>{["Rule", "Period", "Revenue", "Currency", "Updated", "Status"][index]}</SortableTableHead>)}</tr></thead>
      <tbody>{sorted.map(row => <tr key={row.partnerId}><td>{row.partnerName}</td><td>{row.periodStart} – {row.periodEnd}</td><td>{row.revenue === null ? "—" : row.revenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td><td>{row.currency}</td><td>{row.fetchedAt ? new Date(row.fetchedAt).toLocaleString() : "—"}</td><td>{status(row)}{row.error && <InfoPopover label={`${row.partnerName} sync error`}>{row.error} Saved values, if any, are retained.</InfoPopover>}</td></tr>)}{!rows.length && <tr><td colSpan={6}>No completed days in this month’s Monday report.</td></tr>}</tbody></table></div>
  </section>;
}
