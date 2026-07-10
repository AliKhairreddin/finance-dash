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
