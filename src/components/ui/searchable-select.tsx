import { Combobox } from "@base-ui/react/combobox";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type SearchableSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type SearchableSelectProps = {
  id?: string;
  value: string;
  options: SearchableSelectOption[];
  onValueChange: (value: string) => void;
  placeholder: string;
  emptyMessage: string;
  ariaLabel?: string;
  className?: string;
  clearable?: boolean;
  disabled?: boolean;
  size?: "sm" | "default";
};

export function SearchableSelect({
  id,
  value,
  options,
  onValueChange,
  placeholder,
  emptyMessage,
  ariaLabel,
  className,
  clearable = true,
  disabled = false,
  size = "default"
}: SearchableSelectProps) {
  const selectedOption = options.find((option) => option.value === value) ?? null;
  const normalizedLabel = ariaLabel?.toLowerCase() ?? "options";

  return (
    <div className={cn("searchable-select", className)} data-size={size} data-disabled={disabled ? "" : undefined}>
      <Combobox.Root
        items={options}
        value={selectedOption}
        onValueChange={(option) => onValueChange(option?.value ?? "")}
        itemToStringLabel={(option) => option.label}
        isItemEqualToValue={(option, selected) => option.value === selected.value}
        autoComplete="off"
        disabled={disabled}
      >
        <Combobox.InputGroup className="searchable-select-control">
          <Search className="searchable-select-leading-icon" size={15} aria-hidden="true" />
          <Combobox.Input
            id={id}
            className="searchable-select-input"
            placeholder={placeholder}
            aria-label={ariaLabel}
            onFocus={(event) => event.currentTarget.select()}
          />
          <div className="searchable-select-actions">
            {clearable && (
              <Combobox.Clear className="searchable-select-action searchable-select-clear" aria-label={`Clear ${normalizedLabel}`}>
                <X size={14} aria-hidden="true" />
              </Combobox.Clear>
            )}
            <Combobox.Trigger className="searchable-select-action" aria-label={`Open ${normalizedLabel}`}>
              <ChevronDown size={15} aria-hidden="true" />
            </Combobox.Trigger>
          </div>
        </Combobox.InputGroup>

        <Combobox.Portal>
          <Combobox.Positioner className="searchable-select-positioner" sideOffset={5} align="start">
            <Combobox.Popup className="searchable-select-popup">
              <Combobox.Empty className="searchable-select-empty">{emptyMessage}</Combobox.Empty>
              <Combobox.List className="searchable-select-list">
                {(option: SearchableSelectOption) => (
                  <Combobox.Item
                    key={option.value}
                    value={option}
                    className="searchable-select-option"
                    disabled={option.disabled}
                  >
                    <Combobox.ItemIndicator className="searchable-select-option-indicator">
                      <Check size={14} aria-hidden="true" />
                    </Combobox.ItemIndicator>
                    <span>{option.label}</span>
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
    </div>
  );
}
