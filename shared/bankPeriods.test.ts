import test from "node:test";
import assert from "node:assert/strict";
import { bankPeriodPresetRange } from "./bankPeriods";

const today = "2026-07-30";

test("bank period presets support a single-day Today range", () => {
  assert.deepEqual(bankPeriodPresetRange("today", today), {
    fromDate: "2026-07-30",
    toDate: "2026-07-30"
  });
});

test("bank period presets use Monday-based current and previous weeks", () => {
  assert.deepEqual(bankPeriodPresetRange("this-week", today), {
    fromDate: "2026-07-27",
    toDate: "2026-07-30"
  });
  assert.deepEqual(bankPeriodPresetRange("last-week", today), {
    fromDate: "2026-07-20",
    toDate: "2026-07-26"
  });
});

test("bank period presets create full and partial calendar months", () => {
  assert.deepEqual(bankPeriodPresetRange("this-month", today), {
    fromDate: "2026-07-01",
    toDate: "2026-07-30"
  });
  assert.deepEqual(bankPeriodPresetRange("last-month", today), {
    fromDate: "2026-06-01",
    toDate: "2026-06-30"
  });
});

test("bank period presets create inclusive recent and year-to-date ranges", () => {
  assert.deepEqual(bankPeriodPresetRange("recent", today, 45), {
    fromDate: "2026-06-16",
    toDate: "2026-07-30"
  });
  assert.deepEqual(bankPeriodPresetRange("this-year", today), {
    fromDate: "2026-01-01",
    toDate: "2026-07-30"
  });
});
