import {
  BadgeDollarSign,
  BriefcaseBusiness,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Database,
  Loader2,
  RefreshCw,
  Rows3,
  WalletCards
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CalendarPeriodPicker,
  calendarDateRangeLabel,
  type CalendarDateRange
} from "@/components/ui/calendar-period-picker";
import { ToolbarSearchField } from "@/components/ui/filter-toolbar";
import { InfoPopover } from "@/components/ui/finance-visuals";
import {
  compareTableValues,
  SortableTableHead,
  type TableSortDirection
} from "@/components/ui/sortable-table-head";
import { useUrlDateRangeState, useUrlState } from "@/lib/url-state";
import type { MediaSpendApiResponse, MediaSpendRow } from "../../../shared/mediaSpend";
import { financeOperatingDate, shiftFinanceOperatingDate } from "../../../shared/operatingDate";

type MediaSpendSortKey = "account" | "businessManager" | "date" | "platform" | "spend" | "workspace";

const mediaSpendSortKeys: readonly MediaSpendSortKey[] = [
  "account",
  "businessManager",
  "date",
  "platform",
  "spend",
  "workspace"
];
const mediaSpendPageSize = 200;

function defaultMediaSpendRange(): CalendarDateRange {
  const toDate = shiftFinanceOperatingDate(financeOperatingDate(), -1);
  return { fromDate: shiftFinanceOperatingDate(toDate, -29), toDate };
}

function money(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(`${value}T00:00:00`));
}

function dateTimeLabel(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function spendSortValue(row: MediaSpendRow, sortKey: MediaSpendSortKey): number | string {
  if (sortKey === "account") return row.accountName;
  if (sortKey === "businessManager") return row.businessManagerName;
  if (sortKey === "date") return row.date;
  if (sortKey === "platform") return row.platform;
  if (sortKey === "spend") return row.spend;
  return row.workspace;
}

async function apiErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  return body?.message || fallback;
}

function mediaSpendPreset(value: string): CalendarDateRange {
  const yesterday = shiftFinanceOperatingDate(financeOperatingDate(), -1);
  if (value === "yesterday") return { fromDate: yesterday, toDate: yesterday };
  if (value === "last-7-days") {
    return { fromDate: shiftFinanceOperatingDate(yesterday, -6), toDate: yesterday };
  }
  if (value === "month-to-date") {
    return { fromDate: `${yesterday.slice(0, 7)}-01`, toDate: yesterday };
  }
  return { fromDate: shiftFinanceOperatingDate(yesterday, -29), toDate: yesterday };
}

