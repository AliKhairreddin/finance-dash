import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Check, Loader2, Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InfoPopover } from "@/components/ui/finance-visuals";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { compareTableValues, SortableTableHead, type TableSortDirection } from "@/components/ui/sortable-table-head";
import { useUrlState } from "@/lib/url-state";
import { paymentBankLabel } from "../income/PaymentTransactionPicker";
import { documentTransactionAccountKey, emptyDocumentTransactionFilters, filterDocumentTransactions, type DocumentMatchCandidate, type DocumentTransactionFilters } from "../../../shared/documentTransactionSearch";
import type { DocumentExtraction } from "../../../shared/financialDocuments";

type SortKey = "transaction" | "bank" | "date" | "amount";
export const documentTransactionAmount = (amount: number, currency: string) => `${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

export function DocumentTransactionPicker({ open, rows, selectedId, extraction, loading, limited, error, onRetry, onSelect, onClose }: {
  open: boolean;
  rows: DocumentMatchCandidate[];
  selectedId: string;
  extraction?: DocumentExtraction;
  loading: boolean;
  limited: boolean;
  error: string;
  onRetry: () => void;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [filters, setFilters] = useState<DocumentTransactionFilters>(emptyDocumentTransactionFilters);
  const [showFilters, setShowFilters] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(75);
  const searchRef = useRef<HTMLInputElement>(null);
  const query = useDeferredValue(filters.query);
  const [sortKey, setSortKey] = useUrlState<SortKey>("documentTransactionSort", "date", { allowedValues: ["transaction", "bank", "date", "amount"] });
  const [order, setOrder] = useUrlState<TableSortDirection>("documentTransactionOrder", "desc", { allowedValues: ["asc", "desc"] });
  useEffect(() => { if (open) searchRef.current?.focus(); }, [open]);
  const banks = useMemo(() => [...new Set(rows.map(row => row.source))].sort(), [rows]);
  const accounts = useMemo(() => [...new Map(rows.filter(row => !filters.bank || row.source === filters.bank).map(row => [documentTransactionAccountKey(row), `${row.accountName} · ${paymentBankLabel(row.source)}`]))].sort((a, b) => a[1].localeCompare(b[1])), [rows, filters.bank]);
  const currencies = useMemo(() => [...new Set(rows.map(row => row.currency))].sort(), [rows]);
  const filtered = useMemo(() => {
    const value = (row: DocumentMatchCandidate) => sortKey === "amount" ? row.amount : sortKey === "date" ? row.date : sortKey === "bank" ? `${paymentBankLabel(row.source)} ${row.accountName}` : `${row.counterparty} ${row.description}`;
    return filterDocumentTransactions(rows, { ...filters, query }).sort((a, b) => compareTableValues(value(a), value(b), order) || a.id.localeCompare(b.id));
  }, [rows, filters, query, sortKey, order]);
  const filterCount = Object.entries(filters).filter(([key, value]) => key !== "query" && value !== emptyDocumentTransactionFilters[key as keyof DocumentTransactionFilters]).length;
  function updateFilter<Key extends keyof DocumentTransactionFilters>(key: Key, value: DocumentTransactionFilters[Key]) {
    setFilters(current => ({ ...current, [key]: value, ...(key === "bank" ? { account: "" } : {}) }));
    setVisibleLimit(75);
  }
  const head = (key: SortKey, label: string) => <SortableTableHead sortKey={key} activeSortKey={sortKey} direction={order} onSort={key => { setOrder(key === sortKey && order === "asc" ? "desc" : "asc"); setSortKey(key); }} className={key === "amount" ? "amount" : undefined}>{label}</SortableTableHead>;
  const detailsMissing = !extraction?.amount || !extraction.currency || !extraction.issueDate || extraction.kind === "unknown";

  return <aside id="document-transaction-picker" className="payment-transaction-picker document-transaction-picker" aria-labelledby="document-picker-title" hidden={!open}>
    <div className="payment-picker-header">
      <div className="payment-picker-heading">
        <p className="eyebrow">Bank transactions</p>
        <div className="payment-picker-title-line">
          <h2 id="document-picker-title">Find a transaction</h2>
          <div className="payment-picker-status">
            <span role="status">{filtered.length.toLocaleString()} result{filtered.length === 1 ? "" : "s"}{limited && "+"}{loading && <Loader2 className="spin" size={13} aria-label="Loading bank matches" />}</span>
            <InfoPopover label="Eligible document transactions">Posted or settled transactions matching the document’s amount, currency, direction and date window, with no conflicting company or document claim. Amex foreign-currency suggestions use merchant and nearby dates and require confirmation.</InfoPopover>
          </div>
        </div>
      </div>
      <Button type="button" className="icon-button" onClick={onClose} aria-label="Close transaction search"><X size={18} /></Button>
    </div>
    <div className="payment-picker-controls">
      <div className="payment-picker-search">
        <Search size={17} aria-hidden="true" />
        <Input ref={searchRef} type="search" aria-label="Search bank transactions" placeholder="Search name, reference, description, card or amount…" autoComplete="off" value={filters.query} onChange={e => updateFilter("query", e.target.value)} />
        {filters.query && <Button type="button" className="icon-button" aria-label="Clear transaction search" onClick={() => { updateFilter("query", ""); searchRef.current?.focus(); }}><X size={14} /></Button>}
      </div>
      <div className="payment-picker-quick-filters">
        <NativeSelect aria-label="Filter by bank" value={filters.bank} searchable={false} onValueChange={value => updateFilter("bank", value)}><NativeSelectOption value="">All banks</NativeSelectOption>{banks.map(bank => <NativeSelectOption key={bank} value={bank}>{paymentBankLabel(bank)}</NativeSelectOption>)}</NativeSelect>
        <NativeSelect aria-label="Filter by document match" value={filters.match} searchable={false} onValueChange={value => updateFilter("match", value as DocumentTransactionFilters["match"])}><NativeSelectOption value="all">All matches</NativeSelectOption><NativeSelectOption value="exact">Exact amount and currency</NativeSelectOption><NativeSelectOption value="foreign_currency">Foreign currency · review</NativeSelectOption></NativeSelect>
        <Button type="button" className="secondary-button" aria-expanded={showFilters} aria-controls="document-picker-filters" onClick={() => setShowFilters(value => !value)}><SlidersHorizontal size={14} /> Filters{filterCount > 0 && <span className="payment-filter-count">{filterCount}</span>}</Button>
        {(filterCount > 0 || filters.query) && <Button type="button" className="icon-text-button" onClick={() => { setFilters(emptyDocumentTransactionFilters); setVisibleLimit(75); }}>Reset filters</Button>}
      </div>
      {showFilters && <div className="payment-picker-filters" id="document-picker-filters">
        <label>Account<NativeSelect aria-label="Filter by account" value={filters.account} searchable={false} onValueChange={value => updateFilter("account", value)}><NativeSelectOption value="">All accounts</NativeSelectOption>{accounts.map(([key, label]) => <NativeSelectOption key={key} value={key}>{label}</NativeSelectOption>)}</NativeSelect></label>
        <label>Currency<NativeSelect aria-label="Filter by currency" value={filters.currency} searchable={false} onValueChange={value => updateFilter("currency", value)}><NativeSelectOption value="">All currencies</NativeSelectOption>{currencies.map(currency => <NativeSelectOption key={currency} value={currency}>{currency}</NativeSelectOption>)}</NativeSelect></label>
        <label>From<Input aria-label="Transactions from" type="date" value={filters.from} onChange={e => updateFilter("from", e.target.value)} /></label>
        <label>To<Input aria-label="Transactions to" type="date" value={filters.to} onChange={e => updateFilter("to", e.target.value)} /></label>
      </div>}
      {filters.from && filters.to && filters.from > filters.to && <div className="inline-error" role="alert">Start date must be on or before end date.</div>}
      {error && <div className="inline-error" role="alert">{error} <Button type="button" className="icon-text-button" onClick={onRetry}>Retry</Button></div>}
      {limited && <p className="inline-error" role="status">Only part of the eligible history is loaded. Check the document details if a match is missing.</p>}
    </div>
    <div className="payment-picker-results" aria-busy={loading}>
      <table className="payment-picker-table">
        <caption className="sr-only">Eligible document bank transactions</caption>
        <thead><tr>{head("transaction", "Transaction")}{head("bank", "Bank / account")}{head("date", "Date")}{head("amount", "Amount")}<th scope="col"><span className="sr-only">Select</span></th></tr></thead>
        <tbody>{filtered.slice(0, visibleLimit).map(row => {
          const selected = selectedId === row.id;
          return <tr key={row.id} className={selected ? "payment-transaction-selected" : undefined}>
            <td><strong>{row.counterparty || row.rawName}</strong>{row.description !== row.counterparty && <span>{row.description}</span>}<span className={row.matchKind === "foreign_currency" ? "document-transaction-fx" : "payment-transaction-match"}>{row.matchKind === "foreign_currency" ? "Foreign currency · confirm conversion" : "Exact amount and currency"}</span></td>
            <td><strong>{paymentBankLabel(row.source)}</strong><span>{row.accountName}</span>{(row.cardLastFour || row.cardHolderName) && <span>{[row.cardLastFour && `Card •${row.cardLastFour}`, row.cardHolderName].filter(Boolean).join(" · ")}</span>}</td>
            <td>{row.date.slice(0, 10)}</td>
            <td className="amount"><strong>{documentTransactionAmount(row.amount, row.currency)}</strong></td>
            <td><Button type="button" className={selected ? "icon-button payment-transaction-check" : "secondary-button"} aria-label={`${selected ? "Selected" : "Select"} ${row.counterparty || row.rawName}, ${documentTransactionAmount(row.amount, row.currency)}, ${row.date}`} aria-pressed={selected} onClick={() => onSelect(row.id)}>{selected ? <Check size={16} /> : "Select"}</Button></td>
          </tr>;
        })}</tbody>
      </table>
      {filtered.length === 0 && <div className="payment-picker-empty">{loading ? <><Loader2 className="spin" size={20} /><strong>Finding bank matches…</strong></> : <><Search size={22} /><strong>{error ? "Bank matches could not be loaded" : detailsMissing ? "Complete the document details" : "No matching transactions"}</strong><span>{error ? "Retry loading the bank matches above." : detailsMissing ? "Choose a document type and enter its date, total and currency." : rows.length ? "Try another search or reset your filters." : "Check the document total, currency, date and imported bank statements."}</span></>}</div>}
      {filtered.length > visibleLimit && <div className="payment-picker-more"><Button type="button" className="secondary-button" onClick={() => setVisibleLimit(value => value + 75)}>Show more results ({filtered.length - visibleLimit})</Button></div>}
    </div>
    <div className="payment-picker-footer"><span>Document total <strong>{extraction?.amount && extraction.currency ? documentTransactionAmount(extraction.amount, extraction.currency) : "—"}</strong></span><Button type="button" className="secondary-button" onClick={onClose}>Back to document</Button></div>
  </aside>;
}
