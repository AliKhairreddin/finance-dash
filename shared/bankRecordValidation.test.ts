import assert from "node:assert/strict";
import test from "node:test";
import { assertBankActivityBatchBudget, assertBankTransactionInput } from "./bankRecordValidation";
import type { Transaction } from "./types";

const valid: Transaction = {
  id: "wise-v2-1-616263",
  source: "wise",
  accountId: "wise-1-1",
  accountName: "Wise USD",
  date: "2026-07-31",
  description: "Payment",
  rawName: "Merchant",
  counterparty: "Merchant",
  amount: 10,
  currency: "USD",
  direction: "out",
  status: "posted",
  category: "Wise"
};

test("bank record validation rejects poison rows before Convex writes", () => {
  assert.doesNotThrow(() => assertBankTransactionInput(valid));
  assert.throws(
    () => assertBankTransactionInput({ ...valid, description: "x".repeat(1_025) }),
    /at most 1024/
  );
  assert.throws(() => assertBankTransactionInput({ ...valid, amount: Number.NaN }), /finite/);
  assert.throws(() => assertBankTransactionInput({ ...valid, date: "2026-02-30" }), /ISO calendar/);
  assert.throws(() => assertBankTransactionInput({ ...valid, currency: "usd" }), /currency/);
});

test("bank mutation payloads have an encoded byte ceiling", () => {
  const rows = Array.from({ length: 200 }, (_, index) => ({
    ...valid,
    id: `row-${index}`,
    description: "x".repeat(1_000),
    rawName: "x".repeat(1_000),
    counterparty: "x".repeat(1_000),
    categoryReason: "x".repeat(2_000),
    companyMatchReason: "x".repeat(2_000),
    matchReason: "x".repeat(2_000),
    merchantName: "x".repeat(1_000),
    merchantKey: "x".repeat(1_000),
    matchedProviderId: "x".repeat(1_000),
    matchedInvoiceId: "x".repeat(1_000),
    teamId: "x".repeat(1_000)
  }));
  assert.doesNotThrow(() => assertBankActivityBatchBudget([], rows.slice(0, 1)));
  assert.throws(() => assertBankActivityBatchBudget([], rows), /mutation exceeded/);
});
