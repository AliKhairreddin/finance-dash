import { useState, type ReactNode } from "react";
import { Banknote, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUrlState } from "@/lib/url-state";
import { monthLabel, ownerForLogin, type Owner, type OwnerReport, type OwnerTransaction, type ReviewSummary } from "../../../shared/ownerReview";
import { reportMetricLabels } from "../../../shared/managementReportBreakdown";
import { ReviewStatus, ReviewTable, Signers } from "./ReviewDetails";
import { reviewApi, usd, useReviewData } from "./reviewApi";
import "./ownerReview.css";

export function OwnerDashboard({ apiBase, username, themeToggle }: { apiBase: string; username: string; themeToggle: ReactNode }) {
  const owner = ownerForLogin(username)!;
  const [selected, setSelected] = useUrlState("review", "", { history: "push" });
  const [refresh, setRefresh] = useState(0);
  const list = useReviewData<ReviewSummary[]>(apiBase, "list", refresh, true);
  const current = list.data?.filter(r => r.current) ?? [];
  const pending = current.find(r => !r.decisions.some(d => d.owner === owner));
  const review = selected ? list.data?.find(r => r.id === selected) : pending ?? current[0];
  const latest = current.find(r => r.period === review?.period);
  const detail = useReviewData<{ report: OwnerReport; review: ReviewSummary }>(apiBase, review ? "report?id=" + review.id : null, refresh);
  const error = list.error || detail.error;
  return <main className="transaction-reviewer-shell owner-shell">
    <header className="transaction-reviewer-header"><div className="transaction-reviewer-brand"><Banknote size={20} /><strong>Finance</strong></div>
      <div className="transaction-reviewer-account"><span>{owner}</span>{themeToggle}<a className="secondary-button" href="/logout"><LogOut size={15} /> Log out</a></div></header>
    <div className="transaction-reviewer-content"><header className="owner-heading"><div><h1>Owner dashboard</h1>
      {review && <p>{monthLabel(review.period)} · Version {review.revision}</p>}</div>
      {current.length > 0 && <label>Report month<select value={review?.id ?? ""} onChange={e => setSelected(e.target.value)}>
        {!review && <option value="">Choose a month</option>}
        {review && !review.current && <option value={review.id}>{monthLabel(review.period)} · v{review.revision} (superseded)</option>}
        {current.map(r => <option key={r.id} value={r.id}>{monthLabel(r.period)}{!r.decisions.some(d => d.owner === owner) ? " · needs your review" : ""}</option>)}</select></label>}</header>
      {error ? <div role="alert">{error} <Button variant="outline" onClick={() => setRefresh(n => n + 1)}>Retry</Button></div>
        : !list.data ? <p role="status">Loading published months…</p>
        : !review ? <section className="panel owner-panel"><h2>{selected ? "Published report not found" : "No months published yet"}</h2>
          <p>{selected ? "Choose an available month to continue." : "Finance will email you when the first month is ready for sign-off."}</p></section>
        : !detail.data ? <p role="status">Loading report…</p>
        : <PublishedReport key={review.id} apiBase={apiBase} owner={owner} report={detail.data.report} review={detail.data.review}
          showLatest={latest ? () => setSelected(latest.id) : undefined}
          onDecision={() => { setSelected(review.id); setRefresh(n => n + 1); }} />}
    </div></main>;
}

