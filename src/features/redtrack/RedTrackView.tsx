import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, ChevronLeft, ChevronRight, CircleAlert, Database, ExternalLink, Link2, Loader2, Pencil, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { CalendarPeriodPicker, calendarDateRangeLabel, type CalendarDateRange } from "@/components/ui/calendar-period-picker";
import { InfoPopover } from "@/components/ui/finance-visuals";
import { ActiveFilterBar, ToolbarSearchField } from "@/components/ui/filter-toolbar";
import { SortableTableHead, compareTableValues, type TableSortDirection } from "@/components/ui/sortable-table-head";
import { useUrlDateRangeState, useUrlState } from "@/lib/url-state";
import { filterRedTrackRows, groupRedTrackRows, redTrackGroups, redTrackToday, validateRedTrackDates, validateRedTrackLink,
  type RedTrackBasis, type RedTrackGroup, type RedTrackGroupRow, type RedTrackLink, type RedTrackReport } from "../../../shared/redtrack";
import "./redtrack.css";

type SortKey = "label" | "offerSource" | "offer" | "trafficChannel" | "offers" | "trafficChannels" | "campaigns" | "conversions" | "revenue";
const sortKeys: SortKey[] = ["label", "offerSource", "offer", "trafficChannel", "offers", "trafficChannels", "campaigns", "conversions", "revenue"];
const groupLabels: Record<RedTrackGroup, string> = { offerSources: "Offer sources", offers: "Offers", trafficChannels: "Traffic channels", campaigns: "Campaigns", daily: "Daily" };
const singularLabels: Record<RedTrackGroup, string> = { offerSources: "Offer source", offers: "Offer", trafficChannels: "Traffic channel", campaigns: "Campaign", daily: "Date" };
const pageSize = 100;
const money = (value: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
function shift(date: string, days: number): string { return new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10); }
function preset(value: string): CalendarDateRange {
  const today = redTrackToday(), yesterday = shift(today, -1);
  if (value === "today") return { fromDate: today, toDate: today };
  if (value === "yesterday") return { fromDate: yesterday, toDate: yesterday };
  if (value === "monthToDate") return { fromDate: `${today.slice(0, 8)}01`, toDate: today };
  return { fromDate: shift(yesterday, value === "last30" ? -29 : -6), toDate: yesterday };
}
async function read<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) throw new Error(body.message ?? "RedTrack revenue could not be loaded.");
  return body as T;
}

