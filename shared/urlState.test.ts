import assert from "node:assert/strict";
import test from "node:test";
import {
  isIsoDate,
  readUrlDateRange,
  readUrlState,
  writeUrlDateRange,
  writeUrlState
} from "../src/lib/url-state";

test("URL state reads allowed values and ignores invalid values", () => {
  const allowed = ["overview", "banks", "invoices"] as const;

  assert.equal(
    readUrlState("https://finance.example/?page=banks", "page", "overview", { allowedValues: allowed }),
    "banks"
  );
  assert.equal(
    readUrlState("https://finance.example/?page=unknown", "page", "overview", { allowedValues: allowed }),
    "overview"
  );
});

test("URL state removes defaults and can clear stale page parameters", () => {
  const filtered = writeUrlState(
    "https://finance.example/?page=banks&bankQuery=acme",
    "bankMatch",
    "matched",
    "needs-review"
  );
  assert.equal(filtered.searchParams.get("bankQuery"), "acme");
  assert.equal(filtered.searchParams.get("bankMatch"), "matched");

  const defaulted = writeUrlState(filtered, "bankMatch", "needs-review", "needs-review");
  assert.equal(defaulted.searchParams.has("bankMatch"), false);

  const navigated = writeUrlState(defaulted, "page", "invoices", "overview", true);
  assert.equal(navigated.search, "?page=invoices");
});

test("URL date ranges round-trip only complete valid ranges", () => {
  const defaults = { fromDate: "2026-06-01", toDate: "2026-06-30" };
  const selected = { fromDate: "2026-05-01", toDate: "2026-05-31" };
  const url = writeUrlDateRange(
    "https://finance.example/?page=banks",
    "revolutFrom",
    "revolutTo",
    selected,
    defaults
  );

  assert.deepEqual(readUrlDateRange(url, "revolutFrom", "revolutTo", defaults), selected);
  assert.deepEqual(
    readUrlDateRange(
      "https://finance.example/?revolutFrom=2026-05-31&revolutTo=2026-05-01",
      "revolutFrom",
      "revolutTo",
      defaults
    ),
    defaults
  );
  assert.equal(isIsoDate("2026-02-29"), false);
  assert.equal(isIsoDate("2026-02-28"), true);
});
