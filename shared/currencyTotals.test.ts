import assert from "node:assert/strict";
import test from "node:test";
import { convertCurrencyTotalsToUsd } from "./currencyTotals";

test("convertCurrencyTotalsToUsd combines native balances into one USD total", () => {
  assert.deepEqual(
    convertCurrencyTotalsToUsd(
      { USD: 100, EUR: 50, INR: 1_000, THB: 0 },
      [
        { asset: "EUR", rateUsd: 1.2, provider: "coinbase", asOf: "2026-07-24T10:00:00.000Z" },
        { asset: "INR", rateUsd: 0.012, provider: "coinbase", asOf: "2026-07-24T09:00:00.000Z" }
      ]
    ),
    {
      totalUsd: 172,
      excludedCurrencies: [],
      staleCurrencies: [],
      asOf: "2026-07-24T09:00:00.000Z"
    }
  );
});

test("convertCurrencyTotalsToUsd discloses unavailable and stale quotes", () => {
  assert.deepEqual(
    convertCurrencyTotalsToUsd(
      { USD: 10, EUR: 20, GBP: 30, CAD: 0 },
      [{ asset: "EUR", rateUsd: 1.1, provider: "coinbase", asOf: "2026-07-23T10:00:00.000Z", stale: true }]
    ),
    {
      totalUsd: 32,
      excludedCurrencies: ["GBP"],
      staleCurrencies: ["EUR"],
      asOf: "2026-07-23T10:00:00.000Z"
    }
  );
});
