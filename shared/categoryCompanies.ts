import { transactionBusinessCategory } from "./categories";
import { isInternalTransferTransaction } from "./transactionPresentation";
import type { BankAnalyticsCategoryCompany, Transaction } from "./types";

export type AnalyticsCategoryCompanySelection = {
  fromDate: string;
  toDate: string;
  direction: Transaction["direction"];
  currency: string;
  category: string;
};

type CategoryCompanyTransaction = Pick<
  Transaction,
  | "id"
  | "date"
  | "direction"
  | "currency"
  | "status"
  | "category"
  | "amount"
  | "matchedProviderId"
  | "merchantKey"
  | "merchantName"
  | "counterparty"
  | "rawName"
  | "description"
>;

const dimensionLength = 160;

function compactText(value: string | undefined, fallback: string): string {
  const normalized = (value ?? "").trim().replace(/\s+/g, " ");
  return (normalized || fallback).slice(0, dimensionLength);
}

function merchantName(transaction: CategoryCompanyTransaction): string {
  return compactText(
    transaction.merchantName
      || transaction.counterparty
      || transaction.rawName
      || transaction.description,
    "Unknown merchant"
  );
}

function normalizedMerchantKey(transaction: CategoryCompanyTransaction, name: string): string {
  const normalized = (transaction.merchantKey?.trim() || name)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, dimensionLength);
  return normalized || "unknown-merchant";
}

export function analyticsCategoryCompanyIdentity(
  transaction: CategoryCompanyTransaction
): Pick<BankAnalyticsCategoryCompany, "companyKey" | "providerId" | "merchantName"> {
  const providerId = transaction.matchedProviderId?.trim();
  const name = merchantName(transaction);
  if (providerId) {
    return {
      companyKey: `provider:${providerId.slice(0, dimensionLength)}`,
      providerId: providerId.slice(0, dimensionLength),
      merchantName: name
    };
  }
  return {
    companyKey: `merchant:${normalizedMerchantKey(transaction, name)}`,
    merchantName: name
  };
}

export function aggregateAnalyticsCategoryCompanies(
  transactions: readonly CategoryCompanyTransaction[],
  selection: AnalyticsCategoryCompanySelection
): BankAnalyticsCategoryCompany[] {
  const currency = selection.currency.trim().toUpperCase();
  const category = transactionBusinessCategory(selection.category);
  const companies = new Map<string, BankAnalyticsCategoryCompany>();

  for (const transaction of transactions) {
    if (
      transaction.date < selection.fromDate
      || transaction.date > selection.toDate
      || transaction.direction !== selection.direction
      || transaction.currency.trim().toUpperCase() !== currency
      || transaction.status === "pending"
      || transaction.status === "voided"
      || transactionBusinessCategory(transaction.category) !== category
      || isInternalTransferTransaction(transaction as Transaction)
      || !Number.isFinite(transaction.amount)
      || transaction.amount < 0
    ) {
      continue;
    }
    const identity = analyticsCategoryCompanyIdentity(transaction);
    const existing = companies.get(identity.companyKey);
    companies.set(identity.companyKey, {
      ...identity,
      merchantName: existing?.merchantName ?? identity.merchantName,
      amount: (existing?.amount ?? 0) + transaction.amount,
      transactionCount: (existing?.transactionCount ?? 0) + 1
    });
  }

  return [...companies.values()].sort(
    (left, right) => right.amount - left.amount || left.merchantName.localeCompare(right.merchantName)
  );
}
