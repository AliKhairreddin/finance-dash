import { ArrowLeft, ArrowUpRight, CheckCircle2, TriangleAlert } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { InfoPopover } from "@/components/ui/finance-visuals";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { compareTableValues, SortableTableHead, type TableSortDirection } from "@/components/ui/sortable-table-head";
import { useUrlState, useUrlStateHref } from "@/lib/url-state";
import type { ManagementReportDashboard } from "../../../shared/managementReport";
import {
  businessMetricBreakdown, platformSpendRows, reportBreakdownUrl, reportColumn, reportMetricLabels,
  sumBreakdownRows, type ReportBreakdownRow, type ReportBreakdownTarget, type ReportMetric
} from "../../../shared/managementReportBreakdown";

const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const percent = (value: number) => new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 }).format(value);

export function BreakdownLink({ children, target, className = "management-report-value-link", label }: {
  children: ReactNode; target: ReportBreakdownTarget; className?: string; label?: string;
}) {
  // Subscribe to URL changes so links always retain the current filters and sorting.
  const current = useUrlStateHref("page", "management", "overview");
  const href = reportBreakdownUrl(new URL(current, window.location.origin).href, target);
  return <a className={className} href={href} aria-label={label} onClick={event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    window.history.pushState({}, "", href);
    window.dispatchEvent(new Event("finance-dash:url-state-change"));
  }}>{children}</a>;
}

export function ReportValueLink({ value, metric, period, scope }: {
  value: number; metric: ReportMetric; period: string; scope?: string;
}) {
  return <BreakdownLink target={{ metric, period, scope }} label={`Break down ${reportMetricLabels[metric]}: ${metric === "net-margin" ? percent(value) : money(value)}`}>
    {metric === "net-margin" ? percent(value) : money(value)}
  </BreakdownLink>;
}

type RowSort = "label" | "basis" | "value" | "source";

function BreakdownTable({ rows, title, period, stateKey, total, totalLabel = "Line total", ratio = false }: {
  rows: ReportBreakdownRow[]; title: string; period: string; stateKey: string; total?: number; totalLabel?: string; ratio?: boolean;
}) {
  const [sort, setSort] = useUrlState<RowSort>(`${stateKey}Sort`, "source", { allowedValues: ["label", "basis", "value", "source"] });
  const [order, setOrder] = useUrlState<TableSortDirection>(`${stateKey}Order`, "asc", { allowedValues: ["asc", "desc"] });
  const [showZero, setShowZero] = useUrlState(`${stateKey}Zeros`, "hide", { allowedValues: ["hide", "show"] });
  const visible = rows.filter(row => showZero === "show" || row.value !== 0).sort((a, b) => {
    if (sort === "source") return compareTableValues(a.source.split(" · ")[0], b.source.split(" · ")[0], order) || compareTableValues(a.sourceRow, b.sourceRow, order);
    return compareTableValues(a[sort], b[sort], order) || a.id.localeCompare(b.id);
  });
  function requestSort(key: RowSort) {
    if (key === sort) setOrder(value => value === "asc" ? "desc" : "asc");
    else { setSort(key); setOrder("asc"); }
  }
  return <section className="management-report-panel" aria-label={title}>
    <div className="management-report-panel-header">
      <div className="management-report-panel-heading"><h3>{title}</h3></div>
      <label className="management-report-zero-toggle"><input type="checkbox" checked={showZero === "show"} onChange={event => setShowZero(event.target.checked ? "show" : "hide")} />Show zero lines</label>
    </div>
    <div className="management-report-table-wrap">
      <table className="management-report-table management-report-detail-table">
        <caption>{title}</caption>
        <thead><tr>
          <SortableTableHead activeSortKey={sort} direction={order} onSort={requestSort} sortKey="label">Item</SortableTableHead>
          <SortableTableHead activeSortKey={sort} direction={order} onSort={requestSort} sortKey="basis">Workbook basis</SortableTableHead>
          <SortableTableHead activeSortKey={sort} className="amount" direction={order} onSort={requestSort} sortKey="value">Amount</SortableTableHead>
          <SortableTableHead activeSortKey={sort} direction={order} onSort={requestSort} sortKey="source">Source</SortableTableHead>
        </tr></thead>
        <tbody>{visible.length ? visible.map(row => <tr key={row.id}>
          <td className="wrap">{row.metric ? <BreakdownLink target={{ metric: row.metric, scope: row.scope, period }}>{row.label}<ArrowUpRight size={13} aria-hidden="true" /></BreakdownLink> : row.label}</td>
          <td className="wrap">{row.basis}</td>
          <td className={`amount ${row.value !== undefined && row.value < 0 ? "management-report-negative" : ""}`}>
            {row.value === undefined ? <span className="management-report-missing">Not reported</span> : row.metric ? <BreakdownLink target={{ metric: row.metric, scope: row.scope, period }} label={`Break down ${row.label}`}>{money(row.value)}</BreakdownLink> : money(row.value)}
          </td>
          <td>{row.source}</td>
        </tr>) : <tr><td className="management-report-empty-row" colSpan={4}>{rows.length ? "All available lines are zero. Enable Show zero lines to inspect them." : "No supporting lines are available in this imported snapshot."}</td></tr>}</tbody>
        {total !== undefined && <tfoot><tr className="total-row"><td colSpan={2}>{totalLabel}</td><td className="amount">{ratio ? percent(total) : money(total)}</td><td /></tr></tfoot>}
      </table>
    </div>
  </section>;
}

