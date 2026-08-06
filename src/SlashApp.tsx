import {
  Banknote,
  Check,
  CircleAlert,
  CreditCard,
  FileDown,
  Loader2,
  LogOut,
  Moon,
  RefreshCw,
  Sun,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { BankPeriodPicker } from "@/components/ui/calendar-period-picker";
import {
  ActiveFilterBar,
  type ActiveFilter,
  FilterFieldGroup,
  FilterPopover,
  ToolbarSearchField
} from "@/components/ui/filter-toolbar";
import { InfoPopover } from "@/components/ui/finance-visuals";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import {
  compareTableValues,
  SortableTableHead,
  type TableSortDirection
} from "@/components/ui/sortable-table-head";
import { useUrlDateRangeState, useUrlState, type UrlDateRange } from "@/lib/url-state";
import {
  bankExpenseReportFileName,
  generateBankExpenseReportPdf
} from "../shared/bankExpenseReport";
import {
  bankGroupAmountTotal,
  groupBankTransactions,
  isSocialMediaGroup,
  type BankMerchantGroup,
  type BankMerchantProvider
} from "../shared/bankMerchantGroups";
import type { CurrencyTotals, DashboardSnapshot, Transaction, TransactionPage } from "../shared/types";
import { slashDefaultActivityWindowDays } from "../shared/slashApi";

const apiBase = import.meta.env.VITE_API_BASE || "/api";
const themeStorageKey = "finance-dash-theme";
const transactionPageSize = 200;
type ThemeMode = "light" | "dark";
type SlashDirectionFilter = "all" | "in" | "out";
type SlashGroupSortKey = "accounts" | "credits" | "firstDate" | "lastDate" | "merchant" | "net" | "spend" | "transactions";

function localIsoDate(date = new Date()): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function defaultSlashPeriod(): UrlDateRange {
  const toDate = localIsoDate();
  return { fromDate: `${toDate.slice(0, 7)}-01`, toDate };
}

function money(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(value);
}

function currencySummary(totals: CurrencyTotals): string {
  const values = Object.entries(totals)
    .filter(([, amount]) => Math.abs(amount) >= 0.005)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, amount]) => money(amount, currency));
  return values.length > 0 ? values.join(" · ") : "—";
}

function groupTotals(groups: readonly BankMerchantGroup[], field: "credits" | "net" | "spend"): CurrencyTotals {
  const totals: CurrencyTotals = {};
  for (const group of groups) {
    for (const [currency, amount] of Object.entries(group[field])) {
      totals[currency] = Math.round(((totals[currency] ?? 0) + amount) * 100) / 100;
    }
  }
  return totals;
}

function dateLabel(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

async function apiErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  return body?.message || fallback;
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timeout);
      reject(new DOMException("The request was aborted", "AbortError"));
    }, { once: true });
  });
}

async function loadAllSlashTransactions(
  period: UrlDateRange,
  signal: AbortSignal,
  onProgress: (count: number) => void
): Promise<{ transactions: Transaction[]; missingRanges: UrlDateRange[] }> {
  const transactions = new Map<string, Transaction>();
  const seenCursors = new Set<string>();
  let cursor: string | null = null;
  let missingRanges: UrlDateRange[] = [];

  while (true) {
    const query = new URLSearchParams({
      fromDate: period.fromDate,
      toDate: period.toDate,
      source: "slash",
      order: "desc",
      limit: String(transactionPageSize)
    });
    if (cursor) query.set("cursor", cursor);
    const response = await fetch(`${apiBase}/transactions?${query.toString()}`, { signal });
    if (!response.ok) throw new Error(await apiErrorMessage(response, "Slash activity could not be loaded"));
    const page = (await response.json()) as TransactionPage;
    for (const transaction of page.transactions) transactions.set(transaction.id, transaction);
    onProgress(transactions.size);
    if (!cursor) {
      missingRanges = page.coverage
        ?.find((coverage) => coverage.source === "slash")
        ?.missingRanges ?? [];
    }
    if (page.isDone) break;
    if (!page.continueCursor || seenCursors.has(page.continueCursor)) {
      throw new Error("Slash activity pagination returned an invalid cursor");
    }
    seenCursors.add(page.continueCursor);
    cursor = page.continueCursor;
  }

  return { transactions: [...transactions.values()], missingRanges };
}

