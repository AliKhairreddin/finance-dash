import { simpleStatementText, statementOrigin } from "./statementWords";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, BookOpen, Check, CheckCheck, ChevronLeft, ChevronRight, Copy, Download, FileClock, FileText, Inbox, LayoutList, Loader2, Mail, Plus, RefreshCw, RotateCcw, Search, Settings, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { InfoPopover } from "@/components/ui/finance-visuals";
import { useUrlState } from "@/lib/url-state";
import { statementCompanies, statementSortKeys, type StatementAddress, type StatementBootstrap, type StatementDocument, type StatementImportSummary, type StatementList } from "../../../shared/statements";
import { DocumentsTable, TransactionReview } from "./StatementDocuments";
import { ImportHistory, StatementUpload } from "./StatementImports";
import { AddressBook, CardSettings, SenderSettings } from "./StatementSettings";
import { ReceiptCameraSettings } from "./ReceiptCameraSettings";
import { ManualTransactions, companyName, decimalAmount, displayAmount, type StatementTransaction } from "./StatementTransactions";
import { ErrorMessage, StatementModal, StatusPill, csvCell, downloadText, jsonRequest, statementRequest, useStatementSort } from "./StatementUi";
import "./statements.css";
import { applySelectedBatches, changeSelectedPage, collectSelectedRows } from "../../../shared/statementSelection";
import { CreateAiInvoice, CreatedInvoices, InvoiceExamples } from "./StatementInvoices";
import { StatementExact } from "./StatementExact";

const views = [
  { id: "transactions", label: "Transactions", icon: LayoutList }, { id: "documents", label: "Documents & invoices", icon: FileText },
  { id: "pending", label: "Needs checking", icon: Inbox }, { id: "completed", label: "Done", icon: CheckCheck },
  { id: "contacts", label: "Address book", icon: BookOpen }, { id: "imports", label: "File history", icon: FileClock },
  { id: "invoices", label: "Created invoices", icon: FileText }, { id: "exact", label: "Exact", icon: BookOpen }, { id: "settings", label: "Settings", icon: Settings }
] as const;
type View = typeof views[number]["id"];
type Action = "reconcile" | "complete" | "reopen" | "trash" | "restore";
const actionNames: Record<Action, string> = { reconcile: "Mark checked", complete: "Mark done", reopen: "Check again", trash: "Move to Trash", restore: "Restore" };
const emptyList: StatementList = { transactions: [], total: 0, hasMore: false, offset: 0, truncated: false, totals: [] };
const pageSize = 50;

