import { type ReactNode, useEffect, useMemo, useState } from "react";
import { BadgeDollarSign, ChevronLeft, ChevronRight, CircleAlert, Database, Download, HandCoins, Loader2, RefreshCw, WalletCards } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { CalendarPeriodPicker, calendarDateRangeLabel, type CalendarDateRange } from "@/components/ui/calendar-period-picker";
import { ActiveFilterBar, FilterFieldGroup, FilterPopover } from "@/components/ui/filter-toolbar";
import { InfoPopover } from "@/components/ui/finance-visuals";
import { compareTableValues, SortableTableHead, type TableSortDirection } from "@/components/ui/sortable-table-head";
import { useUrlDateRangeState, useUrlState } from "@/lib/url-state";
import { financeOperatingDate, shiftFinanceOperatingDate } from "../../../shared/operatingDate";
import {
  validateWagnerDateRange, wagnerBreakdowns, wagnerFilters, wagnerLabels, wagnerSpendCsv,
  type WagnerBreakdown, type WagnerDimensions, type WagnerFilter, type WagnerStoredSpendResponse, type WagnerSpendRow
} from "../../../shared/wagnerSpend";

type SortKey = "label" | "accountId" | "spend" | "commission" | "total";
const sortKeys: SortKey[] = ["label", "accountId", "spend", "commission", "total"];
const pageSize = 100;
const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);

function preset(value: string): CalendarDateRange {
  const yesterday = shiftFinanceOperatingDate(financeOperatingDate(), -1);
  return {
    fromDate: value === "last7" ? shiftFinanceOperatingDate(yesterday, -6)
      : value === "last30" ? shiftFinanceOperatingDate(yesterday, -29)
      : value === "monthToDate" ? `${yesterday.slice(0, 8)}01` : yesterday,
    toDate: yesterday
  };
}

function useWagnerFilter(name: WagnerFilter) {
  return useUrlState(`wagner_${name}`, "", { isValid: value => value.length <= 500 });
}

async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) throw new Error(body.message ?? "Wagner spend could not be loaded.");
  return body as T;
}

