import assert from "node:assert/strict";
import test from "node:test";
import { meritHistoryKey, validateMeritHistory } from "./meritHistory";
const row = { SIHId: "1", DocumentDate: "20260131", CustomerName: "Client", TotalSum: 100 };
test("Merit history validates entire bounded periods, rejecting partial or malformed source responses", () => {
  assert.equal(meritHistoryKey("2026-01-01", "2026-03-31"), "merit-history:2026-01-01:2026-03-31");
  assert.equal(validateMeritHistory([row], "2026-01-01", "2026-01-31"), JSON.stringify([row]));
  for (const records of [null, { Data: [row] }, [row, row], [{ ...row, TotalSum: null }], [{ ...row, DocumentDate: "20260201" }], [{ ...row, SIHId: "" }]]) {
    assert.throws(() => validateMeritHistory(records, "2026-01-01", "2026-01-31"));
  }
  for (const dates of [["2026-02-30", "2026-03-01"], ["2026-01-01", "2026-04-01"], ["2026-02-01", "2026-01-01"], ["2099-01-01", "2099-01-01"]]) assert.throws(() => meritHistoryKey(...dates as [string, string]));
});
