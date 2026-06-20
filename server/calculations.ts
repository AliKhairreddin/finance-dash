import type { AccountBalance, Investment, LedgerItem, Metrics, Payable } from "../shared/types";

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

export function calculateMetrics(
  accounts: AccountBalance[],
  receivables: LedgerItem[],
  openBalances: LedgerItem[],
  payables: Payable[],
  investments: Investment[]
): Metrics {
  const totalCash = accounts.length > 0 ? sum(accounts.map((account) => account.balance)) : null;
  const totalReceivables = receivables.length > 0 ? sum(receivables.map((item) => item.balance)) : null;
  const totalOpenBalance = openBalances.length > 0 ? sum(openBalances.map((item) => item.balance)) : null;
  const totalPayables = payables.length > 0 ? sum(payables.map((payable) => payable.balance)) : null;
  const totalFloat =
    totalCash !== null || totalReceivables !== null || totalOpenBalance !== null
      ? (totalCash ?? 0) + (totalReceivables ?? 0) + (totalOpenBalance ?? 0)
      : null;
  const hasOperatingRows = receivables.length > 0 || openBalances.length > 0 || payables.length > 0;
  const profit = hasOperatingRows && totalFloat !== null ? totalFloat - (totalPayables ?? 0) : null;
  const investmentsTotal = investments.length > 0 ? sum(investments.map((investment) => investment.balance)) : null;
  const totalAssets = profit !== null || investmentsTotal !== null ? (profit ?? 0) + (investmentsTotal ?? 0) : null;
  const monthTotals = payables.reduce<Record<string, number>>((months, payable) => {
    for (const [month, amount] of Object.entries(payable.monthBuckets)) {
      months[month] = (months[month] ?? 0) + amount;
    }
    return months;
  }, {});

  return {
    totalCash,
    totalReceivables,
    totalOpenBalance,
    totalPayables,
    totalFloat,
    profit,
    investments: investmentsTotal,
    totalAssets,
    monthTotals
  };
}
