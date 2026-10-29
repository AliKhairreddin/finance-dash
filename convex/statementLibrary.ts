import { v, ConvexError } from "convex/values";
import { query, mutation, type MutationCtx } from "./_generated/server";
import { statementMember, requireScope, canReadScope } from "./statementAccess";
import { invoiceTotals } from "../shared/statementInvoices";
async function releaseAllocations(
  ctx: MutationCtx,
  id: import("./_generated/dataModel").Id<"statementDocuments">,
  actor: string,
) {
  const links = await ctx.db
    .query("statementLinks")
    .withIndex("by_documentId", (q) => q.eq("documentId", id))
    .take(201);
  if (links.length > 200)
    throw new ConvexError("Review the large document allocation set first");
  for (const link of links) {
    await ctx.db.insert("statementAudit", {
      entityType: "transaction",
      entityId: link.transactionId,
      actor,
      action: "cancelled_document_allocation_removed",
      details: JSON.stringify({
        documentId: id,
        amountMinor: link.amountMinor,
        currency: link.currency,
      }),
      createdAt: new Date().toISOString(),
    });
    await ctx.db.delete(link._id);
  }
}
const auth = { serviceToken: v.string(), actor: v.string() };
export const page = query({
  args: {
    ...auth,
    source: v.union(v.literal("uploaded"), v.literal("generated")),
    cursor: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const member = await statementMember(ctx, args, "documents");
    const options = { cursor: args.cursor ?? null, numItems: 100 };
    if (args.source === "generated") {
      const page = await ctx.db
        .query("statementInvoices")
        .order("desc")
        .paginate(options);
      const items = [];
      for (const row of page.page) {
        if (!canReadScope(member, row)) continue;
        const draft = JSON.parse(row.draftJson),
          sources = JSON.parse(row.sourceJson);
        const first = sources[0]
          ? await ctx.db.get(sources[0].transactionId)
          : null;
        items.push({
          id: row._id,
          source: "generated",
          number: row.number,
          companyId: row.companyId,
          financialAccountId: row.financialAccountId,
          counterparty: draft.customer,
          reference: first && "reference" in first ? first.reference : "",
          date: draft.date,
          transactionDate: sources
            .map((s: { date: string }) => s.date)
            .join(", "),
          createdAt: new Date(row.createdAt).toISOString(),
          amount: invoiceTotals(draft).total,
          currency: draft.currency,
          direction: first && "direction" in first ? first.direction : "",
          documentType: row.documentType ?? "historical_unverified",
          status: row.state,
          downloadedAt: row.downloadedAt,
          predecessorId: row.predecessorId,
          supersededBy: row.supersededBy,
          file: Boolean(row.storageId),
        });
      }
      return JSON.stringify({
        items,
        continueCursor: page.continueCursor,
        isDone: page.isDone,
      });
    }
    const page = await ctx.db
      .query("statementDocuments")
      .order("desc")
      .paginate(options);
    const items = [];
    for (const row of page.page) {
      if (!canReadScope(member, row) || row.generatedInvoiceId) continue;
      let extracted: Record<string, unknown> = {};
      try {
        extracted = JSON.parse(row.extracted ?? "{}");
      } catch {
        /* Unstructured historic evidence remains available in review. */
      }
      const txn = row.transactionIds[0]
        ? await ctx.db.get(row.transactionIds[0])
        : null;
      items.push({
        id: row._id,
        source: "uploaded",
        number: String(extracted.number ?? extracted.reference ?? row.fileName),
        companyId: row.companyId,
        financialAccountId: row.financialAccountId,
        counterparty: String(
          extracted.counterparty ?? txn?.counterparty ?? row.sender ?? "",
        ),
        reference: txn?.reference ?? "",
        date: String(extracted.issueDate ?? extracted.date ?? ""),
        transactionDate: txn?.date ?? "",
        createdAt: row.createdAt,
        amount: String(extracted.amount ?? ""),
        currency: String(extracted.currency ?? txn?.currency ?? ""),
        direction: txn?.direction ?? "",
        documentType: row.documentType,
        status: row.cancelledAt ? "cancelled" : row.status,
        downloadedAt: row.downloadedAt,
        file: true,
        subject: row.subject,
        receivedAt: row.receivedAt,
      });
    }
    return JSON.stringify({
      items,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    });
  },
});
export const action = mutation({
  args: {
    ...auth,
    source: v.union(v.literal("uploaded"), v.literal("generated")),
    ids: v.array(v.string()),
    action: v.union(
      v.literal("cancel"),
      v.literal("not_downloaded"),
      v.literal("downloaded"),
    ),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const member = await statementMember(
      ctx,
      args,
      args.action === "downloaded" ? "download" : "documents",
    );
    if (!args.ids.length || args.ids.length > 100)
      throw new ConvexError("Select 1–100 documents");
    const results = [];
    for (const raw of [...new Set(args.ids)]) {
      const id = ctx.db.normalizeId(
        args.source === "generated"
          ? "statementInvoices"
          : "statementDocuments",
        raw,
      );
      if (!id) {
        results.push({
          id: raw,
          outcome: "failed",
          message: "Invalid document",
        });
        continue;
      }
      const row = await ctx.db.get(id);
      if (!row || !canReadScope(member, row)) {
        results.push({
          id: raw,
          outcome: "failed",
          message: "Document unavailable",
        });
        continue;
      }
      if (args.action === "cancel") {
        if (row._id && "draftJson" in row) {
          await ctx.db.patch(row._id, {
            state: "cancelled",
            updatedAt: Date.now(),
          });
          const documents = await ctx.db
            .query("statementDocuments")
            .withIndex("by_generatedInvoiceId", (q) =>
              q.eq("generatedInvoiceId", row._id),
            )
            .take(2);
          for (const document of documents) {
            await releaseAllocations(ctx, document._id, member.actor);
            await ctx.db.patch(document._id, {
              cancelledAt: new Date().toISOString(),
            });
          }
          const links = await ctx.db
            .query("statementInvoiceTransactions")
            .withIndex("by_invoice", (q) => q.eq("invoiceId", row._id))
            .take(201);
          if (links.length > 200)
            throw new ConvexError("History exceeds cancellation limit");
          for (const link of links) {
            const txn = await ctx.db.get(link.transactionId);
            if (txn?.generatedInvoiceId === row._id)
              await ctx.db.patch(txn._id, {
                generatedInvoiceId: undefined,
                generatedInvoiceNumber: undefined,
                generatedInvoiceState: undefined,
                documentState: "cancelled",
                status: "pending",
                completedAt: undefined,
                completedBy: undefined,
                completionReason: undefined,
                doneAt: undefined,
                doneBy: undefined,
              });
          }
        } else if ("transactionIds" in row) {
          await releaseAllocations(ctx, row._id, member.actor);
          await ctx.db.patch(row._id, {
            cancelledAt: new Date().toISOString(),
          });
          for (const txnId of row.transactionIds) {
            const txn = await ctx.db.get(txnId);
            if (txn)
              await ctx.db.patch(txn._id, {
                status: "pending",
                documentState: "cancelled",
                completedAt: undefined,
                completedBy: undefined,
                completionReason: undefined,
                doneAt: undefined,
                doneBy: undefined,
              });
          }
        }
      } else if ("draftJson" in row)
        await ctx.db.patch(row._id, {
          downloadedAt: args.action === "downloaded" ? Date.now() : undefined,
        });
      else
        await ctx.db.patch(row._id, {
          downloadedAt:
            args.action === "downloaded" ? new Date().toISOString() : undefined,
        });
      await ctx.db.insert("statementAudit", {
        entityType: "document",
        entityId: row._id,
        actor: member.actor,
        action: args.action,
        details: "Original file retained",
        createdAt: new Date().toISOString(),
      });
      results.push({ id: raw, outcome: "success" });
    }
    return JSON.stringify(results);
  },
});
