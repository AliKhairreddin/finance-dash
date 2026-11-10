import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { InfoPopover } from "@/components/ui/finance-visuals";
import type { InvoiceGenerationOptions } from "../../../shared/statementInvoices";
import { SelectField } from "./StatementUi";

export type InvoiceGenerationChoice = Omit<InvoiceGenerationOptions, "taxTreatment" | "datePolicy"> & {
  taxTreatment: InvoiceGenerationOptions["taxTreatment"] | "";
  datePolicy: InvoiceGenerationOptions["datePolicy"] | "";
};
export const emptyInvoiceGenerationChoice = (): InvoiceGenerationChoice => ({ taxTreatment: "", taxRate: "", taxNote: "", datePolicy: "" });

export function InvoiceGenerationFields({ value, onChange, disabled = false }: { value: InvoiceGenerationChoice; onChange: (value: InvoiceGenerationChoice) => void; disabled?: boolean }) {
  return <div className="statement-fields">
    <SelectField label="Tax treatment" value={value.taxTreatment} disabled={disabled} onChange={taxTreatment => onChange({ ...value, taxTreatment: taxTreatment as InvoiceGenerationChoice["taxTreatment"], taxRate: "", taxNote: "" })} options={[
      { value: "", label: "Choose tax treatment" },
      { value: "vat", label: "Charge VAT" },
      { value: "reverse_charge", label: "Reverse charge" },
      { value: "no_vat", label: "No VAT" },
    ]} />
    {value.taxTreatment === "vat" && <label>VAT percentage<Input required disabled={disabled} type="number" min="0" max="100" step="0.01" value={value.taxRate} onChange={event => onChange({ ...value, taxRate: event.target.value })} /></label>}
    {value.taxTreatment === "no_vat" && <label>Reason for no VAT<Textarea required disabled={disabled} maxLength={500} value={value.taxNote} onChange={event => onChange({ ...value, taxNote: event.target.value })} /></label>}
    <SelectField label="Invoice date" value={value.datePolicy} disabled={disabled} onChange={datePolicy => onChange({ ...value, datePolicy: datePolicy as InvoiceGenerationChoice["datePolicy"] })} options={[
      { value: "", label: "Choose invoice date" },
      { value: "transaction", label: "Transaction date" },
      { value: "generation", label: "Generation date" },
    ]} />
    <InfoPopover label="Invoice totals and tax">The selected transaction amount is the total, including any VAT. Reverse charge and no VAT show the selected treatment on the PDF. Choose the treatment appropriate to the customer and transaction.</InfoPopover>
  </div>;
}
