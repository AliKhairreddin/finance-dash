import assert from "node:assert/strict";
import test from "node:test";
import { providerCashFlowLines } from "./providerCashFlow";
import type { MediaFundingApiResponse } from "./mediaFunding";

test("cash flow uses each provider's net balance once, keeps negatives, and does not turn missing balances into zero", () => {
  const funding = { coveredThrough: "2026-10-12", providers: [
    { id: "a", name: "Agency A", currency: "USD", estimatedBalance: 78000 },
    { id: "b", name: "Agency B", currency: "USD", estimatedBalance: -100 },
    { id: "c", name: "Agency C", currency: "USD", estimatedBalance: null }
  ] } as MediaFundingApiResponse;
  const before = structuredClone(funding);
  const lines = providerCashFlowLines(funding);
  assert.equal(lines.length, 3); assert.equal(new Set(lines.map(line => line.id)).size, 3);
  assert.equal(lines[0].amount, 78000); assert.equal(lines[1].amount, -100); assert.equal(Number.isNaN(lines[2].amount), true);
  assert.deepEqual(funding, before);
  assert.equal(Number.isNaN(providerCashFlowLines(null)[0].amount), true);
});