export function RedTrackView({ apiBase }: { apiBase: string }) {
  const defaultRange = useMemo(() => preset("last7"), []);
  const [dateRange, setDateRange] = useUrlDateRangeState("rtFrom", "rtTo", defaultRange);
  const [group, setGroup] = useUrlState<RedTrackGroup>("rtGroup", "offerSources", { allowedValues: redTrackGroups });
  const [basis, setBasis] = useUrlState<RedTrackBasis>("rtBasis", "primary", { allowedValues: ["primary", "all"] });
  const [sourceId, setSourceId] = useUrlState("rtSource", "");
  const [offerId, setOfferId] = useUrlState("rtOffer", "");
  const [channelId, setChannelId] = useUrlState("rtChannel", "");
  const [search, setSearch] = useUrlState("rtSearch", "");
  const [sortKey, setSortKey] = useUrlState<SortKey>("rtSort", "revenue", { allowedValues: sortKeys });
  const [direction, setDirection] = useUrlState<TableSortDirection>("rtOrder", "desc", { allowedValues: ["asc", "desc"] });
  const [showZero, setShowZero] = useUrlState("rtZero", "hide", { allowedValues: ["hide", "show"] });
  const query = new URLSearchParams(dateRange).toString();
  const [result, setResult] = useState<{ query: string; data: RedTrackReport } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const syncRequest = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [editSource, setEditSource] = useState<string | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const data = result?.query === query ? result.data : null;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(null); setResult(null);
    // Let quick navigation and React's development effect probe cancel before
    // starting a source sync. The backend lease also deduplicates concurrent pulls.
    const timer = window.setTimeout(() => {
      const force = syncRequest.current === query;
      syncRequest.current = null;
      void fetch(`${apiBase}/redtrack${force ? "/sync" : ""}?${query}`, { signal: controller.signal, method: force ? "POST" : "GET" })
      .then(read<RedTrackReport>)
      .then(data => { if (!controller.signal.aborted) setResult({ query, data }); })
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "RedTrack is unavailable."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 150);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [apiBase, query, refresh]);

  const dimensions = useMemo(() => {
    const offers = new Map<string, string>(), channels = new Map<string, string>();
    for (const row of data?.rows ?? []) {
      if (row.offerId && (!sourceId || row.offerSourceId === sourceId)) offers.set(row.offerId, row.offer);
      if (row.trafficChannelId) channels.set(row.trafficChannelId, row.trafficChannel);
    }
    const options = (map: Map<string, string>) => [...map].sort((a, b) => a[1].localeCompare(b[1]));
    return { offers: options(offers), channels: options(channels), sources: [...(data?.sources ?? [])].sort((a, b) => a.name.localeCompare(b.name)) };
  }, [data, sourceId]);
  const filtered = useMemo(() => filterRedTrackRows(data?.rows ?? [], { offerSourceId: sourceId, offerId, trafficChannelId: channelId, search }), [data, sourceId, offerId, channelId, search]);
  const summary = useMemo(() => ({
    revenue: filtered.reduce((sum, row) => sum + (basis === "primary" ? row.revenue : row.allRevenue), 0),
    conversions: filtered.reduce((sum, row) => sum + (basis === "primary" ? row.conversions : row.allConversions), 0),
    offers: new Set(filtered.filter(row => (basis === "primary" ? row.revenue : row.allRevenue) !== 0 && row.offerId).map(row => row.offerId)).size,
    sources: new Set(filtered.filter(row => (basis === "primary" ? row.revenue : row.allRevenue) !== 0 && row.offerSourceId).map(row => row.offerSourceId)).size
  }), [filtered, basis]);
  const columns: { key: SortKey; label: string; numeric?: boolean }[] = [{ key: "label", label: singularLabels[group] }];
  if (group === "offers" || group === "campaigns") columns.push({ key: "offerSource", label: "Offer source" });
  if (group === "campaigns") columns.push({ key: "offer", label: "Offer" });
  if (group === "offers" || group === "campaigns") columns.push({ key: "trafficChannel", label: "Traffic channel" });
  if (group === "offerSources" || group === "trafficChannels" || group === "daily") columns.push({ key: "offers", label: "Offers", numeric: true });
  if (group === "offerSources" || group === "daily") columns.push({ key: "trafficChannels", label: "Channels", numeric: true });
  if (group !== "campaigns") columns.push({ key: "campaigns", label: "Campaigns", numeric: true });
  columns.push({ key: "conversions", label: "Conversions", numeric: true }, { key: "revenue", label: "Revenue", numeric: true });
  const activeSortKey = columns.some(column => column.key === sortKey) ? sortKey : "revenue";
  const rows = useMemo(() => groupRedTrackRows(filtered, group, basis)
    .filter(row => showZero === "show" || row.revenue !== 0 || row.conversions !== 0)
    .sort((a, b) => compareTableValues(a[activeSortKey], b[activeSortKey], direction) || a.key.localeCompare(b.key)), [filtered, group, basis, showZero, activeSortKey, direction]);
  useEffect(() => { setPage(0); }, [query, sourceId, offerId, channelId, search, group, basis, showZero, activeSortKey, direction]);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize)), currentPage = Math.min(page, pageCount - 1);
  const links = new Map(data?.links.map(link => [link.sourceId, link.url]));
  const hasLinksColumn = group === "offerSources" || group === "offers" || group === "campaigns";
  const filters = [
    ...(sourceId ? [{ key: "source", label: `Source: ${dimensions.sources.find(source => source.id === sourceId)?.name ?? sourceId}`, onRemove: () => setSourceId("") }] : []),
    ...(offerId ? [{ key: "offer", label: `Offer: ${dimensions.offers.find(([id]) => id === offerId)?.[1] ?? offerId}`, onRemove: () => setOfferId("") }] : []),
    ...(channelId ? [{ key: "channel", label: `Channel: ${dimensions.channels.find(([id]) => id === channelId)?.[1] ?? channelId}`, onRemove: () => setChannelId("") }] : []),
    ...(search ? [{ key: "search", label: `Search: ${search}`, onRemove: () => setSearch("") }] : [])
  ];
  function clearFilters() { setSourceId(""); setOfferId(""); setChannelId(""); setSearch(""); }
  function changeGroup(value: RedTrackGroup) { setGroup(value); setSortKey("revenue"); setDirection("desc"); }
  function sort(key: SortKey) { setSortKey(key); setDirection(key === activeSortKey && direction === "asc" ? "desc" : "asc"); }
  function applyRange(range: CalendarDateRange) {
    try { validateRedTrackDates(range.fromDate, range.toDate); setRangeError(null); setDateRange(range); }
    catch (error) { setRangeError((error as Error).message); }
  }
  function openLinkEditor(id: string) { setEditSource(id); setLinkUrl(links.get(id) ?? ""); setLinkError(null); setNotice(""); }
  async function saveLink(event: FormEvent) {
    event.preventDefault();
    if (!editSource || saving) return;
    try {
      const url = validateRedTrackLink(editSource, linkUrl);
      setSaving(true); setLinkError(null);
      const response = await fetch(`${apiBase}/redtrack/links`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId: editSource, url }) });
      const saved = await read<{ links: RedTrackLink[] }>(response);
      setResult(previous => previous ? { ...previous, data: { ...previous.data, links: saved.links } } : previous);
      setEditSource(null); setNotice(url ? "Advertiser dashboard link saved." : "Advertiser dashboard link removed.");
    } catch (error) { setLinkError(error instanceof Error ? error.message : "The link could not be saved."); }
    finally { setSaving(false); }
  }
  function drill(row: RedTrackGroupRow) {
    if (group === "offerSources") { setSourceId(row.offerSourceId); setOfferId(""); changeGroup("offers"); }
    if (group === "trafficChannels") { setChannelId(row.trafficChannelId); changeGroup("offers"); }
    if (group === "offers") { setSourceId(row.offerSourceId); setOfferId(row.offerId); setChannelId(row.trafficChannelId); changeGroup("campaigns"); }
  }

  return <section className="media-spend-page redtrack-page">
    <header className="media-spend-page-header">
      <div>
        <div className="media-spend-eyebrow"><span>Revenue</span><Badge variant="outline">RedTrack</Badge>{data && <Badge variant="outline">Saved data</Badge>}{dateRange.toDate === redTrackToday() && <Badge variant="outline">Today is partial</Badge>}</div>
        <div className="media-spend-title-row"><h2>RedTrack revenue</h2><InfoPopover label="About RedTrack revenue">
          <span>Tracked revenue in USD, reported by conversion date in America/New_York. Primary conversions use the conversion types included in RedTrack’s main reports. All conversion types can include multiple events for the same sale.</span>
          <span>These figures are separate from received payments and invoice revenue. Filters and totals apply to the complete selected period. Counts in each row are distinct; the same offer or campaign can appear in several rows.</span>
          <span>Requested days are saved with all report dimensions. Filters reuse those saved days. Today refreshes after 15 minutes, the previous 3 days after an hour, and the rest of the past 30 days after a day. Older dates are retained after a final check. Use Sync from RedTrack to reconcile older corrections.</span>
        </InfoPopover></div>
      </div>
      <div className="media-spend-header-actions">
        <CalendarPeriodPicker ariaLabel="Choose RedTrack revenue period" dateRange={dateRange} onApply={applyRange}
          onSelectPreset={value => applyRange(preset(value))} presetAriaLabel="RedTrack revenue period preset"
          presetOptions={[{ value: "today", label: "Today" }, { value: "yesterday", label: "Yesterday" }, { value: "last7", label: "Last 7 days" }, { value: "last30", label: "Last 30 days" }, { value: "monthToDate", label: "Month to date" }]}
          triggerLabel={calendarDateRangeLabel(dateRange)} />
        <Button className="icon-button" aria-label="Refresh saved RedTrack data" title="Refresh saved data" onClick={() => { setRefresh(value => value + 1); setNotice(""); }} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""} /></Button>
        <Button className="secondary-button" onClick={() => { syncRequest.current = query; setRefresh(value => value + 1); setNotice(""); }} disabled={loading}><RefreshCw size={15} />Sync from RedTrack</Button>
      </div>
    </header>
    {(error || rangeError) && <div className="integration-alert" role="alert"><CircleAlert size={17} /><span>{rangeError ?? error}</span></div>}
    <div className="media-spend-summary redtrack-summary">
      <article className="media-spend-summary-card total"><div><span>Tracked revenue · {data?.currency ?? "USD"}</span><strong>{data ? money(summary.revenue, data.currency) : "—"}</strong></div><ArrowUpRight size={22} /></article>
      <article className="media-spend-summary-card"><div><span>Conversions</span><strong>{data ? summary.conversions.toLocaleString() : "—"}</strong></div></article>
      <article className="media-spend-summary-card"><div><span>Revenue-generating offers</span><strong>{data ? summary.offers.toLocaleString() : "—"}</strong></div></article>
      <article className="media-spend-summary-card"><div><span>Revenue-generating sources</span><strong>{data ? summary.sources.toLocaleString() : "—"}</strong></div></article>
    </div>
    <section className="panel media-spend-panel">
      <div className="redtrack-filters">
        <label>Offer source<NativeSelect aria-label="Filter RedTrack offer source" value={sourceId} onValueChange={value => { setSourceId(value); setOfferId(""); }}>
          <NativeSelectOption value="">All offer sources</NativeSelectOption>{dimensions.sources.map(source => <NativeSelectOption value={source.id} key={source.id}>{source.name}</NativeSelectOption>)}
        </NativeSelect></label>
        <label>Offer<NativeSelect aria-label="Filter RedTrack offer" value={offerId} onValueChange={setOfferId}>
          <NativeSelectOption value="">All offers</NativeSelectOption>{dimensions.offers.map(([id, name]) => <NativeSelectOption key={id} value={id}>{name}</NativeSelectOption>)}
        </NativeSelect></label>
        <label>Traffic channel<NativeSelect aria-label="Filter RedTrack traffic channel" value={channelId} onValueChange={setChannelId}>
          <NativeSelectOption value="">All traffic channels</NativeSelectOption>{dimensions.channels.map(([id, name]) => <NativeSelectOption key={id} value={id}>{name}</NativeSelectOption>)}
        </NativeSelect></label>
      </div>
      <div className="media-spend-toolbar redtrack-toolbar">
        <div className="redtrack-view-controls"><NativeSelect aria-label="Group RedTrack revenue by" value={group} onValueChange={value => changeGroup(value as RedTrackGroup)}>{redTrackGroups.map(key => <NativeSelectOption key={key} value={key}>{groupLabels[key]}</NativeSelectOption>)}</NativeSelect>
          <NativeSelect aria-label="RedTrack revenue basis" value={basis} onValueChange={value => setBasis(value as RedTrackBasis)}><NativeSelectOption value="primary">Primary conversions</NativeSelectOption><NativeSelectOption value="all">All conversion types</NativeSelectOption></NativeSelect>
        </div>
        <div className="media-spend-toolbar-controls"><ToolbarSearchField ariaLabel="Search RedTrack revenue" placeholder="Search revenue…" value={search} onChange={setSearch} />
          <Button className="secondary-button" aria-pressed={showZero === "show"} onClick={() => setShowZero(showZero === "show" ? "hide" : "show")}>Zero activity: {showZero === "show" ? "shown" : "hidden"}</Button>
          <Button className="secondary-button" disabled={!data} onClick={() => openLinkEditor(sourceId || dimensions.sources[0]?.id || "")}><Link2 size={15} />Advertiser links</Button>
        </div>
      </div>
      <ActiveFilterBar filters={filters} onClearAll={clearFilters} resultLabel={`${rows.length.toLocaleString()} rows`} />
      {notice && <div className="redtrack-notice" role="status">{notice}</div>}
      {loading ? <div className="media-spend-loading" role="status"><Loader2 className="spin" size={22} /><span>Loading RedTrack revenue</span></div>
        : error && !data ? <div className="empty-state"><CircleAlert size={22} /><strong>RedTrack revenue is unavailable</strong><Button className="secondary-button" onClick={() => setRefresh(value => value + 1)}>Retry</Button></div>
        : rows.length === 0 ? <div className="empty-state"><Database size={22} /><strong>No revenue for this period and filters</strong>{filters.length > 0 && <Button className="secondary-button" onClick={clearFilters}>Clear filters</Button>}</div>
        : <div className="table-wrap media-spend-table-wrap"><table className="data-table dense redtrack-table">
          <thead><tr>{columns.map(column => <SortableTableHead key={column.key} activeSortKey={activeSortKey} direction={direction} onSort={sort} sortKey={column.key} className={column.numeric ? "amount" : undefined}>{column.label}</SortableTableHead>)}{hasLinksColumn && <th scope="col">Advertiser dashboard</th>}</tr></thead>
          <tbody>{rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map(row => <tr key={row.key}>
            {columns.map(column => <td key={column.key} className={column.numeric ? `amount ${column.key === "revenue" ? "media-spend-amount" : ""}` : "redtrack-label-cell"}>
              {column.key === "revenue" ? money(row.revenue, data!.currency)
                : column.numeric ? Number(row[column.key]).toLocaleString()
                : column.key === "label" && ((group === "offerSources" && row.offerSourceId) || (group === "offers" && row.offerId) || (group === "trafficChannels" && row.trafficChannelId))
                  ? <button type="button" className="bank-group-drilldown" onClick={() => drill(row)} aria-label={`View revenue details for ${row.label}`}><strong>{row.label}</strong><ChevronRight size={14} /></button>
                  : <span title={String(row[column.key])}>{row[column.key]}</span>}
            </td>)}
            {hasLinksColumn && <td><div className="redtrack-link-actions">{row.offerSourceId ? <>
              {links.get(row.offerSourceId) ? <><a className="redtrack-dashboard-link" href={links.get(row.offerSourceId)} target="_blank" rel="noopener noreferrer" aria-label={`Open advertiser dashboard for ${row.offerSource}`}><ExternalLink size={14} />Open</a><Button className="icon-button" aria-label={`Edit dashboard link for ${row.offerSource}`} onClick={() => openLinkEditor(row.offerSourceId)}><Pencil size={13} /></Button></>
                : <Button className="icon-text-button" onClick={() => openLinkEditor(row.offerSourceId)} aria-label={`Add dashboard link for ${row.offerSource}`}><Link2 size={14} />Add link</Button>}
            </> : "—"}</div></td>}
          </tr>)}</tbody>
          <tfoot><tr className="total-row"><td colSpan={columns.length - 2}>Filtered total</td><td className="amount">{summary.conversions.toLocaleString()}</td><td className="amount">{money(summary.revenue, data!.currency)}</td>{hasLinksColumn && <td />}</tr></tfoot>
        </table></div>}
      {data && <footer className="media-spend-table-footer"><span>{data.currency} · {data.timezone} · Oldest sync {new Intl.DateTimeFormat("en-US", { timeZone: data.timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(data.savedAt))}</span><div className="media-spend-pagination"><span>Page {currentPage + 1} of {pageCount}</span><Button className="icon-button" aria-label="Previous RedTrack page" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={14} /></Button><Button className="icon-button" aria-label="Next RedTrack page" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}><ChevronRight size={14} /></Button></div></footer>}
    </section>
    <Dialog open={editSource !== null} onOpenChange={open => { if (!open && !saving) setEditSource(null); }}>
      <DialogContent className="redtrack-link-dialog"><DialogHeader><DialogTitle>Advertiser dashboard</DialogTitle><DialogDescription>Save the reporting portal for this offer source.</DialogDescription></DialogHeader>
        <form onSubmit={saveLink} className="redtrack-link-form">
          <label>Offer source<NativeSelect aria-label="Advertiser link offer source" value={editSource ?? ""} disabled={saving} onValueChange={openLinkEditor}><NativeSelectOption value="">Choose offer source</NativeSelectOption>{dimensions.sources.map(source => <NativeSelectOption key={source.id} value={source.id}>{source.name}</NativeSelectOption>)}</NativeSelect></label>
          <label>Dashboard URL<Input type="url" autoComplete="off" value={linkUrl} onChange={event => setLinkUrl(event.target.value)} placeholder="https://advertiser.example.com/dashboard" disabled={saving} /></label>
          {linkError && <p className="danger-text" role="alert">{linkError}</p>}
          <div className="redtrack-dialog-actions">{editSource && links.has(editSource) && <Button type="button" className="secondary-button" disabled={saving} onClick={() => setLinkUrl("")}>Clear URL</Button>}<Button type="submit" disabled={!editSource || saving}>{saving && <Loader2 size={14} className="spin" />}Save link</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  </section>;
}
