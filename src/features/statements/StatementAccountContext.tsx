import { createContext, useContext, type ReactNode } from "react";
import type { StatementBootstrap } from "../../../shared/statements";
const Accounts = createContext<StatementBootstrap["accounts"]>([]);
export const useStatementAccounts = () => useContext(Accounts);
export function StatementAccountsProvider({
  accounts,
  children,
}: {
  accounts: StatementBootstrap["accounts"];
  children: ReactNode;
}) {
  return <Accounts.Provider value={accounts}>{children}</Accounts.Provider>;
}