function PublishedReport({ apiBase, owner, report, review, showLatest, onDecision }: {
  apiBase: string; owner: Owner; report: OwnerReport; review: ReviewSummary; showLatest?: () => void; onDecision: () => void;
}) {
  const [tab, setTab] = useUrlState<"results" | "transactions" | "sign-off">("ownerView", "results", { allowedValues: ["results", "transactions", "sign-off"] });
  const [scope, setScope] = useUrlState("ownerUnit", "company");
  const [filter, setFilter] = useUrlState("ownerTxnFilter", "");
  const [segment, setSegment] = useUrlState("ownerTxnSegment", "");
  const [attempt, setAttempt] = useState(0);
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const transactions = useReviewData<OwnerTransaction[]>(apiBase, "transactions?id=" + review.id, attempt, true);
  const selected = report.units.find(u => u.id === scope) ?? report.company;
  const decision = review.decisions.find(d => d.owner === owner);
  const matches = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const unitSegment = selected.id === report.company.id ? "" : selected.name;
  const ledgerLabels = new Set(transactions.data?.filter(t => !unitSegment || matches(t.segment, unitSegment))
    .flatMap(t => [t.segment.trim().toLowerCase(), t.nature.trim().toLowerCase()]));
  const segmentRows = (transactions.data ?? []).filter(t => !segment || matches(t.segment, segment));
  const associated = (row: OwnerTransaction, label: string) => matches(row.segment, label) || matches(row.nature, label);
  function openTransactions(label: string) { setFilter(label); setSegment(unitSegment); setTab("transactions"); }
  async function decide(state: "changes" | "approved") {
    setBusy(true); setError("");
    try {
      await reviewApi(apiBase, "decision", { id: review.id, state, comment: state === "changes" ? comment.trim() : "" });
      onDecision();
    } catch (e) { setError(e instanceof Error ? e.message : "Decision could not be saved."); }
    finally { setBusy(false); }
  }
  const headline = report.company.metrics.filter(m => ["revenue", "gross-profit", "net-profit"].includes(m.key));
  return <>{!review.current && <div role="status" className="owner-panel panel">This version was superseded. <Button variant="outline" onClick={showLatest}>Open current version</Button></div>}
    <div className="owner-metrics">{headline.map(m => <div key={m.key}><span>{reportMetricLabels[m.key]}</span><strong>{usd(m.value)}</strong></div>)}
      <div><span>My partner balance</span><strong>{usd(report.balance)}</strong><small>As of {report.balanceAsOf}</small></div></div>
    <div className="owner-nav"><nav className="segmented-control" aria-label="Owner views">
      {(["results", "transactions", "sign-off"] as const).map((key, i) => <button key={key} className={tab === key ? "active" : ""} aria-current={tab === key ? "page" : undefined} onClick={() => setTab(key)}>{["Monthly results", "Transactions", "Sign-off"][i]}</button>)}</nav>
      <button className="owner-status-button" aria-label="View month sign-off" onClick={() => setTab("sign-off")}><ReviewStatus review={review} /></button></div>
    {tab === "results" && <section className="panel owner-panel"><div className="owner-heading"><h2>Profit and loss</h2>
      <label>Business unit<select value={selected.id} onChange={e => setScope(e.target.value)}>
        {[report.company, ...report.units].map(u => <option value={u.id} key={u.id}>{u.name}</option>)}</select></label></div>
      <div className="owner-totals">{selected.metrics.map(m => <div key={m.key}><span>{reportMetricLabels[m.key]}</span><strong>{usd(m.value)}</strong></div>)}</div>
      <h3>Report lines</h3><ReviewTable name="ownerLines" caption="Monthly report lines" empty="No itemized lines reported." rows={selected.lines}
        columns={[{ key: "label", label: "Line", show: r => ledgerLabels.has(r.label.trim().toLowerCase()) ? <button className="owner-link" title="View transactions with this category or segment" onClick={() => openTransactions(r.label)}>{r.label}</button> : r.label },
          { key: "group", label: "Category", show: row => row.group.replaceAll("-", " ").replace(/^./, c => c.toUpperCase()) }, { key: "value", label: "Amount (USD)", show: row => usd(row.value) }]} />
      {ledgerLabels.has(selected.name.trim().toLowerCase()) && <Button variant="outline" onClick={() => openTransactions("")}>View {selected.name} transactions</Button>}</section>}
    {tab === "transactions" && <section className="panel owner-panel"><div className="owner-heading"><h2>Reported bank transactions</h2>
      {segment && <Button variant="outline" onClick={() => setSegment("")}>{segment} · Clear segment</Button>}
      <label>Category or segment<select value={filter} onChange={e => setFilter(e.target.value)}><option value="">All</option>
        {[...new Set([...(filter ? [filter] : []), ...segmentRows.flatMap(t => [t.segment, t.nature])])].sort().map(label => <option key={label}>{label}</option>)}</select></label></div>
      {transactions.error ? <p role="alert">{transactions.error} <Button onClick={() => setAttempt(n => n + 1)}>Retry</Button></p> : !transactions.data ? <p role="status">Loading transactions…</p> :
        <ReviewTable name="ownerTxn" caption="Bank entries dated in the published month" empty="No reported transactions match this selection."
          rows={segmentRows.filter(t => !filter || associated(t, filter))}
          columns={[{ key: "date", label: "Date" }, { key: "bank", label: "Bank" }, { key: "segment", label: "Segment" }, { key: "nature", label: "Category" },
            { key: "type", label: "Account type" }, { key: "currency", label: "Currency" }, { key: "amount", label: "Amount", show: r => r.amount.toLocaleString("en-US", { minimumFractionDigits: 2 }) }, { key: "usd", label: "USD", show: r => usd(r.usd) }]} />}</section>}
    {tab === "sign-off" && <section className="panel owner-panel"><div className="owner-heading"><h2>Monthly sign-off</h2><ReviewStatus review={review} /></div>
      <Signers review={review} />
      {review.current && !decision && <div className="owner-actions">{showComment && <label>What should finance change?<textarea autoFocus maxLength={2000} value={comment} onChange={e => setComment(e.target.value)} /></label>}
        <div>{showComment ? <><Button disabled={busy || !comment.trim()} onClick={() => decide("changes")}>Send change request</Button> <Button variant="outline" disabled={busy} onClick={() => setShowComment(false)}>Cancel</Button></>
          : <><Button disabled={busy} onClick={() => decide("approved")}>Approve {monthLabel(review.period)}</Button> <Button variant="outline" disabled={busy} onClick={() => setShowComment(true)}>Request changes</Button></>}</div></div>}
      {error && <p role="alert">{error} <button onClick={onDecision}>Reload report</button></p>}</section>}
  </>;
}
