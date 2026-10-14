import assert from "node:assert/strict";
import test from "node:test";
import { parseManualBankCommand, validateManualBankFields } from "./manualBankTransactions";
import { wiseDescriptionReference } from "./bankReferences";

const sentAt = Date.parse("2026-10-14T02:30:00Z") / 1000;
test("manual payments default to USDC out and use the message's Eastern date", () => {
  assert.deepEqual(parseManualBankCommand("Acme Company 1,250.12345678", sentAt), { companyName: "Acme Company", amount: 1250.12345678, currency: "USDC", direction: "out", date: "2026-10-13" });
  assert.equal(parseManualBankCommand("Studio 54 500", sentAt).companyName, "Studio 54");
  assert.equal(parseManualBankCommand("Acme 0.00000001", sentAt).amount, 0.00000001);
});
test("commands reject missing details, malformed money, or a missing message timestamp", () => {
  for (const text of ["", "Acme", "1250", "Acme 0", "Acme -10", "Acme 1,23", "Acme 1e3", "Acme Infinity", "Acme 0.000000001", "Acme 100 USD", "Acme 1000000000001"]) assert.throws(() => parseManualBankCommand(text, sentAt), text);
  assert.throws(() => parseManualBankCommand("Acme 100", NaN));
});
test("dashboard edits validate all financial fields and calendar dates", () => {
  const original = parseManualBankCommand("Acme 100", sentAt);
  assert.deepEqual(validateManualBankFields({ ...original, companyName: " Updated  Company ", amount: 25, currency: "eur", date: "2026-10-01", direction: "in" }), { companyName: "Updated Company", amount: 25, currency: "EUR", date: "2026-10-01", direction: "in" });
  for (const patch of [{ amount: NaN }, { amount: 0 }, { amount: 0.000000001 }, { companyName: "" }, { currency: "$" }, { date: "2026-02-30" }, { date: "2026-13-01" }, { direction: "wrong" }]) assert.throws(() => validateManualBankFields({ ...original, ...patch } as never));
});
test("Wise notes are extracted only from explicit payment-reference markers", () => {
  assert.equal(wiseDescriptionReference("Sent money to Acme with reference October retainer (fee: 1.13 USD)"), "October retainer");
  assert.equal(wiseDescriptionReference("Paid to Acme Reference: INV 123"), "INV 123");
  assert.equal(wiseDescriptionReference("Card transaction from Acme"), undefined);
  assert.equal(wiseDescriptionReference("Wise Charges for: TRANSFER-123"), undefined);
});
