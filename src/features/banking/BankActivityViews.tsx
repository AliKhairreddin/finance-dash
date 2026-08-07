import { CreditCard, FileDown, Landmark, Layers3, List, Loader2, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { compareTableValues, SortableTableHead, type TableSortDirection } from "@/components/ui/sortable-table-head";
import { useUrlState } from "@/lib/url-state";
import {
  bankCardCashbackRate,
  bankGroupAmountTotal,
  type BankCardGroupSummary,
  type BankMerchantGroup,
  type BankMerchantGroupSummary
} from "../../../shared/bankMerchantGroups";
import {
  bankExpenseReportFileName,
  generateBankExpenseReportPdf,
  type BankExpenseReportPeriod
} from "../../../shared/bankExpenseReport";
import type { Transaction } from "../../../shared/types";

export const bankActivityViewModes = ["transactions", "groups", "cards", "accounts"] as const;
export type BankActivityViewMode = (typeof bankActivityViewModes)[number];

type GroupSortKey = "cashback" | "credits" | "firstDate" | "lastDate" | "merchant" | "net" | "sources" | "spend" | "transactions";
type CardSortKey = "account" | "cashback" | "cashbackRate" | "card" | "firstDate" | "lastDate" | "source" | "spend" | "transactions";
type AccountSortKey = "account" | "cashback" | "cashbackRate" | "credits" | "firstDate" | "lastDate" | "source" | "spend" | "transactions";

function sourceLabel(source: Transaction["source"]): string {
  if (source === "wise") return "Wise";
  if (source === "revolut") return "Revolut";
  if (source === "slash") return "Slash";
  if (source === "amex") return "Amex";
  return source.toUpperCase();
}

function dateLabel(value: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function currencySummary(totals: Readonly<Record<string, number>>): string {
  const values = Object.entries(totals)
    .filter(([, amount]) => Math.abs(amount) >= 0.005)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, amount]) => new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2
    }).format(amount));
  return values.length > 0 ? values.join(" · ") : "-";
}

