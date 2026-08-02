import { Combobox } from "@base-ui/react/combobox";
import { Select } from "@base-ui/react/select";
import { ChevronDown, Search, X } from "lucide-react";
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
  searchable?: boolean;
  showLeadingIcon?: boolean;
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
  searchable = true,
  showLeadingIcon = true,
  size = "default"
}: SearchableSelectProps) {
  const selectedOption = options.find((option) => option.value === value) ?? null;
  const normalizedLabel = ariaLabel?.toLowerCase() ?? "options";

  if (!searchable) {
    return (
      <div className={cn("searchable-select", className)} data-size={size} data-disabled={disabled ? "" : undefined}>
        <Select.Root
          items={options}
          value={value}
          onValueChange={(option) => onValueChange(option ?? "")}
          disabled={disabled}
        >
          <Select.Trigger
            id={id}
            className="searchable-select-control simple-select-control"
            aria-label={ariaLabel}
            title={selectedOption?.label}
          >
            <Select.Value className="searchable-select-input simple-select-value" placeholder={placeholder} />
            <Select.Icon className="searchable-select-action">
              <ChevronDown size={15} aria-hidden="true" />
            </Select.Icon>
          </Select.Trigger>

          <Select.Portal>
            <Select.Positioner
              align="start"
              alignItemWithTrigger={false}
              className="searchable-select-positioner"
              sideOffset={5}
            >
              <Select.Popup className="searchable-select-popup">
                <Select.List className="searchable-select-list">
                  {options.map((option) => (
                    <Select.Item
                      key={option.value}
                      value={option.value}
                      className="searchable-select-option"
                      disabled={option.disabled}
                    >
                      <Select.ItemText className="searchable-select-option-label">{option.label}</Select.ItemText>
                    </Select.Item>
                  ))}
                </Select.List>
              </Select.Popup>
            </Select.Positioner>
          </Select.Portal>
        </Select.Root>
      </div>
    );
  }

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
        <Combobox.InputGroup
          className={cn(
            "searchable-select-control",
            !showLeadingIcon && "searchable-select-control-no-leading-icon"
          )}
        >
          {showLeadingIcon && <Search className="searchable-select-leading-icon" size={15} aria-hidden="true" />}
          <Combobox.Input
            id={id}
            className="searchable-select-input"
            placeholder={placeholder}
            aria-label={ariaLabel}
            title={selectedOption?.label}
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
          <Combobox.Positioner className="searchable-select-positioner searchable-select-positioner-adaptive" sideOffset={5} align="start">
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
                    <span className="searchable-select-option-label">{option.label}</span>
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
