import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { OwnerReport } from "../../../shared/ownerReview";
import { reportMetricLabels } from "../../../shared/managementReportBreakdown";
import { ReviewTable } from "./ReviewDetails";
import { usd } from "./reviewApi";

export function OwnerProfitCards({ unit, active, setActive, drillTo, lineLabel }: {
  unit: OwnerReport["company"]; active: string; setActive: (key: string) => void;
  drillTo: (unit: string, metric: string) => void; lineLabel: (label: string) => ReactNode;
}) {
  const cards: { key: string; label: string; amount: string; rows: typeof unit.metrics[number]["rows"] }[] = unit.metrics.map(metric => ({
    key: metric.key, label: reportMetricLabels[metric.key], amount: usd(metric.value), rows: metric.rows
  }));
  const included = new Set(cards.flatMap(card => card.rows.map(row => row.id)));
  for (const line of unit.lines) {
    if (included.has(line.id)) continue;
    const key = "lines-" + line.group;
    let extra = cards.find(card => card.key === key);
    if (!extra) {
      const label = line.group === "withdrawal" ? "Withdrawals" : line.group.replaceAll("-", " ").replace(/^./, c => c.toUpperCase()) + " details";
      extra = { key, label, amount: "", rows: [] };
      cards.push(extra);
    }
    extra.rows.push({ id: line.id, label: line.label, value: line.value, scope: null, metric: null });
  }
  const selected = cards.find(card => card.key === active);
  function rowLabel(row: (typeof cards)[number]["rows"][number]) {
    if (row.scope && row.metric) {
      const { scope, metric } = row;
      return <button type="button" className="owner-link" onClick={() => drillTo(scope, metric)}>{row.label}</button>;
    }
    return lineLabel(row.label);
  }
  return <><div className="owner-card-grid owner-profit-grid">
    {cards.map(card => <button type="button" className="owner-drill-card" key={card.key} aria-expanded={active === card.key}
      onClick={() => setActive(active === card.key ? "" : card.key)}>
      <span>{card.label}</span><ChevronDown size={14} aria-hidden="true" />
      <strong>{card.amount || (card.rows.length === 1 ? "1 line" : card.rows.length + " lines")}</strong>
    </button>)}</div>
    {selected && <div className="owner-breakdown"><h3>{selected.label} breakdown</h3>
      <ReviewTable key={selected.key} name="ownerLines" caption={selected.label + " breakdown"} empty="No itemized lines reported for this month."
        rows={selected.rows} columns={[{ key: "label", label: "Line", show: rowLabel },
          { key: "value", label: "Amount (USD)", show: row => usd(row.value) }]}
        mobileRow={row => <div className="owner-mobile-line"><span>{rowLabel(row)}</span><strong>{usd(row.value)}</strong></div>} />
    </div>}</>;
}