const metricDescriptions: Record<ReportMetric, string> = {
  revenue: "The workbook’s advertising revenue subtotal. Negative lines are retained as reported, including allocation adjustments.",
  "marketing-spend": "The workbook’s marketing subtotal includes the advertising, commission and adjustment lines listed here. It can differ from the separate PLP platform allocation.",
  "operating-spend": "The workbook’s TOTAL SPEND subtotal includes the personnel, services and overhead recorded above it. Named payments retain their original labels; the workbook does not necessarily identify them as salaries or contractor fees. Lines below this subtotal are shown separately.",
  "gross-profit": "Revenue less marketing spend, compared with the workbook’s reported gross profit. Open either amount to see its supporting lines.",
  "net-profit": "Gross profit less operating spend and any additional deductions listed before net profit on this sheet. The reported total remains authoritative; any unexplained difference is shown. Consolidated and business-unit profit can differ.",
  "net-margin": "Net profit divided by revenue. Monthly margins are calculated from the reported monthly amounts; YTD is compared with the workbook’s reported percentage. A zero or missing revenue denominator has no meaningful margin.",
  "platform-spend": "Positive monthly spend allocations from the PLP tab, matching the summary chart. YTD and total rows are excluded to avoid counting the same allocation twice. This is not the consolidated marketing-spend total."
};

