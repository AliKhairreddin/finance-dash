import { Children, isValidElement, type ReactNode } from "react";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";

type NativeSelectProps = {
  "aria-label"?: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  id?: string;
  onValueChange: (value: string) => void;
  size?: "sm" | "default";
  value: string;
};

type NativeSelectOptionProps = {
  children: ReactNode;
  disabled?: boolean;
  value: string;
};

function textFromChildren(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") return String(child);
      if (isValidElement<{ children?: ReactNode }>(child)) return textFromChildren(child.props.children);
      return "";
    })
    .join("");
}

function NativeSelect({
  "aria-label": ariaLabel,
  children,
  className,
  disabled = false,
  id,
  onValueChange,
  size = "default",
  value
}: NativeSelectProps) {
  const options = Children.toArray(children)
    .filter(isValidElement<NativeSelectOptionProps>)
    .map<SearchableSelectOption>((option) => ({
      value: option.props.value,
      label: textFromChildren(option.props.children),
      disabled: option.props.disabled
    }));
  const selectedLabel = options.find((option) => option.value === value)?.label;

  return (
    <SearchableSelect
      id={id}
      className={className}
      size={size}
      value={value}
      options={options}
      onValueChange={onValueChange}
      placeholder={selectedLabel ?? "Search options"}
      emptyMessage="No options found"
      ariaLabel={ariaLabel}
      clearable={false}
      disabled={disabled}
      searchable={options.length > 8}
      showLeadingIcon={false}
    />
  );
}

function NativeSelectOption({
  children: _children,
  disabled: _disabled,
  value: _value
}: NativeSelectOptionProps) {
  return null;
}

export { NativeSelect, NativeSelectOption };
