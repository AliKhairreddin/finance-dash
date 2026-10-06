import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, Download, Loader2, Upload } from "lucide-react";
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
type Operation = "preview" | "import" | "discard";

export function AmexStatementImport({ onImported }: { onImported: () => Promise<void> }) {
  const [openState, setOpenState] = useUrlState("amexImport", "");
  const [id, setId] = useUrlState("amexStatement", "");
  const open = openState === "open" || Boolean(id);
  const [history, setHistory] = useState<AmexStatementRecord[]>([]);
  const [detail, setDetail] = useState<AmexStatementDetail | null>(null);
  const [currency, setCurrency] = useState("EUR");
  const [card, setCard] = useState("");
  const [dateFormat, setDateFormat] = useState("auto");
  const [file, setFile] = useState<File | null>(null);
  const [operation, setOperation] = useState<Operation | null>(null);
  const busy = operation !== null;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const [duplicateUploadId, setDuplicateUploadId] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [historySort, setHistorySort] = useUrlState<HistorySort>("amexHistorySort", "createdAt", { allowedValues: historyColumns });
  const [historyDirection, setHistoryDirection] = useUrlState<TableSortDirection>("amexHistoryDirection", "desc", { allowedValues: ["asc", "desc"] });
  const [rowSort, setRowSort] = useUrlState<RowSort>("amexRowSort", "date", { allowedValues: rowColumns });
  const [rowDirection, setRowDirection] = useUrlState<TableSortDirection>("amexRowDirection", "asc", { allowedValues: ["asc", "desc"] });
  const onImportedRef = useRef(onImported); onImportedRef.current = onImported;
  const observed = useRef(new Set<string>());
  const operationRef = useRef<Operation | null>(null);
  const refreshVersion = useRef(0);
  const cardEdited = useRef(false);
  const activeImport = history.find(item => item.status === "importing");
  const shouldPoll = open || Boolean(activeImport);

  useEffect(() => {
    if (cardEdited.current) return;
    const cards = [...new Set(history.filter(item => item.currency === currency).map(item => item.cardLastFour))];
    setCard(cards.length === 1 ? cards[0] : "");
  }, [history, currency]);

  useEffect(() => {
    if (!shouldPoll) return;
    let disposed = false, pending = false;
    setDetail(null); setReviewed(false); setError(""); setRefreshError(""); setLoading(open);
    const refresh = async () => {
      if (pending || operationRef.current) return; pending = true;
      const version = refreshVersion.current;
      try {
        const [records, selected] = await Promise.all([request<AmexStatementRecord[]>(""), id ? request<AmexStatementDetail>(`/${id}`) : Promise.resolve(null)]);
        if (disposed || version !== refreshVersion.current) return;
        setHistory(records); setDetail(selected); setRefreshError("");
        const imported = records.filter(record => record.status === "imported" && !observed.current.has(record._id));
        if (imported.length) { imported.forEach(record => observed.current.add(record._id)); window.dispatchEvent(new Event("amex-statements-imported")); await onImportedRef.current(); }
      } catch (err) { if (!disposed && version === refreshVersion.current) setRefreshError(err instanceof Error ? err.message : "Could not load statements"); }
      finally { pending = false; if (!disposed) setLoading(false); }
    };
    void refresh(); const timer = window.setInterval(() => void refresh(), 2500);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [open, id, shouldPoll]);

  function begin(next: Operation) {
    if (operationRef.current) return false;
    operationRef.current = next; refreshVersion.current += 1;
    setOperation(next); setError("");
    return true;
  }
  function finish() { operationRef.current = null; setOperation(null); }
  async function upload(selected = file) {
    if (!selected || !begin("preview")) return;
    try {
      if (selected.size > amexStatementMaximumBytes) throw new Error("Choose a statement up to 10 MB");
      if (!/\.(pdf|csv)$/i.test(selected.name)) throw new Error("Choose a PDF or CSV statement");
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Enter the three-letter statement currency");
      if (card && !/^[0-9]{4}$/.test(card)) throw new Error("Enter the primary card’s last four digits");
      const result = await request<{ id: string; duplicate: boolean }>("/upload", { method: "POST", body: selected, headers: { "Content-Type": selected.type || "application/octet-stream", "X-File-Name": encodeURIComponent(selected.name), "X-Amex-Currency": currency, "X-Amex-Card": card, "X-Amex-Date-Format": dateFormat } });
      setDuplicateUploadId(result.duplicate ? result.id : "");
      setLoading(true); setId(result.id); setFile(null);
    } catch (err) { setError(err instanceof Error ? err.message : "Upload failed"); }
    finally { finish(); }
  }
  async function startImport() {
    if (!begin("import")) return;
    try {
      await request(`/${id}/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reviewed }) });
      const selected = await request<AmexStatementDetail>(`/${id}`);
      setDetail(selected); setHistory(records => [selected.record, ...records.filter(item => item._id !== id)]);
    }
    catch (err) { setError(err instanceof Error ? err.message : "Import failed"); }
    finally { finish(); }
  }
  async function discard() {
    if (!begin("discard")) return;
    try { await request(`/${id}`, { method: "DELETE" }); setOpenState("open"); setId(""); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not discard preview"); }
    finally { finish(); }
  }
  function sortHistory(column: HistorySort) { if (column === historySort) setHistoryDirection(d => d === "asc" ? "desc" : "asc"); else { setHistorySort(column); setHistoryDirection("asc"); } }
  function sortRows(column: RowSort) { if (column === rowSort) setRowDirection(d => d === "asc" ? "desc" : "asc"); else { setRowSort(column); setRowDirection("asc"); } }
  const rows = [...(detail?.rows ?? [])].sort((a, b) => compareTableValues(a[rowSort], b[rowSort], rowDirection));
  const records = [...history].sort((a, b) => compareTableValues(a[historySort], b[historySort], historyDirection));
  const record = detail?.record;
  function close() { setId(""); setOpenState(""); setFile(null); setDuplicateUploadId(""); }
  const importing = record?.status === "importing" || operation === "import";
  const importAllowed = record && ["ready", "failed"].includes(record.status);
  return <>
    <Button className="secondary-button" onClick={() => setOpenState("open")}>{activeImport ? <Loader2 size={15} className="spin" /> : <Upload size={15} />}{activeImport ? `Importing ${activeImport.processed} / ${activeImport.transactionCount}` : "Statements"}</Button>
    <Dialog open={open} onOpenChange={value => { if (!value && !busy) close(); }}>
      <DialogContent className="amex-import-dialog" aria-describedby={undefined}>
        <div className="amex-import-heading"><DialogTitle>Amex statements</DialogTitle><InfoPopover label="Amex statement import help">Choosing a file prepares a preview. Review the rows, then click Import transactions. Upload PDFs or CSVs up to 10 MB and 1,000 transactions. Currency defaults to EUR. CSV dates are detected automatically, including month/day/year in Dutch Account Activity exports. Choose a date format if an export is ambiguous. Use the same primary card’s last four digits on every upload; a single saved account is filled in for you. Purchases and fees are charges; refunds and repayments are credits. No live balance is inferred from statements. In Telegram, send the file with a caption such as /amex EUR 1234. Duplicate matching uses the card, date, amount, description and repeated-row count; export complete days with consistent descriptions. Classification runs automatically after import.</InfoPopover></div>
        {error && <div className="income-callout warning" role="alert">{error}</div>}
        {refreshError && <div className="income-callout warning" role="alert">Status could not refresh: {refreshError}</div>}
        {loading && <span className="amex-loading" role="status"><Loader2 size={15} className="spin" />{id ? "Loading statement status…" : "Loading statements…"}</span>}
        {!id ? <>
          <form className="amex-upload-form" onSubmit={event => { event.preventDefault(); void upload(); }}>
            <label>Statement<Input type="file" accept=".pdf,.csv,application/pdf,text/csv" disabled={busy || loading} onChange={event => { const selected = event.target.files?.[0] ?? null; setFile(selected); setError(""); if (selected) void upload(selected); }} /></label>
            <div className="amex-upload-options">
              <label>Currency<Input value={currency} maxLength={3} required disabled={busy} onChange={event => setCurrency(event.target.value.toUpperCase())} /></label>
              <label>Primary card · last 4<Input value={card} inputMode="numeric" pattern="[0-9]{4}" maxLength={4} placeholder="Auto-detect" disabled={busy} onChange={event => { cardEdited.current = true; setCard(event.target.value); }} /></label>
              <label>Date format<NativeSelect value={dateFormat} disabled={busy} onValueChange={value => setDateFormat(value ?? "auto")}><NativeSelectOption value="auto">Automatic</NativeSelectOption><NativeSelectOption value="dmy">Day / month / year</NativeSelectOption><NativeSelectOption value="mdy">Month / day / year</NativeSelectOption></NativeSelect></label>
              <Button type="submit" disabled={!file || busy || loading}>{busy ? <Loader2 size={15} className="spin" /> : <Upload size={15} />}{busy ? "Reading statement…" : file ? "Retry preview" : "Review statement"}</Button>
            </div>
            {file && <div className="amex-import-status" data-status={error ? "failed" : "reading"}><div className="amex-import-result" role="status" aria-atomic="true">{operation === "preview" ? <Loader2 size={20} className="spin" /> : <CircleAlert size={20} />}<div><strong>{operation === "preview" ? "Reading statement…" : "Not imported · Preview not ready"}</strong><span>{file.name} · No transactions added yet</span></div></div></div>}
          </form>
          <h3>Recent statements</h3>
          <div className="table-wrap amex-statement-table"><table><thead><tr>
            {historyColumns.map((column, index) => <SortableTableHead key={column} sortKey={column} activeSortKey={historySort} direction={historyDirection} onSort={sortHistory}>{["Uploaded", "File", "Card", "Status", "Rows", "New", "Duplicates"][index]}</SortableTableHead>)}<th scope="col"><span className="sr-only">Actions</span></th>
          </tr></thead><tbody>{records.map(item => <tr key={item._id}>
            <td>{new Date(item.createdAt).toLocaleDateString("en-GB")}</td><td>{item.fileName}</td><td>•{item.cardLastFour}</td><td><span className="amex-history-status" data-status={item.status}>{item.status === "imported" ? <CheckCircle2 size={14} /> : item.status === "importing" ? <Loader2 size={14} className="spin" /> : null}{item.status === "ready" ? "Not imported" : item.status === "importing" ? `Importing ${item.processed} / ${item.transactionCount}` : item.status === "failed" ? "Import stopped" : "Imported"}</span></td><td>{item.transactionCount}</td><td>{item.status === "ready" ? "—" : item.inserted}</td><td>{item.status === "ready" ? "—" : item.duplicates}</td><td><Button variant="ghost" onClick={() => setId(item._id)}>{item.status === "ready" ? "Review & import" : item.status === "failed" ? "Resume" : "View"}</Button></td>
          </tr>)}{!records.length && <tr><td colSpan={8}>{loading ? "Loading…" : "No statements uploaded"}</td></tr>}</tbody></table></div>
        </> : record && <>
          <div className="amex-statement-title"><Button variant="ghost" disabled={busy} onClick={() => { setOpenState("open"); setId(""); }}>← All statements</Button><strong>{record.fileName}</strong><a href={`${apiBase}/amex/statements/${id}/file`} aria-label="Download original statement"><Download size={17} /></a></div>
          <div className="amex-statement-summary"><span>Amex •{record.cardLastFour} · {record.currency}</span><span>{record.periodStart} – {record.periodEnd}</span><span>{record.transactionCount} transactions</span><span>Charges {amount(record.chargesTotal, record.currency)}</span><span>Credits {amount(record.creditsTotal, record.currency)}</span></div>
          {record.reviewReasons.length > 0 && ["ready", "failed"].includes(record.status) && <div className="income-callout warning"><ul>{record.reviewReasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul><label className="amex-review-check"><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} /> I checked the extracted rows against the original statement</label></div>}
          {record.error && <div className="income-callout warning" role="alert">{record.error}</div>}
          <div className="amex-import-status" data-status={importing ? "importing" : record.status}>
            <div className="amex-import-result" role="status" aria-atomic="true">
              {importing ? <Loader2 size={20} className="spin" /> : record.status === "imported" ? <CheckCircle2 size={20} /> : record.status === "failed" ? <CircleAlert size={20} /> : <Upload size={20} />}
              <div><strong>{operation === "import" ? "Starting import…" : record.status === "importing" ? "Importing transactions…" : record.status === "imported" ? duplicateUploadId === id ? "Already imported" : "Import complete" : record.status === "failed" ? "Import stopped" : "Preview ready · Not imported"}</strong>
                <span>{record.status === "imported" ? `${record.processed} transactions processed · ${record.inserted} new · ${record.duplicates} duplicates` : importing ? `${record.processed} of ${record.transactionCount} processed · ${record.inserted} new · ${record.duplicates} duplicates` : record.status === "failed" ? `${record.processed} of ${record.transactionCount} processed · Resume from the last completed batch` : "Review the rows, then import transactions"}</span>
              </div>
            </div>
            <div className="amex-import-actions">{record.status === "ready" && <Button variant="outline" disabled={busy} onClick={() => void discard()}>{operation === "discard" ? "Discarding…" : "Discard preview"}</Button>}{importAllowed && <Button disabled={busy || record.reviewReasons.length > 0 && !reviewed} onClick={() => void startImport()}>{operation === "import" && <Loader2 size={15} className="spin" />}{operation === "import" ? "Starting import…" : record.status === "failed" ? "Resume import" : `Import ${record.transactionCount} transactions`}</Button>}{record.status === "imported" && <Button disabled={busy} onClick={close}>Done</Button>}</div>
            {importing && <progress className="amex-import-progress" value={record.processed} max={record.transactionCount} aria-label="Transaction import progress" />}
          </div>
          <div className="table-wrap amex-statement-table"><table><thead><tr>{rowColumns.map((column, index) => <SortableTableHead key={column} sortKey={column} activeSortKey={rowSort} direction={rowDirection} onSort={sortRows}>{["Date", "Description", "Card", "Cardholder", `Amount (${record.currency})`][index]}</SortableTableHead>)}</tr></thead><tbody>{rows.map((row: AmexStatementRow, index) => <tr key={index}><td>{row.date}</td><td>{row.description}</td><td>•{row.cardLastFour ?? record.cardLastFour}</td><td>{row.cardHolderName ?? "—"}</td><td className={row.amount < 0 ? "good-text" : ""}>{amount(row.amount, record.currency)}</td></tr>)}</tbody></table></div>
        </>}
      </DialogContent>
    </Dialog>
  </>;
}
