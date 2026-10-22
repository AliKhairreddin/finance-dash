import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Banknote, Check, Coins, FileText, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { InfoPopover } from "@/components/ui/finance-visuals";
import { documentMaximumBytes } from "../../../shared/financialDocuments";
import { cryptoRequestCurrencies, topUpAmountDecimals, topUpCurrencies, isCryptoTopUp, topUpMinimumExpectedThreeDaysSpend, validateTopUpInput } from "../../../shared/topUps";
import "./publicTopUp.css";

const Brand = () => <div className="topup-brand"><Banknote size={20} aria-hidden="true" /><strong>Finance</strong></div>;
export default function PublicTopUpPage() {
  const type = new URLSearchParams(window.location.search).get("type");
  useEffect(() => { document.title = "Request funds · Finance"; document.documentElement.classList.remove("dark"); }, []);
  if (type === "ad-spend" || type === "purchase") return <PublicTopUpForm crypto={type === "purchase"} />;
  return <main className="topup-public"><Brand /><article className="topup-form-card">
    <header className="topup-form-header"><p className="eyebrow">Payment requests</p><h1>What would you like to request?</h1></header>
    <div className="topup-request-choices">
      <a className="topup-request-choice" href="?type=ad-spend"><Banknote size={30} /><strong>Ad Spend Request</strong><ArrowRight size={20} aria-hidden="true" /></a>
      <a className="topup-request-choice" href="?type=purchase"><Coins size={30} /><strong>Purchase Request</strong><ArrowRight size={20} aria-hidden="true" /></a>
    </div>
  </article></main>;
}

