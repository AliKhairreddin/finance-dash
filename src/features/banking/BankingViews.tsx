import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, CircleAlert, Coins, Download, Edit3, Loader2, Plus, RefreshCw, Trash2, Wallet, X } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { ActiveFilterBar, type ActiveFilter, FilterFieldGroup, FilterPopover, ToolbarSearchField } from "@/components/ui/filter-toolbar";
import { AnimatedNumber, InfoPopover } from "@/components/ui/finance-visuals";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { SortableTableHead, type TableSortDirection } from "@/components/ui/sortable-table-head";
import { Textarea } from "@/components/ui/textarea";
import type {
  CreateHoldingPayload,
  DashboardSnapshot,
  DataSource,
  Holding,
  HoldingAssetType,
  HoldingKind,
  Provider,
  Transaction,
  TransactionMatchFilter,
  TransactionSortKey,
  UpdateHoldingPayload
} from "../../../shared/types";
import type { BankActivitySummary } from "../../../shared/bankMerchantGroups";
import { bankSources, type BankSource } from "../../../shared/banks";
import {
  isInternalTransferTransaction,
  isNonOperatingMovementTransaction,
  transactionCounterpartyLabel,
  transactionDescriptionLabel,
  transactionMovementLabel
} from "../../../shared/transactionPresentation";
import {
  wiseEntityLabel,
  wiseEntityShortLabel
} from "../../../shared/wiseEntities";
import { exportBankTransactionsCsv } from "./exportTransactions";
import {
  BankActivityViewToggle,
  BankAccountActivityView,
  BankCardActivityView,
  BankMerchantGroupView,
  type BankActivityViewMode
} from "./BankActivityViews";

const transactionSources: Array<{ value: DataSource; label: string }> = [
  { value: "wise", label: "Wise" },
  { value: "revolut", label: "Revolut" },
  { value: "slash", label: "Slash" },
  { value: "amex", label: "Amex" },
  { value: "merit", label: "Merit" },
  { value: "manual", label: "Manual" },
  { value: "tune", label: "TUNE" }
];
function money(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value);
}

