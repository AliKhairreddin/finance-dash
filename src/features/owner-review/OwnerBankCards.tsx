import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { OwnerBankBalances } from "../../../shared/ownerBankBalances";
import { useUrlState } from "@/lib/url-state";
import { ReviewTable } from "./ReviewDetails";
import { usd, useReviewData } from "./reviewApi";

function nativeBalance(amount: number, currency: string) {
  if (/^[A-Z]{3}$/.test(currency)) {
    return amount.toLocaleString("en-US", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 8 });
  }
  return amount.toLocaleString("en-US", { maximumFractionDigits: 8 }) + " " + currency;
}

export function OwnerBankCards({ apiBase, preview }: { apiBase: string; preview: boolean }) {
  const [open, setOpen] = useUrlState("ownerBank", "");
  const [retry, setRetry] = useState(0);
  const { data, error } = useReviewData<OwnerBankBalances>(apiBase, "bank-balances" + (preview ? "?preview=Amin" : ""), retry);
  const selected = data?.groups.find(group => group.id === open);
  return <section className="panel owner-panel owner-banks" aria-label="Current bank balances">
    <div className="owner-heading"><h2>Current bank balances</h2>
      {data?.cashUsd != null && <span className="total-pill" title="Cash across saved balances, including valued crypto. Card debt is excluded.">{data.partial ? "Partial cash total" : "Cash total"} · ≈ {usd(data.cashUsd)}{data.staleRates.length > 0 && " · Stale FX"}</span>}</div>
    {error ? <p role="alert">Bank balances could not be loaded. <button className="owner-link" onClick={() => setRetry(n => n + 1)}>Retry</button></p>
      : !data ? <p role="status">Loading balances…</p>
      : <><div className="owner-card-grid owner-bank-grid">{data.groups.map(group =>
        <button type="button" className="owner-drill-card" key={group.id} aria-expanded={open === group.id}
          onClick={() => setOpen(open === group.id ? "" : group.id)}>
          <span>{group.name}</span><ChevronDown size={14} aria-hidden="true" />
          <strong>{group.usd === null ? "Estimate unavailable" : "≈ " + usd(group.usd)}</strong>
          {group.syncFailed && <small>Last saved balance</small>}
        </button>)}
        {data.pending.map(name => <div key={name} className="owner-drill-card"><span>{name}</span><strong>Pending</strong></div>)}</div>
        {!data.groups.length && !data.pending.length && <p>No saved bank balances.</p>}
        {selected && <div className="owner-breakdown"><div className="owner-heading"><h3>{selected.name}</h3>
          {selected.asOf && <small>Balances as of {new Date(selected.asOf).toLocaleString()}</small>}</div>
          {selected.debt && <p>Card debt is excluded from the cash total.</p>}
          {selected.fxAsOf && <small>FX as of {selected.fxAsOf.slice(0, 10)}</small>}
          {selected.staleRates.length > 0 && <small>Stale exchange rates · {selected.staleRates.join(", ")}</small>}
          {selected.missingRates.length > 0 && <small>Missing exchange rates · {selected.missingRates.join(", ")}</small>}
          <ReviewTable key={selected.id} name="ownerBankAccount" caption={selected.name + " account balances"} empty="No nonzero account balances."
            rows={selected.accounts} columns={[{ key: "name", label: "Account" }, { key: "currency", label: "Currency" },
              { key: "balance", label: "Native balance", show: r => nativeBalance(r.balance, r.currency) }]}
            mobileRow={r => <div className="owner-mobile-line"><span>{r.name}<small>{r.currency}</small></span><strong>{nativeBalance(r.balance, r.currency)}</strong></div>} />
        </div>}</>}
  </section>;
}
