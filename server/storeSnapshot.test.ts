import assert from "node:assert/strict";
import test from "node:test";
import { getSnapshot } from "./store";

test("dashboard snapshot exposes only a bounded transaction review preview", () => {
  const snapshot = getSnapshot();

  assert.equal("transactions" in snapshot, false);
  assert.equal(Array.isArray(snapshot.transactionReviewPreview), true);
  assert.equal(snapshot.transactionReviewPreview.length <= 5, true);
});
