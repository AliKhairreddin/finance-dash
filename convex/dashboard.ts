import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const dataSource = v.union(
  v.literal("wise"),
  v.literal("slash"),
  v.literal("merit"),
  v.literal("manual"),
  v.literal("mock")
);

const providerType = v.union(
  v.literal("customer"),
  v.literal("supplier"),
  v.literal("platform"),
  v.literal("internal")
);

const invoiceStatus = v.union(v.literal("draft"), v.literal("open"), v.literal("paid"), v.literal("created"));

const provider = v.object({
  id: v.string(),
  name: v.string(),
  type: providerType,
  category: v.string(),
  aliases: v.array(v.string()),
  defaultAccount: v.optional(v.string()),
  source: dataSource,
  createdAt: v.string()
});

const invoice = v.object({
  id: v.string(),
  providerId: v.optional(v.string()),
  customerName: v.string(),
  amount: v.number(),
  currency: v.string(),
  status: invoiceStatus,
  approvalStatus: v.optional(v.union(v.literal("pending"), v.literal("approved"), v.literal("denied"))),
  paidLocally: v.optional(v.boolean()),
  paidLocallyAt: v.optional(v.string()),
  meritPaid: v.optional(v.boolean()),
  dueDate: v.string(),
  source: dataSource,
  externalId: v.optional(v.string()),
  description: v.string(),
  transactionId: v.optional(v.string()),
  createdAt: v.string()
});

const team = v.object({
  id: v.string(),
  name: v.string(),
  createdAt: v.string()
});

const transactionTeamAssignment = v.object({
  transactionId: v.string(),
  teamId: v.string(),
  updatedAt: v.string()
});

export const getState = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      providers: v.array(provider),
      invoices: v.array(invoice),
      teams: v.array(team),
      transactionTeamAssignments: v.array(transactionTeamAssignment),
      updatedAt: v.string()
    })
  ),
  handler: async (ctx) => {
    const state = await ctx.db
      .query("dashboardState")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .unique();

    if (!state) return null;

    return {
      providers: state.providers,
      invoices: state.invoices,
      teams: state.teams ?? [],
      transactionTeamAssignments: state.transactionTeamAssignments ?? [],
      updatedAt: state.updatedAt
    };
  }
});

export const saveState = mutation({
  args: {
    providers: v.array(provider),
    invoices: v.array(invoice),
    teams: v.array(team),
    transactionTeamAssignments: v.array(transactionTeamAssignment)
  },
  returns: v.object({
    updatedAt: v.string()
  }),
  handler: async (ctx, args) => {
    const updatedAt = new Date().toISOString();
    const existing = await ctx.db
      .query("dashboardState")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        providers: args.providers,
        invoices: args.invoices,
        teams: args.teams,
        transactionTeamAssignments: args.transactionTeamAssignments,
        updatedAt
      });
    } else {
      await ctx.db.insert("dashboardState", {
        key: "default",
        providers: args.providers,
        invoices: args.invoices,
        teams: args.teams,
        transactionTeamAssignments: args.transactionTeamAssignments,
        updatedAt
      });
    }

    return { updatedAt };
  }
});
