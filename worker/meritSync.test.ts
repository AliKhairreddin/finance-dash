import assert from "node:assert/strict";
import test from "node:test";
import { syncMeritActivity, syncMeritHistory } from "./handler";
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

test("historical Merit reads reuse saved data and failed refreshes never replace it", async () => {
  const previousFetch = globalThis.fetch;
  let acquired = true, upstreamCalls = 0, valid = false;
  const saved = { fromDate: "2026-01-01", toDate: "2026-01-31", fetchedAt: "2026-02-01", recordsJson: "[]" };
  const writes: string[] = [];
  globalThis.fetch = async (input, init) => {
    if (!String(input).includes("merit-test.convex.cloud")) {
      upstreamCalls++;
      return Response.json(valid ? [{ SIHId: "1", DocumentDate: "20260115", CustomerName: "Client", TotalSum: 100 }] : { error: "incomplete" });
    }
    const body = JSON.parse(String(init?.body));
    let value: unknown;
    if (body.path === "meritHistory:get") value = saved;
    else if (body.path === "integrationSync:begin") value = { acquired, retryAt: Date.now() + 300000 };
    else if (body.path === "integrationSync:finish") value = null;
    else if (body.path === "meritHistory:save") { writes.push(body.path); value = saved; }
    else throw new Error(`Unexpected write: ${body.path}`);
    return Response.json({ status: "success", value });
  };
  try {
    assert.deepEqual(await syncMeritHistory(env, saved.fromDate, saved.toDate), saved);
    assert.equal(upstreamCalls, 0);
    await assert.rejects(syncMeritHistory(env, saved.fromDate, saved.toDate, true));
    assert.deepEqual(writes, []);
    acquired = false;
    await assert.rejects(syncMeritHistory(env, saved.fromDate, saved.toDate, true));
    assert.equal(upstreamCalls, 1);
    acquired = valid = true;
    await syncMeritHistory(env, saved.fromDate, saved.toDate, true);
    assert.deepEqual(writes, ["meritHistory:save"]);
  } finally { globalThis.fetch = previousFetch; }
});
