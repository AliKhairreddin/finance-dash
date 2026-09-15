import { useEffect, useState } from "react";

export interface StatementAccount { id: string; name: string; source: "amex"; currency: string }
export function useAmexStatementAccounts(enabled: boolean): StatementAccount[] {
  const [accounts, setAccounts] = useState<StatementAccount[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const load = async () => {
      try {
        const response = await fetch(`${import.meta.env.VITE_API_BASE || "/api"}/amex/statements/accounts`);
        if (!response.ok) return;
        const rows: StatementAccount[] = await response.json();
        if (!disposed) setAccounts(rows);
      } catch { /* The transaction request displays connection errors. */ }
    };
    void load(); window.addEventListener("amex-statements-imported", load);
    return () => { disposed = true; window.removeEventListener("amex-statements-imported", load); };
  }, [enabled]);
  return accounts;
}
