import {
  BadgeDollarSign,
  BriefcaseBusiness,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Database,
  Link2,
  Layers3,
  List,
  Loader2,
  RefreshCw,
  Rows3,
  WalletCards,
  X
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
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
import { FundingProviderBadge } from "@/features/media-funding/MediaFundingView";
import {
  mediaFundingAccountKey,
  mediaFundingAssignmentIsActive,
  mediaFundingBusinessManagerKey,
  resolveMediaFundingAssignment,
  type AssignMediaFundingTargetsPayload,
  type MediaFundingApiResponse,
  type MediaFundingAssignmentTarget,
  type MediaFundingProvider
} from "../../../shared/mediaFunding";
import {
  validateMediaSpendDateRange,
  type MediaSpendApiResponse,
  type MediaSpendRow
} from "../../../shared/mediaSpend";
import { financeOperatingDate, shiftFinanceOperatingDate } from "../../../shared/operatingDate";

type MediaSpendSortKey = "account" | "businessManager" | "date" | "platform" | "provider" | "spend" | "workspace";
type BusinessManagerSortKey = "accounts" | "businessManager" | "platform" | "provider" | "spend" | "workspace";
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
  rows: MediaSpendRow[];
  workspaces: number[];
};

const mediaSpendSortKeys: readonly MediaSpendSortKey[] = [
  "account",
  "businessManager",
  "date",
  "platform",
  "provider",
  "spend",
  "workspace"
];
const businessManagerSortKeys: readonly BusinessManagerSortKey[] = [
  "accounts",
  "businessManager",
  "platform",
  "provider",
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
  if (sortKey === "provider") return undefined;
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
    rows: MediaSpendRow[];
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
      rows: [],
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
    existing.rows.push(row);
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
    rows: group.rows,
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
  if (sortKey === "provider") return undefined;
  if (sortKey === "spend") return group.spend;
  return group.workspaces[0];
}

async function apiErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  return body?.message || fallback;
}

function mediaSpendPreset(value: string): CalendarDateRange {
  const yesterday = shiftFinanceOperatingDate(financeOperatingDate(), -1);
  if (value === "yesterday") return { fromDate: yesterday, toDate: yesterday };
  if (value === "last7") {
    return { fromDate: shiftFinanceOperatingDate(yesterday, -6), toDate: yesterday };
  }
  if (value === "last30") {
    return { fromDate: shiftFinanceOperatingDate(yesterday, -29), toDate: yesterday };
  }
  if (value === "monthToDate") {
    return { fromDate: `${yesterday.slice(0, 8)}01`, toDate: yesterday };
  }
  throw new Error("Unknown media spend date preset");
}

