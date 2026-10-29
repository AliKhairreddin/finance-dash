import assert from "node:assert/strict";
import test from "node:test";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { statementCompanies } from "../shared/statements";
process.env.CONVEX_SERVICE_TOKEN = "capture-test";
const auth = { serviceToken: "capture-test", actor: "Ali" }, tokenHash = "a".repeat(64);
const modules = { "../convex/_generated/server.ts": () => import("../convex/_generated/server"), "../convex/statementCapture.ts": () => import("../convex/statementCapture") };
async function setup() {
  const t = convexTest(schema, modules);
  await t.run(async ctx => { await ctx.db.insert("statementMembers", { actor: "Ali", companyIds: statementCompanies.map(c => c.id), manage: true, permissions: ["view","settings","documents","import","download"], accountIds: ["revolut-lmd","amex-lmd","wise-lmd"] }); await ctx.db.insert("statementMembers", { actor: "Alaa", companyIds: ["artec"], manage: false }); });
  return t;
}
test("device keys have no timed expiry, require full membership and can be revoked", async () => {
  const t = await setup();
  await assert.rejects(t.mutation(api.statementCapture.connect, { ...auth, serviceToken: "bad", tokenHash }));
  await assert.rejects(t.mutation(api.statementCapture.connect, { ...auth, actor: "Alaa", tokenHash }));
  await t.mutation(api.statementCapture.connect, { ...auth, tokenHash });
  await assert.rejects(t.mutation(api.statementCapture.connect, { ...auth, tokenHash: "b".repeat(64) }));
  await t.run(async ctx => { const row = await ctx.db.query("statementCaptureDevices").first(); await ctx.db.patch(row!._id, { createdAt: 0 }); });
  assert.deepEqual(await t.mutation(api.statementCapture.acceptUpload, { serviceToken: auth.serviceToken, tokenHash }), { actor: "Ali", retryAfter: 0 });
  assert.deepEqual(await t.query(api.statementCapture.status, auth), { active: true });
  await t.mutation(api.statementCapture.disconnect, auth);
  assert.deepEqual(await t.mutation(api.statementCapture.acceptUpload, { serviceToken: auth.serviceToken, tokenHash }), { actor: null, retryAfter: 0 });
  await t.mutation(api.statementCapture.connect, { ...auth, tokenHash: "b".repeat(64) });
  assert.deepEqual(await t.mutation(api.statementCapture.acceptUpload, { serviceToken: auth.serviceToken, tokenHash }), { actor: null, retryAfter: 0 });
});
test("rate limits are durable, bounded and removed access blocks uploads immediately", async () => {
  const t = await setup(), input = { serviceToken: auth.serviceToken, tokenHash };
  await t.mutation(api.statementCapture.connect, { ...auth, tokenHash });
  for (let i = 0; i < 5; i++) assert.equal((await t.mutation(api.statementCapture.acceptUpload, input)).actor, "Ali");
  const limited = await t.mutation(api.statementCapture.acceptUpload, input);
  assert.equal(limited.actor, null); assert.ok(limited.retryAfter > 0 && limited.retryAfter <= 60);
  await t.run(async ctx => { const row = await ctx.db.query("statementCaptureDevices").first(); await ctx.db.patch(row!._id, { minuteStart: 0, dayCount: 120 }); });
  assert.ok((await t.mutation(api.statementCapture.acceptUpload, input)).retryAfter > 60);
  await t.run(async ctx => { const owner = await ctx.db.query("statementMembers").withIndex("by_actor", q => q.eq("actor", "Ali")).unique(); await ctx.db.patch(owner!._id, { manage: false }); });
  assert.deepEqual(await t.mutation(api.statementCapture.acceptUpload, input), { actor: null, retryAfter: 0 });
});
