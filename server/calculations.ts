import type { AccountBalance, Investment, LedgerItem, Metrics, Payable } from "../shared/types";
import { combineCurrencyTotals, hasCurrencyTotals, subtractCurrencyTotals, sumCurrencyTotals } from "../shared/currencyTotals";

export function calculateMetrics(
  accounts: AccountBalance[],
  receivables: LedgerItem[],
  openBalances: LedgerItem[],
  payables: Payable[],
  investments: Investment[]
): Metrics {
  const totalCash = sumCurrencyTotals(accounts, (account) => account.balance);
  const totalReceivables = sumCurrencyTotals(receivables, (item) => item.balance);
  const totalOpenBalance = sumCurrencyTotals(openBalances, (item) => item.balance);
  const totalPayables = sumCurrencyTotals(payables, (payable) => payable.balance);
  const totalFloat = combineCurrencyTotals(totalCash, totalReceivables, totalOpenBalance);
  const hasOperatingRows = receivables.length > 0 || openBalances.length > 0 || payables.length > 0;
  const profit = hasOperatingRows && hasCurrencyTotals(totalFloat) ? subtractCurrencyTotals(totalFloat, totalPayables) : {};
  const investmentsTotal = sumCurrencyTotals(investments, (investment) => investment.balance);
  const totalAssets = combineCurrencyTotals(profit, investmentsTotal);
  const monthTotals = payables.reduce<Metrics["monthTotals"]>((months, payable) => {
    for (const [month, amount] of Object.entries(payable.monthBuckets)) {
      months[month] = combineCurrencyTotals(
        months[month] ?? {},
        sumCurrencyTotals([{ currency: payable.currency, amount }], (row) => row.amount)
      );
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
