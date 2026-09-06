import assert from "node:assert/strict";
import test from "node:test";
import { ConvexError } from "convex/values";
import { getCashReportAccounts } from "../convex/banking";

const handler: unknown = Reflect.get(getCashReportAccounts, "_handler");
async function run(ctx: unknown, args: unknown): Promise<Array<Record<string, unknown>>> {
  if (typeof handler !== "function") throw new Error("Query handler is unavailable");
  return handler(ctx, args);
}
const connectionKey = "a".repeat(64);

test("cash report query requires service authentication and a unique, bounded connection directory", async () => {
  const previous = process.env.CONVEX_SERVICE_TOKEN;
  process.env.CONVEX_SERVICE_TOKEN = "expected-token";
  try {
    const isUnauthorized = (error: unknown) => error instanceof ConvexError && JSON.stringify(error.data).includes("UNAUTHORIZED");
    await assert.rejects(run({}, { serviceToken: "wrong", connections: [] }), isUnauthorized);
    for (const connections of [
      [{ source: "wise", connectionKey: "invalid" }],
      [{ source: "wise", connectionKey }, { source: "wise", connectionKey }]
    ]) {
      await assert.rejects(run({}, { serviceToken: "expected-token", connections }), (error: unknown) =>
        error instanceof ConvexError && JSON.stringify(error.data).includes("INVALID_BANK_CONNECTION_DIRECTORY")
      );
    }
  } finally {
    if (previous === undefined) delete process.env.CONVEX_SERVICE_TOKEN;
    else process.env.CONVEX_SERVICE_TOKEN = previous;
  }
});

test("cash report query scopes balances by connection, preserves sync time and refuses truncated totals", async () => {
  const previous = process.env.CONVEX_SERVICE_TOKEN;
  process.env.CONVEX_SERVICE_TOKEN = "expected-token";
  let rowCount = 1;
  const filters: Array<[string, string]> = [];
  interface TestIndex { eq(field: string, value: string): TestIndex }
  const index: TestIndex = { eq(field, value) { filters.push([field, value]); return index; } };
  const ctx = { db: { query(table: string) {
    assert.equal(table, "bankAccounts");
    return { withIndex(name: string, predicate: (index: TestIndex) => unknown) {
      assert.equal(name, "by_source_connection"); predicate(index);
      return { async take(limit: number) {
        assert.equal(limit, 201);
        return Array.from({ length: rowCount }, (_, i) => ({
          _id: `internal-${i}`, _creationTime: 1, connectionKey,
          id: `wise-${i}`, source: "wise", name: "Wise USD", balance: 10, currency: "USD", status: "live",
          updatedAt: "2025-01-01T00:00:00Z", syncedAt: "2026-09-06T03:55:00Z"
        }));
      } };
    } };
  } } };
  try {
    const result = await run(ctx, { serviceToken: "expected-token", connections: [{ source: "wise", connectionKey }] });
    assert.deepEqual(filters, [["source", "wise"], ["connectionKey", connectionKey]]);
    assert.equal(result[0].syncedAt, "2026-09-06T03:55:00Z");
    assert.equal(result[0].connectionKey, undefined);
    assert.equal(result[0]._id, undefined);
    rowCount = 201;
    await assert.rejects(run(ctx, { serviceToken: "expected-token", connections: [{ source: "wise", connectionKey }] }), (error: unknown) =>
      error instanceof ConvexError && JSON.stringify(error.data).includes("BANK_ACCOUNT_LIMIT_EXCEEDED")
    );
  } finally {
    if (previous === undefined) delete process.env.CONVEX_SERVICE_TOKEN;
    else process.env.CONVEX_SERVICE_TOKEN = previous;
  }
});
