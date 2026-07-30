import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { ConvexError, v } from "convex/values";
import {
  initialTransactionCategories,
  isTransactionCategoryColor,
  isTransactionCategoryDirection,
  normalizeTransactionCategoryName
} from "../shared/categories";

const dataSource = v.union(
  v.literal("wise"),
  v.literal("revolut"),
  v.literal("slash"),
  v.literal("amex"),
  v.literal("merit"),
  v.literal("manual"),
  v.literal("tune")
);
const providerType = v.union(v.literal("client"), v.literal("supplier"));
const invoiceStatus = v.union(v.literal("draft"), v.literal("open"), v.literal("paid"));
const invoiceDocumentType = v.union(v.literal("sales_invoice"), v.literal("supplier_bill"));
const billingCadence = v.union(v.literal("weekly"), v.literal("monthly"));

const ledgerItem = v.object({
  id: v.string(),
  name: v.string(),
  balance: v.number(),
  currency: v.string(),
  source: dataSource,
  notes: v.optional(v.string()),
  dueDate: v.optional(v.string())
});

const meritCompanyComment = v.object({ date: v.optional(v.string()), text: v.string() });
const meritCompanyDimension = v.object({
  id: v.optional(v.string()),
  dimensionId: v.optional(v.string()),
  dimensionValueId: v.optional(v.string()),
  code: v.optional(v.string())
});
const meritCompanyDetails = v.object({
  relationship: v.union(v.literal("customer"), v.literal("vendor")),
  registrationNumber: v.optional(v.string()),
  contactName: v.optional(v.string()),
  phone: v.optional(v.string()),
  secondaryPhone: v.optional(v.string()),
  city: v.optional(v.string()),
  county: v.optional(v.string()),
  postalCode: v.optional(v.string()),
  countryName: v.optional(v.string()),
  fax: v.optional(v.string()),
  website: v.optional(v.string()),
  bankName: v.optional(v.string()),
  bankAccount: v.optional(v.string()),
  referenceNumber: v.optional(v.string()),
  invoiceLanguage: v.optional(v.string()),
  groupId: v.optional(v.string()),
  groupName: v.optional(v.string()),
  changedDate: v.optional(v.string()),
  invoiceSendPreference: v.optional(v.string()),
  glnCode: v.optional(v.string()),
  partyCode: v.optional(v.string()),
  telemaEdi: v.optional(v.string()),
  vendorType: v.optional(v.number()),
  notTaxDomesticCustomer: v.optional(v.boolean()),
  taxRegistered: v.optional(v.boolean()),
  overdueCharge: v.optional(v.number()),
  comments: v.optional(v.array(meritCompanyComment)),
  dimensions: v.optional(v.array(meritCompanyDimension))
});

const provider = v.object({
  id: v.string(),
  name: v.string(),
  type: providerType,
  tags: v.array(v.string()),
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
  defaultMeritTaxId: v.optional(v.string()),
  defaultMeritTaxSource: v.optional(v.union(v.literal("merit-history"), v.literal("manual"))),
  defaultMeritTaxSampleSize: v.optional(v.number()),
  defaultMeritTaxUpdatedAt: v.optional(v.string()),
  meritDetails: v.optional(meritCompanyDetails),
  source: dataSource,
  createdAt: v.string()
});

const invoice = v.object({
  id: v.string(),
  providerId: v.optional(v.string()),
  documentType: invoiceDocumentType,
  origin: v.union(v.literal("manual"), v.literal("revenue"), v.literal("merit")),
  customerName: v.string(),
  amount: v.number(),
  currency: v.string(),
  status: invoiceStatus,
  meritStatus: v.optional(v.union(v.literal("open"), v.literal("paid"))),
  meritDeliveryStatus: v.union(
    v.literal("not-sent"),
    v.literal("saved"),
    v.literal("delivered"),
    v.literal("delivery-failed")
  ),
  meritDeliveryError: v.optional(v.string()),
  sendError: v.optional(v.string()),
  meritCreationReservedAt: v.optional(v.string()),
  invoiceNumber: v.string(),
  issueDate: v.string(),
  dueDate: v.string(),
  source: dataSource,
  externalId: v.optional(v.string()),
  description: v.string(),
  transactionId: v.optional(v.string()),
  billingRuleId: v.optional(v.string()),
  revenueRunIds: v.array(v.string()),
  periodStart: v.optional(v.string()),
  periodEnd: v.optional(v.string()),
  taxId: v.optional(v.string()),
  sentAt: v.optional(v.string()),
  paidAt: v.optional(v.string()),
  createdAt: v.string(),
  updatedAt: v.string()
});

