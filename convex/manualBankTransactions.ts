import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { manualBankFields, manualBankRecord, manualBankSource } from "./manualBankSchema";
import { validateManualBankFields } from "../shared/manualBankTransactions";

function authorize(token: string): void {
  if (!process.env.CONVEX_SERVICE_TOKEN || token !== process.env.CONVEX_SERVICE_TOKEN) throw new ConvexError("Unauthorized");
}
const publicRecord = v.object({ _id: v.id("manualBankTransactions"), ...manualBankRecord });
const sortKey = v.union(v.literal("date"), v.literal("companyName"), v.literal("amount"), v.literal("currency"), v.literal("direction"), v.literal("createdBy"));
const sortIndexes = { date: "by_source_date", companyName: "by_source_company", amount: "by_source_amount", currency: "by_source_currency", direction: "by_source_direction", createdBy: "by_source_creator" } as const;

export const list = query({
  args: { serviceToken: v.string(), source: manualBankSource, sortKey, order: v.union(v.literal("asc"), v.literal("desc")), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(publicRecord),
  handler: async (ctx, args) => {
    authorize(args.serviceToken);
    const result = await ctx.db.query("manualBankTransactions")
      .withIndex(sortIndexes[args.sortKey], q => q.eq("source", args.source)).order(args.order)
      .paginate({ ...args.paginationOpts, numItems: Math.max(1, Math.min(100, args.paginationOpts.numItems)), maximumRowsRead: 150 });
    return { ...result, page: result.page.map(({ _creationTime: _time, intakeKey: _key, companySort: _sort, sentAt: _sent, ...row }) => row) };
  }
});

export const createFromTelegram = mutation({
  args: { serviceToken: v.string(), source: manualBankSource, ...manualBankFields, intakeKey: v.string(), sentAt: v.number(), createdBy: v.string() },
  returns: v.object({ id: v.id("manualBankTransactions"), duplicate: v.boolean() }),
  handler: async (ctx, args) => {
    authorize(args.serviceToken);
    if (!["Ali", "Ali M"].includes(args.createdBy)) throw new ConvexError("Only Ali and Ali M can record Telegram transactions.");
    if (!/^telegram:\d+:\d+$/u.test(args.intakeKey) || !Number.isSafeInteger(args.sentAt) || args.sentAt <= 0) throw new ConvexError("Invalid Telegram message identity.");
    const existing = await ctx.db.query("manualBankTransactions").withIndex("by_intake_key", q => q.eq("intakeKey", args.intakeKey)).unique();
    if (existing) return { id: existing._id, duplicate: true };
    const fields = validateManualBankFields(args);
    const now = new Date().toISOString();
    const id = await ctx.db.insert("manualBankTransactions", { ...fields, source: args.source, intakeKey: args.intakeKey, sentAt: args.sentAt, createdBy: args.createdBy, companySort: fields.companyName.toLocaleLowerCase("en"), revision: 1, createdAt: now, updatedAt: now });
    return { id, duplicate: false };
  }
});

export const update = mutation({
  args: { serviceToken: v.string(), id: v.id("manualBankTransactions"), expectedRevision: v.number(), updatedBy: v.string(), ...manualBankFields },
  returns: v.null(),
  handler: async (ctx, args) => {
    authorize(args.serviceToken);
    const row = await ctx.db.get(args.id);
    if (!row) throw new ConvexError("Transaction not found.");
    if (row.revision !== args.expectedRevision) throw new ConvexError("This transaction was edited by someone else. Refresh and reopen it before saving.");
    if (!args.updatedBy.trim() || args.updatedBy.length > 200) throw new ConvexError("Editor is required.");
    const fields = validateManualBankFields(args), now = new Date().toISOString();
    await ctx.db.insert("manualBankTransactionEdits", { transactionId: row._id, revision: row.revision, before: validateManualBankFields(row), after: fields, updatedBy: args.updatedBy, updatedAt: now });
    await ctx.db.patch(row._id, { ...fields, companySort: fields.companyName.toLocaleLowerCase("en"), revision: row.revision + 1, updatedAt: now });
    return null;
  }
});