export function ManagementBreakdown({ dashboard, period }: { dashboard: ManagementReportDashboard; period: string }) {
  const [metric] = useUrlState<ReportMetric>("managementMetric", "operating-spend", { allowedValues: Object.keys(reportMetricLabels) as ReportMetric[] });
  const [scope] = useUrlState("managementScope", dashboard.consolidated.id);
  const [platform] = useUrlState("managementPlatform", "");
  const title = useRef<HTMLHeadingElement>(null);
  const unit = scope === dashboard.consolidated.id ? dashboard.consolidated : dashboard.businessUnits.find(candidate => candidate.id === scope);
  const isPlatform = metric === "platform-spend";
  const validPeriod = period === "ytd" || dashboard.trend.some(point => point.period === period);
  const detail = !isPlatform && unit && validPeriod ? businessMetricBreakdown(dashboard, unit, period, metric) : undefined;
  const rows = isPlatform && validPeriod ? platformSpendRows(dashboard, period, platform) : detail?.rows ?? [];
  const total = isPlatform ? sumBreakdownRows(rows) : detail?.reported;
  const ratio = metric === "net-margin";
  const format = ratio ? percent : money;
  const difference = detail?.difference;
  const reconciled = difference !== undefined && Math.abs(difference) < (ratio ? 0.000001 : 0.01);
  const periodLabel = period === "ytd" ? `YTD through ${new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(`${dashboard.metadata.asOf}T00:00:00`))}` : validPeriod ? new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(`${period}T00:00:00`)) : "Unavailable period";
  const exclusions = detail?.exclusions.filter(row => row.value !== 0) ?? [];

  useEffect(() => { title.current?.focus({ preventScroll: true }); title.current?.scrollIntoView({ block: "start" }); }, [metric, scope, period, platform]);

  return <div className="management-report-tab-panel">
    <nav className="management-report-breadcrumbs" aria-label="Breakdown navigation">
      <BreakdownLink target={{}}><ArrowLeft size={14} aria-hidden="true" />Summary</BreakdownLink>
      {!isPlatform && scope !== dashboard.consolidated.id && <><span aria-hidden="true">/</span><BreakdownLink target={{ metric, period }}>{reportMetricLabels[metric]}</BreakdownLink></>}
      <span aria-hidden="true">/</span><span>{isPlatform ? platform || "All platforms" : unit?.name || "Unknown business unit"}</span>
    </nav>
    <section className="management-report-panel management-report-detail-hero">
      <div>
        <div className="management-report-detail-heading"><h3 ref={title} tabIndex={-1}>{reportMetricLabels[metric]}</h3><InfoPopover label={reportMetricLabels[metric]}>{metricDescriptions[metric]}</InfoPopover></div>
        <strong className="management-report-detail-total">{total === undefined ? "Not reported" : format(total)}</strong>
        <p>{periodLabel} · {isPlatform ? platform || "PLP allocation" : unit?.name || "Unknown business unit"}</p>
        {detail?.source && <small>{detail.source}{ratio && period !== "ytd" ? " · calculated from monthly profit and revenue" : " · reported workbook value"}</small>}
      </div>
      {isPlatform ? <label className="management-report-field">Platform<NativeSelect value={platform || "all"} onValueChange={value => {
        window.history.pushState({}, "", reportBreakdownUrl(window.location.href, { metric, period, platform: value === "all" ? undefined : value }));
        window.dispatchEvent(new Event("finance-dash:url-state-change"));
      }}><NativeSelectOption value="all">All platforms</NativeSelectOption>{[...new Set(platformSpendRows(dashboard, period).map(row => row.label))].map(name => <NativeSelectOption key={name} value={name}>{name}</NativeSelectOption>)}</NativeSelect></label>
      : <div className="management-report-metric-links" aria-label="Other metrics">{(Object.keys(reportMetricLabels) as ReportMetric[]).filter(key => key !== "platform-spend").map(key => <BreakdownLink key={key} target={{ metric: key, scope, period }} className={`management-report-metric-link ${key === metric ? "active" : ""}`}>{reportMetricLabels[key]}</BreakdownLink>)}</div>}
    </section>
    {(!validPeriod || (!isPlatform && (!unit || !reportColumn(unit, period)))) && <div className="management-report-summary-note warning" role="status"><TriangleAlert size={16} aria-hidden="true" /><span>This business unit or period is not available in the imported workbook. Choose an available period or return to Summary.</span></div>}
    {detail && <div className={`management-report-summary-note ${reconciled ? "" : "warning"}`} role="status">
      {reconciled ? <CheckCircle2 size={16} aria-hidden="true" /> : <TriangleAlert size={16} aria-hidden="true" />}
      <span>{reconciled ? "Supporting lines reconcile to the reported total." : difference !== undefined ? <>Reported total differs from {ratio ? "the calculated margin" : "the supporting lines"} by <strong>{ratio ? `${(difference * 100).toFixed(4)} percentage points` : money(difference)}</strong>. The workbook total is preserved.</> : "The breakdown cannot be fully reconciled: supporting amounts are missing or the calculation is undefined."}</span>
    </div>}
    {isPlatform && <div className="management-report-summary-note"><span>PLP allocation only · separate from consolidated marketing spend.</span></div>}
    <BreakdownTable key={`${metric}-${scope}`} rows={rows} title={isPlatform ? "Platform allocations" : metric === "net-margin" ? "Margin calculation" : metric === "gross-profit" || metric === "net-profit" ? "Profit calculation" : "Included in this total"} period={period} stateKey="managementBreakdown" total={isPlatform ? total : detail?.total} ratio={ratio} totalLabel={ratio ? "Net profit ÷ revenue" : "Supporting line total"} />
    {exclusions.length > 0 && <>
      <div className="management-report-summary-note warning"><TriangleAlert size={16} aria-hidden="true" /><span><strong>Excluded from operating spend:</strong> these amounts are recorded below the business-unit TOTAL SPEND rows.</span></div>
      <BreakdownTable rows={exclusions} title="Outside this subtotal" period={period} stateKey="managementExcluded" total={sumBreakdownRows(exclusions)} totalLabel="Excluded line total" />
    </>}
  </div>;
}
