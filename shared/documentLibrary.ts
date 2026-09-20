import type { FinancialDocument, FinancialDocumentKind } from "./financialDocuments";
import { groupFinancialDocuments, type DocumentGroup } from "./documentDuplicates";

export type DocumentCompany = "all" | "dn" | "lmd" | "unassigned";

export function documentsForCompany<T extends FinancialDocument>(documents: T[], company: DocumentCompany): T[] {
  return documents.filter(document => company === "all" || (document.entity ?? "unassigned") === company);
}

export type DocumentFileView = "grouped" | "all" | "trash";
export function documentLibraryView(documents: FinancialDocument[], kind: FinancialDocumentKind, company: DocumentCompany, fileView: DocumentFileView = "grouped") {
  const active = documents.filter(document => fileView === "trash" ? Boolean(document.deletedAt) : !document.deletedAt);
  const companyDocuments = documentsForCompany(groupFinancialDocuments(active, fileView === "grouped"), company);
  const viewDocuments = companyDocuments.filter(document => document.kind === kind);
  const months: Record<string, number> = {};
  for (const document of viewDocuments) months[document.month] = (months[document.month] ?? 0) + 1;
  return { documents: viewDocuments, months, unclassified: companyDocuments.filter(document => document.kind === "unknown").length };
}

export function selectedDocumentFiles(rows: DocumentGroup[], selectedIds: Set<string>): FinancialDocument[] {
  return [...new Map(rows.filter(row => selectedIds.has(row._id)).flatMap(row => row.files).map(file => [file._id, file])).values()];
}

export function filterLibraryDocuments(documents: DocumentGroup[], month: string, status: string, search: string) {
  const query = search.trim().toLowerCase();
  return documents.filter(document => (month === "all" || document.month === month)
    && (status === "all" || document.status === status)
    && document.files.some(file => `${file.fileName} ${file.extraction?.counterparty ?? ""} ${file.extraction?.documentNumber ?? ""}`.toLowerCase().includes(query)));
}
