import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Copy, Download, FileText, Loader2, RefreshCw, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { InfoPopover } from "@/components/ui/finance-visuals";
import { SortableTableHead, compareTableValues, type TableSortDirection } from "@/components/ui/sortable-table-head";
import { useUrlState } from "@/lib/url-state";
import { contractAccept, contractsInbox, type CompanyDocument } from "../../../shared/companyDocuments";
import type { Provider } from "../../../shared/types";

type SortKey = "file" | "company" | "received" | "source" | "status";
const statusLabels = { queued: "Queued", processing: "Recognizing company", assigned: "Assigned", needs_review: "Needs assignment" };
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init); const body = await response.json();
  if (!response.ok) throw new Error(body.message ?? "Document request failed"); return body;
}
export function ContractsView({ apiBase, providers }: { apiBase: string; providers: Provider[] }) {
  const [company, setCompany] = useUrlState("contractCompany", "all");
  const [search, setSearch] = useUrlState("contractSearch", "");
  const [sort, setSort] = useUrlState<SortKey>("contractSort", "received", { allowedValues: ["file", "company", "received", "source", "status"] });
  const [direction, setDirection] = useUrlState<TableSortDirection>("contractDir", "desc", { allowedValues: ["asc", "desc"] });
  const [documents, setDocuments] = useState<CompanyDocument[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [notice, setNotice] = useState(""), [uploadOpen, setUploadOpen] = useState(false), [assigning, setAssigning] = useState<CompanyDocument | null>(null), [busy, setBusy] = useState(false);
  const requestVersion = useRef(0), loadingRef = useRef(false);
  const load = useCallback(async () => {
    loadingRef.current = true;
    const version = ++requestVersion.current; setLoading(true); setError("");
    try {
      const rows: CompanyDocument[] = []; let cursor: string | null = null;
      do { const result: { page: CompanyDocument[]; isDone: boolean; continueCursor: string } = await request(`${apiBase}/contracts${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`); if (version !== requestVersion.current) return; rows.push(...result.page); cursor = result.isDone ? null : result.continueCursor; } while (cursor);
      setDocuments(rows);
    } catch (err) { if (version === requestVersion.current) setError(err instanceof Error ? err.message : "Could not load contracts"); }
    finally { if (version === requestVersion.current) { loadingRef.current = false; setLoading(false); } }
  }, [apiBase]);
  useEffect(() => { void load(); return () => { requestVersion.current++; }; }, [load]);
  useEffect(() => { const timer = setInterval(() => { if (!document.hidden && !loadingRef.current) void load(); }, 15000); return () => clearInterval(timer); }, [load]);
  const providerMap = new Map(providers.map(p => [p.id, p]));
  const companyFor = (d: CompanyDocument) => d.providerId ? providerMap.get(d.providerId) : undefined;
  const labelFor = (d: CompanyDocument) => d.error && d.status === "needs_review" ? "Recognition failed" : d.status === "assigned" && !companyFor(d) ? "Needs assignment" : statusLabels[d.status];
  const unassigned = documents.filter(d => !companyFor(d)).length;
  const rows = documents.filter(d => (company === "all" || (company === "unassigned" ? !companyFor(d) : d.providerId === company)) && [d.fileName, companyFor(d)?.name, d.sender].filter(Boolean).join(" ").toLowerCase().includes(search.trim().toLowerCase()));
  const value = (d: CompanyDocument) => sort === "file" ? d.fileName : sort === "company" ? companyFor(d)?.name : sort === "source" ? `${d.source} ${d.sender ?? ""}` : sort === "status" ? labelFor(d) : d.createdAt;
  rows.sort((a, b) => compareTableValues(value(a), value(b), direction) || a._id.localeCompare(b._id));
  const head = (key: SortKey, label: string) => <SortableTableHead activeSortKey={sort} direction={direction} onSort={key => { setDirection(sort === key && direction === "asc" ? "desc" : "asc"); setSort(key); }} sortKey={key}>{label}</SortableTableHead>;
  const orderedProviders = [...providers].sort((a, b) => a.name.localeCompare(b.name));
  return <section className="panel contracts-panel">
    <div className="panel-header"><div><p className="eyebrow">Company documents</p><h2>{providerMap.get(company)?.name ?? "Contracts"}</h2></div><div className="row-actions">
      <Button className="secondary-button" disabled={loading} onClick={() => void load()} aria-label="Refresh contracts"><RefreshCw size={15} className={loading ? "spin" : ""} /></Button>
      <Button className="primary-button" onClick={() => setUploadOpen(true)}><Upload size={15} /> Upload documents</Button>
    </div></div>
    <div className="contracts-toolbar">
      <div className="segmented-control"><Button className={company === "all" ? "active" : ""} onClick={() => setCompany("all")}>All documents</Button><Button className={company === "unassigned" ? "active" : ""} onClick={() => setCompany("unassigned")}>Unassigned{!loading && ` ${unassigned}`}</Button></div>
      <NativeSelect className="contracts-company-filter" aria-label="Filter contracts by company" value={company} onValueChange={setCompany}><NativeSelectOption value="all">All companies</NativeSelectOption><NativeSelectOption value="unassigned">Unassigned</NativeSelectOption>{orderedProviders.map(p => <NativeSelectOption key={p.id} value={p.id}>{p.name} · {p.type === "client" ? "Client" : "Supplier"}</NativeSelectOption>)}</NativeSelect>
      <Input type="search" aria-label="Search contracts" placeholder="Search documents" value={search} onChange={e => setSearch(e.target.value)} />
      <div className="contracts-inbox"><a href={`mailto:${contractsInbox}`}>{contractsInbox}</a><Button className="icon-button" aria-label="Copy contracts email" onClick={() => { void navigator.clipboard.writeText(contractsInbox).then(() => setNotice("Contracts email copied"), () => setError("Could not copy the email address")); }}><Copy size={14} /></Button><InfoPopover label="Email contracts">Forward attachments here to recognize the company automatically. Uncertain matches appear in Unassigned. Supports PDF, Word (.docx), text and images up to 10 MB each. Sender restrictions are shared with the receipts inbox in Documents settings.</InfoPopover></div>
    </div>
    {error && <div className="inline-error" role="alert">{error}</div>}{notice && <p role="status" className="contracts-notice">{notice}</p>}
    <div className="table-wrap"><table className="data-table"><thead><tr>{head("file", "Document")}{head("company", "Company")}{head("received", "Received")}{head("source", "Source / sender")}{head("status", "Status")}<th scope="col">Actions</th></tr></thead><tbody>
      {rows.map(d => <tr key={d._id}><td className="wrap"><strong>{d.fileName}</strong></td><td>{companyFor(d)?.name ?? "Unassigned"}</td><td>{new Date(d.createdAt).toLocaleDateString()}</td><td className="wrap">{d.source === "email" ? "Email" : "Upload"}{d.sender && <small>{d.sender}</small>}</td><td><div className="row-actions"><span className={`status-pill ${companyFor(d) ? "good" : ""}`}>{labelFor(d)}</span><InfoPopover label={`Recognition details for ${d.fileName}`}>{d.providerId && !companyFor(d) ? "The previous company was removed. Assign this document to another company." : d.error ?? d.matchReason ?? "Company recognition is pending."}</InfoPopover></div></td><td><div className="row-actions"><a className="icon-button" href={`${apiBase}/contracts/${d._id}/file`} aria-label={`Download ${d.fileName}`}><Download size={15} /></a><Button className="secondary-button" disabled={busy} onClick={() => setAssigning(d)}>{companyFor(d) ? "Move" : "Assign"}</Button>{d.status === "needs_review" && <Button className="icon-button" disabled={busy} aria-label={`Retry company recognition for ${d.fileName}`} onClick={async () => { setBusy(true); setError(""); try { await request(`${apiBase}/contracts/${d._id}/retry`, { method: "POST" }); await load(); } catch (err) { setError(err instanceof Error ? err.message : "Retry failed"); } finally { setBusy(false); } }}><RefreshCw size={14} /></Button>}</div></td></tr>)}
      {!rows.length && <tr><td colSpan={6}><div className="empty-state compact"><FileText size={24} /><strong>{loading ? "Loading documents…" : error ? "Documents could not be loaded" : company === "unassigned" ? "No unassigned documents" : "No documents yet"}</strong></div></td></tr>}
    </tbody></table></div>
    {uploadOpen && <ContractUpload apiBase={apiBase} providers={orderedProviders} defaultCompany={providerMap.has(company) ? company : ""} onClose={() => setUploadOpen(false)} onSaved={() => void load()} />}
    {assigning && <AssignContract apiBase={apiBase} document={assigning} providers={orderedProviders} onClose={() => setAssigning(null)} onSaved={() => { setAssigning(null); void load(); }} />}
  </section>;
}
function ContractUpload({ apiBase, providers, defaultCompany, onClose, onSaved }: { apiBase: string; providers: Provider[]; defaultCompany: string; onClose: () => void; onSaved: () => void }) {
  const [company, setCompany] = useState(defaultCompany), [files, setFiles] = useState<File[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null);
  async function save(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(""); let saved = 0, duplicates = 0;
    try {
      for (const file of files) {
        if (!file.size || file.size > 10 * 1024 * 1024) throw new Error(`${file.name}: choose a file up to 10 MB`);
        setNotice(`Saving ${saved + 1} of ${files.length}…`);
        const result = await request<{ duplicate: boolean }>(`${apiBase}/contracts/upload`, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream", "X-File-Name": encodeURIComponent(file.name), ...(company ? { "X-Company-Id": company } : {}) }, body: file });
        saved++; if (result.duplicate) duplicates++;
      }
      setNotice(`${saved - duplicates} document${saved - duplicates === 1 ? "" : "s"} saved${duplicates ? ` · ${duplicates} already saved; existing company assignments kept` : ""}`); setFiles([]); if (input.current) input.current.value = "";
    } catch (err) { setError(err instanceof Error ? err.message : "Upload failed"); setFiles(files.slice(saved)); setNotice(saved ? `${saved} saved before the error` : ""); }
    finally { setBusy(false); onSaved(); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="document-dialog" showCloseButton={false}><div className="panel-header"><DialogTitle>Upload company documents</DialogTitle><Button className="icon-button" aria-label="Close upload" disabled={busy} onClick={onClose}><X size={18} /></Button></div><form onSubmit={save}>
    <label>Company<NativeSelect aria-label="Upload company" disabled={busy} value={company} onValueChange={setCompany}><NativeSelectOption value="">Recognize automatically</NativeSelectOption>{providers.map(p => <NativeSelectOption value={p.id} key={p.id}>{p.name} · {p.type === "client" ? "Client" : "Supplier"}</NativeSelectOption>)}</NativeSelect></label>
    <label className="document-drop-zone"><Upload size={24} /><span>PDF, Word, text or images · up to 10 MB each</span><Input ref={input} type="file" accept={contractAccept} multiple disabled={busy} onChange={e => { setFiles(Array.from(e.target.files ?? [])); setNotice(""); }} /></label>
    {error && <p className="inline-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}<Button className="primary-button" type="submit" disabled={busy || !files.length}>{busy && <Loader2 size={15} className="spin" />}Upload{files.length ? ` ${files.length} file${files.length === 1 ? "" : "s"}` : ""}</Button>
  </form></DialogContent></Dialog>;
}
function AssignContract({ apiBase, document, providers, onClose, onSaved }: { apiBase: string; document: CompanyDocument; providers: Provider[]; onClose: () => void; onSaved: () => void }) {
  const [company, setCompany] = useState(providers.some(p => p.id === document.providerId) ? document.providerId! : ""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}><DialogContent className="document-dialog" showCloseButton={false}><div className="panel-header"><DialogTitle>Assign document</DialogTitle><Button className="icon-button" disabled={busy} aria-label="Close assignment" onClick={onClose}><X size={18} /></Button></div><form onSubmit={async e => { e.preventDefault(); setBusy(true); setError(""); try { await request(`${apiBase}/contracts/${document._id}/assign`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ providerId: company || null }) }); onSaved(); } catch (err) { setError(err instanceof Error ? err.message : "Assignment failed"); } finally { setBusy(false); } }}><p className="contracts-filename">{document.fileName}</p><label>Company<NativeSelect aria-label="Assign to company" value={company} onValueChange={setCompany} disabled={busy}><NativeSelectOption value="">Unassigned</NativeSelectOption>{providers.map(p => <NativeSelectOption key={p.id} value={p.id}>{p.name} · {p.type === "client" ? "Client" : "Supplier"}</NativeSelectOption>)}</NativeSelect></label>{error && <p className="inline-error" role="alert">{error}</p>}<Button className="primary-button" type="submit" disabled={busy}>{busy && <Loader2 size={15} className="spin" />}Save assignment</Button></form></DialogContent></Dialog>;
}
