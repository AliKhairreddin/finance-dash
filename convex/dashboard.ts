import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

const dataSource = v.union(
  v.literal("wise"),
  v.literal("revolut"),
  v.literal("slash"),
  v.literal("merit"),
  v.literal("manual"),
  v.literal("mock"),
  v.literal("tune")
);

const providerType = v.union(
  v.literal("partner"),
  v.literal("provider"),
  v.literal("platform"),
  v.literal("internal")
);

const invoiceStatus = v.union(v.literal("draft"), v.literal("open"), v.literal("paid"), v.literal("created"));

const invoiceDocumentType = v.union(v.literal("sales_invoice"), v.literal("supplier_bill"));

const provider = v.object({
  id: v.string(),
  name: v.string(),
  type: providerType,
  category: v.string(),
  aliases: v.array(v.string()),
  defaultAccount: v.optional(v.string()),
  legalName: v.optional(v.string()),
  email: v.optional(v.string()),
  country: v.optional(v.string()),
  address: v.optional(v.string()),
  taxId: v.optional(v.string()),
  defaultCurrency: v.optional(v.string()),
  paymentTermsDays: v.optional(v.number()),
  meritCustomerId: v.optional(v.string()),
  meritSupplierId: v.optional(v.string()),
  source: dataSource,
  createdAt: v.string()
});

const invoice = v.object({
  id: v.string(),
  providerId: v.optional(v.string()),
  documentType: v.optional(invoiceDocumentType),
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

const transactionCategoryRule = v.object({
  id: v.string(),
  category: v.string(),
  direction: v.optional(v.union(v.literal("in"), v.literal("out"))),
  aliases: v.array(v.string()),
  createdAt: v.string(),
  updatedAt: v.string()
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

const wiseCardHolderTeamAssignment = v.object({
  cardHolderName: v.string(),
  teamId: v.string(),
  updatedAt: v.string()
});

const transaction = v.object({
  id: v.string(),
  source: dataSource,
  accountName: v.string(),
  date: v.string(),
  description: v.string(),
  rawName: v.string(),
  counterparty: v.string(),
  amount: v.number(),
  currency: v.string(),
  direction: v.union(v.literal("in"), v.literal("out")),
  status: v.union(v.literal("posted"), v.literal("pending"), v.literal("settled")),
  category: v.string(),
  matchedProviderId: v.optional(v.string()),
  matchedInvoiceId: v.optional(v.string()),
  teamId: v.optional(v.string()),
  cardHolderName: v.optional(v.string()),
  confidence: v.optional(v.number()),
  matchReason: v.optional(v.string())
});

const wiseStatementImport = v.object({
  id: v.string(),
  balanceId: v.string(),
  currency: v.string(),
  periodStart: v.string(),
  periodEnd: v.string(),
  fileName: v.string(),
  transactionCount: v.number(),
  importedAt: v.string()
});

const revenueRun = v.object({
  id: v.string(),
  partnerId: v.string(),
  partnerName: v.string(),
  providerId: v.string(),
  teamId: v.optional(v.string()),
  teamName: v.optional(v.string()),
  revenueCategory: v.string(),
  source: v.literal("tune"),
  periodStart: v.string(),
  periodEnd: v.string(),
  timezone: v.string(),
  revenue: v.number(),
  currency: v.string(),
  clicks: v.optional(v.number()),
  conversions: v.optional(v.number()),
  status: v.union(v.literal("pulled"), v.literal("invoiced"), v.literal("failed"), v.literal("mock"), v.literal("skipped")),
  invoiceId: v.optional(v.string()),
  externalInvoiceId: v.optional(v.string()),
  error: v.optional(v.string()),
  createdAt: v.string()
});

const revenuePartner = v.object({
  id: v.string(),
  name: v.string(),
  providerId: v.string(),
  teamId: v.optional(v.string()),
  revenueCategory: v.string(),
  source: v.literal("tune"),
  affiliateId: v.string(),
  externalId: v.optional(v.string()),
  currency: v.string(),
  timezone: v.string(),
  networkTimezone: v.string(),
  networkIdEnv: v.string(),
  apiKeyEnv: v.string(),
  apiBaseUrlEnv: v.optional(v.string()),
  meritCustomerName: v.optional(v.string()),
  invoiceDueDays: v.number(),
  enabled: v.boolean(),
  createdAt: v.string()
});

const aiSettings = v.object({
  provider: v.literal("openrouter"),
  model: v.string(),
  openRouterApiKey: v.optional(v.string()),
  updatedAt: v.optional(v.string())
});

export const getState = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      providers: v.array(provider),
      invoices: v.array(invoice),
      teams: v.array(team),
      transactionCategoryRules: v.array(transactionCategoryRule),
      revenuePartners: v.array(revenuePartner),
      transactionTeamAssignments: v.array(transactionTeamAssignment),
      wiseCardHolderTeamAssignments: v.array(wiseCardHolderTeamAssignment),
      wiseStatementTransactions: v.array(transaction),
      wiseStatementImports: v.array(wiseStatementImport),
      revenueRuns: v.array(revenueRun),
      aiSettings: v.optional(aiSettings),
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
      transactionCategoryRules: state.transactionCategoryRules ?? [],
      revenuePartners: state.revenuePartners ?? [],
      transactionTeamAssignments: state.transactionTeamAssignments ?? [],
      wiseCardHolderTeamAssignments: state.wiseCardHolderTeamAssignments ?? [],
      wiseStatementTransactions: state.wiseStatementTransactions ?? [],
      wiseStatementImports: state.wiseStatementImports ?? [],
      revenueRuns: state.revenueRuns ?? [],
      aiSettings: state.aiSettings,
      updatedAt: state.updatedAt
    };
  }
});

export const saveState = mutation({
  args: {
    providers: v.array(provider),
    invoices: v.array(invoice),
    teams: v.array(team),
    transactionCategoryRules: v.array(transactionCategoryRule),
    revenuePartners: v.array(revenuePartner),
    transactionTeamAssignments: v.array(transactionTeamAssignment),
    wiseCardHolderTeamAssignments: v.array(wiseCardHolderTeamAssignment),
    wiseStatementTransactions: v.array(transaction),
    wiseStatementImports: v.array(wiseStatementImport),
    revenueRuns: v.array(revenueRun),
    aiSettings: v.optional(aiSettings)
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
        transactionCategoryRules: args.transactionCategoryRules,
        revenuePartners: args.revenuePartners,
        transactionTeamAssignments: args.transactionTeamAssignments,
        wiseCardHolderTeamAssignments: args.wiseCardHolderTeamAssignments,
        wiseStatementTransactions: args.wiseStatementTransactions,
        wiseStatementImports: args.wiseStatementImports,
        revenueRuns: args.revenueRuns,
        aiSettings: args.aiSettings,
        updatedAt
      });
    } else {
      await ctx.db.insert("dashboardState", {
        key: "default",
        providers: args.providers,
        invoices: args.invoices,
        teams: args.teams,
        transactionCategoryRules: args.transactionCategoryRules,
        revenuePartners: args.revenuePartners,
        transactionTeamAssignments: args.transactionTeamAssignments,
        wiseCardHolderTeamAssignments: args.wiseCardHolderTeamAssignments,
        wiseStatementTransactions: args.wiseStatementTransactions,
        wiseStatementImports: args.wiseStatementImports,
        revenueRuns: args.revenueRuns,
        aiSettings: args.aiSettings,
        updatedAt
      });
    }

    return { updatedAt };
  }
});
