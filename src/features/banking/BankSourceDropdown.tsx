import { Menu } from "@base-ui/react/menu";
import { Check, ChevronDown } from "lucide-react";
import { useState } from "react";
import { UrlStateLink } from "@/components/ui/url-state-link";
import { bankSources, selectedBankSources, type BankSource } from "../../../shared/banks";
import { manualBankSources } from "../../../shared/manualBankTransactions";

export function BankSourceDropdown({ activeBank, sourceFilter, onChange }: {
  activeBank: string;
  sourceFilter: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const activeSource = bankSources.find(bank => bank.id === activeBank);
  const selected = activeBank === "all"
    ? selectedBankSources(sourceFilter)
    : activeSource ? [activeSource.id] : [];
  const names = bankSources.filter(bank => selected.includes(bank.id)).map(bank => bank.label);
  const allSelected = activeBank === "all" && selected.length === 0;
  const label = names.length > 2 ? `${names.length} banks`
    : names.length ? names.join(" + ")
      : allSelected ? "All banks"
        : manualBankSources.find(bank => bank.id === activeBank)?.label ?? "Cash & wallets";

  function toggleBank(source: BankSource, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(source);
    else next.delete(source);
    onChange(bankSources.filter(bank => next.has(bank.id)).map(bank => bank.id).join(",") || "all");
  }

  return (
    <div className="bank-source-select">
      <Menu.Root open={open} onOpenChange={setOpen}>
        <Menu.Trigger
          aria-label="Bank source"
          title={names.join(", ") || label}
          className="searchable-select-control simple-select-control bank-navigation-trigger"
        >
          <span className="searchable-select-input simple-select-value">{label}</span>
          <ChevronDown size={14} aria-hidden="true" />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner align="end" sideOffset={5} className="searchable-select-positioner">
            <Menu.Popup aria-label="Banks" className="searchable-select-popup bank-navigation-menu">
              <Menu.Item
                className="searchable-select-option bank-navigation-option"
                data-selected={allSelected ? "" : undefined}
                onClick={() => onChange("all")}
              >
                <span>All banks</span>
                {allSelected && <Check size={14} aria-hidden="true" />}
              </Menu.Item>
              {bankSources.map(bank => (
                <Menu.CheckboxItem
                  key={bank.id}
                  checked={selected.includes(bank.id)}
                  closeOnClick={false}
                  className="searchable-select-option bank-navigation-option"
                  data-selected={selected.includes(bank.id) ? "" : undefined}
                  onCheckedChange={checked => toggleBank(bank.id, checked)}
                >
                  <span>{bank.label}</span>
                  <Menu.CheckboxItemIndicator><Check size={14} aria-hidden="true" /></Menu.CheckboxItemIndicator>
                </Menu.CheckboxItem>
              ))}
              <Menu.Separator className="bank-navigation-separator" />
              {[...manualBankSources, { id: "holdings", label: "Cash & wallets" }].map(bank => (
                <Menu.LinkItem
                  key={bank.id}
                  className="searchable-select-option bank-navigation-option"
                  aria-current={activeBank === bank.id ? "page" : undefined}
                  render={<UrlStateLink stateKey="bankView" value={bank.id} defaultValue="all" onNavigate={() => setOpen(false)} />}
                >
                  <span>{bank.label}</span>
                  {activeBank === bank.id && <Check size={14} aria-hidden="true" />}
                </Menu.LinkItem>
              ))}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
}
