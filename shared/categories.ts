export const transactionCategoryOptions = [
  "Revenue",
  "Refunds and chargebacks",
  "Capital movement",
  "Ad account funding",
  "Ad spend",
  "Software subscription",
  "Cloud and hosting",
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

export function isReviewOnlyTransactionCategory(category?: string): boolean {
  return reviewOnlyTransactionCategories.has(normalizedCategoryKey(category));
}

export function transactionBusinessCategory(category?: string): string {
  const trimmed = (category ?? "").trim();
  return trimmed && !isReviewOnlyTransactionCategory(trimmed) ? trimmed : "Uncategorized";
}
