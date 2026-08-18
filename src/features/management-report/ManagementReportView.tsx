import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Database,
  FileSpreadsheet,
  Info,
  Loader2,
  PanelRightOpen,
  RefreshCw,
  Search,
  ShieldCheck,
  TriangleAlert,
  X
} from "lucide-react";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { compareTableValues, SortableTableHead, type TableSortDirection } from "@/components/ui/sortable-table-head";
import { useUrlState } from "@/lib/url-state";
import type {
  ManagementReportBankAggregate,
  ManagementReportBusinessUnit,
  ManagementReportCheck,
  ManagementReportDashboard,
  ManagementReportKpi,
  ManagementReportOfferReconciliationEntry,
  ManagementReportPlatformPerformance,
  ManagementReportRecentBankEntry,
  ManagementReportTrendPoint
} from "../../../shared/managementReport";

interface ManagementReportViewProps {
  apiBase: string;
}

interface ManagementReportApiResponse {
  dashboard: ManagementReportDashboard | null;
}

type PerformanceDimension = "team" | "offer" | "platform";
type LedgerSortKey = "bank" | "company" | "date" | "nativeAmount" | "nature" | "period" | "team" | "usdAmount";
type ManagementReportSection = "summary" | "performance" | "ledger" | "ownership";
type SummaryPeriod = "ytd" | string;
type TrendSortKey = "grossProfit" | "marketingSpend" | "month" | "netProfit" | "operatingSpend" | "revenue";
type CompositionSortKey = "metric" | "value";
type UnitSortKey = "marketing" | "margin" | "name" | "operating" | "profit" | "revenue" | "status" | "type";

interface PeriodActual {
  grossProfit: number;
  marketingSpend: number;
  netMargin: number;
  netProfit: number;
  operatingSpend: number;
  revenue: number;
}

const wholeNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const percentNumber = new Intl.NumberFormat("en-US", {
  style: "percent",
  minimumFractionDigits: 0,
  maximumFractionDigits: 1
});

function money(value: number, currency = "USD", maximumFractionDigits = 0): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits
  }).format(value);
}

function percent(value: number): string {
  return percentNumber.format(value);
}

