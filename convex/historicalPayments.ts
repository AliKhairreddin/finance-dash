import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { bumpBankLedgerRevision } from "./dashboard";
import { isCurrentBankTransactionId, isLegacySurrogateBankTransactionId } from "../shared/providerIdentity";
import { historicalWiseTransferKey } from "../shared/historicalPaymentMatch";

const cents = (value: number) => Math.round(value * 100);
function reject(message: string): never { throw new ConvexError(message); }

/** Attach evidence to existing settled payments without recording another payment. */
export const reconcile = mutation({
  args: {
    serviceToken: v.string(), expectedUpdatedAt: v.string(),
    matches: v.array(v.object({ invoiceId: v.string(), allocationId: v.string(), transactionId: v.string() }))
  },
  returns: v.object({ matched: v.number(), updatedAt: v.string() }),
  handler: async (ctx, args) => {
    if (!process.env.CONVEX_SERVICE_TOKEN || args.serviceToken !== process.env.CONVEX_SERVICE_TOKEN) reject("Unauthorized");
    if (!args.matches.length || args.matches.length > 100
      || new Set(args.matches.map(m => m.invoiceId)).size !== args.matches.length
      || new Set(args.matches.map(m => m.transactionId)).size !== args.matches.length) reject("Choose 1–100 distinct invoices and receipts");
    const state = await ctx.db.query("dashboardState").withIndex("by_key", q => q.eq("key", "default")).unique();
    if (!state || state.updatedAt !== args.expectedUpdatedAt) reject("Financial records changed; review the matching plan again");
    const bindings = await ctx.db.query("bankConnectionBindings").take(6);
    if (bindings.length > 5) reject("Unexpected bank connections");
    const active = new Map(bindings.map(b => [b.source, b.connectionKey]));
    const prepared: { invoice: Doc<"dashboardState">["invoices"][number]; allocation: Doc<"dashboardState">["paymentAllocations"][number]; bank: Doc<"bankTransactions">; old?: Doc<"bankTransactions"> | null }[] = [];
    for (const match of args.matches) {
      const invoice = state.invoices.find(i => i.id === match.invoiceId);
      const allocations = state.paymentAllocations.filter(a => a.invoiceId === match.invoiceId);
      const allocation = allocations[0];
      if (!invoice || invoice.status !== "paid" || invoice.meritReplacementId || allocations.length !== 1
        || allocation.id !== match.allocationId || allocation.currency !== invoice.currency
        || cents(allocation.amount + (allocation.settlementAdjustment ?? 0)) !== cents(invoice.amount)) reject("Only fully settled, unambiguous invoices can be reconciled");
      const bank = await ctx.db.query("bankTransactions").withIndex("by_transaction_id", q => q.eq("id", match.transactionId)).unique();
      if (!bank || bank.identityVersion !== 2 || !active.has(bank.source) || active.get(bank.source) !== bank.connectionKey
        || !isCurrentBankTransactionId(bank.source, bank.id) || isLegacySurrogateBankTransactionId(bank.source, bank.id)
        || bank.direction !== "in" || !["posted", "settled"].includes(bank.status) || bank.amount <= 0.01
        || bank.matchedProviderId !== invoice.providerId || !invoice.providerId || bank.currency !== invoice.currency
        || (invoice.entity && bank.wiseEntity && invoice.entity !== bank.wiseEntity)
        || cents(bank.amount) !== cents(allocation.amount) || (bank.matchedInvoiceId && bank.matchedInvoiceId !== invoice.id)) reject("Receipt identity, client, currency or amount does not match");
      const transferKey = historicalWiseTransferKey(bank.id);
      const sameReceipt = (id: string | undefined) => Boolean(id && (id === bank.id || (transferKey && historicalWiseTransferKey(id) === transferKey)));
      if (state.paymentAllocations.some(a => a.id !== allocation.id && sameReceipt(a.transactionId))
        || state.invoices.some(i => i.id !== invoice.id && sameReceipt(i.transactionId))
        || prepared.some(p => sameReceipt(p.bank.id))) reject("Receipt is already linked to another invoice or payment");
      let old;
      if (allocation.transactionId) {
        old = await ctx.db.query("bankTransactions").withIndex("by_transaction_id", q => q.eq("id", allocation.transactionId!)).unique();
        if (!old || old.source !== "wise" || bank.source !== "wise" || !isLegacySurrogateBankTransactionId(old.source, old.id)
          || !transferKey || historicalWiseTransferKey(old.id) !== transferKey || old.currency !== bank.currency
          || cents(old.amount) !== cents(bank.amount) || old.date !== bank.date || old.accountName !== bank.accountName
          || !old.wiseEntity || old.wiseEntity !== bank.wiseEntity || old.matchedProviderId !== invoice.providerId
          || (old.matchedInvoiceId && old.matchedInvoiceId !== invoice.id)) reject("Old receipt cannot be proven to be the same bank transfer");
      } else {
        const delay = (Date.parse(bank.date) - Date.parse(invoice.issueDate)) / 86_400_000;
        if (!Number.isInteger(delay) || delay < 0 || delay > 120) reject("Receipt date needs manual review");
      }
      if (invoice.transactionId && invoice.transactionId !== bank.id && invoice.transactionId !== old?.id) reject("Invoice has a different bank link");
      prepared.push({ invoice, allocation, bank, old });
    }
    const updatedAt = new Date(Math.max(Date.now(), Date.parse(state.updatedAt) + 1)).toISOString();
    const invoices = [...state.invoices], allocations = [...state.paymentAllocations];
    for (const { invoice, allocation, bank, old } of prepared) {
      const reason = old ? "Historical reconciliation: identical Wise transfer ID, account, date, currency and amount" : "Historical reconciliation: unique client, currency and exact amount; verified bank receipt date";
      invoices[invoices.findIndex(i => i.id === invoice.id)] = { ...invoice, transactionId: bank.id, paidAt: bank.date, updatedAt };
      allocations[allocations.findIndex(a => a.id === allocation.id)] = { ...allocation, transactionId: bank.id, paidAt: bank.date, source: bank.source,
        accountName: bank.accountName, reference: bank.reference, confidence: 1, matchReason: reason };
      await ctx.db.patch(bank._id, { matchedInvoiceId: invoice.id, invoiceMatchConfidence: 1, invoiceMatchSource: "manual", invoiceMatchReason: reason });
      if (old?.matchedInvoiceId === invoice.id) await ctx.db.patch(old._id, { matchedInvoiceId: undefined, invoiceMatchConfidence: undefined, invoiceMatchSource: undefined, invoiceMatchReason: undefined });
    }
    await ctx.db.patch(state._id, { invoices, paymentAllocations: allocations, updatedAt });
    await bumpBankLedgerRevision(ctx, prepared.map(p => p.bank.date));
    return { matched: prepared.length, updatedAt };
  }
});
