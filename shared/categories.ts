import type {
  Transaction,
  TransactionCategory,
  TransactionCategoryDirection,
  TransactionCategoryRule
} from "./types";

export type TransactionCategorySeed = Pick<TransactionCategory, "id" | "name" | "direction" | "color" | "system">;

export const initialTransactionCategories: readonly TransactionCategorySeed[] = [
  { id: "media-buying-direct", name: "Media buying direct", direction: "in", color: "#2563eb", system: true },
  { id: "partner-network-revenue", name: "Partner network revenue", direction: "in", color: "#0891b2", system: true },
  { id: "affiliate-team-revenue", name: "Affiliate team revenue", direction: "in", color: "#0d9488", system: true },
  { id: "offer-acp", name: "ACP", direction: "in", color: "#7c3aed", system: true },
  { id: "offer-auto-insurance", name: "Auto insurance", direction: "in", color: "#4338ca", system: true },
  { id: "offer-home-insurance", name: "Home insurance", direction: "in", color: "#4f46e5", system: true },
  { id: "offer-life-insurance", name: "Life insurance", direction: "in", color: "#6d28d9", system: true },
  { id: "offer-health-insurance", name: "Health insurance", direction: "in", color: "#9333ea", system: true },
  { id: "offer-medicare", name: "Medicare", direction: "in", color: "#a21caf", system: true },
  { id: "offer-final-expense", name: "Final expense insurance", direction: "in", color: "#be185d", system: true },
  { id: "offer-roofing", name: "Roofing", direction: "in", color: "#c2410c", system: true },
  { id: "offer-window-replacement", name: "Window replacement", direction: "in", color: "#ea580c", system: true },
  { id: "offer-hvac", name: "HVAC", direction: "in", color: "#d97706", system: true },
  { id: "offer-solar", name: "Solar", direction: "in", color: "#ca8a04", system: true },
  { id: "offer-home-improvement", name: "Home improvement", direction: "in", color: "#65a30d", system: true },
  { id: "offer-mortgage", name: "Mortgage", direction: "in", color: "#15803d", system: true },
  { id: "offer-real-estate", name: "Real estate", direction: "in", color: "#047857", system: true },
  { id: "offer-debt-relief", name: "Debt relief", direction: "in", color: "#0f766e", system: true },
  { id: "offer-personal-injury", name: "Personal injury", direction: "in", color: "#0e7490", system: true },
  { id: "offer-legal-services", name: "Legal services", direction: "in", color: "#0369a1", system: true },
  { id: "offer-education", name: "Education", direction: "in", color: "#0284c7", system: true },
  { id: "offer-vsl", name: "VSL", direction: "in", color: "#2563eb", system: true },
  { id: "offer-auto-warranty", name: "Auto warranty", direction: "in", color: "#1d4ed8", system: true },
  { id: "offer-pest-control", name: "Pest control", direction: "in", color: "#57534e", system: true },
  { id: "revenue-adjustment", name: "Revenue adjustment", direction: "in", color: "#16a34a", system: true },
  { id: "refunds-and-chargebacks", name: "Refunds and chargebacks", direction: "in", color: "#65a30d", system: true },
  { id: "capital-movement", name: "Capital movement", direction: "both", color: "#7c3aed", system: true },
  { id: "ad-account-funding", name: "Ad account funding", direction: "out", color: "#dc2626", system: true },
  { id: "ad-spend", name: "Ad spend", direction: "out", color: "#ea580c", system: true },
  { id: "affiliate-payout", name: "Affiliate payout", direction: "out", color: "#d97706", system: true },
  { id: "partner-payout", name: "Partner payout", direction: "out", color: "#ca8a04", system: true },
  { id: "distribution", name: "Distribution", direction: "out", color: "#9333ea", system: true },
  { id: "creative-production", name: "Creative production", direction: "out", color: "#db2777", system: true },
  { id: "software-subscription", name: "Software", direction: "out", color: "#4f46e5", system: true },
  { id: "cloud-and-hosting", name: "Cloud and hosting", direction: "out", color: "#0284c7", system: true },
  { id: "tracking-and-analytics", name: "Tracking and analytics", direction: "out", color: "#0369a1", system: true },
  { id: "food-and-meals", name: "Food and meals", direction: "out", color: "#be123c", system: true },
  { id: "travel", name: "Travel", direction: "out", color: "#c2410c", system: true },
  { id: "salary-and-payroll", name: "Salary and payroll", direction: "out", color: "#b45309", system: true },
  { id: "contractors-and-freelancers", name: "Contractors and freelancers", direction: "out", color: "#a16207", system: true },
  { id: "taxes-and-government", name: "Taxes and government", direction: "out", color: "#78716c", system: true },
  { id: "office-and-rent", name: "Office and rent", direction: "out", color: "#57534e", system: true },
  { id: "payment-processing", name: "Payment processing", direction: "out", color: "#52525b", system: true },
  { id: "bank-fees", name: "Bank fees", direction: "out", color: "#71717a", system: true },
  { id: "legal-and-accounting", name: "Legal and accounting", direction: "out", color: "#475569", system: true },
  { id: "recruiting", name: "Recruiting", direction: "out", color: "#0f766e", system: true },
  { id: "education-and-training", name: "Education and training", direction: "out", color: "#047857", system: true },
  { id: "marketing-tools", name: "Marketing tools", direction: "out", color: "#15803d", system: true },
  { id: "telecom-and-internet", name: "Telecom and internet", direction: "out", color: "#0e7490", system: true },
  { id: "equipment", name: "Equipment", direction: "out", color: "#1d4ed8", system: true },
  { id: "insurance", name: "Insurance", direction: "out", color: "#6d28d9", system: true },
  { id: "utilities", name: "Utilities", direction: "out", color: "#7e22ce", system: true },
  { id: "security-and-compliance", name: "Security and compliance", direction: "out", color: "#9f1239", system: true },
  { id: "shipping-and-postage", name: "Shipping and postage", direction: "out", color: "#9a3412", system: true },
  { id: "internal-transfer", name: "Internal transfer", direction: "both", color: "#64748b", system: true },
  { id: "uncategorized", name: "Uncategorized", direction: "both", color: "#a1a1aa", system: true }
] as const;

