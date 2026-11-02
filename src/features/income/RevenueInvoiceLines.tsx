import { SortableTableHead, compareTableValues, type TableSortDirection } from "@/components/ui/sortable-table-head";
import { useUrlState } from "@/lib/url-state";
import type { Invoice } from "../../../shared/types";
import { meritInvoiceLineDescription } from "../../../shared/merit";

const columns = ["accountId", "accountName", "amount"] as const;
const labels = { accountId: "Account ID", accountName: "Account", amount: "Amount" };
export function RevenueInvoiceLines({ invoice }: { invoice: Invoice }) {
  const [sort, setSort] = useUrlState<typeof columns[number]>("revenueInvoiceSort", "accountId", { allowedValues: columns });
  const [direction, setDirection] = useUrlState<TableSortDirection>("revenueInvoiceOrder", "asc", { allowedValues: ["asc", "desc"] });
  const rows = [...(invoice.revenueLines ?? [])].sort((a, b) => compareTableValues(sort === "accountId" ? Number(a.accountId) : a[sort], sort === "accountId" ? Number(b.accountId) : b[sort], direction) || a.accountId.localeCompare(b.accountId));
  return <div className="table-wrap"><table className="data-table"><thead><tr>{columns.map(key => <SortableTableHead key={key} sortKey={key} activeSortKey={sort} direction={direction} onSort={key => { if (key === sort) setDirection(direction === "asc" ? "desc" : "asc"); else { setSort(key); setDirection("asc"); } }}>{labels[key]}</SortableTableHead>)}</tr></thead><tbody>{rows.map(line => <tr key={line.accountId}><td>{line.accountId}</td><td>{line.accountName}<small>{meritInvoiceLineDescription(line.description, invoice.periodStart, invoice.periodEnd)}</small></td><td>{line.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {invoice.currency}</td></tr>)}</tbody></table></div>;
}