const expenseDocumentKind = v.union(
  v.literal("vendor_receipt"),
  v.literal("vendor_invoice"),
  v.literal("missing_receipt_declaration")
);
const expenseVatTreatment = v.union(
  v.literal("standard"),
  v.literal("reduced"),
  v.literal("zero"),
  v.literal("exempt"),
  v.literal("reverse_charge"),
  v.literal("not_applicable")
);
const expenseDocument = v.object({
  id: v.string(),
  kind: expenseDocumentKind,
  fileName: v.string(),
  contentType: v.string(),
  size: v.number(),
  storageId: v.string(),
  createdAt: v.string()
});
const expenseRecord = v.object({
  id: v.string(),
  recordNumber: v.string(),
  recordType: v.union(v.literal("paid_expense"), v.literal("supplier_bill")),
  paymentStatus: v.union(v.literal("paid"), v.literal("unpaid")),
  transactionId: v.optional(v.string()),
  providerId: v.optional(v.string()),
  teamId: v.optional(v.string()),
  supplierName: v.string(),
  supplierRegistrationNumber: v.optional(v.string()),
  supplierVatNumber: v.optional(v.string()),
  sourceDocumentNumber: v.optional(v.string()),
  issueDate: v.string(),
  transactionDate: v.optional(v.string()),
  dueDate: v.optional(v.string()),
  paidAt: v.optional(v.string()),
  category: v.string(),
  businessPurpose: v.string(),
  description: v.string(),
  netAmount: v.number(),
  vatAmount: v.number(),
  grossAmount: v.number(),
  vatRate: v.optional(v.number()),
  vatTreatment: expenseVatTreatment,
  currency: v.string(),
  missingDocumentReason: v.optional(v.string()),
  declarationConfirmedAt: v.optional(v.string()),
  documents: v.array(expenseDocument),
  createdAt: v.string(),
  updatedAt: v.string()
});