export default function StatementApp() {
  const [company, setCompany] = useUrlState<string>("company", "all", { allowedValues: ["all", ...statementCompanies.map(row => row.id)] });
  const [view, setView] = useUrlState<View>("view", "transactions", { allowedValues: views.map(row => row.id), history: "push" });
  const [bootstrap, setBootstrap] = useState<StatementBootstrap | null>(null);
  const [documents, setDocuments] = useState<StatementDocument[]>([]), [imports, setImports] = useState<StatementImportSummary[]>([]), [contacts, setContacts] = useState<StatementAddress[]>([]);
  const [documentPage, setDocumentPage] = useState({ continueCursor: "", isDone: true }), [importPage, setImportPage] = useState({ continueCursor: "", isDone: true });
  const [moreBusy, setMoreBusy] = useState(false);
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [revision, setRevision] = useState(0), [upload, setUpload] = useState(false), [manual, setManual] = useState(false);
  const [copy, setCopy] = useState<StatementTransaction | null>(null), [review, setReview] = useState<StatementTransaction | null>(null);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setError("");
    void Promise.all([
      statementRequest<StatementBootstrap>("/bootstrap", { signal: abort.signal }),
      statementRequest<{ documents: StatementDocument[]; continueCursor: string; isDone: boolean }>(`/documents?companyId=${company}`, { signal: abort.signal }),
      statementRequest<{ imports: StatementImportSummary[]; continueCursor: string; isDone: boolean }>(`/imports?companyId=${company}`, { signal: abort.signal }),
      statementRequest<StatementAddress[]>("/address-book", { signal: abort.signal })
    ]).then(([next, docs, batches, addresses]) => { setBootstrap(next); setDocuments(docs.documents); setDocumentPage(docs); setImports(batches.imports); setImportPage(batches); setContacts(addresses); })
      .catch(err => { if (!abort.signal.aborted) setError(err instanceof Error ? err.message : "Workspace could not be loaded"); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [revision, company]);
  useEffect(() => {
    if (!documents.some(row => ["queued", "processing"].includes(row.status)) && !imports.some(row => row.status === "importing")) return;
    const timeout = window.setTimeout(refresh, 6000); return () => window.clearTimeout(timeout);
  }, [documents, imports, refresh]);
  const pending = documents.filter(row => row.status !== "ready" && (company === "all" || row.companyId === company)).length;
  const title = view === "exact" ? "Exact companies" : company === "all" ? "All companies" : companyName(company);
  const save = () => { refresh(); setMessage(""); };
  const loadMore = async (kind: "documents" | "imports") => {
    setMoreBusy(true); setError("");
    try { const params = new URLSearchParams({ companyId: company, cursor: kind === "documents" ? documentPage.continueCursor : importPage.continueCursor });
      if (kind === "documents") { const page = await statementRequest<{ documents: StatementDocument[]; continueCursor: string; isDone: boolean }>(`/documents?${params}`); setDocuments(current => [...new Map([...current, ...page.documents].map(row => [row._id, row])).values()]); setDocumentPage(page); }
      else { const page = await statementRequest<{ imports: StatementImportSummary[]; continueCursor: string; isDone: boolean }>(`/imports?${params}`); setImports(current => [...new Map([...current, ...page.imports].map(row => [row._id, row])).values()]); setImportPage(page); }
    } catch (err) { setError(err instanceof Error ? err.message : "More records could not be loaded"); } finally { setMoreBusy(false); }
  };
  return <main className="statement-shell">
    <header className="statement-topbar"><div className="statement-topbar-brand-group"><div className="statement-brand"><span className="statement-brand-icon"><LayoutList size={20} /></span><div><strong>Statements</strong><span>Company finances</span></div></div><div className="statement-navigation-selects">{view !== "exact" && <NativeSelect className="statement-company-select" aria-label="Company workspace" value={company} onValueChange={setCompany}>{statementCompanies.map(row => <NativeSelectOption key={row.id} value={row.id}>{row.name}</NativeSelectOption>)}<NativeSelectOption value="all">All companies</NativeSelectOption></NativeSelect>}<NativeSelect className="statement-page-select" aria-label="Page" searchable={false} value={view} onValueChange={value => setView(value as View)}>{views.map(item => <NativeSelectOption key={item.id} value={item.id}>{item.label}{item.id === "pending" && pending > 0 ? ` (${pending}${!documentPage.isDone ? "+" : ""})` : ""}</NativeSelectOption>)}</NativeSelect></div></div><div className="statement-topbar-actions"><button className="statement-inbox" aria-label="Copy statements email address" title="Copy statements email address" onClick={async () => { try { await navigator.clipboard.writeText(bootstrap?.inbox || "statements@finance.thatcanadian.dev"); setMessage("Receiving address copied."); } catch { setMessage("statements@finance.thatcanadian.dev"); } }}><Mail size={15} /><span>{bootstrap?.inbox || "statements@finance.thatcanadian.dev"}</span><Copy size={13} /></button><a href="https://finance.thatcanadian.dev" className="statement-finance-link">Finance dashboard<ArrowUpRight size={14} /></a>{bootstrap && <span className="statement-user">{bootstrap.actor}</span>}<a href="/logout" className="statement-logout">Sign out</a></div></header>
    <div className="statement-workspace"><aside className="statement-sidebar"><nav aria-label="Statement pages">{views.map(item => <button key={item.id} className={view === item.id ? "active" : ""} aria-current={view === item.id ? "page" : undefined} onClick={() => setView(item.id)}><item.icon size={16} /><span>{item.label}</span>{item.id === "pending" && pending > 0 && <span className="statement-nav-count">{pending}{!documentPage.isDone && "+"}</span>}</button>)}</nav><div className="statement-sidebar-foot"><span className="statement-live-dot" />Saved in Finance</div></aside>
      <div className="statement-content"><div className="statement-page-heading"><div><p className="statement-eyebrow">{views.find(item => item.id === view)?.label}</p><h1>{title}</h1></div><div className="row-actions"><Button variant="ghost" size="icon" aria-label="Refresh saved records" disabled={loading} onClick={refresh}><RefreshCw size={17} className={loading ? "spin" : ""} /></Button>{view !== "exact" && <><Button variant="outline" onClick={() => setUpload(true)} disabled={!bootstrap}><Upload size={15} />Upload</Button><Button className="primary-button" onClick={() => setManual(true)} disabled={!bootstrap}><Plus size={15} />Add transaction</Button></>}</div></div>
        <ErrorMessage error={error} />{error && <Button variant="outline" onClick={refresh}>Retry</Button>}{message && <div className="statement-notice" role="status">{message}<button aria-label="Dismiss notification" onClick={() => setMessage("")}>×</button></div>}
        {!bootstrap && loading ? <div className="statement-loading" role="status"><Loader2 size={22} className="spin" />Loading Statements…</div> : bootstrap && <>
          {(view === "transactions" || view === "completed") && <Transactions company={company} completed={view === "completed"} revision={revision} onSaved={save} onReview={setReview} onCopy={setCopy} />}
          {(view === "documents" || view === "pending") && <><DocumentsTable documents={documents} companyId={company} pending={view === "pending"} onSaved={save} /><div className="statement-list-coverage"><span>{documents.length} documents loaded{!documentPage.isDone && " · more records available"}</span>{!documentPage.isDone && <Button variant="outline" disabled={moreBusy} onClick={() => void loadMore("documents")}>{moreBusy && <Loader2 className="spin" size={14} />}Load more documents</Button>}</div></>}
          {view === "contacts" && <AddressBook entries={contacts} companyId={company} onSaved={save} />}
          {view === "imports" && <><ImportHistory imports={imports} onSaved={save} /><div className="statement-list-coverage"><span>{imports.length} imports loaded{!importPage.isDone && " · more records available"}</span>{!importPage.isDone && <Button variant="outline" disabled={moreBusy} onClick={() => void loadMore("imports")}>{moreBusy && <Loader2 className="spin" size={14} />}Load more imports</Button>}</div></>}
          {view === "settings" && <>{bootstrap.canManage && <ReceiptCameraSettings />}<CardSettings cards={bootstrap.cards} onSaved={save} /><SenderSettings revision={revision} /><InvoiceExamples companyId={company} revision={revision} onSaved={save} /></>}
          {view === "invoices" && <CreatedInvoices companyId={company} revision={revision} onSaved={save} />}
          {view === "exact" && <StatementExact revision={revision} />}
        </>}
      </div>
    </div>
    {(manual || copy) && <ManualTransactions companyId={company === "all" ? undefined : company} copy={copy || undefined} onClose={() => { setManual(false); setCopy(null); }} onSaved={save} />}
    {upload && bootstrap && <StatementUpload companyId={company === "all" ? undefined : company} cards={bootstrap.cards} onClose={() => setUpload(false)} onSaved={save} />}
    {review && <TransactionReview key={`${review._id}-${review.revision}`} transaction={review} documents={documents} onClose={() => setReview(null)} onSaved={save} />}
  </main>;
}

function Transactions({ company, completed, revision, onSaved, onReview, onCopy }: { company: string; completed: boolean; revision: number; onSaved: () => void; onReview: (row: StatementTransaction) => void; onCopy: (row: StatementTransaction) => void }) {
  const [search, setSearch] = useUrlState("search", ""), [status, setStatus] = useUrlState<string>("status", "all", { allowedValues: ["all", "pending", "reconciled", "completed"] });
  const [direction, setDirection] = useUrlState<string>("direction", "all", { allowedValues: ["all", "in", "out"] });
  const [currency, setCurrency] = useUrlState("currency", ""), [source, setSource] = useUrlState("source", "");
  const [companyFilter, setCompanyFilter] = useUrlState<string>("companyFilter", "all", { allowedValues: ["all", "unassigned", ...statementCompanies.map(row => row.id)] });
  const [from, setFrom] = useUrlState("from", ""), [to, setTo] = useUrlState("to", "");
  const [trash, setTrash] = useUrlState("trash", "no", { allowedValues: ["no", "yes"] });
  const sort = useStatementSort("transactions", statementSortKeys, "date");
  const [page, setPage] = useState(0), [list, setList] = useState<StatementList>(emptyList);
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [selectedRows, setSelectedRows] = useState<StatementTransaction[]>([]);
  const [invoiceRows, setInvoiceRows] = useState<StatementTransaction[] | null>(null);
  const [action, setAction] = useState<{ action: Action; ids: string[] } | null>(null);
  const [exportBusy, setExportBusy] = useState(false), [selectionBusy, setSelectionBusy] = useState(false);
  const selectionAbort = useRef<AbortController | null>(null);
  const selected = selectedRows.map(row => row._id);
  const scope = JSON.stringify([company, companyFilter, completed, search, status, direction, currency, source, from, to, trash, sort.sort, sort.order]);
  const params = useMemo(() => new URLSearchParams({ companyId: company === "all" ? companyFilter : company, status: completed ? "completed" : status, search, direction, currency, source, from, to, sort: sort.sort, order: sort.order, trash: trash === "yes" ? "1" : "0", offset: String(page * pageSize), limit: String(pageSize) }), [company, companyFilter, completed, status, search, direction, currency, source, from, to, sort.sort, sort.order, trash, page]);
  useEffect(() => { setPage(0); setSelectedRows([]); setSelectionBusy(false); selectionAbort.current?.abort(); return () => selectionAbort.current?.abort(); }, [scope]);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setError("");
    void statementRequest<StatementList>(`/transactions?${params}`, { signal: abort.signal }).then(result => { setList(result); setSelectedRows(current => current.map(row => result.transactions.find(next => next._id === row._id) ?? row)); }).catch(err => { if (!abort.signal.aborted) setError(err instanceof Error ? err.message : "Transactions unavailable"); }).finally(() => { if (!abort.signal.aborted) setLoading(false); }); return () => abort.abort();
  }, [params, revision]);
  const chosen = selectedRows;
  const allSelected = list.transactions.length > 0 && list.transactions.every(row => selected.includes(row._id));
  const selectAll = async () => {
    selectionAbort.current?.abort(); const abort = new AbortController(); selectionAbort.current = abort;
    setSelectionBusy(true); setError("");
    try { const rows = await collectSelectedRows(async offset => { const query = new URLSearchParams(params); query.set("offset", String(offset)); return statementRequest<StatementList>(`/transactions?${query}`, { signal: abort.signal }); }, list.total, abort.signal); setSelectedRows(rows); }
    catch (err) { if (!abort.signal.aborted) setError(err instanceof Error ? err.message : "Transactions could not be selected"); }
    finally { if (!abort.signal.aborted) setSelectionBusy(false); }
  };
  const download = async () => {
    setExportBusy(true); setError("");
    try {
      const exported: StatementTransaction[] = []; let offset = 0;
      for (let i = 0; i < 200; i++) { const query = new URLSearchParams(params); query.set("offset", String(offset)); query.set("limit", "100"); const result = await statementRequest<StatementList>(`/transactions?${query}`); if (result.truncated) throw new Error("Choose a smaller date range before downloading. Some records are missing from this list."); exported.push(...result.transactions); if (!result.hasMore) break; if (!result.transactions.length || i === 199) throw new Error("Some records could not be downloaded. Choose a smaller date range and try again."); offset += result.transactions.length; }
      const headers = ["Date", "Company", "Paid to / received from", "Description", "Reference", "Bank / service", "Account", "Bank transaction ID", "Last 4 card digits", "Amount", "Currency", "Direction", "Added from", "Status", "Fee", "Balance", "Notes"];
      const rows = exported.map(row => [row.date, companyName(row.companyId), row.counterparty, row.description, row.reference, row.source, row.account, row.providerId, row.cardLastFour, decimalAmount(row.amountMinor, row.currency), row.currency, row.direction, row.origin, row.status, row.feeMinor ? decimalAmount(row.feeMinor, row.currency) : "", row.balanceMinor ? decimalAmount(row.balanceMinor, row.currency) : "", row.notes]);
      downloadText(`statements-${new Date().toLocaleDateString("en-CA")}.csv`, [headers, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n"));
    } catch (err) { setError(err instanceof Error ? err.message : "Download failed"); } finally { setExportBusy(false); }
  };
  return <>
    <div className="statement-summary"><div><span>{list.truncated ? "Transactions shown" : "Transactions"}</span><strong>{list.total.toLocaleString()}{list.truncated && "+"}</strong></div>{list.totals.map(total => <div key={total.currency}><span>{total.currency}{list.truncated && " · incomplete totals"}</span><div className="statement-summary-values"><span><ArrowDownLeft size={14} />{displayAmount(total.inMinor, total.currency)}</span><span><ArrowUpRight size={14} />{displayAmount(total.outMinor, total.currency)}</span></div></div>)}{list.truncated && <span className="statement-warning">Only 2,000 saved records can be checked at once. Choose a smaller date range to see complete totals.</span>}</div>
    <section className="statement-panel"><div className="statement-filterbar"><div className="statement-search"><Search size={16} /><Input aria-label="Search transactions" placeholder="Search transactions" value={search} onChange={event => setSearch(event.target.value)} /></div>
      {company === "all" && <NativeSelect aria-label="Filter company" value={companyFilter} onValueChange={setCompanyFilter}><NativeSelectOption value="all">All companies</NativeSelectOption><NativeSelectOption value="unassigned">No company</NativeSelectOption>{statementCompanies.map(row => <NativeSelectOption key={row.id} value={row.id}>{row.name}</NativeSelectOption>)}</NativeSelect>}
      {!completed && <NativeSelect aria-label="Filter status" value={status} onValueChange={setStatus}><NativeSelectOption value="all">Any status</NativeSelectOption><NativeSelectOption value="pending">Needs checking</NativeSelectOption><NativeSelectOption value="reconciled">Checked</NativeSelectOption><NativeSelectOption value="completed">Done</NativeSelectOption></NativeSelect>}
      <NativeSelect aria-label="Filter direction" value={direction} onValueChange={setDirection}><NativeSelectOption value="all">In & out</NativeSelectOption><NativeSelectOption value="in">Money in</NativeSelectOption><NativeSelectOption value="out">Money out</NativeSelectOption></NativeSelect>
      <details className="statement-more-filters"><summary>More filters</summary><div><label>From<Input type="date" value={from} onChange={event => setFrom(event.target.value)} /></label><label>To<Input type="date" value={to} onChange={event => setTo(event.target.value)} /></label><label>Currency<Input value={currency} placeholder="Any currency" maxLength={4} onChange={event => setCurrency(event.target.value.toUpperCase())} /></label><label>Bank / service<Input value={source} placeholder="Any source" onChange={event => setSource(event.target.value)} /></label></div></details>
      <Button variant="ghost" size="icon" aria-label={trash === "yes" ? "Show active transactions" : "Show Trash"} className={trash === "yes" ? "statement-active-button" : ""} onClick={() => setTrash(trash === "yes" ? "no" : "yes")}><Trash2 size={16} /></Button><Button variant="outline" disabled={exportBusy || loading} onClick={() => void download()}>{exportBusy ? <Loader2 size={14} className="spin" /> : <Download size={14} />}Download CSV</Button>
    </div>
    <div className="statement-selection"><label className="statement-checkbox"><Checkbox aria-label="Select this page" disabled={loading || selectionBusy} checked={allSelected} indeterminate={list.transactions.some(row => selected.includes(row._id)) && !allSelected} onCheckedChange={value => setSelectedRows(current => changeSelectedPage(current, list.transactions, Boolean(value)))} />Select this page</label><Button variant="ghost" size="sm" disabled={loading || selectionBusy || list.truncated || !list.total} onClick={() => void selectAll()}>{selectionBusy && <Loader2 size={14} className="spin" />}Select all {list.total.toLocaleString()} matching transactions</Button></div>
    {selected.length > 0 && <div className="statement-bulk"><strong role="status">{selected.length} selected across all pages</strong>{trash === "yes" ? <Button variant="outline" size="sm" disabled={selectionBusy} onClick={() => setAction({ ids: selected, action: "restore" })}><RotateCcw size={14} />Restore</Button> : <><Button variant="outline" size="sm" disabled={selectionBusy || chosen.some(row => row.status !== "pending")} onClick={() => setAction({ ids: selected, action: "reconcile" })}><Check size={14} />Mark checked</Button><Button variant="outline" size="sm" disabled={selectionBusy || chosen.some(row => row.status !== "reconciled")} onClick={() => setAction({ ids: selected, action: "complete" })}><CheckCheck size={14} />Mark done</Button><Button variant="outline" size="sm" disabled={selectionBusy || chosen.some(row => row.status === "pending")} onClick={() => setAction({ ids: selected, action: "reopen" })}><RotateCcw size={14} />Check again</Button><Button variant="outline" size="sm" disabled={selectionBusy} onClick={() => setInvoiceRows([...chosen])}><FileText size={14} />Create AI invoice</Button><Button variant="ghost" size="sm" disabled={selectionBusy} onClick={() => setAction({ ids: selected, action: "trash" })}><Trash2 size={14} />Trash</Button></>}<Button variant="ghost" size="sm" disabled={selectionBusy} onClick={() => setSelectedRows([])}>Clear selection</Button></div>}
    <ErrorMessage error={error} />
    <div className="table-wrap statement-transactions-table" aria-busy={loading}><table className="data-table"><thead><tr><th><Checkbox aria-label="Select all transactions on this page" disabled={loading || selectionBusy} checked={allSelected} indeterminate={list.transactions.some(row => selected.includes(row._id)) && !allSelected} onCheckedChange={value => setSelectedRows(current => changeSelectedPage(current, list.transactions, Boolean(value)))} /></th>{sort.head("date", "Date")}{sort.head("companyId", "Company")}{sort.head("description", "Description")}{sort.head("amountMinor", "Amount")}{sort.head("currency", "Currency")}{sort.head("status", "Status")}{sort.head("counterparty", "Paid to / received from")}{sort.head("reference", "Reference")}{sort.head("direction", "Direction")}{sort.head("source", "Bank / service")}{sort.head("account", "Account")}{sort.head("cardLastFour", "Card")}{sort.head("origin", "Added from")}<th>Actions</th></tr></thead><tbody>
      {list.transactions.map(row => <tr key={row._id} data-selected={selected.includes(row._id) || undefined}><td><Checkbox aria-label={`Select ${row.description}`} checked={selected.includes(row._id)} disabled={loading || selectionBusy} onCheckedChange={checked => setSelectedRows(current => changeSelectedPage(current, [row], Boolean(checked)))} /></td><td>{row.date}</td><td>{companyName(row.companyId)}</td><td><button className="statement-text-button" onClick={() => onReview(row)}>{row.description}</button>{row.reviewReasons.length > 0 && <InfoPopover label={`Review issues for ${row.description}`}>{row.reviewReasons.map(simpleStatementText).join(" · ")}</InfoPopover>}</td><td className="amount">{decimalAmount(row.amountMinor, row.currency)}</td><td>{row.currency}</td><td><StatusPill value={row.status} /></td><td>{row.counterparty || "—"}</td><td>{row.reference || "—"}</td><td><span className={`statement-direction ${row.direction}`}>{row.direction === "in" ? <ArrowDownLeft size={13} /> : <ArrowUpRight size={13} />}{row.direction === "in" ? "In" : "Out"}</span></td><td>{row.source}</td><td>{row.account || "—"}</td><td>{row.cardLastFour ? `•••• ${row.cardLastFour}` : "—"}</td><td>{statementOrigin(row.origin)}</td><td><div className="row-actions"><Button variant="ghost" size="sm" onClick={() => onReview(row)}>Check</Button><Button variant="ghost" size="icon" aria-label={`Copy ${row.description}`} onClick={() => onCopy(row)}><Copy size={14} /></Button>{trash === "yes" ? <Button variant="ghost" size="icon" aria-label={`Restore ${row.description}`} onClick={() => setAction({ ids: [row._id], action: "restore" })}><RotateCcw size={14} /></Button> : <Button variant="ghost" size="icon" aria-label={`${row.status === "pending" ? "Mark checked" : row.status === "reconciled" ? "Mark done" : "Check again"} ${row.description}`} onClick={() => setAction({ ids: [row._id], action: row.status === "pending" ? "reconcile" : row.status === "reconciled" ? "complete" : "reopen" })}>{row.status === "pending" ? <Check size={14} /> : row.status === "reconciled" ? <CheckCheck size={14} /> : <RotateCcw size={14} />}</Button>}</div></td></tr>)}
      {!list.transactions.length && <tr><td colSpan={15} className="statement-empty">{loading ? "Loading saved transactions…" : trash === "yes" ? "Trash is empty." : "No transactions match this view."}</td></tr>}
    </tbody></table></div>
    <div className="statement-pagination"><span>{list.total ? `${page * pageSize + 1}–${page * pageSize + list.transactions.length} of ${list.total.toLocaleString()}` : "0 transactions"}{loading && <Loader2 size={13} className="spin" />}</span><div className="row-actions"><Button variant="outline" size="sm" disabled={page === 0 || loading} onClick={() => setPage(value => value - 1)}><ChevronLeft size={14} />Previous</Button><Button variant="outline" size="sm" disabled={!list.hasMore || loading} onClick={() => setPage(value => value + 1)}>Next<ChevronRight size={14} /></Button></div></div>
    </section>
    {invoiceRows && <CreateAiInvoice rows={invoiceRows} onClose={() => setInvoiceRows(null)} onSaved={onSaved} />}
    {action && <ActionDialog action={action.action} ids={action.ids} onClose={() => setAction(null)} onSaved={changed => { setSelectedRows(current => current.filter(row => !changed.includes(row._id))); onSaved(); }} />}
  </>;
}

function ActionDialog({ action, ids, onClose, onSaved }: { action: Action; ids: string[]; onClose: () => void; onSaved: (ids: string[]) => void }) {
  const [done, setDone] = useState(0), [stopped, setStopped] = useState(false);
  const [reason, setReason] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const descriptions: Record<Action, string> = { reconcile: "Confirm that you checked the linked receipts or invoices for the full amount. This does not mark an invoice paid.", complete: "Mark these checked transactions as done.", reopen: "Move these transactions back to Needs checking. Linked documents stay attached.", trash: "Move these transactions to Trash. You can restore them later.", restore: "Move these transactions out of Trash." };
  return <StatementModal title={`${actionNames[action]} ${ids.length === 1 ? "transaction" : `${ids.length} transactions`}?`} onClose={onClose} busy={busy}><form onSubmit={async event => { event.preventDefault(); setBusy(true); setError(""); try { await applySelectedBatches(ids, batch => statementRequest("/transactions/actions", jsonRequest("POST", { ids: batch, action, reason: reason || undefined })), changed => { setDone(count => count + changed.length); onSaved(changed); }); onClose(); } catch (err) { setStopped(true); setError(`${err instanceof Error ? err.message : "Action failed"}. Stopped here. Close this window and check the list before trying again; the last group may already have changed.`); onSaved([]); } finally { setBusy(false); } }}><p>{descriptions[action]}</p>{(busy || stopped) && <p role="status">{done} of {ids.length} changes confirmed.</p>}<label>Review note{action === "reopen" && " (required)"}<Input value={reason} required={action === "reopen"} onChange={event => setReason(event.target.value)} /></label><ErrorMessage error={error} /><div className="statement-dialog-footer"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" variant={action === "trash" ? "destructive" : "default"} className={action === "trash" ? undefined : "primary-button"} disabled={busy || stopped}>{busy && <Loader2 size={15} className="spin" />}{actionNames[action]}</Button></div></form></StatementModal>;
}
