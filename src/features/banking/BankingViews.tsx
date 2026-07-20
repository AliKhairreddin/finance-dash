import { ArrowDownRight, ArrowUpRight, CircleAlert, Coins, Edit3, Loader2, Plus, RefreshCw, Search, Trash2, Wallet, X } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
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
  UpdateHoldingPayload
} from "../../../shared/types";

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

export function AllBankTransactionsView({ dashboard, providersById }: { dashboard: DashboardSnapshot; providersById: Map<string, Provider> }) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<"all" | DataSource>("all");
  const [direction, setDirection] = useState<"all" | "in" | "out">("all");
  const [match, setMatch] = useState<"all" | "matched" | "unmatched">("all");

  const availableSources = useMemo(
    () => [...new Set(dashboard.transactions.map((transaction) => transaction.source))].sort(),
    [dashboard.transactions]
  );
  const rows = dashboard.transactions
    .filter((transaction) => {
      if (source !== "all" && transaction.source !== source) return false;
      if (direction !== "all" && transaction.direction !== direction) return false;
      if (match === "matched" && !transaction.matchedProviderId && !transaction.matchedInvoiceId) return false;
      if (match === "unmatched" && (transaction.matchedProviderId || transaction.matchedInvoiceId)) return false;
      const provider = transaction.matchedProviderId ? providersById.get(transaction.matchedProviderId) : undefined;
      const search = query.trim().toLowerCase();
      return !search || `${transaction.counterparty} ${transaction.description} ${transaction.accountName} ${provider?.name ?? ""}`.toLowerCase().includes(search);
    })
    .sort((left, right) => right.date.localeCompare(left.date));

  return (
    <section className="panel wide-panel">
      <div className="panel-header compact"><div><p className="eyebrow">Unified ledger</p><h2>All bank transactions</h2></div><span className="total-pill">{rows.length} rows</span></div>
      <div className="income-filter-bar all-bank-filter-bar">
        <label className="income-search-field"><Search size={15} /><Input aria-label="Search all bank transactions" placeholder="Search counterparty, account, company" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <label>Source<NativeSelect value={source} onChange={(event) => setSource(event.target.value as "all" | DataSource)}><NativeSelectOption value="all">All sources</NativeSelectOption>{availableSources.map((item) => <NativeSelectOption key={item} value={item}>{sourceLabel(item)}</NativeSelectOption>)}</NativeSelect></label>
        <label>Direction<NativeSelect value={direction} onChange={(event) => setDirection(event.target.value as "all" | "in" | "out")}><NativeSelectOption value="all">Money in & out</NativeSelectOption><NativeSelectOption value="in">Money in</NativeSelectOption><NativeSelectOption value="out">Money out</NativeSelectOption></NativeSelect></label>
        <label>Match<NativeSelect value={match} onChange={(event) => setMatch(event.target.value as "all" | "matched" | "unmatched")}><NativeSelectOption value="all">All match states</NativeSelectOption><NativeSelectOption value="matched">Matched</NativeSelectOption><NativeSelectOption value="unmatched">Needs review</NativeSelectOption></NativeSelect></label>
      </div>
      <div className="table-wrap">
        <table className="data-table modern-income-table unified-bank-table">
          <thead><tr><th>Date</th><th>Source</th><th>Account</th><th>Counterparty</th><th>Direction</th><th>Category / match</th><th>Amount</th></tr></thead>
          <tbody>
            {rows.length > 0 ? rows.map((transaction) => {
              const provider = transaction.matchedProviderId ? providersById.get(transaction.matchedProviderId) : undefined;
              return <tr key={transaction.id}><td>{dateLabel(transaction.date)}</td><td><span className={`bank-source-badge source-${transaction.source}`}>{sourceLabel(transaction.source)}</span></td><td>{transaction.accountName}</td><td className="counterparty-cell"><strong>{transaction.counterparty}</strong><small>{transaction.description}</small></td><td><span className={`direction-label ${transaction.direction}`}>{transaction.direction === "in" ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}{transaction.direction === "in" ? "In" : "Out"}</span></td><td><span>{transaction.category}</span><small>{provider?.name ?? (transaction.matchedInvoiceId ? `Invoice ${transaction.matchedInvoiceId}` : "Needs review")}</small></td><td className="amount">{money(transaction.amount, transaction.currency)}</td></tr>;
            }) : <tr><td colSpan={7}>No transactions match these filters</td></tr>}
          </tbody>
        </table>
      </div>
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
        <article className="holding-total-card"><span>Liquid bank accounts · approx.</span><strong>{money(dashboard.approximateUsdTotals.accountsUsd, "USD")}</strong><small>Converted to USD; card liabilities excluded</small></article>
        <article className="holding-total-card"><span>Cash & wallets · approx.</span><strong>{money(dashboard.approximateUsdTotals.holdingsUsd, "USD")}</strong><small>{dashboard.holdings.length} manually tracked holdings</small></article>
        <article className="holding-total-card total"><span>Total available · approx.</span><strong>{money(dashboard.approximateUsdTotals.totalUsd, "USD")}</strong><small>{dashboard.approximateUsdTotals.asOf ? `Quotes ${dateLabel(dashboard.approximateUsdTotals.asOf)}` : dashboard.approximateUsdTotals.excludedAssets.length > 0 ? "Refresh quotes to include every asset" : "No non-USD quote required"}</small></article>
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

  return <div className="modal-backdrop" role="presentation"><form className="modal holding-editor-modal" role="dialog" aria-modal="true" aria-labelledby="holding-editor-title" onSubmit={handleSubmit}><div className="modal-header"><div><p className="eyebrow">Manual holding</p><h2 id="holding-editor-title">{holding ? `Edit ${holding.name}` : "Add cash or wallet"}</h2></div><Button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></Button></div>{error && <div className="inline-error">{error}</div>}<label>Name<Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Kraken, Trust Wallet, office cash" /></label><div className="form-grid"><label>Location type<NativeSelect value={kind} onChange={(event) => setKind(event.target.value as HoldingKind)}><NativeSelectOption value="cash">Cash</NativeSelectOption><NativeSelectOption value="exchange">Exchange</NativeSelectOption><NativeSelectOption value="wallet">Wallet</NativeSelectOption></NativeSelect></label><label>Asset type<NativeSelect value={assetType} onChange={(event) => setAssetType(event.target.value as HoldingAssetType)}><NativeSelectOption value="fiat">Fiat</NativeSelectOption><NativeSelectOption value="crypto">Crypto</NativeSelectOption></NativeSelect></label></div><div className="form-grid"><label>Currency / asset<Input value={asset} onChange={(event) => setAsset(event.target.value.toUpperCase())} placeholder={assetType === "crypto" ? "BTC" : "USD"} /></label><label>Balance<Input type="number" min="0" step="any" value={balance} onChange={(event) => setBalance(event.target.value)} /></label></div><label>Notes<Textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional custody or access note" /></label><div className="income-callout"><CircleAlert size={16} /><span>Crypto is displayed as a native quantity. Its approximate USD value appears when Coinbase supports the asset.</span></div><div className="modal-actions"><Button type="button" className="secondary-button" onClick={onClose} disabled={submitting}>Cancel</Button><Button type="submit" className="primary-button" disabled={submitting || !name.trim() || !asset.trim() || !balanceIsValid}>{submitting ? <Loader2 className="spin" size={16} /> : <Plus size={16} />} Save holding</Button></div></form></div>;
}

function DeleteHoldingDialog({ holding, onClose, onDelete }: { holding: Holding; onClose: () => void; onDelete: () => Promise<void> }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function remove() {
    setSubmitting(true);
    setError(null);
    try { await onDelete(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Holding could not be deleted"); setSubmitting(false); }
  }
  return <div className="modal-backdrop" role="presentation"><div className="modal confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="delete-holding-title"><div className="confirmation-icon"><Trash2 size={20} /></div><div><p className="eyebrow">Delete holding</p><h2 id="delete-holding-title">Remove {holding.name}?</h2></div><p className="confirmation-copy">This removes the manually tracked balance from the dashboard and approximate USD total. It does not affect the external wallet or account.</p>{error && <div className="inline-error">{error}</div>}<div className="modal-actions"><Button type="button" className="secondary-button" onClick={onClose} disabled={submitting}>Cancel</Button><Button type="button" className="destructive-button" onClick={() => void remove()} disabled={submitting}>{submitting ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />} Delete holding</Button></div></div></div>;
}