function dateLabel(value: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function dateTimeLabel(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function monthPeriodLabel(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(date);
}

function monthNameLabel(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("en-US", { month: "long" }).format(date);
}

function shortMonthPeriodLabel(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(date);
}

function monthPeriodOptionLabel(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  const month = new Intl.DateTimeFormat("en-US", { month: "short" }).format(date);
  return `${monthPeriodLabel(value)} · ${month} 1–${date.getDate()}`;
}

function yearToDateOptionLabel(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  const end = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
  return `Year to date · Jan 1–${end}`;
}

function valueTone(value: number): string {
  if (value > 0) return "management-report-positive";
  if (value < 0) return "management-report-negative";
  return "management-report-muted";
}

function bankEntryTone(entry: ManagementReportRecentBankEntry): string {
  const accountType = entry.accountType.toLowerCase();
  if (accountType.includes("income") || accountType.includes("revenue")) return "management-report-positive";
  if (accountType.includes("expense") || accountType.includes("spend") || accountType.includes("cost")) return "management-report-negative";
  return valueTone(entry.amountUsd || entry.amountIncludingVat);
}

function kpiValue(kpi: ManagementReportKpi): string {
  if (kpi.unit === "currency") return money(kpi.value, kpi.currency ?? "USD");
  if (kpi.unit === "percent") return percent(kpi.value);
  return wholeNumber.format(kpi.value);
}

function toneIcon(tone: ManagementReportKpi["tone"]) {
  if (tone === "positive") return <ArrowUpRight size={13} aria-hidden="true" />;
  if (tone === "negative") return <ArrowDownRight size={13} aria-hidden="true" />;
  if (tone === "warning") return <TriangleAlert size={13} aria-hidden="true" />;
  return null;
}

function toneLabel(tone: ManagementReportKpi["tone"]): string {
  if (tone === "positive") return "Favorable";
  if (tone === "negative") return "Unfavorable";
  if (tone === "warning") return "Needs attention";
  return "Reported";
}

function KpiGrid({ kpis }: { kpis: ManagementReportKpi[] }) {
  return (
    <div className={`management-report-kpi-grid ${kpis.length > 4 ? "dense" : ""}`}>
      {kpis.map((kpi) => (
        <article className="management-report-kpi" key={kpi.id}>
          <div className="management-report-kpi-topline">
            <span>{kpi.label}</span>
            <span className={`management-report-tone ${kpi.tone ?? "neutral"}`}>
              {toneIcon(kpi.tone)}
              <span>{toneLabel(kpi.tone)}</span>
            </span>
          </div>
          <strong>{kpiValue(kpi)}</strong>
          <small>{kpi.detail ?? "Management workbook actual"}</small>
        </article>
      ))}
    </div>
  );
}

function checkIcon(check: ManagementReportCheck) {
  if (check.severity === "error") return <AlertCircle size={15} aria-hidden="true" />;
  if (check.severity === "warning") return <TriangleAlert size={15} aria-hidden="true" />;
  return <Info size={15} aria-hidden="true" />;
}

function ManagementReportDetailsDrawer({ dashboard }: { dashboard: ManagementReportDashboard }) {
  const usableSheets = dashboard.sheetSummaries.filter(
    (sheet) => sheet.status === "ready" || sheet.status === "ready-with-warnings"
  ).length;
  const actionableChecks = dashboard.checks.filter((check) => check.severity !== "info");
  const visibleChecks = (actionableChecks.length > 0 ? actionableChecks : dashboard.checks).slice(0, 4);
  const hiddenCheckCount = Math.max(0, (actionableChecks.length > 0 ? actionableChecks : dashboard.checks).length - visibleChecks.length);
  const statusLabel = dashboard.status === "ready"
    ? "Management report ready"
    : dashboard.status === "ready-with-warnings"
      ? "Management report ready with warnings"
      : "Management report needs attention";

  return (
    <BaseDialog.Root>
      {createPortal(
        <BaseDialog.Trigger className="bank-details-nudge" aria-label="Open management report details">
          <PanelRightOpen aria-hidden="true" size={17} />
          <span>Details</span>
        </BaseDialog.Trigger>,
        document.body
      )}
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="bank-details-backdrop" />
        <BaseDialog.Popup className="bank-details-drawer management-report-details-drawer">
          <div className="bank-details-drawer-header">
            <div>
              <p className="eyebrow">Management report</p>
              <BaseDialog.Title>Workbook import details</BaseDialog.Title>
            </div>
            <BaseDialog.Close className="icon-button" aria-label="Close management report details">
              <X aria-hidden="true" size={18} />
            </BaseDialog.Close>
          </div>
          <BaseDialog.Description className="screen-reader-only">
            Reporting close, source, workbook coverage, and import checks for the manual management report.
          </BaseDialog.Description>
          <div className="bank-details-drawer-body">
            <section className="bank-details-section">
              <div className="management-report-details-summary">
                <div className="management-report-status-title">
                  <span className={`management-report-status-title-icon ${dashboard.status}`}>
                    {dashboard.status === "ready" ? <ShieldCheck size={18} aria-hidden="true" /> : <TriangleAlert size={18} aria-hidden="true" />}
                  </span>
                  <div>
                    <h2>{statusLabel}</h2>
                    <p>{dashboard.metadata.reportName}</p>
                  </div>
                </div>
                <span className="management-report-source-badge"><FileSpreadsheet size={13} aria-hidden="true" /> Manual workbook import</span>
              </div>
              <div className="management-report-status-grid">
                <div className="management-report-status-item">
                  <span className="management-report-status-label"><CalendarDays size={13} aria-hidden="true" /> Reporting period</span>
                  <span className="management-report-status-value">YTD through {monthPeriodLabel(dashboard.metadata.asOf)}</span>
                  <span className="management-report-status-note">{monthNameLabel(dashboard.metadata.asOf)} month-end · official bank close {dateLabel(dashboard.metadata.officialBankThrough)}</span>
                </div>
                <div className="management-report-status-item">
                  <span className="management-report-status-label"><Clock3 size={13} aria-hidden="true" /> Imported at</span>
                  <span className="management-report-status-value">{dateTimeLabel(dashboard.metadata.importedAt)}</span>
                  <span className="management-report-status-note">Import ID {dashboard.metadata.importId}</span>
                </div>
                <div className="management-report-status-item">
                  <span className="management-report-status-label"><Database size={13} aria-hidden="true" /> Source type</span>
                  <span className="management-report-status-value">Manual workbook</span>
                  <span className="management-report-status-note">{dashboard.metadata.sourceLabel}</span>
                </div>
                <div className="management-report-status-item">
                  <span className="management-report-status-label"><CheckCircle2 size={13} aria-hidden="true" /> Sheet coverage</span>
                  <span className="management-report-status-value">{usableSheets} of {dashboard.sheetSummaries.length} usable</span>
                  <span className="management-report-status-note">{actionableChecks.length} warning{actionableChecks.length === 1 ? "" : "s"} or errors</span>
                </div>
              </div>
            </section>

            <section className="bank-details-section">
              <div className="bank-details-section-heading"><h3>Workbook coverage</h3><span>{usableSheets}/{dashboard.sheetSummaries.length} sheets</span></div>
              <div className="management-report-details-section-body management-report-sheet-list">
                {dashboard.sheetSummaries.map((sheet) => (
                  <span
                    className={`management-report-sheet-pill ${sheet.status === "ready" ? "" : sheet.status === "ready-with-warnings" ? "warning" : "error"}`}
                    key={sheet.key}
                    title={`${sheet.title}: ${sheet.status}`}
                  >
                    {sheet.status === "ready" ? <CheckCircle2 size={12} aria-hidden="true" /> : <TriangleAlert size={12} aria-hidden="true" />}
                    <span>{sheet.title}</span>
                    <small>{wholeNumber.format(sheet.parsedRecordCount)} records</small>
                  </span>
                ))}
              </div>
            </section>

            <section className="bank-details-section">
              <div className="bank-details-section-heading"><h3>Import checks</h3><span>{hiddenCheckCount > 0 ? `+${hiddenCheckCount} more` : "Latest import"}</span></div>
              <div className="management-report-details-section-body">
                <ul className="management-report-check-list">
                  {visibleChecks.length > 0 ? visibleChecks.map((check) => (
                    <li className={`management-report-check ${check.severity}`} key={`${check.code}-${check.sheetKey ?? "report"}-${check.sourceRow ?? 0}`}>
                      {checkIcon(check)}
                      <span>{check.message}</span>
                    </li>
                  )) : (
                    <li className="management-report-check pass"><CheckCircle2 size={15} aria-hidden="true" /><span>All workbook checks passed.</span></li>
                  )}
                </ul>
              </div>
            </section>
          </div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

function PanelHeader({ title, detail, trailing }: { title: string; detail: string; trailing?: ReactNode }) {
  return (
    <div className="management-report-panel-header">
      <div className="management-report-panel-heading"><h3>{title}</h3><p>{detail}</p></div>
      {trailing}
    </div>
  );
}

function TrendPanel({ selectedPeriod, trend }: { selectedPeriod: SummaryPeriod; trend: ManagementReportTrendPoint[] }) {
  const [sortKey, setSortKey] = useUrlState<TrendSortKey>("managementTrendSort", "month", {
    allowedValues: ["grossProfit", "marketingSpend", "month", "netProfit", "operatingSpend", "revenue"]
  });
  const [sortDirection, setSortDirection] = useUrlState<TableSortDirection>("managementTrendOrder", "asc", {
    allowedValues: ["asc", "desc"]
  });
  const sortedTrend = useMemo(() => [...trend].sort((left, right) => {
    const value = (point: ManagementReportTrendPoint): number | string => sortKey === "month" ? point.period : point[sortKey];
    return compareTableValues(value(left), value(right), sortDirection) || left.period.localeCompare(right.period);
  }), [sortDirection, sortKey, trend]);
  const maximum = Math.max(1, ...trend.flatMap((point) => [Math.abs(point.revenue), Math.abs(point.marketingSpend)]));

  function requestSort(nextSortKey: TrendSortKey) {
    if (nextSortKey === sortKey) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(nextSortKey);
    setSortDirection(nextSortKey === "month" ? "asc" : "desc");
  }

  return (
    <section className="management-report-panel" aria-labelledby="management-report-trend-title">
      <div className="management-report-panel-header">
        <div className="management-report-panel-heading"><h3 id="management-report-trend-title">Monthly performance trend</h3><p>Revenue and marketing spend from the official management period.</p></div>
      </div>
      <div className="management-report-panel-body">
        {trend.length > 0 ? (
          <div aria-hidden="true" className="management-report-trend-chart">
            <div className="management-report-chart-legend"><span><i /> Revenue</span><span className="spend"><i /> Marketing spend</span></div>
            {trend.map((point) => (
              <div className={`management-report-trend-row ${selectedPeriod === point.period ? "selected" : ""}`} key={point.period}>
                <span className="management-report-trend-label">{shortMonthPeriodLabel(point.period)}</span>
                <span className="management-report-trend-track">
                  <span className="management-report-trend-bar revenue" style={{ width: `${Math.abs(point.revenue) / maximum * 100}%` }} />
                  <span className="management-report-trend-bar spend" style={{ width: `${Math.abs(point.marketingSpend) / maximum * 100}%` }} />
                </span>
                <span className="management-report-trend-value">{money(point.netProfit)}</span>
              </div>
            ))}
          </div>
        ) : <div className="management-report-empty-row">No monthly trend is available.</div>}
      </div>
      <div className="management-report-table-wrap">
        <table className="management-report-table">
          <caption>Monthly management performance values equivalent to the trend chart</caption>
          <thead><tr>
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="month">Month</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={requestSort} sortKey="revenue">Revenue</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={requestSort} sortKey="marketingSpend">Marketing</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={requestSort} sortKey="operatingSpend">Operating</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={requestSort} sortKey="grossProfit">Gross profit</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={requestSort} sortKey="netProfit">Net profit</SortableTableHead>
          </tr></thead>
          <tbody>
            {sortedTrend.length > 0 ? sortedTrend.map((point) => (
              <tr className={selectedPeriod === point.period ? "management-report-selected-row" : ""} key={point.period}>
                <td>{shortMonthPeriodLabel(point.period)}</td><td className="amount">{money(point.revenue)}</td><td className="amount">{money(point.marketingSpend)}</td><td className="amount">{money(point.operatingSpend)}</td><td className={`amount ${valueTone(point.grossProfit)}`}>{money(point.grossProfit)}</td><td className={`amount ${valueTone(point.netProfit)}`}>{money(point.netProfit)}</td>
              </tr>
            )) : <tr><td className="management-report-empty-row" colSpan={6}>No monthly trend is available.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SummaryComposition({ actual, periodLabel }: { actual: PeriodActual; periodLabel: string }) {
  const [sortKey, setSortKey] = useUrlState<CompositionSortKey>("managementCompositionSort", "value", {
    allowedValues: ["metric", "value"]
  });
  const [sortDirection, setSortDirection] = useUrlState<TableSortDirection>("managementCompositionOrder", "desc", {
    allowedValues: ["asc", "desc"]
  });
  const rows = [
    { label: "Revenue", value: actual.revenue },
    { label: "Marketing spend", value: actual.marketingSpend },
    { label: "Operating spend", value: actual.operatingSpend },
    { label: "Net profit", value: actual.netProfit }
  ];
  const sortedRows = [...rows].sort((left, right) => compareTableValues(
    sortKey === "metric" ? left.label : left.value,
    sortKey === "metric" ? right.label : right.value,
    sortDirection
  ));
  const maximum = Math.max(1, ...rows.map((row) => Math.abs(row.value)));

  function requestSort(nextSortKey: CompositionSortKey) {
    if (nextSortKey === sortKey) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(nextSortKey);
    setSortDirection(nextSortKey === "metric" ? "asc" : "desc");
  }

  return (
    <section className="management-report-panel" aria-labelledby="management-report-composition-title">
      <div className="management-report-panel-header">
        <div className="management-report-panel-heading"><h3 id="management-report-composition-title">P&amp;L composition</h3><p>{periodLabel} consolidated actual.</p></div>
      </div>
      <div className="management-report-panel-body">
        <div aria-hidden="true" className="management-report-breakdown">
          {rows.map((row) => (
            <div className="management-report-breakdown-row" key={row.label}>
              <div className="management-report-breakdown-copy"><span>{row.label}</span><strong>{money(row.value)}</strong></div>
              <div className="management-report-breakdown-track"><div className="management-report-breakdown-bar" style={{ width: `${Math.abs(row.value) / maximum * 100}%` }} /></div>
            </div>
          ))}
        </div>
      </div>
      <div className="management-report-table-wrap">
        <table className="management-report-table">
          <caption>P and L composition values equivalent to the bar chart</caption>
          <thead><tr>
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="metric">Metric</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={requestSort} sortKey="value">Actual</SortableTableHead>
          </tr></thead>
          <tbody>{sortedRows.map((row) => <tr key={row.label}><td>{row.label}</td><td className={`amount ${valueTone(row.value)}`}>{money(row.value)}</td></tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}

function PlatformSpendDonut({ dashboard, selectedPeriod }: { dashboard: ManagementReportDashboard; selectedPeriod: SummaryPeriod }) {
  const colors = ["#18181b", "#6366f1", "#0ea5e9", "#14b8a6", "#f59e0b", "#ec4899"];
  const rows = useMemo(() => {
    const byPlatform = new Map<string, number>();
    for (const row of dashboard.platforms) {
      if (row.isTotal || /ytd/i.test(row.periodLabel) || row.spend <= 0) continue;
      if (selectedPeriod === "ytd" ? row.period > dashboard.metadata.asOf : row.period !== selectedPeriod) continue;
      byPlatform.set(row.platform, (byPlatform.get(row.platform) ?? 0) + row.spend);
    }
    return [...byPlatform.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((left, right) => right.value - left.value);
  }, [dashboard.metadata.asOf, dashboard.platforms, selectedPeriod]);
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  let cursor = 0;
  const gradient = rows.map((row, index) => {
    const start = cursor;
    cursor += total === 0 ? 0 : row.value / total * 100;
    return `${colors[index % colors.length]} ${start}% ${cursor}%`;
  }).join(", ");

  return (
    <section className="management-report-panel" aria-labelledby="management-report-platform-mix-title">
      <div className="management-report-panel-header"><div className="management-report-panel-heading"><h3 id="management-report-platform-mix-title">Platform spend mix</h3><p>Manual PLP workbook allocation.</p></div></div>
      <div className="management-report-donut-layout">
        {total > 0 ? <div aria-label={`Platform spend mix totaling ${money(total)}`} className="management-report-donut" role="img" style={{ backgroundImage: `conic-gradient(${gradient})` }}><span>{money(total)}</span></div> : <div className="management-report-empty-row">No platform spend for this period.</div>}
        {total > 0 && <dl className="management-report-donut-legend">{rows.map((row, index) => <div key={row.label}><dt><i style={{ background: colors[index % colors.length] }} />{row.label}</dt><dd>{percent(row.value / total)}</dd></div>)}</dl>}
      </div>
    </section>
  );
}

function businessUnitPeriodActual(unit: ManagementReportBusinessUnit, selectedPeriod: SummaryPeriod): PeriodActual | undefined {
  if (selectedPeriod === "ytd") return unit.actual;
  const month = unit.monthly.find((row) => row.period === selectedPeriod);
  if (!month) return undefined;
  return { ...month, netMargin: month.revenue === 0 ? 0 : month.netProfit / month.revenue };
}

function businessUnitKindLabel(unit: ManagementReportBusinessUnit): string {
  if (unit.kind === "team") return "Team";
  if (unit.kind === "offer") return "Offer";
  if (unit.kind === "affiliate") return "Affiliate";
  return "Company";
}

function BusinessUnitTable({ selectedPeriod, units }: { selectedPeriod: SummaryPeriod; units: ManagementReportBusinessUnit[] }) {
  const [query, setQuery] = useUrlState("managementUnitQuery", "");
  const [type, setType] = useUrlState("managementUnitType", "all", { allowedValues: ["all", "affiliate", "offer", "team"] });
  const [status, setStatus] = useUrlState("managementUnitStatus", "all", { allowedValues: ["active", "all", "inactive"] });
  const [sortKey, setSortKey] = useUrlState<UnitSortKey>("managementUnitSort", "revenue", {
    allowedValues: ["marketing", "margin", "name", "operating", "profit", "revenue", "status", "type"]
  });
  const [sortDirection, setSortDirection] = useUrlState<TableSortDirection>("managementUnitOrder", "desc", {
    allowedValues: ["asc", "desc"]
  });
  const visibleRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const rows = units.map((unit) => ({ actual: businessUnitPeriodActual(unit, selectedPeriod), unit })).filter(({ unit }) => {
      if (type !== "all" && unit.kind !== type) return false;
      if (status === "active" && !unit.active) return false;
      if (status === "inactive" && unit.active) return false;
      return !normalizedQuery || `${unit.name} ${unit.reportLabel} ${unit.kind}`.toLowerCase().includes(normalizedQuery);
    });
    const value = ({ actual, unit }: (typeof rows)[number]): boolean | number | string | undefined => {
      if (sortKey === "name") return unit.name;
      if (sortKey === "type") return businessUnitKindLabel(unit);
      if (sortKey === "status") return unit.active;
      if (sortKey === "revenue") return actual?.revenue;
      if (sortKey === "marketing") return actual?.marketingSpend;
      if (sortKey === "operating") return actual?.operatingSpend;
      if (sortKey === "profit") return actual?.netProfit;
      return actual?.netMargin;
    };
    return rows.sort((left, right) => compareTableValues(value(left), value(right), sortDirection) || left.unit.name.localeCompare(right.unit.name));
  }, [query, selectedPeriod, sortDirection, sortKey, status, type, units]);

  function requestSort(nextSortKey: UnitSortKey) {
    if (nextSortKey === sortKey) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(nextSortKey);
    setSortDirection(nextSortKey === "name" || nextSortKey === "type" ? "asc" : "desc");
  }

  return (
    <section className="management-report-panel" aria-labelledby="management-report-units-title">
      <div className="management-report-panel-header">
        <div className="management-report-panel-heading"><h3 id="management-report-units-title">Business unit snapshot</h3><p>Workbook-classified teams, offers, and affiliates.</p></div>
        <span className="management-report-source-badge">{visibleRows.length} of {units.length}</span>
      </div>
      <div className="management-report-filter-grid">
        <label className="management-report-field">Search<span className="management-report-search"><Search size={14} aria-hidden="true" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Business unit" /></span></label>
        <label className="management-report-field">Type<NativeSelect value={type} onValueChange={(value) => setType(value as typeof type)}><NativeSelectOption value="all">All types</NativeSelectOption><NativeSelectOption value="team">Teams</NativeSelectOption><NativeSelectOption value="offer">Offers</NativeSelectOption><NativeSelectOption value="affiliate">Affiliates</NativeSelectOption></NativeSelect></label>
        <label className="management-report-field">Status<NativeSelect value={status} onValueChange={(value) => setStatus(value as typeof status)}><NativeSelectOption value="all">All statuses</NativeSelectOption><NativeSelectOption value="active">Active</NativeSelectOption><NativeSelectOption value="inactive">Inactive</NativeSelectOption></NativeSelect></label>
      </div>
      <div className="management-report-table-wrap">
        <table className="management-report-table">
          <caption>Business unit management performance</caption>
          <thead><tr>
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="name">Business unit</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="type">Type</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="status">Status</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={requestSort} sortKey="revenue">Revenue</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={requestSort} sortKey="marketing">Marketing</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={requestSort} sortKey="operating">Operating</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={requestSort} sortKey="profit">Net profit</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={requestSort} sortKey="margin">Net margin</SortableTableHead>
          </tr></thead>
          <tbody>
            {visibleRows.length > 0 ? visibleRows.map(({ actual, unit }) => (
              <tr key={unit.id}>
                <td className="wrap"><strong>{unit.name}</strong><small>{selectedPeriod === "ytd" ? unit.latestPeriodLabel : monthPeriodLabel(selectedPeriod)}</small></td>
                <td>{businessUnitKindLabel(unit)}</td>
                <td><span className={`management-report-entity-status ${unit.active ? "" : "inactive"}`}>{unit.active ? <CheckCircle2 size={11} aria-hidden="true" /> : <CircleAlert size={11} aria-hidden="true" />}{unit.active ? "Active" : "Inactive"}</span></td>
                <td className="amount">{actual ? money(actual.revenue) : "—"}</td>
                <td className="amount">{actual ? money(actual.marketingSpend) : "—"}</td>
                <td className="amount">{actual ? money(actual.operatingSpend) : "—"}</td>
                <td className={`amount ${actual ? valueTone(actual.netProfit) : "management-report-muted"}`}>{actual ? money(actual.netProfit) : "—"}</td>
                <td className={`amount ${actual ? valueTone(actual.netMargin) : "management-report-muted"}`}>{actual ? percent(actual.netMargin) : "—"}</td>
              </tr>
            )) : <tr><td className="management-report-empty-row" colSpan={8}>No business units match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SummaryTab({ dashboard }: { dashboard: ManagementReportDashboard }) {
  const [selectedPeriod, setSelectedPeriod] = useUrlState<SummaryPeriod>("managementPeriod", "ytd", {
    isValid: (value) => value === "ytd" || /^\d{4}-\d{2}-\d{2}$/.test(value)
  });
  const selectedPoint = selectedPeriod === "ytd" ? undefined : dashboard.trend.find((point) => point.period === selectedPeriod);
  const effectivePeriod = selectedPeriod === "ytd" || selectedPoint ? selectedPeriod : "ytd";
  const actual: PeriodActual = effectivePeriod === "ytd"
    ? dashboard.consolidated.actual
    : {
        ...selectedPoint!,
        netMargin: selectedPoint!.revenue === 0 ? 0 : selectedPoint!.netProfit / selectedPoint!.revenue
      };
  const periodLabel = effectivePeriod === "ytd"
    ? `YTD through ${monthPeriodLabel(dashboard.metadata.asOf)}`
    : monthPeriodLabel(effectivePeriod);
  const kpis: ManagementReportKpi[] = effectivePeriod === "ytd" ? dashboard.kpis : [
    { id: "period-revenue", label: "Revenue", value: actual.revenue, unit: "currency", currency: "USD", tone: "neutral", detail: periodLabel },
    { id: "period-marketing", label: "Marketing spend", value: actual.marketingSpend, unit: "currency", currency: "USD", tone: "neutral", detail: periodLabel },
    { id: "period-operating", label: "Operating spend", value: actual.operatingSpend, unit: "currency", currency: "USD", tone: "neutral", detail: periodLabel },
    { id: "period-gross-profit", label: "Gross profit", value: actual.grossProfit, unit: "currency", currency: "USD", tone: actual.grossProfit >= 0 ? "positive" : "negative", detail: periodLabel },
    { id: "period-net-profit", label: "Net profit", value: actual.netProfit, unit: "currency", currency: "USD", tone: actual.netProfit >= 0 ? "positive" : "negative", detail: periodLabel },
    { id: "period-net-margin", label: "Net margin", value: actual.netMargin, unit: "percent", tone: actual.netMargin >= 0 ? "positive" : "negative", detail: periodLabel }
  ];

  useEffect(() => {
    if (selectedPeriod !== effectivePeriod) setSelectedPeriod(effectivePeriod);
  }, [effectivePeriod, selectedPeriod, setSelectedPeriod]);

  return (
    <div className="management-report-tab-panel">
      <section className="management-report-panel">
        <div className="management-report-toolbar management-report-period-toolbar">
          <div className="management-report-panel-heading"><h3>Reporting period</h3></div>
          <label className="management-report-field">Period<NativeSelect value={effectivePeriod} onValueChange={setSelectedPeriod}><NativeSelectOption value="ytd">{yearToDateOptionLabel(dashboard.metadata.asOf)}</NativeSelectOption>{[...dashboard.trend].reverse().map((point) => <NativeSelectOption key={point.period} value={point.period}>{monthPeriodOptionLabel(point.period)}</NativeSelectOption>)}</NativeSelect></label>
        </div>
      </section>
      <KpiGrid kpis={kpis} />
      {dashboard.bank.postCloseEntryCount > 0 && (
        <div className="management-report-summary-note warning"><TriangleAlert size={16} aria-hidden="true" /><span><strong>{wholeNumber.format(dashboard.bank.postCloseEntryCount)} post-close bank entries</strong> are shown in Ledger for visibility but excluded from the official reporting period through {dateLabel(dashboard.bank.officialThrough)}.</span></div>
      )}
      <div className="management-report-two-column"><TrendPanel selectedPeriod={effectivePeriod} trend={dashboard.trend} /><div className="management-report-summary-side"><SummaryComposition actual={actual} periodLabel={periodLabel} /><PlatformSpendDonut dashboard={dashboard} selectedPeriod={effectivePeriod} /></div></div>
      <BusinessUnitTable selectedPeriod={effectivePeriod} units={dashboard.businessUnits} />
    </div>
  );
}

function teamKpis(team: ManagementReportBusinessUnit): ManagementReportKpi[] {
  return [
    { id: `${team.id}-revenue`, label: "Revenue", value: team.actual.revenue, unit: "currency", currency: "USD", tone: "neutral", detail: team.latestPeriodLabel },
    { id: `${team.id}-marketing`, label: "Marketing spend", value: team.actual.marketingSpend, unit: "currency", currency: "USD", tone: "neutral", detail: team.latestPeriodLabel },
    { id: `${team.id}-profit`, label: "Net profit", value: team.actual.netProfit, unit: "currency", currency: "USD", tone: team.actual.netProfit >= 0 ? "positive" : "negative", detail: team.latestPeriodLabel },
    { id: `${team.id}-margin`, label: "Net margin", value: team.actual.netMargin, unit: "percent", tone: team.actual.netMargin >= 0 ? "positive" : "negative", detail: "Net profit divided by revenue" }
  ];
}

function TeamPerformance({ teams }: { teams: ManagementReportBusinessUnit[] }) {
  const [selectedId, setSelectedId] = useUrlState("managementTeam", teams[0]?.id ?? "");
  const [monthSortKey, setMonthSortKey] = useUrlState<TrendSortKey>("managementTeamMonthSort", "month", {
    allowedValues: ["grossProfit", "marketingSpend", "month", "netProfit", "operatingSpend", "revenue"]
  });
  const [monthSortDirection, setMonthSortDirection] = useUrlState<TableSortDirection>("managementTeamMonthOrder", "asc", {
    allowedValues: ["asc", "desc"]
  });
  const selected = teams.find((team) => team.id === selectedId) ?? teams[0];
  const visibleMonths = useMemo(() => {
    if (!selected) return [];
    return selected.monthly
      .filter((month) => month.period <= selected.latestPeriod)
      .sort((left, right) => {
        const value = (month: (typeof selected.monthly)[number]): number | string => monthSortKey === "month" ? month.period : month[monthSortKey];
        return compareTableValues(value(left), value(right), monthSortDirection) || left.period.localeCompare(right.period);
      });
  }, [monthSortDirection, monthSortKey, selected]);

  useEffect(() => {
    if (teams.length > 0 && !teams.some((team) => team.id === selectedId)) {
      setSelectedId(teams[0].id);
    }
  }, [selectedId, setSelectedId, teams]);

  function requestMonthSort(nextSortKey: TrendSortKey) {
    if (nextSortKey === monthSortKey) {
      setMonthSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setMonthSortKey(nextSortKey);
    setMonthSortDirection(nextSortKey === "month" ? "asc" : "desc");
  }

  if (!selected) return <div className="management-report-state"><div className="management-report-state-content"><p>No team performance was parsed.</p></div></div>;

  return (
    <div className="management-report-tab-panel">
      <section className="management-report-panel">
        <PanelHeader
          title={`${selected.name} P&L`}
          detail={`${selected.reportLabel} · ${selected.latestPeriodLabel}`}
          trailing={
            <label className="management-report-field">Team
              <NativeSelect value={selected.id} onValueChange={setSelectedId}>
                {teams.map((team) => <NativeSelectOption key={team.id} value={team.id}>{team.name}{team.active ? "" : " · inactive"}</NativeSelectOption>)}
              </NativeSelect>
            </label>
          }
        />
        <div className="management-report-panel-body"><KpiGrid kpis={teamKpis(selected)} /></div>
        <div className="management-report-table-wrap">
          <table className="management-report-table">
            <caption>{selected.name} actual and budget comparison</caption>
            <thead><tr><th scope="col">Measure</th><th className="amount" scope="col">Actual</th><th className="amount" scope="col">Budget</th><th className="amount" scope="col">Revised budget</th></tr></thead>
            <tbody>
              <tr><td>Revenue</td><td className="amount">{money(selected.summary.revenue)}</td><td className="amount">{selected.summary.budgetRevenue === undefined ? "—" : money(selected.summary.budgetRevenue)}</td><td className="amount">{selected.summary.revisedBudgetRevenue === undefined ? "—" : money(selected.summary.revisedBudgetRevenue)}</td></tr>
              <tr><td>Net profit</td><td className={`amount ${valueTone(selected.summary.netProfit)}`}>{money(selected.summary.netProfit)}</td><td className="amount">{selected.summary.budgetNetProfit === undefined ? "—" : money(selected.summary.budgetNetProfit)}</td><td className="amount">{selected.summary.revisedBudgetNetProfit === undefined ? "—" : money(selected.summary.revisedBudgetNetProfit)}</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="management-report-panel" aria-labelledby="management-report-team-monthly-title">
        <div className="management-report-panel-header"><div className="management-report-panel-heading"><h3 id="management-report-team-monthly-title">Monthly P&amp;L</h3><p>Revenue, spend, and profit by workbook month.</p></div></div>
        <div className="management-report-table-wrap">
          <table className="management-report-table">
            <caption>{selected.name} monthly profit and loss</caption>
            <thead><tr>
              <SortableTableHead activeSortKey={monthSortKey} direction={monthSortDirection} onSort={requestMonthSort} sortKey="month">Month</SortableTableHead>
              <SortableTableHead activeSortKey={monthSortKey} className="amount" direction={monthSortDirection} onSort={requestMonthSort} sortKey="revenue">Revenue</SortableTableHead>
              <SortableTableHead activeSortKey={monthSortKey} className="amount" direction={monthSortDirection} onSort={requestMonthSort} sortKey="marketingSpend">Marketing</SortableTableHead>
              <SortableTableHead activeSortKey={monthSortKey} className="amount" direction={monthSortDirection} onSort={requestMonthSort} sortKey="operatingSpend">Operating</SortableTableHead>
              <SortableTableHead activeSortKey={monthSortKey} className="amount" direction={monthSortDirection} onSort={requestMonthSort} sortKey="grossProfit">Gross profit</SortableTableHead>
              <SortableTableHead activeSortKey={monthSortKey} className="amount" direction={monthSortDirection} onSort={requestMonthSort} sortKey="netProfit">Net profit</SortableTableHead>
            </tr></thead>
            <tbody>{visibleMonths.length > 0 ? visibleMonths.map((month) => <tr key={month.period}><td>{shortMonthPeriodLabel(month.period)}</td><td className="amount">{money(month.revenue)}</td><td className="amount">{money(month.marketingSpend)}</td><td className="amount">{money(month.operatingSpend)}</td><td className={`amount ${valueTone(month.grossProfit)}`}>{money(month.grossProfit)}</td><td className={`amount ${valueTone(month.netProfit)}`}>{money(month.netProfit)}</td></tr>) : <tr><td className="management-report-empty-row" colSpan={6}>No monthly P&amp;L rows are available for {selected.name}.</td></tr>}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function OfferPerformance({ dashboard }: { dashboard: ManagementReportDashboard }) {
  const reconciliation = dashboard.offerReconciliation;
  const kpis: ManagementReportKpi[] = [
    { id: "offer-redtrack", label: "RedTrack revenue", value: reconciliation.redtrackRevenue, unit: "currency", currency: "USD", tone: "neutral", detail: reconciliation.reportLabel },
    { id: "offer-dashboard", label: "Dashboard revenue", value: reconciliation.dashboardRevenue, unit: "currency", currency: "USD", tone: "neutral", detail: reconciliation.reportLabel },
    { id: "offer-variance", label: "Revenue variance", value: reconciliation.variance, unit: "currency", currency: "USD", tone: Math.abs(reconciliation.variance) < 1 ? "positive" : "warning", detail: "RedTrack minus dashboard" },
    { id: "offer-spend-variance", label: "Manager spend variance", value: reconciliation.managerSpendVariance, unit: "currency", currency: "USD", tone: Math.abs(reconciliation.managerSpendVariance) < 1 ? "positive" : "warning", detail: "Source minus dashboard" }
  ];
  const unitsById = new Map(dashboard.businessUnits.map((unit) => [unit.id, unit.name]));

  return (
    <div className="management-report-tab-panel">
      <KpiGrid kpis={kpis} />
      <section className="management-report-panel" aria-labelledby="management-report-offer-title">
        <div className="management-report-panel-header"><div className="management-report-panel-heading"><h3 id="management-report-offer-title">Offer revenue reconciliation</h3><p>RedTrack revenue compared with the management dashboard by offer.</p></div></div>
        <div className="management-report-table-wrap">
          <table className="management-report-table">
            <caption>Offer revenue reconciliation</caption>
            <thead><tr><th scope="col">Offer</th><th scope="col">Group</th><th scope="col">Business unit</th><th className="amount" scope="col">RedTrack</th><th className="amount" scope="col">Dashboard</th><th className="amount" scope="col">Variance</th></tr></thead>
            <tbody>{dashboard.offers.length > 0 ? dashboard.offers.map((offer) => <OfferRow key={`${offer.groupId}-${offer.offerId}`} offer={offer} businessUnitName={unitsById.get(offer.businessUnitId) ?? offer.businessUnitId} />) : <tr><td className="management-report-empty-row" colSpan={6}>No offer reconciliation rows were parsed.</td></tr>}</tbody>
            <tfoot><tr className="total-row"><td colSpan={3}>Total</td><td className="amount">{money(reconciliation.redtrackRevenue)}</td><td className="amount">{money(reconciliation.dashboardRevenue)}</td><td className={`amount ${valueTone(reconciliation.variance)}`}>{money(reconciliation.variance)}</td></tr></tfoot>
          </table>
        </div>
      </section>
    </div>
  );
}

function OfferRow({ offer, businessUnitName }: { offer: ManagementReportOfferReconciliationEntry; businessUnitName: string }) {
  return (
    <tr>
      <td className="wrap"><strong>{offer.offerName}</strong><small>{offer.redtrackSource ?? "RedTrack source not specified"}</small></td>
      <td>{offer.groupName}</td>
      <td>{businessUnitName}</td>
      <td className="amount">{money(offer.redtrackRevenue)}</td>
      <td className="amount">{money(offer.dashboardRevenue)}</td>
      <td className={`amount ${valueTone(offer.variance)}`}>{money(offer.variance)}</td>
    </tr>
  );
}

function PlatformPerformance({ platforms }: { platforms: ManagementReportPlatformPerformance[] }) {
  return (
    <section className="management-report-panel" aria-labelledby="management-report-platform-title">
      <div className="management-report-panel-header"><div className="management-report-panel-heading"><h3 id="management-report-platform-title">Platform profitability</h3><p>Revenue, spend, profit, leads, and CPL from the PLP workbook tab.</p></div></div>
      <div className="management-report-table-wrap">
        <table className="management-report-table">
          <caption>Platform profitability</caption>
          <thead><tr><th scope="col">Period</th><th scope="col">Platform</th><th className="amount" scope="col">Revenue</th><th className="amount" scope="col">Spend</th><th className="amount" scope="col">Profit</th><th className="amount" scope="col">Margin</th><th className="amount" scope="col">Leads</th><th className="amount" scope="col">CPL</th></tr></thead>
          <tbody>{platforms.length > 0 ? platforms.map((row) => <tr className={row.isTotal ? "total-row" : ""} key={row.platformMetricId}><td>{row.periodLabel}</td><td>{row.platform}</td><td className="amount">{money(row.revenue)}</td><td className="amount">{money(row.spend)}</td><td className={`amount ${valueTone(row.profit)}`}>{money(row.profit)}</td><td className={`amount ${valueTone(row.profitMargin)}`}>{percent(row.profitMargin)}</td><td className="amount">{wholeNumber.format(row.leads)}</td><td className="amount">{money(row.cpl, "USD", 2)}</td></tr>) : <tr><td className="management-report-empty-row" colSpan={8}>No platform profitability rows were parsed.</td></tr>}</tbody>
        </table>
      </div>
    </section>
  );
}

function PerformanceTab({ dashboard }: { dashboard: ManagementReportDashboard }) {
  const [dimension, setDimension] = useUrlState<PerformanceDimension>("managementDimension", "team", {
    allowedValues: ["team", "offer", "platform"]
  });
  const teams = dashboard.businessUnits.filter((unit) => unit.kind === "team");

  return (
    <div className="management-report-tab-panel">
      <section className="management-report-panel">
        <div className="management-report-toolbar">
          <div className="management-report-panel-heading"><h3>Performance dimension</h3><p>Teams, offers, and platforms remain separate reporting concepts.</p></div>
          <div className="management-report-dimension-switch" aria-label="Performance dimension">
            {(["team", "offer", "platform"] as const).map((value) => <button key={value} type="button" aria-pressed={dimension === value} onClick={() => setDimension(value)}>{value === "team" ? "Team" : value === "offer" ? "Offer" : "Platform"}</button>)}
          </div>
        </div>
      </section>
      {dimension === "team" && <TeamPerformance teams={teams} />}
      {dimension === "offer" && <OfferPerformance dashboard={dashboard} />}
      {dimension === "platform" && <PlatformPerformance platforms={dashboard.platforms} />}
    </div>
  );
}

function BankAggregateTable({ aggregates }: { aggregates: ManagementReportBankAggregate[] }) {
  return (
    <section className="management-report-panel" aria-labelledby="management-report-bank-aggregate-title">
      <div className="management-report-panel-header"><div className="management-report-panel-heading"><h3 id="management-report-bank-aggregate-title">Bank source aggregates</h3><p>Official and post-close entries summarized by sanitized bank source.</p></div></div>
      <div className="management-report-table-wrap">
        <table className="management-report-table">
          <caption>Bank source aggregates</caption>
          <thead><tr><th scope="col">Bank source</th><th className="amount" scope="col">Entries</th><th className="amount" scope="col">Income</th><th className="amount" scope="col">Expense</th><th className="amount" scope="col">Net</th><th className="amount" scope="col">Post-close</th><th className="amount" scope="col">Unconverted</th></tr></thead>
          <tbody>{aggregates.length > 0 ? aggregates.map((aggregate) => <tr key={aggregate.id}><td>{aggregate.label}</td><td className="amount">{wholeNumber.format(aggregate.entryCount)}</td><td className="amount management-report-positive">{money(aggregate.incomeUsd)}</td><td className="amount management-report-negative">{money(aggregate.expenseUsd)}</td><td className={`amount ${valueTone(aggregate.netUsd)}`}>{money(aggregate.netUsd)}</td><td className="amount">{wholeNumber.format(aggregate.postCloseCount)}</td><td className={`amount ${aggregate.unconvertedCount > 0 ? "management-report-negative" : "management-report-muted"}`}>{wholeNumber.format(aggregate.unconvertedCount)}</td></tr>) : <tr><td className="management-report-empty-row" colSpan={7}>No bank aggregates were parsed.</td></tr>}</tbody>
        </table>
      </div>
    </section>
  );
}

function LedgerTab({ dashboard }: { dashboard: ManagementReportDashboard }) {
  const [query, setQuery] = useUrlState("managementLedgerQuery", "");
  const [team, setTeam] = useUrlState("managementLedgerTeam", "all");
  const [bank, setBank] = useUrlState("managementLedgerBank", "all");
  const [sortKey, setSortKey] = useUrlState<LedgerSortKey>("managementLedgerSort", "date", {
    allowedValues: ["bank", "company", "date", "nativeAmount", "nature", "period", "team", "usdAmount"]
  });
  const [sortDirection, setSortDirection] = useUrlState<TableSortDirection>("managementLedgerOrder", "desc", {
    allowedValues: ["asc", "desc"]
  });
  const teamOptions = useMemo(() => [...new Set(dashboard.bank.recentEntries.map((entry) => entry.segment))].filter(Boolean).sort(), [dashboard.bank.recentEntries]);
  const bankOptions = useMemo(() => [...new Set(dashboard.bank.recentEntries.map((entry) => entry.bankName))].filter(Boolean).sort(), [dashboard.bank.recentEntries]);
  const visibleEntries = useMemo(() => {
    function sortValue(entry: ManagementReportRecentBankEntry): boolean | number | string | undefined {
      if (sortKey === "bank") return entry.bankName;
      if (sortKey === "company") return entry.companyName;
      if (sortKey === "date") return entry.date;
      if (sortKey === "nativeAmount") return entry.amountIncludingVat;
      if (sortKey === "nature") return entry.nature;
      if (sortKey === "period") return entry.isPostClose;
      if (sortKey === "team") return entry.segment;
      return entry.hasUsdAmount ? entry.amountUsd : undefined;
    }

    const normalizedQuery = query.trim().toLowerCase();
    return dashboard.bank.recentEntries
      .filter((entry) => {
        if (team !== "all" && entry.segment !== team) return false;
        if (bank !== "all" && entry.bankName !== bank) return false;
        if (!normalizedQuery) return true;
        return `${entry.companyName} ${entry.bankName} ${entry.segment} ${entry.nature} ${entry.accountType} ${entry.currency}`.toLowerCase().includes(normalizedQuery);
      })
      .sort((left, right) =>
        compareTableValues(sortValue(left), sortValue(right), sortDirection)
        || compareTableValues(left.date, right.date, "desc")
        || left.entryId.localeCompare(right.entryId)
      );
  }, [bank, dashboard.bank.recentEntries, query, sortDirection, sortKey, team]);

  function requestSort(nextSortKey: LedgerSortKey) {
    if (nextSortKey === sortKey) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(nextSortKey);
    setSortDirection("asc");
  }
  const bankAggregates = dashboard.bank.aggregates.filter((aggregate) => aggregate.dimension === "bank");
  const kpis: ManagementReportKpi[] = [
    { id: "bank-income", label: "Bank income", value: dashboard.summary.bankIncome, unit: "currency", currency: "USD", tone: "positive", detail: `Official through ${dateLabel(dashboard.bank.officialThrough)}` },
    { id: "bank-expense", label: "Bank expense", value: dashboard.summary.bankExpense, unit: "currency", currency: "USD", tone: "neutral", detail: `Official through ${dateLabel(dashboard.bank.officialThrough)}` },
    { id: "bank-net", label: "Bank net", value: dashboard.summary.bankNet, unit: "currency", currency: "USD", tone: dashboard.summary.bankNet >= 0 ? "positive" : "negative", detail: "Income less expense" },
    { id: "bank-post-close", label: "Post-close entries", value: dashboard.bank.postCloseEntryCount, unit: "count", tone: dashboard.bank.postCloseEntryCount > 0 ? "warning" : "positive", detail: "Visible below; excluded from official period" }
  ];

  return (
    <div className="management-report-tab-panel">
      <KpiGrid kpis={kpis} />
      {dashboard.bank.unconvertedEntryCount > 0 && <div className="management-report-summary-note warning"><TriangleAlert size={16} aria-hidden="true" /><span><strong>{wholeNumber.format(dashboard.bank.unconvertedEntryCount)} entries have no USD conversion.</strong> Native amounts remain visible and are excluded from USD totals.</span></div>}
      <BankAggregateTable aggregates={bankAggregates} />
      <section className="management-report-panel" aria-labelledby="management-report-ledger-title">
        <div className="management-report-panel-header"><div className="management-report-panel-heading"><h3 id="management-report-ledger-title">Recent ledger entries</h3><p>Sanitized business fields only. Account, card, user, and full reference identifiers remain backend-only.</p></div><span className="management-report-source-badge">{visibleEntries.length} of {dashboard.bank.recentEntries.length}</span></div>
        <div className="management-report-filter-grid">
          <label className="management-report-field">Search
            <span className="management-report-search"><Search size={14} aria-hidden="true" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Company, team, nature" /></span>
          </label>
          <label className="management-report-field">Team / segment
            <NativeSelect value={team} onValueChange={setTeam}><NativeSelectOption value="all">All teams</NativeSelectOption>{teamOptions.map((option) => <NativeSelectOption key={option} value={option}>{option}</NativeSelectOption>)}</NativeSelect>
          </label>
          <label className="management-report-field">Bank source
            <NativeSelect value={bank} onValueChange={setBank}><NativeSelectOption value="all">All banks</NativeSelectOption>{bankOptions.map((option) => <NativeSelectOption key={option} value={option}>{option}</NativeSelectOption>)}</NativeSelect>
          </label>
        </div>
        <div className="management-report-table-wrap">
          <table className="management-report-table">
            <caption>Sanitized recent consolidated bank entries</caption>
            <thead><tr>
              <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="date">Date</SortableTableHead>
              <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="company">Company</SortableTableHead>
              <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="bank">Bank source</SortableTableHead>
              <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="team">Team / segment</SortableTableHead>
              <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="nature">Nature</SortableTableHead>
              <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={requestSort} sortKey="nativeAmount">Native amount</SortableTableHead>
              <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={requestSort} sortKey="usdAmount">USD amount</SortableTableHead>
              <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="period">Period</SortableTableHead>
            </tr></thead>
            <tbody>{visibleEntries.length > 0 ? visibleEntries.map((entry) => <tr key={entry.entryId}><td>{dateLabel(entry.date)}</td><td>{entry.companyName}</td><td>{entry.bankName}</td><td>{entry.segment}</td><td className="wrap"><strong>{entry.nature}</strong><small>{entry.accountType}</small></td><td className={`amount ${bankEntryTone(entry)}`}>{money(entry.amountIncludingVat, entry.currency, 2)}</td><td className={`amount ${bankEntryTone(entry)}`}>{entry.hasUsdAmount ? money(entry.amountUsd, "USD", 2) : "—"}</td><td>{entry.isPostClose ? <span className="management-report-entity-status inactive"><Clock3 size={11} aria-hidden="true" />Post-close</span> : <span className="management-report-entity-status"><CheckCircle2 size={11} aria-hidden="true" />Official</span>}</td></tr>) : <tr><td className="management-report-empty-row" colSpan={8}>No sanitized ledger entries match these filters.</td></tr>}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function OwnershipTab({ dashboard }: { dashboard: ManagementReportDashboard }) {
  const ownership = dashboard.ownership;
  const shareholderKeys = [...new Set([
    ...ownership.balances.map((balance) => balance.canonicalName),
    ...ownership.profitAllocations.flatMap((allocation) => Object.keys(allocation.byShareholder))
  ])];
  const namesByKey = new Map(ownership.balances.map((balance) => [balance.canonicalName, balance.name]));
  const kpis: ManagementReportKpi[] = [
    { id: "ownership-partner", label: "Partner balance", value: ownership.totalPartnerBalance, unit: "currency", currency: "USD", tone: "neutral", detail: ownership.reportLabel },
    { id: "ownership-equity", label: "Total equity", value: ownership.totalEquityBalance, unit: "currency", currency: "USD", tone: "neutral", detail: ownership.reportLabel },
    { id: "ownership-assets", label: "Assets & liabilities", value: ownership.totalAssetsAndLiabilities, unit: "currency", currency: "USD", tone: "neutral", detail: ownership.reportLabel },
    { id: "ownership-difference", label: "Balance difference", value: ownership.totalAssetsAndLiabilities - ownership.totalEquityBalance, unit: "currency", currency: "USD", tone: Math.abs(ownership.totalAssetsAndLiabilities - ownership.totalEquityBalance) < 1 ? "positive" : "warning", detail: "Assets and liabilities less equity" }
  ];

  return (
    <div className="management-report-tab-panel">
      <KpiGrid kpis={kpis} />
      <div className="management-report-ownership-note"><Info size={16} aria-hidden="true" /><span>This is the period-end ownership snapshot imported from the management workbook. Use <strong>Distribution</strong> for live profit-distribution calculations, adjustments, and payment workflow; this view does not change those records.</span></div>
      <div className="management-report-ownership-sections">
        <section className="management-report-panel" aria-labelledby="management-report-balances-title">
          <div className="management-report-panel-header"><div className="management-report-panel-heading"><h3 id="management-report-balances-title">Shareholder balances</h3><p>Partner balances, profit balances, and withdrawals.</p></div></div>
          <div className="management-report-table-wrap">
            <table className="management-report-table">
              <caption>Shareholder balances</caption>
              <thead><tr><th scope="col">Shareholder</th><th className="amount" scope="col">Balance</th><th className="amount" scope="col">Profit balance</th><th className="amount" scope="col">Withdrawals</th></tr></thead>
              <tbody>{ownership.balances.length > 0 ? ownership.balances.map((balance) => <tr key={balance.id}><td>{balance.name}</td><td className="amount">{money(balance.balance, balance.currency)}</td><td className="amount">{balance.profitBalance === undefined ? "—" : money(balance.profitBalance, balance.currency)}</td><td className="amount">{balance.profitWithdrawals === undefined ? "—" : money(balance.profitWithdrawals, balance.currency)}</td></tr>) : <tr><td className="management-report-empty-row" colSpan={4}>No shareholder balances were parsed.</td></tr>}</tbody>
              <tfoot><tr className="total-row"><td>Total partner balance</td><td className="amount">{money(ownership.totalPartnerBalance)}</td><td colSpan={2} /></tr></tfoot>
            </table>
          </div>
        </section>

        <section className="management-report-panel" aria-labelledby="management-report-assets-title">
          <div className="management-report-panel-header"><div className="management-report-panel-heading"><h3 id="management-report-assets-title">Assets and liabilities</h3><p>Workbook balance-sheet lines and totals.</p></div></div>
          <div className="management-report-table-wrap">
            <table className="management-report-table">
              <caption>Assets, liabilities, and equity lines</caption>
              <thead><tr><th scope="col">Section</th><th scope="col">Line</th><th className="amount" scope="col">Amount</th><th className="amount" scope="col">Secondary</th></tr></thead>
              <tbody>{ownership.assetsLiabilities.length > 0 ? ownership.assetsLiabilities.map((line) => <tr className={line.isTotal ? "total-row" : ""} key={line.lineId}><td>{line.section === "equity" ? "Equity" : "Assets & liabilities"}</td><td className="wrap">{line.label}</td><td className="amount">{line.amount === undefined ? "—" : money(line.amount)}</td><td className="amount">{line.secondaryAmount === undefined ? "—" : money(line.secondaryAmount)}</td></tr>) : <tr><td className="management-report-empty-row" colSpan={4}>No asset or liability lines were parsed.</td></tr>}</tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="management-report-panel" aria-labelledby="management-report-allocations-title">
        <div className="management-report-panel-header"><div className="management-report-panel-heading"><h3 id="management-report-allocations-title">Profit allocations</h3><p>Imported allocation rows by shareholder; informational only.</p></div></div>
        <div className="management-report-table-wrap">
          <table className="management-report-table">
            <caption>Profit allocations by shareholder</caption>
            <thead><tr><th scope="col">Allocation</th><th className="amount" scope="col">Total</th>{shareholderKeys.map((key) => <th className="amount" scope="col" key={key}>{namesByKey.get(key) ?? key}</th>)}</tr></thead>
            <tbody>{ownership.profitAllocations.length > 0 ? ownership.profitAllocations.map((allocation) => <tr key={allocation.allocationId}><td className="wrap">{allocation.label}</td><td className={`amount ${valueTone(allocation.total)}`}>{money(allocation.total)}</td>{shareholderKeys.map((key) => <td className="amount" key={key}>{money(allocation.byShareholder[key] ?? 0)}</td>)}</tr>) : <tr><td className="management-report-empty-row" colSpan={2 + shareholderKeys.length}>No profit allocation rows were parsed.</td></tr>}</tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function ManagementReportView({ apiBase }: ManagementReportViewProps) {
  const [section, setSection] = useUrlState<ManagementReportSection>("managementSection", "summary", {
    allowedValues: ["summary", "performance", "ledger", "ownership"],
    history: "push"
  });
  const [dashboard, setDashboard] = useState<ManagementReportDashboard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const response = await fetch(`${apiBase}/management-report`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Management report request failed (${response.status})`);
        const payload: unknown = await response.json();
        if (!active) return;
        if (payload === null) {
          setDashboard(null);
          return;
        }
        if (typeof payload !== "object" || !("dashboard" in payload)) throw new Error("Management report response is invalid");
        setDashboard((payload as ManagementReportApiResponse).dashboard);
      } catch (caught) {
        if (!active || (caught instanceof DOMException && caught.name === "AbortError")) return;
        setError(caught instanceof Error ? caught.message : "Management report could not be loaded");
        setDashboard(null);
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [apiBase, requestVersion]);

  if (isLoading) {
    return (
      <section className="management-report-state" aria-live="polite" aria-busy="true" role="status">
        <div className="management-report-state-content"><span className="management-report-state-icon"><Loader2 className="management-report-loader" size={22} aria-hidden="true" /></span><h2>Loading management report</h2><p>Reading the latest imported workbook snapshot.</p></div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="management-report-state error" role="alert">
        <div className="management-report-state-content"><span className="management-report-state-icon"><AlertCircle size={22} aria-hidden="true" /></span><h2>Management report unavailable</h2><p>{error}</p><Button type="button" variant="outline" onClick={() => setRequestVersion((version) => version + 1)}><RefreshCw size={15} aria-hidden="true" /> Try again</Button></div>
      </section>
    );
  }

  if (!dashboard) {
    return (
      <section className="management-report-state">
        <div className="management-report-state-content"><span className="management-report-state-icon"><FileSpreadsheet size={22} aria-hidden="true" /></span><h2>No management report imported</h2><p>Upload the management workbook through the import process to create the first reporting snapshot.</p></div>
      </section>
    );
  }

  return (
    <section className="management-report-view" aria-label="Management report">
      <ManagementReportDetailsDrawer dashboard={dashboard} />
      <header className="management-report-page-header">
        <div>
          <p className="eyebrow">Manual workbook</p>
          <h2>Management report</h2>
        </div>
        <label className="management-report-field management-report-view-field">View
          <NativeSelect value={section} onValueChange={(value) => setSection(value as ManagementReportSection)}>
            <NativeSelectOption value="summary">Summary</NativeSelectOption>
            <NativeSelectOption value="performance">Performance</NativeSelectOption>
            <NativeSelectOption value="ledger">Ledger</NativeSelectOption>
            <NativeSelectOption value="ownership">Ownership</NativeSelectOption>
          </NativeSelect>
        </label>
      </header>
      <div className="management-report-content">
        {section === "summary" && <SummaryTab dashboard={dashboard} />}
        {section === "performance" && <PerformanceTab dashboard={dashboard} />}
        {section === "ledger" && <LedgerTab dashboard={dashboard} />}
        {section === "ownership" && <OwnershipTab dashboard={dashboard} />}
      </div>
    </section>
  );
}