export function MediaSpendView({
  apiBase,
  onOpenProviderBalances
}: {
  apiBase: string;
  onOpenProviderBalances: () => void;
}) {
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
  const [funding, setFunding] = useState<MediaFundingApiResponse | null>(null);
  const [search, setSearch] = useState("");
  const [selectedTargets, setSelectedTargets] = useState<Set<string>>(new Set());
  const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadData(signal?: AbortSignal): Promise<void> {
    const query = new URLSearchParams(dateRange);
    const [spendResponse, fundingResponse] = await Promise.all([
      fetch(`${apiBase}/media-spend?${query.toString()}`, { signal }),
      fetch(`${apiBase}/media-funding`, { signal })
    ]);
    if (!spendResponse.ok) throw new Error(await apiErrorMessage(spendResponse, "Media spend could not be loaded"));
    if (!fundingResponse.ok) throw new Error(await apiErrorMessage(fundingResponse, "Funding assignments could not be loaded"));
    setData((await spendResponse.json()) as MediaSpendApiResponse);
    setFunding((await fundingResponse.json()) as MediaFundingApiResponse);
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
  const canIncludeZeroSpend = dateRange.fromDate === dateRange.toDate;
  const includeZeroSpend = canIncludeZeroSpend && zeroSpendVisibility === "include";
  const providersById = useMemo(
    () => new Map((funding?.providers ?? []).map((provider) => [provider.id, provider])),
    [funding?.providers]
  );
  const spendRows = useMemo(() => includeZeroSpend
    ? (data?.rows ?? [])
    : (data?.rows ?? []).filter((row) => row.spend !== 0), [data?.rows, includeZeroSpend]);
  const allBusinessManagerGroups = useMemo(() => groupBusinessManagers(data?.rows ?? []), [data?.rows]);
  const businessManagerGroups = useMemo(() => groupBusinessManagers(spendRows), [spendRows]);
  const selectedBusinessManager = useMemo(
    () => allBusinessManagerGroups.find((group) => group.key === selectedBusinessManagerKey),
    [allBusinessManagerGroups, selectedBusinessManagerKey]
  );

  function accountFunding(row: MediaSpendRow): {
    assignment: ReturnType<typeof resolveMediaFundingAssignment>;
    provider?: MediaFundingProvider;
  } {
    const assignment = resolveMediaFundingAssignment(funding?.assignments ?? [], row);
    return { assignment, provider: assignment ? providersById.get(assignment.providerId) : undefined };
  }

  function businessManagerFunding(group: BusinessManagerSpendGroup): {
    childAssignments: number;
    provider?: MediaFundingProvider;
  } {
    const date = group.rows[0]?.date ?? dateRange.toDate;
    const businessManagerKey = mediaFundingBusinessManagerKey(group.platform, group.businessManagerId);
    const direct = (funding?.assignments ?? []).find((assignment) =>
      assignment.scope === "business_manager"
      && assignment.businessManagerKey === businessManagerKey
      && mediaFundingAssignmentIsActive(assignment, date)
    );
    if (direct) return { childAssignments: 0, provider: providersById.get(direct.providerId) };
    const accountIds = new Set(group.rows.map((row) => row.accountId));
    const children = (funding?.assignments ?? []).filter((assignment) =>
      assignment.scope === "ad_account"
      && assignment.businessManagerKey === businessManagerKey
      && Boolean(assignment.accountId && accountIds.has(assignment.accountId))
      && mediaFundingAssignmentIsActive(assignment, date)
    );
    return { childAssignments: children.length };
  }

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
          accountFunding(row).provider?.name,
          String(row.workspace)
        ].some((value) => value?.toLowerCase().includes(normalizedSearch)))
      : [...selectedRows];
    return filtered.sort((left, right) =>
      compareTableValues(
        sortKey === "provider" ? accountFunding(left).provider?.name : spendSortValue(left, sortKey),
        sortKey === "provider" ? accountFunding(right).provider?.name : spendSortValue(right, sortKey),
        sortDirection
      )
      || left.key.localeCompare(right.key)
    );
  }, [funding?.assignments, providersById, search, selectedBusinessManagerKey, sortDirection, sortKey, spendRows]);
  const visibleBusinessManagers = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const filtered = normalizedSearch
      ? businessManagerGroups.filter((group) =>
          group.searchText.includes(normalizedSearch)
          || businessManagerFunding(group).provider?.name.toLowerCase().includes(normalizedSearch)
        )
      : [...businessManagerGroups];
    return filtered.sort((left, right) =>
      compareTableValues(
        businessManagerSortKey === "provider"
          ? businessManagerFunding(left).provider?.name
          : businessManagerSortValue(left, businessManagerSortKey),
        businessManagerSortKey === "provider"
          ? businessManagerFunding(right).provider?.name
          : businessManagerSortValue(right, businessManagerSortKey),
        businessManagerSortDirection
      ) || left.key.localeCompare(right.key)
    );
  }, [businessManagerGroups, businessManagerSortDirection, businessManagerSortKey, funding?.assignments, providersById, search]);
  const visibleRowCount = viewMode === "accounts" ? visibleAccountRows.length : visibleBusinessManagers.length;
  const pageCount = Math.max(1, Math.ceil(visibleRowCount / mediaSpendPageSize));
  const pageAccountRows = visibleAccountRows.slice(page * mediaSpendPageSize, (page + 1) * mediaSpendPageSize);
  const pageBusinessManagers = visibleBusinessManagers.slice(page * mediaSpendPageSize, (page + 1) * mediaSpendPageSize);
  const selectableAccountRows = pageAccountRows.filter((row) => accountFunding(row).assignment?.scope !== "business_manager");
  const selectableBusinessManagers = pageBusinessManagers.filter((group) => businessManagerFunding(group).childAssignments === 0);
  const pageSelectableKeys = viewMode === "accounts"
    ? selectableAccountRows.map((row) => `ad_account:${mediaFundingAccountKey(row.platform, row.accountId)}`)
    : selectableBusinessManagers.map((group) => `business_manager:${mediaFundingBusinessManagerKey(group.platform, group.businessManagerId)}`);
  const allPageSelected = pageSelectableKeys.length > 0 && pageSelectableKeys.every((key) => selectedTargets.has(key));
  const selectedAssignmentTargets = useMemo(() => {
    const targets = new Map<string, MediaFundingAssignmentTarget>();
    for (const row of visibleAccountRows) {
      const key = `ad_account:${mediaFundingAccountKey(row.platform, row.accountId)}`;
      if (!selectedTargets.has(key)) continue;
      targets.set(key, {
        scope: "ad_account",
        platform: row.platform,
        businessManagerId: row.businessManagerId,
        ...(row.businessManagerName ? { businessManagerName: row.businessManagerName } : {}),
        accountId: row.accountId,
        ...(row.accountName ? { accountName: row.accountName } : {})
      });
    }
    for (const group of visibleBusinessManagers) {
      const key = `business_manager:${mediaFundingBusinessManagerKey(group.platform, group.businessManagerId)}`;
      if (!selectedTargets.has(key)) continue;
      targets.set(key, {
        scope: "business_manager",
        platform: group.platform,
        businessManagerId: group.businessManagerId,
        ...(group.businessManagerName ? { businessManagerName: group.businessManagerName } : {})
      });
    }
    return [...targets.values()];
  }, [selectedTargets, visibleAccountRows, visibleBusinessManagers]);

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

  useEffect(() => {
    setSelectedTargets(new Set());
  }, [dateRange.fromDate, dateRange.toDate, selectedBusinessManagerKey, viewMode]);

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

  function toggleTarget(targetKey: string, checked: boolean): void {
    setSelectedTargets((current) => {
      const next = new Set(current);
      if (checked) next.add(targetKey);
      else next.delete(targetKey);
      return next;
    });
  }

  function togglePageSelection(checked: boolean): void {
    setSelectedTargets((current) => {
      const next = new Set(current);
      for (const key of pageSelectableKeys) {
        if (checked) next.add(key);
        else next.delete(key);
      }
      return next;
    });
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
  const selectedPeriodCovered = Boolean(
    sync?.coveredFrom
    && sync.coveredThrough
    && dateRange.fromDate >= sync.coveredFrom
    && dateRange.toDate <= sync.coveredThrough
  );
  const statusTone = !data?.configured || sync?.status === "failed"
    ? "danger"
    : sync?.status === "healthy" && selectedPeriodCovered
      ? "good"
      : "warning";
  const statusLabel = !data?.configured
    ? "Not configured"
    : sync?.status === "healthy"
      ? selectedPeriodCovered ? "Current" : "Not covered"
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
            <span>Analytics</span>
            <Badge variant="outline">Provisional</Badge>
            <Badge variant="outline">Live data</Badge>
          </div>
          <div className="media-spend-title-row">
            <h2>Actual media spend</h2>
            <InfoPopover label="actual media spend">
              <span>Daily ad delivery reported by LemonMax. It is intentionally excluded from official cash spend, management reporting, profit, and cash-flow calculations.</span>
              <span>Funding-provider assignments feed the separate Provider balances ledger without changing official accounting.</span>
            </InfoPopover>
          </div>
        </div>
        <div className="media-spend-header-actions">
          <CalendarPeriodPicker
            ariaLabel="Choose media spend period"
            dateRange={dateRange}
            disabled={isLoading || isSyncing}
            isLoading={isLoading}
            onApply={(nextRange) => {
              try {
                validateMediaSpendDateRange(nextRange.fromDate, nextRange.toDate);
                setError(null);
                setDateRange(nextRange);
              } catch (rangeError) {
                setError(rangeError instanceof Error ? rangeError.message : "Media spend date range is invalid");
              }
            }}
            onSelectPreset={(value) => setDateRange(mediaSpendPreset(value))}
            presetAriaLabel="Media spend period preset"
            presetOptions={[
              { value: "yesterday", label: "Yesterday" },
              { value: "last7", label: "Last 7 days" },
              { value: "last30", label: "Last 30 days" },
              { value: "monthToDate", label: "Month to date" }
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
                ? `Last synced ${dateTimeLabel(sync.lastSuccessAt)}${sync.coveredFrom && sync.coveredThrough
                  ? ` · coverage ${calendarDateRangeLabel({ fromDate: sync.coveredFrom, toDate: sync.coveredThrough })}`
                  : sync.coveredThrough
                    ? ` · through ${dateLabel(sync.coveredThrough)}`
                    : ""}`
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
            {canIncludeZeroSpend && (
              <Button
                aria-pressed={includeZeroSpend}
                className="secondary-button media-spend-zero-toggle"
                onClick={() => setZeroSpendVisibility(includeZeroSpend ? "hide" : "include")}
                type="button"
              >
                {includeZeroSpend ? "Hide $0" : "Include $0"}
              </Button>
            )}
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

        {selectedAssignmentTargets.length > 0 && (
          <div className="media-funding-selection-bar">
            <span><strong>{selectedAssignmentTargets.length.toLocaleString()}</strong> {viewMode === "accounts" ? "ad accounts" : "business managers"} selected</span>
            <div>
              <Button className="secondary-button" onClick={() => setSelectedTargets(new Set())} type="button">Clear</Button>
              {(funding?.providers.length ?? 0) > 0 ? (
                <Button className="primary-button" onClick={() => setAssignmentDialogOpen(true)} type="button"><Link2 size={15} /> Assign provider</Button>
              ) : (
                <Button className="primary-button" onClick={onOpenProviderBalances} type="button"><Link2 size={15} /> Add a provider first</Button>
              )}
            </div>
          </div>
        )}

        {isLoading && !data ? (
          <div className="media-spend-loading"><Loader2 className="spin" size={22} /><span>Loading media spend</span></div>
        ) : visibleRowCount === 0 ? (
          <div className="empty-state">
            <Database size={22} />
            <strong>{search
                ? `No matching ${viewMode === "accounts" ? "ad accounts" : "business managers"}`
              : selectedBusinessManagerKey
                ? "No ad accounts match this business manager"
                : sync?.coveredFrom && sync.coveredThrough && !selectedPeriodCovered
                  ? "No stored LemonMax history for this period"
                  : "No media spend in this period"}</strong>
          </div>
        ) : viewMode === "accounts" ? (
          <div className="table-wrap media-spend-table-wrap">
            <table className="data-table dense media-spend-table">
              <thead>
                <tr>
                  <th className="media-funding-select-cell"><Checkbox aria-label="Select visible ad accounts" checked={allPageSelected} disabled={pageSelectableKeys.length === 0} onCheckedChange={(checked) => togglePageSelection(checked === true)} /></th>
                  <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="date">Date</SortableTableHead>
                  <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="platform">Platform</SortableTableHead>
                  <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="workspace">Workspace</SortableTableHead>
                  <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="businessManager">Business manager</SortableTableHead>
                  <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="account">Ad account</SortableTableHead>
                  <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="provider">Funding provider</SortableTableHead>
                  <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={requestSort} sortKey="spend">Spend</SortableTableHead>
                </tr>
              </thead>
              <tbody>
                {pageAccountRows.map((row) => {
                  const fundingState = accountFunding(row);
                  const targetKey = `ad_account:${mediaFundingAccountKey(row.platform, row.accountId)}`;
                  const inherited = fundingState.assignment?.scope === "business_manager";
                  return (
                  <tr className={fundingState.provider ? "media-funding-assigned-row" : ""} key={row.key}>
                    <td className="media-funding-select-cell" title={inherited ? "Assigned through the business manager" : undefined}><Checkbox aria-label={`Select ${row.accountName ?? row.accountId}`} checked={selectedTargets.has(targetKey)} disabled={inherited} onCheckedChange={(checked) => toggleTarget(targetKey, checked === true)} /></td>
                    <td>{dateLabel(row.date)}</td>
                    <td><span className="source-pill media-spend-platform">{row.platform}</span></td>
                    <td>{row.workspace}</td>
                    <td><strong>{row.businessManagerName ?? "—"}</strong><small>{row.businessManagerId}</small></td>
                    <td><strong>{row.accountName ?? "—"}</strong><small>{row.accountId}</small></td>
                    <td>{fundingState.provider ? <span className="media-funding-provider-cell"><FundingProviderBadge provider={fundingState.provider} />{inherited && <small>via BM</small>}</span> : <span className="media-funding-unassigned">Unassigned</span>}</td>
                    <td className="amount media-spend-amount">{money(row.spend, row.currency)}</td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="table-wrap media-spend-table-wrap">
            <table className="data-table dense media-spend-business-manager-table">
              <thead>
                <tr>
                  <th className="media-funding-select-cell"><Checkbox aria-label="Select visible business managers" checked={allPageSelected} disabled={pageSelectableKeys.length === 0} onCheckedChange={(checked) => togglePageSelection(checked === true)} /></th>
                  <SortableTableHead activeSortKey={businessManagerSortKey} direction={businessManagerSortDirection} onSort={requestBusinessManagerSort} sortKey="businessManager">Business manager</SortableTableHead>
                  <SortableTableHead activeSortKey={businessManagerSortKey} direction={businessManagerSortDirection} onSort={requestBusinessManagerSort} sortKey="platform">Platform</SortableTableHead>
                  <SortableTableHead activeSortKey={businessManagerSortKey} direction={businessManagerSortDirection} onSort={requestBusinessManagerSort} sortKey="workspace">Workspace</SortableTableHead>
                  <SortableTableHead activeSortKey={businessManagerSortKey} direction={businessManagerSortDirection} onSort={requestBusinessManagerSort} sortKey="accounts">Ad accounts</SortableTableHead>
                  <SortableTableHead activeSortKey={businessManagerSortKey} direction={businessManagerSortDirection} onSort={requestBusinessManagerSort} sortKey="provider">Funding provider</SortableTableHead>
                  <SortableTableHead activeSortKey={businessManagerSortKey} className="amount" direction={businessManagerSortDirection} onSort={requestBusinessManagerSort} sortKey="spend">Spend</SortableTableHead>
                </tr>
              </thead>
              <tbody>
                {pageBusinessManagers.map((group) => {
                  const fundingState = businessManagerFunding(group);
                  const targetKey = `business_manager:${mediaFundingBusinessManagerKey(group.platform, group.businessManagerId)}`;
                  const hasChildren = fundingState.childAssignments > 0;
                  return (
                  <tr className={fundingState.provider || hasChildren ? "media-funding-assigned-row" : ""} key={group.key}>
                    <td className="media-funding-select-cell" title={hasChildren ? "Remove account-level assignments before assigning this whole BM" : undefined}><Checkbox aria-label={`Select ${group.businessManagerName ?? group.businessManagerId}`} checked={selectedTargets.has(targetKey)} disabled={hasChildren} onCheckedChange={(checked) => toggleTarget(targetKey, checked === true)} /></td>
                    <td className="counterparty-cell">
                      <button className="bank-group-drilldown" onClick={() => openBusinessManager(group)} type="button">
                        <span><strong>{group.businessManagerName ?? "—"}</strong><small>{group.businessManagerId}</small></span>
                        <ChevronRight aria-hidden="true" size={15} />
                      </button>
                    </td>
                    <td><span className="source-pill media-spend-platform">{group.platform}</span></td>
                    <td>{group.workspaces.join(", ")}</td>
                    <td>{group.accountCount.toLocaleString()}</td>
                    <td>{fundingState.provider ? <FundingProviderBadge provider={fundingState.provider} /> : hasChildren ? <span className="source-pill warning">{fundingState.childAssignments} account assignment{fundingState.childAssignments === 1 ? "" : "s"}</span> : <span className="media-funding-unassigned">Unassigned</span>}</td>
                    <td className="amount media-spend-amount">{money(group.spend, group.currency)}</td>
                  </tr>
                  );
                })}
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
      {assignmentDialogOpen && funding && (
        <MediaFundingAssignmentDialog
          apiBase={apiBase}
          effectiveFrom={dateRange.toDate}
          providers={funding.providers}
          targets={selectedAssignmentTargets}
          onClose={() => setAssignmentDialogOpen(false)}
          onOpenProviderBalances={onOpenProviderBalances}
          onSaved={async () => {
            setAssignmentDialogOpen(false);
            setSelectedTargets(new Set());
            await loadData();
          }}
        />
      )}
    </section>
  );
}

function MediaFundingAssignmentDialog({
  apiBase,
  effectiveFrom: initialEffectiveFrom,
  providers,
  targets,
  onClose,
  onOpenProviderBalances,
  onSaved
}: {
  apiBase: string;
  effectiveFrom: string;
  providers: MediaFundingProvider[];
  targets: MediaFundingAssignmentTarget[];
  onClose: () => void;
  onOpenProviderBalances: () => void;
  onSaved: () => Promise<void>;
}) {
  const [providerId, setProviderId] = useState(providers[0]?.id ?? "");
  const [effectiveFrom, setEffectiveFrom] = useState(initialEffectiveFrom);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const targetType = targets[0]?.scope === "business_manager" ? "business managers" : "ad accounts";

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!providerId || targets.length === 0 || !effectiveFrom) return;
    setSubmitting(true);
    setError(null);
    const payload: AssignMediaFundingTargetsPayload = { providerId, effectiveFrom, targets };
    try {
      const response = await fetch(`${apiBase}/media-funding/assignments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error(await apiErrorMessage(response, "Funding assignment failed"));
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Funding assignment failed");
      setSubmitting(false);
    }
  }

  return createPortal(
    <div className="modal-backdrop" role="presentation">
      <form className="modal media-funding-modal" role="dialog" aria-modal="true" aria-labelledby="media-funding-assignment-title" onSubmit={(event) => void submit(event)}>
        <div className="modal-header">
          <div><p className="eyebrow">Media spend</p><h2 id="media-funding-assignment-title">Assign funding provider</h2></div>
          <Button aria-label="Close" className="icon-button" onClick={onClose} type="button"><X size={18} /></Button>
        </div>
        {error && <div className="inline-error">{error}</div>}
        <div className="media-funding-assignment-summary"><strong>{targets.length.toLocaleString()}</strong><span>{targetType} selected</span></div>
        {providers.length === 0 ? (
          <div className="empty-state compact"><strong>Add a funding provider before assigning inventory</strong><Button className="primary-button" onClick={onOpenProviderBalances} type="button">Open provider balances</Button></div>
        ) : (
          <>
            <label>Funding provider<NativeSelect searchable value={providerId} onValueChange={setProviderId}>{providers.map((provider) => <NativeSelectOption key={provider.id} value={provider.id}>{provider.name}</NativeSelectOption>)}</NativeSelect></label>
            <label>Effective from<Input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} /></label>
            <p className="field-help">Changing an existing assignment closes the old provider on the previous day. BM assignments block account-level assignments inside that BM.</p>
          </>
        )}
        <div className="modal-actions"><Button className="secondary-button" disabled={submitting} onClick={onClose} type="button">Cancel</Button><Button className="primary-button" disabled={submitting || !providerId || targets.length === 0 || !effectiveFrom} type="submit">{submitting ? <Loader2 className="spin" size={15} /> : <Link2 size={15} />} Assign provider</Button></div>
      </form>
    </div>,
    document.body
  );
}
