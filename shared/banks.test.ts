import assert from "node:assert/strict";
import test from "node:test";
import { bankSourceMatches, isBankSourceFilter, selectedBankSources, isActiveBalanceSource, bankSources } from "./banks";
import { readUrlState, writeUrlState } from "../src/lib/url-state";

test("Wise remains selectable for bank history while excluded from active balances", () => {
  assert.equal(isActiveBalanceSource("wise"), false);
  for (const source of bankSources.filter(source => source.id !== "wise")) assert.equal(isActiveBalanceSource(source.id), true);
  assert.ok(bankSources.some(source => source.id === "wise"));
  assert.deepEqual(selectedBankSources("wise"), ["wise"]);
  assert.equal(bankSourceMatches("all", "wise"), true);
  assert.equal(bankSourceMatches("wise", "wise"), true);
});

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
