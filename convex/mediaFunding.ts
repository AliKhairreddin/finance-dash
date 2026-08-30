import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import {
  calculateMediaFundingBalance,
  calculateMediaFundingBankTransactionCredit,
  mediaFundingBankCategory,
  mediaFundingAccountKey,
  mediaFundingBusinessManagerKey,
  mediaFundingCurrency,
  mediaFundingTargetKey,
  roundMediaFundingMoney
} from "../shared/mediaFunding";
import { financeOperatingDate } from "../shared/operatingDate";

const entryType = v.literal("adjustment");
const assignmentScope = v.union(v.literal("business_manager"), v.literal("ad_account"));
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const maximumProviders = 200;
const maximumEntries = 4_000;
const maximumAssignments = 4_000;
const maximumAssignmentsPerTarget = 100;
const maximumAssignmentsPerBusinessManager = 1_000;
const maximumSpendRowsPerDate = 3_500;
const maximumProviderDays = 4_000;
const maximumBankFundingTransactions = 8_000;

const providerResult = v.object({
  id: v.id("mediaFundingProviders"),
  companyProviderId: v.string(),
  name: v.string(),
  defaultFeePercent: v.number(),
  currency: v.string(),
  openingBalance: v.number(),
  openingBalanceDate: v.string(),
  grossFunding: v.number(),
  fees: v.number(),
  netFunding: v.number(),
  adjustments: v.number(),
  spend: v.number(),
  estimatedBalance: v.number(),
  assignmentCount: v.number(),
  bankFundingCount: v.number(),
  excludedFundingCount: v.number(),
  createdAt: v.string(),
  updatedAt: v.string()
});

const bankFundingResult = v.object({
  id: v.string(),
  providerId: v.id("mediaFundingProviders"),
  companyProviderId: v.string(),
  source: v.union(v.literal("wise"), v.literal("revolut"), v.literal("slash"), v.literal("amex")),
  accountName: v.string(),
  date: v.string(),
  counterparty: v.string(),
  description: v.string(),
  grossAmount: v.number(),
  feePercent: v.number(),
  feeAmount: v.number(),
  netAmount: v.number(),
  currency: v.string()
});

const entryResult = v.object({
  id: v.id("mediaFundingEntries"),
  providerId: v.id("mediaFundingProviders"),
  type: entryType,
  date: v.string(),
  netAmount: v.number(),
  note: v.optional(v.string()),
  createdAt: v.string(),
  updatedAt: v.string()
});

const assignmentResult = v.object({
  id: v.id("mediaFundingAssignments"),
  providerId: v.id("mediaFundingProviders"),
  scope: assignmentScope,
  targetKey: v.string(),
  businessManagerKey: v.string(),
  platform: v.string(),
  businessManagerId: v.string(),
  businessManagerName: v.optional(v.string()),
  accountId: v.optional(v.string()),
  accountName: v.optional(v.string()),
  effectiveFrom: v.string(),
  effectiveTo: v.optional(v.string()),
  createdAt: v.string(),
  updatedAt: v.string()
});

const mutationResult = v.object({
  rebuildFrom: v.optional(v.string()),
  rebuildTo: v.optional(v.string())
});

const assignmentTarget = v.object({
  scope: assignmentScope,
  platform: v.string(),
  businessManagerId: v.string(),
  businessManagerName: v.optional(v.string()),
  accountId: v.optional(v.string()),
  accountName: v.optional(v.string())
});

function fundingError(code: string, message: string): ConvexError<{ code: string; message: string }> {
  return new ConvexError({ code, message });
}

function requireServiceToken(serviceToken: string): void {
  const expected = process.env.CONVEX_SERVICE_TOKEN;
  if (!expected || serviceToken !== expected) throw fundingError("UNAUTHORIZED", "Media funding access is unauthorized");
}

function requireIsoDate(value: string, label: string): void {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!isoDatePattern.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw fundingError("INVALID_MEDIA_FUNDING", `${label} must be a valid date`);
  }
}

function requireFeePercent(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value >= 100) {
    throw fundingError("INVALID_MEDIA_FUNDING", "Provider fee must be between 0% and 99.99%");
  }
}

function requireNonNegativeMoney(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000_000) {
    throw fundingError("INVALID_MEDIA_FUNDING", `${label} must be zero or greater`);
  }
}

function cleanNote(value: string | undefined, required = false): string | undefined {
  const note = value?.trim().replace(/\s+/g, " ");
  if (required && !note) throw fundingError("INVALID_MEDIA_FUNDING", "Adjustment note is required");
  if (note && note.length > 500) throw fundingError("INVALID_MEDIA_FUNDING", "Note is too long");
  return note || undefined;
}

