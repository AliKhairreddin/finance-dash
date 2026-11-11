import { useUrlState } from "@/lib/url-state";
import { InfoPopover } from "@/components/ui/finance-visuals";
import { ToolbarSearchField } from "@/components/ui/filter-toolbar";
import { compareTableValues, SortableTableHead, type TableSortDirection } from "@/components/ui/sortable-table-head";
import type { ClientPaymentHistory as ClientHistory, PaymentHistoryReport } from "../../../shared/types";
import { BankPatternForecast } from "./PaymentForecast";

type SortKey = "name" | "currency" | "received" | "receiptCount" | "lastReceipt" | "receiptIntervalDays" | "sampleSize" | "medianDays" | "nextPayment";
const columns: { key: SortKey; label: string; description?: string }[] = [
  { key: "name", label: "Client" }, { key: "currency", label: "Currency" },
  { key: "received", label: "Verified received" }, { key: "receiptCount", label: "Receipts" },
  { key: "lastReceipt", label: "Last receipt" },
  { key: "receiptIntervalDays", label: "Receipt interval", description: "Median calendar days between distinct receipt dates. This is payment frequency, not time taken to pay an invoice." },
  { key: "sampleSize", label: "Matched payments", description: "Up to the ten most recent independently matched payments. Full settlement, bank date, client and currency must be verified; duplicate and pre-invoice receipts are excluded." },
  { key: "medianDays", label: "Invoice → payment", description: "Median calendar days from invoice date to final bank receipt. Requires at least three independent matches in the same currency." },
  { key: "nextPayment", label: "Next bank payment", description: "Rough date from recurring bank receipts, without requiring invoices. Past cycles remain past; stale and low-confidence patterns are labeled." }
];
const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const days = (value: number | undefined) => value === undefined ? "—" : `${value} ${value === 1 ? "day" : "days"}`;
const date = (value?: string) => value ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`)) : "—";

export function ClientPaymentHistory({ report }: { report: PaymentHistoryReport }) {
  const [expanded, setExpanded] = useUrlState("paymentHistory", "closed", { allowedValues: ["open", "closed"] });
  const [query, setQuery] = useUrlState("paymentHistoryQuery", "");
  const [sort, setSort] = useUrlState<SortKey>("paymentHistorySort", "received", { allowedValues: columns.map(column => column.key) });
  const [direction, setDirection] = useUrlState<TableSortDirection>("paymentHistoryOrder", "desc", { allowedValues: ["asc", "desc"] });
  const clients = new Set(report.clients.map(client => client.name)).size;
  const sortValue = (row: ClientHistory, key: SortKey) => key === "nextPayment" ? row.bankPattern?.expectedDate : row[key];
  const rows = report.clients.filter(client => `${client.name} ${client.currency}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => compareTableValues(sortValue(a, sort), sortValue(b, sort), direction) || a.id.localeCompare(b.id));
  const requestSort = (key: SortKey) => {
    if (key === sort) setDirection(current => current === "asc" ? "desc" : "asc");
    else { setSort(key); setDirection(key === "received" ? "desc" : "asc"); }
  };
  const cell = (row: ClientHistory, key: SortKey) => key === "lastReceipt" ? date(row.lastReceipt)
    : key === "nextPayment" ? row.bankPattern ? <BankPatternForecast pattern={row.bankPattern} label={`bank payment estimate for ${row.name} in ${row.currency}`} /> : "No pattern yet"
    : key === "medianDays" ? row.medianDays === undefined ? "No estimate" : days(row.medianDays)
    : key === "receiptIntervalDays" ? days(row.receiptIntervalDays)
    : key === "received" ? number.format(row.received) : row[key];
  return <details className="panel client-payment-history" open={expanded === "open"} onToggle={event => setExpanded(event.currentTarget.open ? "open" : "closed")}>
    <summary>Client payment history <span className="muted">{clients} clients</span></summary>
    <div className="list-toolbar">
      <ToolbarSearchField ariaLabel="Search client payment history" placeholder="Search clients" value={query} onChange={setQuery} />
      <span>{date(report.fromDate)} – {date(report.toDate)}</span>
      <InfoPopover label="client payment history">
        <p>Saved bank history for the last 365 days, grouped by external client and currency. Coverage depends on imported bank records. Amounts stay in their original currency.</p>
        <p>Includes business revenue from BuyGoods and ClickBank. Excludes owned companies, investors, transfers, unverified bank identities and unrecognized payers. {report.unverifiedReceipts} business-category receipts could not be verified for this view.</p>
        <p>Bank-pattern estimates use recent receipt frequency without requiring invoices. They are separate from measured invoice-to-payment delays and do not establish contractual terms. Estimates update from saved records.</p>
      </InfoPopover>
    </div>
    {!report.complete ? <div className="inline-error" role="alert">Payment history is incomplete. Totals and forecasts are withheld.</div> : <div className="table-wrap"><table className="data-table">
      <thead><tr>{columns.map(column => <SortableTableHead key={column.key} sortKey={column.key} activeSortKey={sort} direction={direction} onSort={requestSort} description={column.description} className={column.key === "received" ? "amount" : undefined}>{column.label}</SortableTableHead>)}</tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}>{columns.map(column => <td key={column.key} className={column.key === "received" ? "amount" : undefined}>{cell(row, column.key)}</td>)}</tr>)}{!rows.length && <tr><td colSpan={columns.length}>No identifiable clients in this view</td></tr>}</tbody>
    </table></div>}
  </details>;
}
