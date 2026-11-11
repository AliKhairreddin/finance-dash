import { ConvexError, v } from "convex/values";
import { calculatePaymentHistory, paymentHistoryDays } from "../shared/paymentForecasts";
import { financeOperatingDate, shiftFinanceOperatingDate } from "../shared/operatingDate";
import { query } from "./_generated/server";

const timing = {
  sampleSize: v.number(),
  medianDays: v.optional(v.number()),
  earliestDays: v.optional(v.number()),
  latestDays: v.optional(v.number())
};
const bankPattern = v.object({
  intervalDays: v.number(), anchorDate: v.string(), expectedDate: v.string(), earliestDate: v.string(), latestDate: v.string(),
  sampleSize: v.number(), matchingIntervals: v.number(), projectedCycles: v.number(),
  confidence: v.union(v.literal("low"), v.literal("medium")), stale: v.boolean(), disrupted: v.boolean()
});
export const get = query({
  args: { serviceToken: v.string() },
  returns: v.object({
    fromDate: v.string(), toDate: v.string(), complete: v.boolean(), unverifiedReceipts: v.number(),
    clients: v.array(v.object({
      id: v.string(), name: v.string(), currency: v.string(), received: v.number(), receiptCount: v.number(),
      lastReceipt: v.optional(v.string()), receiptIntervalDays: v.optional(v.number()), bankPattern: v.optional(bankPattern), ...timing
    })),
    predictions: v.array(v.object({
      invoiceId: v.string(), predictedDate: v.optional(v.string()), ...timing,
      basis: v.optional(v.union(v.literal("invoice_history"), v.literal("bank_pattern"))), bankPattern: v.optional(bankPattern),
      state: v.union(v.literal("estimated"), v.literal("learning"), v.literal("excluded"), v.literal("review"), v.literal("incomplete"))
    }))
  }),
  handler: async (ctx, args) => {
    if (!process.env.CONVEX_SERVICE_TOKEN || args.serviceToken !== process.env.CONVEX_SERVICE_TOKEN) {
      throw new ConvexError({ code: "UNAUTHORIZED" });
    }
    const toDate = financeOperatingDate();
    const fromDate = shiftFinanceOperatingDate(toDate, 1 - paymentHistoryDays);
    const [state, bindings, receipts] = await Promise.all([
      ctx.db.query("dashboardState").withIndex("by_key", q => q.eq("key", "default")).unique(),
      ctx.db.query("bankConnectionBindings").take(6),
      ctx.db.query("bankTransactions")
        .withIndex("by_direction_date_id", q => q.eq("direction", "in").gte("date", fromDate).lt("date", shiftFinanceOperatingDate(toDate, 1)))
        .paginate({ cursor: null, numItems: 3000, maximumRowsRead: 3000, maximumBytesRead: 6 * 1024 * 1024 })
    ]);
    if (!state) throw new ConvexError({ code: "DASHBOARD_STATE_MISSING" });
    if (bindings.length > 5) throw new ConvexError({ code: "BANK_CONNECTION_BINDING_LIMIT_EXCEEDED" });
    // A bounded query never presents partial history as complete totals or learned dates.
    // Sources are durable bank records; reloads do not contact banking APIs.
    const active = new Map(bindings.map(binding => [binding.source, binding.connectionKey]));
    return calculatePaymentHistory({
      providers: state.providers, invoices: state.invoices, allocations: state.paymentAllocations,
      transactions: receipts.page.filter(row => row.identityVersion === 2 && active.has(row.source) && active.get(row.source) === row.connectionKey),
      asOfDate: toDate, complete: receipts.isDone
    });
  }
});
