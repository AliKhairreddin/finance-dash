import assert from "node:assert/strict";
import test from "node:test";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { internalAction } from "../convex/_generated/server";
import { v } from "convex/values";
import { statementCompanies } from "../shared/statements";

process.env.CONVEX_SERVICE_TOKEN = "test-service";
process.env.EXACT_CLIENT_ID = "test-client";
process.env.EXACT_CLIENT_SECRET = "test-secret";
process.env.EXACT_ENCRYPTION_KEY = "11".repeat(32);
const modules = {
  "../convex/_generated/server.ts": () => import("../convex/_generated/server"),
  "../convex/exact.ts": () => import("../convex/exact"),
  // Queue tests must never call the network or use real credentials.
  "../convex/exactSync.ts": async () => ({ pump: internalAction({ args: {}, returns: v.null(), handler: async () => null }) })
};
const auth = { serviceToken: "test-service", actor: "Ali" }, division = 3503006;
async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async ctx => {
    await ctx.db.insert("statementMembers", { actor: "Ali", companyIds: statementCompanies.map(c => c.id), manage: true, permissions: ["view","settings","documents","import","download"], accountIds: ["revolut-lmd","amex-lmd","wise-lmd"] });
    await ctx.db.insert("exactConnections", { key: "primary", state: "connected", leaseUntil: Date.now() + 90000, leaseToken: "lease", nextAllowedAt: 0, lastDiscoveryAt: Date.now() });
    await ctx.db.insert("exactCompanies", { division, name: "Test Company", code: "1", currency: "EUR", active: true, moveDate: "", discoveredAt: Date.now() });
  });
  return t;
}
test("Exact backend rejects missing membership and restricted statement membership", async () => {
  const t = await setup();
  await assert.rejects(t.query(api.exact.status, { ...auth, serviceToken: "wrong" }));
  await assert.rejects(t.query(api.exact.status, { ...auth, actor: "Alaa" }));
  await t.run(async ctx => { const member = await ctx.db.query("statementMembers").first(); await ctx.db.patch(member!._id, { companyIds: ["amg-holding"] }); });
  await assert.rejects(t.query(api.exact.status, auth));
});
test("Exact partial pages preserve the published snapshot and checkpoint until completion", async () => {
  const t = await setup();
  const id = await t.run(async ctx => {
    const id = await ctx.db.insert("exactDatasets", { division, kind: "accounts", generation: "old", buildingGeneration: "new", cursor: "1", state: "syncing", lastCompletedAt: 1, nextRunAt: 0, attempts: 0, pages: 0 });
    await ctx.db.insert("exactRecords", { division, kind: "accounts", generation: "old", providerId: "old", parentId: "old", data: { ID: "old", Name: "Old data" }, deleted: false, updatedAt: 1 }); return id;
  });
  const page = { token: "lease", id, rows: [{ ID: "new", Timestamp: "10", Name: "New data" }], cursor: "10", commitPage: false };
  await t.mutation(internal.exact.applyPage, page);
  assert.equal((await t.query(api.exact.records, { ...auth, division, kind: "accounts" })).records[0].data.Name, "Old data");
  assert.equal(await t.run(async ctx => (await ctx.db.get(id))?.cursor), "1");
  await t.mutation(internal.exact.applyPage, { ...page, commitPage: true });
  // Execute cleanup explicitly: node:test timers retain the scheduling mutation's
  // async context, which convex-test treats as an already-finished transaction.
  const cleanup = await t.run(async ctx => {
    const jobs = await ctx.db.system.query("_scheduled_functions").collect();
    const job = jobs.find(row => row.name === "exact:cleanGeneration");
    assert.ok(job); await ctx.scheduler.cancel(job._id); return job;
  });
  assert.deepEqual(cleanup.args, [{ division, kind: "accounts", generation: "old" }]);
  await t.mutation(internal.exact.cleanGeneration, { division, kind: "accounts", generation: "old" });
  assert.equal(await t.run(async ctx => (await ctx.db.query("exactRecords").collect()).length), 1);
  const records = await t.query(api.exact.records, { ...auth, division, kind: "accounts" }); assert.equal(records.records.length, 1); assert.equal(records.records[0].data.Name, "New data");
  assert.equal(await t.run(async ctx => (await ctx.db.get(id))?.cursor), "10");
});
test("Exact leases serialize API callers and reject stale workers", async () => {
  const t = await setup();
  assert.equal(await t.mutation(internal.exact.claim, { token: "another" }), null);
  await assert.rejects(t.mutation(internal.exact.saveConnection, { token: "stale", encryptedTokens: "secret", expiresAt: Date.now() }));
});
test("Exact authorization state is actor-bound and single use", async () => {
  const t = await setup(), hash = "a".repeat(64);
  await t.mutation(api.exact.createOAuthState, { ...auth, hash });
  await assert.rejects(t.mutation(internal.exact.consumeOAuthState, { ...auth, hash, actor: "Alaa" }));
  await t.mutation(internal.exact.consumeOAuthState, { ...auth, hash });
  await assert.rejects(t.mutation(internal.exact.consumeOAuthState, { ...auth, hash }));
});
test("Exact write confirmations are idempotent and remain isolated to an authorized company", async () => {
  const t = await setup();
  const input = { ...auth, division, kind: "accounts" as const, requestId: crypto.randomUUID(), confirmed: true, inputJson: JSON.stringify({ Name: "Supplier", IsSupplier: true }) };
  await assert.rejects(t.mutation(api.exact.queueOperation, { ...input, confirmed: false }));
  await assert.rejects(t.mutation(api.exact.queueOperation, { ...input, division: 999 }));
  const id = await t.mutation(api.exact.queueOperation, input);
  assert.equal(await t.mutation(api.exact.queueOperation, input), id);
  await assert.rejects(t.mutation(api.exact.queueOperation, { ...input, inputJson: JSON.stringify({ Name: "Different" }) }));
  assert.equal((await t.query(api.exact.operations, auth)).length, 1);
  await new Promise(resolve => setTimeout(resolve, 10));
  await t.finishInProgressScheduledFunctions();
});
test("Exact access-denied datasets preserve stored data but hide it from the dashboard", async () => {
  const t = await setup();
  const id = await t.run(async ctx => { const id = await ctx.db.insert("exactDatasets", { division, kind: "accounts", generation: "current", cursor: "10", state: "ready", lastCompletedAt: 1, nextRunAt: 0, attempts: 0, pages: 0 }); await ctx.db.insert("exactRecords", { division, kind: "accounts", generation: "current", providerId: "one", parentId: "one", data: { ID: "one", Name: "Stored" }, deleted: false, updatedAt: 1 }); return id; });
  await t.mutation(internal.exact.datasetFailed, { token: "lease", id, message: "Access denied", delay: 60000, denied: true });
  assert.equal((await t.query(api.exact.records, { ...auth, division, kind: "accounts" })).records.length, 0);
  assert.equal(await t.run(async ctx => (await ctx.db.query("exactRecords").take(2)).length), 1);
});
