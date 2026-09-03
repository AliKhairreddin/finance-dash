import type { AccountBalance, Transaction } from "./types";

const maximumBankTransactionBytes = 16 * 1024;
const maximumBankAccountBytes = 8 * 1024;
export const maximumBankMutationPayloadBytes = 2 * 1024 * 1024;

function assertBoundedString(
  value: string | undefined,
  field: string,
  maximumLength: number,
  required = false
): void {
  if (value === undefined) {
    if (required) throw new Error(`${field} is required`);
    return;
  }
  if (typeof value !== "string" || (required && !value.trim()) || value.length > maximumLength) {
    throw new Error(`${field} must be ${required ? "a non-empty " : "a "}string of at most ${maximumLength} characters`);
  }
}

function assertFiniteAmount(value: number, field: string): void {
  if (!Number.isFinite(value) || Math.abs(value) > 1_000_000_000_000_000) {
    throw new Error(`${field} must be a finite supported amount`);
  }
}

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function assertBankTransactionInput(transaction: Transaction): void {
  assertBoundedString(transaction.id, "transaction.id", 2_048, true);
  assertBoundedString(transaction.providerLegacyId, "transaction.providerLegacyId", 2_048);
  assertBoundedString(transaction.accountId, "transaction.accountId", 1_024, true);
  assertBoundedString(transaction.accountName, "transaction.accountName", 512, true);
  assertBoundedString(transaction.slashVirtualAccountId, "transaction.slashVirtualAccountId", 1_024);
  assertBoundedString(transaction.slashVirtualAccountName, "transaction.slashVirtualAccountName", 512);
  assertBoundedString(transaction.description, "transaction.description", 1_024, true);
  assertBoundedString(transaction.rawName, "transaction.rawName", 1_024, true);
  assertBoundedString(transaction.counterparty, "transaction.counterparty", 1_024, true);
  assertBoundedString(transaction.cardHolderName, "transaction.cardHolderName", 512);
  assertBoundedString(transaction.cardId, "transaction.cardId", 1_024);
  assertBoundedString(transaction.cardLastFour, "transaction.cardLastFour", 4);
  if (transaction.cardLastFour !== undefined && !/^\d{4}$/.test(transaction.cardLastFour)) {
    throw new Error("transaction.cardLastFour must contain exactly four digits");
  }
  if (
    transaction.cardMetadataVersion !== undefined
    && (!Number.isSafeInteger(transaction.cardMetadataVersion) || transaction.cardMetadataVersion < 1)
  ) {
    throw new Error("transaction.cardMetadataVersion must be a positive safe integer");
  }
  if (
    transaction.slashVirtualAccountMetadataVersion !== undefined
    && (
      !Number.isSafeInteger(transaction.slashVirtualAccountMetadataVersion)
      || transaction.slashVirtualAccountMetadataVersion < 1
    )
  ) {
    throw new Error("transaction.slashVirtualAccountMetadataVersion must be a positive safe integer");
  }
  assertBoundedString(transaction.category, "transaction.category", 256, true);
  assertBoundedString(transaction.merchantName, "transaction.merchantName", 1_024);
  assertBoundedString(transaction.merchantKey, "transaction.merchantKey", 1_024);
  assertBoundedString(transaction.categoryReason, "transaction.categoryReason", 2_048);
  assertBoundedString(transaction.matchedProviderId, "transaction.matchedProviderId", 1_024);
  assertBoundedString(transaction.companyMatchReason, "transaction.companyMatchReason", 2_048);
  assertBoundedString(transaction.matchedInvoiceId, "transaction.matchedInvoiceId", 1_024);
  assertBoundedString(transaction.teamId, "transaction.teamId", 1_024);
  assertBoundedString(transaction.matchReason, "transaction.matchReason", 2_048);
  const parsedTransactionDate = Date.parse(`${transaction.date}T00:00:00.000Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(transaction.date)
    || !Number.isFinite(parsedTransactionDate)
    || new Date(parsedTransactionDate).toISOString().slice(0, 10) !== transaction.date
  ) {
    throw new Error("transaction.date must be a valid ISO calendar date");
  }
  if (!/^[A-Z0-9]{3,8}$/.test(transaction.currency)) {
    throw new Error("transaction.currency must be a 3-8 character uppercase currency code");
  }
  assertFiniteAmount(transaction.amount, "transaction.amount");
  if (transaction.amount < 0) throw new Error("transaction.amount cannot be negative");
  if (transaction.cashback) {
    assertFiniteAmount(transaction.cashback.amount, "transaction.cashback.amount");
    assertFiniteAmount(transaction.cashback.rate, "transaction.cashback.rate");
  }
  for (const [field, value] of [
    ["transaction.categoryConfidence", transaction.categoryConfidence],
    ["transaction.companyConfidence", transaction.companyConfidence],
    ["transaction.confidence", transaction.confidence]
  ] as const) {
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) {
      throw new Error(`${field} must be between 0 and 1`);
    }
  }
  if (jsonBytes(transaction) > maximumBankTransactionBytes) {
    throw new Error(`transaction ${transaction.id} exceeded ${maximumBankTransactionBytes} bytes`);
  }
}

export function assertBankAccountInput(account: AccountBalance): void {
  assertBoundedString(account.id, "account.id", 1_024, true);
  assertBoundedString(account.name, "account.name", 512, true);
  assertBoundedString(account.updatedAt, "account.updatedAt", 64, true);
  for (const virtualAccount of account.slashVirtualAccounts ?? []) {
    assertBoundedString(virtualAccount.id, "account.slashVirtualAccounts.id", 1_024, true);
    assertBoundedString(virtualAccount.name, "account.slashVirtualAccounts.name", 512, true);
    assertBoundedString(virtualAccount.accountId, "account.slashVirtualAccounts.accountId", 1_024, true);
    assertBoundedString(virtualAccount.closedAt, "account.slashVirtualAccounts.closedAt", 64);
  }
  if (!/^[A-Z0-9]{3,8}$/.test(account.currency)) {
    throw new Error("account.currency must be a 3-8 character uppercase currency code");
  }
  assertFiniteAmount(account.balance, "account.balance");
  if (jsonBytes(account) > maximumBankAccountBytes) {
    throw new Error(`account ${account.id} exceeded ${maximumBankAccountBytes} bytes`);
  }
}

export function assertBankActivityBatchBudget(
  accounts: readonly AccountBalance[],
  transactions: readonly Transaction[]
): void {
  for (const account of accounts) assertBankAccountInput(account);
  for (const transaction of transactions) assertBankTransactionInput(transaction);
  if (jsonBytes({ accounts, transactions }) > maximumBankMutationPayloadBytes) {
    throw new Error(`Bank activity mutation exceeded ${maximumBankMutationPayloadBytes} bytes`);
  }
}
