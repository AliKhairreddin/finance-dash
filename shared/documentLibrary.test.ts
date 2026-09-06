import assert from "node:assert/strict";
import test from "node:test";
import { documentLibraryView, filterLibraryDocuments } from "./documentLibrary";
import type { FinancialDocument } from "./financialDocuments";

const document = (id: string, kind: FinancialDocument["kind"], entity: FinancialDocument["entity"], month = "2026-08"): FinancialDocument => ({
  _id: id, kind, entity, month, fileName: `${id}.pdf`, contentType: "application/pdf", size: 10, source: "upload", status: "unmatched", createdAt: `${month}-01T00:00:00Z`
});
const documents = [document("expense-dn", "expense", "dn"), document("expense-lmd", "expense", "lmd"), document("expense-unassigned", "expense", undefined), document("september", "expense", "dn", "2026-09"), ...Array.from({ length: 40 }, (_, i) => document(`invoice-${i}`, "invoice", "dn")), document("pending", "unknown", "dn")];

test("monthly counts match expense and invoice views and company ownership", () => {
  const expenses = documentLibraryView(documents, "expense", "all");
  assert.deepEqual(expenses.months, { "2026-08": 3, "2026-09": 1 });
  assert.equal(expenses.unclassified, 1);
  assert.deepEqual(documentLibraryView(documents, "invoice", "all").months, { "2026-08": 40 });
  assert.deepEqual(documentLibraryView(documents, "expense", "dn").months, { "2026-08": 1, "2026-09": 1 });
  assert.deepEqual(documentLibraryView(documents, "expense", "unassigned").documents.map(row => row._id), ["expense-unassigned"]);
  assert.equal(documentLibraryView(documents, "invoice", "lmd").documents.length, 0);
  assert.deepEqual(documentLibraryView(documents, "unknown", "dn").documents.map(row => row._id), ["pending"]);
});

test("selectable rows respect month, search and status without changing folder counts", () => {
  const view = documentLibraryView(documents, "expense", "all");
  assert.deepEqual(filterLibraryDocuments(view.documents, "2026-08", "unmatched", "expense-dn").map(row => row._id), ["expense-dn"]);
  assert.equal(filterLibraryDocuments(view.documents, "2026-08", "matched", "").length, 0);
  assert.equal(view.months["2026-08"], 3);
});
