import assert from "node:assert/strict";
import test from "node:test";
import { centralSheetHistoryConflict, matchCentralSheetAccount } from "./centralSheetImport";
import type { MediaFundingAssignment } from "./mediaFunding";

const account = { platform: "Facebook", accountId: "12345678901234567", accountName: "Agency 01", businessManagerId: "bm" };
test("sheet matching uses unique exact names and preserves full external IDs", () => {
  assert.equal(matchCentralSheetAccount({ name: " agency   01 " }, [account, account]).status, "matched");
  assert.equal(matchCentralSheetAccount({ name: "Agency01" }, [account]).status, "missing");
  assert.equal(matchCentralSheetAccount({ name: "Agency 01" }, [account, { ...account, accountId: "other" }]).status, "ambiguous");
  assert.equal(matchCentralSheetAccount({ name: "old name", accountId: account.accountId }, [account]).status, "matched");
  assert.equal(matchCentralSheetAccount({ name: "Agency 01", platform: "TikTok" }, [account]).status, "missing");
});
test("sheet reconciliation refuses historical provider or billing conflicts", () => {
  const history = [{ providerId: "p", billingType: undefined }] as MediaFundingAssignment[];
  assert.equal(centralSheetHistoryConflict(history, "p", "card"), false);
  assert.equal(centralSheetHistoryConflict(history, "other", "card"), true);
  assert.equal(centralSheetHistoryConflict([{ ...history[0], billingType: "credit_line" }], "p", "card"), true);
  assert.equal(centralSheetHistoryConflict([{ ...history[0], billingType: "card" }], "p", undefined), false);
});