const team = v.object({ id: v.string(), name: v.string(), createdAt: v.string() });
const transactionTeamAssignment = v.object({ transactionId: v.string(), teamId: v.string(), updatedAt: v.string() });
const wiseCardHolderTeamAssignment = v.object({ cardHolderName: v.string(), teamId: v.string(), updatedAt: v.string() });
const transactionCategoryRule = v.object({
  id: v.string(),
  category: v.string(),
  direction: v.optional(v.union(v.literal("in"), v.literal("out"))),
  aliases: v.array(v.string()),
  createdAt: v.string(),
  updatedAt: v.string()
});
const transactionCategoryDirection = v.union(v.literal("in"), v.literal("out"), v.literal("both"));
const transactionCategory = v.object({
  id: v.string(),
  name: v.string(),
  direction: transactionCategoryDirection,
  color: v.string(),
  system: v.boolean(),
  createdAt: v.string(),
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
  providerId: v.optional(v.string()),
  partnerName: v.string(),
  revenueCategory: v.optional(v.string()),
  teamId: v.optional(v.string()),
  teamName: v.optional(v.string()),
  source: v.literal("tune"),
  periodStart: v.string(),
  periodEnd: v.string(),
  timezone: v.string(),
  revenue: v.number(),
  currency: v.string(),
  clicks: v.optional(v.number()),
  conversions: v.optional(v.number()),
  status: v.union(
    v.literal("pulled"),
    v.literal("drafted"),
    v.literal("invoicing"),
    v.literal("invoiced"),
    v.literal("failed"),
    v.literal("skipped")
  ),
  invoiceId: v.optional(v.string()),
  externalInvoiceId: v.optional(v.string()),
  error: v.optional(v.string()),
  createdAt: v.string()
});
const revenuePartner = v.object({
  id: v.string(),
  providerId: v.string(),
  teamId: v.optional(v.string()),
  name: v.string(),
  revenueCategory: v.optional(v.string()),
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
  billingCadence,
  billingTimezone: v.string(),
  autoDraft: v.boolean(),
  defaultMeritTaxId: v.optional(v.string()),
  defaultMeritItemCode: v.optional(v.string()),
  enabled: v.boolean(),
  createdAt: v.string()
});
const revenueAccrual = v.object({
  id: v.string(),
  partnerId: v.string(),
  providerId: v.optional(v.string()),
  partnerName: v.string(),
  billingCadence,
  periodStart: v.string(),
  periodEnd: v.string(),
  accruedThrough: v.string(),
  amount: v.number(),
  currency: v.string(),
  status: v.union(v.literal("accruing"), v.literal("drafted")),
  revenueRunId: v.string(),
  invoiceId: v.optional(v.string()),
  updatedAt: v.string()
});
const paymentAllocation = v.object({
  id: v.string(),
  invoiceId: v.string(),
  transactionId: v.optional(v.string()),
  amount: v.number(),
  currency: v.string(),
  source: v.union(
    v.literal("wise"),
    v.literal("revolut"),
    v.literal("slash"),
    v.literal("amex"),
    v.literal("cash"),
    v.literal("kraken"),
    v.literal("trust"),
    v.literal("other")
  ),
  accountName: v.optional(v.string()),
  reference: v.optional(v.string()),
  note: v.optional(v.string()),
  mode: v.union(v.literal("automatic"), v.literal("manual")),
  confidence: v.optional(v.number()),
  matchReason: v.optional(v.string()),
  paidAt: v.string(),
  createdAt: v.string()
});
const holding = v.object({
  id: v.string(),
  name: v.string(),
  kind: v.union(v.literal("cash"), v.literal("exchange"), v.literal("wallet")),
  assetType: v.union(v.literal("fiat"), v.literal("crypto")),
  asset: v.string(),
  balance: v.number(),
  notes: v.optional(v.string()),
  updatedAt: v.string()
});
const fxRate = v.object({
  asset: v.string(),
  rateUsd: v.number(),
  provider: v.union(v.literal("coinbase"), v.literal("yahoo")),
  asOf: v.string(),
  checkedAt: v.optional(v.string()),
  stale: v.optional(v.boolean())
});
const automationRun = v.object({
  id: v.string(),
  type: v.literal("weekly-income"),
  periodStart: v.string(),
  periodEnd: v.string(),
  timezone: v.literal("Asia/Beirut"),
  status: v.union(v.literal("running"), v.literal("completed"), v.literal("failed")),
  startedAt: v.string(),
  completedAt: v.optional(v.string()),
  error: v.optional(v.string())
});
const aiSettings = v.object({ provider: v.literal("openrouter"), model: v.string(), updatedAt: v.optional(v.string()) });
const profitDistributionAdjustment = v.object({
  id: v.string(),
  month: v.string(),
  currency: v.string(),
  partnerId: v.union(v.literal("ishan"), v.literal("ben"), v.literal("sanjan"), v.literal("amin")),
  bucket: v.union(v.literal("profit-share"), v.literal("salary"), v.literal("distribution")),
  waived: v.boolean(),
  deferred: v.boolean(),
  overrideAmount: v.optional(v.number()),
  note: v.optional(v.string()),
  updatedAt: v.string()
});

function requireServiceToken(serviceToken: string): void {
  const expected = process.env.CONVEX_SERVICE_TOKEN;
  if (!expected || serviceToken !== expected) throw new ConvexError({ code: "UNAUTHORIZED" });
}

function nextUpdatedAt(previous?: string): string {
  const previousTimestamp = previous ? Date.parse(previous) : 0;
  return new Date(Math.max(Date.now(), previousTimestamp + 1)).toISOString();
}