function cleanLabel(value: string | undefined): string | undefined {
  const label = value?.trim().replace(/\s+/g, " ");
  if (!label) return undefined;
  if (label.length > 500 || /[\u0000-\u001f\u007f-\u009f]/u.test(label)) {
    throw fundingError("INVALID_MEDIA_FUNDING", "Assignment label is invalid");
  }
  return label;
}

function requireExternalId(value: string, label: string): string {
  const id = value.trim();
  if (!id || id.length > 160 || /[\u0000-\u001f\u007f-\u009f]/u.test(id)) {
    throw fundingError("INVALID_MEDIA_FUNDING", `${label} is invalid`);
  }
  return id;
}

function shiftIsoDate(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function assignmentOverlapsFrom(
  assignment: Pick<Doc<"mediaFundingAssignments">, "effectiveTo">,
  effectiveFrom: string
): boolean {
  return !assignment.effectiveTo || assignment.effectiveTo >= effectiveFrom;
}

function zeroTotals(providerId: Id<"mediaFundingProviders">, updatedAt: string) {
  return {
    providerId,
    currency: mediaFundingCurrency,
    adjustments: 0,
    spend: 0,
    updatedAt
  };
}

async function totalsForProvider(
  ctx: QueryCtx | MutationCtx,
  providerId: Id<"mediaFundingProviders">
): Promise<Doc<"mediaFundingProviderTotals"> | null> {
  return ctx.db
    .query("mediaFundingProviderTotals")
    .withIndex("by_provider", (q) => q.eq("providerId", providerId))
    .unique();
}

async function requireProvider(
  ctx: QueryCtx | MutationCtx,
  providerId: Id<"mediaFundingProviders">
): Promise<Doc<"mediaFundingProviders">> {
  const provider = await ctx.db.get(providerId);
  if (!provider) throw fundingError("MEDIA_FUNDING_NOT_FOUND", "Funding provider was not found");
  return provider;
}

async function companyDirectory(ctx: QueryCtx | MutationCtx): Promise<Doc<"dashboardState">["providers"]> {
  const state = await ctx.db
    .query("dashboardState")
    .withIndex("by_key", (q) => q.eq("key", "default"))
    .unique();
  return state?.providers ?? [];
}

async function requireCompanyProvider(
  ctx: QueryCtx | MutationCtx,
  companyProviderId: string
): Promise<Doc<"dashboardState">["providers"][number]> {
  const id = requireExternalId(companyProviderId, "Company ID");
  const company = (await companyDirectory(ctx)).find((item) => item.id === id);
  if (!company) throw fundingError("MEDIA_FUNDING_NOT_FOUND", "Linked company was not found");
  if (company.type !== "supplier") {
    throw fundingError("INVALID_MEDIA_FUNDING", "Funding providers must be linked to a supplier company");
  }
  return company;
}

async function requireBoundedRows<T>(rows: T[] | Promise<T[]>, maximum: number, message: string): Promise<T[]> {
  const resolved = await rows;
  if (resolved.length > maximum) throw fundingError("MEDIA_FUNDING_LIMIT", message);
  return resolved;
}

async function rebuildRange(
  ctx: QueryCtx | MutationCtx,
  requestedFrom: string
): Promise<{ rebuildFrom?: string; rebuildTo?: string }> {
  const earliestSpend = await ctx.db
    .query("mediaSpendDaily")
    .withIndex("by_date")
    .order("asc")
    .first();
  const sync = await ctx.db
    .query("mediaSpendSyncState")
    .withIndex("by_key", (q) => q.eq("key", "lemonmax"))
    .unique();
  if (!earliestSpend || !sync?.coveredThrough) return {};
  const from = requestedFrom > earliestSpend.date ? requestedFrom : earliestSpend.date;
  if (from > sync.coveredThrough) return {};
  return { rebuildFrom: from, rebuildTo: sync.coveredThrough };
}

async function recalculateProviderTotals(
  ctx: MutationCtx,
  provider: Pick<Doc<"mediaFundingProviders">, "_id" | "openingBalanceDate">,
  updatedAt: string
): Promise<void> {
  const entries = await requireBoundedRows(
    await ctx.db
      .query("mediaFundingEntries")
      .withIndex("by_provider_and_date", (q) => q.eq("providerId", provider._id).gt("date", provider.openingBalanceDate))
      .take(maximumEntries + 1),
    maximumEntries,
    "This provider has too many funding entries to recalculate"
  );
  const days = await requireBoundedRows(
    await ctx.db
      .query("mediaFundingSpendDaily")
      .withIndex("by_provider_and_date", (q) => q.eq("providerId", provider._id).gt("date", provider.openingBalanceDate))
      .take(maximumProviderDays + 1),
    maximumProviderDays,
    "This provider has too many spend days to recalculate"
  );
  const next = zeroTotals(provider._id, updatedAt);
  for (const entry of entries) {
    next.adjustments += entry.netAmount;
  }
  next.spend = days.reduce((total, day) => total + day.spend, 0);
  next.adjustments = roundMediaFundingMoney(next.adjustments);
  next.spend = roundMediaFundingMoney(next.spend);
  const existing = await totalsForProvider(ctx, provider._id);
  if (existing) await ctx.db.replace(existing._id, next);
  else await ctx.db.insert("mediaFundingProviderTotals", next);
}

export const listOverview = query({
  args: { serviceToken: v.string() },
  returns: v.object({
    version: v.literal(1),
    currency: v.string(),
    coveredThrough: v.optional(v.string()),
    providers: v.array(providerResult),
    bankFunding: v.array(bankFundingResult),
    entries: v.array(entryResult),
    assignments: v.array(assignmentResult),
    summary: v.object({
      providers: v.number(),
      grossFunding: v.number(),
      fees: v.number(),
      netFunding: v.number(),
      spend: v.number(),
      estimatedBalance: v.number()
    })
  }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const [providers, entries, assignments, sync, companies, postedFunding, settledFunding] = await Promise.all([
      requireBoundedRows(
        ctx.db.query("mediaFundingProviders").order("desc").take(maximumProviders + 1),
        maximumProviders,
        "There are too many media funding providers"
      ),
      requireBoundedRows(
        ctx.db.query("mediaFundingEntries").order("desc").take(maximumEntries + 1),
        maximumEntries,
        "There are too many media funding adjustments"
      ),
      requireBoundedRows(
        ctx.db.query("mediaFundingAssignments").order("desc").take(maximumAssignments + 1),
        maximumAssignments,
        "There are too many media funding assignments"
      ),
      ctx.db
        .query("mediaSpendSyncState")
        .withIndex("by_key", (q) => q.eq("key", "lemonmax"))
        .unique(),
      companyDirectory(ctx),
      ctx.db
        .query("bankTransactions")
        .withIndex("by_category_direction_status_date_id", (q) =>
          q.eq("category", mediaFundingBankCategory).eq("direction", "out").eq("status", "posted")
        )
        .take(maximumBankFundingTransactions + 1),
      ctx.db
        .query("bankTransactions")
        .withIndex("by_category_direction_status_date_id", (q) =>
          q.eq("category", mediaFundingBankCategory).eq("direction", "out").eq("status", "settled")
        )
        .take(maximumBankFundingTransactions + 1)
    ]);
    const fundingTransactions = await requireBoundedRows(
      [...postedFunding, ...settledFunding],
      maximumBankFundingTransactions,
      "There are too many classified ad account funding transactions"
    );
    const companiesById = new Map(companies.map((company) => [company.id, company]));
    const providerByCompanyId = new Map(providers.map((provider) => [provider.companyProviderId, provider]));
    const activeDate = sync?.coveredThrough ?? new Date().toISOString().slice(0, 10);
    const activeAssignmentCounts = new Map<string, number>();
    for (const assignment of assignments) {
      if (assignment.effectiveFrom <= activeDate && (!assignment.effectiveTo || assignment.effectiveTo >= activeDate)) {
        const key = String(assignment.providerId);
        activeAssignmentCounts.set(key, (activeAssignmentCounts.get(key) ?? 0) + 1);
      }
    }
    const bankFunding = [];
    const bankTotals = new Map<string, {
      count: number;
      excluded: number;
      fees: number;
      gross: number;
      net: number;
    }>();
    for (const transaction of fundingTransactions) {
      if (!transaction.matchedProviderId || transaction.amount <= 0) continue;
      const provider = providerByCompanyId.get(transaction.matchedProviderId);
      if (!provider) continue;
      const key = String(provider._id);
      const totals = bankTotals.get(key) ?? { count: 0, excluded: 0, fees: 0, gross: 0, net: 0 };
      const credit = calculateMediaFundingBankTransactionCredit(transaction, provider);
      if (!credit) continue;
      if (credit.status === "currency_mismatch") {
        totals.excluded += 1;
        bankTotals.set(key, totals);
        continue;
      }
      totals.count += 1;
      totals.gross += transaction.amount;
      totals.fees += credit.feeAmount;
      totals.net += credit.netAmount;
      bankTotals.set(key, totals);
      bankFunding.push({
        id: transaction.id,
        providerId: provider._id,
        companyProviderId: provider.companyProviderId,
        source: transaction.source,
        accountName: transaction.accountName,
        date: transaction.date,
        counterparty: transaction.counterparty,
        description: transaction.description,
        grossAmount: roundMediaFundingMoney(transaction.amount),
        feePercent: provider.defaultFeePercent,
        feeAmount: credit.feeAmount,
        netAmount: credit.netAmount,
        currency: transaction.currency
      });
    }
    const publicProviders = await Promise.all(providers.map(async (provider) => {
      const totals = await totalsForProvider(ctx, provider._id) ?? zeroTotals(provider._id, provider.updatedAt);
      const company = companiesById.get(provider.companyProviderId);
      if (!company || company.type !== "supplier") {
        throw fundingError("MEDIA_FUNDING_STATE", "A funding provider is no longer linked to a supplier company");
      }
      const funding = bankTotals.get(String(provider._id)) ?? { count: 0, excluded: 0, fees: 0, gross: 0, net: 0 };
      const grossFunding = roundMediaFundingMoney(funding.gross);
      const fees = roundMediaFundingMoney(funding.fees);
      const netFunding = roundMediaFundingMoney(funding.net);
      return {
        id: provider._id,
        companyProviderId: provider.companyProviderId,
        name: company.name,
        defaultFeePercent: provider.defaultFeePercent,
        currency: provider.currency,
        openingBalance: provider.openingBalance,
        openingBalanceDate: provider.openingBalanceDate,
        grossFunding,
        fees,
        netFunding,
        adjustments: totals.adjustments,
        spend: totals.spend,
        estimatedBalance: calculateMediaFundingBalance({
          openingBalance: provider.openingBalance,
          netFunding,
          adjustments: totals.adjustments,
          spend: totals.spend
        }),
        assignmentCount: activeAssignmentCounts.get(String(provider._id)) ?? 0,
        bankFundingCount: funding.count,
        excludedFundingCount: funding.excluded,
        createdAt: provider.createdAt,
        updatedAt: provider.updatedAt
      };
    }));
    return {
      version: 1 as const,
      currency: mediaFundingCurrency,
      ...(sync?.coveredThrough ? { coveredThrough: sync.coveredThrough } : {}),
      providers: publicProviders,
      bankFunding: bankFunding.sort((left, right) => right.date.localeCompare(left.date) || left.id.localeCompare(right.id)),
      entries: entries.map((entry) => ({
        id: entry._id,
        providerId: entry.providerId,
        type: entry.type,
        date: entry.date,
        netAmount: entry.netAmount,
        ...(entry.note ? { note: entry.note } : {}),
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt
      })),
      assignments: assignments.map((assignment) => ({
        id: assignment._id,
        providerId: assignment.providerId,
        scope: assignment.scope,
        targetKey: assignment.targetKey,
        businessManagerKey: assignment.businessManagerKey,
        platform: assignment.platform,
        businessManagerId: assignment.businessManagerId,
        ...(assignment.businessManagerName ? { businessManagerName: assignment.businessManagerName } : {}),
        ...(assignment.accountId ? { accountId: assignment.accountId } : {}),
        ...(assignment.accountName ? { accountName: assignment.accountName } : {}),
        effectiveFrom: assignment.effectiveFrom,
        ...(assignment.effectiveTo ? { effectiveTo: assignment.effectiveTo } : {}),
        createdAt: assignment.createdAt,
        updatedAt: assignment.updatedAt
      })),
      summary: {
        providers: publicProviders.length,
        grossFunding: roundMediaFundingMoney(publicProviders.reduce((total, provider) => total + provider.grossFunding, 0)),
        fees: roundMediaFundingMoney(publicProviders.reduce((total, provider) => total + provider.fees, 0)),
        netFunding: roundMediaFundingMoney(publicProviders.reduce((total, provider) => total + provider.netFunding, 0)),
        spend: roundMediaFundingMoney(publicProviders.reduce((total, provider) => total + provider.spend, 0)),
        estimatedBalance: roundMediaFundingMoney(publicProviders.reduce((total, provider) => total + provider.estimatedBalance, 0))
      }
    };
  }
});

export const createProvider = mutation({
  args: {
    serviceToken: v.string(),
    companyProviderId: v.string(),
    defaultFeePercent: v.number(),
    openingBalance: v.number(),
    openingBalanceDate: v.string(),
    createdAt: v.string()
  },
  returns: v.id("mediaFundingProviders"),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const company = await requireCompanyProvider(ctx, args.companyProviderId);
    requireFeePercent(args.defaultFeePercent);
    requireNonNegativeMoney(args.openingBalance, "Opening balance");
    requireIsoDate(args.openingBalanceDate, "Opening balance date");
    if (args.openingBalanceDate > financeOperatingDate()) {
      throw fundingError("INVALID_MEDIA_FUNDING", "Opening balance date cannot be in the future");
    }
    if (Number.isNaN(Date.parse(args.createdAt))) throw fundingError("INVALID_MEDIA_FUNDING", "Creation timestamp is invalid");
    const duplicate = await ctx.db
      .query("mediaFundingProviders")
      .withIndex("by_company_provider_id", (q) => q.eq("companyProviderId", company.id))
      .unique();
    if (duplicate) throw fundingError("MEDIA_FUNDING_CONFLICT", "This supplier company is already a funding provider");
    const providerId = await ctx.db.insert("mediaFundingProviders", {
      companyProviderId: company.id,
      defaultFeePercent: args.defaultFeePercent,
      currency: mediaFundingCurrency,
      openingBalance: roundMediaFundingMoney(args.openingBalance),
      openingBalanceDate: args.openingBalanceDate,
      createdAt: args.createdAt,
      updatedAt: args.createdAt
    });
    await ctx.db.insert("mediaFundingProviderTotals", zeroTotals(providerId, args.createdAt));
    return providerId;
  }
});