async function syncSlashPeriod(period: UrlDateRange, signal: AbortSignal): Promise<void> {
  const response = await fetch(`${apiBase}/transactions/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: "slash", ...period }),
    signal
  });
  if (!response.ok && response.status !== 202) {
    throw new Error(await apiErrorMessage(response, "Slash activity could not be synced"));
  }
  const queued = (await response.json()) as { key?: string };
  if (!queued.key) throw new Error("Slash sync returned no job key");

  for (let attempt = 0; attempt < 120; attempt += 1) {
    await abortableDelay(5_000, signal);
    const status = await fetch(`${apiBase}/transactions/sync?${new URLSearchParams({ key: queued.key })}`, { signal });
    if (status.status === 202) continue;
    if (!status.ok) throw new Error(await apiErrorMessage(status, "Slash activity sync failed"));
    return;
  }
  throw new Error("Slash activity sync did not finish within ten minutes");
}

function missingRangePeriod(ranges: readonly UrlDateRange[]): UrlDateRange {
  return {
    fromDate: ranges.reduce((earliest, range) => range.fromDate < earliest ? range.fromDate : earliest, ranges[0].fromDate),
    toDate: ranges.reduce((latest, range) => range.toDate > latest ? range.toDate : latest, ranges[0].toDate)
  };
}

function ThemeToggle({ themeMode, onToggle }: { themeMode: ThemeMode; onToggle: () => void }) {
  const dark = themeMode === "dark";
  return (
    <Button
      aria-label={`Switch to ${dark ? "light" : "dark"} mode`}
      aria-pressed={dark}
      className={`theme-toggle ${dark ? "dark" : "light"}`}
      onClick={onToggle}
      title={`Switch to ${dark ? "light" : "dark"} mode`}
      type="button"
    >
      <span className="theme-toggle-option"><Sun size={15} /></span>
      <span className="theme-toggle-option"><Moon size={15} /></span>
      <span className="theme-toggle-thumb" aria-hidden="true">{dark ? <Moon size={16} /> : <Sun size={16} />}</span>
    </Button>
  );
}

function SlashSidebar({
  isSyncing,
  onSync,
  onToggleTheme,
  themeMode
}: {
  isSyncing: boolean;
  onSync: () => void;
  onToggleTheme: () => void;
  themeMode: ThemeMode;
}) {
  return (
    <aside className="sidebar slash-sidebar" aria-label="Slash workspace navigation">
      <div className="mobile-command-bar slash-mobile-command-bar">
        <div className="mobile-nav-trigger slash-mobile-title"><CreditCard size={17} /><span>Slash activity</span></div>
        <Button className="icon-button" aria-label="Sync Slash activity" disabled={isSyncing} onClick={onSync} type="button">
          {isSyncing ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
        </Button>
        <Button className="icon-button" aria-label={`Switch to ${themeMode === "dark" ? "light" : "dark"} mode`} onClick={onToggleTheme} type="button">
          {themeMode === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </Button>
        <a className="icon-button slash-mobile-logout" aria-label="Log out" href="/logout"><LogOut size={16} /></a>
      </div>
      <div className="sidebar-brand"><Banknote size={19} /><strong>Finance</strong></div>
      <nav className="sidebar-nav">
        <Button className="active" aria-current="page" type="button"><CreditCard size={17} /><span>Slash activity</span></Button>
      </nav>
      <div className="sidebar-footer slash-sidebar-footer">
        <Button className="sidebar-action-item" disabled={isSyncing} onClick={onSync} type="button">
          {isSyncing ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
          <span>{isSyncing ? "Syncing" : "Sync Slash"}</span>
        </Button>
        <div className="slash-theme-row"><ThemeToggle themeMode={themeMode} onToggle={onToggleTheme} /></div>
        <a className="sidebar-action-item sidebar-logout-action" href="/logout"><LogOut size={15} /><span>Log out</span></a>
      </div>
    </aside>
  );
}

function SlashMerchantGroupTable({
  emptyLabel,
  generatingPdfKey,
  groups,
  isLoading,
  loadedCount,
  onDownloadPdf,
  onRequestSort,
  sortDirection,
  sortKey
}: {
  emptyLabel: string;
  generatingPdfKey: string | null;
  groups: readonly BankMerchantGroup[];
  isLoading: boolean;
  loadedCount: number;
  onDownloadPdf: (group: BankMerchantGroup) => void;
  onRequestSort: (sortKey: SlashGroupSortKey) => void;
  sortDirection: TableSortDirection;
  sortKey: SlashGroupSortKey;
}) {
  return (
    <div className="table-wrap slash-group-table-wrap">
      <table className="data-table modern-income-table slash-group-table">
        <thead><tr>
          <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={onRequestSort} sortKey="merchant">Merchant</SortableTableHead>
          <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={onRequestSort} sortKey="transactions">Transactions</SortableTableHead>
          <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={onRequestSort} sortKey="accounts">Accounts</SortableTableHead>
          <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={onRequestSort} sortKey="firstDate">First activity</SortableTableHead>
          <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={onRequestSort} sortKey="lastDate">Latest activity</SortableTableHead>
          <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={onRequestSort} sortKey="spend">Spend</SortableTableHead>
          <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={onRequestSort} sortKey="credits">Credits</SortableTableHead>
          <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={onRequestSort} sortKey="net">Net</SortableTableHead>
          <th aria-label="Expense PDF" className="action-column" scope="col" />
        </tr></thead>
        <tbody>
          {groups.map((group) => {
            const aliases = group.aliases.filter((alias) => alias.toLowerCase() !== group.name.toLowerCase());
            const netTotal = bankGroupAmountTotal(group.net);
            return (
              <tr key={group.key}>
                <td className="counterparty-cell"><strong>{group.name}</strong><small>{aliases.length > 0 ? `${aliases.slice(0, 2).join(" · ")}${aliases.length > 2 ? ` · +${aliases.length - 2}` : ""}` : "Canonical merchant"}</small></td>
                <td>{group.transactionCount.toLocaleString("en-US")}</td>
                <td><strong>{group.accountNames.length.toLocaleString("en-US")}</strong><small className="slash-cell-detail">{group.accountNames[0]}</small></td>
                <td>{dateLabel(group.firstDate)}</td>
                <td>{dateLabel(group.lastDate)}</td>
                <td className="amount">{currencySummary(group.spend)}</td>
                <td className="amount slash-credit-amount">{currencySummary(group.credits)}</td>
                <td className={`amount ${netTotal < 0 ? "slash-net-spend" : netTotal > 0 ? "slash-credit-amount" : ""}`}>{currencySummary(group.net)}</td>
                <td className="action-column">
                  <Button
                    aria-label={`Download ${group.name} expense PDF`}
                    className="icon-button"
                    disabled={generatingPdfKey !== null}
                    onClick={() => onDownloadPdf(group)}
                    title={`Generate expense PDF for ${group.name}`}
                    type="button"
                  >
                    {generatingPdfKey === group.key ? <Loader2 className="spin" size={15} /> : <FileDown size={15} />}
                  </Button>
                </td>
              </tr>
            );
          })}
          {groups.length === 0 && (
            <tr><td colSpan={9}>{isLoading ? `Loading Slash activity${loadedCount > 0 ? ` · ${loadedCount.toLocaleString("en-US")} transactions` : ""}…` : emptyLabel}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function SlashApp() {
  const defaultPeriod = useMemo(defaultSlashPeriod, []);
  const [period, setPeriod] = useUrlDateRangeState("from", "to", defaultPeriod);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() =>
    window.localStorage.getItem(themeStorageKey) === "dark" ? "dark" : "light"
  );
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [providers, setProviders] = useState<BankMerchantProvider[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [loadedCount, setLoadedCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useUrlState("q", "");
  const [direction, setDirection] = useUrlState<SlashDirectionFilter>("direction", "all", {
    allowedValues: ["all", "in", "out"]
  });
  const [account, setAccount] = useUrlState("account", "all");
  const [sortKey, setSortKey] = useUrlState<SlashGroupSortKey>("sort", "spend", {
    allowedValues: ["accounts", "credits", "firstDate", "lastDate", "merchant", "net", "spend", "transactions"]
  });
  const [sortDirection, setSortDirection] = useUrlState<TableSortDirection>("order", "desc", {
    allowedValues: ["asc", "desc"]
  });
  const [generatingPdfKey, setGeneratingPdfKey] = useState<string | null>(null);
  const activityAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", themeMode === "dark");
    window.localStorage.setItem(themeStorageKey, themeMode);
  }, [themeMode]);

  useEffect(() => {
    document.title = "Slash · Finance";
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`${apiBase}/dashboard`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await apiErrorMessage(response, "Company aliases could not be loaded"));
        return response.json() as Promise<DashboardSnapshot>;
      })
      .then((dashboard) => setProviders(dashboard.providers))
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setNotice(caught instanceof Error ? caught.message : "Company aliases could not be loaded");
      });
    return () => controller.abort();
  }, []);

  async function loadPeriod(nextPeriod: UrlDateRange, allowHistoricalSync: boolean): Promise<void> {
    activityAbortRef.current?.abort();
    const controller = new AbortController();
    activityAbortRef.current = controller;
    setIsLoading(true);
    setLoadedCount(0);
    setError(null);
    setTransactions([]);
    try {
      let result = await loadAllSlashTransactions(nextPeriod, controller.signal, setLoadedCount);
      if (allowHistoricalSync && result.missingRanges.length > 0) {
        setIsSyncing(true);
        setNotice("Syncing missing Slash activity for this period…");
        await syncSlashPeriod(missingRangePeriod(result.missingRanges), controller.signal);
        result = await loadAllSlashTransactions(nextPeriod, controller.signal, setLoadedCount);
        if (result.missingRanges.length > 0) {
          throw new Error("Slash activity is still incomplete after the historical sync");
        }
        setNotice("Slash activity is up to date.");
      }
      setTransactions(result.transactions);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : "Slash activity could not be loaded");
    } finally {
      if (activityAbortRef.current === controller) {
        setIsLoading(false);
        setIsSyncing(false);
      }
    }
  }

  useEffect(() => {
    void loadPeriod(period, true);
    return () => activityAbortRef.current?.abort();
  }, [period.fromDate, period.toDate]);

  const accountOptions = useMemo(() => [...new Set(transactions.map((transaction) => transaction.accountName))]
    .sort((left, right) => left.localeCompare(right)), [transactions]);

  useEffect(() => {
    if (account !== "all" && !accountOptions.includes(account)) setAccount("all");
  }, [account, accountOptions, setAccount]);

  const allGroups = useMemo(() => groupBankTransactions(
    transactions.filter((transaction) =>
      (direction === "all" || transaction.direction === direction)
      && (account === "all" || transaction.accountName === account)
    ),
    providers
  ), [account, direction, providers, transactions]);

  const rows = useMemo(() => {
    const search = query.trim().toLowerCase();
    function sortValue(group: BankMerchantGroup): number | string {
      if (sortKey === "accounts") return group.accountNames.length;
      if (sortKey === "credits") return bankGroupAmountTotal(group.credits);
      if (sortKey === "firstDate") return group.firstDate;
      if (sortKey === "lastDate") return group.lastDate;
      if (sortKey === "merchant") return group.name;
      if (sortKey === "net") return bankGroupAmountTotal(group.net);
      if (sortKey === "transactions") return group.transactionCount;
      return bankGroupAmountTotal(group.spend);
    }
    return allGroups
      .filter((group) => !search || `${group.name} ${group.aliases.join(" ")} ${group.accountNames.join(" ")}`.toLowerCase().includes(search))
      .sort((left, right) =>
        compareTableValues(sortValue(left), sortValue(right), sortDirection)
        || left.name.localeCompare(right.name)
      );
  }, [allGroups, query, sortDirection, sortKey]);

  const socialMediaGroups = useMemo(() => allGroups.filter(isSocialMediaGroup), [allGroups]);
  const socialMediaRows = useMemo(() => rows.filter(isSocialMediaGroup), [rows]);
  const otherRows = useMemo(() => rows.filter((group) => !isSocialMediaGroup(group)), [rows]);

  function requestSort(nextSortKey: SlashGroupSortKey): void {
    if (nextSortKey === sortKey) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(nextSortKey);
    setSortDirection(nextSortKey === "merchant" || nextSortKey === "firstDate" || nextSortKey === "lastDate" ? "asc" : "desc");
  }

  async function manualSync(): Promise<void> {
    activityAbortRef.current?.abort();
    const controller = new AbortController();
    activityAbortRef.current = controller;
    setIsSyncing(true);
    setError(null);
    setNotice("Syncing Slash activity for this period…");
    try {
      await syncSlashPeriod(period, controller.signal);
      setNotice("Slash activity is up to date.");
      await loadPeriod(period, false);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : "Slash activity could not be synced");
      setIsSyncing(false);
    }
  }

  async function downloadExpensePdf(group: BankMerchantGroup): Promise<void> {
    setGeneratingPdfKey(group.key);
    setError(null);
    try {
      const bytes = await generateBankExpenseReportPdf(group, period);
      const blobBytes = new Uint8Array(bytes.byteLength);
      blobBytes.set(bytes);
      const url = URL.createObjectURL(new Blob([blobBytes], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = bankExpenseReportFileName(group, period);
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Expense PDF could not be generated");
    } finally {
      setGeneratingPdfKey(null);
    }
  }

  const activeFilters: ActiveFilter[] = [
    ...(direction === "all" ? [] : [{
      key: "direction",
      label: direction === "out" ? "Activity: Spend" : "Activity: Credits",
      onRemove: () => setDirection("all")
    }]),
    ...(account === "all" ? [] : [{
      key: "account",
      label: `Account: ${account}`,
      onRemove: () => setAccount("all")
    }])
  ];

  const spend = groupTotals(socialMediaGroups, "spend");
  const credits = groupTotals(socialMediaGroups, "credits");
  const settledTransactionCount = socialMediaGroups.reduce((sum, group) => sum + group.transactionCount, 0);

  return (
    <main className="app-shell slash-app-shell">
      <SlashSidebar
        isSyncing={isSyncing}
        onSync={() => void manualSync()}
        onToggleTheme={() => setThemeMode((current) => current === "dark" ? "light" : "dark")}
        themeMode={themeMode}
      />
      <div className="main-column">
        {(error || notice) && (
          <div className={error ? "toast error" : "toast"} role={error ? "alert" : "status"} aria-live={error ? "assertive" : "polite"}>
            {error ? <CircleAlert size={16} /> : <Check size={16} />}
            <span>{error || notice}</span>
            <Button aria-label="Dismiss" onClick={() => error ? setError(null) : setNotice(null)}><X size={14} /></Button>
          </div>
        )}

        <header className="topbar slash-topbar">
          <div>
            <p className="eyebrow">Slash workspace</p>
            <h1>Grouped transaction activity</h1>
            <div className="meta-row"><span>{dateLabel(period.fromDate)} – {dateLabel(period.toDate)}</span></div>
          </div>
          <Button className="secondary-button" disabled={isSyncing} onClick={() => void manualSync()} type="button">
            {isSyncing ? <Loader2 className="spin" size={15} /> : <RefreshCw size={15} />}
            {isSyncing ? "Syncing" : "Sync Slash"}
          </Button>
        </header>

        <section className="wise-summary-grid slash-summary-grid" aria-label="Social media period summary">
          <article className="summary-tile"><span>Ad spend</span><strong>{currencySummary(spend)}</strong></article>
          <article className="summary-tile"><span>Ad credits</span><strong>{currencySummary(credits)}</strong></article>
          <article className="summary-tile"><span>Platforms</span><strong>{socialMediaGroups.length.toLocaleString("en-US")}</strong></article>
          <article className="summary-tile"><span>Transactions</span><strong>{settledTransactionCount.toLocaleString("en-US")}</strong></article>
        </section>

        <section className="panel wide-panel slash-groups-panel slash-priority-groups-panel">
          <div className="panel-header compact unified-bank-header slash-groups-header">
            <div className="unified-bank-title">
              <div>
                <div className="slash-heading-with-info">
                  <p className="eyebrow">Priority activity</p>
                  <InfoPopover label="social media grouping">Meta includes Facebook, Facebk, Instagram, Oculus, and WhatsApp. TikTok includes ByteDance. NewsBreak descriptors are grouped as NewsBreak.</InfoPopover>
                </div>
                <h2>Social media</h2>
              </div>
              <span className="total-pill">{socialMediaRows.length} groups</span>
            </div>
            <div className="list-toolbar unified-bank-toolbar slash-groups-toolbar">
              <div className="list-toolbar-main">
                <ToolbarSearchField
                  ariaLabel="Search grouped Slash merchants"
                  className="bank-toolbar-search"
                  onChange={setQuery}
                  placeholder="Search all merchants"
                  value={query}
                />
                <FilterPopover activeCount={activeFilters.length} title="Slash activity filters">
                  <FilterFieldGroup title="Activity">
                    <label>
                      Direction
                      <NativeSelect value={direction} onValueChange={(value) => setDirection(value as SlashDirectionFilter)}>
                        <NativeSelectOption value="all">Spend & credits</NativeSelectOption>
                        <NativeSelectOption value="out">Spend only</NativeSelectOption>
                        <NativeSelectOption value="in">Credits only</NativeSelectOption>
                      </NativeSelect>
                    </label>
                    <label>
                      Account
                      <NativeSelect value={account} onValueChange={setAccount}>
                        <NativeSelectOption value="all">All Slash accounts</NativeSelectOption>
                        {accountOptions.map((name) => <NativeSelectOption key={name} value={name}>{name}</NativeSelectOption>)}
                      </NativeSelect>
                    </label>
                  </FilterFieldGroup>
                </FilterPopover>
              </div>
              <div className="slash-period-picker">
                <BankPeriodPicker
                  dateRange={period}
                  isLoading={isLoading || isSyncing}
                  onLoad={setPeriod}
                  windowDays={slashDefaultActivityWindowDays}
                />
              </div>
            </div>
          </div>
          <ActiveFilterBar
            filters={activeFilters}
            resultLabel={`${socialMediaRows.length} social groups · ${otherRows.length} other groups shown`}
            onClearAll={() => { setDirection("all"); setAccount("all"); }}
          />
          <SlashMerchantGroupTable
            emptyLabel="No Meta, TikTok, or NewsBreak activity matches this view"
            generatingPdfKey={generatingPdfKey}
            groups={socialMediaRows}
            isLoading={isLoading}
            loadedCount={loadedCount}
            onDownloadPdf={(group) => void downloadExpensePdf(group)}
            onRequestSort={requestSort}
            sortDirection={sortDirection}
            sortKey={sortKey}
          />
        </section>

        <section className="panel wide-panel slash-groups-panel slash-secondary-groups-panel">
          <div className="panel-header compact slash-secondary-groups-header">
            <div>
              <p className="eyebrow">Remaining ledger</p>
              <h2>Other Slash merchants</h2>
            </div>
            <span className="total-pill">{otherRows.length} groups</span>
          </div>
          <SlashMerchantGroupTable
            emptyLabel="No other Slash activity matches this view"
            generatingPdfKey={generatingPdfKey}
            groups={otherRows}
            isLoading={isLoading}
            loadedCount={loadedCount}
            onDownloadPdf={(group) => void downloadExpensePdf(group)}
            onRequestSort={requestSort}
            sortDirection={sortDirection}
            sortKey={sortKey}
          />
        </section>
      </div>
    </main>
  );
}
