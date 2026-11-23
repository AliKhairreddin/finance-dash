import { useState, type ReactNode } from "react";
import { useUrlState } from "@/lib/url-state";
import { compareTableValues, SortableTableHead } from "@/components/ui/sortable-table-head";
import { owners, reviewStatus, type ReviewSummary } from "../../../shared/ownerReview";

export function Signers({ review }: { review: ReviewSummary }) {
  if (review.priorConfirmation) return <p>Prior sign-off recorded by {review.priorConfirmation.by} on {new Date(review.priorConfirmation.at).toLocaleDateString()}.</p>;
  return <div className="review-signers">{owners.map(owner => {
    const decision = review.decisions.find(d => d.owner === owner);
    return <div key={owner}><strong>{owner}</strong><span>{decision?.state === "approved" ? "Approved" : decision ? "Changes requested" : "Pending"}</span>
      {decision && <small>{new Date(decision.at).toLocaleString()}</small>}{decision?.comment && <p>{decision.comment}</p>}</div>;
  })}</div>;
}

export function ReviewStatus({ review }: { review: ReviewSummary | null }) {
  if (!review) return <span className="total-pill">Pending finance review</span>;
  return <span className="total-pill">{review.current ? reviewStatus(review) : "Superseded"}{!review.priorConfirmation && ` · ${review.decisions.filter(d => d.state === "approved").length}/3 approved`}</span>;
}

type Column<T> = { key: keyof T & string; label: string; show?: (row: T) => ReactNode };
export function ReviewTable<T extends { id: string }>({ rows, columns, name, caption, empty, mobileRow }: {
  rows: T[]; columns: Column<T>[]; name: string; caption: string; empty: string; mobileRow: (row: T) => ReactNode;
}) {
  const [sort, setSort] = useUrlState(name + "Sort", columns[0].key, { allowedValues: columns.map(c => c.key) });
  const [direction, setDirection] = useUrlState<"asc" | "desc">(name + "Order", name === "ownerTxn" ? "desc" : "asc", { allowedValues: ["asc", "desc"] });
  const [limit, setLimit] = useState(50);
  const sorted = [...rows].sort((a, b) => compareTableValues(a[sort] as string | number | null, b[sort] as string | number | null, direction) || a.id.localeCompare(b.id));
  function sortBy(key: keyof T & string) { setDirection(key === sort && direction === "asc" ? "desc" : "asc"); setSort(key); setLimit(50); }
  return <><div className="owner-mobile-list">
    <div className="owner-mobile-sort"><label>Sort by<select value={sort} onChange={e => sortBy(e.target.value as keyof T & string)}>
      {columns.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</select></label>
      <button className="secondary-button" onClick={() => sortBy(sort)}>{direction === "asc" ? "↑ Ascending" : "↓ Descending"}</button></div>
    <ul aria-label={caption}>{sorted.slice(0, limit).map(row => <li key={row.id}>{mobileRow(row)}</li>)}</ul>
    {!rows.length && <p>{empty}</p>}</div>
    <div className="table-wrap owner-desktop-table"><table className="data-table"><caption className="sr-only">{caption}</caption>
    <thead><tr>{columns.map(c => <SortableTableHead key={c.key} sortKey={c.key} activeSortKey={sort} onSort={sortBy} direction={direction}>{c.label}</SortableTableHead>)}</tr></thead>
    <tbody>{sorted.slice(0, limit).map(row => <tr key={row.id}>{columns.map(c => <td key={c.key}>{c.show ? c.show(row) : String(row[c.key] ?? "—")}</td>)}</tr>)}
      {!rows.length && <tr><td colSpan={columns.length}>{empty}</td></tr>}</tbody></table></div>
    {sorted.length > limit && <button className="secondary-button" onClick={() => setLimit(n => n + 50)}>Show more ({sorted.length - limit})</button>}</>;
}
