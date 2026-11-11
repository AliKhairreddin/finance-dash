import assert from "node:assert/strict";
import test from "node:test";
import { bankPatternForInvoice, estimateBankPaymentPattern } from "./bankPaymentPatterns";

test("monthly receipts need no invoices, deduplicate receipt dates and retain stale cycles", () => {
  const dates = ["2026-02-18", "2026-03-17", "2026-04-16", "2026-06-17", "2026-07-16", "2026-08-18", "2026-08-18"];
  const result = estimateBankPaymentPattern(dates, "2026-11-10")!;
  assert.equal(result.intervalDays, 30);
  assert.equal(result.expectedDate, "2026-09-17");
  assert.equal(result.sampleSize, 6);
  assert.equal(result.stale, true);
  assert.equal(result.confidence, "low");
  assert.equal(estimateBankPaymentPattern(dates, "2026-12-10")!.expectedDate, result.expectedDate);
});

test("extra split receipts do not turn a monthly payer into a four-day payer", () => {
  const result = estimateBankPaymentPattern(["2026-02-02", "2026-03-03", "2026-03-31", "2026-05-06", "2026-06-01", "2026-07-01", "2026-07-31", "2026-08-31", "2026-10-01", "2026-11-02", "2026-11-06"], "2026-11-10")!;
  assert.equal(result.intervalDays, 30);
  assert.equal(result.expectedDate, "2026-12-06");
  assert.equal(result.matchingIntervals, 9);
  assert.equal(result.confidence, "medium");
  assert(result.earliestDate < result.expectedDate && result.latestDate > result.expectedDate);
});

test("a recent payment after a long interruption is a tentative resumed pattern", () => {
  const result = estimateBankPaymentPattern(["2026-02-06", "2026-03-06", "2026-04-03", "2026-11-03"], "2026-11-10")!;
  assert.equal(result.expectedDate, "2026-12-01");
  assert.equal(result.disrupted, true);
  assert.equal(result.confidence, "low");
  assert.equal(result.stale, false);
  assert.equal(result.earliestDate, "2026-11-28");
  assert.equal(result.latestDate, "2026-12-04");
});

test("insufficient, wildly irregular, duplicate-only and future receipts cannot produce a pattern", () => {
  for (const dates of [[], ["2026-01-01", "2026-02-01"], ["2026-01-01", "2026-01-02", "2026-09-01"], ["2026-01-01", "2026-01-01", "2026-01-01"], ["2026-01-01", "2026-02-01", "2027-01-01"]]) {
    assert.equal(estimateBankPaymentPattern(dates, "2026-11-10"), undefined);
  }
});

test("invoice projections use the payment cycle, never add that interval as net terms", () => {
  const pattern = estimateBankPaymentPattern(["2026-09-01", "2026-10-01", "2026-10-31"], "2026-11-10")!;
  assert.equal(bankPatternForInvoice(pattern, "2026-11-10").expectedDate, "2026-11-30");
  const future = bankPatternForInvoice(pattern, "2026-12-15");
  assert.equal(future.expectedDate, "2026-12-30");
  assert.equal(future.projectedCycles, 2);
  assert.equal(future.confidence, "low");
  assert(future.earliestDate >= "2026-12-15");
});
