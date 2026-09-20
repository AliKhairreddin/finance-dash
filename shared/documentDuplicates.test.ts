import assert from "node:assert/strict";
import test from "node:test";
import { documentRelationship, groupFinancialDocuments, normalizedDocumentFileName } from "./documentDuplicates";
import { documentLibraryView, filterLibraryDocuments, selectedDocumentFiles } from "./documentLibrary";
import type { DocumentExtraction, FinancialDocument } from "./financialDocuments";
const extraction: DocumentExtraction = { kind: "expense", entity: "dn", counterparty: "Convex, Inc.", documentNumber: "WGQLAA-00005", amount: 25, currency: "USD", issueDate: "2026-09-19", dueDate: null, description: "Hosting", confidence: .99, reviewReasons: [] };
const file = (id: string, changes: Partial<FinancialDocument> = {}, fields: Partial<DocumentExtraction> = {}): FinancialDocument => ({ _id: id, fileName: "Invoice-WGQLAA-00005.pdf", kind: "expense", entity: "dn", month: "2026-09", status: "unmatched", source: "email", contentType: "application/pdf", size: 100, createdAt: "2026-09-19T00:00:00Z", ...changes, extraction: { ...extraction, ...fields } });

test("renamed copies and invoice/receipt pairs group by corroborated identity", () => {
  const invoice = file("invoice");
  const copy = file("copy", { fileName: "forwarded attachment.pdf", source: "telegram" }, { counterparty: "Convex" });
  const receipt = file("receipt", { fileName: "Receipt-WGQLAA-00005.pdf" }, { issueDate: "2026-09-20" });
  assert.equal(documentRelationship(invoice, copy)?.kind, "duplicate");
  assert.equal(documentRelationship(invoice, receipt)?.kind, "supporting");
  const groups = groupFinancialDocuments([copy, receipt, invoice]);
  assert.equal(groups.length, 1); assert.equal(groups[0]._id, "invoice"); assert.equal(groups[0].files.length, 3);
  assert.deepEqual(groupFinancialDocuments([invoice, receipt, copy]), groups, "canonical row is deterministic");
});

test("matching filenames never merge different amounts, currencies, suppliers, companies or months", () => {
  const invoice = file("invoice");
  for (const fields of [{ amount: 26 }, { currency: "EUR" }, { counterparty: "Other" }, { entity: "lmd" as const }, { issueDate: "2026-08-19" }]) {
    assert.equal(documentRelationship(invoice, file("other", {}, fields)), null);
    assert.equal(groupFinancialDocuments([invoice, file("other", {}, fields)]).length, 2);
  }
  assert.equal(documentRelationship(invoice, file("other", {}, { documentNumber: "WGQLAA-00006" }))?.kind, "possible");
});

test("generic invoice.pdf and equal amounts do not establish duplicate identity", () => {
  const invoice = file("first", { fileName: "invoice.pdf" }, { documentNumber: "MONTH-1" });
  assert.equal(documentRelationship(invoice, file("second", { fileName: "invoice.pdf" }, { documentNumber: "MONTH-2" })), null);
  assert.equal(documentRelationship(file("blank", { fileName: "invoice.pdf" }, { documentNumber: "" }), file("other-blank", { fileName: "invoice.pdf" }, { documentNumber: "" })), null);
  assert.equal(groupFinancialDocuments([invoice, file("september", { fileName: "invoice.pdf" }, { issueDate: "2026-08-19" })]).length, 2);
});

test("specific filenames normalize copied suffixes but need corroborating facts", () => {
  assert.equal(normalizedDocumentFileName("Invoice-12345 (1).PDF"), normalizedDocumentFileName("invoice_12345 copy.pdf"));
  const invoice = file("first", { fileName: "Invoice-12345.pdf" }, { documentNumber: "" });
  assert.equal(documentRelationship(invoice, file("copy", { fileName: "invoice_12345 (1).pdf" }, { documentNumber: "" }))?.kind, "duplicate");
  assert.equal(documentRelationship(invoice, file("uncertain", { fileName: "invoice_12345 (1).pdf" }, { documentNumber: "", confidence: .7 }))?.kind, "possible");
});

test("distinct receipt numbers and low-confidence extraction require review", () => {
  assert.equal(documentRelationship(file("invoice"), file("receipt", { fileName: "Receipt-12345.pdf" }, { documentNumber: "12345" }))?.kind, "possible");
  assert.equal(documentRelationship(file("invoice", { fileName: "invoice.pdf" }), file("receipt", { fileName: "receipt.pdf" }, { confidence: .7 }))?.kind, "possible");
  assert.equal(documentRelationship(file("invoice", {}, { confidence: .7 }), file("receipt", { fileName: "Receipt-WGQLAA-00005.pdf" }, { confidence: .7 }))?.kind, "supporting", "specific filenames corroborate the extracted identifier");
});

test("different accounting links, processing files and Trash never silently collapse", () => {
  for (const field of ["expenseId", "invoiceId", "transactionId"]) {
    assert.equal(documentRelationship(file("first", { [field]: "one" }), file("second", { [field]: "two" }))?.kind, "possible");
    assert.equal(groupFinancialDocuments([file("first", { [field]: "one" }), file("second", { [field]: "two" })]).length, 2);
  }
  for (const status of ["queued", "processing", "failed"] as const) assert.equal(documentRelationship(file("one"), file("two", { status })), null);
  assert.equal(documentRelationship(file("one"), file("two", { deletedAt: "2026-09-20T00:00:00Z" })), null);
});

test("unassigned files cannot bridge two companies or non-transitive date matches", () => {
  const files = [file("dn"), file("lmd", { entity: "lmd" }, { entity: "lmd" }), file("unassigned", { entity: undefined }, { entity: null })];
  assert.equal(groupFinancialDocuments(files).length, 3);
  const dates = [file("a", {}, { issueDate: "2026-09-01" }), file("b", {}, { issueDate: "2026-09-07" }), file("c", {}, { issueDate: "2026-09-13" })];
  assert.equal(groupFinancialDocuments(dates).length, 2);
});

test("group selection and searches include all originals; All files and Trash allow individual selection", () => {
  const invoice = file("invoice"), receipt = file("receipt", { fileName: "Receipt-WGQLAA-00005.pdf" });
  const deleted = file("deleted", { deletedAt: "2026-09-20T00:00:00Z" });
  const documents = [invoice, receipt, deleted];
  const view = documentLibraryView(documents, "expense", "all");
  assert.deepEqual(view.months, { "2026-09": 1 });
  assert.equal(filterLibraryDocuments(view.documents, "all", "all", "Receipt-WGQLAA").length, 1);
  assert.deepEqual(selectedDocumentFiles(view.documents, new Set(["invoice"])).map(d => d._id), ["invoice", "receipt"]);
  assert.deepEqual(selectedDocumentFiles(view.documents, new Set(["stale-id"])), []);
  const all = documentLibraryView(documents, "expense", "all", "all").documents;
  assert.equal(all.length, 2); assert.equal(all[0].possibleRelatedIds.length, 1); assert.equal(all[1].possibleRelatedIds.length, 1);
  assert.equal(selectedDocumentFiles(all, new Set(["receipt"])).length, 1);
  assert.deepEqual(documentLibraryView(documents, "expense", "all", "trash").documents.map(d => d._id), ["deleted"]);
});