async function listTransactionCategories(ctx: QueryCtx | MutationCtx) {
  const categories = await ctx.db.query("transactionCategories").collect();
  return categories
    .map(({ id, name, direction, color, system, createdAt, updatedAt }) => ({
      id,
      name,
      direction,
      color,
      system,
      createdAt,
      updatedAt
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export const getState = query({
  args: { serviceToken: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      providers: v.array(provider),
      invoices: v.array(invoice),
      expenses: v.array(expenseRecord),
      manualReceivables: v.array(ledgerItem),
      teams: v.array(team),
      transactionCategories: v.array(transactionCategory),
      transactionCategoryRules: v.array(transactionCategoryRule),
      revenuePartners: v.array(revenuePartner),
      transactionTeamAssignments: v.array(transactionTeamAssignment),
      wiseCardHolderTeamAssignments: v.array(wiseCardHolderTeamAssignment),
      wiseStatementTransactions: v.array(transaction),
      wiseStatementImports: v.array(wiseStatementImport),
      revenueRuns: v.array(revenueRun),
      revenueAccruals: v.array(revenueAccrual),
      paymentAllocations: v.array(paymentAllocation),
      holdings: v.array(holding),
      fxRates: v.array(fxRate),
      fxTrackedAssets: v.optional(v.array(v.string())),
      automationRuns: v.array(automationRun),
      profitDistributionAdjustments: v.array(profitDistributionAdjustment),
      aiSettings: v.optional(aiSettings),
      updatedAt: v.string()
    })
  ),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const [state, transactionCategories] = await Promise.all([
      ctx.db.query("dashboardState").withIndex("by_key", (q) => q.eq("key", "default")).unique(),
      listTransactionCategories(ctx)
    ]);
    if (!state) return null;
    return {
      providers: state.providers,
      invoices: state.invoices,
      expenses: state.expenses,
      manualReceivables: state.manualReceivables,
      teams: state.teams,
      transactionCategories,
      transactionCategoryRules: state.transactionCategoryRules,
      revenuePartners: state.revenuePartners,
      transactionTeamAssignments: state.transactionTeamAssignments,
      wiseCardHolderTeamAssignments: state.wiseCardHolderTeamAssignments,
      wiseStatementTransactions: state.wiseStatementTransactions,
      wiseStatementImports: state.wiseStatementImports,
      revenueRuns: state.revenueRuns,
      revenueAccruals: state.revenueAccruals,
      paymentAllocations: state.paymentAllocations,
      holdings: state.holdings,
      fxRates: state.fxRates,
      fxTrackedAssets: state.fxTrackedAssets,
      automationRuns: state.automationRuns,
      profitDistributionAdjustments: state.profitDistributionAdjustments,
      aiSettings: state.aiSettings,
      updatedAt: state.updatedAt
    };
  }
});

export const generateExpenseDocumentUploadUrl = mutation({
  args: { serviceToken: v.string() },
  returns: v.string(),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    return ctx.storage.generateUploadUrl();
  }
});

export const getExpenseDocumentUrl = query({
  args: { serviceToken: v.string(), storageId: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    return ctx.storage.getUrl(args.storageId as Id<"_storage">);
  }
});

export const deleteExpenseDocument = mutation({
  args: { serviceToken: v.string(), storageId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    await ctx.storage.delete(args.storageId as Id<"_storage">);
    return null;
  }
});

export const seedTransactionCategories = mutation({
  args: { serviceToken: v.string() },
  returns: v.array(transactionCategory),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const now = new Date().toISOString();
    for (const category of initialTransactionCategories) {
      const existing = await ctx.db
        .query("transactionCategories")
        .withIndex("by_category_id", (q) => q.eq("id", category.id))
        .unique();
      if (existing) continue;
      await ctx.db.insert("transactionCategories", {
        ...category,
        nameNormalized: category.name.toLowerCase(),
        createdAt: now,
        updatedAt: now
      });
    }
    return listTransactionCategories(ctx);
  }
});

export const createTransactionCategory = mutation({
  args: {
    serviceToken: v.string(),
    id: v.string(),
    name: v.string(),
    direction: transactionCategoryDirection,
    color: v.string()
  },
  returns: v.array(transactionCategory),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const name = normalizeTransactionCategoryName(args.name);
    const nameNormalized = name.toLowerCase();
    if (!name) throw new ConvexError({ code: "INVALID_CATEGORY", message: "Category name is required" });
    if (!isTransactionCategoryDirection(args.direction)) {
      throw new ConvexError({ code: "INVALID_CATEGORY", message: "Category type is invalid" });
    }
    if (!isTransactionCategoryColor(args.color)) {
      throw new ConvexError({ code: "INVALID_CATEGORY", message: "Category color must be a six-digit hex value" });
    }
    const duplicate = await ctx.db
      .query("transactionCategories")
      .withIndex("by_name_normalized", (q) => q.eq("nameNormalized", nameNormalized))
      .unique();
    if (duplicate) throw new ConvexError({ code: "CATEGORY_EXISTS", message: "A category with this name already exists" });
    const now = new Date().toISOString();
    await ctx.db.insert("transactionCategories", {
      id: args.id,
      name,
      nameNormalized,
      direction: args.direction,
      color: args.color.toLowerCase(),
      system: false,
      createdAt: now,
      updatedAt: now
    });
    return listTransactionCategories(ctx);
  }
});

