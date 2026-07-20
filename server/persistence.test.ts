import assert from "node:assert/strict";
import test from "node:test";
import { sanitizePersistedState } from "./persistence";

test("sanitizePersistedState removes a legacy OpenRouter key instead of rewriting it", () => {
  const sanitized = sanitizePersistedState({
    providers: [],
    aiSettings: {
      provider: "openrouter",
      model: "openrouter/auto",
      openRouterApiKey: "must-not-survive",
      updatedAt: "2026-07-09T00:00:00.000Z"
    }
  });

  assert.deepEqual(sanitized.aiSettings, {
    provider: "openrouter",
    model: "openrouter/auto",
    updatedAt: "2026-07-09T00:00:00.000Z"
  });
  assert.equal(JSON.stringify(sanitized).includes("must-not-survive"), false);
});

test("sanitizePersistedState preserves income workflow collections", () => {
  const paymentAllocations = [{ id: "payment-1" }];
  const revenueAccruals = [{ id: "accrual-1" }];
  const holdings = [{ id: "holding-1" }];
  const fxRates = [{ asset: "CAD", rateUsd: 0.74 }];
  const automationRuns = [{ id: "automation-1" }];
  const sanitized = sanitizePersistedState({
    paymentAllocations,
    revenueAccruals,
    holdings,
    fxRates,
    automationRuns
  });
  assert.equal(sanitized.paymentAllocations, paymentAllocations);
  assert.equal(sanitized.revenueAccruals, revenueAccruals);
  assert.equal(sanitized.holdings, holdings);
  assert.equal(sanitized.fxRates, fxRates);
  assert.equal(sanitized.automationRuns, automationRuns);
});