export const updateProvider = mutation({
  args: {
    serviceToken: v.string(),
    providerId: v.id("mediaFundingProviders"),
    companyProviderId: v.string(),
    defaultFeePercent: v.number(),
    openingBalance: v.number(),
    openingBalanceDate: v.string(),
    updatedAt: v.string()
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const provider = await requireProvider(ctx, args.providerId);
    const company = await requireCompanyProvider(ctx, args.companyProviderId);
    requireFeePercent(args.defaultFeePercent);
    requireNonNegativeMoney(args.openingBalance, "Opening balance");
    requireIsoDate(args.openingBalanceDate, "Opening balance date");
    if (args.openingBalanceDate > financeOperatingDate()) {
      throw fundingError("INVALID_MEDIA_FUNDING", "Opening balance date cannot be in the future");
    }
    if (Number.isNaN(Date.parse(args.updatedAt))) throw fundingError("INVALID_MEDIA_FUNDING", "Update timestamp is invalid");
    const duplicate = await ctx.db
      .query("mediaFundingProviders")
      .withIndex("by_company_provider_id", (q) => q.eq("companyProviderId", company.id))
      .unique();
    if (duplicate && duplicate._id !== provider._id) {
      throw fundingError("MEDIA_FUNDING_CONFLICT", "This supplier company is already a funding provider");
    }
    const next = {
      companyProviderId: company.id,
      defaultFeePercent: args.defaultFeePercent,
      currency: mediaFundingCurrency,
      openingBalance: roundMediaFundingMoney(args.openingBalance),
      openingBalanceDate: args.openingBalanceDate,
      createdAt: provider.createdAt,
      updatedAt: args.updatedAt
    };
    await ctx.db.replace(provider._id, next);
    await recalculateProviderTotals(ctx, { _id: provider._id, openingBalanceDate: next.openingBalanceDate }, args.updatedAt);
    return null;
  }
});

