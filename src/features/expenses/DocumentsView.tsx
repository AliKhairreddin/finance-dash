import { Popover } from "@base-ui/react/popover";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ChevronDown, Download, FilePlus2, Folder, Plus, Loader2, RefreshCw, Upload, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { InfoPopover } from "@/components/ui/finance-visuals";
import { SortableTableHead, compareTableValues, type TableSortDirection } from "@/components/ui/sortable-table-head";
import { useUrlState } from "@/lib/url-state";
import { documentInbox, documentContentTypes, documentMaximumBytes, documentTransactionLink, type DocumentExtraction, type FinancialDocument } from "../../../shared/financialDocuments";
import { wiseEntityLabel } from "../../../shared/wiseEntities";

const labels: Record<FinancialDocument["status"], string> = { queued: "Queued", processing: "Processing", needs_review: "Needs review", unmatched: "Awaiting match", matched: "Matched", failed: "Failed" };
async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok) throw new Error(result.message ?? "Document request failed");
  return result;
}

export function DocumentCreateMenu({ apiBase, label, manualLabel, onCreate }: {
  apiBase: string;
  label: string;
  manualLabel: string;
  onCreate: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className="primary-button document-create-trigger" aria-label={label}>
        <Plus size={15} /><span>{label}</span><ChevronDown size={13} />
      </Popover.Trigger>
      <Popover.Portal keepMounted>
        <Popover.Positioner className="toolbar-popover-positioner" sideOffset={6} align="end">
          <Popover.Popup className="toolbar-popover-popup document-create-popup">
            <Popover.Title className="screen-reader-only">{label}</Popover.Title>
            <DocumentUploadButton apiBase={apiBase} label="Upload an existing document" onOpen={() => setOpen(false)} />
            <Button className="icon-text-button" onClick={() => { setOpen(false); onCreate(); }}><FilePlus2 size={15} /> {manualLabel}</Button>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function DocumentUploadButton({ apiBase, onUploaded, defaultEntity, label = "Upload documents", onOpen }: { apiBase: string; onUploaded?: () => void; defaultEntity?: "dn" | "lmd"; label?: string; onOpen?: () => void }) {
  const [open, setOpen] = useState(false), [entity, setEntity] = useState(defaultEntity ?? "auto");
  const [files, setFiles] = useState<File[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [message, setMessage] = useState("");
  return <>
    <Button className="primary-button" title="Import existing invoices or receipts from files" onClick={() => { setOpen(true); setEntity(defaultEntity ?? "auto"); setError(""); setMessage(""); onOpen?.(); }}><Upload size={15} /> {label}</Button>
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value); }}><DialogContent className="document-dialog" showCloseButton={false}>
      <div className="panel-header"><DialogTitle>Upload receipts or invoices</DialogTitle><Button aria-label="Close upload" disabled={busy} onClick={() => setOpen(false)}><X size={18} /></Button></div>
      <form onSubmit={async (e: FormEvent) => {
        e.preventDefault(); setError(""); setBusy(true);
        try {
          if (!files.length) throw new Error("Choose at least one file");
          let duplicates = 0;
          for (let index = 0; index < files.length; index++) {
            const file = files[index];
            if (!documentContentTypes.includes(file.type as typeof documentContentTypes[number]) || file.size <= 0 || file.size > documentMaximumBytes) throw new Error(`${file.name}: choose a PDF, PNG, JPEG, or WebP up to 10 MB`);
            setMessage(`Saving ${index + 1} of ${files.length}…`);
            const result = await request<{ duplicate: boolean }>(`${apiBase}/documents/upload`, { method: "POST", headers: { "Content-Type": file.type, "X-File-Name": encodeURIComponent(file.name), ...(entity !== "auto" ? { "X-Document-Entity": entity } : {}) }, body: file });
            if (result.duplicate) duplicates++;
          }
          setMessage(`${files.length - duplicates} saved for processing${duplicates ? ` · ${duplicates} already saved` : ""}`);
          setFiles([]); onUploaded?.(); window.dispatchEvent(new Event("finance:documents-changed"));
        } catch (err) { setError(err instanceof Error ? err.message : "Upload failed"); } finally { setBusy(false); }
      }}>
        <label>Company<NativeSelect aria-label="Document company" value={entity} onValueChange={setEntity}><NativeSelectOption value="auto">Detect from document</NativeSelectOption><NativeSelectOption value="dn">Digital Nudge</NativeSelectOption><NativeSelectOption value="lmd">Love Me Do</NativeSelectOption></NativeSelect></label>
        <label className="document-drop-zone"><Upload size={25} /><span>PDF, PNG, JPEG, WebP · up to 10 MB each</span><Input type="file" accept={documentContentTypes.join(",")} multiple disabled={busy} onChange={e => { setFiles(Array.from(e.target.files ?? [])); setMessage(""); }} /></label>
        {error && <p className="inline-error" role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
        <div className="row-actions"><Button type="submit" className="primary-button" disabled={busy || !files.length}>{busy && <Loader2 size={15} className="spin" />} Save and process</Button><a href="?page=documents">View documents</a></div>
      </form>
    </DialogContent></Dialog>
  </>;
}

function ReviewDocument({ document, apiBase, onClose, onSaved }: { document: FinancialDocument; apiBase: string; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<DocumentExtraction>(document.extraction ?? { kind: "unknown", entity: document.entity ?? null, counterparty: "", documentNumber: "", issueDate: null, dueDate: null, amount: null, currency: null, description: "", confidence: 1, reviewReasons: [] });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <Dialog open onOpenChange={value => { if (!value && !busy) onClose(); }}><DialogContent className="document-dialog" showCloseButton={false}>
    <div className="panel-header"><DialogTitle>Review document</DialogTitle><Button aria-label="Close document review" onClick={onClose}><X size={18} /></Button></div>
    <a href={`${apiBase}/documents/${document._id}/file`}><Download size={14} /> {document.fileName}</a>
    <form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(""); try { await request(`${apiBase}/documents/${document._id}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) }); onSaved(); onClose(); window.dispatchEvent(new Event("finance:documents-changed")); } catch (err) { setError(err instanceof Error ? err.message : "Review failed"); } finally { setBusy(false); } }}>
      <div className="document-form-grid">
        <label>Company<NativeSelect aria-label="Company" value={draft.entity ?? ""} onValueChange={value => setDraft({ ...draft, entity: value as "dn" | "lmd" })}><NativeSelectOption value="">Choose company</NativeSelectOption><NativeSelectOption value="dn">Digital Nudge</NativeSelectOption><NativeSelectOption value="lmd">Love Me Do</NativeSelectOption></NativeSelect></label>
        <label>Document type<NativeSelect aria-label="Document type" disabled={Boolean(document.invoiceId || document.expenseId)} value={draft.kind} onValueChange={value => setDraft({ ...draft, kind: value as DocumentExtraction["kind"] })}><NativeSelectOption value="unknown">Choose type</NativeSelectOption><NativeSelectOption value="expense">Expense / supplier invoice</NativeSelectOption><NativeSelectOption value="invoice">Sales invoice</NativeSelectOption></NativeSelect></label>
        <label>Supplier / customer<Input required value={draft.counterparty} onChange={e => setDraft({ ...draft, counterparty: e.target.value })} /></label>
        <label>Document number<Input value={draft.documentNumber} onChange={e => setDraft({ ...draft, documentNumber: e.target.value })} /></label>
        <label>Document date<Input type="date" required value={draft.issueDate ?? ""} onChange={e => setDraft({ ...draft, issueDate: e.target.value })} /></label>
        <label>Due date<Input type="date" value={draft.dueDate ?? ""} onChange={e => setDraft({ ...draft, dueDate: e.target.value || null })} /></label>
        <label>Gross total<Input type="number" min="0.01" step="0.01" required value={draft.amount ?? ""} onChange={e => setDraft({ ...draft, amount: Number(e.target.value) })} /></label>
        <label>Currency<Input required pattern="[A-Z]{3}" maxLength={3} value={draft.currency ?? ""} onChange={e => setDraft({ ...draft, currency: e.target.value.toUpperCase() })} /></label>
      </div>
      <label>Description<Input value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
      {error && <p role="alert" className="inline-error">{error}</p>}
      <Button className="primary-button" disabled={busy}>{busy && <Loader2 className="spin" size={15} />} Save and match</Button>
    </form>
  </DialogContent></Dialog>;
}

type SortKey = "file" | "date" | "kind" | "amount" | "source" | "status" | "match";
type FolderRow = { entity?: "dn" | "lmd"; month: string; count: number };
export function DocumentsView({ apiBase }: { apiBase: string }) {
  const [entity, setEntity] = useUrlState("documentCompany", "all", { allowedValues: ["all", "dn", "lmd", "unassigned"] });
  const [month, setMonth] = useUrlState("documentMonth", "all");
  const [kind, setKind] = useUrlState("documentKind", "all", { allowedValues: ["all", "expense", "invoice"] });
  const [status, setStatus] = useUrlState("documentStatus", "all");
  const [search, setSearch] = useUrlState("documentSearch", "");
  const [sort, setSort] = useUrlState<SortKey>("documentSort", "date", { allowedValues: ["file", "date", "kind", "amount", "source", "status", "match"] });
  const [order, setOrder] = useUrlState<TableSortDirection>("documentOrder", "desc", { allowedValues: ["asc", "desc"] });
  const [documents, setDocuments] = useState<FinancialDocument[]>([]), [folders, setFolders] = useState<FolderRow[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [matchDocument, setMatchDocument] = useState<FinancialDocument | null>(null);
  const [review, setReview] = useState<FinancialDocument | null>(null);
  const refreshing = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    refreshing.current?.abort();
    const controller = new AbortController(); refreshing.current = controller;
    try {
      const params = new URLSearchParams(); if (entity !== "all") params.set("entity", entity); if (month !== "all") params.set("month", month);
      const all: FinancialDocument[] = []; let cursor = "";
      do { if (cursor) params.set("cursor", cursor); const page = await request<{ page: FinancialDocument[]; isDone: boolean; continueCursor: string }>(`${apiBase}/documents?${params}`, { signal: controller.signal }); all.push(...page.page); cursor = page.isDone ? "" : page.continueCursor; } while (cursor);
      const nextFolders = await request<FolderRow[]>(`${apiBase}/documents/folders`, { signal: controller.signal });
      if (!controller.signal.aborted) { setDocuments(all); setFolders(nextFolders); setError(""); }
    } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Documents could not be loaded"); } finally { if (!controller.signal.aborted) { setLoading(false); refreshing.current = null; } }
  }, [apiBase, entity, month]);
  useEffect(() => { setLoading(true); void refresh(); const timer = window.setInterval(() => { if (document.visibilityState === "visible" && !refreshing.current) void refresh(); }, 5000); return () => { window.clearInterval(timer); refreshing.current?.abort(); }; }, [refresh]);
  const months = folders.filter(f => entity === "all" || (f.entity ?? "unassigned") === entity).reduce<Record<string, number>>((out, f) => ({ ...out, [f.month]: (out[f.month] ?? 0) + f.count }), {});
  const value = (doc: FinancialDocument) => sort === "file" ? `${doc.extraction?.counterparty ?? ""} ${doc.fileName}` : sort === "date" ? doc.extraction?.issueDate ?? doc.createdAt : sort === "amount" ? doc.extraction?.amount : sort === "match" ? doc.transactionId : doc[sort];
  const rows = documents.filter(doc => (kind === "all" || doc.kind === kind) && (status === "all" || doc.status === status) && `${doc.fileName} ${doc.extraction?.counterparty ?? ""} ${doc.extraction?.documentNumber ?? ""}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => compareTableValues(value(a), value(b), order) || a._id.localeCompare(b._id));
  const onSort = (key: SortKey) => { if (key === sort) setOrder(order === "asc" ? "desc" : "asc"); else { setSort(key); setOrder("asc"); } };
  const head = (key: SortKey, label: string) => <SortableTableHead activeSortKey={sort} direction={order} onSort={onSort} sortKey={key}>{label}</SortableTableHead>;
  return <div className="documents-page">
    <div className="panel-header"><div><p className="eyebrow">Receipts and invoices</p><h1>Documents</h1></div><div className="row-actions"><InfoPopover label="Document intake"><p>Forward to <strong>{documentInbox}</strong> from any email, upload here, or send files to the Telegram bot as Ali or Ali M. Originals are saved before AI processing. A match does not mark an invoice paid. Amounts and company details that need review remain here.</p></InfoPopover><DocumentUploadButton apiBase={apiBase} defaultEntity={entity === "dn" || entity === "lmd" ? entity : undefined} onUploaded={() => void refresh()} /></div></div>
    <div className="document-company-tabs" role="group" aria-label="Document company">{[["all", "All companies"], ["dn", "Digital Nudge"], ["lmd", "Love Me Do"], ["unassigned", "Unassigned"]].map(([id, name]) => <Button key={id} className={entity === id ? "primary-button" : "secondary-button"} aria-pressed={entity === id} onClick={() => { setEntity(id as typeof entity); setMonth("all"); }}>{name}</Button>)}</div>
    <div className="document-folders" aria-label="Monthly document folders"><Button className={month === "all" ? "document-folder active" : "document-folder"} onClick={() => setMonth("all")}><Folder size={21} /><span>All months</span></Button>{Object.entries(months).sort(([a], [b]) => b.localeCompare(a)).map(([key, count]) => <Button key={key} className={`document-folder ${month === key ? "active" : ""}`} onClick={() => setMonth(key)}><Folder size={21} /><span>{new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}-01T00:00:00Z`))}</span><small>{count}</small></Button>)}</div>
    <section className="panel"><div className="list-toolbar document-toolbar"><Input aria-label="Search documents" placeholder="Search documents" value={search} onChange={e => setSearch(e.target.value)} /><NativeSelect aria-label="Filter document type" value={kind} onValueChange={value => setKind(value as typeof kind)}><NativeSelectOption value="all">Expenses and invoices</NativeSelectOption><NativeSelectOption value="expense">Expenses</NativeSelectOption><NativeSelectOption value="invoice">Invoices</NativeSelectOption></NativeSelect><NativeSelect aria-label="Filter processing status" value={status} onValueChange={setStatus}><NativeSelectOption value="all">All statuses</NativeSelectOption>{Object.entries(labels).map(([key, label]) => <NativeSelectOption key={key} value={key}>{label}</NativeSelectOption>)}</NativeSelect><Button aria-label="Refresh documents" onClick={() => void refresh()}><RefreshCw size={16} /></Button></div>
      {error && <p role="alert" className="inline-error">{error}</p>}
      <div className="table-wrap"><table className="data-table"><thead><tr>{head("file", "Document / company")}{head("date", "Date")}{head("kind", "Type")}{head("amount", "Amount")}{head("source", "Received via")}{head("status", "Status")}{head("match", "Bank match")}<th>Actions</th></tr></thead><tbody>
        {rows.map(doc => <tr key={doc._id}><td><strong>{doc.extraction?.counterparty || doc.fileName}</strong><small>{doc.entity ? wiseEntityLabel(doc.entity) : "Company needs review"}</small><a href={`${apiBase}/documents/${doc._id}/file`}>{doc.fileName}</a></td><td>{doc.extraction?.issueDate ?? "—"}</td><td>{doc.kind === "unknown" ? "—" : doc.kind === "invoice" ? "Sales invoice" : "Expense"}</td><td className="amount">{doc.extraction?.amount !== null && doc.extraction?.amount !== undefined ? `${doc.extraction.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${doc.extraction.currency ?? ""}` : "—"}</td><td>{doc.source}</td><td><span className={`status-pill ${doc.status === "matched" ? "good" : doc.status === "failed" ? "danger" : "warning"}`}>{labels[doc.status]}</span>{(doc.error || doc.extraction?.reviewReasons.length || doc.matchReason) && <InfoPopover label={`Details for ${doc.fileName}`}><p>{doc.error || doc.extraction?.reviewReasons.join(". ") || doc.matchReason}</p>{doc.processedAt && <p>Processed in {Math.max(0, Math.round((Date.parse(doc.processedAt) - Date.parse(doc.createdAt)) / 1000))} seconds.</p>}</InfoPopover>}</td><td>{doc.transactionId ? <a href={documentTransactionLink(doc.transactionId)}>View transaction</a> : "—"}</td><td><div className="row-actions"><a aria-label={`Download ${doc.fileName}`} href={`${apiBase}/documents/${doc._id}/file`}><Download size={15} /></a>{["needs_review", "failed"].includes(doc.status) && <Button className="icon-text-button" onClick={() => setReview(doc)}>Review</Button>}{doc.status === "failed" && <Button className="icon-text-button" onClick={async () => { try { await request(`${apiBase}/documents/${doc._id}/retry`, { method: "POST" }); void refresh(); } catch (err) { setError(String(err)); } }}>Retry</Button>}{doc.status === "unmatched" && <Button className="icon-text-button" onClick={() => setMatchDocument(doc)}>Review match</Button>}</div></td></tr>)}
        {!rows.length && <tr><td colSpan={8}>{loading ? <span role="status"><Loader2 size={16} className="spin" /> Loading documents…</span> : "No documents in this view"}</td></tr>}
      </tbody></table></div>
    </section>
    {matchDocument && <MatchDocument document={matchDocument} apiBase={apiBase} onClose={() => setMatchDocument(null)} onSaved={() => void refresh()} />}
    {review && <ReviewDocument document={review} apiBase={apiBase} onClose={() => setReview(null)} onSaved={() => void refresh()} />}
  </div>;
}


type MatchCandidate = { id: string; date: string; counterparty: string; accountName: string; amount: number; currency: string };
function MatchDocument({ document, apiBase, onClose, onSaved }: { document: FinancialDocument; apiBase: string; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState<MatchCandidate[]>([]), [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => { const controller = new AbortController(); void request<MatchCandidate[]>(`${apiBase}/documents/${document._id}/candidates`, { signal: controller.signal }).then(setRows).catch(err => { if (!controller.signal.aborted) setError(String(err)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); }); return () => controller.abort(); }, [apiBase, document._id]);
  return <Dialog open onOpenChange={value => { if (!value && !busy) onClose(); }}><DialogContent className="document-dialog"><DialogTitle>Match {document.extraction?.documentNumber || document.fileName}</DialogTitle>
    <label>Bank transaction<NativeSelect aria-label="Choose matching transaction" value={selected} onValueChange={setSelected}><NativeSelectOption value="">Choose transaction</NativeSelectOption>{rows.map(row => <NativeSelectOption key={row.id} value={row.id}>{row.date} · {row.counterparty} · {row.amount} {row.currency} · {row.accountName}</NativeSelectOption>)}</NativeSelect></label>
    {loading && <p role="status">Finding transactions…</p>}{!loading && !rows.length && <p>No available transaction has the same total, currency, company, and date window yet.</p>}
    {selected && <a href={documentTransactionLink(selected)}>View selected bank transaction</a>}
    {error && <p className="inline-error" role="alert">{error}</p>}
    <div className="row-actions"><Button className="primary-button" disabled={!selected || busy} onClick={async () => { setBusy(true); setError(""); try { await request(`${apiBase}/documents/${document._id}/match`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ transactionId: selected }) }); onSaved(); window.dispatchEvent(new Event("finance:documents-changed")); onClose(); } catch (err) { setError(String(err)); } finally { setBusy(false); } }}>Confirm match</Button><InfoPopover label="Confirming a match"><p>Links the original document to this transaction. Payment status stays unchanged.</p></InfoPopover></div>
  </DialogContent></Dialog>;
}