export const updateTransactionCategory = mutation({
  args: {
    serviceToken: v.string(),
    id: v.string(),
    name: v.string(),
    direction: transactionCategoryDirection,
    color: v.string()
  },
  returns: v.array(transactionCategory),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const category = await ctx.db.query("transactionCategories").withIndex("by_category_id", (q) => q.eq("id", args.id)).unique();
    if (!category) throw new ConvexError({ code: "CATEGORY_NOT_FOUND", message: "Category not found" });
    const name = normalizeTransactionCategoryName(args.name);
    const nameNormalized = name.toLowerCase();
    if (!name) throw new ConvexError({ code: "INVALID_CATEGORY", message: "Category name is required" });
    if (!isTransactionCategoryDirection(args.direction)) {
      throw new ConvexError({ code: "INVALID_CATEGORY", message: "Category type is invalid" });
    }
    if (!isTransactionCategoryColor(args.color)) {
      throw new ConvexError({ code: "INVALID_CATEGORY", message: "Category color must be a six-digit hex value" });
    }
    if (category.system && (name !== category.name || args.direction !== category.direction)) {
      throw new ConvexError({
        code: "SYSTEM_CATEGORY",
        message: "Built-in category names and types are locked because reporting rules depend on them"
      });
    }
    const duplicate = await ctx.db
      .query("transactionCategories")
      .withIndex("by_name_normalized", (q) => q.eq("nameNormalized", nameNormalized))
      .unique();
    if (duplicate && duplicate.id !== category.id) {
      throw new ConvexError({ code: "CATEGORY_EXISTS", message: "A category with this name already exists" });
    }

    if (name !== category.name) {
      const state = await ctx.db.query("dashboardState").withIndex("by_key", (q) => q.eq("key", "default")).unique();
      if (state) {
        await ctx.db.patch(state._id, {
          transactionCategoryRules: state.transactionCategoryRules.map((rule) =>
            rule.category === category.name ? { ...rule, category: name, updatedAt: new Date().toISOString() } : rule
          ),
          wiseStatementTransactions: state.wiseStatementTransactions.map((transaction) =>
            transaction.category === category.name ? { ...transaction, category: name } : transaction
          ),
          revenuePartners: state.revenuePartners.map((partner) =>
            partner.revenueCategory === category.name ? { ...partner, revenueCategory: name } : partner
          ),
          updatedAt: nextUpdatedAt(state.updatedAt)
        });
      }
    }

    await ctx.db.patch(category._id, {
      name,
      nameNormalized,
      direction: args.direction,
      color: args.color.toLowerCase(),
      updatedAt: new Date().toISOString()
    });
    return listTransactionCategories(ctx);
  }
});

export const deleteTransactionCategory = mutation({
  args: { serviceToken: v.string(), id: v.string() },
  returns: v.array(transactionCategory),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const category = await ctx.db.query("transactionCategories").withIndex("by_category_id", (q) => q.eq("id", args.id)).unique();
    if (!category) throw new ConvexError({ code: "CATEGORY_NOT_FOUND", message: "Category not found" });
    if (category.system) {
      throw new ConvexError({ code: "SYSTEM_CATEGORY", message: "Built-in categories cannot be deleted" });
    }
    const state = await ctx.db.query("dashboardState").withIndex("by_key", (q) => q.eq("key", "default")).unique();
    const referenceCount = state
      ? state.wiseStatementTransactions.filter((transaction) => transaction.category === category.name).length
        + state.transactionCategoryRules.filter((rule) => rule.category === category.name).length
        + state.revenuePartners.filter((partner) => partner.revenueCategory === category.name).length
      : 0;
    if (referenceCount > 0) {
      throw new ConvexError({
        code: "CATEGORY_IN_USE",
        message: `Reassign ${referenceCount} ${referenceCount === 1 ? "reference" : "references"} before deleting this category`
      });
    }
    await ctx.db.delete(category._id);
    return listTransactionCategories(ctx);
  }
});