export const deleteProvider = mutation({
  args: {
    serviceToken: v.string(),
    providerId: v.id("mediaFundingProviders")
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const provider = await requireProvider(ctx, args.providerId);
    const [entry, assignment, spendDay, bankFunding, totals] = await Promise.all([
      ctx.db
        .query("mediaFundingEntries")
        .withIndex("by_provider_and_date", (q) => q.eq("providerId", provider._id))
        .first(),
      ctx.db
        .query("mediaFundingAssignments")
        .withIndex("by_provider_and_effective_from", (q) => q.eq("providerId", provider._id))
        .first(),
      ctx.db
        .query("mediaFundingSpendDaily")
        .withIndex("by_provider_and_date", (q) => q.eq("providerId", provider._id))
        .first(),
      ctx.db
        .query("bankTransactions")
        .withIndex("by_matched_provider_category_date_id", (q) =>
          q.eq("matchedProviderId", provider.companyProviderId).eq("category", mediaFundingBankCategory)
        )
        .first(),
      totalsForProvider(ctx, provider._id)
    ]);
    if (entry || assignment || spendDay || bankFunding) {
      throw fundingError(
        "MEDIA_FUNDING_CONFLICT",
        "Remove this provider's adjustments and assignments, and reclassify its bank funding, before deleting it"
      );
    }
    if (totals) await ctx.db.delete(totals._id);
    await ctx.db.delete(provider._id);
    return null;
  }
});

