import assert from "node:assert/strict";
import test from "node:test";
import { syncMeritActivity } from "./handler";
import { initialTransactionCategories } from "../shared/categories";
const env = { CONVEX_URL: "https://merit-test.convex.cloud", CONVEX_SERVICE_TOKEN: "test-token", MERIT_API_ID: "test-id", MERIT_API_KEY: "test-key", MERIT_BASE_URL: "https://merit-test.example" } as unknown as Parameters<typeof syncMeritActivity>[0];

test("Merit cooldown skips upstream calls and a failed import preserves all saved financial state", async () => {
  const previousFetch = globalThis.fetch;
  let acquired = false, upstreamCalls = 0, finishedWithError = false;
  const writes: string[] = [];
  globalThis.fetch = async (input, init) => {
    if (!String(input).includes("merit-test.convex.cloud")) { upstreamCalls++; throw new Error("Source unavailable"); }
    const body = JSON.parse(String(init?.body));
    let value: unknown;
    if (body.path === "integrationSync:begin") value = { acquired, retryAt: Date.now() + 300000 };
    else if (body.path === "integrationSync:finish") { finishedWithError = Boolean(body.args[0].error); value = null; }
    else if (body.path === "dashboard:getState") value = { updatedAt: "revision", providers: [], invoices: [], transactionCategories: initialTransactionCategories, transactionCategoryRules: [], expenses: [], wiseStatementImports: [] };
    else if (body.path === "banking:getActivityMetadata") value = { syncStates: [], syncHealth: [], accounts: [] };
    else { writes.push(body.path); throw new Error(`Unexpected state change: ${body.path}`); }
    return Response.json({ status: "success", value });
  };
  try {
    await syncMeritActivity(env);
    assert.equal(upstreamCalls, 0);
    acquired = true;
    await assert.rejects(syncMeritActivity(env));
    assert(upstreamCalls > 0);
    assert.equal(finishedWithError, true);
    assert.deepEqual(writes, []);
  } finally { globalThis.fetch = previousFetch; }
});
