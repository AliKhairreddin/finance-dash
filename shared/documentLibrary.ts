import type { FinancialDocument, FinancialDocumentKind } from "./financialDocuments";

export type DocumentCompany = "all" | "dn" | "lmd" | "unassigned";

export function documentsForCompany(documents: FinancialDocument[], company: DocumentCompany): FinancialDocument[] {
  return documents.filter(document => company === "all" || (document.entity ?? "unassigned") === company);
}

export function documentLibraryView(documents: FinancialDocument[], kind: FinancialDocumentKind, company: DocumentCompany) {
  const companyDocuments = documentsForCompany(documents, company);
  const viewDocuments = companyDocuments.filter(document => document.kind === kind);
  const months: Record<string, number> = {};
  for (const document of viewDocuments) months[document.month] = (months[document.month] ?? 0) + 1;
  return { documents: viewDocuments, months, unclassified: companyDocuments.filter(document => document.kind === "unknown").length };
}

export function filterLibraryDocuments(documents: FinancialDocument[], month: string, status: string, search: string) {
  const query = search.trim().toLowerCase();
  return documents.filter(document => (month === "all" || document.month === month)
    && (status === "all" || document.status === status)
    && `${document.fileName} ${document.extraction?.counterparty ?? ""} ${document.extraction?.documentNumber ?? ""}`.toLowerCase().includes(query));
}
