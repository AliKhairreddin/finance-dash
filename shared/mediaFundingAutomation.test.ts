import assert from "node:assert/strict";
import test from "node:test";
import { inferMediaFundingAssignments, mediaFundingNamePattern } from "./mediaFundingAutomation";
import { mediaFundingTargetKey, type MediaFundingAssignment } from "./mediaFunding";
import type { MediaSpendRow } from "./mediaSpend";
const date = "2026-09-14";
function row(accountId: string, accountName = `LMD02_${accountId}`, changes: Partial<MediaSpendRow> = {}): MediaSpendRow {
  return { key: accountId, source: "lemonmax", platform: "Facebook", accountId, accountName, businessManagerId: "bm", date, workspace: 1, spend: 10, currency: "USD", syncedAt: "2026-09-24T00:00:00Z", ...changes };
}
function assignment(accountId: string, changes: Partial<MediaFundingAssignment> = {}): MediaFundingAssignment {
  const target = { scope: "ad_account" as const, platform: "Facebook", businessManagerId: "bm", accountId };
  return { ...target, id: accountId, targetKey: mediaFundingTargetKey(target), businessManagerKey: "Facebook:bm", providerId: "meta", accountName: `LMD02_${accountId}`, effectiveFrom: date, createdAt: date, updatedAt: date, ...changes };
}
const examples = [assignment("1"), assignment("2")];
test("names retain the full distinctive pattern while numbers and separators vary", () => {
  assert.equal(mediaFundingNamePattern("DigitalNudge_SG_EST_USD_140826_020"), mediaFundingNamePattern("digitalnudge-sg-est-usd-170926-105"));
  assert.notEqual(mediaFundingNamePattern("DigitalNudge_SG_EST_USD_140826_020"), mediaFundingNamePattern("Hexa_DigitalNudge_USD_EST_020"));
  for (const name of ["Account 123", "Meta USD 56", "", "123"]) assert.equal(mediaFundingNamePattern(name), undefined);
});
test("new accounts need two distinct manual examples and are deduplicated across workspaces", () => {
  assert.equal(inferMediaFundingAssignments([row("3"), row("3", undefined, { workspace: 2 })], examples, date).length, 1);
  assert.equal(inferMediaFundingAssignments([row("3")], [examples[0], { ...examples[0], id: "duplicate" }], date).length, 0);
});
test("conflicting providers and generic name matches remain unassigned", () => {
  assert.deepEqual(inferMediaFundingAssignments([row("3")], [...examples, assignment("4", { providerId: "other" })], date), []);
  assert.deepEqual(inferMediaFundingAssignments([row("3", "Account 3")], [assignment("1", { accountName: "Account 1" }), assignment("2", { accountName: "Account 2" })], date), []);
});
test("automatic assignments never become training evidence", () => {
  assert.deepEqual(inferMediaFundingAssignments([row("3")], examples.map((a) => ({ ...a, autoPattern: "lmd # #" })), date), []);
});
test("manual assignments and real provider-transfer dates take priority", () => {
  assert.deepEqual(inferMediaFundingAssignments([row("3")], [...examples, assignment("3", { providerId: "other" })], date), []);
  assert.deepEqual(inferMediaFundingAssignments([row("3")], [...examples, assignment("3", { providerId: "other", effectiveFrom: "2026-09-20" })], date), []);
});
test("historical gaps end before an existing same-provider assignment", () => {
  const result = inferMediaFundingAssignments([row("3")], [...examples, assignment("3", { effectiveFrom: "2026-09-20" })], date);
  assert.equal(result[0]?.effectiveFrom, date);
  assert.equal(result[0]?.effectiveTo, "2026-09-19");
});
test("an earlier rebuild extends a matching automatic interval without duplicating it", () => {
  const result = inferMediaFundingAssignments([row("3")], [...examples, assignment("3", { effectiveFrom: "2026-09-20", autoPattern: "lmd # #" })], date);
  assert.equal(result[0]?.extendAssignmentId, "3");
  assert.deepEqual(inferMediaFundingAssignments([row("3")], [...examples, assignment("3", { autoPattern: "lmd # #" })], date), []);
});
test("manual BM coverage is preserved and platforms do not cross-match", () => {
  const bm = assignment("bm", { scope: "business_manager", targetKey: "business_manager:Facebook:bm", accountId: undefined });
  assert.deepEqual(inferMediaFundingAssignments([row("3")], [...examples, bm], date), []);
  assert.deepEqual(inferMediaFundingAssignments([row("3", undefined, { platform: "Other" })], examples, date), []);
});
test("renamed manual accounts supply current-name evidence and expose conflicts", () => {
  const sr = (id: string) => row(id, `SR | 1266 - WH${id} - (SR AUTO ${id})`);
  const manual = [assignment("1", { accountName: "SuccessRoom | 1266 - WH1 - (SR AUTO 1)", providerId: "24" }), assignment("2", { accountName: "SuccessRoom | 1266 - WH2 - (SR AUTO 2)", providerId: "24" })];
  assert.equal(inferMediaFundingAssignments([sr("1"), sr("2"), sr("3")], manual, date)[0]?.providerId, "24");
  assert.deepEqual(inferMediaFundingAssignments([sr("1"), sr("2"), sr("3")], [...manual, assignment("4", { accountName: sr("4").accountName, providerId: "silver" })], date), []);
});
test("an explicit removal remains unassigned when the next sync runs", () => {
  const targetKey = assignment("3").targetKey;
  assert.deepEqual(inferMediaFundingAssignments([row("3")], examples, date, [{ targetKey, effectiveFrom: date }]), []);
});
