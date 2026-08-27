import {
  BadgeDollarSign,
  BriefcaseBusiness,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Database,
  Layers3,
  List,
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
import { ActiveFilterBar, ToolbarSearchField } from "@/components/ui/filter-toolbar";
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
type BusinessManagerSortKey = "accounts" | "businessManager" | "platform" | "spend" | "workspace";
type MediaSpendViewMode = "accounts" | "businessManagers";
type ZeroSpendVisibility = "hide" | "include";

type BusinessManagerSpendGroup = {
  accountCount: number;
  businessManagerId: string;
  businessManagerName?: string;
  currency: string;
  key: string;
  platform: string;
  searchText: string;
  spend: number;
  workspaces: number[];
};

const mediaSpendSortKeys: readonly MediaSpendSortKey[] = [
  "account",
  "businessManager",
  "date",
  "platform",
  "spend",
  "workspace"
];
const businessManagerSortKeys: readonly BusinessManagerSortKey[] = [
  "accounts",
  "businessManager",
  "platform",
  "spend",
  "workspace"
];
const mediaSpendViewModes: readonly MediaSpendViewMode[] = ["accounts", "businessManagers"];
const mediaSpendPageSize = 200;

function defaultMediaSpendRange(): CalendarDateRange {
  const yesterday = shiftFinanceOperatingDate(financeOperatingDate(), -1);
  return { fromDate: yesterday, toDate: yesterday };
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

function spendSortValue(row: MediaSpendRow, sortKey: MediaSpendSortKey): number | string | undefined {
  if (sortKey === "account") return row.accountName;
  if (sortKey === "businessManager") return row.businessManagerName;
  if (sortKey === "date") return row.date;
  if (sortKey === "platform") return row.platform;
  if (sortKey === "spend") return row.spend;
  return row.workspace;
}

function businessManagerKey(row: Pick<MediaSpendRow, "businessManagerId" | "platform">): string {
  return `${encodeURIComponent(row.platform)}:${encodeURIComponent(row.businessManagerId)}`;
}

function groupBusinessManagers(rows: readonly MediaSpendRow[]): BusinessManagerSpendGroup[] {
  const groups = new Map<string, {
    accountIds: Set<string>;
    businessManagerId: string;
    businessManagerName?: string;
    currency: string;
    key: string;
    platform: string;
    searchTerms: Set<string>;
    spend: number;
    workspaces: Set<number>;
  }>();
  for (const row of rows) {
    const key = businessManagerKey(row);
    const existing = groups.get(key) ?? {
      accountIds: new Set<string>(),
      businessManagerId: row.businessManagerId,
      ...(row.businessManagerName ? { businessManagerName: row.businessManagerName } : {}),
      currency: row.currency,
      key,
      platform: row.platform,
      searchTerms: new Set<string>(),
      spend: 0,
      workspaces: new Set<number>()
    };
    if (!existing.businessManagerName && row.businessManagerName) {
      existing.businessManagerName = row.businessManagerName;
    }
    existing.accountIds.add(row.accountId);
    existing.searchTerms.add(row.accountId);
    if (row.accountName) existing.searchTerms.add(row.accountName);
    existing.searchTerms.add(row.businessManagerId);
    if (row.businessManagerName) existing.searchTerms.add(row.businessManagerName);
    existing.searchTerms.add(row.platform);
    existing.searchTerms.add(String(row.workspace));
    existing.spend += row.spend;
    existing.workspaces.add(row.workspace);
    groups.set(key, existing);
  }
  return [...groups.values()].map((group) => ({
    accountCount: group.accountIds.size,
    businessManagerId: group.businessManagerId,
    ...(group.businessManagerName ? { businessManagerName: group.businessManagerName } : {}),
    currency: group.currency,
    key: group.key,
    platform: group.platform,
    searchText: [...group.searchTerms].join(" ").toLowerCase(),
    spend: group.spend,
    workspaces: [...group.workspaces].sort((left, right) => left - right)
  }));
}

function businessManagerSortValue(
  group: BusinessManagerSpendGroup,
  sortKey: BusinessManagerSortKey
): number | string | undefined {
  if (sortKey === "accounts") return group.accountCount;
  if (sortKey === "businessManager") return group.businessManagerName ?? group.businessManagerId;
  if (sortKey === "platform") return group.platform;
  if (sortKey === "spend") return group.spend;
  return group.workspaces[0];
}

async function apiErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  return body?.message || fallback;
}

function mediaSpendPreset(value: string): CalendarDateRange {
  const yesterday = shiftFinanceOperatingDate(financeOperatingDate(), -1);
  if (value !== "yesterday") throw new Error("Unknown media spend date preset");
  return { fromDate: yesterday, toDate: yesterday };
}

export function MediaSpendView({ apiBase }: { apiBase: string }) {
  const defaultRange = useMemo(defaultMediaSpendRange, []);
  const [dateRange, setDateRange] = useUrlDateRangeState("mediaFrom", "mediaTo", defaultRange);
  const [sortKey, setSortKey] = useUrlState<MediaSpendSortKey>("mediaSort", "spend", {
    allowedValues: mediaSpendSortKeys
  });
  const [sortDirection, setSortDirection] = useUrlState<TableSortDirection>("mediaOrder", "desc", {
    allowedValues: ["asc", "desc"]
  });
  const [businessManagerSortKey, setBusinessManagerSortKey] = useUrlState<BusinessManagerSortKey>("mediaBmSort", "spend", {
    allowedValues: businessManagerSortKeys
  });
  const [businessManagerSortDirection, setBusinessManagerSortDirection] = useUrlState<TableSortDirection>("mediaBmOrder", "desc", {
    allowedValues: ["asc", "desc"]
  });
  const [viewMode, setViewMode] = useUrlState<MediaSpendViewMode>("mediaView", "accounts", {
    allowedValues: mediaSpendViewModes
  });
  const [selectedBusinessManagerKey, setSelectedBusinessManagerKey] = useUrlState("mediaBm", "", {
    isValid: (value) => value.length <= 500
  });
  const [zeroSpendVisibility, setZeroSpendVisibility] = useUrlState<ZeroSpendVisibility>("mediaZeros", "hide", {
    allowedValues: ["hide", "include"]
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

  const activitySummary = useMemo(() => {
    const activeRows = (data?.rows ?? []).filter((row) => row.spend !== 0);
    return {
      accounts: new Set(activeRows.map((row) => `${row.platform}:${row.accountId}`)).size,
      businessManagers: new Set(activeRows.map((row) => `${row.platform}:${row.businessManagerId ?? ""}`)).size
    };
  }, [data?.rows]);
  const includeZeroSpend = zeroSpendVisibility === "include";
  const spendRows = useMemo(() => includeZeroSpend
    ? (data?.rows ?? [])
    : (data?.rows ?? []).filter((row) => row.spend !== 0), [data?.rows, includeZeroSpend]);
  const allBusinessManagerGroups = useMemo(() => groupBusinessManagers(data?.rows ?? []), [data?.rows]);
  const businessManagerGroups = useMemo(() => groupBusinessManagers(spendRows), [spendRows]);
  const selectedBusinessManager = useMemo(
    () => allBusinessManagerGroups.find((group) => group.key === selectedBusinessManagerKey),
    [allBusinessManagerGroups, selectedBusinessManagerKey]
  );
  const visibleAccountRows = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const selectedRows = selectedBusinessManagerKey
      ? spendRows.filter((row) => businessManagerKey(row) === selectedBusinessManagerKey)
      : spendRows;
    const filtered = normalizedSearch
      ? selectedRows.filter((row) => [
          row.accountId,
          row.accountName,
          row.businessManagerId,
          row.businessManagerName,
          row.platform,
          String(row.workspace)
        ].some((value) => value?.toLowerCase().includes(normalizedSearch)))
      : [...selectedRows];
    return filtered.sort((left, right) =>
      compareTableValues(spendSortValue(left, sortKey), spendSortValue(right, sortKey), sortDirection)
      || left.key.localeCompare(right.key)
    );
  }, [search, selectedBusinessManagerKey, sortDirection, sortKey, spendRows]);
  const visibleBusinessManagers = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const filtered = normalizedSearch
      ? businessManagerGroups.filter((group) => group.searchText.includes(normalizedSearch))
      : [...businessManagerGroups];
    return filtered.sort((left, right) =>
      compareTableValues(
        businessManagerSortValue(left, businessManagerSortKey),
        businessManagerSortValue(right, businessManagerSortKey),
        businessManagerSortDirection
      ) || left.key.localeCompare(right.key)
    );
  }, [businessManagerGroups, businessManagerSortDirection, businessManagerSortKey, search]);
  const visibleRowCount = viewMode === "accounts" ? visibleAccountRows.length : visibleBusinessManagers.length;
  const pageCount = Math.max(1, Math.ceil(visibleRowCount / mediaSpendPageSize));
  const pageAccountRows = visibleAccountRows.slice(page * mediaSpendPageSize, (page + 1) * mediaSpendPageSize);
  const pageBusinessManagers = visibleBusinessManagers.slice(page * mediaSpendPageSize, (page + 1) * mediaSpendPageSize);

  useEffect(() => {
    setPage(0);
  }, [
    businessManagerSortDirection,
    businessManagerSortKey,
    dateRange.fromDate,
    dateRange.toDate,
    includeZeroSpend,
    search,
    selectedBusinessManagerKey,
    sortDirection,
    sortKey,
    viewMode
  ]);

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

  function requestBusinessManagerSort(nextSortKey: BusinessManagerSortKey): void {
    if (nextSortKey === businessManagerSortKey) {
      setBusinessManagerSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setBusinessManagerSortKey(nextSortKey);
    setBusinessManagerSortDirection(nextSortKey === "businessManager" || nextSortKey === "platform" || nextSortKey === "workspace" ? "asc" : "desc");
  }

  function changeViewMode(nextViewMode: MediaSpendViewMode): void {
    setViewMode(nextViewMode);
    if (nextViewMode === "businessManagers") setSelectedBusinessManagerKey("");
  }

  function openBusinessManager(group: BusinessManagerSpendGroup): void {
    setSearch("");
    setSelectedBusinessManagerKey(group.key);
    setViewMode("accounts");
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
            ariaLabel="Choose media spend date"
            dateRange={dateRange}
            disabled={isLoading || isSyncing}
            isLoading={isLoading}
            onApply={(nextRange) => {
              if (nextRange.fromDate !== nextRange.toDate) {
                setError("Choose one date for account-level media spend");
                return;
              }
              setDateRange(nextRange);
            }}
            onSelectPreset={(value) => setDateRange(mediaSpendPreset(value))}
            presetAriaLabel="Media spend date preset"
            presetOptions={[
              { value: "yesterday", label: "Yesterday" }
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
          <div><span>Active accounts</span><strong>{data ? activitySummary.accounts.toLocaleString() : "—"}</strong></div>
        </article>
        <article className="media-spend-summary-card">
          <span className="media-spend-summary-icon"><BriefcaseBusiness size={17} /></span>
          <div><span>Active BMs</span><strong>{data ? activitySummary.businessManagers.toLocaleString() : "—"}</strong></div>
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
          <div className="media-spend-toolbar-controls">
            <div className="segmented-control bank-activity-view-toggle media-spend-view-toggle" aria-label="Media spend view">
              <button
                aria-label="Ad accounts"
                aria-pressed={viewMode === "accounts"}
                className={viewMode === "accounts" ? "active" : ""}
                onClick={() => changeViewMode("accounts")}
                title="Ad accounts"
                type="button"
              >
                <List aria-hidden="true" size={14} />
                <span>Ad accounts</span>
              </button>
              <button
                aria-label="Business manager view"
                aria-pressed={viewMode === "businessManagers"}
                className={viewMode === "businessManagers" ? "active" : ""}
                onClick={() => changeViewMode("businessManagers")}
                title="Business manager view"
                type="button"
              >
                <Layers3 aria-hidden="true" size={14} />
                <span>BM view</span>
              </button>
            </div>
            <Button
              aria-pressed={includeZeroSpend}
              className="secondary-button media-spend-zero-toggle"
              onClick={() => setZeroSpendVisibility(includeZeroSpend ? "hide" : "include")}
              type="button"
            >
              {includeZeroSpend ? "Hide $0" : "Include $0"}
            </Button>
            <ToolbarSearchField
              ariaLabel="Search media spend"
              onChange={setSearch}
              placeholder={viewMode === "accounts" ? "Search BM, account, platform" : "Search BM or ad account"}
              value={search}
            />
          </div>
        </div>

        <ActiveFilterBar
          filters={viewMode === "accounts" && selectedBusinessManagerKey ? [{
            key: "businessManager",
            label: `BM: ${selectedBusinessManager?.businessManagerName ?? selectedBusinessManager?.businessManagerId ?? "Selected"}`,
            onRemove: () => setSelectedBusinessManagerKey("")
          }] : []}
          onClearAll={() => setSelectedBusinessManagerKey("")}
          resultLabel={viewMode === "accounts"
            ? `${visibleAccountRows.length.toLocaleString()} ad accounts shown`
            : `${visibleBusinessManagers.length.toLocaleString()} business managers shown`}
        />

        {isLoading && !data ? (
          <div className="media-spend-loading"><Loader2 className="spin" size={22} /><span>Loading media spend</span></div>
        ) : visibleRowCount === 0 ? (
          <div className="empty-state">
            <Database size={22} />
            <strong>{search
              ? `No matching ${viewMode === "accounts" ? "ad accounts" : "business managers"}`
              : selectedBusinessManagerKey
                ? "No ad accounts match this business manager"
                : "No media spend in this period"}</strong>
          </div>
        ) : viewMode === "accounts" ? (
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
                {pageAccountRows.map((row) => (
                  <tr key={row.key}>
                    <td>{dateLabel(row.date)}</td>
                    <td><span className="source-pill media-spend-platform">{row.platform}</span></td>
                    <td>{row.workspace}</td>
                    <td><strong>{row.businessManagerName ?? "—"}</strong><small>{row.businessManagerId}</small></td>
                    <td><strong>{row.accountName ?? "—"}</strong><small>{row.accountId}</small></td>
                    <td className="amount media-spend-amount">{money(row.spend, row.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="table-wrap media-spend-table-wrap">
            <table className="data-table dense media-spend-business-manager-table">
              <thead>
                <tr>
                  <SortableTableHead activeSortKey={businessManagerSortKey} direction={businessManagerSortDirection} onSort={requestBusinessManagerSort} sortKey="businessManager">Business manager</SortableTableHead>
                  <SortableTableHead activeSortKey={businessManagerSortKey} direction={businessManagerSortDirection} onSort={requestBusinessManagerSort} sortKey="platform">Platform</SortableTableHead>
                  <SortableTableHead activeSortKey={businessManagerSortKey} direction={businessManagerSortDirection} onSort={requestBusinessManagerSort} sortKey="workspace">Workspace</SortableTableHead>
                  <SortableTableHead activeSortKey={businessManagerSortKey} direction={businessManagerSortDirection} onSort={requestBusinessManagerSort} sortKey="accounts">Ad accounts</SortableTableHead>
                  <SortableTableHead activeSortKey={businessManagerSortKey} className="amount" direction={businessManagerSortDirection} onSort={requestBusinessManagerSort} sortKey="spend">Spend</SortableTableHead>
                </tr>
              </thead>
              <tbody>
                {pageBusinessManagers.map((group) => (
                  <tr key={group.key}>
                    <td className="counterparty-cell">
                      <button className="bank-group-drilldown" onClick={() => openBusinessManager(group)} type="button">
                        <span><strong>{group.businessManagerName ?? "—"}</strong><small>{group.businessManagerId}</small></span>
                        <ChevronRight aria-hidden="true" size={15} />
                      </button>
                    </td>
                    <td><span className="source-pill media-spend-platform">{group.platform}</span></td>
                    <td>{group.workspaces.join(", ")}</td>
                    <td>{group.accountCount.toLocaleString()}</td>
                    <td className="amount media-spend-amount">{money(group.spend, group.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <footer className="media-spend-table-footer">
          <span>{viewMode === "accounts"
            ? `${visibleAccountRows.length.toLocaleString()} shown · ${activitySummary.accounts.toLocaleString()} active · ${(data?.rows.length ?? 0).toLocaleString()} total account-day rows`
            : `${visibleBusinessManagers.length.toLocaleString()} shown · ${activitySummary.businessManagers.toLocaleString()} active · ${(data?.summary.businessManagers ?? 0).toLocaleString()} total BMs`} · {data?.summary.platforms ?? 0} platform{data?.summary.platforms === 1 ? "" : "s"}</span>
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
