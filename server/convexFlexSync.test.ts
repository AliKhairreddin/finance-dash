import assert from "node:assert/strict";
import test from "node:test";
import { get, update, observe, pending, deliveryResult } from "../convex/flexSync";
import { call, database } from "./convexTestDb";

test("Flex sync controls and outbox require service auth and a current connection lease, deduplicate delivery, and preserve retry state", async () => {
  const previous = process.env.CONVEX_SERVICE_TOKEN; process.env.CONVEX_SERVICE_TOKEN = "test";
  try {
    const connectionKey = "a".repeat(64);
    const credential = { serviceToken: "test", connectionKey, leaseToken: "lease", leaseFence: 1 };
    const db = database({ workerLeases: [{ _id: "lease", key: `bank-sync:flex:${connectionKey}`, token: "lease", fence: 1, expiresAt: Date.now() + 60000 }] });
    await assert.rejects(call(get, db, { ...credential, serviceToken: "bad" }), /UNAUTHORIZED/);
    await assert.rejects(call(update, db, { ...credential, leaseFence: 0 }), /INVALID_SYNC_LEASE/);
    const initial = await call(update, db, credential); assert(initial.activatedAt);
    await call(update, db, { ...credential, modifiedThrough: "2026-11-11T16:00:00Z", retryAt: Date.now() + 7200_000 });
    await call(update, db, { ...credential, modifiedThrough: "2026-11-10T16:00:00Z" });
    const state = await call(get, db, credential); assert.equal(state.modifiedThrough, "2026-11-11T16:00:00Z"); assert(state.retryAt > Date.now() + 7000_000);
    const observation = { key: "card:1", eventKey: "decline:1", at: "2026-11-11T16:01:00Z", active: true, always: true, message: "Declined", recoveryMessage: "Recovered", recipients: ["Ali", "Ali M"] };
    await call(observe, db, { ...credential, observations: [observation, observation] });
    assert.equal(db.tables.flexAlertDeliveries.length, 2);
    await call(observe, db, { ...credential, observations: [{ ...observation, eventKey: "recovery:2", at: "2026-11-11T16:02:00Z", active: false }] });
    assert.equal(db.tables.flexAlertDeliveries.length, 4);
    await call(observe, db, { ...credential, observations: [{ ...observation, eventKey: "recovery:3", at: "2026-11-11T16:03:00Z", active: false }] });
    assert.equal(db.tables.flexAlertDeliveries.length, 4);
    assert.equal((await call(pending, db, { serviceToken: "test", connectionKey: "b".repeat(64) })).length, 0);
    const queue = await call(pending, db, credential);
    await call(deliveryResult, db, { ...credential, id: queue[0].id, success: true });
    await call(deliveryResult, db, { ...credential, id: queue[1].id, success: false });
    assert.equal((await call(pending, db, credential)).length, 2);
    assert.equal(db.tables.flexAlertDeliveries[1].attempts, 1);
    assert.equal(db.tables.flexAlertDeliveries[1].status, "pending");
  } finally { if (previous === undefined) delete process.env.CONVEX_SERVICE_TOKEN; else process.env.CONVEX_SERVICE_TOKEN = previous; }
});
