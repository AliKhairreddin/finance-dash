import assert from "node:assert/strict";
import test from "node:test";
import { completeSync, replaceDate } from "../convex/mediaSpend";

function handlerOf(registered: object): (ctx: unknown, args: unknown) => Promise<unknown> {
  const handler: unknown = Reflect.get(registered, "_handler");
  if (typeof handler !== "function") throw new Error("Missing Convex handler");
  return (ctx, args) => handler(ctx, args);
}

test("empty media spend snapshots cannot erase stored financial data", async () => {
  const previous = process.env.CONVEX_SERVICE_TOKEN;
  process.env.CONVEX_SERVICE_TOKEN = "media-test";
  try {
    await assert.rejects(handlerOf(replaceDate)({}, {
      serviceToken: "media-test", date: "2026-09-19", rows: []
    }), /EMPTY_MEDIA_SPEND_DATE/);
  } finally {
    if (previous === undefined) delete process.env.CONVEX_SERVICE_TOKEN;
    else process.env.CONVEX_SERVICE_TOKEN = previous;
  }
});

test("completing a later sync does not claim coverage over an unsynced gap", async () => {
  const previous = process.env.CONVEX_SERVICE_TOKEN;
  process.env.CONVEX_SERVICE_TOKEN = "media-test";
  try {
    let saved: Record<string, unknown> | undefined;
    const existing = { _id: "state", attemptId: "attempt", coveredFrom: "2026-08-01",
      coveredThrough: "2026-09-18", requestedFrom: "2026-09-23", requestedTo: "2026-09-23",
      lastAttemptAt: "2026-09-24T08:30:00Z" };
    const context = { db: {
      query: () => ({ withIndex: () => ({ unique: async () => existing }) }),
      replace: async (_id: string, row: Record<string, unknown>) => { saved = row; }
    } };
    assert.equal(await handlerOf(completeSync)(context, {
      serviceToken: "media-test", attemptId: "attempt", completedAt: "2026-09-24T08:32:00Z",
      coveredThrough: "2026-09-23", rowCount: 2300, totalSpend: 56093.37
    }), true);
    assert.equal(saved?.coveredThrough, "2026-09-18");
  } finally {
    if (previous === undefined) delete process.env.CONVEX_SERVICE_TOKEN;
    else process.env.CONVEX_SERVICE_TOKEN = previous;
  }
});
