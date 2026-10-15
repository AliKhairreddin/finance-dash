import { useEffect, useRef, useState, type FormEvent } from "react";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { InfoPopover } from "@/components/ui/finance-visuals";
import { SortableTableHead, type TableSortDirection } from "@/components/ui/sortable-table-head";
import { useUrlState } from "@/lib/url-state";
import { manualBankSortKeys, validateManualBankFields, type ManualBankFields, type ManualBankPage, type ManualBankSource, type ManualBankSortKey, type ManualBankTransaction } from "../../../shared/manualBankTransactions";
import { financeOperatingDate } from "../../../shared/operatingDate";

const columns: Array<{ key: ManualBankSortKey; label: string }> = [
  { key: "date", label: "Date" }, { key: "companyName", label: "Company" },
  { key: "amount", label: "Amount" }, { key: "currency", label: "Currency" },
  { key: "direction", label: "Direction" }, { key: "createdBy", label: "Added by" }
];
const apiBase = import.meta.env.VITE_API_BASE || "/api";

export function ManualBankTransactions({ source }: { source: ManualBankSource }) {
  const label = source === "kraken" ? "Kraken" : "Trust";
  const [sort, setSort] = useUrlState<ManualBankSortKey>(`${source}Sort`, "date", { allowedValues: manualBankSortKeys });
  const [order, setOrder] = useUrlState<TableSortDirection>(`${source}Order`, "desc", { allowedValues: ["asc", "desc"] });
  const [cursors, setCursors] = useState<Array<string | null>>([null]);
  const [page, setPage] = useState<ManualBankPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [editing, setEditing] = useState<ManualBankTransaction | "new" | null>(null);
  const [deleting, setDeleting] = useState<ManualBankTransaction | null>(null);
  const tableWrap = useRef<HTMLDivElement>(null);
  const cursor = cursors.at(-1) ?? null;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null); setPage(null);
    const query = new URLSearchParams({ source, sort, order });
    if (cursor) query.set("cursor", cursor);
    fetch(`${apiBase}/manual-bank-transactions?${query}`, { signal: controller.signal })
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.message ?? "Could not load transactions."); return data as ManualBankPage; })
      .then(data => { if (!controller.signal.aborted) setPage(data); })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load transactions."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [source, sort, order, cursor, refresh]);
  function changeSort(key: ManualBankSortKey) {
    setCursors([null]);
    if (key === sort) setOrder(order === "asc" ? "desc" : "asc");
    else { setSort(key); setOrder("asc"); }
  }
  function reload() { setCursors([null]); setRefresh(value => value + 1); }
  // Browser back/forward can change the URL sort without a header click.
  useEffect(() => { setCursors([null]); }, [sort, order]);
  useEffect(() => { if (page?.page.length === 0) tableWrap.current?.scrollTo({ left: 0 }); }, [page]);
  return <section className="panel wide-panel">
    <div className="panel-header">
      <div className="flex items-center gap-2"><h3>Transactions</h3><InfoPopover label={`${label} transactions`}>
        Add transactions here or, for Ali and Ali M, send /{source} Acme Ltd 1250 in Telegram. Payments default to USDC and out. Company, amount, currency, direction, and date are editable. New dashboard entries default to today; Telegram entries use the message date in Eastern time. Deleted entries retain their audit history. These manual records are kept in this ledger and do not change bank balances, holdings, or bank analytics.
      </InfoPopover></div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon-sm" aria-label="Refresh transactions" title="Refresh transactions" disabled={loading} onClick={reload}><RefreshCw size={14} /></Button>
        <Button onClick={() => setEditing("new")}><Plus size={14} /> Add transaction</Button>
      </div>
    </div>
    {error && <div role="alert" className="income-callout warning">{error}<Button variant="outline" onClick={reload}>Retry</Button></div>}
    <div ref={tableWrap} className="table-wrap" aria-busy={loading}>
      <table className="data-table">
        <thead><tr>{columns.map(column => <SortableTableHead key={column.key} activeSortKey={sort} direction={order} onSort={changeSort} sortKey={column.key}>{column.label}</SortableTableHead>)}<th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {loading && <tr><td colSpan={7}>Loading transactions…</td></tr>}
          {!loading && !error && page?.page.length === 0 && <tr><td colSpan={7}>No {label} transactions yet.</td></tr>}
          {page?.page.map(row => <tr key={row._id}>
            <td>{row.date}</td><td><strong>{row.companyName}</strong></td>
            <td className="amount">{row.amount.toLocaleString("en-US", { maximumFractionDigits: 8 })}</td>
            <td>{row.currency}</td><td><span className={`direction-label ${row.direction}`}>{row.direction === "out" ? "Money out" : "Money in"}</span></td><td>{row.createdBy}</td>
            <td><div className="flex items-center gap-1">
              <Button variant="ghost" size="icon-sm" aria-label={`Edit ${row.companyName} transaction`} onClick={() => setEditing(row)}><Pencil size={15} /></Button>
              <Button variant="ghost" size="icon-sm" aria-label={`Delete ${row.companyName} transaction`} onClick={() => setDeleting(row)}><Trash2 size={15} /></Button>
            </div></td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <div className="bank-table-pagination">
      <Button variant="outline" disabled={loading || cursors.length === 1} onClick={() => setCursors(values => values.slice(0, -1))}>Previous</Button>
      <span>Page {cursors.length}</span>
      <Button variant="outline" disabled={loading || !page || page.isDone} onClick={() => { if (page) setCursors(values => [...values, page.continueCursor]); }}>Next</Button>
    </div>
    {editing && <ManualBankEditor key={editing === "new" ? "new" : editing._id} source={source} row={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    {deleting && <ManualBankDelete row={deleting} onClose={() => setDeleting(null)} onDeleted={() => { setDeleting(null); reload(); }} />}
  </section>;
}

function ManualBankEditor({ source, row, onClose, onSaved }: { source: ManualBankSource; row?: ManualBankTransaction; onClose: () => void; onSaved: () => void }) {
  const [companyName, setCompanyName] = useState(row?.companyName ?? "");
  const [amount, setAmount] = useState(row ? String(row.amount) : "");
  const [currency, setCurrency] = useState(row?.currency ?? "USDC");
  const [date, setDate] = useState(() => row?.date ?? financeOperatingDate(Date.now()));
  const [direction, setDirection] = useState<ManualBankFields["direction"]>(row?.direction ?? "out");
  // Keep the same identity when retrying after an uncertain network response.
  const [requestId] = useState(() => crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(null); setSaving(true);
    try {
      const fields = validateManualBankFields({ companyName, amount: Number(amount), currency, date, direction });
      const response = await fetch(`${apiBase}/manual-bank-transactions${row ? `/${encodeURIComponent(row._id)}` : ""}`, {
        method: row ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...fields, ...(row ? { expectedRevision: row.revision } : { source, requestId }) })
      });
      if (!response.ok) { const body = await response.json(); throw new Error(body.message ?? "Could not save transaction."); }
      onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save transaction."); }
    finally { setSaving(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}>
    <DialogContent showCloseButton={!saving}><DialogHeader><DialogTitle>{row ? "Edit" : "Add"} {source === "kraken" ? "Kraken" : "Trust"} transaction</DialogTitle></DialogHeader>
      <form onSubmit={submit} className="grid gap-4">
        <div className="grid gap-2"><Label htmlFor="manual-company">Company</Label><Input id="manual-company" value={companyName} maxLength={200} required onChange={event => setCompanyName(event.target.value)} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2"><Label htmlFor="manual-amount">Amount</Label><Input id="manual-amount" type="number" min="0.00000001" max="1000000000000" step="any" required value={amount} onChange={event => setAmount(event.target.value)} /></div>
          <div className="grid gap-2"><Label htmlFor="manual-currency">Currency</Label><Input id="manual-currency" value={currency} maxLength={10} required onChange={event => setCurrency(event.target.value.toUpperCase())} /></div>
        </div>
        <div className="grid gap-2"><Label htmlFor="manual-date">Date</Label><Input id="manual-date" type="date" required value={date} onChange={event => setDate(event.target.value)} /></div>
        <div className="grid gap-2"><Label htmlFor="manual-direction">Direction</Label><NativeSelect id="manual-direction" value={direction} onValueChange={value => setDirection(value as "in" | "out")}><NativeSelectOption value="out">Money out</NativeSelectOption><NativeSelectOption value="in">Money in</NativeSelectOption></NativeSelect></div>
        {error && <p role="alert" className="danger-text">{error}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={saving} onClick={onClose}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? "Saving…" : row ? "Save changes" : "Add transaction"}</Button></div>
      </form>
    </DialogContent>
  </Dialog>;
}

function ManualBankDelete({ row, onClose, onDeleted }: { row: ManualBankTransaction; onClose: () => void; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function remove() {
    setDeleting(true); setError(null);
    try {
      const response = await fetch(`${apiBase}/manual-bank-transactions/${encodeURIComponent(row._id)}`, {
        method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: row.revision })
      });
      if (!response.ok) { const body = await response.json(); throw new Error(body.message ?? "Could not delete transaction."); }
      onDeleted();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not delete transaction."); }
    finally { setDeleting(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !deleting) onClose(); }}>
    <DialogContent showCloseButton={!deleting}>
      <DialogHeader><DialogTitle>Delete {row.source === "kraken" ? "Kraken" : "Trust"} transaction?</DialogTitle>
        <DialogDescription>Remove {row.companyName} · {row.amount.toLocaleString("en-US", { maximumFractionDigits: 8 })} {row.currency} · {row.date} from this ledger?</DialogDescription>
      </DialogHeader>
      {error && <p role="alert" className="danger-text">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" disabled={deleting} onClick={onClose}>Cancel</Button>
        <Button variant="destructive" disabled={deleting} onClick={() => void remove()}>{deleting ? "Deleting…" : "Delete transaction"}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
