export const moneyInCategoryOptions = [
  "Media buying direct",
  "Partner network revenue",
  "Affiliate team revenue",
  "Revenue adjustment",
  "Refunds and chargebacks",
  "Capital movement",
  "Internal transfer",
  "Uncategorized"
] as const;

export const moneyOutCategoryOptions = [
  "Ad account funding",
  "Ad spend",
  "Affiliate payout",
  "Partner payout",
  "Creative production",
  "Software subscription",
  "Cloud and hosting",
  "Tracking and analytics",
  "Food and meals",
  "Travel",
  "Salary and payroll",
  "Contractors and freelancers",
  "Taxes and government",
  "Office and rent",
  "Payment processing",
  "Bank fees",
  "Legal and accounting",
  "Recruiting",
  "Education and training",
  "Marketing tools",
  "Telecom and internet",
  "Equipment",
  "Insurance",
  "Utilities",
  "Security and compliance",
  "Shipping and postage",
  "Internal transfer",
  "Uncategorized"
] as const;

export const transactionCategoryOptions = [...moneyInCategoryOptions, ...moneyOutCategoryOptions.filter((category) => !moneyInCategoryOptions.includes(category as (typeof moneyInCategoryOptions)[number]))] as const;

const reviewOnlyTransactionCategories = new Set([
  "",
  "uncategorized",
  "wise",
  "revolut",
  "slash",
  "debit",
  "credit",
  "card",
  "transfer",
  "balance cashback"
]);

function normalizedCategoryKey(category?: string): string {
  return (category ?? "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function canonicalCategory(category?: string): string {
  const key = normalizedCategoryKey(category);
  const replacements: Record<string, string> = {
    revenue: "Media buying direct",
    "affiliate revenue": "Affiliate team revenue",
    "partner revenue": "Partner network revenue",
    subscription: "Software subscription"
  };
  return replacements[key] ?? (category ?? "").trim();
}

export function isReviewOnlyTransactionCategory(category?: string): boolean {
  return reviewOnlyTransactionCategories.has(normalizedCategoryKey(category));
}

export function transactionBusinessCategory(category?: string): string {
  const trimmed = canonicalCategory(category);
  return trimmed && !isReviewOnlyTransactionCategory(trimmed) ? trimmed : "Uncategorized";
}

export function transactionCategoryOptionsForDirection(direction: "in" | "out"): readonly string[] {
  return direction === "in" ? moneyInCategoryOptions : moneyOutCategoryOptions;
}

export function isTransactionCategoryForDirection(category: string, direction: "in" | "out"): boolean {
  const normalized = transactionBusinessCategory(category);
  return transactionCategoryOptionsForDirection(direction).includes(normalized);
}
