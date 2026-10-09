import type { FinancialDocument } from "./financialDocuments";

export type DocumentRelationship = "duplicate" | "supporting" | "possible";
export interface DocumentRelation { kind: DocumentRelationship; reason: string }
export interface DocumentGroup extends FinancialDocument {
  files: FinancialDocument[];
  relationships: Record<string, DocumentRelation>;
  possibleRelatedIds: string[];
}

export const normalizedDocumentReference = (value: string) => value.normalize("NFKD").toLowerCase().replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
const normalized = normalizedDocumentReference;
export function normalizedDocumentFileName(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\.(pdf|png|jpe?g|webp)$/i, "")
    .replace(/(?:\s*\(\d+\)|[ _-]+copy(?:[ _-]+\d+)?)$/i, "").replace(/[^a-z0-9]/g, "");
}
export function documentSupplier(value: string): string {
  return normalized(value.replace(/\b(incorporated|inc|llc|ltd|limited|gmbh|pty|uab)\b/gi, ""));
}
export function documentFileRole(document: FinancialDocument): "invoice" | "receipt" | "other" | "unknown" {
  if (document.extraction?.identity) return document.extraction.identity.type;
  const words = document.fileName.toLowerCase().split(/[^a-z]+/);
  if (words.includes("receipt") && !words.includes("invoice")) return "receipt";
  if (words.includes("invoice") && !words.includes("receipt")) return "invoice";
  return "unknown";
}
export function documentLinksConflict(files: FinancialDocument[]): boolean {
  return (["expenseId", "invoiceId", "transactionId"] as const).some(key => new Set(files.flatMap(d => d[key] ? [d[key]] : [])).size > 1);
}
export function documentsDeclaredSeparate(left: FinancialDocument, right: FinancialDocument): boolean {
  return Boolean(left.separateFrom?.includes(right._id) || right.separateFrom?.includes(left._id));
}
export function compatiblePurchaseDetails(left: FinancialDocument, right: FinancialDocument): boolean {
  const a = left.extraction, b = right.extraction;
  return Boolean(a && b && a.kind !== "unknown" && a.kind === b.kind
    && !(a.entity && b.entity && a.entity !== b.entity) && !(left.entity && right.entity && left.entity !== right.entity)
    && a.amount && b.amount && Math.round(a.amount * 100) === Math.round(b.amount * 100) && a.currency && a.currency === b.currency
    && documentSupplier(a.counterparty) && documentSupplier(a.counterparty) === documentSupplier(b.counterparty));
}

/** References identify a purchase; equal totals or arriving in one email never prove it. */
export function documentRelationship(left: FinancialDocument, right: FinancialDocument): DocumentRelation | null {
  const a = left.extraction, b = right.extraction;
  if (left._id === right._id || left.deletedAt || right.deletedAt || !a || !b || documentsDeclaredSeparate(left, right)) return null;
  if ([left, right].some(d => ["queued", "processing", "failed"].includes(d.status))) return null;
  if (!compatiblePurchaseDetails(left, right)) return null;
  const complementary = new Set([documentFileRole(left), documentFileRole(right)]).size === 2
    && [documentFileRole(left), documentFileRole(right)].every(role => role === "invoice" || role === "receipt");
  if (left.purchaseId && left.purchaseId === right.purchaseId && !documentLinksConflict([left, right])) return {
    kind: complementary ? "supporting" : "duplicate", reason: "Saved together as one purchase; all original files are preserved."
  };
  const days = Math.abs(Date.parse(a.issueDate ?? "") - Date.parse(b.issueDate ?? "")) / 86400000;
  if (!Number.isFinite(days) || days > 120) return null;
  const idsA = a.identity, idsB = b.identity;
  const referenceFields = ["invoiceNumber", "receiptNumber", "orderNumber", "paymentReference"] as const;
  const sharedReferences = referenceFields.filter(key => {
    const value = normalized(idsA?.[key] ?? "");
    return value.length >= 3 && /\d/.test(value) && value === normalized(idsB?.[key] ?? "");
  });
  const conflictingInvoice = idsA?.invoiceNumber && idsB?.invoiceNumber && normalized(idsA.invoiceNumber) !== normalized(idsB.invoiceNumber);
  const referenceConfirmed = (complementary || days <= 7) && !conflictingInvoice && sharedReferences.length > 0 && (idsA?.confidence ?? 0) >= .9 && (idsB?.confidence ?? 0) >= .9;
  const numberA = normalized(a.documentNumber), numberB = normalized(b.documentNumber);
  const sameNumber = numberA.length >= 3 && /\d/.test(numberA) && numberA === numberB && days <= 7;
  const fileA = normalizedDocumentFileName(left.fileName), fileB = normalizedDocumentFileName(right.fileName);
  const sameSpecificName = fileA === fileB && /\d{3}/.test(fileA) && days <= 7;
  const filenamesConfirmNumber = sameNumber && fileA.includes(numberA) && fileB.includes(numberA);
  const confident = a.confidence >= 0.9 && b.confidence >= 0.9;
  if (documentLinksConflict([left, right]) && (referenceConfirmed || sameNumber || sameSpecificName || complementary && days <= 3)) return {
    kind: "possible", reason: "These files have different accounting or bank links. Review those records before combining purchases."
  };
  if (referenceConfirmed) return {
    kind: complementary ? "supporting" : "duplicate", reason: `Same supplier, total and currency, with a shared ${sharedReferences[0].replace(/([A-Z])/g, " $1").toLowerCase()}.`
  };
  if (!conflictingInvoice && sameNumber && (confident || filenamesConfirmNumber)) return {
    kind: complementary ? "supporting" : "duplicate", reason: "Same supplier, document number, total and currency, with document dates within seven days."
  };
  if (!conflictingInvoice && sameSpecificName && days === 0 && confident && (!numberA || !numberB || numberA === numberB)) return {
    kind: "duplicate", reason: "Same specific filename, supplier, document date, total and currency, with no conflicting document numbers."
  };
  if (sharedReferences.length || sameNumber || sameSpecificName && days === 0 || complementary && days <= 3) return {
    kind: "possible", reason: "These may describe the same purchase. Confirm the relationship before recording another expense."
  };
  return null;
}

export function documentPriority(a: FinancialDocument, b: FinancialDocument): number {
  // The primary file is independent of the stable purchase ID and arrival order.
  const score = (d: FinancialDocument) => (documentFileRole(d) === "invoice" ? 32 : 0) + (d.transactionId ? 16 : 0) + (d.expenseId || d.invoiceId ? 8 : 0)
    + (d.entity ? 4 : 0) + (d.status === "unmatched" ? 1 : 0);
  return score(b) - score(a) || a.createdAt.localeCompare(b.createdAt) || a._id.localeCompare(b._id);
}

export function groupFinancialDocuments(documents: FinancialDocument[], groupFiles = true): DocumentGroup[] {
  const groups: DocumentGroup[] = [];
  const buckets = new Map<string, DocumentGroup[]>();
  for (const document of [...documents].sort(documentPriority)) {
    const e = document.extraction;
    const key = JSON.stringify([document.kind, documentSupplier(e?.counterparty ?? ""), e?.amount, e?.currency]);
    const peers = buckets.get(key) ?? [];
    const related = peers.map(group => ({ group, relation: documentRelationship(group, document) })).filter(item => item.relation);
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
  for (const group of groups) {
    for (const file of group.files) for (const id of file.purchaseReviewIds ?? []) {
      if (!group.files.some(member => member._id === id) && !group.possibleRelatedIds.includes(id)) group.possibleRelatedIds.push(id);
    }
  }
  return groups;
}
