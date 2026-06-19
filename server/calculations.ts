import type { AccountBalance, Investment, LedgerItem, Metrics, Payable } from "../shared/types";

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);

export function calculateMetrics(
  accounts: AccountBalance[],
  receivables: LedgerItem[],
  openBalances: LedgerItem[],
  payables: Payable[],
  investments: Investment[]
): Metrics {
  const totalCash = sum(accounts.map((account) => account.balance));
  const totalReceivables = sum(receivables.map((item) => item.balance));
  const totalOpenBalance = sum(openBalances.map((item) => item.balance));
  const totalPayables = sum(payables.map((payable) => payable.balance));
  const totalFloat = totalCash + totalReceivables + totalOpenBalance;
  const profit = totalFloat - totalPayables;
  const investmentsTotal = sum(investments.map((investment) => investment.balance));
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
    totalAssets: profit + investmentsTotal,
    cashbackRedeemed: 9966.35,
    cryptoDifference: 28690,
    cashGrowth: 10.23,
    spendGrowth: 34.45,
    profitGrowth: 3.54,
    monthTotals
  };
}
