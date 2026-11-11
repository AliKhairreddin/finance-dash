import assert from "node:assert/strict";
import test from "node:test";
import { bankSourceMatches, isBankSourceFilter, selectedBankSources } from "./banks";
import { readUrlState, writeUrlState } from "../src/lib/url-state";

test("bank selection accepts multiple sources, deduplicates, and restores from the URL", () => {
  const url = writeUrlState("https://finance.example/?bankSort=amount&bankOrder=asc", "allBankSource", "slash,revolut,slash", "all");
  const selection = readUrlState(url, "allBankSource", "all", { isValid: isBankSourceFilter });
  assert.deepEqual(selectedBankSources(selection), ["revolut", "slash"]);
  assert.equal(bankSourceMatches(selection, "slash"), true);
  assert.equal(bankSourceMatches(selection, "revolut"), true);
  assert.equal(bankSourceMatches(selection, "wise"), false);
  assert.equal(url.searchParams.get("bankSort"), "amount");
  assert.equal(url.searchParams.get("bankOrder"), "asc");
  assert.deepEqual(selectedBankSources("all"), []);
  assert.equal(bankSourceMatches("all", "amex"), true);
  for (const invalid of ["", "slash,", "slash,unknown", "all,wise"]) {
    assert.equal(isBankSourceFilter(invalid), false);
    assert.throws(() => selectedBankSources(invalid), /source is invalid/);
  }
});
