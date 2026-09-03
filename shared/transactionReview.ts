import { isBankSource } from "./banks";
import type { DashboardSnapshot, TransactionReviewBootstrap } from "./types";

export function transactionReviewBootstrap(snapshot: DashboardSnapshot): TransactionReviewBootstrap {
  return {
    accounts: snapshot.accounts.flatMap((account) => isBankSource(account.source)
      ? [{ id: account.id, name: account.name, source: account.source }]
      : []),
    companies: snapshot.providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      type: provider.type,
      tags: provider.tags
    })),
    teams: snapshot.teams.map((team) => ({ ...team })),
    categories: snapshot.transactionCategories.map((category) => ({ ...category }))
  };
}
