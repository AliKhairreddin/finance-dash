import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";

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
  v.literal("client"),
  v.literal("supplier")
);

const invoiceStatus = v.union(v.literal("draft"), v.literal("open"), v.literal("paid"), v.literal("created"));

const invoiceDocumentType = v.union(v.literal("sales_invoice"), v.literal("supplier_bill"));

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
    v.literal("invoicing"),
    v.literal("invoiced"),
    v.literal("failed"),
    v.literal("mock"),
    v.literal("skipped")
  ),
  invoiceId: v.optional(v.string()),
  externalInvoiceId: v.optional(v.string()),
  error: v.optional(v.string()),
  createdAt: v.string()
});

const revenuePartner = v.object({
  id: v.string(),
  providerId: v.optional(v.string()),
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
  enabled: v.boolean(),
  createdAt: v.string()
});

const aiSettings = v.object({
  provider: v.literal("openrouter"),
  model: v.string(),
  updatedAt: v.optional(v.string())
});

type ProviderRelationship = "client" | "supplier";
type ProviderSource = "wise" | "revolut" | "slash" | "merit" | "manual" | "mock" | "tune";

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function uniqueProviderTags(values: unknown[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const tag = value.trim().replace(/\s+/g, " ");
    const normalized = normalizeText(tag);
    if (!tag || !normalized || normalized === "uncategorized" || seen.has(normalized)) continue;
    seen.add(normalized);
    tags.push(tag);
  }
  return tags;
}

function relationshipTag(type: string): string | undefined {
  if (type === "partner") return "Partner";
  if (type === "platform") return "Platform";
  if (type === "internal") return "Internal";
  return undefined;
}