export const createEntry = mutation({
  args: {
    serviceToken: v.string(),
    providerId: v.id("mediaFundingProviders"),
    type: entryType,
    date: v.string(),
    adjustmentAmount: v.number(),
    note: v.string(),
    createdAt: v.string()
  },
  returns: v.id("mediaFundingEntries"),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const provider = await requireProvider(ctx, args.providerId);
    requireIsoDate(args.date, "Entry date");
    if (args.date <= provider.openingBalanceDate) {
      throw fundingError(
        "INVALID_MEDIA_FUNDING",
        `Entry date must be after the opening balance date (${provider.openingBalanceDate})`
      );
    }
    if (args.date > financeOperatingDate()) {
      throw fundingError("INVALID_MEDIA_FUNDING", "Adjustment date cannot be in the future");
    }
    if (Number.isNaN(Date.parse(args.createdAt))) throw fundingError("INVALID_MEDIA_FUNDING", "Creation timestamp is invalid");
    const note = cleanNote(args.note, true);
    const totals = await totalsForProvider(ctx, provider._id);
    if (!totals) throw fundingError("MEDIA_FUNDING_STATE", "Funding provider totals are missing");
    const adjustmentAmount = args.adjustmentAmount;
    if (!Number.isFinite(adjustmentAmount) || adjustmentAmount === 0 || Math.abs(adjustmentAmount) > 1_000_000_000) {
      throw fundingError("INVALID_MEDIA_FUNDING", "Adjustment amount must be a non-zero number");
    }
    const netAmount = roundMediaFundingMoney(adjustmentAmount);
    const entryId = await ctx.db.insert("mediaFundingEntries", {
      providerId: provider._id,
      type: "adjustment",
      date: args.date,
      netAmount,
      note,
      createdAt: args.createdAt,
      updatedAt: args.createdAt
    });
    await ctx.db.patch(totals._id, {
      adjustments: roundMediaFundingMoney(totals.adjustments + netAmount),
      updatedAt: args.createdAt
    });
    return entryId;
  }
});

