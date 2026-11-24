import { useState, type ReactNode } from "react";
import { Banknote, ChevronDown, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useUrlState } from "@/lib/url-state";
import { monthLabel, needsOwnerReview, ownerForLogin, reviewStatus, type Owner, type OwnerReport, type OwnerTransaction, type ReviewSummary } from "../../../shared/ownerReview";
import { reportMetricLabels } from "../../../shared/managementReportBreakdown";
import { ReviewStatus, ReviewTable, Signers } from "./ReviewDetails";
import { reviewApi, usd, useReviewData } from "./reviewApi";
import { OwnerBankCards } from "./OwnerBankCards";
import { OwnerProfitCards } from "./OwnerProfitCards";
import "./ownerReview.css";

type MonthChoice = { id: string; period: string; query: string; review: ReviewSummary | null };
function publishedMonth(review: ReviewSummary): MonthChoice {
  return { id: review.id, period: review.period, query: new URLSearchParams({ id: review.id }).toString(), review };
}

export function OwnerDashboard({ apiBase, username, previewAmin, themeToggle }: { apiBase: string; username: string; previewAmin: boolean; themeToggle: ReactNode }) {
  const owner = previewAmin ? "Amin" : ownerForLogin(username)!;
  const [selected, setSelected] = useUrlState("review", "", { history: "push" });
  const [refresh, setRefresh] = useState(0);
  const list = useReviewData<ReviewSummary[]>(apiBase, previewAmin ? "list?preview=Amin" : "list", refresh, true);
  const imported = useReviewData<{ importId: string; periods: string[] }>(apiBase, previewAmin ? "imported?preview=Amin" : "imported", refresh);
  const current = (list.data ?? []).filter(r => r.current);
  const choices = current.map(publishedMonth);
  if (imported.data) {
    const { importId, periods } = imported.data;
    for (const period of periods) {
      if (current.some(r => r.period === period && r.importId === importId)) continue;
      choices.push({ period, id: "pending-" + period, query: new URLSearchParams({ importId, period }).toString(), review: null });
    }
  }
  choices.sort((a, b) => b.period.localeCompare(a.period));
  const selectedReview = list.data?.find(r => r.id === selected);
  const selectedChoice = choices.find(item => item.id === selected) ?? choices.find(item => "pending-" + item.period === selected);
  const choice = selectedReview ? publishedMonth(selectedReview) : selected
    ? selectedChoice
    : choices.find(item => item.review && needsOwnerReview(item.review, owner)) ?? choices[0];
  const latest = current.find(r => r.period === choice?.period);
  const query = choice && choice.query + (previewAmin ? "&preview=Amin" : "");
  const detail = useReviewData<{ report: OwnerReport; review: ReviewSummary | null }>(apiBase, query ? "report?" + query : null, refresh);
  const error = list.error || imported.error || detail.error;
  return <main className="transaction-reviewer-shell owner-shell">
    <header className="transaction-reviewer-header"><div className="transaction-reviewer-brand"><Banknote size={20} /><strong>Finance</strong>{previewAmin && <span>Read-only preview · Amin</span>}</div>
      <div className="transaction-reviewer-account"><span>{previewAmin ? username : owner}</span>{themeToggle}{previewAmin ? <a className="secondary-button" href="/?page=management">Exit preview</a> : <a className="secondary-button" href="/logout"><LogOut size={15} /> Log out</a>}</div></header>
    <div className="transaction-reviewer-content"><header className="owner-heading"><div><h1>Owner dashboard</h1>
      {choice && <p>{monthLabel(choice.period)}{choice.review && ` · Version ${choice.review.revision}`}</p>}</div>
      {choices.length > 0 && <label>Report month<select value={choice?.id ?? ""} onChange={e => setSelected(e.target.value)}>
        {!choice && <option value="">Choose a month</option>}
        {choice?.review && !choice.review.current && <option value={choice.id}>{monthLabel(choice.period)} · v{choice.review.revision} (superseded)</option>}
        {choices.map(({ id, period, review }) => {
          const status = review && needsOwnerReview(review, owner) ? "Needs your review" : review ? reviewStatus(review) : "Pending finance review";
          return <option key={id} value={id}>{monthLabel(period)} · {status}</option>;
        })}</select></label>}</header>
      <OwnerBankCards apiBase={apiBase} preview={previewAmin} />
      {error ? <div role="alert">{error} <Button variant="outline" onClick={() => setRefresh(n => n + 1)}>Retry</Button></div>
        : !list.data || !imported.data ? <p role="status">Loading report months…</p>
        : !choice || !query ? <section className="panel owner-panel"><h2>{selected ? "Report month unavailable" : "No monthly figures available yet"}</h2>
          <p>{selected ? "Choose an available month to continue." : "Monthly figures appear here after finance imports a report."}</p></section>
        : !detail.data ? <p role="status">Loading report…</p>
        : <MonthlyReport key={query} query={query} apiBase={apiBase} owner={owner} previewAmin={previewAmin} report={detail.data.report} review={detail.data.review}
          showLatest={latest ? () => setSelected(latest.id) : undefined}
          onDecision={() => { setSelected(choice.id); setRefresh(n => n + 1); }} />}
    </div></main>;
}

