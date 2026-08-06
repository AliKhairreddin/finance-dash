import assert from "node:assert/strict";
import test from "node:test";
import {
  amexProviderTransactionId,
  amexStableTransactionId,
  amexTransactionStatus,
  appendAmexCursorFingerprint,
  normalizeAmexAccount,
  normalizeAmexTransactions,
  parseAmexAccountConfigs
} from "./amexApi";
import { bankProviderTransactionId } from "./providerIdentity";

const accountConfig = {
  id: "account/one",
  name: "Corporate Gold",
  currency: "USD"
};

function transaction(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    transactionId: "txn/123",
    amount: { value: "123.45", currency: "USD" },
    status: "posted",
    postedDate: "2026-07-30T16:20:00.000Z",
    description: "Cloud hosting",
    merchant: { name: "Cloud Co" },
    category: "Software",
    ...overrides
  };
}

test("Amex lifecycle normalization accepts only explicit supported statuses", () => {
  for (const status of ["declined", "fail", "FAILED", "cancel", "cancelled", "reversal", "reverted", "voided"]) {
    assert.equal(amexTransactionStatus(status), "voided");
  }
  for (const status of ["pending", "authorized", "authorization pending"]) {
    assert.equal(amexTransactionStatus(status), "pending");
  }
  assert.equal(amexTransactionStatus("settled"), "settled");
  assert.equal(amexTransactionStatus("posted"), "posted");
  assert.throws(() => amexTransactionStatus(undefined), /status.*non-empty|status.*missing/i);
  assert.throws(() => amexTransactionStatus("mystery"), /status is unsupported/);
});

test("Amex IDs use exact bounded stable provider identifiers", () => {
  assert.equal(amexProviderTransactionId({ transactionId: "txn-123" }), "txn-123");
  assert.equal(amexProviderTransactionId({ id: "txn-456" }), "txn-456");
  assert.equal(
    amexStableTransactionId("account/one", { transactionId: "txn/123" }),
    bankProviderTransactionId("amex", ["account/one", "txn/123"])
  );
  assert.throws(
    () => amexStableTransactionId("a".repeat(257), { id: "txn-1" }),
    /account ID is missing or invalid/
  );
  assert.throws(
    () => amexStableTransactionId("account-1", { id: "x".repeat(513) }),
    /transaction id is missing or invalid/
  );
});

test("Amex IDs reject unstable substitutes and conflicting identifiers", () => {
  assert.throws(
    () => amexStableTransactionId("account-1", { reference: "ref-1", authorizationCode: "auth-1" }),
    /missing a stable provider transaction identifier/
  );
  assert.throws(
    () => amexStableTransactionId("account-1", { id: "txn-1", transactionId: "txn-2" }),
    /conflicting provider identifiers/
  );
  assert.throws(() => amexStableTransactionId("", { id: "txn-1" }), /account ID is missing or invalid/);
});

test("Amex account configuration is bounded, sorted, and collision-free", () => {
  assert.deepEqual(
    parseAmexAccountConfigs("b:Business B:CAD,a:Business A:USD"),
    [
      { id: "a", name: "Business A", currency: "USD" },
      { id: "b", name: "Business B", currency: "CAD" }
    ]
  );
  assert.throws(
    () => parseAmexAccountConfigs("account:One:USD,account:Two:USD"),
    /duplicate account IDs/
  );
  assert.throws(() => parseAmexAccountConfigs("account:Name:usd"), /supported currency code/);
  assert.throws(() => parseAmexAccountConfigs(`account:${"x".repeat(513)}:USD`), /configuration name/);
});