export function WagnerSpendView({ apiBase, teamPicker }: { apiBase: string; teamPicker: ReactNode }) {
  const defaultRange = useMemo(() => preset("yesterday"), []);
  const [dateRange, setDateRange] = useUrlDateRangeState("mediaFrom", "mediaTo", defaultRange);
  const [groupBy, setGroupBy] = useUrlState<WagnerBreakdown>("wagnerGroup", "agency", { allowedValues: wagnerBreakdowns });
  const [sortKey, setSortKey] = useUrlState<SortKey>("wagnerSort", "spend", { allowedValues: sortKeys });
  const [direction, setDirection] = useUrlState<TableSortDirection>("wagnerOrder", "desc", { allowedValues: ["asc", "desc"] });
  const filterStates = {
    agency: useWagnerFilter("agency"), ad_account: useWagnerFilter("ad_account"), buyer: useWagnerFilter("buyer"),
    team: useWagnerFilter("team"), source: useWagnerFilter("source"), vertical: useWagnerFilter("vertical"), category: useWagnerFilter("category")
  };
  const params = new URLSearchParams({ ...dateRange, groupBy });
  for (const filter of wagnerFilters) if (filterStates[filter][0]) params.set(filter, filterStates[filter][0]);
  const query = params.toString();
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{ query: string; data: WagnerStoredSpendResponse } | null>(null);
  const [dimensions, setDimensions] = useState<WagnerDimensions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dimensionError, setDimensionError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(0);
  const data = result?.query === query ? result.data : null;

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setResult(null);
    setError(null);
    void fetch(`${apiBase}/media-spend/wagner?${query}`, { signal: controller.signal })
      .then(readResponse<WagnerStoredSpendResponse>)
      .then(data => { if (!controller.signal.aborted) setResult({ query, data }); })
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Wagner spend could not be loaded."); })
      .finally(() => { if (!controller.signal.aborted) setIsLoading(false); });
    return () => controller.abort();
  }, [apiBase, query, refresh]);

  useEffect(() => {
    const controller = new AbortController();
    setDimensionError(null);
    void fetch(`${apiBase}/media-spend/wagner/dimensions`, { signal: controller.signal })
      .then(readResponse<WagnerDimensions>)
      .then(data => { if (!controller.signal.aborted) setDimensions(data); })
      .catch(error => { if (!controller.signal.aborted) setDimensionError(error instanceof Error ? error.message : "Wagner filters could not be loaded."); });
    return () => controller.abort();
  }, [apiBase, refresh]);

  // Account IDs are only a column in the account breakdown.
  const activeSortKey = sortKey === "accountId" && groupBy !== "ad_account" ? "label" : sortKey;
  const rows = useMemo(() => [...(data?.rows ?? [])].sort((a, b) =>
    compareTableValues(a[activeSortKey], b[activeSortKey], direction) || a.key.localeCompare(b.key)
  ), [data, activeSortKey, direction]);
  useEffect(() => { setPage(0); }, [query, activeSortKey, direction]);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);
  const visibleRows = rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const today = financeOperatingDate();
  const pending = dateRange.toDate >= today;
  const beyondCoverage = data?.dataThrough && dateRange.toDate > data.dataThrough;
  const filters = wagnerFilters.filter(filter => filterStates[filter][0]).map(filter => ({
    key: filter,
    label: `${wagnerLabels[filter]}: ${dimensions?.[filter].find(option => option.value === filterStates[filter][0])?.label ?? filterStates[filter][0]}`,
    onRemove: () => filterStates[filter][1]("")
  }));

  function requestSort(key: SortKey) {
    setSortKey(key);
    setDirection(key === activeSortKey && direction === "asc" ? "desc" : "asc");
  }
  function drillDown(row: WagnerSpendRow) {
    if (groupBy === "date") return;
    filterStates[groupBy][1](row.key);
    setGroupBy("date");
    setSortKey("label");
    setDirection("desc");
  }
  function exportCsv() {
    if (!data) return;
    const url = URL.createObjectURL(new Blob([wagnerSpendCsv(data, rows)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `wagner-spend-${groupBy}-${dateRange.fromDate}-to-${dateRange.toDate}.csv`;
    document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  }
  const sortProps = { activeSortKey, direction, onSort: requestSort };

  return <section className="media-spend-page">
    <header className="media-spend-page-header">
      <div>
        <div className="media-spend-eyebrow"><span>Analytics</span><Badge variant="outline">Saved reports</Badge>{pending && <Badge variant="outline">Includes pending days</Badge>}</div>
        <div className="media-spend-title-row">
          <h2>Actual media spend</h2>
          <InfoPopover label="Wagner media spend">
            <span>Wagner ad delivery from Inchops, in USD. Commission is shown separately from media spend. These figures are excluded from official accounting and cash-flow calculations.</span>
            <span>Each date range, breakdown, and filter combination is saved in Convex on first use. Refresh reuses saved reports. Recent periods refresh at most hourly; reports fetched more than 14 days after their end date are retained without automatic re-fetching.</span>
            <span>Today is still pending. Subteams are the groups within Wagner. Summary totals come directly from the API; rounded rows may differ by a few cents.</span>
          </InfoPopover>
          {teamPicker}
        </div>
      </div>
      <div className="media-spend-header-actions">
        <CalendarPeriodPicker ariaLabel="Choose media spend period" dateRange={dateRange}
          onApply={range => { try { validateWagnerDateRange(range.fromDate, range.toDate); setError(null); setDateRange(range); } catch (error) { setError((error as Error).message); } }}
          onSelectPreset={value => setDateRange(preset(value))} presetAriaLabel="Media spend period preset"
          presetOptions={[{ value: "yesterday", label: "Yesterday" }, { value: "last7", label: "Last 7 days" }, { value: "last30", label: "Last 30 days" }, { value: "monthToDate", label: "Month to date" }]}
          triggerLabel={calendarDateRangeLabel(dateRange)} />
        <Button className="secondary-button" disabled={isLoading} onClick={() => setRefresh(value => value + 1)} type="button">
          <RefreshCw className={isLoading ? "spin" : undefined} size={15} /> Refresh
        </Button>
      </div>
    </header>
    {(error || dimensionError) && <div className="income-callout warning media-spend-alert" role="alert"><CircleAlert size={17} /><span>{error ?? `Filters unavailable: ${dimensionError}`}</span></div>}
    <div className="media-spend-summary wagner-spend-summary" aria-label="Wagner spend summary">
      <article className="media-spend-summary-card total"><span className="media-spend-summary-icon"><BadgeDollarSign size={17} /></span><div><span>Reported spend</span><strong>{data ? money(data.totals.spend) : "—"}</strong></div></article>
      <article className="media-spend-summary-card"><span className="media-spend-summary-icon"><HandCoins size={17} /></span><div><span>Agency commission</span><strong>{data ? money(data.totals.commission) : "—"}</strong></div></article>
      <article className="media-spend-summary-card"><span className="media-spend-summary-icon"><WalletCards size={17} /></span><div><span>Total cost</span><strong>{data ? money(data.totals.total) : "—"}</strong></div></article>
    </div>
    <section className="panel media-spend-panel" aria-busy={isLoading}>
      <div className="media-spend-toolbar">
        <div className="media-spend-source-state wagner-source-state">
          <span className={`status-pill ${error ? "danger" : pending || beyondCoverage ? "warning" : "good"}`}><Database size={12} />{isLoading ? "Loading" : error ? "Unavailable" : pending ? "Pending days included" : beyondCoverage ? "Partial coverage" : "Saved"}</span>
          {data && <span>{data.dataThrough ? `Data through ${data.dataThrough}` : "No reported spend"}</span>}
          {data && <InfoPopover label="Wagner data freshness"><span>Saved {new Date(data.savedAt).toLocaleString()}. {data.refreshAfter ? `Eligible for refresh after ${new Date(data.refreshAfter).toLocaleString()}.` : "Historical report; no automatic source requests."}</span><span>Generated {new Date(data.generatedAt).toLocaleString()}. The latest reported date does not guarantee that every account has finished reporting.</span></InfoPopover>}
        </div>
        <div className="media-spend-toolbar-controls">
          <label className="wagner-breakdown-select"><span>Group by</span><NativeSelect aria-label="Wagner spend breakdown" value={groupBy} onValueChange={value => setGroupBy(value as WagnerBreakdown)}>
            {wagnerBreakdowns.map(group => <NativeSelectOption key={group} value={group}>{wagnerLabels[group]}</NativeSelectOption>)}
          </NativeSelect></label>
          <FilterPopover activeCount={filters.length} title="Filter Wagner spend">
            <FilterFieldGroup title="Wagner">
              {wagnerFilters.map(filter => <label key={filter}>{wagnerLabels[filter]}
                <NativeSelect aria-label={`Filter Wagner by ${wagnerLabels[filter].toLowerCase()}`} searchable disabled={!dimensions} value={filterStates[filter][0]} onValueChange={filterStates[filter][1]}>
                  <NativeSelectOption value="">All</NativeSelectOption>
                  {(dimensions?.[filter] ?? []).map(option => <NativeSelectOption key={option.value} value={option.value}>{option.label}</NativeSelectOption>)}
                </NativeSelect>
              </label>)}
            </FilterFieldGroup>
          </FilterPopover>
          <Button className="icon-button" aria-label="Export Wagner spend CSV" title="Export Wagner spend CSV" disabled={!data || rows.length === 0} onClick={exportCsv} type="button"><Download size={15} /></Button>
        </div>
      </div>
      <ActiveFilterBar filters={filters} onClearAll={() => wagnerFilters.forEach(filter => filterStates[filter][1](""))} resultLabel={`${rows.length} Wagner spend rows`} />
      {isLoading ? <div className="media-spend-loading" role="status"><Loader2 className="spin" size={22} /><span>Loading Wagner spend</span></div>
        : error && !data ? <div className="empty-state"><CircleAlert size={22} /><strong>Wagner spend is unavailable</strong><Button className="secondary-button" onClick={() => setRefresh(value => value + 1)}>Retry</Button></div>
        : rows.length === 0 ? <div className="empty-state"><Database size={22} /><strong>No Wagner spend for this period and filters</strong></div>
        : <div className="table-wrap media-spend-table-wrap"><table className="data-table dense wagner-spend-table">
          <thead><tr>
            <SortableTableHead {...sortProps} sortKey="label">{wagnerLabels[groupBy]}</SortableTableHead>
            {groupBy === "ad_account" && <SortableTableHead {...sortProps} sortKey="accountId">Account ID</SortableTableHead>}
            <SortableTableHead {...sortProps} className="amount" sortKey="spend">Spend</SortableTableHead>
            <SortableTableHead {...sortProps} className="amount" sortKey="commission">Commission</SortableTableHead>
            <SortableTableHead {...sortProps} className="amount" sortKey="total">Total cost</SortableTableHead>
          </tr></thead>
          <tbody>{visibleRows.map(row => <tr key={row.key}>
            <td>{groupBy === "date" ? <strong>{row.label}{row.label >= today && <Badge variant="outline">Pending</Badge>}</strong>
              : <button type="button" className="bank-group-drilldown" onClick={() => drillDown(row)} aria-label={`View daily spend for ${row.label}`}><strong>{row.label}</strong><ChevronRight size={14} /></button>}</td>
            {groupBy === "ad_account" && <td>{row.accountId ?? "—"}</td>}
            <td className="amount media-spend-amount">{money(row.spend)}</td><td className="amount">{money(row.commission)}</td><td className="amount">{money(row.total)}</td>
          </tr>)}</tbody>
        </table></div>}
      {data && <footer className="media-spend-table-footer"><span>{rows.length.toLocaleString()} rows · USD</span><div className="media-spend-pagination">
        <span>Page {currentPage + 1} of {pageCount}</span>
        <Button className="icon-button" aria-label="Previous Wagner spend page" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={14} /></Button>
        <Button className="icon-button" aria-label="Next Wagner spend page" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}><ChevronRight size={14} /></Button>
      </div></footer>}
    </section>
  </section>;
}
