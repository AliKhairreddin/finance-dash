import assert from "node:assert/strict";
import test from "node:test";
import {
  groupMediaSpendByAccount,
  mediaSpendContiguousCoverage,
  mediaSpendDates,
  mediaSpendRefreshRange,
  mediaSpendYesterdayInIndia,
  parseLemonMaxSpendSummary,
  parseLemonMaxSpendSummaryRange,
  summarizeMediaSpend,
  validateMediaSpendDateRange
} from "./mediaSpend";

const response = {
  success: true,
  message: "Account spend summary fetched successfully",
  from_date: "2026-08-01",
  to_date: "2026-08-01",
  total_rows: 2,
  total_accounts: 2,
  total_spend: 5511.9,
  data: [
    {
      Workspace: 1,
      Date: "2026-08-01",
      Platform: "Facebook",
      "BM ID": "1012736345593474",
      "BM Name": "Hustle Digital",
      "Account ID": "1328654684466184",
      "Account Name": "Hustle 483 LB x M x HD x USD",
      Spend: 3119.71
    },
    {
      Workspace: 1,
      Date: "2026-08-01",
      Platform: "Facebook",
      "BM ID": "1859454042572238",
      "BM Name": "SMX Global 30",
      "Account ID": "4151872621726075",
      "Account Name": "1331 - 70163 - SeanX Meta 19",
      Spend: 2392.19
    }
  ]
};

test("parses the exact LemonMax account spend contract", () => {
  const rows = parseLemonMaxSpendSummary(
    response,
    "2026-08-01",
    "USD",
    "2026-08-02T08:30:00.000Z"
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].businessManagerName, "Hustle Digital");
  assert.equal(rows[0].spend, 3119.71);
  assert.match(rows[0].key, /^2026-08-01:/);
  assert.deepEqual(summarizeMediaSpend(rows), {
    totalSpend: 5511.9,
    days: 1,
    platforms: 1,
    businessManagers: 2,
    accounts: 2
  });
});

test("rejects data outside the requested day", () => {
  assert.throws(
    () => parseLemonMaxSpendSummary(response, "2026-08-02", "USD", "2026-08-03T08:30:00.000Z"),
    /does not match the requested date/
  );
});

test("keeps spend rows when LemonMax omits display names", () => {
  const rows = parseLemonMaxSpendSummary({
    ...response,
    total_rows: 1,
    total_accounts: 1,
    total_spend: 3119.71,
    data: [{
      ...response.data[0],
      "BM Name": null,
      "Account Name": "   "
    }]
  }, "2026-08-01", "USD", "2026-08-02T08:30:00.000Z");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].businessManagerName, undefined);
  assert.equal(rows[0].accountName, undefined);
  assert.equal(rows[0].spend, 3119.71);
});

test("groups daily spend into one row per platform ad account", () => {
  const rows = parseLemonMaxSpendSummaryRange({
    ...response,
    to_date: "2026-08-02",
    total_rows: 3,
    total_spend: 6392.19,
    data: [
      response.data[0],
      {
        ...response.data[0],
        Workspace: 2,
        Date: "2026-08-02",
        Spend: 880.29
      },
      response.data[1]
    ]
  }, "2026-08-01", "2026-08-02", "USD", "2026-08-03T08:30:00.000Z");

  const groups = groupMediaSpendByAccount(rows);
  assert.equal(groups.length, 2);
  const groupedAccount = groups.find((group) => group.accountId === "1328654684466184");
  assert.ok(groupedAccount);
  assert.equal(groupedAccount.dayCount, 2);
  assert.equal(groupedAccount.rows.length, 2);
  assert.equal(groupedAccount.spend, 4000);
  assert.deepEqual(groupedAccount.workspaces, [1, 2]);
});