function PublicTopUpForm({ crypto: cryptoRequest }: { crypto: boolean }) {
  const [search, setSearch] = useState("");
  const [company, setCompany] = useState<{ id: string; name: string } | null>(null);
  const [options, setOptions] = useState<{ providers: { id: string; name: string }[]; teams: string[]; members: string[] }>({ providers: [], teams: ["Cognitive", "Wagner", "Atlantic"], members: [] });
  const [team, setTeam] = useState("");
  const [currency, setCurrency] = useState(cryptoRequest ? "USDC" : "USD");
  const [customCurrency, setCustomCurrency] = useState("");
  const selectedCurrency = currency === "other" ? customCurrency.trim().toUpperCase() : currency;
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [searchError, setSearchError] = useState("");
  const [success, setSuccess] = useState<number | null>(null);
  const submissionId = useRef(window.crypto.randomUUID());
  const errorRef = useRef<HTMLParagraphElement>(null);
  const decimals = topUpAmountDecimals(selectedCurrency);
  useEffect(() => { if (error && !busy) { errorRef.current?.focus(); errorRef.current?.scrollIntoView({ block: "center" }); } }, [error, busy]);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch(`/api/public/top-ups/options?search=${encodeURIComponent(search)}&team=${encodeURIComponent(team === "Other" ? "" : team)}`, { signal: controller.signal }).then(async response => {
        const body = await response.json(); if (!response.ok) throw new Error(body.message || "Company search unavailable");
        setOptions(body); setSearchError("");
      }).catch(e => { if (!controller.signal.aborted) setSearchError(e instanceof Error ? e.message : "Company search unavailable"); });
    }, search ? 300 : 0);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [search, team]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = e.currentTarget; setError("");
    try {
      const fields = new FormData(form);
      const value = (name: string) => String(fields.get(name) ?? "");
      const file = fields.get("invoice");
      if (!cryptoRequest && !company) throw new Error("Choose an existing company or select the new provider option");
      if (!cryptoRequest && (!(file instanceof File) || !file.size)) throw new Error("Upload an invoice up to 10 MB");
      if (file instanceof File && file.size > documentMaximumBytes) throw new Error("Invoice must be no larger than 10 MB");
      if (cryptoRequest && !isCryptoTopUp(selectedCurrency)) throw new Error("Enter a cryptocurrency symbol, such as USDC, USDT or BTC");
      const input = validateTopUpInput({
        submissionId: submissionId.current, ...(!cryptoRequest ? { entity: value("entity") } : {}), priority: value("priority"), companyName: cryptoRequest ? value("recipient") : company!.name,
        ...(!cryptoRequest && !company!.id.startsWith("new:") ? { providerId: company!.id } : {}), team: team === "Other" ? value("otherTeam") : team, member: value("member"), amount: Number(value("amount")), currency: selectedCurrency,
        ...(cryptoRequest ? { walletAddress: value("walletAddress"), network: value("network") } : {
          commission: value("commission"),
          openBalance: Number(value("openBalance")), lastThreeDaysSpend: Number(value("lastThreeDaysSpend")), expectedThreeDaysSpend: Number(value("expectedThreeDaysSpend"))
        }),
        paymentMethod: cryptoRequest ? "Crypto" : value("paymentMethod"), wiseLink: cryptoRequest ? "" : value("wiseLink"), notes: value("notes"), bmNames: [], accountNames: []
      });
      const body = new FormData(); body.set("details", JSON.stringify(input));
      if (file instanceof File && file.size) body.set("invoice", file);
      body.set("website", value("website")); setBusy(true);
      const response = await fetch("/api/public/top-ups", { method: "POST", body });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof result?.message === "string" && result.message.trim() ? result.message : "Could not submit request. Please try again.");
      if (!Number.isSafeInteger(result?.number) || result.number < 1) throw new Error("Could not confirm the request. Please try submitting again.");
      setSuccess(result.number); submissionId.current = window.crypto.randomUUID();
    } catch (e) { setError(e instanceof Error && e.message.trim() ? e.message : "Could not submit request. Please try again."); }
    finally { setBusy(false); }
  }
  function invalid(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const field = e.currentTarget.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input:invalid, select:invalid, textarea:invalid");
    if (!field || e.target !== field) return;
    const label = field.getAttribute("aria-label") || field.labels?.[0]?.textContent?.split("*")[0]?.trim() || "Request details";
    setError(field.name === "expectedThreeDaysSpend" && field.validity.rangeUnderflow
      ? `Expected next three days spend must be at least ${topUpMinimumExpectedThreeDaysSpend.toLocaleString("en-US")} USD`
      : `${field.name === "entity" ? "Send From" : label}: ${field.validationMessage}`);
  }
  const companyOptions = [...(company ? [company] : []), ...options.providers.filter(p => p.id !== company?.id)].map(p => ({ value: p.id, label: p.name }));
  if (search.trim().length >= 2 && !companyOptions.some(p => p.label.toLowerCase() === search.trim().toLowerCase())) companyOptions.push({ value: `new:${search.trim()}`, label: `New provider: ${search.trim()}` });
  return <main className="topup-public"><Brand /><article className="topup-form-card">
    <header className="topup-form-header"><a className="topup-back" href="/top-up"><ArrowLeft size={14} /> Request types</a><p className="eyebrow">{cryptoRequest ? "Purchase requests" : "Ad spend requests"}</p><h1>{cryptoRequest ? "Purchase Request" : "Topup Details Form"}</h1></header>
    {success !== null ? <div className="topup-success" role="status"><Check size={38} /><h2>Request #{success} received</h2><p>Your request{fileName ? " and invoice have" : " has"} been saved for approval.</p><Button className="topup-submit" onClick={() => { setSuccess(null); setCompany(null); setSearch(""); setTeam(""); setCurrency(cryptoRequest ? "USDC" : "USD"); setCustomCurrency(""); setFileName(""); }}>Submit another request</Button></div>
      : <form className="topup-form" onSubmit={submit} onInvalid={invalid}><fieldset disabled={busy}>
        <div className="topup-honeypot" aria-hidden="true"><label>Website<Input name="website" autoComplete="off" tabIndex={-1} /></label></div>
        <h2 className="topup-section">{cryptoRequest ? "Priority" : "Origin & Priority"}</h2>
        <div className="topup-grid">{!cryptoRequest && <fieldset className="topup-full"><legend>Send From <b>*</b></legend><div className="topup-choices">{[["dn", "Digital Nudge OU"], ["lmd", "LoveMeDo BV"]].map(([value, label]) => <label key={value}><input type="radio" name="entity" value={value} required /><span>{label}</span></label>)}</div></fieldset>}
          <fieldset className="topup-full"><legend>Priority</legend><div className="topup-choices"><label><input type="radio" name="priority" value="Normal" defaultChecked /><span>Normal</span></label><label><input type="radio" name="priority" value="Urgent" /><span>🔴 Urgent</span></label></div></fieldset></div>
        <h2 className="topup-section">{cryptoRequest ? "Recipient & Requester" : "Company & Team"}</h2><div className="topup-grid">
          {cryptoRequest ? <label className="topup-full">Recipient <b>*</b><Input name="recipient" placeholder="Recipient name" maxLength={200} required /></label> : <div className="topup-field"><div className="topup-label-row"><label htmlFor="topup-company">{cryptoRequest ? "Recipient / Provider" : "Company Name"} <b>*</b></label><InfoPopover label="New providers">If your company is missing, choose New provider. It will be added to Companies when your request is approved.</InfoPopover></div>
            <SearchableSelect id="topup-company" ariaLabel={cryptoRequest ? "Recipient / Provider" : "Company Name"} value={company?.id ?? ""} options={companyOptions}
              optionClassName={option => option.value.startsWith("new:") ? "topup-new-provider-option" : undefined}
              renderOption={option => option.value.startsWith("new:") ? <span className="topup-new-provider-label"><span className="topup-new-provider-badge">New Provider</span><span>{option.value.slice(4)}</span></span> : option.label}
              placeholder="Search companies" emptyMessage={search.length < 2 ? "Type at least two characters" : "No matching company"}
              onSearchChange={value => { setSearch(value); if (company && value !== company.name && value !== `New provider: ${company.name}`) setCompany(null); }}
              onValueChange={id => { const p = options.providers.find(p => p.id === id) ?? (company?.id === id ? company : null); if (id.startsWith("new:")) setCompany({ id, name: id.slice(4) }); else setCompany(p); }} />
            {searchError && <p role="alert" className="inline-error">{searchError}</p>}</div>}
          {!cryptoRequest && <label>Commission <b>*</b><Input name="commission" placeholder="e.g. 3%" maxLength={100} required /></label>}
            <label>Team Name <b>*</b><select value={team} onChange={e => setTeam(e.target.value)} required><option value="" disabled>Select team</option>{options.teams.map(t => <option key={t}>{t}</option>)}<option>Other</option></select></label>
          <label>Team Member <b>*</b><Input name="member" list={cryptoRequest ? "purchase-team-members" : undefined} placeholder={cryptoRequest ? "Select or enter team member" : "e.g. Mehul, Makar…"} maxLength={120} required />{cryptoRequest && <datalist id="purchase-team-members">{options.members.map(member => <option key={member} value={member} />)}</datalist>}</label>
          {team === "Other" && <label className="topup-full">Specify Team Name <b>*</b><Input name="otherTeam" placeholder="Enter team name" maxLength={120} required /></label>}
        </div>
        <h2 className="topup-section">{cryptoRequest ? "Amount & Wallet" : "Amount & Balance"}</h2><div className="topup-grid">
          <label className="topup-full">{cryptoRequest ? "Amount + Currency" : "Topup Amount + Currency"} <b>*</b><div className="topup-amount"><Input name="amount" type="number" min={10 ** -decimals} step={10 ** -decimals} max="1000000000" placeholder="e.g. 1000" required /><select name="currency" aria-label={cryptoRequest ? "Purchase currency" : "Topup currency"} required value={currency} onChange={e => setCurrency(e.target.value)}>{(cryptoRequest ? cryptoRequestCurrencies : topUpCurrencies).map(c => <option key={c} value={c}>{c === "BTC" ? "Bitcoin (BTC)" : c}</option>)}{cryptoRequest && <option value="other">Other</option>}</select></div></label>
          {cryptoRequest && currency === "other" && <label className="topup-full">Currency symbol <b>*</b><Input name="customCurrency" value={customCurrency} onChange={e => setCustomCurrency(e.target.value.toUpperCase())} pattern="[A-Za-z][A-Za-z0-9]{1,11}" maxLength={12} placeholder="e.g. ETH" required /></label>}
          {cryptoRequest ? <><label className="topup-full">Network <small>optional</small><Input name="network" placeholder="Enter the receiving network" maxLength={80} /></label><label className="topup-full">Wallet address <b>*</b><Input name="walletAddress" placeholder="Receiving wallet address" maxLength={200} autoCapitalize="none" autoCorrect="off" spellCheck={false} required /></label></> : <>
            <label className="topup-balance topup-full">💰 Open Balance <b>*</b><Input name="openBalance" type="number" step="0.01" placeholder="Current balance before topup" required /></label>
            <label>Last three days spend (USD) <b>*</b><Input name="lastThreeDaysSpend" type="number" min="0" max="1000000000" step="0.01" placeholder="0.00" required /></label>
            <label>Expected spend — next three days (USD) <b>*</b><Input name="expectedThreeDaysSpend" type="number" min={topUpMinimumExpectedThreeDaysSpend} max="1000000000" step="0.01" placeholder="1000.00" required /></label>
            <fieldset className="topup-full"><legend>Payment Method <small>optional</small></legend><div className="topup-choices">{["Wise", "Bank Transfer", "Card", "Crypto"].map(p => <label key={p}><input name="paymentMethod" type="radio" value={p} /><span>{p}</span></label>)}</div></fieldset>
            <label className="topup-full">Wise Link <small>optional</small><Input name="wiseLink" type="url" placeholder="https://wise.com/…" maxLength={1000} /></label>
          </>}
        </div>
        <h2 className="topup-section">Invoice</h2><div className="topup-grid"><label className="topup-upload topup-full"><span>Invoice Upload {cryptoRequest ? <small>optional</small> : <b>*</b>}</span><FileText size={27} /><span>{fileName || "Choose your invoice"}</span><small>PDF, JPG, PNG or WebP · up to 10 MB</small><input type="file" name="invoice" aria-label="Invoice Upload" accept=".pdf,.jpg,.jpeg,.png,.webp" required={!cryptoRequest} onChange={e => setFileName(e.target.files?.[0]?.name ?? "")} /></label>
          <label className="topup-full">Notes <small>optional</small><Textarea name="notes" placeholder="Any additional details or instructions…" maxLength={4000} /></label></div>
        {error && <p ref={errorRef} tabIndex={-1} className="inline-error topup-submit-error" role="alert"><strong>Request not submitted</strong>{error}</p>}
        <Button type="submit" className="topup-submit" disabled={busy}>{busy ? <Loader2 className="spin" size={18} /> : <Send size={18} />}{busy ? "Submitting request…" : "Submit Request"}</Button>
      </fieldset></form>}
  </article></main>;
}
