import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateMediaFundingBalance,
  calculateMediaFundingBankTransactionCredit,
  calculateMediaFundingCredit,
  mediaFundingAssignmentIsActive,
  mediaFundingBusinessManagerKey,
  mediaFundingTargetKey,
  resolveMediaFundingAssignment,
  type MediaFundingAssignment
} from "./mediaFunding";

function assignment(overrides: Partial<MediaFundingAssignment>): MediaFundingAssignment {
  return {
    id: "assignment-1",
    providerId: "provider-1",
    scope: "business_manager",
    targetKey: "business_manager:Facebook:bm-1",
    businessManagerKey: "Facebook:bm-1",
    platform: "Facebook",
    businessManagerId: "bm-1",
    effectiveFrom: "2026-08-01",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides
  };
}

test("provider fee becomes a snapshotted spendable credit", () => {
  assert.deepEqual(calculateMediaFundingCredit(100_000, 3), {
    feeAmount: 3_000,
    netAmount: 97_000
  });
  assert.deepEqual(calculateMediaFundingCredit(10.01, 2.5), {
    feeAmount: 0.25,
    netAmount: 9.76
  });
});

test("provider balance combines opening balance, net credits, adjustments, and spend", () => {
  assert.equal(calculateMediaFundingBalance({
    openingBalance: 50_000,
    netFunding: 97_000,
    adjustments: 500,
    spend: 30_000
  }), 117_500);
});

test("only matched posted bank funding after the opening date becomes provider credit", () => {
  const provider = {
    companyProviderId: "company-1",
    currency: "USD",
    defaultFeePercent: 6,
    openingBalanceDate: "2026-08-01"
  };
  const transaction = {
    amount: 50_000,
    category: "Ad account funding",
    currency: "USD",
    date: "2026-08-02",
    direction: "out",
    matchedProviderId: "company-1",
    status: "posted"
  };
  assert.deepEqual(calculateMediaFundingBankTransactionCredit(transaction, provider), {
    status: "included",
    feeAmount: 3_000,
    netAmount: 47_000
  });
  assert.equal(calculateMediaFundingBalance({ openingBalance: 0, netFunding: 47_000, adjustments: 0, spend: 20_000 }), 27_000);
  assert.equal(calculateMediaFundingBankTransactionCredit({ ...transaction, category: "Advertising" }, provider), null);
  assert.equal(calculateMediaFundingBankTransactionCredit({ ...transaction, matchedProviderId: "company-2" }, provider), null);
  assert.deepEqual(calculateMediaFundingBankTransactionCredit({ ...transaction, currency: "EUR" }, provider), { status: "currency_mismatch" });
});

test("assignment dates are inclusive", () => {
  const dated = assignment({ effectiveTo: "2026-08-10" });
  assert.equal(mediaFundingAssignmentIsActive(dated, "2026-07-31"), false);
  assert.equal(mediaFundingAssignmentIsActive(dated, "2026-08-01"), true);
  assert.equal(mediaFundingAssignmentIsActive(dated, "2026-08-10"), true);
  assert.equal(mediaFundingAssignmentIsActive(dated, "2026-08-11"), false);
});

test("direct ad account assignment resolves before a business manager assignment", () => {
  const businessManager = assignment({});
  const account = assignment({
    id: "assignment-2",
    providerId: "provider-2",
    scope: "ad_account",
    targetKey: "ad_account:Facebook:account-1",
    accountId: "account-1"
  });
  const resolved = resolveMediaFundingAssignment([businessManager, account], {
    accountId: "account-1",
    businessManagerId: "bm-1",
    date: "2026-08-05",
    platform: "Facebook"
  });
  assert.equal(resolved?.id, "assignment-2");
});

test("funding target keys use stable platform and external identifiers", () => {
  assert.equal(mediaFundingBusinessManagerKey("Facebook", "bm 1"), "Facebook:bm%201");
  assert.equal(mediaFundingTargetKey({
    scope: "ad_account",
    platform: "Facebook",
    businessManagerId: "bm-1",
    accountId: "account/1"
  }), "ad_account:Facebook:account%2F1");
});