test("imports every account including zero spend, unrelated names, and multiple workspaces", () => {
  const data = Array.from({ length: 2300 }, (_, index) => ({
    ...response.data[0], Workspace: index % 2 + 1, "Account ID": String(index),
    "Account Name": index % 2 ? "SG account" : "Another provider", Spend: index === 2299 ? 19.23 : 0
  }));
  const rows = parseLemonMaxSpendSummary({
    ...response, data, total_rows: 2300, total_accounts: 2300, total_spend: 19.23
  }, "2026-08-01", "USD", "2026-08-02T08:30:00Z");
  assert.equal(rows.length, 2300);
  assert.equal(rows.at(-1)?.spend, 19.23);
});

test("rejects partial API results using the source row, account, spend, and date totals", () => {
  for (const [change, error] of [
    [{ total_rows: 3 }, /incomplete row count/],
    [{ total_accounts: 3 }, /incomplete account count/],
    [{ total_spend: 5512.9 }, /reconcile/],
    [{ from_date: "2026-07-31" }, /date range/],
    [{ total_rows: undefined }, /incomplete row count/],
    [{ total_spend: "5511.9" }, /invalid account or spend totals/]
  ] as const) {
    assert.throws(() => parseLemonMaxSpendSummary({ ...response, ...change },
      "2026-08-01", "USD", "2026-08-02T08:30:00Z"), error);
  }
});

test("refreshes the last fourteen days and catches up every day after outages", () => {
  assert.deepEqual(mediaSpendRefreshRange("2026-08-01", "2026-09-23", "2026-09-22"),
    { fromDate: "2026-09-10", toDate: "2026-09-23" });
  assert.deepEqual(mediaSpendRefreshRange("2026-08-01", "2026-09-23", "2026-09-02"),
    { fromDate: "2026-09-03", toDate: "2026-09-23" });
  assert.deepEqual(mediaSpendRefreshRange("2026-09-20", "2026-09-23"),
    { fromDate: "2026-09-20", toDate: "2026-09-23" });
  const batch = mediaSpendRefreshRange("2026-01-01", "2026-09-23", "2026-01-01");
  assert.equal(batch.fromDate, "2026-01-02");
  assert.equal(mediaSpendDates(batch.fromDate, batch.toDate).length, 92);
});

test("coverage cannot jump over missing days in either direction", () => {
  assert.deepEqual(mediaSpendContiguousCoverage("2026-08-01", "2026-09-18", "2026-09-23"),
    { coveredFrom: "2026-08-01", coveredThrough: "2026-09-18" });
  assert.deepEqual(mediaSpendContiguousCoverage("2026-08-01", "2026-09-18", "2026-09-19"),
    { coveredFrom: "2026-08-01", coveredThrough: "2026-09-19" });
  assert.deepEqual(mediaSpendContiguousCoverage("2026-08-01", "2026-09-18", "2026-07-30"),
    { coveredFrom: "2026-08-01", coveredThrough: "2026-09-18" });
  assert.deepEqual(mediaSpendContiguousCoverage("2026-08-01", "2026-09-18", "2026-07-31"),
    { coveredFrom: "2026-07-31", coveredThrough: "2026-09-18" });
  assert.deepEqual(mediaSpendContiguousCoverage(undefined, undefined, "2026-09-23"),
    { coveredFrom: "2026-09-23", coveredThrough: "2026-09-23" });
});

test("uses India calendar time when selecting yesterday", () => {
  assert.equal(mediaSpendYesterdayInIndia(new Date("2026-08-27T08:30:00.000Z")), "2026-08-26");
  assert.equal(mediaSpendYesterdayInIndia(new Date("2026-08-26T20:00:00.000Z")), "2026-08-26");
});

test("bounds user-facing media spend ranges", () => {
  assert.doesNotThrow(() => validateMediaSpendDateRange("2026-08-01", "2026-08-27"));
  assert.throws(
    () => validateMediaSpendDateRange("2026-01-01", "2026-08-27"),
    /cannot exceed 92 days/
  );
});
