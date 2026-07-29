import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";

const syncedBankSource = v.union(v.literal("revolut"), v.literal("slash"));

const transaction = v.object({
  id: v.string(),
  source: syncedBankSource,
  accountName: v.string(),
  date: v.string(),
  description: v.string(),
  rawName: v.string(),
  counterparty: v.string(),
  cardHolderName: v.optional(v.string()),
  amount: v.number(),
  currency: v.string(),
  direction: v.union(v.literal("in"), v.literal("out")),
  status: v.union(v.literal("posted"), v.literal("pending"), v.literal("settled")),
  category: v.string(),
  matchedProviderId: v.optional(v.string()),
  matchedInvoiceId: v.optional(v.string()),
  teamId: v.optional(v.string()),
  confidence: v.optional(v.number()),
  matchReason: v.optional(v.string())
});

const account = v.object({
  id: v.string(),
  name: v.string(),
  source: syncedBankSource,
  balance: v.number(),
  currency: v.string(),
  updatedAt: v.string(),
  status: v.union(v.literal("live"), v.literal("seeded"), v.literal("manual"))
});

function requireServiceToken(serviceToken: string): void {
  const expected = process.env.CONVEX_SERVICE_TOKEN;
  if (!expected || serviceToken !== expected) throw new ConvexError({ code: "UNAUTHORIZED" });
}

function assertDateRange(fromDate: string, toDate: string): void {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)
    || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)
    || fromDate > toDate
  ) {
    throw new ConvexError({ code: "INVALID_DATE_RANGE" });
  }
}

export const getActivity = query({
  args: {
    serviceToken: v.string(),
    source: syncedBankSource,
    fromDate: v.string(),
    toDate: v.string()
  },
  returns: v.object({
    accounts: v.array(account),
    transactions: v.array(transaction),
    syncState: v.union(
      v.null(),
      v.object({
        source: syncedBankSource,
        coveredRanges: v.array(v.object({ fromDate: v.string(), toDate: v.string() })),
        lastSyncedAt: v.string()
      })
    )
  }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    assertDateRange(args.fromDate, args.toDate);
    const [accounts, transactions, syncState] = await Promise.all([
      ctx.db
        .query("bankAccounts")
        .withIndex("by_source", (q) => q.eq("source", args.source))
        .collect(),
      ctx.db
        .query("bankTransactions")
        .withIndex("by_source_date", (q) =>
          q.eq("source", args.source).gte("date", args.fromDate).lte("date", args.toDate)
        )
        .order("desc")
        .collect(),
      ctx.db
        .query("bankSyncState")
        .withIndex("by_source", (q) => q.eq("source", args.source))
        .unique()
    ]);
    return {
      accounts: accounts.map(({
        _creationTime: _creationTime,
        _id: _id,
        syncedAt: _syncedAt,
        ...item
      }) => item),
      transactions: transactions.map(({
        _creationTime: _creationTime,
        _id: _id,
        syncedAt: _syncedAt,
        ...item
      }) => item),
      syncState: syncState
          ? {
            source: syncState.source,
            coveredRanges: syncState.coveredRanges,
            lastSyncedAt: syncState.lastSyncedAt
          }
        : null
    };
  }
});

export const getSyncState = query({
  args: { serviceToken: v.string(), source: syncedBankSource },
  returns: v.union(
    v.null(),
    v.object({
      source: syncedBankSource,
      coveredRanges: v.array(v.object({ fromDate: v.string(), toDate: v.string() })),
      lastSyncedAt: v.string()
    })
  ),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const state = await ctx.db
      .query("bankSyncState")
      .withIndex("by_source", (q) => q.eq("source", args.source))
      .unique();
    return state
      ? {
          source: state.source,
          coveredRanges: state.coveredRanges,
          lastSyncedAt: state.lastSyncedAt
        }
      : null;
  }
});

export const getTransaction = query({
  args: { serviceToken: v.string(), id: v.string() },
  returns: v.union(v.null(), transaction),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const item = await ctx.db
      .query("bankTransactions")
      .withIndex("by_transaction_id", (q) => q.eq("id", args.id))
      .unique();
    if (!item) return null;
    const {
      _creationTime: _creationTime,
      _id: _id,
      syncedAt: _syncedAt,
      ...result
    } = item;
    return result;
  }
});

