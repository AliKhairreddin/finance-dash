import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { bumpBankLedgerRevision } from "./dashboard";
import { isCurrentBankTransactionId, isLegacySurrogateBankTransactionId } from "../shared/providerIdentity";
import { historicalWiseTransferKey } from "../shared/historicalPaymentMatch";
import { meritHistoryKey, validateMeritHistory } from "../shared/meritHistory";
import { transactionBusinessCategory } from "../shared/categories";

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

/** Import only source-confirmed settled invoices, with one exact, unclaimed bank receipt. */
export const importSettled = mutation({
  args: { serviceToken: v.string(), expectedUpdatedAt: v.string(), matches: v.array(v.object({
    fromDate: v.string(), toDate: v.string(), sourceId: v.string(), transactionId: v.string()
  })) },
  returns: v.object({ imported: v.number(), updatedAt: v.string() }),
  handler: async (ctx, args) => {
    if (!process.env.CONVEX_SERVICE_TOKEN || args.serviceToken !== process.env.CONVEX_SERVICE_TOKEN) reject("Unauthorized");
    if (!args.matches.length || args.matches.length > 100 || new Set(args.matches.map(m => m.sourceId)).size !== args.matches.length
      || new Set(args.matches.map(m => m.transactionId)).size !== args.matches.length) reject("Choose 1–100 distinct historical invoices and receipts");
    const state = await ctx.db.query("dashboardState").withIndex("by_key", q => q.eq("key", "default")).unique();
    if (!state || state.updatedAt !== args.expectedUpdatedAt) reject("Financial records changed; review the import plan again");
    const bindings = await ctx.db.query("bankConnectionBindings").take(6);
    if (bindings.length > 5) reject("Unexpected bank connections");
    const active = new Map(bindings.map(b => [b.source, b.connectionKey]));
    type Source = { SIHId: string; CustomerId: string; CustomerName: string; InvoiceNo: string; DocumentDate: string; DueDate: string; CurrencyCode: string; TotalSum: number; PaidAmount: number; Paid: boolean };
    const reports = new Map<string, Source[]>();
    const invoices = [...state.invoices], allocations = [...state.paymentAllocations];
    const banks: Doc<"bankTransactions">[] = [];
    const updatedAt = new Date(Math.max(Date.now(), Date.parse(state.updatedAt) + 1)).toISOString();
    const date = (value: unknown) => {
      const d = typeof value === "string" ? value.slice(0, 10) : "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(Date.parse(d)) || new Date(d).toISOString().slice(0, 10) !== d) reject("Merit invoice date is invalid");
      return d;
    };
    for (const match of args.matches) {
      const key = meritHistoryKey(match.fromDate, match.toDate);
      if (!reports.has(key)) {
        const report = await ctx.db.query("meritHistoryReports").withIndex("by_key", q => q.eq("key", key)).unique();
        if (!report) reject("Retrieve and validate this Merit period before importing");
        reports.set(key, JSON.parse(validateMeritHistory(JSON.parse(report.recordsJson), match.fromDate, match.toDate)) as Source[]);
      }
      const source = reports.get(key)!.find(r => r.SIHId === match.sourceId);
      if (!source || source.Paid !== true || !Number.isFinite(source.TotalSum) || source.TotalSum <= 0.01
        || !Number.isFinite(source.PaidAmount) || cents(source.PaidAmount) !== cents(source.TotalSum)
        || !source.InvoiceNo?.trim() || !/^[A-Z]{3}$/.test(source.CurrencyCode)) reject("Merit does not confirm a fully paid invoice");
      const providers = state.providers.filter(p => p.type === "client" && p.meritCustomerId === source.CustomerId);
      if (providers.length !== 1) reject("Merit client identity is ambiguous");
      const provider = providers[0];
      if (invoices.some(i => i.externalId === source.SIHId || i.id === `merit-${source.SIHId}` || (i.providerId === provider.id && i.invoiceNumber === source.InvoiceNo))) reject("Invoice already exists; reconcile its existing payment instead");
      const issueDate = date(source.DocumentDate), dueDate = date(source.DueDate);
      const bank = await ctx.db.query("bankTransactions").withIndex("by_transaction_id", q => q.eq("id", match.transactionId)).unique();
      if (!bank || bank.identityVersion !== 2 || !active.has(bank.source) || active.get(bank.source) !== bank.connectionKey
        || !isCurrentBankTransactionId(bank.source, bank.id) || isLegacySurrogateBankTransactionId(bank.source, bank.id)
        || bank.direction !== "in" || !["posted", "settled"].includes(bank.status) || bank.matchedInvoiceId
        || bank.matchedProviderId !== provider.id || bank.currency !== source.CurrencyCode || cents(bank.amount) !== cents(source.TotalSum)
        || (bank.source === "wise" && bank.wiseEntity !== "dn")
        || !["Media buying direct", "Affiliate team revenue", "Partner network revenue"].includes(transactionBusinessCategory(bank.category))) reject("Receipt does not exactly match this external client invoice");
      const delay = (Date.parse(bank.date) - Date.parse(issueDate)) / 86_400_000;
      if (!Number.isInteger(delay) || delay < 0 || delay > 120) reject("Historical receipt date requires review");
      const transferKey = historicalWiseTransferKey(bank.id);
      const sameReceipt = (id: string | undefined) => Boolean(id && (id === bank.id || (transferKey && historicalWiseTransferKey(id) === transferKey)));
      if (allocations.some(a => sameReceipt(a.transactionId)) || invoices.some(i => sameReceipt(i.transactionId))) reject("Receipt is already allocated");
      const id = `merit-${source.SIHId}`;
      invoices.push({ id, externalId: source.SIHId, providerId: provider.id, entity: "dn", documentType: "sales_invoice", origin: "merit", source: "merit",
        customerName: source.CustomerName, invoiceNumber: source.InvoiceNo, issueDate, dueDate, amount: source.TotalSum, currency: source.CurrencyCode,
        status: "paid", meritStatus: "paid", meritDeliveryStatus: "saved", transactionId: bank.id, paidAt: bank.date, revenueRunIds: [],
        description: `Merit invoice ${source.InvoiceNo}`, createdAt: `${issueDate}T00:00:00.000Z`, updatedAt, historicalImportedAt: updatedAt });
      allocations.push({ id: `historical-payment-${source.SIHId}`, invoiceId: id, transactionId: bank.id, amount: bank.amount, currency: bank.currency,
        source: bank.source, accountName: bank.accountName, reference: bank.reference, mode: "manual", confidence: 1,
        matchReason: `Historical Merit invoice ${source.InvoiceNo}; exact client, currency and bank amount; source period ${match.fromDate}–${match.toDate}`,
        paidAt: bank.date, createdAt: updatedAt });
      banks.push(bank);
    }
    for (let index = 0; index < banks.length; index++) await ctx.db.patch(banks[index]._id, {
      matchedInvoiceId: `merit-${args.matches[index].sourceId}`, invoiceMatchConfidence: 1, invoiceMatchSource: "manual",
      invoiceMatchReason: "Historical Merit invoice matched to exact client, currency and bank receipt"
    });
    await ctx.db.patch(state._id, { invoices, paymentAllocations: allocations, updatedAt });
    await bumpBankLedgerRevision(ctx, banks.map(b => b.date));
    return { imported: banks.length, updatedAt };
  }
});
