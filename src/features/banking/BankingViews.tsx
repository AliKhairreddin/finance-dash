import { ArrowDownRight, ArrowUpRight, CircleAlert, Coins, Download, Edit3, Loader2, Plus, RefreshCw, Trash2, Wallet, X } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { ActiveFilterBar, type ActiveFilter, FilterFieldGroup, FilterPopover, ToolbarSearchField } from "@/components/ui/filter-toolbar";
import { AnimatedNumber, InfoPopover } from "@/components/ui/finance-visuals";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { compareTableValues, SortableTableHead, type TableSortDirection } from "@/components/ui/sortable-table-head";
import { Textarea } from "@/components/ui/textarea";
import { useUrlState } from "@/lib/url-state";
import type {
  CreateHoldingPayload,
  DashboardSnapshot,
  DataSource,
  Holding,
  HoldingAssetType,
  HoldingKind,
  Provider,
  Transaction,
  UpdateHoldingPayload
} from "../../../shared/types";
import { isRequiredTransactionCategory } from "../../../shared/categories";
import {
  isInternalTransferTransaction,
  transactionCounterpartyLabel,
  transactionDescriptionLabel,
  transactionMovementLabel
} from "../../../shared/transactionPresentation";
import {
  wiseEntityLabel,
  wiseEntityShortLabel
} from "../../../shared/wiseEntities";
import { exportBankTransactionsCsv } from "./exportTransactions";

