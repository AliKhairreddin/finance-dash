import assert from "node:assert/strict";
import test from "node:test";
import { getSnapshot, getAnalyticsSnapshot } from "./store";

test("dashboard snapshot exposes only a bounded transaction review preview", () => {
  const snapshot = getSnapshot();

  assert.equal("transactions" in snapshot, false);
  assert.equal(Array.isArray(snapshot.transactionReviewPreview), true);
  assert.equal(snapshot.transactionReviewPreview.length <= 5, true);
});

test("local analytics reports unverified history instead of asserting complete coverage", () => {
  const snapshot = getAnalyticsSnapshot("2026-09-08", "2026-09-08");
  assert.equal(snapshot.version, 3);
  assert.deepEqual(snapshot.coverage.map((item) => item.source), ["wise", "revolut", "slash", "amex"]);
  assert.ok(snapshot.coverage.every((item) => item.missingRanges[0].fromDate === snapshot.fromDate && item.missingRanges[0].toDate === snapshot.toDate));
});
