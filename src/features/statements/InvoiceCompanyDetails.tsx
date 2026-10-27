import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { applySavedInvoiceDetails, invoiceCompanyKey, matchingInvoiceAddress, savedInvoiceDetails, type InvoiceAddress, type InvoicePairDetails, type InvoicePairProfile } from "../../../shared/statementInvoices";
import { SelectField } from "./StatementUi";
export type InvoiceSetup = { hasExample: boolean; profiles: InvoicePairProfile[]; profilesTruncated: boolean; addresses: InvoiceAddress[] };
export function matchingInvoiceProfile(setup: InvoiceSetup | null, name: string) { return setup?.profiles.find(p => invoiceCompanyKey(p.details.other.name) === invoiceCompanyKey(name)); }
export function useInvoiceCompanyDetails(setup: InvoiceSetup | null, initial: InvoicePairDetails) {
  const [value, setValue] = useState(initial);
  const edited = useRef(new Set<string>());
  useEffect(() => { setValue(current => applySavedInvoiceDetails(setup, current, edited.current)); }, [setup]);
  const change = (next: InvoicePairDetails) => setValue(current => {
    const draft = { ...next, ours: { ...next.ours }, other: { ...next.other } };
    for (const side of ["ours", "other"] as const) {
      const nameChanged = invoiceCompanyKey(current[side].name) !== invoiceCompanyKey(next[side].name);
      for (const field of ["name", "address", "vat"] as const) {
        const key = `${side}.${field}`;
        if (nameChanged && field !== "name" && current[side][field] === next[side][field]) { draft[side][field] = ""; edited.current.delete(key); }
        else if (current[side][field] !== next[side][field]) edited.current.add(key);
      }
      if (side === "other" && nameChanged && current.description === next.description) { draft.description = ""; edited.current.delete("description"); }
    }
    if (current.description !== next.description) edited.current.add("description");
    return applySavedInvoiceDetails(setup, draft, edited.current);
  });
  return [value, change] as const;
}
function Suggestion({ value, source, onUse }: { value?: string; source: string; onUse: (value: string) => void }) {
  return value ? <div className="statement-invoice-suggestion"><span className="statement-invoice-suggestion-text">{value}<small>{source}</small></span><Button type="button" variant="outline" size="sm" onClick={() => onUse(value)}>Use suggestion</Button></div> : null;
}
export function InvoiceCompanyDetails({ setup, value, change, outgoing, remember, setRemember, suggestion, suggesting, onSuggest }: { setup: InvoiceSetup; value: InvoicePairDetails; change: (next: InvoicePairDetails) => void; outgoing: boolean; remember: boolean; setRemember: (v: boolean) => void; suggestion: string; suggesting: boolean; onSuggest: () => void }) {
  const otherAddress = matchingInvoiceAddress(setup.addresses, value.other.name);
  const savedDescription = savedInvoiceDetails(setup, value).description;
  const update = (side: "ours" | "other", field: "name" | "address" | "vat", text: string) => change({ ...value, [side]: { ...value[side], [field]: text } });
  return <>
    {setup.profiles.length > 0 && <SelectField label="Saved company details" value="" onChange={name => { const profile = matchingInvoiceProfile(setup, name); if (profile) change(structuredClone(profile.details)); }} options={[{ value: "", label: "Choose saved details" }, ...setup.profiles.map(p => ({ value: p.details.other.name, label: p.details.other.name })).sort((a, b) => a.label.localeCompare(b.label))]} />}
    {setup.profilesTruncated && <p className="statement-warning">The 100 most recently saved companies are shown.</p>}
    {setup.addresses.length > 0 && <SelectField label="Saved contact" value={otherAddress?.reviewNote ? "" : otherAddress?.name ?? ""} onChange={name => {
      const contact = matchingInvoiceAddress(setup.addresses, name);
      if (contact && !contact.reviewNote) change({ ...value, other: { name: contact.invoiceName || contact.name, address: contact.address, vat: contact.vat || "" }, description: contact.description || "" });
    }} options={[{ value: "", label: "Choose a saved contact" }, ...setup.addresses.filter(a => !a.reviewNote).map(a => ({ value: a.name, label: a.name })).sort((a, b) => a.label.localeCompare(b.label))]} />}
    <div className="statement-fields statement-invoice-companies">
      {(["ours", "other"] as const).map(side => {
        const details = value[side], contact = matchingInvoiceAddress(setup.addresses, details.name);
        return <div key={side} className="statement-invoice-company"><h3>{side === "ours" ? "Our company" : "Other company"} · {(side === "other") === outgoing ? "Invoice from" : "Billed to"}</h3>
          <label>Company name<Input required maxLength={250} value={details.name} onChange={e => update(side, "name", e.target.value)} /></label>
          {contact?.reviewNote && <p className="statement-warning">Check this contact in Address book: {contact.reviewNote}</p>}
          <label>Address<Textarea required maxLength={600} rows={3} value={details.address} onChange={e => update(side, "address", e.target.value)} /></label>
          <label>VAT number (if any)<Input maxLength={80} value={details.vat} onChange={e => update(side, "vat", e.target.value)} /></label>
        </div>;
      })}
    </div>
    <label>Usual description<Textarea maxLength={500} rows={2} value={value.description} onChange={e => change({ ...value, description: e.target.value })} /></label>
    {!savedDescription && <Button type="button" variant="outline" disabled={suggesting} onClick={onSuggest}>{suggesting ? "Reading transactions…" : "Suggest description"}</Button>}
    {!savedDescription && suggestion !== value.description && <Suggestion value={suggestion} source="AI suggestion from selected transactions" onUse={description => change({ ...value, description })} />}
    <label className="statement-checkbox"><Checkbox checked={remember} onCheckedChange={v => setRemember(Boolean(v))} />Save these details for future invoices between these two companies</label>
  </>;
}
