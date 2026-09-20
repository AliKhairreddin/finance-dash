import type { FinancialDocument } from "./financialDocuments";

export type DocumentRelationship = "duplicate" | "supporting" | "possible";
export interface DocumentRelation { kind: DocumentRelationship; reason: string }
export interface DocumentGroup extends FinancialDocument {
  files: FinancialDocument[];
  relationships: Record<string, DocumentRelation>;
  possibleRelatedIds: string[];
}

const normalized = (value: string) => value.normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
export function normalizedDocumentFileName(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\.(pdf|png|jpe?g|webp)$/i, "")
    .replace(/(?:\s*\(\d+\)|[ _-]+copy(?:[ _-]+\d+)?)$/i, "").replace(/[^a-z0-9]/g, "");
}
function supplier(value: string): string {
  return normalized(value.replace(/\b(incorporated|inc|llc|ltd|limited|gmbh|pty|uab)\b/gi, ""));
}
function role(fileName: string): "invoice" | "receipt" | undefined {
  const words = fileName.toLowerCase().split(/[^a-z]+/);
  if (words.includes("receipt") && !words.includes("invoice")) return "receipt";
  if (words.includes("invoice") && !words.includes("receipt")) return "invoice";
}

/** Strong identity is required to group; matching amounts alone never hide a file. */
export function documentRelationship(left: FinancialDocument, right: FinancialDocument): DocumentRelation | null {
  const a = left.extraction, b = right.extraction;
  if (left._id === right._id || left.deletedAt || right.deletedAt || !a || !b) return null;
  if ([left, right].some(d => ["queued", "processing", "failed"].includes(d.status))) return null;
  if (a.kind === "unknown" || a.kind !== b.kind || a.entity && b.entity && a.entity !== b.entity) return null;
  if (!a.amount || !b.amount || Math.round(a.amount * 100) !== Math.round(b.amount * 100) || !a.currency || a.currency !== b.currency) return null;
  if (!supplier(a.counterparty) || supplier(a.counterparty) !== supplier(b.counterparty)) return null;
  const days = Math.abs(Date.parse(a.issueDate ?? "") - Date.parse(b.issueDate ?? "")) / 86400000;
  if (!Number.isFinite(days) || days > 7) return null;
  const numberA = normalized(a.documentNumber), numberB = normalized(b.documentNumber);
  const sameNumber = numberA.length >= 3 && /\d/.test(numberA) && numberA === numberB;
  const fileA = normalizedDocumentFileName(left.fileName), fileB = normalizedDocumentFileName(right.fileName);
  const sameSpecificName = fileA === fileB && /\d{3}/.test(fileA);
  const filenamesConfirmNumber = sameNumber && fileA.includes(numberA) && fileB.includes(numberA);
  const confident = a.confidence >= 0.9 && b.confidence >= 0.9;
  const complementary = role(left.fileName) && role(right.fileName) && role(left.fileName) !== role(right.fileName);
  const conflictingLinks = left.expenseId && right.expenseId && left.expenseId !== right.expenseId
    || left.invoiceId && right.invoiceId && left.invoiceId !== right.invoiceId
    || left.transactionId && right.transactionId && left.transactionId !== right.transactionId;
  if (conflictingLinks && (sameNumber || sameSpecificName || complementary && days <= 1)) return {
    kind: "possible", reason: "These files have different accounting or bank links. Review them separately before removing a copy."
  };
  if (sameNumber && (confident || filenamesConfirmNumber)) return {
    kind: complementary ? "supporting" : "duplicate",
    reason: "Same supplier, document number, total and currency, with document dates within seven days."
  };
  if (sameSpecificName && days === 0 && confident && (!numberA || !numberB || numberA === numberB)) return {
    kind: "duplicate", reason: "Same specific filename, supplier, document date, total and currency, with no conflicting document numbers."
  };
  if (sameNumber || sameSpecificName && days === 0 || complementary && days <= 1) return {
    kind: "possible", reason: "Similar document details need review. Different document numbers or uncertain extraction prevent automatic grouping."
  };
  return null;
}

function priority(a: FinancialDocument, b: FinancialDocument): number {
  const score = (d: FinancialDocument) => (d.transactionId ? 16 : 0) + (d.expenseId || d.invoiceId ? 8 : 0)
    + (d.entity ? 4 : 0) + (role(d.fileName) === "invoice" ? 2 : 0) + (d.status === "unmatched" ? 1 : 0);
  return score(b) - score(a) || a.createdAt.localeCompare(b.createdAt) || a._id.localeCompare(b._id);
}

export function groupFinancialDocuments(documents: FinancialDocument[], groupFiles = true): DocumentGroup[] {
  const groups: DocumentGroup[] = [];
  const buckets = new Map<string, DocumentGroup[]>();
  for (const document of [...documents].sort(priority)) {
    const e = document.extraction;
    const key = JSON.stringify([document.kind, supplier(e?.counterparty ?? ""), e?.amount, e?.currency]);
    const peers = buckets.get(key) ?? [];
    const related = peers.map(group => ({ group, relation: documentRelationship(group, document) })).filter(item => item.relation);
    // Avoid joining ambiguous company/identity groups through an unassigned file.
    const strong = related.filter(item => item.relation!.kind !== "possible"
      && item.group.files.every(file => {
        const relation = documentRelationship(file, document);
        return relation && relation.kind !== "possible";
      }));
    if (groupFiles && strong.length === 1) {
      strong[0].group.files.push(document);
      strong[0].group.relationships[document._id] = strong[0].relation!;
    } else {
      const group: DocumentGroup = { ...document, files: [document], relationships: {}, possibleRelatedIds: [] };
      groups.push(group); peers.push(group); buckets.set(key, peers);
      for (const other of related) {
        group.possibleRelatedIds.push(other.group._id);
        other.group.possibleRelatedIds.push(group._id);
        if (!groupFiles) {
          group.relationships[other.group._id] = other.relation!;
          other.group.relationships[group._id] = other.relation!;
        }
      }
    }
  }
  return groups;
}