export const upsertActivityBatch = mutation({
  args: {
    serviceToken: v.string(),
    source: syncedBankSource,
    accounts: v.array(account),
    transactions: v.array(transaction),
    syncedAt: v.string()
  },
  returns: v.object({ accounts: v.number(), transactions: v.number() }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    if (
      args.accounts.some((item) => item.source !== args.source)
      || args.transactions.some((item) => item.source !== args.source)
    ) {
      throw new ConvexError({ code: "SOURCE_MISMATCH" });
    }

    for (const fresh of args.accounts) {
      const existing = await ctx.db
        .query("bankAccounts")
        .withIndex("by_account_id", (q) => q.eq("id", fresh.id))
        .unique();
      if (existing) await ctx.db.patch(existing._id, { ...fresh, syncedAt: args.syncedAt });
      else await ctx.db.insert("bankAccounts", { ...fresh, syncedAt: args.syncedAt });
    }

    for (const fresh of args.transactions) {
      const existing = await ctx.db
        .query("bankTransactions")
        .withIndex("by_transaction_id", (q) => q.eq("id", fresh.id))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, {
          ...fresh,
          category: existing.category,
          matchedProviderId: existing.matchedProviderId ?? fresh.matchedProviderId,
          matchedInvoiceId: existing.matchedInvoiceId ?? fresh.matchedInvoiceId,
          teamId: existing.teamId ?? fresh.teamId,
          confidence: existing.confidence ?? fresh.confidence,
          matchReason: existing.matchReason ?? fresh.matchReason,
          syncedAt: args.syncedAt
        });
      } else {
        await ctx.db.insert("bankTransactions", { ...fresh, syncedAt: args.syncedAt });
      }
    }
    return { accounts: args.accounts.length, transactions: args.transactions.length };
  }
});

export const saveTransactionUpdates = mutation({
  args: {
    serviceToken: v.string(),
    transactions: v.array(transaction)
  },
  returns: v.object({ updated: v.number() }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    let updated = 0;
    for (const item of args.transactions) {
      const existing = await ctx.db
        .query("bankTransactions")
        .withIndex("by_transaction_id", (q) => q.eq("id", item.id))
        .unique();
      if (!existing) continue;
      await ctx.db.patch(existing._id, item);
      updated += 1;
    }
    return { updated };
  }
});

export const completeSync = mutation({
  args: {
    serviceToken: v.string(),
    source: syncedBankSource,
    fromDate: v.string(),
    toDate: v.string(),
    syncedAt: v.string()
  },
  returns: v.object({
    source: syncedBankSource,
    coveredRanges: v.array(v.object({ fromDate: v.string(), toDate: v.string() })),
    lastSyncedAt: v.string()
  }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    assertDateRange(args.fromDate, args.toDate);
    const existing = await ctx.db
      .query("bankSyncState")
      .withIndex("by_source", (q) => q.eq("source", args.source))
      .unique();
    const ranges = [
      ...(existing?.coveredRanges ?? []),
      { fromDate: args.fromDate, toDate: args.toDate }
    ].sort((left, right) => left.fromDate.localeCompare(right.fromDate));
    const coveredRanges: Array<{ fromDate: string; toDate: string }> = [];
    for (const range of ranges) {
      const previous = coveredRanges.at(-1);
      if (
        previous
        && range.fromDate <= new Date(
          Date.parse(`${previous.toDate}T00:00:00.000Z`) + 86_400_000
        ).toISOString().slice(0, 10)
      ) {
        if (range.toDate > previous.toDate) previous.toDate = range.toDate;
      } else {
        coveredRanges.push({ ...range });
      }
    }
    const next = {
      source: args.source,
      coveredRanges,
      lastSyncedAt: args.syncedAt
    };
    if (existing) await ctx.db.patch(existing._id, next);
    else await ctx.db.insert("bankSyncState", next);
    return next;
  }
});

export const getStats = query({
  args: { serviceToken: v.string() },
  returns: v.object({
    revolutTransactions: v.number(),
    slashTransactions: v.number(),
    accounts: v.number()
  }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const [revolutTransactions, slashTransactions, accounts] = await Promise.all([
      ctx.db
        .query("bankTransactions")
        .withIndex("by_source_date", (q) => q.eq("source", "revolut"))
        .collect(),
      ctx.db
        .query("bankTransactions")
        .withIndex("by_source_date", (q) => q.eq("source", "slash"))
        .collect(),
      ctx.db.query("bankAccounts").collect()
    ]);
    return {
      revolutTransactions: revolutTransactions.length,
      slashTransactions: slashTransactions.length,
      accounts: accounts.length
    };
  }
});
