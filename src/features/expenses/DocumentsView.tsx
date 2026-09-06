import { Menu } from "@base-ui/react/menu";
import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { ChevronDown, Download, FilePlus2, Folder, Plus, Loader2, RefreshCw, Upload, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { InfoPopover } from "@/components/ui/finance-visuals";
import { SortableTableHead, compareTableValues, type TableSortDirection } from "@/components/ui/sortable-table-head";
import { useUrlState } from "@/lib/url-state";
import { documentInbox, documentContentTypes, documentMaximumBytes, documentTransactionLink, type DocumentExtraction, type FinancialDocument } from "../../../shared/financialDocuments";
import { documentLibraryView, filterLibraryDocuments, type DocumentCompany } from "../../../shared/documentLibrary";
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
  const [uploadOpen, setUploadOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Menu.Root>
        <Menu.Trigger ref={triggerRef} className="primary-button document-create-trigger" aria-label={label}>
          <Plus size={15} /><span>{label}</span><ChevronDown size={13} />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner className="document-create-positioner" sideOffset={6} align="end" collisionPadding={12}>
            <Menu.Popup className="document-create-popup" aria-label={label}>
              <Menu.Item className="document-create-item" onClick={() => setUploadOpen(true)}>
                <Upload size={15} aria-hidden="true" /><span>Upload an existing document</span>
              </Menu.Item>
              <Menu.Item className="document-create-item" onClick={onCreate}>
                <FilePlus2 size={15} aria-hidden="true" /><span>{manualLabel}</span>
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      {uploadOpen && <DocumentUploadDialog apiBase={apiBase} onClose={() => setUploadOpen(false)} finalFocus={triggerRef} />}
    </>
  );
}

export function DocumentUploadButton({ apiBase, onUploaded, defaultEntity }: { apiBase: string; onUploaded?: () => void; defaultEntity?: "dn" | "lmd" }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return <>
    <Button ref={triggerRef} className="primary-button" title="Import existing invoices or receipts from files" onClick={() => setOpen(true)}><Upload size={15} /> Upload documents</Button>
    {open && <DocumentUploadDialog apiBase={apiBase} onUploaded={onUploaded} defaultEntity={defaultEntity} onClose={() => setOpen(false)} finalFocus={triggerRef} />}
  </>;
}

