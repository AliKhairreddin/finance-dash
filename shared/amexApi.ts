import type { AccountBalance, Transaction } from "./types";
import { bankProviderTransactionId } from "./providerIdentity";

export interface AmexAccountConfig {
  id: string;
  name: string;
  currency: string;
}

const maximumAmexAccountIdBytes = 256;
const maximumAmexProviderTransactionIdBytes = 512;
const maximumAmexTextLength = 1_024;
const maximumAmexAmount = 1_000_000_000_000_000;
const maximumAmexAccounts = 20;
export const maximumAmexCursorHistory = 500;
const voidedAmexStatuses = new Set([
  "decline",
  "declined",
  "fail",
  "failed",
  "cancel",
  "cancelled",
  "canceled",
  "reverse",
  "reversed",
  "reversal",
  "revert",
  "reverted",
  "reject",
  "rejected",
  "expire",
  "expired",
  "void",
  "voided"
]);
const pendingAmexStatuses = new Set([
  "pending",
  "approved",
  "authorized",
  "authorised",
  "authorization",
  "authorisation",
  "authorization pending",
  "authorisation pending",
  "preauthorized",
  "pre authorized"
]);
const settledAmexStatuses = new Set(["settled", "cleared"]);
const postedAmexStatuses = new Set(["posted", "complete", "completed", "processed"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function requiredIdentifier(
  value: unknown,
  field: string,
  maximumBytes: number
): string {
  if (typeof value !== "string") throw new Error(`Amex ${field} is missing or invalid`);
  const normalized = value.trim();
  if (
    !normalized
    || normalized !== value
    || utf8Length(normalized) > maximumBytes
    || /[\u0000-\u001f\u007f-\u009f]/u.test(normalized)
  ) {
    throw new Error(`Amex ${field} is missing or invalid`);
  }
  return normalized;
}

function boundedText(value: unknown, field: string, maximumLength: number): string {
  const normalized = typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : typeof value === "string"
      ? value.trim()
      : "";
  if (!normalized || normalized.length > maximumLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(normalized)) {
    throw new Error(`Amex ${field} must be non-empty text of at most ${maximumLength} characters`);
  }
  return normalized;
}

function firstPresent(values: readonly unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function optionalText(
  values: readonly unknown[],
  field: string,
  maximumLength = maximumAmexTextLength
): string | undefined {
  const value = firstPresent(values);
  return value === undefined ? undefined : boundedText(value, field, maximumLength);
}

function cardLastFour(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : typeof value === "string" ? value : "";
  const digits = text.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : undefined;
}

function requiredText(
  values: readonly unknown[],
  field: string,
  maximumLength = maximumAmexTextLength
): string {
  const value = firstPresent(values);
  if (value === undefined) throw new Error(`Amex ${field} is missing`);
  return boundedText(value, field, maximumLength);
}

function finiteMoney(value: unknown, field: string): number {
  let candidate = value;
  if (isRecord(candidate)) {
    candidate = candidate.value ?? candidate.amount ?? candidate.amountValue;
  }
  let amount: number;
  if (typeof candidate === "number") {
    amount = candidate;
  } else if (typeof candidate === "string") {
    const normalized = candidate.trim();
    if (
      !normalized
      || normalized.length > 64
      || !/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(normalized)
    ) {
      throw new Error(`Amex ${field} must be a finite supported amount`);
    }
    amount = Number(normalized.replaceAll(",", ""));
  } else {
    throw new Error(`Amex ${field} must be a finite supported amount`);
  }
  if (!Number.isFinite(amount) || Math.abs(amount) > maximumAmexAmount) {
    throw new Error(`Amex ${field} must be a finite supported amount`);
  }
  return amount;
}

export function amexCurrencyCode(value: unknown, field: string): string {
  const currency = boundedText(value, field, 8);
  if (!/^[A-Z0-9]{3,8}$/.test(currency)) {
    throw new Error(`Amex ${field} is not a supported currency code`);
  }
  return currency;
}

function moneyCurrency(value: unknown, configuredCurrency: string, field: string): string {
  if (!isRecord(value)) return amexCurrencyCode(configuredCurrency, "account configuration currency");
  const providerCurrency = firstPresent([value.currency, value.currencyCode, value.isoCurrencyCode]);
  const currency = providerCurrency === undefined
    ? amexCurrencyCode(configuredCurrency, "account configuration currency")
    : amexCurrencyCode(providerCurrency, `${field}.currency`);
  const expected = amexCurrencyCode(configuredCurrency, "account configuration currency");
  if (currency !== expected) {
    throw new Error(`Amex ${field}.currency does not match the configured account currency`);
  }
  return currency;
}

function canonicalCalendarDate(value: string, field: string): string {
  const dateMs = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? Date.parse(`${value}T00:00:00.000Z`)
    : Number.NaN;
  if (!Number.isFinite(dateMs) || new Date(dateMs).toISOString().slice(0, 10) !== value) {
    throw new Error(`Amex ${field} is not a valid ISO calendar date`);
  }
  return value;
}

export function amexTransactionDate(value: unknown, field: string): string {
  const timestamp = boundedText(value, field, 64);
  if (/^\d{4}-\d{2}-\d{2}$/.test(timestamp)) {
    return canonicalCalendarDate(timestamp, field);
  }
  if (
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(timestamp)
    || !Number.isFinite(Date.parse(timestamp))
  ) {
    throw new Error(`Amex ${field} is not a valid ISO date or timestamp`);
  }
  return canonicalCalendarDate(timestamp.slice(0, 10), field);
}

export function amexAccountTimestamp(value: unknown, field: string): string {
  const timestamp = boundedText(value, field, 64);
  if (/^\d{4}-\d{2}-\d{2}$/.test(timestamp)) {
    return `${canonicalCalendarDate(timestamp, field)}T00:00:00.000Z`;
  }
  if (
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(timestamp)
    || !Number.isFinite(Date.parse(timestamp))
  ) {
    throw new Error(`Amex ${field} is not a valid ISO timestamp`);
  }
  canonicalCalendarDate(timestamp.slice(0, 10), field);
  return new Date(timestamp).toISOString();
}

export function amexTransactionStatus(value: unknown): Transaction["status"] {
  const status = boundedText(value, "transaction status", 64)
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
  if (voidedAmexStatuses.has(status)) return "voided";
  if (pendingAmexStatuses.has(status)) return "pending";
  if (settledAmexStatuses.has(status)) return "settled";
  if (postedAmexStatuses.has(status)) return "posted";
  throw new Error(`Amex transaction status is unsupported: ${status}`);
}

export function parseAmexAccountConfigs(value?: string): AmexAccountConfig[] {
  if (!value?.trim()) return [];
  const rawConfigs = value.split(",");
  if (rawConfigs.length > maximumAmexAccounts) {
    throw new Error(`Amex sync supports at most ${maximumAmexAccounts} configured accounts`);
  }
  const configs = rawConfigs.map((rawConfig, index) => {
    const parts = rawConfig.split(":");
    if (parts.length > 3) {
      throw new Error(`AMEX_ACCOUNT_IDS entry ${index + 1} is invalid`);
    }
    const rawId = parts[0]?.trim();
    if (!rawId) throw new Error(`AMEX_ACCOUNT_IDS entry ${index + 1} is missing an account ID`);
    const id = requiredIdentifier(rawId, "account ID", maximumAmexAccountIdBytes);
    const name = parts[1]?.trim()
      ? boundedText(parts[1], "account configuration name", 512)
      : `Amex ${id}`;
    const currency = parts[2]?.trim()
      ? amexCurrencyCode(parts[2].trim(), "account configuration currency")
      : "USD";
    return { id, name, currency };
  }).sort((left, right) => left.id.localeCompare(right.id));
  if (new Set(configs.map((config) => config.id)).size !== configs.length) {
    throw new Error("AMEX_ACCOUNT_IDS contains duplicate account IDs");
  }
  return configs;
}

export function amexProviderTransactionId(transaction: unknown): string {
  if (!isRecord(transaction)) throw new Error("Amex transaction must be an object");
  const transactionId = transaction.transactionId === undefined || transaction.transactionId === null
    ? undefined
    : requiredIdentifier(
        transaction.transactionId,
        "transaction transactionId",
        maximumAmexProviderTransactionIdBytes
      );
  const id = transaction.id === undefined || transaction.id === null
    ? undefined
    : requiredIdentifier(transaction.id, "transaction id", maximumAmexProviderTransactionIdBytes);
  if (transactionId && id && transactionId !== id) {
    throw new Error("Amex transaction has conflicting provider identifiers");
  }
  const providerId = transactionId ?? id;
  if (!providerId) {
    throw new Error("Amex transaction is missing a stable provider transaction identifier");
  }
  return providerId;
}

function normalizedAmexAccountId(accountId: string): string {
  return requiredIdentifier(accountId, "account ID", maximumAmexAccountIdBytes);
}

export function amexPersistedAccountId(accountId: string): string {
  return `amex-${normalizedAmexAccountId(accountId)}`;
}

export function amexStableTransactionId(accountId: string, transaction: unknown): string {
  return bankProviderTransactionId("amex", [
    normalizedAmexAccountId(accountId),
    amexProviderTransactionId(transaction)
  ]);
}

export function amexLegacyTransactionId(accountId: string, transaction: unknown): string {
  return `amex-${normalizedAmexAccountId(accountId)}-${amexProviderTransactionId(transaction)}`;
}

function transactionRows(payload: unknown): Array<Record<string, unknown>> {
  const rows = Array.isArray(payload)
    ? payload
    : isRecord(payload)
      ? payload.transactions ?? payload.items ?? payload.data
      : undefined;
  if (!Array.isArray(rows) || rows.some((row) => !isRecord(row))) {
    throw new Error("Amex transaction response must contain only transaction objects");
  }
  return rows as Array<Record<string, unknown>>;
}

export function normalizeAmexAccount(payload: unknown, config: AmexAccountConfig): AccountBalance {
  if (!isRecord(payload)) throw new Error("Amex account response must be an object");
  const configuredAccountId = normalizedAmexAccountId(config.id);
  const providerAccountId = firstPresent([payload.accountId, payload.id]);
  if (
    providerAccountId !== undefined
    && requiredIdentifier(providerAccountId, "account response ID", maximumAmexAccountIdBytes) !== configuredAccountId
  ) {
    throw new Error("Amex account response ID does not match the configured account ID");
  }
  const configuredCurrency = amexCurrencyCode(config.currency, "account configuration currency");
  const balance = firstPresent([
    payload.currentBalance,
    payload.balance,
    payload.outstandingBalance,
    payload.statementBalance
  ]);
  if (balance === undefined) throw new Error("Amex account balance is missing");
  const rawBalance = finiteMoney(balance, "account balance");
  const name = optionalText(
    [payload.name, payload.displayName, payload.productName, payload.lastFive, payload.last4],
    "account name",
    512
  ) ?? boundedText(config.name, "account configuration name", 512);
  const updatedAtValue = firstPresent([payload.updatedAt, payload.lastUpdatedAt, payload.asOfDate]);
  if (updatedAtValue === undefined) throw new Error("Amex account updated timestamp is missing");
  return {
    id: amexPersistedAccountId(configuredAccountId),
    name,
    source: "amex",
    balance: rawBalance === 0 ? 0 : -rawBalance,
    currency: moneyCurrency(balance, configuredCurrency, "account balance"),
    updatedAt: amexAccountTimestamp(updatedAtValue, "account updated timestamp"),
    status: "live"
  };
}

export function normalizeAmexTransactions(payload: unknown, config: AmexAccountConfig): Transaction[] {
  const configuredCurrency = amexCurrencyCode(config.currency, "account configuration currency");
  const accountName = boundedText(config.name, "account configuration name", 512);
  const configuredAccountId = normalizedAmexAccountId(config.id);
  const accountId = amexPersistedAccountId(configuredAccountId);
  const normalized = transactionRows(payload).map((item): Transaction => {
    const providerAccountId = firstPresent([item.accountId, item.account_id]);
    if (
      providerAccountId !== undefined
      && requiredIdentifier(
        providerAccountId,
        "transaction account ID",
        maximumAmexAccountIdBytes
      ) !== configuredAccountId
    ) {
      throw new Error("Amex transaction account ID does not match the configured account ID");
    }
    const amountValue = firstPresent([
      item.amount,
      item.transactionAmount,
      item.billingAmount,
      item.totalAmount
    ]);
    if (amountValue === undefined) throw new Error("Amex transaction amount is missing");
    const rawAmount = finiteMoney(amountValue, "transaction amount");
    const statusValue = firstPresent([item.status, item.transactionStatus]);
    if (statusValue === undefined) throw new Error("Amex transaction status is missing");
    const status = amexTransactionStatus(statusValue);
    const type = optionalText([item.type, item.transactionType, item.kind], "transaction type", 128)
      ?.toLowerCase() ?? "";
    if (item.merchant !== undefined && item.merchant !== null && !isRecord(item.merchant)) {
      throw new Error("Amex transaction merchant must be an object");
    }
    const merchant = isRecord(item.merchant) ? item.merchant : {};
    const counterparty = requiredText(
      [merchant.name, item.merchantName, item.description, item.memo, item.reference],
      "transaction counterparty"
    );
    const description = optionalText(
      [item.description, item.memo, item.reference],
      "transaction description"
    ) ?? counterparty;
    const dateValue = firstPresent([
      item.postedDate,
      item.transactionDate,
      item.date,
      item.authorizationDate
    ]);
    if (dateValue === undefined) throw new Error("Amex transaction date is missing");
    const category = optionalText(
      [item.category, item.categoryCode, item.industry, item.merchantCategory],
      "transaction category",
      256
    ) ?? "Amex";
    const cardHolderName = optionalText(
      [item.cardHolderName, item.cardMemberName, item.employeeName],
      "transaction card holder name",
      512
    );
    const card = isRecord(item.card) ? item.card : {};
    const transactionCardLastFour = cardLastFour(firstPresent([
      item.cardLastFour,
      item.cardLast4,
      item.lastFour,
      item.last4,
      item.cardNumber,
      card.lastFour,
      card.last4,
      card.cardNumber,
      card.number
    ]));
    const isCredit = rawAmount < 0 || /refund|rebate|cashback|credit|reversal/.test(type);
    return {
      id: amexStableTransactionId(configuredAccountId, item),
      providerLegacyId: amexLegacyTransactionId(configuredAccountId, item),
      source: "amex",
      accountId,
      accountName,
      date: amexTransactionDate(dateValue, "transaction date"),
      description,
      rawName: counterparty,
      counterparty,
      amount: Math.abs(rawAmount),
      currency: moneyCurrency(amountValue, configuredCurrency, "transaction amount"),
      direction: isCredit ? "in" : "out",
      status,
      category,
      ...(status === "voided" ? { classificationComplete: true } : {}),
      ...(cardHolderName ? { cardHolderName } : {}),
      ...(transactionCardLastFour ? { cardLastFour: transactionCardLastFour } : {})
    };
  });
  const ids = new Set<string>();
  for (const transaction of normalized) {
    if (ids.has(transaction.id)) {
      throw new Error(`Amex transaction response contains duplicate provider ID ${transaction.id}`);
    }
    ids.add(transaction.id);
  }
  return normalized;
}

export async function amexCursorFingerprint(cursor: string): Promise<string> {
  const normalized = boundedText(cursor, "transaction pagination cursor", 4_096);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function appendAmexCursorFingerprint(
  seenFingerprints: readonly string[],
  nextCursor: string
): Promise<string[]> {
  if (
    seenFingerprints.length > maximumAmexCursorHistory
    || seenFingerprints.some((fingerprint) => !/^[0-9a-f]{64}$/.test(fingerprint))
  ) {
    throw new Error("Amex transaction pagination history is invalid");
  }
  const fingerprint = await amexCursorFingerprint(nextCursor);
  if (seenFingerprints.includes(fingerprint)) {
    throw new Error("Amex transaction pagination returned a repeated cursor cycle");
  }
  if (seenFingerprints.length >= maximumAmexCursorHistory) {
    throw new Error(`Amex transaction pagination exceeded ${maximumAmexCursorHistory} pages for one account`);
  }
  return [...seenFingerprints, fingerprint];
}
