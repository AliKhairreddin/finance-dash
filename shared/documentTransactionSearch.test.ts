import assert from "node:assert/strict";
import test from "node:test";
import { documentTransactionAccountKey, emptyDocumentTransactionFilters, filterDocumentTransactions, type DocumentMatchCandidate, type DocumentTransactionFilters } from "./documentTransactionSearch";
const row: DocumentMatchCandidate = { id: "tx-1", source: "wise", accountId: "account-1", accountName: "Shared account", date: "2026-10-06", amount: 1250.5, currency: "EUR", counterparty: "Café Charging", description: "Receipt REF-123", rawName: "Cafe", cardHolderName: "Alex", cardLastFour: "1029", matchKind: "exact" };
const search = (changes: Partial<DocumentTransactionFilters>, rows = [row]) => filterDocumentTransactions(rows, { ...emptyDocumentTransactionFilters, ...changes }).map(row => row.id);
test("document search combines accent-insensitive merchant, reference, card and formatted amount terms", () => {
  assert.deepEqual(search({ query: "cafe REF-123 1,250.50 1029 alex" }), ["tx-1"]);
  assert.deepEqual(search({ query: "cafe absent" }), []);
});
test("document filters intersect bank, bank-qualified account, currency and match type", () => {
  const rows = [row, { ...row, id: "tx-2", source: "amex" as const, currency: "USD", matchKind: "foreign_currency" as const }];
  assert.deepEqual(search({ account: documentTransactionAccountKey(row) }, rows), ["tx-1"]);
  assert.deepEqual(search({ bank: "amex", currency: "USD", match: "foreign_currency" }, rows), ["tx-2"]);
  assert.deepEqual(search({ bank: "amex", match: "exact" }, rows), []);
});
test("document date filters include both boundaries and reject inverted ranges", () => {
  assert.deepEqual(search({ from: "2026-10-06", to: "2026-10-06" }), ["tx-1"]);
  assert.deepEqual(search({ from: "2026-10-07", to: "2026-10-06" }), []);
});