test("Amex accounts require real financial values and canonical timestamps", () => {
  assert.deepEqual(
    normalizeAmexAccount({
      currentBalance: { value: "1,234.56", currency: "USD" },
      displayName: "Gold Card",
      updatedAt: "2026-07-30T12:34:56-04:00"
    }, accountConfig),
    {
      id: "amex-account/one",
      name: "Gold Card",
      source: "amex",
      balance: -1234.56,
      currency: "USD",
      updatedAt: "2026-07-30T16:34:56.000Z",
      status: "live"
    }
  );
  assert.equal(normalizeAmexAccount({
    balance: { amount: -25, currencyCode: "USD" },
    asOfDate: "2026-07-30"
  }, accountConfig).balance, 25);

  for (const [payload, expected] of [
    [{ updatedAt: "2026-07-30T00:00:00.000Z" }, /balance is missing/],
    [{ balance: "not-money", updatedAt: "2026-07-30T00:00:00.000Z" }, /finite supported amount/],
    [{ balance: 10, updatedAt: "2026-02-30T00:00:00.000Z" }, /valid ISO timestamp|calendar date/],
    [{ balance: 10 }, /updated timestamp is missing/],
    [{ balance: { value: 10, currency: "CAD" }, updatedAt: "2026-07-30" }, /does not match/],
    [{ id: "another-account", balance: 10, updatedAt: "2026-07-30" }, /response ID does not match/]
  ] as const) {
    assert.throws(() => normalizeAmexAccount(payload, accountConfig), expected);
  }
});

test("Amex transactions normalize exact values and carry their persisted account identity", () => {
  const [normalized] = normalizeAmexTransactions([transaction()], accountConfig);
  assert.deepEqual(normalized, {
    id: bankProviderTransactionId("amex", ["account/one", "txn/123"]),
    providerLegacyId: "amex-account/one-txn/123",
    source: "amex",
    accountId: "amex-account/one",
    accountName: "Corporate Gold",
    date: "2026-07-30",
    description: "Cloud hosting",
    rawName: "Cloud Co",
    counterparty: "Cloud Co",
    amount: 123.45,
    currency: "USD",
    direction: "out",
    status: "posted",
    category: "Software"
  });

  const [credit] = normalizeAmexTransactions([
    transaction({ transactionId: "credit-1", amount: -12, type: "refund", status: "settled" })
  ], accountConfig);
  assert.equal(credit.amount, 12);
  assert.equal(credit.direction, "in");
  assert.equal(credit.status, "settled");
});

test("Amex transactions retain only the final four card digits", () => {
  const [normalized] = normalizeAmexTransactions([
    transaction({ card: { cardNumber: "3714 496353 98431" } })
  ], accountConfig);

  assert.equal(normalized.cardLastFour, "8431");
});

test("Amex transaction pages reject malformed rows atomically", () => {
  const valid = transaction({ transactionId: "valid" });
  const invalidCases: Array<[Record<string, unknown>, RegExp]> = [
    [transaction({ transactionId: "missing-amount", amount: undefined }), /amount is missing/],
    [transaction({ transactionId: "bad-amount", amount: Number.POSITIVE_INFINITY }), /finite supported amount/],
    [transaction({ transactionId: "missing-status", status: undefined }), /status is missing/],
    [transaction({ transactionId: "bad-status", status: "unknown" }), /status is unsupported/],
    [transaction({ transactionId: "missing-date", postedDate: undefined }), /date is missing/],
    [transaction({ transactionId: "bad-date", postedDate: "2026-02-30" }), /calendar date/],
    [transaction({ transactionId: "bad-currency", amount: { value: 2, currency: "usd" } }), /supported currency code/],
    [transaction({ transactionId: "wrong-currency", amount: { value: 2, currency: "CAD" } }), /does not match/],
    [transaction({ transactionId: "wrong-account", accountId: "another-account" }), /account ID does not match/],
    [transaction({ transactionId: "missing-party", merchant: undefined, description: undefined }), /counterparty is missing/],
    [transaction({ transactionId: "long-text", description: "x".repeat(1_025) }), /at most 1024/]
  ];
  for (const [invalid, expected] of invalidCases) {
    assert.throws(() => normalizeAmexTransactions([valid, invalid], accountConfig), expected);
  }
  assert.throws(
    () => normalizeAmexTransactions([valid, null], accountConfig),
    /only transaction objects/
  );
  assert.throws(
    () => normalizeAmexTransactions([transaction(), transaction()], accountConfig),
    /duplicate provider ID/
  );
});

test("Amex opaque cursor history rejects non-adjacent pagination cycles", async () => {
  let seen: string[] = [];
  seen = await appendAmexCursorFingerprint(seen, "cursor-a");
  seen = await appendAmexCursorFingerprint(seen, "cursor-b");
  await assert.rejects(
    appendAmexCursorFingerprint(seen, "cursor-a"),
    /repeated cursor cycle/
  );
  await assert.rejects(
    appendAmexCursorFingerprint(["not-a-digest"], "cursor-c"),
    /history is invalid/
  );
});