export function MediaSpendView({ apiBase }: { apiBase: string }) {
  const defaultRange = useMemo(defaultMediaSpendRange, []);
  const [dateRange, setDateRange] = useUrlDateRangeState("mediaFrom", "mediaTo", defaultRange);
  const [sortKey, setSortKey] = useUrlState<MediaSpendSortKey>("mediaSort", "date", {
    allowedValues: mediaSpendSortKeys
  });
  const [sortDirection, setSortDirection] = useUrlState<TableSortDirection>("mediaOrder", "desc", {
    allowedValues: ["asc", "desc"]
  });
  const [data, setData] = useState<MediaSpendApiResponse | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadData(signal?: AbortSignal): Promise<void> {
    const query = new URLSearchParams(dateRange);
    const response = await fetch(`${apiBase}/media-spend?${query.toString()}`, { signal });
    if (!response.ok) throw new Error(await apiErrorMessage(response, "Media spend could not be loaded"));
    setData((await response.json()) as MediaSpendApiResponse);
  }

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    void loadData(controller.signal)
      .catch((loadError: unknown) => {
        if (loadError instanceof DOMException && loadError.name === "AbortError") return;
        setError(loadError instanceof Error ? loadError.message : "Media spend could not be loaded");
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [dateRange.fromDate, dateRange.toDate]);

  const visibleRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const filtered = normalizedSearch
      ? (data?.rows ?? []).filter((row) => [
          row.accountId,
          row.accountName,
          row.businessManagerId,
          row.businessManagerName,
          row.platform,
          String(row.workspace)
        ].some((value) => value.toLowerCase().includes(normalizedSearch)))
      : [...(data?.rows ?? [])];
    return filtered.sort((left, right) =>
      compareTableValues(spendSortValue(left, sortKey), spendSortValue(right, sortKey), sortDirection)
      || left.key.localeCompare(right.key)
    );
  }, [data?.rows, search, sortDirection, sortKey]);
  const pageCount = Math.max(1, Math.ceil(visibleRows.length / mediaSpendPageSize));
  const pageRows = visibleRows.slice(page * mediaSpendPageSize, (page + 1) * mediaSpendPageSize);

  useEffect(() => {
    setPage(0);
  }, [dateRange.fromDate, dateRange.toDate, search, sortDirection, sortKey]);

  useEffect(() => {
    if (page >= pageCount) setPage(pageCount - 1);
  }, [page, pageCount]);

  function requestSort(nextSortKey: MediaSpendSortKey): void {
    if (nextSortKey === sortKey) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(nextSortKey);
    setSortDirection(nextSortKey === "date" || nextSortKey === "spend" ? "desc" : "asc");
  }

  async function syncYesterday(): Promise<void> {
    const yesterday = shiftFinanceOperatingDate(financeOperatingDate(), -1);
    setIsSyncing(true);
    setError(null);
    try {
      const response = await fetch(`${apiBase}/media-spend/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromDate: yesterday, toDate: yesterday })
      });
      if (!response.ok) throw new Error(await apiErrorMessage(response, "Media spend sync failed"));
      await loadData();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Media spend sync failed");
    } finally {
      setIsSyncing(false);
    }
  }

  const sync = data?.sync;
  const statusTone = !data?.configured || sync?.status === "failed"
    ? "danger"
    : sync?.status === "healthy"
      ? "good"
      : "warning";
  const statusLabel = !data?.configured
    ? "Not configured"
    : sync?.status === "healthy"
      ? "Current"
      : sync?.status === "failed"
        ? "Sync failed"
        : sync?.status === "running"
          ? "Syncing"
          : "Awaiting first sync";

  return (
    <section className="media-spend-page">
      <header className="media-spend-page-header">
        <div>
          <div className="media-spend-eyebrow">
            <span>Operations</span>
            <Badge variant="outline">Provisional</Badge>
            <Badge variant="outline">Separate ledger</Badge>
          </div>
          <div className="media-spend-title-row">
            <h2>Actual media spend</h2>
            <InfoPopover label="actual media spend">
              <span>Daily ad delivery reported by LemonMax. It is intentionally excluded from official cash spend, management reporting, profit, and cash-flow calculations.</span>
              <span>Provider funding and opening balances will be reconciled later after funding transactions can be identified reliably.</span>
            </InfoPopover>
          </div>
        </div>
        <div className="media-spend-header-actions">
          <CalendarPeriodPicker
            ariaLabel="Choose media spend period"
            dateRange={dateRange}
            disabled={isLoading || isSyncing}
            isLoading={isLoading}
            onApply={setDateRange}
            onSelectPreset={(value) => setDateRange(mediaSpendPreset(value))}
            presetAriaLabel="Media spend period preset"
            presetOptions={[
              { value: "yesterday", label: "Yesterday" },
              { value: "last-7-days", label: "Last 7 days" },
              { value: "last-30-days", label: "Last 30 days" },
              { value: "month-to-date", label: "Month to date" }
            ]}
            triggerLabel={calendarDateRangeLabel(dateRange)}
          />
          <Button
            className="secondary-button"
            disabled={isLoading || isSyncing || !data?.configured}
            onClick={() => void syncYesterday()}
            type="button"
          >
            {isSyncing ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
            {isSyncing ? "Syncing" : "Sync yesterday"}
          </Button>
        </div>
      </header>

      {error && (
        <div className="income-callout warning media-spend-alert" role="alert">
          <CircleAlert size={17} />
          <span>{error}</span>
        </div>
      )}

      <div className="media-spend-summary" aria-label="Media spend summary">
        <article className="media-spend-summary-card total">
          <span className="media-spend-summary-icon"><BadgeDollarSign size={17} /></span>
          <div><span>Reported spend</span><strong>{data ? money(data.summary.totalSpend, data.currency) : "—"}</strong></div>
        </article>
        <article className="media-spend-summary-card">
          <span className="media-spend-summary-icon"><WalletCards size={17} /></span>
          <div><span>Ad accounts</span><strong>{data?.summary.accounts ?? "—"}</strong></div>
        </article>
        <article className="media-spend-summary-card">
          <span className="media-spend-summary-icon"><BriefcaseBusiness size={17} /></span>
          <div><span>Business managers</span><strong>{data?.summary.businessManagers ?? "—"}</strong></div>
        </article>
        <article className="media-spend-summary-card">
          <span className="media-spend-summary-icon"><Rows3 size={17} /></span>
          <div><span>Reported days</span><strong>{data?.summary.days ?? "—"}</strong></div>
        </article>
      </div>

      <section className="panel media-spend-panel">
        <div className="media-spend-toolbar">
          <div className="media-spend-source-state">
            <span className={`status-pill ${statusTone}`}><Database size={12} />{statusLabel}</span>
            <span>
              {sync?.lastSuccessAt
                ? `Last synced ${dateTimeLabel(sync.lastSuccessAt)}${sync.coveredThrough ? ` · through ${dateLabel(sync.coveredThrough)}` : ""}`
                : "LemonMax account-level delivery"}
            </span>
          </div>
          <ToolbarSearchField
            ariaLabel="Search media spend"
            onChange={setSearch}
            placeholder="Search BM, account, platform"
            value={search}
          />
        </div>

        {isLoading && !data ? (
          <div className="media-spend-loading"><Loader2 className="spin" size={22} /><span>Loading media spend</span></div>
        ) : visibleRows.length === 0 ? (
          <div className="empty-state">
            <Database size={22} />
            <strong>{search ? "No matching accounts" : "No media spend in this period"}</strong>
          </div>
        ) : (
          <div className="table-wrap media-spend-table-wrap">
            <table className="data-table dense media-spend-table">
              <thead>
                <tr>
                  <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="date">Date</SortableTableHead>
                  <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="platform">Platform</SortableTableHead>
                  <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="workspace">Workspace</SortableTableHead>
                  <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="businessManager">Business manager</SortableTableHead>
                  <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="account">Ad account</SortableTableHead>
                  <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={requestSort} sortKey="spend">Spend</SortableTableHead>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => (
                  <tr key={row.key}>
                    <td>{dateLabel(row.date)}</td>
                    <td><span className="source-pill media-spend-platform">{row.platform}</span></td>
                    <td>{row.workspace}</td>
                    <td><strong>{row.businessManagerName}</strong><small>{row.businessManagerId}</small></td>
                    <td><strong>{row.accountName}</strong><small>{row.accountId}</small></td>
                    <td className="amount media-spend-amount">{money(row.spend, row.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <footer className="media-spend-table-footer">
          <span>{visibleRows.length.toLocaleString()} of {(data?.rows.length ?? 0).toLocaleString()} account-day rows · {data?.summary.platforms ?? 0} platform{data?.summary.platforms === 1 ? "" : "s"}</span>
          <div className="media-spend-pagination">
            <span>Page {page + 1} of {pageCount}</span>
            <Button className="icon-button" aria-label="Previous media spend page" disabled={page === 0} onClick={() => setPage((current) => current - 1)} type="button">
              <ChevronLeft size={15} />
            </Button>
            <Button className="icon-button" aria-label="Next media spend page" disabled={page + 1 >= pageCount} onClick={() => setPage((current) => current + 1)} type="button">
              <ChevronRight size={15} />
            </Button>
          </div>
        </footer>
      </section>
    </section>
  );
}
