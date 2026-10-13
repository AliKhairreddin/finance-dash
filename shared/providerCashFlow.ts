import type { CashFlowLine } from "./types";
import type { MediaFundingApiResponse } from "./mediaFunding";

export function providerCashFlowLines(funding: MediaFundingApiResponse | null): CashFlowLine[] {
  if (!funding) return [{ id: "provider-balance-pending", name: "Provider balances pending", amount: NaN, currency: "USD" }];
  return funding.providers.map(provider => ({
    id: `provider-balance-${provider.id}`, name: provider.name,
    amount: provider.estimatedBalance ?? NaN, currency: provider.currency,
    notes: provider.estimatedBalance === null ? "Awaiting funding reconciliation"
      : `Provider balance; spend through ${funding.coveredThrough ?? provider.openingBalanceDate}`
  }));
}