export const deleteEntry = mutation({
  args: {
    serviceToken: v.string(),
    entryId: v.id("mediaFundingEntries"),
    updatedAt: v.string()
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const entry = await ctx.db.get(args.entryId);
    if (!entry) throw fundingError("MEDIA_FUNDING_NOT_FOUND", "Funding entry was not found");
    const provider = await requireProvider(ctx, entry.providerId);
    const totals = await totalsForProvider(ctx, provider._id);
    await ctx.db.delete(entry._id);
    if (!totals || entry.date <= provider.openingBalanceDate) return null;
    await ctx.db.patch(totals._id, {
      adjustments: roundMediaFundingMoney(totals.adjustments - entry.netAmount),
      updatedAt: args.updatedAt
    });
    return null;
  }
});

export const providerForCompany = query({
  args: {
    serviceToken: v.string(),
    companyProviderId: v.string()
  },
  returns: v.union(v.null(), v.object({ id: v.id("mediaFundingProviders") })),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const companyProviderId = requireExternalId(args.companyProviderId, "Company ID");
    const provider = await ctx.db
      .query("mediaFundingProviders")
      .withIndex("by_company_provider_id", (q) => q.eq("companyProviderId", companyProviderId))
      .unique();
    return provider ? { id: provider._id } : null;
  }
});