function downloadBytes(bytes: Uint8Array, fileName: string): void {
  const blobBytes = new Uint8Array(bytes.byteLength);
  blobBytes.set(bytes);
  const url = URL.createObjectURL(new Blob([blobBytes], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function BankActivityViewToggle({
  value,
  onChange
}: {
  value: BankActivityViewMode;
  onChange: (value: BankActivityViewMode) => void;
}) {
  const options: Array<{ value: BankActivityViewMode; label: string; icon: typeof List }> = [
    { value: "transactions", label: "Transactions", icon: List },
    { value: "groups", label: "Group view", icon: Layers3 },
    { value: "cards", label: "Card view", icon: CreditCard },
    { value: "accounts", label: "Account view", icon: Landmark }
  ];
  return (
    <div className="segmented-control bank-activity-view-toggle" aria-label="Bank activity view">
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <button
            aria-label={option.label}
            aria-pressed={value === option.value}
            className={value === option.value ? "active" : ""}
            key={option.value}
            onClick={() => onChange(option.value)}
            title={option.label}
            type="button"
          >
            <Icon aria-hidden="true" size={14} />
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function LoadingCompletePeriod({
  isLoading,
  loadError,
  onRetry
}: {
  isLoading: boolean;
  loadError: string | null;
  onRetry: () => Promise<void>;
}) {
  if (!isLoading && !loadError) return null;
  return (
    <div className={`bank-group-loading ${loadError ? "danger-text" : ""}`} role={loadError ? "alert" : "status"}>
      {isLoading && <Loader2 aria-hidden="true" className="spin" size={15} />}
      <span>{loadError ?? "Calculating the complete selected period..."}</span>
      {loadError && (
        <Button className="secondary-button" type="button" onClick={() => void onRetry()}>
          <RefreshCw aria-hidden="true" size={14} /> Retry
        </Button>
      )}
    </div>
  );
}

export function BankMerchantGroupView({
  groups,
  period,
  isLoading,
  loadError,
  onRetry
}: {
  groups: readonly BankMerchantGroupSummary[];
  period: BankExpenseReportPeriod;
  isLoading: boolean;
  loadError: string | null;
  onRetry: () => Promise<void>;
}) {
  const [sortKey, setSortKey] = useUrlState<GroupSortKey>("bankGroupSort", "spend", {
    allowedValues: ["cashback", "credits", "firstDate", "lastDate", "merchant", "net", "sources", "spend", "transactions"]
  });
  const [sortDirection, setSortDirection] = useUrlState<TableSortDirection>("bankGroupOrder", "desc", {
    allowedValues: ["asc", "desc"]
  });
  const [generatingPdfKey, setGeneratingPdfKey] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const rows = useMemo(() => {
    function sortValue(group: BankMerchantGroupSummary): number | string {
      if (sortKey === "cashback") return bankGroupAmountTotal(group.cashback);
      if (sortKey === "credits") return bankGroupAmountTotal(group.credits);
      if (sortKey === "firstDate") return group.firstDate;
      if (sortKey === "lastDate") return group.lastDate;
      if (sortKey === "merchant") return group.name;
      if (sortKey === "net") return bankGroupAmountTotal(group.net);
      if (sortKey === "sources") return group.sources.map(sourceLabel).join(" ");
      if (sortKey === "transactions") return group.transactionCount;
      return bankGroupAmountTotal(group.spend);
    }
    return [...groups].sort((left, right) =>
      compareTableValues(sortValue(left), sortValue(right), sortDirection)
      || left.name.localeCompare(right.name)
    );
  }, [groups, sortDirection, sortKey]);

  function requestSort(nextSortKey: GroupSortKey): void {
    if (nextSortKey === sortKey) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(nextSortKey);
    setSortDirection(nextSortKey === "merchant" || nextSortKey === "firstDate" || nextSortKey === "lastDate" ? "asc" : "desc");
  }

  async function downloadReport(group: BankMerchantGroupSummary): Promise<void> {
    setGeneratingPdfKey(group.key);
    setPdfError(null);
    try {
      const reportGroup: BankMerchantGroup = {
        ...group,
        transactions: [],
        cardGroups: group.cardGroups.map((card) => ({ ...card, transactions: [] }))
      };
      const bytes = await generateBankExpenseReportPdf(reportGroup, period);
      downloadBytes(bytes, bankExpenseReportFileName(group, period));
    } catch (caught) {
      setPdfError(caught instanceof Error ? caught.message : "Internal billing report could not be generated");
    } finally {
      setGeneratingPdfKey(null);
    }
  }

  const periodIncomplete = isLoading || Boolean(loadError);
  return (
    <>
      <LoadingCompletePeriod isLoading={isLoading} loadError={loadError} onRetry={onRetry} />
      {pdfError && <div className="inline-error" role="alert">{pdfError}</div>}
      <span className="screen-reader-only" role="status" aria-live="polite">{rows.length} merchant groups shown.</span>
      <div className="table-wrap bank-group-table-wrap">
        <table className="data-table modern-income-table bank-group-table">
          <thead><tr>
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="merchant">Merchant</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="sources">Sources</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="transactions">Transactions</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="firstDate">First activity</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="lastDate">Latest activity</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={requestSort} sortKey="spend">Spend</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={requestSort} sortKey="credits">Credits</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={requestSort} sortKey="cashback">Cashback</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={requestSort} sortKey="net">Net</SortableTableHead>
            <th aria-label="Internal billing report" className="action-column" scope="col" />
          </tr></thead>
          <tbody>
            {rows.map((group) => {
              const aliases = group.aliases.filter((alias) => alias.toLowerCase() !== group.name.toLowerCase());
              const net = bankGroupAmountTotal(group.net);
              return (
                <tr key={group.key}>
                  <td className="counterparty-cell"><strong>{group.name}</strong><small>{aliases.length > 0 ? `${aliases.slice(0, 2).join(" · ")}${aliases.length > 2 ? ` · +${aliases.length - 2}` : ""}` : "Canonical merchant"}</small></td>
                  <td>{group.sources.map(sourceLabel).join(", ")}</td>
                  <td>{group.transactionCount.toLocaleString("en-US")}</td>
                  <td>{dateLabel(group.firstDate)}</td>
                  <td>{dateLabel(group.lastDate)}</td>
                  <td className="amount">{currencySummary(group.spend)}</td>
                  <td className="amount good-text">{currencySummary(group.credits)}</td>
                  <td className="amount good-text">{currencySummary(group.cashback)}</td>
                  <td className={`amount ${net < 0 ? "danger-text" : net > 0 ? "good-text" : ""}`}>{currencySummary(group.net)}</td>
                  <td className="action-column">
                    <Button
                      aria-label={`Download ${group.name} internal billing report`}
                      className="icon-button"
                      disabled={periodIncomplete || generatingPdfKey !== null}
                      onClick={() => void downloadReport(group)}
                      title={periodIncomplete ? "Wait for the complete selected period" : `Generate internal billing report for ${group.name}`}
                      type="button"
                    >
                      {generatingPdfKey === group.key ? <Loader2 className="spin" size={15} /> : <FileDown size={15} />}
                    </Button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={10}>{isLoading ? "Loading grouped activity..." : "No settled activity matches this view"}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function BankCardActivityView({
  groups,
  isLoading,
  loadError,
  onRetry
}: {
  groups: readonly BankCardGroupSummary[];
  isLoading: boolean;
  loadError: string | null;
  onRetry: () => Promise<void>;
}) {
  const [sortKey, setSortKey] = useUrlState<CardSortKey>("bankCardSort", "spend", {
    allowedValues: ["account", "cashback", "cashbackRate", "card", "firstDate", "lastDate", "source", "spend", "transactions"]
  });
  const [sortDirection, setSortDirection] = useUrlState<TableSortDirection>("bankCardOrder", "desc", {
    allowedValues: ["asc", "desc"]
  });
  const rows = useMemo(() => {
    function sortValue(group: BankCardGroupSummary): number | string {
      if (sortKey === "account") return group.accountName;
      if (sortKey === "cashback") return bankGroupAmountTotal(group.cashback);
      if (sortKey === "cashbackRate") return bankCardCashbackRate(group);
      if (sortKey === "card") return group.label;
      if (sortKey === "firstDate") return group.firstDate;
      if (sortKey === "lastDate") return group.lastDate;
      if (sortKey === "source") return sourceLabel(group.source);
      if (sortKey === "transactions") return group.transactionCount;
      return bankGroupAmountTotal(group.spend);
    }
    return [...groups].sort((left, right) =>
      compareTableValues(sortValue(left), sortValue(right), sortDirection)
      || left.label.localeCompare(right.label)
    );
  }, [groups, sortDirection, sortKey]);

  function requestSort(nextSortKey: CardSortKey): void {
    if (nextSortKey === sortKey) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(nextSortKey);
    setSortDirection(nextSortKey === "card" || nextSortKey === "account" || nextSortKey === "firstDate" || nextSortKey === "lastDate" ? "asc" : "desc");
  }

  return (
    <>
      <LoadingCompletePeriod isLoading={isLoading} loadError={loadError} onRetry={onRetry} />
      <span className="screen-reader-only" role="status" aria-live="polite">{rows.length} cards shown.</span>
      <div className="table-wrap bank-card-table-wrap">
        <table className="data-table modern-income-table bank-card-table">
          <thead><tr>
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="card">Card</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="source">Source</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="account">Account</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="transactions">Transactions</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="firstDate">First activity</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="lastDate">Latest activity</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={requestSort} sortKey="spend">Spent</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={requestSort} sortKey="cashback">Cashback</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={requestSort} sortKey="cashbackRate">Cashback %</SortableTableHead>
          </tr></thead>
          <tbody>
            {rows.map((group) => (
              <tr key={group.key}>
                <td><strong>{group.label}</strong>{group.cardLastFour && <small>Last four digits only</small>}</td>
                <td><span className={`bank-source-badge source-${group.source}`}>{sourceLabel(group.source)}</span></td>
                <td>{group.accountName}</td>
                <td>{group.transactionCount.toLocaleString("en-US")}</td>
                <td>{dateLabel(group.firstDate)}</td>
                <td>{dateLabel(group.lastDate)}</td>
                <td className="amount">{currencySummary(group.spend)}</td>
                <td className="amount good-text">{currencySummary(group.cashback)}</td>
                <td className="amount"><strong>{(bankCardCashbackRate(group) * 100).toFixed(2)}%</strong></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={9}>{isLoading ? "Loading card activity..." : "No settled card activity matches this view"}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function BankAccountActivityView({
  groups,
  isLoading,
  loadError,
  onRetry
}: {
  groups: readonly BankCardGroupSummary[];
  isLoading: boolean;
  loadError: string | null;
  onRetry: () => Promise<void>;
}) {
  const [sortKey, setSortKey] = useUrlState<AccountSortKey>("bankAccountSort", "spend", {
    allowedValues: ["account", "cashback", "cashbackRate", "credits", "firstDate", "lastDate", "source", "spend", "transactions"]
  });
  const [sortDirection, setSortDirection] = useUrlState<TableSortDirection>("bankAccountOrder", "desc", {
    allowedValues: ["asc", "desc"]
  });
  const rows = useMemo(() => {
    function sortValue(group: BankCardGroupSummary): number | string {
      if (sortKey === "account") return group.accountName;
      if (sortKey === "cashback") return bankGroupAmountTotal(group.cashback);
      if (sortKey === "cashbackRate") return bankCardCashbackRate(group);
      if (sortKey === "credits") return bankGroupAmountTotal(group.credits);
      if (sortKey === "firstDate") return group.firstDate;
      if (sortKey === "lastDate") return group.lastDate;
      if (sortKey === "source") return sourceLabel(group.source);
      if (sortKey === "transactions") return group.transactionCount;
      return bankGroupAmountTotal(group.spend);
    }
    return [...groups].sort((left, right) =>
      compareTableValues(sortValue(left), sortValue(right), sortDirection)
      || left.label.localeCompare(right.label)
    );
  }, [groups, sortDirection, sortKey]);

  function requestSort(nextSortKey: AccountSortKey): void {
    if (nextSortKey === sortKey) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(nextSortKey);
    setSortDirection(nextSortKey === "account" || nextSortKey === "firstDate" || nextSortKey === "lastDate" ? "asc" : "desc");
  }

  return (
    <>
      <LoadingCompletePeriod isLoading={isLoading} loadError={loadError} onRetry={onRetry} />
      <span className="screen-reader-only" role="status" aria-live="polite">{rows.length} accounts shown.</span>
      <div className="table-wrap bank-card-table-wrap">
        <table className="data-table modern-income-table bank-card-table">
          <thead><tr>
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="account">Account</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="source">Source</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="transactions">Transactions</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="firstDate">First activity</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="lastDate">Latest activity</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={requestSort} sortKey="spend">Spent</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={requestSort} sortKey="credits">Credits</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={requestSort} sortKey="cashback">Cashback</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={requestSort} sortKey="cashbackRate">Cashback %</SortableTableHead>
          </tr></thead>
          <tbody>
            {rows.map((group) => (
              <tr key={group.key}>
                <td><strong>{group.accountName}</strong></td>
                <td><span className={`bank-source-badge source-${group.source}`}>{sourceLabel(group.source)}</span></td>
                <td>{group.transactionCount.toLocaleString("en-US")}</td>
                <td>{dateLabel(group.firstDate)}</td>
                <td>{dateLabel(group.lastDate)}</td>
                <td className="amount">{currencySummary(group.spend)}</td>
                <td className="amount good-text">{currencySummary(group.credits)}</td>
                <td className="amount good-text">{currencySummary(group.cashback)}</td>
                <td className="amount"><strong>{(bankCardCashbackRate(group) * 100).toFixed(2)}%</strong></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={9}>{isLoading ? "Loading account activity..." : "No settled account activity matches this view"}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
