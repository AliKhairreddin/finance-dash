import { Select } from "@base-ui/react/select";
import { Check } from "lucide-react";
import { bankSources, selectedBankSources } from "../../../shared/banks";

export function BankSourceFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const selected = selectedBankSources(value);
  const label = selected.length ? bankSources.filter(bank => selected.includes(bank.id)).map(bank => bank.label).join(", ") : "All sources";
  return (
    <div className="searchable-select">
      <Select.Root multiple value={selected} onValueChange={values => onChange(bankSources.filter(bank => values.includes(bank.id)).map(bank => bank.id).join(",") || "all")}>
        <Select.Trigger className="searchable-select-control simple-select-control" aria-label="Filter bank transactions by source" title={label}>
          <span className="searchable-select-input simple-select-value">{label}</span>
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner align="start" alignItemWithTrigger={false} className="searchable-select-positioner" sideOffset={5}>
            <Select.Popup className="searchable-select-popup">
              <button type="button" className="searchable-select-option" onClick={() => onChange("all")}>All sources</button>
              <Select.List className="searchable-select-list">
                {bankSources.map(bank => (
                  <Select.Item key={bank.id} value={bank.id} className="searchable-select-option">
                    <Select.ItemText className="searchable-select-option-label">{bank.label}</Select.ItemText>
                    <Select.ItemIndicator><Check size={14} aria-hidden="true" /></Select.ItemIndicator>
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
