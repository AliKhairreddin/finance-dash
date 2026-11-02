import { SortableTableHead, compareTableValues, type TableSortDirection } from "@/components/ui/sortable-table-head";
import { InfoPopover } from "@/components/ui/finance-visuals";
import { useUrlState } from "@/lib/url-state";
import type { MeritInvoiceCopy } from "../../../shared/meritInvoiceCopy";

const columns = ["description", "quantity", "price", "discountAmount", "taxAmount", "netAmount"] as const;
const labels = { description: "Line item", quantity: "Qty", price: "Unit price", discountAmount: "Discount", taxAmount: "Tax", netAmount: "Net amount" };
export function InvoiceCopyLines({ copy }: { copy: MeritInvoiceCopy }) {
  const [sort, setSort] = useUrlState<typeof columns[number]>("invoiceCopySort", "description", { allowedValues: columns });
  const [direction, setDirection] = useUrlState<TableSortDirection>("invoiceCopyOrder", "asc", { allowedValues: ["asc", "desc"] });
  const money = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 7 });
  const rows = copy.lines.map((line, index) => ({ ...line, index })).sort((a, b) => compareTableValues(a[sort], b[sort], direction) || a.index - b.index);
  return <section><h3>{copy.lines.length} copied line items <InfoPopover label="Copied invoice details">Descriptions, quantities, prices, discounts, taxes, and accounting codes stay exactly as saved in Merit. Sorting this preview does not change the invoice line order. You can change the customer and dates before saving the new draft.</InfoPopover></h3><div className="table-wrap"><table className="data-table"><thead><tr>{columns.map(key => <SortableTableHead key={key} sortKey={key} activeSortKey={sort} direction={direction} onSort={key => { if (key === sort) setDirection(direction === "asc" ? "desc" : "asc"); else { setSort(key); setDirection("asc"); } }}>{labels[key]}</SortableTableHead>)}</tr></thead><tbody>{rows.map(row => <tr key={row.index}><td>{row.description}<small>{row.itemCode}</small></td><td>{money(row.quantity)} {row.unit}</td><td>{money(row.price)}</td><td>{money(row.discountAmount)}<small>{row.discountPercent}%</small></td><td>{money(row.taxAmount)}<small>{row.taxPercent}%</small></td><td>{money(row.netAmount)}</td></tr>)}</tbody></table></div><p>Total: <strong>{money(copy.totalAmount)} {copy.currency}</strong>{copy.roundingAmount !== 0 && <> · Rounding: {money(copy.roundingAmount)}</>}</p></section>;
}
