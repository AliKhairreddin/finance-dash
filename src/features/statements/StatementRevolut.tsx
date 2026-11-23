import { useEffect, useState } from "react";
import { InfoPopover } from "@/components/ui/finance-visuals";
import { convertCurrencyTotalsToUsd, sumCurrencyTotals } from "../../../shared/currencyTotals";
import { isCashCurrency, revolutLabel } from "../../../shared/revolutBalances";
import type { FxRate } from "../../../shared/types";
import { ErrorMessage, statementRequest, useStatementSort } from "./StatementUi";

interface State {
  mode?: "direct";
  historyPending?: boolean;
  coverageFrom?: string | null;
  coverageThrough?: string | null;
  accounts: { id: string; name: string; currency: string; owner: string; balance: number | null; syncedAt: string | null }[];
  rates: FxRate[];
  error: string;
  discoveredAt: number;
  importedThrough: string | null;
}

function balanceSummary(data: State | null): string {
  if (!data) return "Checking connection";
  if (!data.accounts.length) return data.discoveredAt ? "Company connection unavailable" : "Not connected";
  const cash = data.accounts.filter(account => isCashCurrency(account.currency));
  const total = cash.every(account => account.balance !== null)
    ? convertCurrencyTotalsToUsd(sumCurrencyTotals(cash, account => account.balance!), data.rates)
    : null;
  const usd = total && !total.excludedCurrencies.length && !total.staleCurrencies.length
    ? total.totalUsd.toLocaleString("en-US", { style: "currency", currency: "USD", currencyDisplay: "code" })
    : "USD unavailable";
  return `${usd} · ${data.accounts.length} connected account${data.accounts.length === 1 ? "" : "s"}`;
}

export function StatementRevolut({ companyId, revision }: { companyId: string; revision: number }) {
  const [data, setData] = useState<State | null>(null);
  const [error, setError] = useState("");
  const sort = useStatementSort("revolutAccounts", ["name", "owner", "balance", "currency", "syncedAt"] as const, "name", "asc");
  useEffect(() => {
    const abort = new AbortController();
    setData(null);
    setError("");
    void statementRequest<State>(`/revolut?companyId=${companyId}`, { signal: abort.signal })
      .then(setData).catch(e => { if (!abort.signal.aborted) setError(e.message); });
    return () => abort.abort();
  }, [companyId, revision]);

  return <details className="statement-panel">
    <summary style={{ padding: "12px 18px", cursor: "pointer" }}>
      {revolutLabel(companyId === "lovemedo" ? "lmd" : "dn")} · {balanceSummary(data)}
      <InfoPopover label="Revolut synchronization">
        Company ownership comes from Revolut bank details. Only completed payments are imported. {data?.mode === "direct"
          ? `LMD uses its own read-only connection. Recent activity refreshes every 15 minutes. Full history is reconciled monthly. ${data.coverageFrom ? `Saved coverage runs from ${data.coverageFrom} through ${data.coverageThrough ? new Date(data.coverageThrough).toLocaleString() : "pending"}.` : "Initial history synchronization is pending."}`
          : "Transactions reuse the Finance bank feed every five minutes. Saved history is limited to the periods synchronized in Finance."} Reload uses saved data.
        {data?.importedThrough && ` Last import: ${new Date(data.importedThrough).toLocaleString()}`}
      </InfoPopover>
    </summary>
    <ErrorMessage error={error || data?.error || ""} />
    {data?.historyPending && <p role="status" style={{ padding: "0 18px" }}>History synchronization in progress</p>}
    {data && !data.accounts.length && <p role="status" style={{ padding: "0 18px" }}>No verified Revolut accounts for this company are available through the current API connection.</p>}
    <div className="table-wrap"><table className="data-table">
      <thead><tr>{sort.head("name", "Account")}{sort.head("owner", "Account owner")}{sort.head("balance", "Saved balance")}{sort.head("currency", "Currency")}{sort.head("syncedAt", "Updated")}</tr></thead>
      <tbody>{[...(data?.accounts ?? [])].sort((a, b) => sort.compare(a[sort.sort], b[sort.sort])).map(account =>
        <tr key={account.id}>
          <td>{account.name}</td><td>{account.owner}</td>
          <td>{account.balance === null ? "Unavailable" : account.balance.toLocaleString(undefined, { maximumFractionDigits: 8 })}</td>
          <td>{account.currency}</td>
          <td>{account.syncedAt ? `${new Date(account.syncedAt).toLocaleString()}${Date.parse(account.syncedAt) < Date.now() - 30 * 60_000 ? " · Out of date" : ""}` : "Not synchronized"}</td>
        </tr>)}</tbody>
    </table></div>
  </details>;
}
