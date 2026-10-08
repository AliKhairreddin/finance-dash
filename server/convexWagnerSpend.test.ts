import assert from "node:assert/strict";
import test from "node:test";
import { acquire, save, release } from "../convex/wagnerSpendCache";

function handler(fn: object): (ctx: unknown, args: unknown) => Promise<unknown> {
  return Reflect.get(fn, "_handler");
}

test("Convex saves chunked Wagner reports atomically, reuses history, and rejects stale writers", async t => {
  const original = process.env.CONVEX_SERVICE_TOKEN;
  process.env.CONVEX_SERVICE_TOKEN = "wagner-test";
  t.after(() => { if (original === undefined) delete process.env.CONVEX_SERVICE_TOKEN; else process.env.CONVEX_SERVICE_TOKEN = original; });
  const now = Date.parse("2026-10-08T12:00:00Z");
  t.mock.method(Date, "now", () => now);
  let report: Record<string, unknown> | null = null;
  let chunks: { _id: string; part: number; text: string }[] = [];
  const ctx = { db: {
    query: (table: string) => ({ withIndex: () => ({
      unique: async () => { assert.equal(table, "wagnerSpendCache"); return report; },
      take: async () => { assert.equal(table, "wagnerSpendCacheChunks"); return [...chunks].sort((a, b) => a.part - b.part); }
    }) }),
    insert: async (table: string, row: Record<string, unknown>) => {
      if (table === "wagnerSpendCache") { report = { _id: "report", ...row }; return "report"; }
      chunks.push({ _id: `chunk-${row.part}`, part: row.part as number, text: row.text as string });
      return `chunk-${row.part}`;
    },
    patch: async (_id: string, values: Record<string, unknown>) => { report = { ...report, ...values }; },
    delete: async (id: string) => { chunks = chunks.filter(chunk => chunk._id !== id); }
  } };
  const args = { serviceToken: "wagner-test", key: "wagner:v1:report", attemptId: "first" };
  await assert.rejects(handler(acquire)(ctx, { ...args, serviceToken: "wrong" }), /UNAUTHORIZED/);
  assert.deepEqual(await handler(acquire)(ctx, args), { status: "claimed" });
  assert.deepEqual(await handler(acquire)(ctx, { ...args, attemptId: "second" }), { status: "busy" });
  const payload = JSON.stringify({ rows: "a".repeat(250_000) });
  await assert.rejects(handler(save)(ctx, { ...args, attemptId: "wrong", payload, savedAt: now, refreshAfter: null }), /LEASE_LOST/);
  await handler(save)(ctx, { ...args, payload, savedAt: now, refreshAfter: null });
  assert.equal(chunks.length, 3);
  assert.deepEqual(await handler(acquire)(ctx, { ...args, attemptId: "second" }), { status: "cached", payload, savedAt: now, refreshAfter: null });
  await handler(release)(ctx, { ...args, attemptId: "wrong" });
  assert.equal(chunks.length, 3);
  chunks.pop();
  await assert.rejects(handler(acquire)(ctx, args), /INCOMPLETE_WAGNER_CACHE/);
});

test("expired Wagner reservations can be reclaimed without allowing the former owner to overwrite or release them", async t => {
  const original = process.env.CONVEX_SERVICE_TOKEN;
  process.env.CONVEX_SERVICE_TOKEN = "wagner-test";
  t.after(() => { if (original === undefined) delete process.env.CONVEX_SERVICE_TOKEN; else process.env.CONVEX_SERVICE_TOKEN = original; });
  let report = { _id: "report", attemptId: "old", leaseExpiresAt: Date.now() - 1 };
  const ctx = { db: {
    query: () => ({ withIndex: () => ({ unique: async () => report }) }),
    patch: async (_id: string, value: Partial<typeof report>) => { report = { ...report, ...value }; }
  } };
  const args = { serviceToken: "wagner-test", key: "wagner:v1:report", attemptId: "new" };
  assert.deepEqual(await handler(acquire)(ctx, args), { status: "claimed" });
  await handler(release)(ctx, { ...args, attemptId: "old" });
  assert.equal(report.attemptId, "new");
});