function quantity(value: number, asset: string): string {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 }).format(value)} ${asset}`;
}

function dateLabel(value: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function sourceLabel(source: DataSource): string {
  return transactionSources.find((item) => item.value === source)?.label ?? source;
}

export function AllBankTransactionsView({
  dashboard,
  providersById,
  rangeControls,
  activityView,
  setActivityView,
  period,
  source,
  setSource,
  transactions,
  searchTerm,
  setSearchTerm,
  bankDirection,
  setBankDirection,
  bankAccountFilter,
  setBankAccountFilter,
  bankCategoryFilter,
  setBankCategoryFilter,
  teamFilter,
  setTeamFilter,
  matchFilter,
  setMatchFilter,
  transactionSortKey,
  setTransactionSortKey,
  transactionSortDirection,
  setTransactionSortDirection,
  hasPrevious,
  hasMore,
  isLoading,
  loadError,
  totalCount,
  activitySummary,
  isLoadingActivitySummary,
  activitySummaryError,
  onLoadPrevious,
  onLoadMore,
  onRetryActivitySummary
}: {
  dashboard: DashboardSnapshot;
  providersById: Map<string, Provider>;
  rangeControls: ReactNode;
  activityView: BankActivityViewMode;
  setActivityView: (view: BankActivityViewMode) => void;
  period: { fromDate: string; toDate: string };
  source: "all" | BankSource;
  setSource: (source: "all" | BankSource) => void;
  transactions: Transaction[];
  searchTerm: string;
  setSearchTerm: (value: string) => void;
  bankDirection: "all" | "in" | "out";
  setBankDirection: (direction: "all" | "in" | "out") => void;
  bankAccountFilter: string;
  setBankAccountFilter: (accountId: string) => void;
  bankCategoryFilter: string;
  setBankCategoryFilter: (category: string) => void;
  teamFilter: string;
  setTeamFilter: (teamId: string) => void;
  matchFilter: TransactionMatchFilter;
  setMatchFilter: (value: TransactionMatchFilter) => void;
  transactionSortKey: TransactionSortKey;
  setTransactionSortKey: (value: TransactionSortKey) => void;
  transactionSortDirection: TableSortDirection;
  setTransactionSortDirection: (value: TableSortDirection) => void;
  hasPrevious: boolean;
  hasMore: boolean;
  isLoading: boolean;
  loadError: string | null;
  totalCount?: number;
  activitySummary: BankActivitySummary | null;
  isLoadingActivitySummary: boolean;
  activitySummaryError: string | null;
  onLoadPrevious: () => Promise<void>;
  onLoadMore: () => Promise<void>;
  onRetryActivitySummary: () => Promise<void>;
}) {
  const query = searchTerm;
  const setQuery = setSearchTerm;
  const direction = bankDirection;
  const setDirection = setBankDirection;
  const account = bankAccountFilter;
  const setAccount = setBankAccountFilter;
  const category = bankCategoryFilter;
  const setCategory = setBankCategoryFilter;
  const owner = teamFilter;
  const setOwner = setTeamFilter;
  const match = matchFilter;
  const setMatch = setMatchFilter;
  const sortKey = transactionSortKey;
  const setSortKey = setTransactionSortKey;
  const sortDirection = transactionSortDirection;
  const setSortDirection = setTransactionSortDirection;
  const teamsById = useMemo(() => new Map(dashboard.teams.map((team) => [team.id, team])), [dashboard.teams]);
  const expenseByTransactionId = useMemo(
    () => new Map(dashboard.expenses.flatMap((expense) => expense.transactionId ? [[expense.transactionId, expense] as const] : [])),
    [dashboard.expenses]
  );
  const accountOptions = useMemo(
    () => dashboard.accounts
      .filter((item) => bankSources.some((bankSource) => bankSource.id === item.source))
      .sort((left, right) => sourceLabel(left.source).localeCompare(sourceLabel(right.source)) || left.name.localeCompare(right.name)),
    [dashboard.accounts]
  );

  useEffect(() => {
    if (account === "all") return;
    const selectedAccount = accountOptions.find((item) => item.id === account);
    if (!selectedAccount || (source !== "all" && selectedAccount.source !== source)) setAccount("all");
  }, [account, accountOptions, setAccount, source]);

  const rows = transactions;

  function requestSort(nextSortKey: TransactionSortKey) {
    if (nextSortKey === sortKey) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(nextSortKey);
    setSortDirection("asc");
  }

  const bankActiveFilters: ActiveFilter[] = [
    ...(source === "all" ? [] : [{
      key: "source",
      label: `Source: ${sourceLabel(source)}`,
      onRemove: () => setSource("all")
    }]),
    ...(account === "all" ? [] : [{
      key: "account",
      label: `Account: ${accountOptions.find((item) => item.id === account)?.name ?? account}`,
      onRemove: () => setAccount("all")
    }]),
    ...(direction === "all" ? [] : [{
      key: "direction",
      label: `Direction: ${direction === "in" ? "Money in" : "Money out"}`,
      onRemove: () => setDirection("all")
    }]),
    ...(category === "all" ? [] : [{
      key: "category",
      label: `Category: ${category}`,
      onRemove: () => setCategory("all")
    }]),
    ...(match === "all" ? [] : [{
      key: "match",
      label: match === "matched" ? "Status: Categorized" : "Status: Needs category",
      onRemove: () => setMatch("all")
    }]),
    ...(owner === "all" ? [] : [{
      key: "owner",
      label: `Owner: ${owner === "unassigned" ? "Unassigned" : dashboard.teams.find((item) => item.id === owner)?.name ?? owner}`,
      onRemove: () => setOwner("all")
    }])
  ];

  return (
    <section className="panel wide-panel">
      <div className="panel-header compact unified-bank-header">
        <div className="unified-bank-title">
          <div><p className="eyebrow">Unified ledger</p><h2>All bank transactions</h2></div>
          <span className="total-pill">
            {totalCount === undefined ? `${rows.length} on page` : `${rows.length} of ${totalCount.toLocaleString("en-US")}`}
          </span>
        </div>
        <div className="list-toolbar unified-bank-toolbar">
          <div className="list-toolbar-main">
            <ToolbarSearchField
              ariaLabel="Search all bank transactions"
              className="bank-toolbar-search"
              placeholder="Search transactions"
              value={query}
              onChange={setQuery}
            />
            <FilterPopover activeCount={bankActiveFilters.length} title="Bank transaction filters">
              <FilterFieldGroup title="Transaction">
                <label>
                  Source
                  <NativeSelect
                    aria-label="Filter bank transactions by source"
                    value={source}
                    onValueChange={(value) => {
                      const nextSource = value as "all" | BankSource;
                      setSource(nextSource);
                      const selectedAccount = accountOptions.find((item) => item.id === account);
                      if (nextSource !== "all" && selectedAccount?.source !== nextSource) setAccount("all");
                    }}
                  >
                    <NativeSelectOption value="all">All sources</NativeSelectOption>
                    {bankSources.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.label}</NativeSelectOption>)}
                  </NativeSelect>
                </label>
                <label>
                  Account
                  <NativeSelect aria-label="Filter bank transactions by account" value={account} onValueChange={setAccount}>
                    <NativeSelectOption value="all">All accounts</NativeSelectOption>
                    {accountOptions
                      .filter((item) => source === "all" || item.source === source)
                      .map((item) => (
                        <NativeSelectOption key={item.id} value={item.id}>
                          {source === "all" ? `${sourceLabel(item.source)} · ${item.name}` : item.name}
                        </NativeSelectOption>
                      ))}
                  </NativeSelect>
                </label>
                <label>
                  Direction
                  <NativeSelect aria-label="Filter bank transactions by direction" value={direction} onValueChange={(value) => setDirection(value as "all" | "in" | "out")}>
                    <NativeSelectOption value="all">Money in & out</NativeSelectOption>
                    <NativeSelectOption value="in">Money in</NativeSelectOption>
                    <NativeSelectOption value="out">Money out</NativeSelectOption>
                  </NativeSelect>
                </label>
                <label>
                  Transaction status
                  <NativeSelect aria-label="Filter bank transactions by transaction status" value={match} onValueChange={(value) => setMatch(value as TransactionMatchFilter)}>
                    <NativeSelectOption value="all">All transactions</NativeSelectOption>
                    <NativeSelectOption value="matched">Categorized</NativeSelectOption>
                    <NativeSelectOption value="needs-review">Needs category</NativeSelectOption>
                  </NativeSelect>
                </label>
                <label>
                  Category
                  <NativeSelect aria-label="Filter bank transactions by category" value={category} onValueChange={setCategory}>
                    <NativeSelectOption value="all">All categories</NativeSelectOption>
                    {[...dashboard.transactionCategories]
                      .sort((left, right) => left.name.localeCompare(right.name))
                      .map((item) => <NativeSelectOption key={item.id} value={item.name}>{item.name}</NativeSelectOption>)}
                  </NativeSelect>
                </label>
                <label>
                  Owner
                  <NativeSelect aria-label="Filter bank transactions by owner" value={owner} onValueChange={setOwner}>
                    <NativeSelectOption value="all">All owners</NativeSelectOption>
                    <NativeSelectOption value="unassigned">Unassigned</NativeSelectOption>
                    {dashboard.teams.map((team) => <NativeSelectOption key={team.id} value={team.id}>{team.name}</NativeSelectOption>)}
                  </NativeSelect>
                </label>
              </FilterFieldGroup>
            </FilterPopover>
            <BankActivityViewToggle value={activityView} onChange={setActivityView} />
          </div>
          <div className="list-toolbar-actions">
            {rangeControls}
            <Button
              aria-label="Export loaded CSV"
              className="icon-button"
              type="button"
              disabled={rows.length === 0}
              title={`Export ${rows.length} loaded row${rows.length === 1 ? "" : "s"} from this filtered view`}
              onClick={() => exportBankTransactionsCsv({
                providersById,
                rows,
                scope: "all",
                teamsById
              })}
            >
              <Download size={15} />
            </Button>
          </div>
        </div>
      </div>
      <ActiveFilterBar
        filters={bankActiveFilters}
        resultLabel={totalCount === undefined
          ? `${rows.length} transactions on this page`
          : `${rows.length} of ${totalCount.toLocaleString("en-US")} matching transactions`}
        onClearAll={() => {
          setSource("all");
          setAccount("all");
          setDirection("all");
          setCategory("all");
          setMatch("all");
          setOwner("all");
        }}
      />
      {activityView === "transactions" ? <><div className="table-wrap">
        <table className="data-table modern-income-table unified-bank-table">
          <thead><tr>
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="date">Date</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="source">Source</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="account">Account</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="counterparty">Counterparty</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="direction">Direction</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="category">Category / company</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={requestSort} sortKey="amount">Amount</SortableTableHead>
          </tr></thead>
          <tbody>
            {rows.length > 0 ? rows.map((transaction) => {
              const provider = transaction.matchedProviderId ? providersById.get(transaction.matchedProviderId) : undefined;
              const expense = expenseByTransactionId.get(transaction.id);
              const internalTransfer = isInternalTransferTransaction(transaction);
              const nonOperatingMovement = isNonOperatingMovementTransaction(transaction);
              return <tr key={transaction.id}><td>{dateLabel(transaction.date)}</td><td><div className="bank-source-labels"><span className={`bank-source-badge source-${transaction.source}`}>{sourceLabel(transaction.source)}</span>{transaction.source === "wise" && transaction.wiseEntity && <span className={`wise-entity-badge entity-${transaction.wiseEntity}`} title={wiseEntityLabel(transaction.wiseEntity)}>{wiseEntityShortLabel(transaction.wiseEntity)}</span>}</div></td><td>{transaction.accountName}</td><td className="counterparty-cell"><strong>{transactionCounterpartyLabel(transaction)}</strong><small>{transactionDescriptionLabel(transaction)}</small></td><td><span className={`direction-label ${internalTransfer ? "transfer" : transaction.direction}`}>{transaction.direction === "in" ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{transactionMovementLabel(transaction)}</span></td><td><span>{transaction.category}</span><small>{nonOperatingMovement ? "No company needed" : provider?.name ?? (expense ? `Expense ${expense.recordNumber}` : transaction.matchedInvoiceId ? `Invoice ${transaction.matchedInvoiceId}` : "Merchant only")}</small></td><td className="amount">{money(transaction.amount, transaction.currency)}</td></tr>;
            }) : <tr><td colSpan={7}>{isLoading ? "Loading transactions…" : "No loaded transactions match these filters"}</td></tr>}
          </tbody>
        </table>
      </div>
      {(hasPrevious || hasMore || isLoading || loadError) && (
        <div className="bank-table-pagination">
          <span className={loadError ? "danger-text" : undefined}>
            {loadError ?? (totalCount === undefined
              ? `${rows.length} transactions on this page`
              : `${rows.length} of ${totalCount.toLocaleString("en-US")} matching transactions`)}
          </span>
          <div className="bank-table-pagination-actions">
            <Button className="secondary-button" type="button" disabled={isLoading || !hasPrevious} onClick={() => void onLoadPrevious()}>
              <ChevronLeft size={15} /> Previous 100
            </Button>
            <Button className="secondary-button" type="button" disabled={isLoading || (!hasMore && !loadError)} onClick={() => void onLoadMore()}>
              {isLoading ? <Loader2 className="spin" size={15} /> : loadError ? <RefreshCw size={15} /> : <ChevronRight size={15} />}
              {isLoading ? "Loading" : loadError ? "Retry" : "Next 100"}
            </Button>
          </div>
        </div>
      )}</> : activityView === "groups" ? (
        <BankMerchantGroupView
          groups={activitySummary?.merchantGroups ?? []}
          isLoading={isLoadingActivitySummary}
          loadError={activitySummaryError}
          onRetry={onRetryActivitySummary}
          period={period}
        />
      ) : activityView === "cards" ? (
        <BankCardActivityView
          groups={activitySummary?.cardGroups ?? []}
          isLoading={isLoadingActivitySummary}
          loadError={activitySummaryError}
          onRetry={onRetryActivitySummary}
        />
      ) : (
        <BankAccountActivityView
          groups={activitySummary?.accountGroups ?? []}
          isLoading={isLoadingActivitySummary}
          loadError={activitySummaryError}
          onRetry={onRetryActivitySummary}
        />
      )}
    </section>
  );
}

export function HoldingsView({
  dashboard,
  onCreate,
  onUpdate,
  onDelete,
  onRefreshRates
}: {
  dashboard: DashboardSnapshot;
  onCreate: (payload: CreateHoldingPayload) => Promise<void>;
  onUpdate: (holdingId: string, payload: UpdateHoldingPayload) => Promise<void>;
  onDelete: (holdingId: string) => Promise<void>;
  onRefreshRates: () => Promise<void>;
}) {
  const [editor, setEditor] = useState<Holding | "new" | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Holding | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ratesByAsset = new Map(dashboard.fxRates.map((rate) => [rate.asset.toUpperCase(), rate]));

  async function refreshRates() {
    setRefreshing(true);
    setError(null);
    try {
      await onRefreshRates();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Rates could not be refreshed");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="holdings-stack">
      <section className="holding-summary-band">
        <article className="holding-total-card">
          <InfoPopover label="liquid bank accounts">Converted to USD; card liabilities excluded.</InfoPopover>
          <strong><AnimatedNumber animationKey="holdings-liquid-bank-accounts" value={money(dashboard.approximateUsdTotals.accountsUsd, "USD")} /></strong>
          <span>Liquid bank accounts · approx.</span>
        </article>
        <article className="holding-total-card">
          <InfoPopover label="cash and wallets">{dashboard.holdings.length} manually tracked holdings.</InfoPopover>
          <strong><AnimatedNumber animationKey="holdings-cash-wallets" value={money(dashboard.approximateUsdTotals.holdingsUsd, "USD")} /></strong>
          <span>Cash & wallets · approx.</span>
        </article>
        <article className="holding-total-card total">
          <InfoPopover label="total available">{dashboard.approximateUsdTotals.asOf ? `Quotes ${dateLabel(dashboard.approximateUsdTotals.asOf)}.` : dashboard.approximateUsdTotals.excludedAssets.length > 0 ? "Refresh quotes to include every asset." : "No non-USD quote required."}</InfoPopover>
          <strong><AnimatedNumber animationKey="holdings-total-available" value={money(dashboard.approximateUsdTotals.totalUsd, "USD")} /></strong>
          <span>Total available · approx.</span>
        </article>
      </section>

      <section className="panel">
        <div className="panel-header income-panel-header"><div><p className="eyebrow">Cash & wallets</p><h2>Manual fiat and crypto holdings</h2></div><div className="row-actions"><Button className="secondary-button" type="button" onClick={() => void refreshRates()} disabled={refreshing}>{refreshing ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />} Refresh rates</Button><Button className="primary-button" type="button" onClick={() => setEditor("new")}><Plus size={16} /> Add holding</Button></div></div>
        <div className="income-callout"><CircleAlert size={17} /><span>USD totals use approximate Coinbase exchange rates. Native balances remain the source of truth and payment/accounting decisions should use them.</span></div>
        {dashboard.approximateUsdTotals.staleAssets.length > 0 && <div className="income-callout warning"><CircleAlert size={17} /><span>Using last-known rates for: <strong>{dashboard.approximateUsdTotals.staleAssets.join(", ")}</strong>.</span></div>}
        {dashboard.approximateUsdTotals.excludedAssets.length > 0 && <div className="income-callout warning"><CircleAlert size={17} /><span>Excluded from the approximate USD total because no quote was returned: <strong>{dashboard.approximateUsdTotals.excludedAssets.join(", ")}</strong>.</span></div>}
        {error && <div className="inline-error">{error}</div>}

        <div className="holding-card-grid">
          {dashboard.holdings.map((holding) => {
            const quote = ratesByAsset.get(holding.asset.toUpperCase());
            const isUsd = holding.asset.toUpperCase() === "USD";
            const rateUsd = isUsd ? 1 : quote?.rateUsd;
            const usdValue = rateUsd === undefined ? undefined : holding.balance * rateUsd;
            return <article className="holding-card" key={holding.id}><div className="holding-card-icon">{holding.assetType === "crypto" ? <Coins size={19} /> : <Wallet size={19} />}</div><div className="holding-card-title"><strong>{holding.name}</strong><span>{holding.kind} · {holding.assetType}</span></div><div className="holding-card-actions"><Button className="icon-button" type="button" aria-label={`Edit ${holding.name}`} onClick={() => setEditor(holding)}><Edit3 size={15} /></Button><Button className="icon-button destructive-icon-button" type="button" aria-label={`Delete ${holding.name}`} onClick={() => setDeleteTarget(holding)}><Trash2 size={15} /></Button></div><div className="holding-native-balance">{holding.assetType === "fiat" ? money(holding.balance, holding.asset) : quantity(holding.balance, holding.asset)}</div><div className="holding-usd-value">{usdValue === undefined ? "Excluded from USD total" : `≈ ${money(usdValue, "USD")}`} {!isUsd && quote && <small>at {money(quote.rateUsd, "USD")} / {holding.asset}{quote.stale ? " · last known" : ""}</small>}</div>{holding.notes && <p>{holding.notes}</p>}<small className="holding-updated">Updated {dateLabel(holding.updatedAt)}</small></article>;
          })}
          {dashboard.holdings.length === 0 && <div className="empty-state holding-empty-state"><Wallet size={24} /><strong>No cash or wallet holdings</strong><span>Add balances such as cash, Kraken, or Trust Wallet.</span></div>}
        </div>
      </section>

      {editor && <HoldingEditorDialog holding={editor === "new" ? undefined : editor} onClose={() => setEditor(null)} onSubmit={async (payload) => { if (editor === "new") await onCreate(payload); else await onUpdate(editor.id, payload); setEditor(null); }} />}
      {deleteTarget && <DeleteHoldingDialog holding={deleteTarget} onClose={() => setDeleteTarget(null)} onDelete={async () => { await onDelete(deleteTarget.id); setDeleteTarget(null); }} />}
    </div>
  );
}

function HoldingEditorDialog({ holding, onClose, onSubmit }: { holding?: Holding; onClose: () => void; onSubmit: (payload: CreateHoldingPayload) => Promise<void> }) {
  const [name, setName] = useState(holding?.name ?? "");
  const [kind, setKind] = useState<HoldingKind>(holding?.kind ?? "wallet");
  const [assetType, setAssetType] = useState<HoldingAssetType>(holding?.assetType ?? "crypto");
  const [asset, setAsset] = useState(holding?.asset ?? "");
  const [balance, setBalance] = useState(holding ? String(holding.balance) : "");
  const [notes, setNotes] = useState(holding?.notes ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsedBalance = Number(balance);
  const balanceIsValid = balance.trim() !== "" && Number.isFinite(parsedBalance) && parsedBalance >= 0;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!balanceIsValid) {
      setError("Balance must be zero or greater");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ name: name.trim(), kind, assetType, asset: asset.trim().toUpperCase(), balance: parsedBalance, notes: notes.trim() || undefined });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Holding could not be saved");
      setSubmitting(false);
    }
  }

  return createPortal(<div className="modal-backdrop" role="presentation"><form className="modal holding-editor-modal" role="dialog" aria-modal="true" aria-labelledby="holding-editor-title" onSubmit={handleSubmit}><div className="modal-header"><div><p className="eyebrow">Manual holding</p><h2 id="holding-editor-title">{holding ? `Edit ${holding.name}` : "Add cash or wallet"}</h2></div><Button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></Button></div>{error && <div className="inline-error">{error}</div>}<label>Name<Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Kraken, Trust Wallet, office cash" /></label><div className="form-grid"><label>Location type<NativeSelect value={kind} onValueChange={(value) => setKind(value as HoldingKind)}><NativeSelectOption value="cash">Cash</NativeSelectOption><NativeSelectOption value="exchange">Exchange</NativeSelectOption><NativeSelectOption value="wallet">Wallet</NativeSelectOption></NativeSelect></label><label>Asset type<NativeSelect value={assetType} onValueChange={(value) => setAssetType(value as HoldingAssetType)}><NativeSelectOption value="fiat">Fiat</NativeSelectOption><NativeSelectOption value="crypto">Crypto</NativeSelectOption></NativeSelect></label></div><div className="form-grid"><label>Currency / asset<Input value={asset} onChange={(event) => setAsset(event.target.value.toUpperCase())} placeholder={assetType === "crypto" ? "BTC" : "USD"} /></label><label>Balance<Input type="number" min="0" step="any" value={balance} onChange={(event) => setBalance(event.target.value)} /></label></div><label>Notes<Textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional custody or access note" /></label><div className="income-callout"><CircleAlert size={16} /><span>Crypto is displayed as a native quantity. Its approximate USD value appears when Coinbase supports the asset.</span></div><div className="modal-actions"><Button type="button" className="secondary-button" onClick={onClose} disabled={submitting}>Cancel</Button><Button type="submit" className="primary-button" disabled={submitting || !name.trim() || !asset.trim() || !balanceIsValid}>{submitting ? <Loader2 className="spin" size={16} /> : <Plus size={16} />} Save holding</Button></div></form></div>, document.body);
}

function DeleteHoldingDialog({ holding, onClose, onDelete }: { holding: Holding; onClose: () => void; onDelete: () => Promise<void> }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function remove() {
    setSubmitting(true);
    setError(null);
    try { await onDelete(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Holding could not be deleted"); setSubmitting(false); }
  }
  return createPortal(<div className="modal-backdrop" role="presentation"><div className="modal confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="delete-holding-title"><div className="confirmation-icon"><Trash2 size={20} /></div><div><p className="eyebrow">Delete holding</p><h2 id="delete-holding-title">Remove {holding.name}?</h2></div><p className="confirmation-copy">This removes the manually tracked balance from the dashboard and approximate USD total. It does not affect the external wallet or account.</p>{error && <div className="inline-error">{error}</div>}<div className="modal-actions"><Button type="button" className="secondary-button" onClick={onClose} disabled={submitting}>Cancel</Button><Button type="button" className="destructive-button" onClick={() => void remove()} disabled={submitting}>{submitting ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />} Delete holding</Button></div></div></div>, document.body);
}
