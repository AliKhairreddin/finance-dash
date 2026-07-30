import { transactionBusinessCategory } from "./categories";
import type { Transaction } from "./types";

export type ExpenseAnalyticsAttribution = {
  label: string;
  amount: number;
  transactionCount: number;
};

export type ExpenseAnalyticsCategory = {
  category: string;
  amount: number;
  transactionCount: number;
  attributions: ExpenseAnalyticsAttribution[];
};

export type ExpenseAnalyticsCurrency = {
  currency: string;
  total: number;
  categories: ExpenseAnalyticsCategory[];
};

type MutableAttribution = {
  label: string;
  amount: number;
  transactionCount: number;
};

type MutableCategory = {
  amount: number;
  transactionCount: number;
  attributions: Map<string, MutableAttribution>;
};

function attributionKey(label: string): string {
  return label.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

export function expenseAnalyticsLabel(transaction: Transaction, matchedCompanyName?: string): string {
  const companyName = matchedCompanyName?.trim();
  if (companyName) return companyName;

  return transaction.merchantName?.trim()
    || transaction.counterparty.trim()
    || transaction.rawName.trim()
    || transaction.description.trim();
}

export function groupExpenseAnalytics(
  transactions: readonly Transaction[],
  companyNamesById: ReadonlyMap<string, string>
): ExpenseAnalyticsCurrency[] {
  const currencies = new Map<string, Map<string, MutableCategory>>();

  for (const transaction of transactions) {
    if (transaction.direction !== "out") continue;

    const category = transactionBusinessCategory(transaction.category);
    const matchedCompanyName = transaction.matchedProviderId
      ? companyNamesById.get(transaction.matchedProviderId)
      : undefined;
    const label = expenseAnalyticsLabel(transaction, matchedCompanyName);
    const currencyCategories = currencies.get(transaction.currency) ?? new Map<string, MutableCategory>();
    const categoryTotal = currencyCategories.get(category) ?? {
      amount: 0,
      transactionCount: 0,
      attributions: new Map<string, MutableAttribution>()
    };
    const key = matchedCompanyName
      ? attributionKey(label)
      : transaction.merchantKey || attributionKey(label);
    const attribution = categoryTotal.attributions.get(key) ?? {
      label,
      amount: 0,
      transactionCount: 0
    };

    attribution.amount += transaction.amount;
    attribution.transactionCount += 1;
    categoryTotal.attributions.set(key, attribution);
    categoryTotal.amount += transaction.amount;
    categoryTotal.transactionCount += 1;
    currencyCategories.set(category, categoryTotal);
    currencies.set(transaction.currency, currencyCategories);
  }

  return [...currencies.entries()]
    .map(([currency, categoryTotals]) => {
      const categories = [...categoryTotals.entries()]
        .map(([category, totals]) => ({
          category,
          amount: totals.amount,
          transactionCount: totals.transactionCount,
          attributions: [...totals.attributions.values()]
            .sort((left, right) => right.amount - left.amount || left.label.localeCompare(right.label))
        }))
        .sort((left, right) => right.amount - left.amount || left.category.localeCompare(right.category));

      return {
        currency,
        total: categories.reduce((sum, category) => sum + category.amount, 0),
        categories
      };
    })
    .filter((group) => group.total > 0)
    .sort((left, right) => right.total - left.total || left.currency.localeCompare(right.currency));
}