const transactionSources: Array<{ value: DataSource; label: string }> = [
  { value: "wise", label: "Wise" },
  { value: "revolut", label: "Revolut" },
  { value: "slash", label: "Slash" },
  { value: "amex", label: "Amex" },
  { value: "merit", label: "Merit" },
  { value: "manual", label: "Manual" },
  { value: "tune", label: "TUNE" }
];
type BankTransactionSortKey = "account" | "amount" | "category" | "counterparty" | "date" | "direction" | "source";

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
  transactions,
  hasMore,
  isLoading,
  loadError,
  onLoadMore
}: {
  dashboard: DashboardSnapshot;
  providersById: Map<string, Provider>;
  rangeControls: ReactNode;
  transactions: Transaction[];
  hasMore: boolean;
  isLoading: boolean;
  loadError: string | null;
  onLoadMore: () => Promise<void>;
}) {
  const [query, setQuery] = useUrlState("allBankQuery", "");
  const [source, setSource] = useUrlState<"all" | DataSource>("allBankSource", "all", {
    allowedValues: ["all", ...transactionSources.map((item) => item.value)]
  });
  const [direction, setDirection] = useUrlState<"all" | "in" | "out">("allBankDirection", "all", {
    allowedValues: ["all", "in", "out"]
  });
  const [match, setMatch] = useUrlState<"all" | "matched" | "unmatched">("allBankMatch", "all", {
    allowedValues: ["all", "matched", "unmatched"]
  });
  const [sortKey, setSortKey] = useUrlState<BankTransactionSortKey>("allBankSort", "date", {
    allowedValues: ["account", "amount", "category", "counterparty", "date", "direction", "source"]
  });
  const [sortDirection, setSortDirection] = useUrlState<TableSortDirection>("allBankOrder", "desc", {
    allowedValues: ["asc", "desc"]
  });
  const teamsById = useMemo(() => new Map(dashboard.teams.map((team) => [team.id, team])), [dashboard.teams]);
  const expenseByTransactionId = useMemo(
    () => new Map(dashboard.expenses.flatMap((expense) => expense.transactionId ? [[expense.transactionId, expense] as const] : [])),
    [dashboard.expenses]
  );

  const availableSources = useMemo(
    () => [...new Set(transactions.map((transaction) => transaction.source))].sort(),
    [transactions]
  );
  const rows = useMemo(() => {
    function sortValue(transaction: Transaction): number | string {
      if (sortKey === "account") return transaction.accountName;
      if (sortKey === "amount") return transaction.amount;
      if (sortKey === "category") return transaction.category;
      if (sortKey === "counterparty") return transaction.merchantName ?? transaction.counterparty;
      if (sortKey === "date") return transaction.date;
      if (sortKey === "direction") return transaction.direction;
      return sourceLabel(transaction.source);
    }

    return transactions
      .filter((transaction) => {
        if (source !== "all" && transaction.source !== source) return false;
        if (direction !== "all" && transaction.direction !== direction) return false;
        const categorized = isRequiredTransactionCategory(transaction.category, transaction.direction, dashboard.transactionCategories);
        if (match === "matched" && !categorized) return false;
        if (match === "unmatched" && categorized) return false;
        const provider = transaction.matchedProviderId ? providersById.get(transaction.matchedProviderId) : undefined;
        const search = query.trim().toLowerCase();
        return !search || `${transaction.merchantName ?? ""} ${transaction.counterparty} ${transaction.description} ${transaction.accountName} ${provider?.name ?? ""}`.toLowerCase().includes(search);
      })
      .sort((left, right) =>
        compareTableValues(sortValue(left), sortValue(right), sortDirection)
        || compareTableValues(left.date, right.date, "desc")
        || left.id.localeCompare(right.id)
      );
  }, [dashboard.transactionCategories, direction, match, providersById, query, sortDirection, sortKey, source, transactions]);

  function requestSort(nextSortKey: BankTransactionSortKey) {
    if (nextSortKey === sortKey) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
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
    ...(direction === "all" ? [] : [{
      key: "direction",
      label: `Direction: ${direction === "in" ? "Money in" : "Money out"}`,
      onRemove: () => setDirection("all")
    }]),
    ...(match === "all" ? [] : [{
      key: "match",
      label: match === "matched" ? "Category: Ready" : "Category: Needs review",
      onRemove: () => setMatch("all")
    }])
  ];

  return (
    <section className="panel wide-panel">
      <div className="panel-header compact"><div><p className="eyebrow">Unified ledger</p><h2>All bank transactions</h2></div><span className="total-pill">{rows.length} loaded</span></div>
      <div className="list-toolbar unified-bank-toolbar">
        <div className="list-toolbar-main">
          <ToolbarSearchField
            ariaLabel="Search all bank transactions"
            className="bank-toolbar-search"
            placeholder="Search counterparty, account, company"
            value={query}
            onChange={setQuery}
          />
          <NativeSelect
            aria-label="Filter bank transactions by source"
            className="promoted-filter-select bank-source-filter"
            value={source}
            onValueChange={(value) => setSource(value as "all" | DataSource)}
          >
            <NativeSelectOption value="all">All sources</NativeSelectOption>
            {availableSources.map((item) => <NativeSelectOption key={item} value={item}>{sourceLabel(item)}</NativeSelectOption>)}
          </NativeSelect>
          <FilterPopover activeCount={bankActiveFilters.length} title="Bank transaction filters">
            <FilterFieldGroup title="Transaction">
              <label>
                Direction
                <NativeSelect aria-label="Filter bank transactions by direction" value={direction} onValueChange={(value) => setDirection(value as "all" | "in" | "out")}>
                  <NativeSelectOption value="all">Money in & out</NativeSelectOption>
                  <NativeSelectOption value="in">Money in</NativeSelectOption>
                  <NativeSelectOption value="out">Money out</NativeSelectOption>
                </NativeSelect>
              </label>
              <label>
                Category status
                <NativeSelect aria-label="Filter bank transactions by category state" value={match} onValueChange={(value) => setMatch(value as "all" | "matched" | "unmatched")}>
                  <NativeSelectOption value="all">All categories</NativeSelectOption>
                  <NativeSelectOption value="matched">Categorized</NativeSelectOption>
                  <NativeSelectOption value="unmatched">Needs category</NativeSelectOption>
                </NativeSelect>
              </label>
            </FilterFieldGroup>
          </FilterPopover>
        </div>
        <div className="list-toolbar-actions">
          <Button
            className="icon-text-button"
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
            Export loaded CSV
          </Button>
        </div>
      </div>
      <ActiveFilterBar
        filters={bankActiveFilters}
        resultLabel={`${rows.length} loaded bank transactions shown`}
        onClearAll={() => {
          setSource("all");
          setDirection("all");
          setMatch("all");
        }}
      />
      {rangeControls}
      <div className="table-wrap">
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
              return <tr key={transaction.id}><td>{dateLabel(transaction.date)}</td><td><div className="bank-source-labels"><span className={`bank-source-badge source-${transaction.source}`}>{sourceLabel(transaction.source)}</span>{transaction.source === "wise" && transaction.wiseEntity && <span className={`wise-entity-badge entity-${transaction.wiseEntity}`} title={wiseEntityLabel(transaction.wiseEntity)}>{wiseEntityShortLabel(transaction.wiseEntity)}</span>}</div></td><td>{transaction.accountName}</td><td className="counterparty-cell"><strong>{transactionCounterpartyLabel(transaction)}</strong><small>{transactionDescriptionLabel(transaction)}</small></td><td><span className={`direction-label ${internalTransfer ? "transfer" : transaction.direction}`}>{transaction.direction === "in" ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{transactionMovementLabel(transaction)}</span></td><td><span>{transaction.category}</span><small>{internalTransfer ? "No company needed" : provider?.name ?? (expense ? `Expense ${expense.recordNumber}` : transaction.matchedInvoiceId ? `Invoice ${transaction.matchedInvoiceId}` : "Merchant only")}</small></td><td className="amount">{money(transaction.amount, transaction.currency)}</td></tr>;
            }) : <tr><td colSpan={7}>{isLoading ? "Loading transactions…" : "No loaded transactions match these filters"}</td></tr>}
          </tbody>
        </table>
      </div>
      {(hasMore || isLoading || loadError) && (
        <div className="bank-table-pagination">
          <span className={loadError ? "danger-text" : undefined}>
            {loadError ?? `${rows.length} loaded transactions shown`}
          </span>
          <Button
            className="secondary-button"
            type="button"
            disabled={isLoading}
            onClick={() => void onLoadMore()}
          >
            {isLoading ? <Loader2 className="spin" size={15} /> : loadError ? <RefreshCw size={15} /> : <Plus size={15} />}
            {isLoading ? "Loading" : loadError ? "Retry" : "Show 200 more"}
          </Button>
        </div>
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
