import test from "node:test";
import assert from "node:assert/strict";
import {
  analyticsCurrentPeriodRanges,
  analyticsDateRange,
  analyticsPeriodLabel,
  analyticsPresetWarmRanges,
  type AnalyticsPeriodSelection
} from "./analyticsPeriod";

const today = "2026-07-30";

function selection(
  mode: AnalyticsPeriodSelection["mode"],
  overrides: Partial<AnalyticsPeriodSelection> = {}
): AnalyticsPeriodSelection {
  return {
    mode,
    year: 2026,
    month: 7,
    quarter: 3,
    ...overrides
  };
}

test("analytics month periods include the complete selected month", () => {
  assert.deepEqual(
    analyticsDateRange(selection("month", { year: 2024, month: 2 }), today),
    { fromDate: "2024-02-01", toDate: "2024-02-29" }
  );
  assert.equal(
    analyticsPeriodLabel(selection("month", { year: 2024, month: 2 }), today),
    "February 2024"
  );
});

test("analytics quarter periods align to calendar quarters", () => {
  assert.deepEqual(
    analyticsDateRange(selection("quarter", { year: 2025, quarter: 4 }), today),
    { fromDate: "2025-10-01", toDate: "2025-12-31" }
  );
  assert.equal(
    analyticsPeriodLabel(selection("quarter", { year: 2025, quarter: 4 }), today),
    "Q4 2025"
  );
});

test("analytics year to date always follows the current calendar year", () => {
  assert.deepEqual(
    analyticsDateRange(selection("ytd", { year: 2022 }), today),
    { fromDate: "2026-01-01", toDate: "2026-07-30" }
  );
  assert.equal(analyticsPeriodLabel(selection("ytd"), today), "2026 YTD");
});

test("analytics full-year periods include January through December", () => {
  assert.deepEqual(
    analyticsDateRange(selection("year", { year: 2023 }), today),
    { fromDate: "2023-01-01", toDate: "2023-12-31" }
  );
  assert.equal(analyticsPeriodLabel(selection("year", { year: 2023 }), today), "2023");
});

test("analytics relative periods align to calendar days, Monday weeks, and months", () => {
  assert.deepEqual(analyticsDateRange(selection("today"), today), {
    fromDate: "2026-07-30",
    toDate: "2026-07-30"
  });
  assert.deepEqual(analyticsDateRange(selection("yesterday"), today), {
    fromDate: "2026-07-29",
    toDate: "2026-07-29"
  });
  assert.deepEqual(analyticsDateRange(selection("last_7_days"), today), {
    fromDate: "2026-07-24",
    toDate: "2026-07-30"
  });
  assert.deepEqual(analyticsDateRange(selection("last_30_days"), today), {
    fromDate: "2026-07-01",
    toDate: "2026-07-30"
  });
  assert.deepEqual(analyticsDateRange(selection("this_week"), today), {
    fromDate: "2026-07-27",
    toDate: "2026-07-30"
  });
  assert.deepEqual(analyticsDateRange(selection("last_week"), today), {
    fromDate: "2026-07-20",
    toDate: "2026-07-26"
  });
  assert.deepEqual(analyticsDateRange(selection("this_month"), today), {
    fromDate: "2026-07-01",
    toDate: "2026-07-30"
  });
  assert.deepEqual(analyticsDateRange(selection("last_month"), today), {
    fromDate: "2026-06-01",
    toDate: "2026-06-30"
  });
  assert.deepEqual(analyticsDateRange(selection("this_quarter"), today), {
    fromDate: "2026-07-01",
    toDate: "2026-07-30"
  });
  assert.deepEqual(analyticsDateRange(selection("last_quarter"), today), {
    fromDate: "2026-04-01",
    toDate: "2026-06-30"
  });
});

test("analytics custom periods use the selected inclusive dates", () => {
  const custom = selection("custom", { fromDate: "2026-05-03", toDate: "2026-05-19" });
  assert.deepEqual(analyticsDateRange(custom, today), {
    fromDate: "2026-05-03",
    toDate: "2026-05-19"
  });
  assert.equal(analyticsPeriodLabel(custom, today), "2026-05-03 – 2026-05-19");
});

test("current month, quarter, and year periods stop at today", () => {
  assert.deepEqual(
    analyticsDateRange(selection("month", { year: 2026, month: 7 }), today),
    { fromDate: "2026-07-01", toDate: "2026-07-30" }
  );
  assert.deepEqual(
    analyticsDateRange(selection("quarter", { year: 2026, quarter: 3 }), today),
    { fromDate: "2026-07-01", toDate: "2026-07-30" }
  );
  assert.deepEqual(
    analyticsDateRange(selection("year", { year: 2026 }), today),
    { fromDate: "2026-01-01", toDate: "2026-07-30" }
  );
});

test("Analytics current-period warming includes only unique live ranges", () => {
  assert.deepEqual(analyticsCurrentPeriodRanges("2026-08-01"), [
    { fromDate: "2026-01-01", toDate: "2026-08-01" },
    { fromDate: "2026-08-01", toDate: "2026-08-01" },
    { fromDate: "2026-07-01", toDate: "2026-08-01" }
  ]);
  assert.deepEqual(analyticsCurrentPeriodRanges("2026-01-01"), [
    { fromDate: "2026-01-01", toDate: "2026-01-01" }
  ]);
});

test("Analytics preset warming prioritizes live ranges then completed current-year periods", () => {
  assert.deepEqual(analyticsPresetWarmRanges("2026-08-01"), [
    { fromDate: "2026-01-01", toDate: "2026-08-01" },
    { fromDate: "2026-08-01", toDate: "2026-08-01" },
    { fromDate: "2026-07-01", toDate: "2026-08-01" },
    { fromDate: "2026-07-01", toDate: "2026-07-31" },
    { fromDate: "2026-06-01", toDate: "2026-06-30" },
    { fromDate: "2026-05-01", toDate: "2026-05-31" },
    { fromDate: "2026-04-01", toDate: "2026-04-30" },
    { fromDate: "2026-03-01", toDate: "2026-03-31" },
    { fromDate: "2026-02-01", toDate: "2026-02-28" },
    { fromDate: "2026-01-01", toDate: "2026-01-31" },
    { fromDate: "2026-04-01", toDate: "2026-06-30" },
    { fromDate: "2026-01-01", toDate: "2026-03-31" }
  ]);
});
