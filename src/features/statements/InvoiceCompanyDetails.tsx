import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { invoiceCompanyKey, type InvoicePairDetails, type InvoicePairProfile } from "../../../shared/statementInvoices";
import { SelectField } from "./StatementUi";
export type InvoiceSetup = { hasExample: boolean; profiles: InvoicePairProfile[]; profilesTruncated: boolean; addresses: Array<{ name: string; address: string }> };
export function matchingInvoiceProfile(setup: InvoiceSetup | null, name: string) { return setup?.profiles.find(p => invoiceCompanyKey(p.details.other.name) === invoiceCompanyKey(name)); }
function Suggestion({ value, source, onUse }: { value?: string; source: string; onUse: (value: string) => void }) {
  return value ? <div className="statement-invoice-suggestion"><span className="statement-invoice-suggestion-text">{value}<small>{source}</small></span><Button type="button" variant="outline" size="sm" onClick={() => onUse(value)}>Use suggestion</Button></div> : null;
}
export function InvoiceCompanyDetails({ setup, value, change, outgoing, remember, setRemember, suggestion, suggesting, onSuggest }: { setup: InvoiceSetup; value: InvoicePairDetails; change: (next: InvoicePairDetails) => void; outgoing: boolean; remember: boolean; setRemember: (v: boolean) => void; suggestion: string; suggesting: boolean; onSuggest: () => void }) {
  const saved = matchingInvoiceProfile(setup, value.other.name);
  const update = (side: "ours" | "other", field: "name" | "address" | "vat", text: string) => change({ ...value, [side]: { ...value[side], [field]: text } });
  return <>
    {setup.profiles.length > 0 && <SelectField label="Saved company details" value="" onChange={name => { const profile = matchingInvoiceProfile(setup, name); if (profile) change(structuredClone(profile.details)); }} options={[{ value: "", label: "Choose saved details" }, ...setup.profiles.map(p => ({ value: p.details.other.name, label: p.details.other.name })).sort((a, b) => a.label.localeCompare(b.label))]} />}
    {setup.profilesTruncated && <p className="statement-warning">The 100 most recently saved companies are shown.</p>}
    {saved && <Button type="button" variant="outline" onClick={() => change(structuredClone(saved.details))}>Use saved details for {saved.details.other.name}</Button>}
    <div className="statement-fields statement-invoice-companies">
      {(["ours", "other"] as const).map(side => {
        const details = value[side], known = side === "other" ? saved?.details.other : (saved ?? setup.profiles[0])?.details.ours;
        const sameName = known && invoiceCompanyKey(known.name) === invoiceCompanyKey(details.name);
        const address = sameName && known.address ? known.address : setup.addresses.find(a => invoiceCompanyKey(a.name) === invoiceCompanyKey(details.name))?.address;
        const vat = sameName ? known.vat : "";
        return <div key={side} className="statement-invoice-company"><h3>{side === "ours" ? "Our company" : "Other company"} · {(side === "other") === outgoing ? "Invoice from" : "Billed to"}</h3>
          <label>Company name<Input required maxLength={250} value={details.name} onChange={e => update(side, "name", e.target.value)} /></label>
          <label>Address<Textarea required maxLength={600} rows={3} value={details.address} onChange={e => update(side, "address", e.target.value)} /></label>
          {address !== details.address && <Suggestion value={address} source={sameName && known.address ? "Saved company details" : "Saved address book"} onUse={v => update(side, "address", v)} />}
          <label>VAT number (if any)<Input maxLength={80} value={details.vat} onChange={e => update(side, "vat", e.target.value)} /></label>
          {vat !== details.vat && <Suggestion value={vat} source="Saved company details" onUse={v => update(side, "vat", v)} />}
        </div>;
      })}
    </div>
    <label>Usual description<Textarea maxLength={500} rows={2} value={value.description} onChange={e => change({ ...value, description: e.target.value })} /></label>
    <Button type="button" variant="outline" disabled={suggesting} onClick={onSuggest}>{suggesting ? "Reading transactions…" : "Suggest description"}</Button>
    {saved?.details.description !== value.description && <Suggestion value={saved?.details.description} source="Saved for these two companies" onUse={description => change({ ...value, description })} />}
    {suggestion !== value.description && <Suggestion value={suggestion} source="AI suggestion from selected transactions" onUse={description => change({ ...value, description })} />}
    <label className="statement-checkbox"><Checkbox checked={remember} onCheckedChange={v => setRemember(Boolean(v))} />Save these details for future invoices between these two companies</label>
  </>;
}
