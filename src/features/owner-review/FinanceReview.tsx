import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { ManagementReportDashboard } from "../../../shared/managementReport";
import { canPublishPeriod, monthLabel, owners, reviewStatus, type ReviewAddresses, type ReviewSummary } from "../../../shared/ownerReview";
import { ReviewStatus, Signers } from "./ReviewDetails";
import { reviewApi, useReviewData } from "./reviewApi";
import "./ownerReview.css";

export function FinanceReview({ apiBase, dashboard, selectedPeriod }: { apiBase: string; dashboard: ManagementReportDashboard; selectedPeriod: string }) {
  const [open, setOpen] = useState(false);
  return <details className="panel owner-publish" onToggle={e => setOpen(e.currentTarget.open)}>
    <summary>Publish month for owner review</summary>
    {open && <PublishForm key={selectedPeriod} apiBase={apiBase} dashboard={dashboard} selectedPeriod={selectedPeriod} />}</details>;
}

function PublishForm({ apiBase, dashboard, selectedPeriod }: { apiBase: string; dashboard: ManagementReportDashboard; selectedPeriod: string }) {
  const periods = dashboard.trend.map(p => p.period).sort().reverse();
  const [period, setPeriod] = useState(periods.includes(selectedPeriod) ? selectedPeriod : periods[0] ?? "");
  const [version, setVersion] = useState("");
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [addresses, setAddresses] = useState<ReviewAddresses | null>(null);
  const [editing, setEditing] = useState(false);
  const contacts = useReviewData<ReviewAddresses | null>(apiBase, "contacts", revision);
  const list = useReviewData<ReviewSummary[]>(apiBase, "list", revision, true);
  const allPeriods = [...new Set([...periods, ...(list.data ?? []).map(r => r.period)])].sort().reverse();
  const versions = list.data?.filter(r => r.period === period) ?? [];
  const current = versions.find(v => v.current);
  const shown = versions.find(v => v.id === version) ?? current;
  const addr = addresses ?? contacts.data ?? { Amin: "", Sanjin: "", Ben: "" };
  const hasPendingMail = current?.mail?.some(m => ["sending", "queued"].includes(m.state));
  useEffect(() => {
    if (!hasPendingMail) return;
    const id = window.setTimeout(() => setRevision(n => n + 1), 4000);
    return () => clearTimeout(id);
  }, [hasPendingMail, revision]);
  async function save(path: string, body: unknown, success: string) {
    setError(""); setMessage(""); setBusy(true);
    try {
      await reviewApi(apiBase, path, body);
      if (path === "contacts") { setEditing(false); setAddresses(null); }
      setMessage(success); setRevision(n => n + 1); setVersion("");
    } catch (e) { setError(e instanceof Error ? e.message : "Request failed."); }
    finally { setBusy(false); }
  }
  const sameImport = current?.importId === dashboard.metadata.importId;
  return <div className="owner-publish-content"><div className="owner-heading"><label>Month to publish<select value={period} onChange={e => { setPeriod(e.target.value); setVersion(""); setMessage(""); setError(""); }}>
    {allPeriods.map(p => {
      const review = list.data?.find(r => r.current && r.period === p);
      return <option value={p} key={p}>{monthLabel(p)}{review ? " · " + reviewStatus(review) : ""}</option>;
    })}</select></label>
    <Button disabled={busy || !list.data || !contacts.data || !!sameImport || !canPublishPeriod(dashboard, period)}
      onClick={() => save("publish", { period, importId: dashboard.metadata.importId, expectedRevision: current?.revision ?? 0 }, "Month published. Review emails queued.")}>
      {sameImport ? "Workbook already published" : current ? "Publish revised month and request new approvals" : "Publish month and email owners"}</Button></div>
    {contacts.data === undefined && !contacts.error && <p role="status">Loading review settings…</p>}
    {contacts.data !== undefined && (editing || !contacts.data ? <form className="owner-contacts" onSubmit={e => { e.preventDefault(); void save("contacts", { addresses: addr }, "Review addresses saved."); }}>
      {owners.map(owner => <label key={owner}>{owner}’s email<input type="email" required maxLength={254} value={addr[owner]} onChange={e => setAddresses({ ...addr, [owner]: e.target.value })} /></label>)}
      <Button disabled={busy} type="submit">Save addresses</Button>{editing && <Button variant="outline" type="button" onClick={() => { setEditing(false); setAddresses(null); }}>Cancel</Button>}</form>
      : <button className="owner-link" onClick={() => setEditing(true)}>Manage review email addresses</button>)}
    {shown && <section><div className="owner-heading"><label>Published version<select value={shown.id} onChange={e => setVersion(e.target.value)}>
      {versions.map(r => <option key={r.id} value={r.id}>Version {r.revision} · {new Date(r.publishedAt).toLocaleDateString()}</option>)}</select></label><ReviewStatus review={shown} /></div>
      <Signers review={shown} /><div className="review-mail">{shown.mail?.map(m => <div key={m.owner}><span>{m.owner} · Email {m.state === "sent" ? "accepted" : m.state}</span>
        {m.error && <small>{m.error}</small>}{shown.current && (m.state === "failed" || m.state === "unconfirmed") &&
          <button className="owner-link" disabled={busy} onClick={() => save("retry-email", { id: shown.id, owner: m.owner }, "Email queued again.")}>Resend to {m.owner}</button>}</div>)}</div></section>}
    {message && <p role="status">{message}</p>}{(error || list.error || contacts.error) && <p role="alert">{error || list.error || contacts.error} <button className="owner-link" onClick={() => { setError(""); setRevision(n => n + 1); }}>Reload</button></p>}</div>;
}