function inferProviderType(provider: Record<string, unknown>): ProviderRelationship {
  const type = typeof provider.type === "string" ? provider.type : "";
  if (type === "client" || type === "supplier") return type;
  if (type === "partner") return "client";
  if (typeof provider.meritCustomerId === "string" && provider.meritCustomerId && !provider.meritSupplierId) return "client";

  const tagText = Array.isArray(provider.tags) ? provider.tags.filter((tag) => typeof tag === "string").join(" ") : "";
  const text = normalizeText([provider.name, provider.category, tagText].filter((value) => typeof value === "string").join(" "));
  return /\b(client|customer|revenue|affiliate|partner)\b/.test(text) ? "client" : "supplier";
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeProvider(provider: unknown) {
  const record = provider && typeof provider === "object" && !Array.isArray(provider) ? (provider as Record<string, unknown>) : {};
  const type = typeof record.type === "string" ? record.type : "";
  const tags = uniqueProviderTags([
    ...(Array.isArray(record.tags) ? record.tags : []),
    record.category,
    relationshipTag(type)
  ]);

  return {
    id: String(record.id),
    name: String(record.name),
    type: inferProviderType(record),
    tags,
    aliases: stringArray(record.aliases),
    defaultAccount: optionalString(record.defaultAccount),
    legalName: optionalString(record.legalName),
    email: optionalString(record.email),
    country: optionalString(record.country),
    address: optionalString(record.address),
    taxId: optionalString(record.taxId),
    defaultCurrency: optionalString(record.defaultCurrency),
    paymentTermsDays: optionalNumber(record.paymentTermsDays),
    meritCustomerId: optionalString(record.meritCustomerId),
    meritSupplierId: optionalString(record.meritSupplierId),
    source: record.source as ProviderSource,
    createdAt: String(record.createdAt)
  };
}

function requireServiceToken(serviceToken: string): void {
  const expected = process.env.CONVEX_SERVICE_TOKEN;
  if (!expected || serviceToken !== expected) {
    throw new ConvexError({ code: "UNAUTHORIZED" });
  }
}

function nextUpdatedAt(previous?: string): string {
  const previousTimestamp = previous ? Date.parse(previous) : 0;
  return new Date(Math.max(Date.now(), previousTimestamp + 1)).toISOString();
}

export const getState = query({
  args: { serviceToken: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      providers: v.array(provider),
      invoices: v.array(invoice),
      teams: v.array(team),
      transactionCategoryRules: v.array(transactionCategoryRule),
      revenuePartners: v.array(revenuePartner),
      transactionTeamAssignments: v.array(transactionTeamAssignment),
      wiseStatementTransactions: v.array(transaction),
      wiseStatementImports: v.array(wiseStatementImport),
      revenueRuns: v.array(revenueRun),
      aiSettings: v.optional(aiSettings),
      updatedAt: v.string()
    })
  ),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const state = await ctx.db
      .query("dashboardState")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .unique();

    if (!state) return null;

    return {
      providers: state.providers.map(normalizeProvider),
      invoices: state.invoices,
      teams: state.teams ?? [],
      transactionCategoryRules: state.transactionCategoryRules ?? [],
      revenuePartners: state.revenuePartners ?? [],
      transactionTeamAssignments: state.transactionTeamAssignments ?? [],
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
    wiseStatementTransactions: v.array(transaction),
    wiseStatementImports: v.array(wiseStatementImport),
    revenueRuns: v.array(revenueRun),
    aiSettings: v.optional(aiSettings),
    serviceToken: v.string(),
    expectedUpdatedAt: v.union(v.string(), v.null())
  },
  returns: v.object({
    updatedAt: v.string()
  }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const existing = await ctx.db
      .query("dashboardState")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .unique();

    if ((existing?.updatedAt ?? null) !== args.expectedUpdatedAt) {
      throw new ConvexError({ code: "STATE_CONFLICT" });
    }

    const updatedAt = nextUpdatedAt(existing?.updatedAt);

    if (existing) {
      await ctx.db.patch(existing._id, {
        providers: args.providers,
        invoices: args.invoices,
        teams: args.teams,
        transactionCategoryRules: args.transactionCategoryRules,
        revenuePartners: args.revenuePartners,
        transactionTeamAssignments: args.transactionTeamAssignments,
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

export const reserveRevenueInvoice = mutation({
  args: {
    serviceToken: v.string(),
    run: revenueRun
  },
  returns: v.object({
    reserved: v.boolean(),
    updatedAt: v.string()
  }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    if (args.run.status !== "invoicing") {
      throw new ConvexError({ code: "INVALID_REVENUE_RESERVATION" });
    }

    const state = await ctx.db
      .query("dashboardState")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .unique();
    if (!state) throw new ConvexError({ code: "STATE_NOT_FOUND" });

    const revenueRuns = state.revenueRuns ?? [];
    const existing = revenueRuns.find(
      (run) =>
        run.partnerId === args.run.partnerId &&
        run.periodStart === args.run.periodStart &&
        run.periodEnd === args.run.periodEnd &&
        (run.status === "invoicing" || run.status === "invoiced")
    );
    if (existing) {
      return { reserved: false, updatedAt: state.updatedAt };
    }

    const updatedAt = nextUpdatedAt(state.updatedAt);
    await ctx.db.patch(state._id, {
      revenueRuns: [args.run, ...revenueRuns.filter((run) => run.id !== args.run.id)].slice(0, 250),
      updatedAt
    });
    return { reserved: true, updatedAt };
  }
});

export const finalizeRevenueInvoice = mutation({
  args: {
    serviceToken: v.string(),
    run: revenueRun,
    invoice: v.optional(invoice)
  },
  returns: v.object({ updatedAt: v.string() }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const state = await ctx.db
      .query("dashboardState")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .unique();
    if (!state) throw new ConvexError({ code: "STATE_NOT_FOUND" });

    const revenueRuns = state.revenueRuns ?? [];
    const reservation = revenueRuns.find((run) => run.id === args.run.id);
    const isIdempotentFinalization = reservation?.status === args.run.status;
    if (!reservation || (reservation.status !== "invoicing" && !isIdempotentFinalization)) {
      throw new ConvexError({ code: "REVENUE_RESERVATION_CONFLICT" });
    }

    const updatedAt = nextUpdatedAt(state.updatedAt);
    await ctx.db.patch(state._id, {
      revenueRuns: [args.run, ...revenueRuns.filter((run) => run.id !== args.run.id)].slice(0, 250),
      invoices: args.invoice ? [args.invoice, ...state.invoices.filter((item) => item.id !== args.invoice?.id)] : state.invoices,
      updatedAt
    });
    return { updatedAt };
  }
});