function MonthlyReport({ query, apiBase, owner, previewAmin, report, review, showLatest, onDecision }: {
  query: string; apiBase: string; owner: Owner; previewAmin: boolean; report: OwnerReport; review: ReviewSummary | null; showLatest?: () => void; onDecision: () => void;
}) {
  const [tab, setTab] = useUrlState<"results" | "transactions" | "sign-off">("ownerView", "results", { allowedValues: ["results", "transactions", "sign-off"] });
  const [activeCategory, setActiveCategory] = useUrlState("ownerCategory", "");
  const [scope, setScope] = useUrlState("ownerUnit", "company");
  const [filter, setFilter] = useUrlState("ownerTxnFilter", "");
  const [segment, setSegment] = useUrlState("ownerTxnSegment", "");
  const [attempt, setAttempt] = useState(0);
  const [showComment, setShowComment] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const transactions = useReviewData<OwnerTransaction[]>(apiBase, "transactions?" + query, attempt, true);
  const selected = report.units.find(u => u.id === scope) ?? report.company;
  const canDecide = !!review && needsOwnerReview(review, owner);
  const matches = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const unitSegment = selected.id === report.company.id ? "" : selected.name;
  const ledgerLabels = new Set(transactions.data?.filter(t => !unitSegment || matches(t.segment, unitSegment))
    .flatMap(t => [t.segment.trim().toLowerCase(), t.nature.trim().toLowerCase()]));
  const segmentRows = (transactions.data ?? []).filter(t => !segment || matches(t.segment, segment));
  const associated = (row: OwnerTransaction, label: string) => matches(row.segment, label) || matches(row.nature, label);
  function openTransactions(label: string) { setFilter(label); setSegment(unitSegment); setTab("transactions"); }
  async function decide(state: "changes" | "approved") {
    if (previewAmin || !review || !canDecide) return;
    setBusy(true); setError("");
    try {
      await reviewApi(apiBase, "decision", { id: review.id, state, comment: state === "changes" ? comment.trim() : "" });
      onDecision();
    } catch (e) { setError(e instanceof Error ? e.message : "Decision could not be saved."); }
    finally { setBusy(false); }
  }
  const headline = report.company.metrics.filter(m => ["revenue", "gross-profit", "net-profit"].includes(m.key));
  function lineLabel(label: string) {
    return ledgerLabels.has(label.trim().toLowerCase()) ? <button className="owner-link" onClick={() => openTransactions(label)}>{label}</button> : label;
  }
  function drillTo(unit: string, metric: string) {
    setScope(unit); setActiveCategory(metric); setTab("results");
    requestAnimationFrame(() => document.getElementById("owner-profit")?.scrollIntoView({ block: "start" }));
  }
  return <>{review && !review.current && <div role="status" className="owner-panel panel">This version was superseded. <Button variant="outline" onClick={showLatest}>Open current version</Button></div>}
    <div className="owner-metrics">{headline.map(m => <button key={m.key} type="button" className="owner-drill-card" aria-label={reportMetricLabels[m.key] + " " + usd(m.value) + ", view breakdown"} onClick={() => drillTo(report.company.id, m.key)}><span>{reportMetricLabels[m.key]}</span><ChevronDown size={14} aria-hidden="true" /><strong>{usd(m.value)}</strong></button>)}
      <div><span>My partner balance</span><strong>{usd(report.balance)}</strong><small>As of {report.balanceAsOf}</small></div></div>
    <div className="owner-nav"><nav className="segmented-control" aria-label="Owner views">
      {(["results", "transactions", "sign-off"] as const).map((key, i) => <button key={key} className={tab === key ? "active" : ""} aria-current={tab === key ? "page" : undefined} onClick={() => setTab(key)}>{["Monthly results", "Transactions", "Sign-off"][i]}</button>)}</nav>
      <button className="owner-status-button" aria-label="View month sign-off" onClick={() => setTab("sign-off")}><ReviewStatus review={review} /></button></div>
    {tab === "results" && <section id="owner-profit" className="panel owner-panel"><div className="owner-heading"><h2>Profit and loss</h2>
      <label>Business unit<select value={selected.id} onChange={e => setScope(e.target.value)}>
        {[report.company, ...report.units].map(u => <option value={u.id} key={u.id}>{u.name}</option>)}</select></label></div>
      <OwnerProfitCards unit={selected} active={activeCategory} setActive={setActiveCategory} drillTo={drillTo} lineLabel={lineLabel} />
      {ledgerLabels.has(selected.name.trim().toLowerCase()) && <Button variant="outline" onClick={() => openTransactions("")}>View {selected.name} transactions</Button>}</section>}
    {tab === "transactions" && <section className="panel owner-panel"><div className="owner-heading"><h2>Reported bank transactions</h2>
      {segment && <Button variant="outline" onClick={() => setSegment("")}>{segment} · Clear segment</Button>}
      <label>Category or segment<select value={filter} onChange={e => setFilter(e.target.value)}><option value="">All</option>
        {[...new Set([...(filter ? [filter] : []), ...segmentRows.flatMap(t => [t.segment, t.nature])])].sort().map(label => <option key={label}>{label}</option>)}</select></label></div>
      {transactions.error ? <p role="alert">{transactions.error} <Button onClick={() => setAttempt(n => n + 1)}>Retry</Button></p> : !transactions.data ? <p role="status">Loading transactions…</p> :
        <ReviewTable name="ownerTxn" caption="Bank entries dated in the selected month" empty="No reported transactions match this selection."
          rows={segmentRows.filter(t => !filter || associated(t, filter))}
          mobileRow={row => <details className="owner-mobile-entry"><summary><span>{row.nature}<small>{row.date}</small></span><strong>{usd(row.usd)}</strong></summary>
            <dl>{[["Bank", row.bank], ["Segment", row.segment], ["Account type", row.type], ["Currency", row.currency],
              ["Amount", row.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })]].map(([label, value]) =>
              <div key={label}><dt>{label}</dt><dd>{value || "—"}</dd></div>)}</dl></details>}
          columns={[{ key: "date", label: "Date" }, { key: "bank", label: "Bank" }, { key: "segment", label: "Segment" }, { key: "nature", label: "Category" },
            { key: "type", label: "Account type" }, { key: "currency", label: "Currency" }, { key: "amount", label: "Amount", show: r => r.amount.toLocaleString("en-US", { minimumFractionDigits: 2 }) }, { key: "usd", label: "USD", show: r => usd(r.usd) }]} />}</section>}
    {tab === "sign-off" && <section className="panel owner-panel"><div className="owner-heading"><h2>Monthly sign-off</h2><ReviewStatus review={review} /></div>
      {review ? <Signers review={review} /> : <p>Finance will email you when this month is ready to approve or request changes.</p>}
      {review && canDecide && <div className="owner-actions">{showComment && <label>What should finance change?<textarea autoFocus maxLength={2000} value={comment} onChange={e => setComment(e.target.value)} /></label>}
        <div>{showComment ? <><Button disabled={busy || !comment.trim()} onClick={() => decide("changes")}>Send change request</Button> <Button variant="outline" disabled={busy} onClick={() => setShowComment(false)}>Cancel</Button></>
          : <><Button disabled={previewAmin || busy} onClick={() => decide("approved")}>Approve {monthLabel(review.period)}</Button> <Button variant="outline" disabled={previewAmin || busy} onClick={() => setShowComment(true)}>Request changes</Button></>}</div></div>}
      {error && <p role="alert">{error} <button onClick={onDecision}>Reload report</button></p>}</section>}
  </>;
}