export const assignTargets = mutation({
  args: {
    serviceToken: v.string(),
    providerId: v.id("mediaFundingProviders"),
    effectiveFrom: v.string(),
    targets: v.array(assignmentTarget),
    updatedAt: v.string()
  },
  returns: mutationResult,
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    await requireProvider(ctx, args.providerId);
    requireIsoDate(args.effectiveFrom, "Assignment effective date");
    if (args.targets.length === 0 || args.targets.length > 200) {
      throw fundingError("INVALID_MEDIA_FUNDING", "Select between 1 and 200 funding targets");
    }
    const targetKeys = new Set<string>();
    for (const rawTarget of args.targets) {
      const platform = requireExternalId(rawTarget.platform, "Platform");
      const businessManagerId = requireExternalId(rawTarget.businessManagerId, "Business manager ID");
      const accountId = rawTarget.scope === "ad_account"
        ? requireExternalId(rawTarget.accountId ?? "", "Ad account ID")
        : undefined;
      const target = {
        scope: rawTarget.scope,
        platform,
        businessManagerId,
        ...(cleanLabel(rawTarget.businessManagerName) ? { businessManagerName: cleanLabel(rawTarget.businessManagerName) } : {}),
        ...(accountId ? { accountId } : {}),
        ...(cleanLabel(rawTarget.accountName) ? { accountName: cleanLabel(rawTarget.accountName) } : {})
      };
      const targetKey = mediaFundingTargetKey(target);
      if (targetKeys.has(targetKey)) throw fundingError("INVALID_MEDIA_FUNDING", "Funding targets contain a duplicate");
      targetKeys.add(targetKey);
      const businessManagerKey = mediaFundingBusinessManagerKey(platform, businessManagerId);

      if (target.scope === "ad_account") {
        const parentKey = `business_manager:${businessManagerKey}`;
        const parentAssignments = await requireBoundedRows(
          await ctx.db
            .query("mediaFundingAssignments")
            .withIndex("by_target_and_effective_from", (q) => q.eq("targetKey", parentKey))
            .take(maximumAssignmentsPerTarget + 1),
          maximumAssignmentsPerTarget,
          "This business manager has too much assignment history"
        );
        if (parentAssignments.some((assignment) => assignmentOverlapsFrom(assignment, args.effectiveFrom))) {
          throw fundingError(
            "MEDIA_FUNDING_CONFLICT",
            "This ad account is already controlled by a business manager assignment. Remove the BM assignment first."
          );
        }
      } else {
        const children = await requireBoundedRows(
          await ctx.db
            .query("mediaFundingAssignments")
            .withIndex("by_business_manager_and_effective_from", (q) => q.eq("businessManagerKey", businessManagerKey))
            .take(maximumAssignmentsPerBusinessManager + 1),
          maximumAssignmentsPerBusinessManager,
          "This business manager has too many account assignments"
        );
        if (children.some((assignment) => assignment.scope === "ad_account" && assignmentOverlapsFrom(assignment, args.effectiveFrom))) {
          throw fundingError(
            "MEDIA_FUNDING_CONFLICT",
            "This business manager contains account-level assignments. Remove them before assigning the whole BM."
          );
        }
      }

      const existingTargetAssignments = await requireBoundedRows(
        await ctx.db
          .query("mediaFundingAssignments")
          .withIndex("by_target_and_effective_from", (q) => q.eq("targetKey", targetKey))
          .take(maximumAssignmentsPerTarget + 1),
        maximumAssignmentsPerTarget,
        "This target has too much assignment history"
      );
      for (const existing of existingTargetAssignments) {
        if (!assignmentOverlapsFrom(existing, args.effectiveFrom)) continue;
        if (existing.effectiveFrom >= args.effectiveFrom) {
          await ctx.db.delete(existing._id);
        } else {
          await ctx.db.patch(existing._id, {
            effectiveTo: shiftIsoDate(args.effectiveFrom, -1),
            updatedAt: args.updatedAt
          });
        }
      }
      await ctx.db.insert("mediaFundingAssignments", {
        providerId: args.providerId,
        scope: target.scope,
        targetKey,
        businessManagerKey,
        platform,
        businessManagerId,
        ...(target.businessManagerName ? { businessManagerName: target.businessManagerName } : {}),
        ...(target.accountId ? { accountId: target.accountId } : {}),
        ...(target.accountName ? { accountName: target.accountName } : {}),
        effectiveFrom: args.effectiveFrom,
        createdAt: args.updatedAt,
        updatedAt: args.updatedAt
      });
    }
    return rebuildRange(ctx, args.effectiveFrom);
  }
});

export const deleteAssignment = mutation({
  args: {
    serviceToken: v.string(),
    assignmentId: v.id("mediaFundingAssignments")
  },
  returns: mutationResult,
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const assignment = await ctx.db.get(args.assignmentId);
    if (!assignment) throw fundingError("MEDIA_FUNDING_NOT_FOUND", "Funding assignment was not found");
    await ctx.db.delete(assignment._id);
    return rebuildRange(ctx, assignment.effectiveFrom);
  }
});