export const saveState = mutation({
  args: {
    providers: v.array(provider),
    invoices: v.array(invoice),
    expenses: v.array(expenseRecord),
    manualReceivables: v.array(ledgerItem),
    teams: v.array(team),
    transactionCategoryRules: v.array(transactionCategoryRule),
    revenuePartners: v.array(revenuePartner),
    transactionTeamAssignments: v.array(transactionTeamAssignment),
    wiseCardHolderTeamAssignments: v.array(wiseCardHolderTeamAssignment),
    wiseStatementTransactions: v.array(transaction),
    wiseStatementImports: v.array(wiseStatementImport),
    revenueRuns: v.array(revenueRun),
    revenueAccruals: v.array(revenueAccrual),
    paymentAllocations: v.array(paymentAllocation),
    holdings: v.array(holding),
    fxRates: v.array(fxRate),
    fxTrackedAssets: v.optional(v.array(v.string())),
    automationRuns: v.array(automationRun),
    profitDistributionAdjustments: v.array(profitDistributionAdjustment),
    aiSettings: v.optional(aiSettings),
    serviceToken: v.string(),
    expectedUpdatedAt: v.union(v.string(), v.null())
  },
  returns: v.object({ updatedAt: v.string() }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const existing = await ctx.db.query("dashboardState").withIndex("by_key", (q) => q.eq("key", "default")).unique();
    if ((existing?.updatedAt ?? null) !== args.expectedUpdatedAt) throw new ConvexError({ code: "STATE_CONFLICT" });

    const updatedAt = nextUpdatedAt(existing?.updatedAt);
    const dashboardState = {
      providers: args.providers,
      invoices: args.invoices,
      expenses: args.expenses,
      manualReceivables: args.manualReceivables,
      teams: args.teams,
      transactionCategoryRules: args.transactionCategoryRules,
      revenuePartners: args.revenuePartners,
      transactionTeamAssignments: args.transactionTeamAssignments,
      wiseCardHolderTeamAssignments: args.wiseCardHolderTeamAssignments,
      wiseStatementTransactions: args.wiseStatementTransactions,
      wiseStatementImports: args.wiseStatementImports,
      revenueRuns: args.revenueRuns,
      revenueAccruals: args.revenueAccruals,
      paymentAllocations: args.paymentAllocations,
      holdings: args.holdings,
      fxRates: args.fxRates,
      fxTrackedAssets: args.fxTrackedAssets ?? existing?.fxTrackedAssets ?? [],
      automationRuns: args.automationRuns,
      profitDistributionAdjustments: args.profitDistributionAdjustments,
      aiSettings: args.aiSettings,
      updatedAt
    };
    if (existing) await ctx.db.patch(existing._id, dashboardState);
    else await ctx.db.insert("dashboardState", { key: "default", ...dashboardState });
    return { updatedAt };
  }
});

export const getWiseResetPreview = query({
  args: { serviceToken: v.string() },
  returns: v.object({
    transactions: v.number(),
    imports: v.number()
  }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const state = await ctx.db
      .query("dashboardState")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .unique();
    return {
      transactions:
        state?.wiseStatementTransactions.filter((item) => item.source === "wise").length ?? 0,
      imports: state?.wiseStatementImports.length ?? 0
    };
  }
});

export const resetWiseImports = mutation({
  args: { serviceToken: v.string() },
  returns: v.object({
    deletedTransactions: v.number(),
    deletedImports: v.number(),
    updatedAt: v.string()
  }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const state = await ctx.db
      .query("dashboardState")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .unique();
    if (!state) {
      throw new ConvexError({ code: "STATE_NOT_FOUND" });
    }
    const deletedTransactions = state.wiseStatementTransactions.filter(
      (item) => item.source === "wise"
    ).length;
    const deletedImports = state.wiseStatementImports.length;
    const updatedAt = nextUpdatedAt(state.updatedAt);
    await ctx.db.patch(state._id, {
      wiseStatementTransactions: state.wiseStatementTransactions.filter(
        (item) => item.source !== "wise"
      ),
      wiseStatementImports: [],
      updatedAt
    });
    return { deletedTransactions, deletedImports, updatedAt };
  }
});

