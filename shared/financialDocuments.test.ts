import assert from "node:assert/strict";
import test from "node:test";
import { documentMatchCandidates, validateExtraction, validateDocumentFile, type DocumentExtraction } from "./financialDocuments";
import { accountBalanceGroups } from "./accountBalanceGroups";
import type { AccountBalance, Transaction } from "./types";
const extraction: DocumentExtraction = { kind: "expense", entity: "dn", counterparty: "Acme Ltd", documentNumber: "ACM-2201", issueDate: "2026-08-14", dueDate: null, amount: 49.95, currency: "USD", description: "Software", confidence: 0.98, reviewReasons: [] };
const transaction = (changes: Partial<Transaction> = {}): Transaction => ({ id: "bank-1", source: "wise", accountName: "Digital Nudge USD", wiseEntity: "dn", date: "2026-08-15", amount: 49.95, currency: "USD", direction: "out", status: "posted", counterparty: "Acme", rawName: "ACME", description: "Subscription", ...changes } as Transaction);

test("document matching requires direction, exact total, currency, company, dates, and identity", () => {
  assert.equal(documentMatchCandidates(extraction, [transaction()]).length, 1);
  for (const change of [{ direction: "in" }, { amount: 50 }, { currency: "EUR" }, { wiseEntity: "lmd" }, { date: "2025-08-15" }, { status: "pending" }, { counterparty: "Other", rawName: "Other" }] as Partial<Transaction>[]) assert.equal(documentMatchCandidates(extraction, [transaction(change)]).length, 0, JSON.stringify(change));
  assert.equal(documentMatchCandidates({ ...extraction, kind: "invoice" }, [transaction({ direction: "in" })]).length, 1);
  assert.equal(documentMatchCandidates(extraction, [transaction(), transaction({ id: "bank-2" })]).length, 2, "Ambiguity is preserved for the caller");
});
test("an account without known company requires both reference and counterparty evidence for automatic matching", () => {
  const unknown = transaction({ wiseEntity: undefined, source: "revolut", accountName: "Business" });
  assert.equal(documentMatchCandidates(extraction, [unknown]).length, 0);
  assert.equal(documentMatchCandidates(extraction, [{ ...unknown, description: "Payment ACM-2201" }]).length, 1);
  assert.equal(documentMatchCandidates(extraction, [unknown], false).length, 1, "Manual candidate review may resolve missing bank metadata");
  assert.equal(documentMatchCandidates(extraction, [transaction({ wiseEntity: "lmd" })], false).length, 0);
});
test("unreadable or ambiguous extraction stays in review; dates cannot silently roll over", () => {
  const invalid = validateExtraction({ ...extraction, issueDate: "2026-02-31", amount: -1, entity: "somewhere", confidence: 0.7 });
  assert.equal(invalid.issueDate, null); assert.equal(invalid.amount, null); assert.equal(invalid.entity, null);
  assert.ok(invalid.reviewReasons.length >= 4);
  assert.deepEqual(validateExtraction(extraction), extraction);
});
test("upload content is checked against its declared format", () => {
  const pdf = new TextEncoder().encode("%PDF-1.7\nfinancial document");
  assert.doesNotThrow(() => validateDocumentFile("application/pdf", pdf));
  assert.throws(() => validateDocumentFile("image/png", pdf), /contents/);
  assert.throws(() => validateDocumentFile("text/html", pdf), /Choose/);
  assert.throws(() => validateDocumentFile("application/pdf", new Uint8Array(11 * 1024 * 1024)), /10 MB/);
});
test("account totals keep company and credit balances distinct and report missing conversions", () => {
  const account = (source: AccountBalance["source"], balance: number, currency: string, extra: Partial<AccountBalance> = {}): AccountBalance => ({ id: `${source}-${currency}`, name: source, source, balance, currency, updatedAt: "2026-09-06", status: "live", ...extra });
  const groups = accountBalanceGroups([account("wise", 100, "USD", { wiseEntity: "lmd" }), account("wise", 100, "EUR", { wiseEntity: "lmd" }), account("wise", 50, "USD", { wiseEntity: "dn" }), account("revolut", 10, "CAD"), account("slash", 100, "USD", { slashAccountSubtype: "cash" }), account("slash", 200, "USD", { slashAccountSubtype: "credit" })], [{ asset: "EUR", rateUsd: 1.2, asOf: "2026-09-06", provider: "coinbase", stale: false }]);
  assert.equal(groups.find(g => g.id === "wise-lmd")?.totalUsd, 220);
  assert.equal(groups.find(g => g.id === "wise-dn")?.totalUsd, 50);
  assert.deepEqual(groups.find(g => g.id === "revolut")?.excludedCurrencies, ["CAD"]);
  assert.equal(groups.find(g => g.id === "slash")?.totalUsd, 100);
  assert.equal(groups.find(g => g.id === "slash-credit")?.totalUsd, 200);
});
