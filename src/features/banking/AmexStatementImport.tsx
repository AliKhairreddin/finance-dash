import { useEffect, useRef, useState } from "react";
import { Download, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { InfoPopover } from "@/components/ui/finance-visuals";
import { SortableTableHead, compareTableValues, type TableSortDirection } from "@/components/ui/sortable-table-head";
import { useUrlState } from "@/lib/url-state";
import { amexStatementMaximumBytes, type AmexStatementDetail, type AmexStatementRecord, type AmexStatementRow } from "../../../shared/amexStatements";

const apiBase = import.meta.env.VITE_API_BASE || "/api";
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}/amex/statements${path}`, init);
  const body = await response.json();
  if (!response.ok) throw new Error(body.message ?? "Statement request failed");
  return body as T;
}
const amount = (value: number, currency: string) => new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(value);
const historyColumns = ["createdAt", "fileName", "cardLastFour", "status", "transactionCount", "inserted", "duplicates"] as const;
const rowColumns = ["date", "description", "cardLastFour", "cardHolderName", "amount"] as const;
type HistorySort = typeof historyColumns[number];
type RowSort = typeof rowColumns[number];

export function AmexStatementImport({ onImported }: { onImported: () => Promise<void> }) {
  const [openState, setOpenState] = useUrlState("amexImport", "");
  const [id, setId] = useUrlState("amexStatement", "");
  const open = openState === "open" || Boolean(id);
  const [history, setHistory] = useState<AmexStatementRecord[]>([]);
  const [detail, setDetail] = useState<AmexStatementDetail | null>(null);
  const [currency, setCurrency] = useState("EUR");
  const [card, setCard] = useState("");
  const [dateFormat, setDateFormat] = useState("dmy");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [historySort, setHistorySort] = useUrlState<HistorySort>("amexHistorySort", "createdAt", { allowedValues: historyColumns });
  const [historyDirection, setHistoryDirection] = useUrlState<TableSortDirection>("amexHistoryDirection", "desc", { allowedValues: ["asc", "desc"] });
  const [rowSort, setRowSort] = useUrlState<RowSort>("amexRowSort", "date", { allowedValues: rowColumns });
  const [rowDirection, setRowDirection] = useUrlState<TableSortDirection>("amexRowDirection", "asc", { allowedValues: ["asc", "desc"] });
  const onImportedRef = useRef(onImported); onImportedRef.current = onImported;
  const observed = useRef(new Set<string>());

  useEffect(() => {
    if (!open) return;
    let disposed = false, pending = false;
    setDetail(null); setReviewed(false); setError(""); setLoading(true);
    const refresh = async () => {
      if (pending) return; pending = true;
      try {
        const [records, selected] = await Promise.all([request<AmexStatementRecord[]>(""), id ? request<AmexStatementDetail>(`/${id}`) : Promise.resolve(null)]);
        if (disposed) return;
        setHistory(records); setDetail(selected);
        const imported = records.filter(record => record.status === "imported" && !observed.current.has(record._id));
        if (imported.length) { imported.forEach(record => observed.current.add(record._id)); window.dispatchEvent(new Event("amex-statements-imported")); await onImportedRef.current(); }
      } catch (err) { if (!disposed) setError(err instanceof Error ? err.message : "Could not load statements"); }
      finally { pending = false; if (!disposed) setLoading(false); }
    };
    void refresh(); const timer = window.setInterval(() => void refresh(), 2500);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [open, id]);

  async function upload() {
    if (!file) return;
    setBusy(true); setError("");
    try {
      if (file.size > amexStatementMaximumBytes) throw new Error("Choose a statement up to 10 MB");
      if (!/\.(pdf|csv)$/i.test(file.name)) throw new Error("Choose a PDF or CSV statement");
      const result = await request<{ id: string }>("/upload", { method: "POST", body: file, headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": encodeURIComponent(file.name), "X-Amex-Currency": currency, "X-Amex-Card": card, "X-Amex-Date-Format": dateFormat } });
      setId(result.id); setFile(null);
    } catch (err) { setError(err instanceof Error ? err.message : "Upload failed"); }
    finally { setBusy(false); }
  }
  async function startImport() {
    setBusy(true); setError("");
    try { await request(`/${id}/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reviewed }) }); setDetail(await request<AmexStatementDetail>(`/${id}`)); }
    catch (err) { setError(err instanceof Error ? err.message : "Import failed"); }
    finally { setBusy(false); }
  }
  async function discard() {
    setBusy(true); setError("");
    try { await request(`/${id}`, { method: "DELETE" }); setOpenState("open"); setId(""); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not discard preview"); }
    finally { setBusy(false); }
  }
  function sortHistory(column: HistorySort) { if (column === historySort) setHistoryDirection(d => d === "asc" ? "desc" : "asc"); else { setHistorySort(column); setHistoryDirection("asc"); } }
  function sortRows(column: RowSort) { if (column === rowSort) setRowDirection(d => d === "asc" ? "desc" : "asc"); else { setRowSort(column); setRowDirection("asc"); } }
  const rows = [...(detail?.rows ?? [])].sort((a, b) => compareTableValues(a[rowSort], b[rowSort], rowDirection));
  const records = [...history].sort((a, b) => compareTableValues(a[historySort], b[historySort], historyDirection));
  const record = detail?.record;
  return <>
    <Button className="secondary-button" onClick={() => setOpenState("open")}><Upload size={15} /> Statements</Button>
    <Dialog open={open} onOpenChange={value => { if (!value && !busy) { setId(""); setOpenState(""); } }}>
      <DialogContent className="amex-import-dialog" aria-describedby={undefined}>
        <div className="amex-import-heading"><DialogTitle>Amex statements</DialogTitle><InfoPopover label="Amex statement import help">Upload PDFs or CSVs up to 10 MB and 1,000 transactions. Netherlands defaults to EUR and day/month/year. Use the same primary card’s last four digits on every upload. Purchases and fees are charges; refunds and repayments are credits. No live balance is inferred from statements. In Telegram, send the file with a caption such as /amex EUR 1234. Duplicate matching uses the card, date, amount, description and repeated-row count; export complete days with consistent descriptions.</InfoPopover></div>
        {error && <div className="income-callout warning" role="alert">{error}</div>}
        {loading && <span role="status"><Loader2 size={15} className="spin" /> Loading statement…</span>}
        {!id ? <>
          <form className="amex-upload-form" onSubmit={event => { event.preventDefault(); void upload(); }}>
            <label>Statement<Input type="file" accept=".pdf,.csv,application/pdf,text/csv" disabled={busy} onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>
            <div className="amex-upload-options">
              <label>Currency<Input value={currency} maxLength={3} required disabled={busy} onChange={event => setCurrency(event.target.value.toUpperCase())} /></label>
              <label>Primary card · last 4<Input value={card} inputMode="numeric" pattern="[0-9]{4}" maxLength={4} placeholder="Auto-detect" disabled={busy} onChange={event => setCard(event.target.value)} /></label>
              <label>Date format<NativeSelect value={dateFormat} disabled={busy} onValueChange={value => setDateFormat(value ?? "dmy")}><NativeSelectOption value="dmy">Day / month / year</NativeSelectOption><NativeSelectOption value="mdy">Month / day / year</NativeSelectOption></NativeSelect></label>
              <Button type="submit" disabled={!file || busy}>{busy ? <Loader2 size={15} className="spin" /> : <Upload size={15} />}{busy ? "Reading statement…" : "Preview statement"}</Button>
            </div>
          </form>
          <h3>Recent statements</h3>
          <div className="table-wrap amex-statement-table"><table><thead><tr>
            {historyColumns.map((column, index) => <SortableTableHead key={column} sortKey={column} activeSortKey={historySort} direction={historyDirection} onSort={sortHistory}>{["Uploaded", "File", "Card", "Status", "Rows", "New", "Duplicates"][index]}</SortableTableHead>)}<th scope="col"><span className="sr-only">Actions</span></th>
          </tr></thead><tbody>{records.map(item => <tr key={item._id}>
            <td>{new Date(item.createdAt).toLocaleDateString("en-GB")}</td><td>{item.fileName}</td><td>•{item.cardLastFour}</td><td>{item.status === "ready" ? "Ready for review" : item.status}</td><td>{item.transactionCount}</td><td>{item.inserted}</td><td>{item.duplicates}</td><td><Button variant="ghost" onClick={() => setId(item._id)}>View</Button></td>
          </tr>)}{!records.length && <tr><td colSpan={8}>{loading ? "Loading…" : "No statements uploaded"}</td></tr>}</tbody></table></div>
        </> : record && <>
          <div className="amex-statement-title"><Button variant="ghost" disabled={busy} onClick={() => { setOpenState("open"); setId(""); }}>← All statements</Button><strong>{record.fileName}</strong><a href={`${apiBase}/amex/statements/${id}/file`} aria-label="Download original statement"><Download size={17} /></a></div>
          <div className="amex-statement-summary"><span>Amex •{record.cardLastFour} · {record.currency}</span><span>{record.periodStart} – {record.periodEnd}</span><span>{record.transactionCount} transactions</span><span>Charges {amount(record.chargesTotal, record.currency)}</span><span>Credits {amount(record.creditsTotal, record.currency)}</span></div>
          {record.reviewReasons.length > 0 && ["ready", "failed"].includes(record.status) && <div className="income-callout warning"><ul>{record.reviewReasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul><label className="amex-review-check"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} /> I checked the extracted rows against the original statement</label></div>}
          {record.error && <div className="income-callout warning" role="alert">{record.error}</div>}
          <div className="amex-import-result" role="status">{record.status === "imported" ? `Imported · ${record.inserted} new · ${record.duplicates} duplicates. Classification runs automatically.` : record.status === "importing" ? `Importing ${record.processed} / ${record.transactionCount}…` : record.status === "failed" ? `Import stopped after ${record.processed} rows. Retry resumes from there.` : "Ready to import"}</div>
          <div className="table-wrap amex-statement-table"><table><thead><tr>{rowColumns.map((column, index) => <SortableTableHead key={column} sortKey={column} activeSortKey={rowSort} direction={rowDirection} onSort={sortRows}>{["Date", "Description", "Card", "Cardholder", `Amount (${record.currency})`][index]}</SortableTableHead>)}</tr></thead><tbody>{rows.map((row: AmexStatementRow, index) => <tr key={index}><td>{row.date}</td><td>{row.description}</td><td>•{row.cardLastFour ?? record.cardLastFour}</td><td>{row.cardHolderName ?? "—"}</td><td className={row.amount < 0 ? "good-text" : ""}>{amount(row.amount, record.currency)}</td></tr>)}</tbody></table></div>
          <div className="amex-import-actions">{record.status === "ready" && <Button variant="outline" disabled={busy} onClick={() => void discard()}>Discard preview</Button>}{["ready", "failed"].includes(record.status) && <Button disabled={busy || record.reviewReasons.length > 0 && !reviewed} onClick={() => void startImport()}>{busy && <Loader2 size={15} className="spin" />}{record.status === "failed" ? "Resume import" : "Import transactions"}</Button>}</div>
        </>}
      </DialogContent>
    </Dialog>
  </>;
}
