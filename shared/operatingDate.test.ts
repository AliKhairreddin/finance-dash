import assert from "node:assert/strict";
import test from "node:test";
import { financeOperatingDate, shiftFinanceOperatingDate } from "./operatingDate";

test("finance operating date is the same for users in every browser timezone", () => {
  assert.equal(financeOperatingDate(new Date("2026-08-24T03:30:00.000Z")), "2026-08-23");
  assert.equal(financeOperatingDate(new Date("2026-08-24T04:30:00.000Z")), "2026-08-24");
});

test("finance operating dates shift by calendar day", () => {
  assert.equal(shiftFinanceOperatingDate("2026-03-08", -1), "2026-03-07");
  assert.equal(shiftFinanceOperatingDate("2026-12-31", 1), "2027-01-01");
});
