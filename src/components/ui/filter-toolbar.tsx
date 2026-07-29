import { Popover } from "@base-ui/react/popover";
import { Filter, Search, X } from "lucide-react";
import {
  type ChangeEvent,
  type ReactNode
} from "react";
import { cn } from "@/lib/utils";

export type ActiveFilter = {
  key: string;
  label: string;
  onRemove: () => void;
};

export function ToolbarSearchField({
  ariaLabel,
  className,
  onChange,
  placeholder,
  value
}: {
  ariaLabel: string;
  className?: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <label className={cn("toolbar-search-field", className)}>
      <Search size={16} aria-hidden="true" />
      <input
        aria-label={ariaLabel}
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
      />
      {value && (
        <button type="button" aria-label={`Clear ${ariaLabel.toLowerCase()}`} onClick={() => onChange("")}>
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </label>
  );
}

export function FilterPopover({
  activeCount = 0,
  children,
  label = "Filters",
  title = label
}: {
  activeCount?: number;
  children: ReactNode;
  label?: string;
  title?: string;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger className={cn("toolbar-popover-trigger", activeCount > 0 && "is-active")}>
        <Filter size={15} aria-hidden="true" />
        <span>{label}</span>
        {activeCount > 0 && <span className="toolbar-filter-count" aria-label={`${activeCount} active`}>{activeCount}</span>}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner className="toolbar-popover-positioner" sideOffset={6} align="end">
          <Popover.Popup className="toolbar-popover-popup">
            <Popover.Title className="toolbar-popover-title">{title}</Popover.Title>
            <div className="toolbar-popover-content">{children}</div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function FilterFieldGroup({
  children,
  title
}: {
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="toolbar-filter-group">
      <h3>{title}</h3>
      <div>{children}</div>
    </section>
  );
}

export function ActiveFilterBar({
  filters,
  onClearAll,
  resultLabel
}: {
  filters: ActiveFilter[];
  onClearAll: () => void;
  resultLabel: string;
}) {
  return (
    <>
      <span className="screen-reader-only" role="status" aria-live="polite">{resultLabel}</span>
      {filters.length > 0 && (
        <div className="active-filter-bar" aria-label="Active filters">
          <div className="active-filter-list">
            {filters.map((filter) => (
              <span className="active-filter-chip" key={filter.key}>
                {filter.label}
                <button type="button" aria-label={`Remove ${filter.label} filter`} onClick={filter.onRemove}>
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
          <button className="clear-active-filters" type="button" onClick={onClearAll}>Clear filters</button>
        </div>
      )}
    </>
  );
}
