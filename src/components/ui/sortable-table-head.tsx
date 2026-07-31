import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import type { ReactNode } from "react";
import { InfoPopover } from "@/components/ui/finance-visuals";

export type TableSortDirection = "asc" | "desc";

export function SortableTableHead<SortKey extends string>({
  activeSortKey,
  children,
  className,
  description,
  direction,
  label,
  onSort,
  sortKey
}: {
  activeSortKey: SortKey;
  children: ReactNode;
  className?: string;
  description?: string;
  direction: TableSortDirection;
  label?: string;
  onSort: (sortKey: SortKey) => void;
  sortKey: SortKey;
}) {
  const isActive = activeSortKey === sortKey;
  const nextDirection = isActive && direction === "asc" ? "descending" : "ascending";

  return (
    <th
      aria-sort={isActive ? (direction === "asc" ? "ascending" : "descending") : "none"}
      className={className}
      scope="col"
    >
      <div className="sortable-table-head-row">
        <button
          type="button"
          className={`sortable-table-heading ${isActive ? "active" : ""}`}
          onClick={() => onSort(sortKey)}
          title={`Sort by ${label ?? String(children)} ${nextDirection}`}
        >
          <span className="sortable-table-label">{children}</span>
          {isActive
            ? direction === "asc"
              ? <ArrowUp aria-hidden="true" size={13} strokeWidth={2.5} />
              : <ArrowDown aria-hidden="true" size={13} strokeWidth={2.5} />
            : <ChevronsUpDown aria-hidden="true" className="sortable-table-heading-idle" size={13} strokeWidth={2.25} />}
        </button>
        {description && <InfoPopover label={`${label ?? String(children)} column`}>{description}</InfoPopover>}
      </div>
    </th>
  );
}

export function compareTableValues(
  left: boolean | number | string | null | undefined,
  right: boolean | number | string | null | undefined,
  direction: TableSortDirection
): number {
  const leftMissing = left === null || left === undefined || left === "";
  const rightMissing = right === null || right === undefined || right === "";
  if (leftMissing || rightMissing) {
    if (leftMissing && rightMissing) return 0;
    return leftMissing ? 1 : -1;
  }

  const comparison = typeof left === "number" && typeof right === "number"
    ? left - right
    : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
  return direction === "asc" ? comparison : -comparison;
}
