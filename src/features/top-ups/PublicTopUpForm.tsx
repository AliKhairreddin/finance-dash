import { useEffect, useRef, useState, type FormEvent } from "react";
import { Banknote, Check, FileText, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { InfoPopover } from "@/components/ui/finance-visuals";
import { documentMaximumBytes } from "../../../shared/financialDocuments";
import { topUpCurrencies, validateTopUpInput } from "../../../shared/topUps";
import "./publicTopUp.css";
export default function PublicTopUpForm() {
  const [search, setSearch] = useState(""); const [company, setCompany] = useState<{ id: string; name: string } | null>(null);
  const [options, setOptions] = useState<{ providers: { id: string; name: string }[]; teams: string[] }>({ providers: [], teams: ["Cognitive", "Wagner", "Atlantic"] });
  const [team, setTeam] = useState("");
  const [fileName, setFileName] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [searchError, setSearchError] = useState(""); const [success, setSuccess] = useState<number | null>(null);
  const submissionId = useRef(crypto.randomUUID());
  useEffect(() => { document.title = "Topup Request · Finance"; document.documentElement.classList.remove("dark"); }, []);
  useEffect(() => { const controller = new AbortController(); const timer = window.setTimeout(() => { void fetch(`/api/public/top-ups/options?search=${encodeURIComponent(search)}`, { signal: controller.signal }).then(async response => { const body = await response.json(); if (!response.ok) throw new Error(body.message); setOptions(body); setSearchError(""); }).catch(e => { if (!controller.signal.aborted) setSearchError(e instanceof Error ? e.message : "Company search unavailable"); }); }, search ? 300 : 0); return () => { controller.abort(); window.clearTimeout(timer); }; }, [search]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = e.currentTarget; setError(""); setBusy(true);
    try {
      const fields = new FormData(form); const value = (name: string) => String(fields.get(name) ?? ""); const file = fields.get("invoice");
      if (!company) throw new Error("Choose an existing company or select the new provider option");
      if (!(file instanceof File) || !file.size || file.size > documentMaximumBytes) throw new Error("Upload an invoice up to 10 MB");
      const input = validateTopUpInput({ submissionId: submissionId.current, entity: value("entity"), priority: value("priority"), companyName: company.name, ...(company.id.startsWith("new:") ? {} : { providerId: company.id }), commission: value("commission"), team: team === "Other" ? value("otherTeam") : team, member: value("member"), amount: Number(value("amount")), currency: value("currency"), openBalance: Number(value("openBalance")), lastThreeDaysSpend: Number(value("lastThreeDaysSpend")), expectedThreeDaysSpend: Number(value("expectedThreeDaysSpend")), paymentMethod: value("paymentMethod"), wiseLink: value("wiseLink"), notes: value("notes"), bmNames: [], accountNames: [] });
      const body = new FormData(); body.set("details", JSON.stringify(input)); body.set("invoice", file); body.set("website", value("website"));
      const response = await fetch("/api/public/top-ups", { method: "POST", body }); const result = await response.json(); if (!response.ok) throw new Error(result.message ?? "Could not submit request");
      setSuccess(result.number); submissionId.current = crypto.randomUUID();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not submit request"); } finally { setBusy(false); }
  }
  const companyOptions = [...(company ? [company] : []), ...options.providers.filter(p => p.id !== company?.id)].map(p => ({ value: p.id, label: p.name }));
  if (search.trim().length >= 2 && !companyOptions.some(p => p.label.toLowerCase() === search.trim().toLowerCase())) companyOptions.push({ value: `new:${search.trim()}`, label: `New provider: ${search.trim()}` });
  return <main className="topup-public"><div className="topup-brand"><Banknote size={20} aria-hidden="true" /><strong>Finance</strong></div><article className="topup-form-card"><header className="topup-form-header"><p className="eyebrow">Top-up requests</p><h1>Topup Details Form</h1></header>
    {success !== null ? <div className="topup-success" role="status"><Check size={38} /><h2>Request #{success} received</h2><p>Your invoice and request have been saved for approval.</p><Button className="topup-submit" onClick={() => { setSuccess(null); setCompany(null); setSearch(""); setTeam(""); setFileName(""); }}>Submit another request</Button></div>
    : <form className="topup-form" onSubmit={submit}>
      <fieldset disabled={busy}>
        <div className="topup-honeypot" aria-hidden="true"><label>Website<Input name="website" autoComplete="off" tabIndex={-1} /></label></div>
        <h2 className="topup-section">Origin &amp; Priority</h2>
        <div className="topup-grid"><fieldset className="topup-full"><legend>Send From <b>*</b></legend><div className="topup-choices">{[["dn", "Digital Nudge OU"], ["lmd", "LoveMeDo BV"]].map(([value, label]) => <label key={value}><input type="radio" name="entity" value={value} required /><span>{label}</span></label>)}</div></fieldset>
        <fieldset className="topup-full"><legend>Priority</legend><div className="topup-choices"><label><input type="radio" name="priority" value="Normal" defaultChecked /><span>Normal</span></label><label><input type="radio" name="priority" value="Urgent" /><span>🔴 Urgent</span></label></div></fieldset></div>
        <h2 className="topup-section">Company &amp; Team</h2><div className="topup-grid">
          <div className="topup-field"><div className="topup-label-row"><label htmlFor="topup-company">Company Name <b>*</b></label><InfoPopover label="New providers">If your company is missing, choose New provider. It will be added to Companies when your request is approved.</InfoPopover></div><SearchableSelect id="topup-company" ariaLabel="Company Name" value={company?.id ?? ""} options={companyOptions} optionClassName={option => option.value.startsWith("new:") ? "topup-new-provider-option" : undefined} renderOption={option => option.value.startsWith("new:") ? <span className="topup-new-provider-label"><span className="topup-new-provider-badge">New Provider</span><span>{option.value.slice(4)}</span></span> : option.label} placeholder="Search companies" emptyMessage={search.length < 2 ? "Type at least two characters" : "No matching company"} onSearchChange={value => { setSearch(value); if (company && value !== company.name && value !== `New provider: ${company.name}`) setCompany(null); }} onValueChange={id => { const p = options.providers.find(p => p.id === id) ?? (company?.id === id ? company : null); if (id.startsWith("new:")) setCompany({ id, name: id.slice(4) }); else setCompany(p); }} />{searchError && <p role="alert" className="inline-error">{searchError}</p>}</div>
          <label>Commission <b>*</b><Input name="commission" placeholder="e.g. 3%" maxLength={100} required /></label>
          <label>Team Name <b>*</b><select value={team} onChange={e => setTeam(e.target.value)} required><option value="" disabled>Select team</option>{options.teams.map(t => <option key={t}>{t}</option>)}<option>Other</option></select></label>
          <label>Team Member <b>*</b><Input name="member" placeholder="e.g. Mehul, Makar…" maxLength={120} required /></label>
          {team === "Other" && <label className="topup-full">Specify Team Name <b>*</b><Input name="otherTeam" placeholder="Enter team name" maxLength={120} required /></label>}
        </div>
        <h2 className="topup-section">Amount &amp; Balance</h2><div className="topup-grid">
          <label className="topup-full">Topup Amount + Currency <b>*</b><div className="topup-amount"><Input name="amount" type="number" min="0.01" step="0.01" max="1000000000" placeholder="e.g. 1000" required /><select name="currency" aria-label="Topup currency" required defaultValue=""><option value="" disabled>Currency</option>{topUpCurrencies.map(c => <option key={c}>{c}</option>)}</select></div></label>
          <label className="topup-balance topup-full">💰 Open Balance <b>*</b><Input name="openBalance" type="number" step="0.01" placeholder="Current balance before topup" required /></label>
          <label>Last three days spend (USD) <b>*</b><Input name="lastThreeDaysSpend" type="number" min="0" max="1000000000" step="0.01" placeholder="0.00" required /></label>
          <label>Expected spend — next three days (USD) <b>*</b><Input name="expectedThreeDaysSpend" type="number" min="0" max="1000000000" step="0.01" placeholder="0.00" required /></label>
          <fieldset className="topup-full"><legend>Payment Method <small>optional</small></legend><div className="topup-choices">{["Wise", "Bank Transfer", "Card", "Crypto"].map(p => <label key={p}><input name="paymentMethod" type="radio" value={p} /><span>{p}</span></label>)}</div></fieldset>
          <label className="topup-full">Wise Link <small>optional</small><Input name="wiseLink" type="url" placeholder="https://wise.com/…" maxLength={1000} /></label>
        </div>
        <h2 className="topup-section">Invoice</h2><div className="topup-grid"><label className="topup-upload topup-full"><span>Invoice Upload <b>*</b></span><FileText size={27} /><span>{fileName || "Choose your invoice"}</span><small>PDF, JPG, PNG or WebP · up to 10 MB</small><input type="file" name="invoice" aria-label="Invoice Upload" accept=".pdf,.jpg,.jpeg,.png,.webp" required onChange={e => setFileName(e.target.files?.[0]?.name ?? "")} /></label>
          <label className="topup-full">Notes <small>optional</small><Textarea name="notes" placeholder="Any additional details or instructions…" maxLength={4000} /></label></div>
        {error && <p className="inline-error" role="alert">{error}</p>}<Button type="submit" className="topup-submit" disabled={busy}>{busy ? <Loader2 className="spin" size={18} /> : <Send size={18} />}{busy ? "Submitting request…" : "Submit Request"}</Button>
      </fieldset>
    </form>}
  </article></main>;
}