export const rebuildDate = mutation({
  args: {
    serviceToken: v.string(),
    date: v.string(),
    updatedAt: v.string()
  },
  returns: v.object({ providers: v.number(), spend: v.number() }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    requireIsoDate(args.date, "Rebuild date");
    const spendRows = await requireBoundedRows(
      await ctx.db
        .query("mediaSpendDaily")
        .withIndex("by_date", (q) => q.eq("date", args.date))
        .take(maximumSpendRowsPerDate + 1),
      maximumSpendRowsPerDate,
      "Media spend day is too large to allocate"
    );
    const assignments = await requireBoundedRows(
      await ctx.db
        .query("mediaFundingAssignments")
        .withIndex("by_effective_from", (q) => q.lte("effectiveFrom", args.date))
        .take(maximumAssignments + 1),
      maximumAssignments,
      "There are too many media funding assignments to allocate"
    );
    const activeAssignments = assignments.filter((assignment) => !assignment.effectiveTo || assignment.effectiveTo >= args.date);
    const accountAssignments = new Map<string, Doc<"mediaFundingAssignments">>();
    const businessManagerAssignments = new Map<string, Doc<"mediaFundingAssignments">>();
    for (const assignment of activeAssignments) {
      const destination = assignment.scope === "ad_account" ? accountAssignments : businessManagerAssignments;
      if (destination.has(assignment.targetKey)) {
        throw fundingError("MEDIA_FUNDING_CONFLICT", "Overlapping funding assignments must be resolved before spend can be allocated");
      }
      destination.set(assignment.targetKey, assignment);
    }

    type Allocation = {
      providerId: Id<"mediaFundingProviders">;
      currency: string;
      spend: number;
      accountIds: Set<string>;
      businessManagerIds: Set<string>;
    };
    const allocations = new Map<string, Allocation>();
    const providerCache = new Map<string, Doc<"mediaFundingProviders">>();
    for (const row of spendRows) {
      const accountTargetKey = `ad_account:${mediaFundingAccountKey(row.platform, row.accountId)}`;
      const businessManagerTargetKey = `business_manager:${mediaFundingBusinessManagerKey(row.platform, row.businessManagerId)}`;
      const assignment = accountAssignments.get(accountTargetKey) ?? businessManagerAssignments.get(businessManagerTargetKey);
      if (!assignment) continue;
      let provider = providerCache.get(String(assignment.providerId));
      if (!provider) {
        provider = await requireProvider(ctx, assignment.providerId);
        providerCache.set(String(provider._id), provider);
      }
      if (provider.currency !== row.currency) {
        throw fundingError(
          "MEDIA_FUNDING_CURRENCY_CONFLICT",
          `The funding provider is ${provider.currency}, but assigned media spend is ${row.currency}`
        );
      }
      const key = `${String(provider._id)}:${row.currency}`;
      const allocation = allocations.get(key) ?? {
        providerId: provider._id,
        currency: row.currency,
        spend: 0,
        accountIds: new Set<string>(),
        businessManagerIds: new Set<string>()
      };
      allocation.spend += row.spend;
      allocation.accountIds.add(`${row.platform}:${row.accountId}`);
      allocation.businessManagerIds.add(`${row.platform}:${row.businessManagerId}`);
      allocations.set(key, allocation);
    }

    const existingRows = await requireBoundedRows(
      await ctx.db
        .query("mediaFundingSpendDaily")
        .withIndex("by_date", (q) => q.eq("date", args.date))
        .take(maximumProviders + 1),
      maximumProviders,
      "There are too many provider summaries for this date"
    );
    const nextRows = new Map([...allocations.values()].map((allocation) => {
      const key = [String(allocation.providerId), args.date, allocation.currency].map(encodeURIComponent).join(":");
      return [key, {
        key,
        providerId: allocation.providerId,
        date: args.date,
        currency: allocation.currency,
        spend: roundMediaFundingMoney(allocation.spend),
        accountCount: allocation.accountIds.size,
        businessManagerCount: allocation.businessManagerIds.size,
        updatedAt: args.updatedAt
      }] as const;
    }));
    const spendDeltas = new Map<string, { providerId: Id<"mediaFundingProviders">; delta: number }>();
    for (const existing of existingRows) {
      spendDeltas.set(String(existing.providerId), {
        providerId: existing.providerId,
        delta: (spendDeltas.get(String(existing.providerId))?.delta ?? 0) - existing.spend
      });
      const next = nextRows.get(existing.key);
      if (next) await ctx.db.replace(existing._id, next);
      else await ctx.db.delete(existing._id);
    }
    const existingKeys = new Set(existingRows.map((row) => row.key));
    for (const next of nextRows.values()) {
      const current = spendDeltas.get(String(next.providerId));
      spendDeltas.set(String(next.providerId), {
        providerId: next.providerId,
        delta: (current?.delta ?? 0) + next.spend
      });
      if (!existingKeys.has(next.key)) await ctx.db.insert("mediaFundingSpendDaily", next);
    }
    for (const { providerId, delta } of spendDeltas.values()) {
      if (Math.abs(delta) < 0.000001) continue;
      const provider = await requireProvider(ctx, providerId);
      if (args.date <= provider.openingBalanceDate) continue;
      const totals = await totalsForProvider(ctx, providerId);
      if (!totals) throw fundingError("MEDIA_FUNDING_STATE", "Funding provider totals are missing");
      await ctx.db.patch(totals._id, {
        spend: roundMediaFundingMoney(totals.spend + delta),
        updatedAt: args.updatedAt
      });
    }
    return {
      providers: nextRows.size,
      spend: roundMediaFundingMoney([...nextRows.values()].reduce((total, row) => total + row.spend, 0))
    };
  }
});