export const reserveIncomeAutomation = mutation({
  args: { serviceToken: v.string(), run: automationRun, staleBefore: v.string() },
  returns: v.object({ reserved: v.boolean(), updatedAt: v.string() }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    if (args.run.status !== "running") throw new ConvexError({ code: "INVALID_AUTOMATION_RESERVATION" });
    const state = await ctx.db.query("dashboardState").withIndex("by_key", (q) => q.eq("key", "default")).unique();
    if (!state) throw new ConvexError({ code: "STATE_NOT_FOUND" });
    const existingRun = state.automationRuns.find((run) => run.id === args.run.id);
    if (existingRun?.status === "completed") {
      return { reserved: false, updatedAt: state.updatedAt };
    }
    if (existingRun?.status === "running" && existingRun.startedAt > args.staleBefore) {
      return { reserved: false, updatedAt: state.updatedAt };
    }
    const updatedAt = nextUpdatedAt(state.updatedAt);
    await ctx.db.patch(state._id, {
      automationRuns: [args.run, ...state.automationRuns.filter((run) => run.id !== args.run.id)].slice(0, 100),
      updatedAt
    });
    return { reserved: true, updatedAt };
  }
});

export const reserveInvoiceCreation = mutation({
  args: {
    serviceToken: v.string(),
    invoiceId: v.string(),
    reservedAt: v.string()
  },
  returns: v.object({ reserved: v.boolean(), updatedAt: v.string() }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const state = await ctx.db.query("dashboardState").withIndex("by_key", (q) => q.eq("key", "default")).unique();
    if (!state) throw new ConvexError({ code: "STATE_NOT_FOUND" });
    const current = state.invoices.find((item) => item.id === args.invoiceId);
    if (!current) throw new ConvexError({ code: "INVOICE_NOT_FOUND" });
    if (current.status !== "draft") return { reserved: false, updatedAt: state.updatedAt };
    if (current.externalId) return { reserved: false, updatedAt: state.updatedAt };
    if (current.sendError) return { reserved: false, updatedAt: state.updatedAt };
    if (current.meritCreationReservedAt) {
      return { reserved: false, updatedAt: state.updatedAt };
    }
    const updatedAt = nextUpdatedAt(state.updatedAt);
    const reservedInvoice = {
      ...current,
      meritCreationReservedAt: args.reservedAt,
      updatedAt: args.reservedAt
    };
    await ctx.db.patch(state._id, {
      invoices: state.invoices.map((item) => item.id === args.invoiceId ? reservedInvoice : item),
      updatedAt
    });
    return { reserved: true, updatedAt };
  }
});

export const finalizeInvoiceCreation = mutation({
  args: { serviceToken: v.string(), invoice },
  returns: v.object({ updatedAt: v.string() }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const state = await ctx.db.query("dashboardState").withIndex("by_key", (q) => q.eq("key", "default")).unique();
    if (!state) throw new ConvexError({ code: "STATE_NOT_FOUND" });
    const current = state.invoices.find((item) => item.id === args.invoice.id);
    if (!current) throw new ConvexError({ code: "INVOICE_NOT_FOUND" });
    if (current.externalId && current.externalId !== args.invoice.externalId) {
      throw new ConvexError({ code: "INVOICE_CREATION_CONFLICT" });
    }
    const linkedRunIds = new Set(args.invoice.revenueRunIds);
    const revenueRuns = state.revenueRuns.map((run) => {
      if (!args.invoice.externalId || !linkedRunIds.has(run.id)) return run;
      const { error: _error, ...cleanRun } = run;
      return {
        ...cleanRun,
        status: "invoiced" as const,
        invoiceId: args.invoice.id,
        externalInvoiceId: args.invoice.externalId
      };
    });
    const updatedAt = nextUpdatedAt(state.updatedAt);
    await ctx.db.patch(state._id, {
      invoices: state.invoices.map((item) => item.id === args.invoice.id ? args.invoice : item),
      revenueRuns,
      updatedAt
    });
    return { updatedAt };
  }
});
