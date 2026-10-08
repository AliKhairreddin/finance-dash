import assert from "node:assert/strict";
import test from "node:test";
import type { MediaSpendApiResponse } from "./mediaSpend";
import { mediaSpendPeriodStatus, mediaSpendReimportAvailability } from "./mediaSpendStatus";

const saved: MediaSpendApiResponse = {
  version: 1, fromDate: "2026-10-01", toDate: "2026-10-06", currency: "USD",
  configured: true, missingConfiguration: [], rows: [], missingDates: [],
  summary: { totalSpend: 0, days: 6, platforms: 0, businessManagers: 0, accounts: 0 },
  sync: { status: "failed", lastAttemptAt: "2026-10-08T08:32:10.198Z", coveredFrom: "2026-08-01", coveredThrough: "2026-10-06" }
};

test("a failed newer import does not mark a fully saved selected period incomplete", () => {
  assert.deepEqual(mediaSpendPeriodStatus(saved), { complete: true, days: 6, savedDays: 6, label: "6/6 days saved", tone: "saved" });
});

test("interior missing days stay visible even when the global import is healthy", () => {
  const state = mediaSpendPeriodStatus({ ...saved, missingDates: ["2026-10-03"], sync: { ...saved.sync, status: "healthy" } });
  assert.equal(state.complete, false);
  assert.equal(state.label, "5/6 days saved");
  assert.equal(state.tone, "warning");
});

test("saved zero-spend days count as present without requiring visible account rows", () => {
  assert.equal(mediaSpendPeriodStatus(saved).savedDays, 6);
  assert.equal(mediaSpendPeriodStatus({ ...saved, missingDates: ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"] }).label, "0/6 days saved");
});

test("failed imports consume the same India-day allowance as successful imports", () => {
  assert.match(mediaSpendReimportAvailability(saved, Date.parse("2026-10-08T18:29:00Z")).disabledReason!, /already been attempted/);
  assert.equal(mediaSpendReimportAvailability(saved, Date.parse("2026-10-08T18:30:00Z")).disabledReason, null);
  assert.match(mediaSpendReimportAvailability({ ...saved, sync: { status: "running" } }, Date.parse("2026-10-09T00:00:00Z")).disabledReason!, /already running/);
});

test("manual reconciliation enforces the fourteen completed-day cap and excludes today", () => {
  const now = Date.parse("2026-10-09T08:30:00Z");
  assert.equal(mediaSpendReimportAvailability({ ...saved, fromDate: "2026-09-25", toDate: "2026-10-08" }, now).disabledReason, null);
  assert.match(mediaSpendReimportAvailability({ ...saved, fromDate: "2026-09-24", toDate: "2026-10-08" }, now).disabledReason!, /at most 14/);
  assert.deepEqual(mediaSpendReimportAvailability({ ...saved, toDate: "2026-10-10" }, now), { fromDate: "2026-10-01", toDate: "2026-10-08", disabledReason: null });
  assert.match(mediaSpendReimportAvailability({ ...saved, fromDate: "2026-10-09", toDate: "2026-10-10" }, now).disabledReason!, /Only completed days/);
  assert.match(mediaSpendReimportAvailability({ ...saved, configured: false }, now).disabledReason!, /not configured/);
});
