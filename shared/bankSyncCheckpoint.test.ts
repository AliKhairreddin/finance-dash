import assert from "node:assert/strict";
import test from "node:test";
import { decodeBankSyncCheckpoint, encodeBankSyncCheckpoint } from "./bankSyncCheckpoint";

test("bank sync checkpoints round-trip opaque provider cursor state", () => {
  const checkpoint = encodeBankSyncCheckpoint({
    provider: "slash",
    windowStart: "2026-06-01T00:00:00.000Z",
    windowEnd: "2026-07-01T00:00:00.000Z",
    cursor: "provider/cursor+=value"
  });

  assert.doesNotMatch(checkpoint, /provider|cursor|2026/);
  assert.deepEqual(decodeBankSyncCheckpoint(checkpoint, "slash"), {
    provider: "slash",
    windowStart: "2026-06-01T00:00:00.000Z",
    windowEnd: "2026-07-01T00:00:00.000Z",
    cursor: "provider/cursor+=value"
  });
  assert.throws(() => decodeBankSyncCheckpoint(checkpoint, "revolut"), /does not match/);

  const wiseCheckpoint = encodeBankSyncCheckpoint({
    provider: "wise",
    windowStart: "2026-06-01T00:00:00.000Z",
    windowEnd: "2026-07-01T00:00:00.000Z",
    cursor: JSON.stringify({ balanceIndex: 2, intervalStart: "2026-06-12T00:00:00.000Z" })
  });
  assert.equal(decodeBankSyncCheckpoint(wiseCheckpoint, "wise").provider, "wise");
  assert.throws(() => decodeBankSyncCheckpoint(wiseCheckpoint, "slash"), /does not match/);
});

test("bank sync checkpoints reject malformed, unbounded, and noncanonical state", () => {
  assert.throws(() => decodeBankSyncCheckpoint("not+base64", "slash"), /invalid/);
  assert.throws(
    () => encodeBankSyncCheckpoint({
      provider: "revolut",
      windowStart: "2026-06-01",
      windowEnd: "2026-07-01T00:00:00.000Z",
      cursor: "2026-06-30T00:00:00.000Z"
    }),
    /windowStart is invalid/
  );
  assert.throws(
    () => encodeBankSyncCheckpoint({
      provider: "slash",
      windowStart: "2026-07-01T00:00:00.000Z",
      windowEnd: "2026-06-01T00:00:00.000Z",
      cursor: "cursor"
    }),
    /window is invalid/
  );
  assert.throws(
    () => encodeBankSyncCheckpoint({
      provider: "slash",
      windowStart: "2026-06-01T00:00:00.000Z",
      windowEnd: "2026-07-01T00:00:00.000Z",
      cursor: "x".repeat(256 * 1024 + 1)
    }),
    /cursor is invalid/
  );
});

test("bank sync checkpoints support strict Amex connector cursors", () => {
  const checkpoint = encodeBankSyncCheckpoint({
    provider: "amex",
    windowStart: "2026-07-01T00:00:00.000Z",
    windowEnd: "2026-07-31T23:59:59.999Z",
    cursor: JSON.stringify({ accountIndex: 0, cursor: null })
  });
  assert.equal(decodeBankSyncCheckpoint(checkpoint, "amex").provider, "amex");
});