export const moneyInCategoryOptions = initialTransactionCategories
  .filter((category) => category.direction === "in" || category.direction === "both")
  .map((category) => category.name);

export const moneyOutCategoryOptions = initialTransactionCategories
  .filter((category) => category.direction === "out" || category.direction === "both")
  .map((category) => category.name);

export const transactionCategoryOptions = initialTransactionCategories.map((category) => category.name);

const reviewOnlyTransactionCategories = new Set([
  "",
  "uncategorized",
  "wise",
  "revolut",
  "slash",
  "amex",
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
    subscription: "Software"
  };
  return replacements[key] ?? (category ?? "").trim();
}

export function isReviewOnlyTransactionCategory(category?: string): boolean {
  const key = normalizedCategoryKey(category);
  return reviewOnlyTransactionCategories.has(key) || isMerchantCategoryCode(key);
}

export function transactionBusinessCategory(category?: string): string {
  const trimmed = canonicalCategory(category);
  return trimmed && !isReviewOnlyTransactionCategory(trimmed) ? trimmed : "Uncategorized";
}

export function isMerchantCategoryCode(category?: string): boolean {
  return /^\d{4}$/.test(normalizedCategoryKey(category));
}

export function sanitizeStoredTransactionCategories(transactions: Transaction[]): Transaction[] {
  return transactions.map((transaction) => {
    const category = transactionBusinessCategory(transaction.category);
    return category === transaction.category ? transaction : { ...transaction, category };
  });
}

export function sanitizeStoredTransactionCategoryRules(rules: TransactionCategoryRule[]): TransactionCategoryRule[] {
  return rules.filter((rule) => !isMerchantCategoryCode(rule.category));
}

export function transactionCategoryOptionsForDirection(
  direction: "in" | "out",
  categories: readonly Pick<TransactionCategory, "name" | "direction">[] = initialTransactionCategories
): string[] {
  return categories
    .filter((category) => category.direction === direction || category.direction === "both")
    .map((category) => category.name);
}

export function isTransactionCategoryForDirection(
  category: string,
  direction: "in" | "out",
  categories: readonly Pick<TransactionCategory, "name" | "direction">[] = initialTransactionCategories
): boolean {
  const normalized = transactionBusinessCategory(category);
  return transactionCategoryOptionsForDirection(direction, categories).includes(normalized);
}

export function isRequiredTransactionCategory(
  category: string,
  direction: "in" | "out",
  categories: readonly Pick<TransactionCategory, "name" | "direction">[] = initialTransactionCategories
): boolean {
  const normalized = transactionBusinessCategory(category);
  return !isReviewOnlyTransactionCategory(normalized)
    && isTransactionCategoryForDirection(normalized, direction, categories);
}

export function normalizeTransactionCategoryName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export function isTransactionCategoryDirection(value: string): value is TransactionCategoryDirection {
  return value === "in" || value === "out" || value === "both";
}

export function isTransactionCategoryColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value);
}
