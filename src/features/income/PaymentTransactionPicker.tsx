import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InfoPopover } from "@/components/ui/finance-visuals";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { compareTableValues, SortableTableHead, type TableSortDirection } from "@/components/ui/sortable-table-head";
import { useUrlState } from "@/lib/url-state";
import {
  emptyPaymentTransactionFilters, filterPaymentTransactions, paymentTransactionAccountKey,
  type PaymentTransactionFilters, type PaymentTransactionRow
} from "../../../shared/invoicePaymentSearch";
import type { InvoicePaymentSuggestions } from "../../../shared/invoicePaymentSuggestions";

type SortKey = "transaction" | "bank" | "date" | "available";
const bankNames: Record<string, string> = { wise: "Wise", revolut: "Revolut", slash: "Slash", amex: "Amex" };
export const paymentBankLabel = (source: string) => bankNames[source] ?? source;
const money = (value: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
const dateLabel = (date: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(`${date.slice(0, 10)}T00:00:00`));

export function PaymentTransactionPicker({
  open, rows, selectedId, remaining, currency, suggestions, loading, complete, error, onRetry, onSelect, onClose
}: {
  open: boolean;
  rows: PaymentTransactionRow[];
  selectedId: string;
  remaining: number;
  currency: string;
  suggestions: InvoicePaymentSuggestions | null;
  loading: boolean;
  complete: boolean;
  error: string | null;
  onRetry: () => void;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [filters, setFilters] = useState<PaymentTransactionFilters>(emptyPaymentTransactionFilters);
  const [showFilters, setShowFilters] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(75);
  const searchRef = useRef<HTMLInputElement>(null);
  const deferredQuery = useDeferredValue(filters.query);
  const [sortKey, setSortKey] = useUrlState<SortKey>("paymentTransactionSort", "date", { allowedValues: ["transaction", "bank", "date", "available"] });
  const [order, setOrder] = useUrlState<TableSortDirection>("paymentTransactionOrder", "desc", { allowedValues: ["asc", "desc"] });
  useEffect(() => { if (open) searchRef.current?.focus(); }, [open]);

  const banks = useMemo(() => [...new Set(rows.map(row => row.transaction.source))].sort(), [rows]);
  const accounts = useMemo(() => [...new Map(rows
    .filter(row => !filters.bank || row.transaction.source === filters.bank)
    .map(row => [paymentTransactionAccountKey(row), `${row.transaction.accountName} · ${paymentBankLabel(row.transaction.source)}`]))]
    .sort((left, right) => left[1].localeCompare(right[1])), [rows, filters.bank]);
  const suggestedIds = useMemo(() => new Set(suggestions?.suggestions.map(item => item.transaction.id)), [suggestions]);
  const filtered = useMemo(() => {
    const value = (row: PaymentTransactionRow) => {
      if (sortKey === "available") return row.available;
      if (sortKey === "date") return row.transaction.date;
      if (sortKey === "bank") return `${paymentBankLabel(row.transaction.source)} ${row.transaction.accountName}`;
      return `${row.transaction.counterparty} ${row.transaction.description}`;
    };
    return filterPaymentTransactions(rows, { ...filters, query: deferredQuery }, remaining, suggestedIds)
      .sort((left, right) => compareTableValues(value(left), value(right), order) || left.transaction.id.localeCompare(right.transaction.id));
  }, [rows, filters, deferredQuery, remaining, suggestedIds, sortKey, order]);
  const filterCount = Object.entries(filters).filter(([key, value]) => key !== "query" && value !== emptyPaymentTransactionFilters[key as keyof PaymentTransactionFilters]).length;
  const rangeError = filters.from && filters.to && filters.from > filters.to ? "Start date must be on or before end date."
    : filters.minimum && filters.maximum && Number(filters.minimum) > Number(filters.maximum) ? "Minimum amount must be no greater than maximum amount." : null;

  function updateFilter<Key extends keyof PaymentTransactionFilters>(key: Key, value: PaymentTransactionFilters[Key]) {
    setFilters(current => ({ ...current, [key]: value, ...(key === "bank" ? { account: "" } : {}) }));
    setVisibleLimit(75);
  }
  function requestSort(key: SortKey) {
    setOrder(key === sortKey && order === "asc" ? "desc" : "asc");
    setSortKey(key);
  }
  const head = (key: SortKey, label: string) => <SortableTableHead sortKey={key} activeSortKey={sortKey} direction={order} onSort={requestSort} className={key === "available" ? "amount" : undefined}>{label}</SortableTableHead>;

  return (
    <aside id="payment-transaction-picker" className="payment-transaction-picker" aria-labelledby="payment-picker-title" hidden={!open}>
      <div className="payment-picker-header">
        <div><p className="eyebrow">Bank transactions</p><h2 id="payment-picker-title">Find a payment <span>{currency}</span></h2></div>
        <Button type="button" className="icon-button" onClick={onClose} aria-label="Close transaction search"><X size={18} /></Button>
      </div>
      <div className="payment-picker-controls">
        <div className="payment-picker-search">
          <Search size={17} aria-hidden="true" />
          <Input ref={searchRef} type="search" aria-label="Search bank transactions" placeholder="Search name, reference, description or amount…" autoComplete="off" value={filters.query} onChange={event => updateFilter("query", event.target.value)} />
          {filters.query && <Button type="button" className="icon-button" aria-label="Clear transaction search" onClick={() => { updateFilter("query", ""); searchRef.current?.focus(); }}><X size={14} /></Button>}
        </div>
        <div className="payment-picker-quick-filters">
          <NativeSelect aria-label="Filter by bank" value={filters.bank} searchable={false} onValueChange={value => updateFilter("bank", value)}>
            <NativeSelectOption value="">All banks</NativeSelectOption>
            {banks.map(bank => <NativeSelectOption key={bank} value={bank}>{paymentBankLabel(bank)}</NativeSelectOption>)}
          </NativeSelect>
          <NativeSelect aria-label="Filter by payment match" value={filters.match} searchable={false} onValueChange={value => updateFilter("match", value as PaymentTransactionFilters["match"])}>
            <NativeSelectOption value="all">All matches</NativeSelectOption>
            <NativeSelectOption value="suggested">Suggested matches</NativeSelectOption>
            <NativeSelectOption value="exact">Exact remaining amount</NativeSelectOption>
            <NativeSelectOption value="partial">Partially allocated</NativeSelectOption>
          </NativeSelect>
          <Button type="button" className="secondary-button" aria-expanded={showFilters} aria-controls="payment-picker-filters" onClick={() => setShowFilters(value => !value)}><SlidersHorizontal size={14} /> Filters{filterCount > 0 && <span className="payment-filter-count">{filterCount}</span>}</Button>
        </div>
        {showFilters && <div className="payment-picker-filters" id="payment-picker-filters">
          <label className="payment-picker-account">Account<NativeSelect aria-label="Filter by account" value={filters.account} searchable={false} onValueChange={value => updateFilter("account", value)}><NativeSelectOption value="">All accounts</NativeSelectOption>{accounts.map(([key, label]) => <NativeSelectOption key={key} value={key}>{label}</NativeSelectOption>)}</NativeSelect></label>
          <label>From<Input aria-label="Transactions from" type="date" value={filters.from} onChange={event => updateFilter("from", event.target.value)} /></label>
          <label>To<Input aria-label="Transactions to" type="date" value={filters.to} onChange={event => updateFilter("to", event.target.value)} /></label>
          <label>Min available ({currency})<Input aria-label="Minimum available amount" type="number" min="0" step="0.01" placeholder="0.00" value={filters.minimum} onChange={event => updateFilter("minimum", event.target.value)} /></label>
          <label>Max available ({currency})<Input aria-label="Maximum available amount" type="number" min="0" step="0.01" placeholder="Any amount" value={filters.maximum} onChange={event => updateFilter("maximum", event.target.value)} /></label>
        </div>}
        <div className="payment-picker-status">
          <span role="status">{filtered.length.toLocaleString()} result{filtered.length === 1 ? "" : "s"}{!complete && " so far"}{loading && <Loader2 className="spin" size={13} aria-label="Loading bank history" />}</span>
          <InfoPopover label="Eligible payment transactions">Incoming, posted or settled transactions in {currency} with funds available. Amount filters use the unallocated balance. {complete ? "All bank history has been loaded." : "Older bank history loads while search is open."}</InfoPopover>
          {(filterCount > 0 || filters.query) && <Button type="button" className="icon-text-button" onClick={() => { setFilters(emptyPaymentTransactionFilters); setVisibleLimit(75); }}>Reset filters</Button>}
        </div>
        {rangeError && <div className="inline-error" role="alert">{rangeError}</div>}
        {error && <div className="inline-error" role="alert">{error} <Button type="button" className="icon-text-button" onClick={onRetry}>Retry</Button></div>}
      </div>
      <div className="payment-picker-results" aria-busy={loading}>
        <table className="payment-picker-table">
          <caption className="sr-only">Available {currency} bank transactions</caption>
          <thead><tr>{head("transaction", "Transaction")}{head("bank", "Bank / account")}{head("date", "Date")}{head("available", "Available")}<th scope="col"><span className="sr-only">Select</span></th></tr></thead>
          <tbody>{filtered.slice(0, visibleLimit).map(({ transaction, available, allocated }) => {
            const suggestion = suggestions?.suggestions.find(item => item.transaction.id === transaction.id);
            const selected = selectedId === transaction.id;
            return <tr key={transaction.id} className={selected ? "payment-transaction-selected" : undefined}>
              <td><strong>{transaction.counterparty || transaction.rawName}</strong><span className="payment-transaction-description">{transaction.description}</span>{suggestion && <span className="payment-transaction-match">{suggestion.kind === "linked" ? "Matched to invoice" : suggestion.kind === "exact" ? "Suggested · exact match" : "Suggested · amount differs"}</span>}</td>
              <td><strong>{paymentBankLabel(transaction.source)}</strong><span>{transaction.accountName}</span></td>
              <td className="payment-transaction-date">{dateLabel(transaction.date)}</td>
              <td className="amount"><strong>{money(available, currency)}</strong>{allocated > 0 && <span>{money(allocated, currency)} allocated</span>}</td>
              <td><Button type="button" className={selected ? "icon-button payment-transaction-check" : "secondary-button"} aria-label={`${selected ? "Selected" : "Select"} ${transaction.counterparty || transaction.rawName}, ${money(available, currency)}, ${dateLabel(transaction.date)}`} aria-pressed={selected} onClick={() => onSelect(transaction.id)}>{selected ? <Check size={16} /> : "Select"}</Button></td>
            </tr>;
          })}</tbody>
        </table>
        {filtered.length === 0 && <div className="payment-picker-empty">{loading ? <><Loader2 className="spin" size={20} /><strong>Searching bank history…</strong></> : <><Search size={22} /><strong>No matching transactions</strong><span>{complete ? "Try another search or adjust your filters." : "Bank history is incomplete. Retry to search older transactions."}</span></>}</div>}
        {filtered.length > visibleLimit && <div className="payment-picker-more"><Button type="button" className="secondary-button" onClick={() => setVisibleLimit(value => value + 75)}>Show more results ({filtered.length - visibleLimit})</Button></div>}
      </div>
      <div className="payment-picker-footer"><span>Invoice remaining <strong>{money(remaining, currency)}</strong></span><Button type="button" className="secondary-button" onClick={onClose}>Back to payment</Button></div>
    </aside>
  );
}
