import { ConvexError, v } from "convex/values";
import { mutation, type MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { bumpBankLedgerRevision, invoice } from "./dashboard";
import { dashboardInvoiceDeletionBatchBlockReason, unlinkDeletedInvoiceDrafts } from "../shared/invoiceDeletion";
import { validateOpenItemDeletion } from "../shared/manualReceivables";

/** Both invoice views remove links and drafts in the same database transaction. */
async function removeSelectedItems(ctx: MutationCtx, state: Doc<"dashboardState">, ids: Set<string>) {
  const selected = state.invoices.filter(item => ids.has(item.id));
  const linked: Doc<"bankTransactions">[] = [];
  for (const draft of selected) {
    const transactions = await ctx.db.query("bankTransactions").withIndex("by_matched_invoice", q => q.eq("matchedInvoiceId", draft.id)).take(201);
    linked.push(...transactions);
    if (transactions.length > 200 || linked.length > 2000) throw new ConvexError("This draft has too many transaction links. Review its links before deleting.");
  }
  const dates = new Set<string>();
  for (const transaction of linked) {
    await ctx.db.patch(transaction._id, { matchedInvoiceId: undefined, matchReason: undefined, confidence: undefined });
    dates.add(transaction.date);
  }
  const updatedAt = new Date(Math.max(Date.now(), Date.parse(state.updatedAt) + 1)).toISOString();
  await ctx.db.patch(state._id, {
    invoices: state.invoices.filter(item => !ids.has(item.id)),
    manualReceivables: state.manualReceivables.filter(item => !ids.has(item.id)),
    ...unlinkDeletedInvoiceDrafts(selected, state.revenueRuns, state.revenueAccruals, updatedAt),
    updatedAt
  });
  if (dates.size) await bumpBankLedgerRevision(ctx, dates);
}

export const remove = mutation({
  args: { serviceToken: v.string(), invoiceIds: v.array(v.string()) },
  returns: v.array(invoice),
  handler: async (ctx, args) => {
    if (!process.env.CONVEX_SERVICE_TOKEN || args.serviceToken !== process.env.CONVEX_SERVICE_TOKEN) throw new ConvexError("Unauthorized");
    const ids = new Set(args.invoiceIds);
    if (!ids.size || ids.size > 200 || ids.size !== args.invoiceIds.length) throw new ConvexError("Select between 1 and 200 distinct invoice drafts");
    const state = await ctx.db.query("dashboardState").withIndex("by_key", q => q.eq("key", "default")).unique();
    if (!state) throw new ConvexError("Dashboard is unavailable");
    const selected = args.invoiceIds.map(id => {
      const found = state.invoices.find(item => item.id === id);
      if (!found) throw new ConvexError("An invoice no longer exists. Refresh before deleting.");
      return found;
    });
    const reason = dashboardInvoiceDeletionBatchBlockReason(selected, state.paymentAllocations);
    if (reason) throw new ConvexError(reason);
    await removeSelectedItems(ctx, state, ids);
    return selected;
  }
});

export const removeOpenItems = mutation({
  args: { serviceToken: v.string(), ids: v.array(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!process.env.CONVEX_SERVICE_TOKEN || args.serviceToken !== process.env.CONVEX_SERVICE_TOKEN) throw new ConvexError("Unauthorized");
    const state = await ctx.db.query("dashboardState").withIndex("by_key", q => q.eq("key", "default")).unique();
    if (!state) throw new ConvexError("Dashboard is unavailable");
    const ids = validateOpenItemDeletion(args.ids, state.invoices, state.manualReceivables, state.paymentAllocations);
    await removeSelectedItems(ctx, state, ids);
    return null;
  }
});
