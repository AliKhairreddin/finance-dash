import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { DocumentExtraction } from "../shared/financialDocuments";
import { compatiblePurchaseDetails, documentLinksConflict, documentRelationship, documentsDeclaredSeparate } from "../shared/documentDuplicates";

type Document = Doc<"financialDocuments">;
export const maximumPurchaseFiles = 40;
const unique = (rows: Document[]) => [...new Map(rows.map(row => [row._id, row])).values()];
const readable = (doc: Document, extraction = doc.extraction) => ({ ...doc, extraction, kind: extraction?.kind ?? doc.kind, deletedAt: undefined, status: "needs_review" as const });

export async function purchaseMembers(ctx: QueryCtx | MutationCtx, doc: Document): Promise<Document[]> {
  if (!doc.purchaseId) return [doc];
  const rows = await ctx.db.query("financialDocuments").withIndex("by_purchase", q => q.eq("purchaseId", doc.purchaseId)).take(maximumPurchaseFiles + 1);
  if (rows.length > maximumPurchaseFiles) throw new ConvexError("This purchase has too many files; review its records before adding another");
  return unique([doc, ...rows.filter(row => row._id !== doc._id)]);
}

export async function findPurchaseRelations(ctx: QueryCtx | MutationCtx, document: Document, extraction: DocumentExtraction) {
  const own = await purchaseMembers(ctx, document);
  const current = readable(document, extraction);
  const issuedAt = Date.parse(extraction.issueDate ?? "");
  if (extraction.kind === "unknown" || !extraction.amount || !extraction.currency || !Number.isFinite(issuedAt)) {
    return { members: own, possible: [] as Document[], excludedExpenseIds: [] as string[], limited: false };
  }
  const rows = await ctx.db.query("financialDocuments").withIndex("by_kind_currency_amount_date", q => q
    .eq("kind", extraction.kind).eq("extraction.currency", extraction.currency!).eq("extraction.amount", extraction.amount!)
    .gte("extraction.issueDate", new Date(issuedAt - 120 * 86400000).toISOString().slice(0, 10))
    .lte("extraction.issueDate", new Date(issuedAt + 120 * 86400000).toISOString().slice(0, 10))).take(101);
  const ownIds = new Set(own.map(row => row._id));
  const strong: Document[] = [], possible: Document[] = [];
  const visited = new Set<string>();
  const excludedExpenseIds = rows.filter(row => own.some(file => documentsDeclaredSeparate(file, row))).flatMap(row => row.expenseId ? [row.expenseId] : []);
  let limited = rows.length === 101;
  for (const row of rows) {
    if (ownIds.has(row._id) || visited.has(row.purchaseId ?? row._id) || ["queued", "processing", "failed"].includes(row.status)) continue;
    const relation = documentRelationship(current, { ...row, deletedAt: undefined });
    if (!relation) continue;
    visited.add(row.purchaseId ?? row._id);
    const peers = await purchaseMembers(ctx, row);
    const compatible = relation.kind !== "possible" && own.every(a => peers.every(b => {
      const link = documentRelationship(a._id === document._id ? current : readable(a), readable(b));
      return link && link.kind !== "possible";
    }));
    (compatible ? strong : possible).push(...peers);
    if (strong.length + possible.length + own.length > 100) { limited = true; break; }
  }
  const merged = unique([...own.map(row => row._id === document._id ? { ...row, extraction, kind: extraction.kind } : row), ...strong]);
  const conflicting = documentLinksConflict(merged) || merged.some(a => merged.some(b => a._id !== b._id && (
    !compatiblePurchaseDetails(a, b) || documentsDeclaredSeparate(a, b)
    || !ownIds.has(a._id) && !ownIds.has(b._id) && (!documentRelationship(readable(a), readable(b)) || documentRelationship(readable(a), readable(b))?.kind === "possible")
  )));
  if (conflicting || merged.length > maximumPurchaseFiles || limited) {
    return { members: own, possible: unique([...possible, ...strong]), excludedExpenseIds, limited: limited || merged.length > maximumPurchaseFiles };
  }
  const memberIds = new Set(merged.map(row => row._id));
  return { members: merged, possible: unique(possible).filter(row => !memberIds.has(row._id)), excludedExpenseIds, limited };
}

export async function savePurchase(ctx: MutationCtx, members: Document[]): Promise<Id<"financialDocuments">> {
  if (!members.length || members.length > maximumPurchaseFiles || documentLinksConflict(members)) throw new ConvexError("Review the existing accounting links before combining these files");
  const roots = members.filter(doc => doc.purchaseId === doc._id);
  const candidates = roots.length ? roots : members;
  const root = [...candidates].sort((a, b) => Number(Boolean(b.expenseId || b.invoiceId)) - Number(Boolean(a.expenseId || a.invoiceId)) || a.createdAt.localeCompare(b.createdAt) || a._id.localeCompare(b._id))[0]._id;
  const separateFrom = [...new Set(members.flatMap(doc => doc.separateFrom ?? []))].filter(id => !members.some(doc => doc._id === id));
  if (separateFrom.length > 200) throw new ConvexError("Too many separate-purchase decisions for this group; review its records");
  for (const doc of members) {
    if (doc.purchaseId !== root || JSON.stringify(doc.separateFrom ?? []) !== JSON.stringify(separateFrom)) {
      await ctx.db.patch(doc._id, { purchaseId: root, separateFrom });
    }
  }
  return root;
}

export async function decidePurchase(ctx: MutationCtx, left: Document, right: Document, decision: "same" | "separate"): Promise<Document[]> {
  if (left._id === right._id || left.deletedAt || right.deletedAt || [left, right].some(doc => !doc.extraction || ["queued", "processing", "failed"].includes(doc.status))) {
    throw new ConvexError("Choose two processed, active documents");
  }
  const a = await purchaseMembers(ctx, left), b = await purchaseMembers(ctx, right);
  if (a.some(doc => b.some(other => other._id === doc._id))) throw new ConvexError("These files already belong to one purchase");
  if (decision === "same") {
    const merged = unique([...a, ...b]);
    if (merged.some(doc => doc.kind !== "expense")) throw new ConvexError("Only supplier purchases can be combined here");
    if (!a.every(doc => b.every(other => compatiblePurchaseDetails(doc, other)))) throw new ConvexError("Supplier, total, currency and company must agree before combining these files");
    if (documentLinksConflict(merged)) throw new ConvexError("These files already have different expenses or bank links. Review the accounting records before combining them");
    await savePurchase(ctx, merged);
    return merged;
  }
  for (const [own, other] of [[a, b], [b, a]]) for (const doc of own) {
    const separateFrom = [...new Set([...(doc.separateFrom ?? []), ...other.map(row => row._id)])];
    if (separateFrom.length > 200) throw new ConvexError("Too many separate-purchase decisions for this group; review its records");
    await ctx.db.patch(doc._id, { separateFrom, purchaseReviewIds: doc.purchaseReviewIds?.filter(id => !other.some(row => row._id === id)) });
  }
  return unique([...a, ...b]);
}