function DocumentUploadDialog({ apiBase, onUploaded, defaultEntity, onClose, finalFocus }: { apiBase: string; onUploaded?: () => void; defaultEntity?: "dn" | "lmd"; onClose: () => void; finalFocus: RefObject<HTMLButtonElement | null> }) {
  const [entity, setEntity] = useState(defaultEntity ?? "auto");
  const [files, setFiles] = useState<File[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [message, setMessage] = useState("");
  return <Dialog open onOpenChange={value => { if (!value && !busy) onClose(); }}><DialogContent className="document-dialog" showCloseButton={false} finalFocus={finalFocus}>
      <div className="panel-header"><DialogTitle>Upload receipts or invoices</DialogTitle><Button aria-label="Close upload" disabled={busy} onClick={onClose}><X size={18} /></Button></div>
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
    </DialogContent></Dialog>;
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
export function DocumentsView({ apiBase }: { apiBase: string }) {
  const [entity, setEntity] = useUrlState<DocumentCompany>("documentCompany", "all", { allowedValues: ["all", "dn", "lmd", "unassigned"] });
  const [month, setMonth] = useUrlState("documentMonth", "all");
  const [kind, setKind] = useUrlState<FinancialDocument["kind"]>("documentKind", "expense", { allowedValues: ["expense", "invoice", "unknown"] });
  const [status, setStatus] = useUrlState("documentStatus", "all");
  const [search, setSearch] = useUrlState("documentSearch", "");
  const [sort, setSort] = useUrlState<SortKey>("documentSort", "date", { allowedValues: ["file", "date", "kind", "amount", "source", "status", "match"] });
  const [order, setOrder] = useUrlState<TableSortDirection>("documentOrder", "desc", { allowedValues: ["asc", "desc"] });
  const [documents, setDocuments] = useState<FinancialDocument[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [matchDocument, setMatchDocument] = useState<FinancialDocument | null>(null);
  const [review, setReview] = useState<FinancialDocument | null>(null);
  const [selection, setSelection] = useState<{ scope: string; ids: Set<string> }>({ scope: "", ids: new Set() });
  const [download, setDownload] = useState<{ completed: number; total: number } | null>(null);
  const [downloadError, setDownloadError] = useState("");
  const downloading = useRef<AbortController | null>(null);
  const refreshing = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    refreshing.current?.abort();
    const controller = new AbortController(); refreshing.current = controller;
    try {
      // Folders and rows come from the same complete, paginated snapshot.
      const all: FinancialDocument[] = []; let cursor = "";
      do {
        const params = new URLSearchParams(); if (cursor) params.set("cursor", cursor);
        const page = await request<{ page: FinancialDocument[]; isDone: boolean; continueCursor: string }>(`${apiBase}/documents?${params}`, { signal: controller.signal });
        all.push(...page.page); cursor = page.isDone ? "" : page.continueCursor;
      } while (cursor);
      if (!controller.signal.aborted) { setDocuments(all); setError(""); }
    } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Documents could not be loaded"); }
    finally { if (!controller.signal.aborted) { setLoading(false); refreshing.current = null; } }
  }, [apiBase]);
  useEffect(() => {
    setLoading(true); void refresh();
    const onChanged = () => void refresh();
    window.addEventListener("finance:documents-changed", onChanged);
    const timer = window.setInterval(() => { if (document.visibilityState === "visible" && !refreshing.current) void refresh(); }, 5000);
    return () => { window.clearInterval(timer); window.removeEventListener("finance:documents-changed", onChanged); refreshing.current?.abort(); };
  }, [refresh]);
  useEffect(() => () => downloading.current?.abort(), []);
  const view = documentLibraryView(documents, kind, entity);
  const value = (doc: FinancialDocument) => sort === "file" ? `${doc.extraction?.counterparty ?? ""} ${doc.entity ? wiseEntityLabel(doc.entity) : "Unassigned"} ${doc.fileName}` : sort === "date" ? doc.extraction?.issueDate : sort === "amount" ? doc.extraction?.amount : sort === "match" ? doc.transactionId : doc[sort];
  const rows = filterLibraryDocuments(view.documents, month, status, search).sort((a, b) => compareTableValues(value(a), value(b), order) || a._id.localeCompare(b._id));
  const scope = JSON.stringify([kind, entity, month, status, search]);
  const selectedIds = selection.scope === scope ? selection.ids : new Set<string>();
  const selected = rows.filter(doc => selectedIds.has(doc._id));
  const allSelected = rows.length > 0 && selected.length === rows.length;
  useEffect(() => { setSelection({ scope, ids: new Set() }); setDownloadError(""); }, [scope]);
  const selectAll = () => setSelection({ scope, ids: allSelected ? new Set() : new Set(rows.map(doc => doc._id)) });
  const switchView = (next: typeof kind) => { setKind(next); setMonth("all"); };
  const downloadSelected = async () => {
    if (!selected.length || downloading.current) return;
    const controller = new AbortController(); downloading.current = controller;
    setDownload({ completed: 0, total: selected.length }); setDownloadError("");
    try {
      const { buildDocumentZip } = await import("../../../shared/documentZip");
      const blob = await buildDocumentZip(selected, { apiBase, signal: controller.signal, onProgress: completed => setDownload({ completed, total: selected.length }) });
      controller.signal.throwIfAborted();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `${kind === "expense" ? "expenses" : kind === "invoice" ? "invoices" : "unclassified"}-${entity}-${month === "all" ? "all-months" : month}.zip`;
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) { if (!controller.signal.aborted) setDownloadError(err instanceof Error ? err.message : "Download failed. Please retry."); }
    finally { downloading.current = null; setDownload(null); }
  };
  const onSort = (key: SortKey) => { if (key === sort) setOrder(order === "asc" ? "desc" : "asc"); else { setSort(key); setOrder("asc"); } };
  const head = (key: SortKey, label: string) => <SortableTableHead activeSortKey={sort} direction={order} onSort={onSort} sortKey={key}>{label}</SortableTableHead>;
  return <div className="documents-page">
    <div className="panel-header document-header">
      <div className="document-heading"><p className="eyebrow">Receipts and invoices</p><h1>Documents</h1></div>
      <div className="document-view-controls">
        <div className="segmented-control document-kind-switch" role="group" aria-label="Document view">
          <Button variant="ghost" className={kind === "expense" ? "active" : ""} aria-pressed={kind === "expense"} onClick={() => switchView("expense")}>Expenses</Button>
          <Button variant="ghost" className={kind === "invoice" ? "active" : ""} aria-pressed={kind === "invoice"} onClick={() => switchView("invoice")}>Invoices</Button>
        </div>
        <NativeSelect aria-label="Document company" value={entity} onValueChange={value => { setEntity(value as DocumentCompany); setMonth("all"); }}>
          <NativeSelectOption value="all">All companies</NativeSelectOption><NativeSelectOption value="dn">Digital Nudge</NativeSelectOption><NativeSelectOption value="lmd">Love Me Do</NativeSelectOption><NativeSelectOption value="unassigned">Unassigned</NativeSelectOption>
        </NativeSelect>
        {(view.unclassified > 0 || kind === "unknown") && <Button variant="outline" className="document-unclassified" aria-pressed={kind === "unknown"} onClick={() => switchView("unknown")}>Unclassified <span>{view.unclassified}</span></Button>}
      </div>
      <div className="row-actions document-header-actions"><InfoPopover label="Document intake"><p>Forward to <strong>{documentInbox}</strong> from any email, upload here, or send files to the Telegram bot as Ali or Ali M. Originals are saved before AI processing. Unclassified files remain available while processing or awaiting review. A match does not mark an invoice paid.</p></InfoPopover><DocumentUploadButton apiBase={apiBase} defaultEntity={entity === "dn" || entity === "lmd" ? entity : undefined} /></div>
    </div>
    <div className="document-folders" role="group" aria-label={`Monthly ${kind === "expense" ? "expense" : kind === "invoice" ? "invoice" : "unclassified document"} folders`}>
      <Button className={month === "all" ? "document-folder active" : "document-folder"} aria-pressed={month === "all"} onClick={() => setMonth("all")}><Folder size={21} /><span>All months</span>{!loading && <small>{view.documents.length}</small>}</Button>
      {Object.entries(view.months).sort(([a], [b]) => b.localeCompare(a)).map(([key, count]) => <Button key={key} className={`document-folder ${month === key ? "active" : ""}`} aria-pressed={month === key} onClick={() => setMonth(key)}><Folder size={21} /><span>{new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${key}-01T00:00:00Z`))}</span><small>{count}</small></Button>)}
    </div>
    <section className="panel">
      <div className="list-toolbar document-toolbar">
        <Input aria-label="Search documents" placeholder="Search documents" value={search} onChange={e => setSearch(e.target.value)} />
        <NativeSelect aria-label="Filter processing status" value={status} onValueChange={setStatus}><NativeSelectOption value="all">All statuses</NativeSelectOption>{Object.entries(labels).map(([key, label]) => <NativeSelectOption key={key} value={key}>{label}</NativeSelectOption>)}</NativeSelect>
        <div className="document-selection-actions">
          <Button variant="outline" className="secondary-button" disabled={!rows.length || loading || Boolean(download)} onClick={selectAll}>{allSelected ? "Deselect all" : "Select all"}</Button>
          <span className="document-selection-count" role="status">{selected.length ? `${selected.length} selected` : `${rows.length} files`}</span>
          <Button variant="outline" className="secondary-button document-download" disabled={!selected.length || Boolean(download)} onClick={() => void downloadSelected()}>{download ? <Loader2 size={15} className="spin" /> : <Download size={15} />}{download ? `${download.completed} / ${download.total}` : "Download ZIP"}</Button>
          {download && <Button variant="ghost" size="icon" aria-label="Cancel download" onClick={() => downloading.current?.abort()}><X size={15} /></Button>}
          <InfoPopover label="Download selected documents"><p>Select all includes every file matching the current view, company, month, search, and status. The ZIP contains the original PDFs and images, organized by company and month. Changing filters clears the selection.</p></InfoPopover>
        </div>
        <Button variant="ghost" size="icon" aria-label="Refresh documents" onClick={() => void refresh()}><RefreshCw size={16} /></Button>
        {download && <span className="screen-reader-only" role="status">Preparing ZIP: {download.completed} of {download.total} files</span>}
      </div>
      {(error || downloadError) && <p role="alert" className="inline-error">{downloadError || error}</p>}
      <div className="table-wrap"><table className="data-table document-table"><thead><tr><th className="document-select-cell"><Checkbox aria-label="Select all documents in this view" checked={allSelected} indeterminate={selected.length > 0 && !allSelected} disabled={!rows.length || loading || Boolean(download)} onCheckedChange={selectAll} /></th>{head("file", "Document / company")}{head("date", "Date")}{head("kind", "Type")}{head("amount", "Amount")}{head("source", "Received via")}{head("status", "Status")}{head("match", "Bank match")}<th>Actions</th></tr></thead><tbody>
        {rows.map(doc => <tr key={doc._id} data-selected={selectedIds.has(doc._id) || undefined}>
          <td className="document-select-cell"><Checkbox aria-label={`Select ${doc.fileName}`} checked={selectedIds.has(doc._id)} disabled={Boolean(download)} onCheckedChange={checked => setSelection(current => { const ids = new Set(current.scope === scope ? current.ids : []); if (checked) ids.add(doc._id); else ids.delete(doc._id); return { scope, ids }; })} /></td>
          <td className="document-name-cell"><strong>{doc.extraction?.counterparty || doc.fileName}</strong><small>{doc.entity ? wiseEntityLabel(doc.entity) : "Company needs review"}</small><a href={`${apiBase}/documents/${doc._id}/file`}>{doc.fileName}</a></td><td>{doc.extraction?.issueDate ?? "—"}</td><td>{doc.kind === "unknown" ? "Unclassified" : doc.kind === "invoice" ? "Sales invoice" : "Expense"}</td><td className="amount">{doc.extraction?.amount !== null && doc.extraction?.amount !== undefined ? `${doc.extraction.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })} ${doc.extraction.currency ?? ""}` : "—"}</td><td>{doc.source}</td><td><span className={`status-pill ${doc.status === "matched" ? "good" : doc.status === "failed" ? "danger" : "warning"}`}>{labels[doc.status]}</span>{(doc.error || doc.extraction?.reviewReasons.length || doc.matchReason) && <InfoPopover label={`Details for ${doc.fileName}`}><p>{doc.error || doc.extraction?.reviewReasons.join(". ") || doc.matchReason}</p>{doc.processedAt && <p>Processed in {Math.max(0, Math.round((Date.parse(doc.processedAt) - Date.parse(doc.createdAt)) / 1000))} seconds.</p>}</InfoPopover>}</td><td>{doc.transactionId ? <a href={documentTransactionLink(doc.transactionId)}>View transaction</a> : "—"}</td><td><div className="row-actions"><a aria-label={`Download ${doc.fileName}`} href={`${apiBase}/documents/${doc._id}/file`}><Download size={15} /></a>{["needs_review", "failed"].includes(doc.status) && <Button className="icon-text-button" onClick={() => setReview(doc)}>Review</Button>}{doc.status === "failed" && <Button className="icon-text-button" onClick={async () => { try { await request(`${apiBase}/documents/${doc._id}/retry`, { method: "POST" }); void refresh(); } catch (err) { setError(String(err)); } }}>Retry</Button>}{doc.status === "unmatched" && <Button className="icon-text-button" onClick={() => setMatchDocument(doc)}>Review match</Button>}</div></td></tr>)}
        {!rows.length && <tr><td colSpan={9}>{loading ? <span role="status"><Loader2 size={16} className="spin" /> Loading documents…</span> : "No documents in this view"}</td></tr>}
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
