import {
  automationRun,
  cashFlowSnapshot,
  dashboardFields,
  invoice,
  providerType,
  transaction,
  transactionCategoryDirection,
  transactionTeamAssignment,
  wiseStatementImport
} from "./dashboardSchema";
import { guardTrackerFinancialState } from "./receivablesCore";
import { canonical } from "../shared/meritReplacement";
import { requireSyncLease } from "./integrationSync";
import { evaluateCashFlowAmount } from "../shared/cashFlow";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { ConvexError, v } from "convex/values";
import {
  initialTransactionCategories,
  isTransactionCategoryColor,
  isTransactionCategoryDirection,
  normalizeTransactionCategoryName,
  sanitizeStoredTransactionCategoryRules
} from "../shared/categories";
import { canonicalTeamId } from "../shared/business";
import type { CashFlowLine } from "../shared/types";
import {
  maximumCashFlowLineIdLength,
  maximumCashFlowLineNameLength,
  maximumCashFlowLineNotesLength,
  maximumCashFlowLinesPerSection,
  maximumCashFlowLinesPerSnapshot,
  maximumCashFlowSnapshotNotesLength,
  maximumCashFlowSnapshots
} from "../shared/cashFlow";
import { financeOperatingDate } from "../shared/operatingDate";
import {
  maximumWiseStatementImportHistory,
  migrateLegacyWiseStatementImports
} from "../shared/wiseEntities";

const transactionCategory = v.object({
  id: v.string(),
  name: v.string(),
  direction: transactionCategoryDirection,
  color: v.string(),
  system: v.boolean(),
  createdAt: v.string(),
  updatedAt: v.string()
});

const cashFlowSnapshotInput = cashFlowSnapshot.omit("id", "createdAt", "updatedAt").extend({ id: v.optional(v.string()) });

function requireServiceToken(serviceToken: string): void {
  const expected = process.env.CONVEX_SERVICE_TOKEN;
  if (!expected || serviceToken !== expected) throw new ConvexError({ code: "UNAUTHORIZED" });
}

function nextUpdatedAt(previous?: string): string {
  const previousTimestamp = previous ? Date.parse(previous) : 0;
  return new Date(Math.max(Date.now(), previousTimestamp + 1)).toISOString();
}

function normalizedCashFlowLine(line: CashFlowLine): CashFlowLine {
  const id = line.id.trim();
  const name = line.name.trim();
  const currency = line.currency.trim().toUpperCase();
  const notes = line.notes?.trim() || undefined;
  if (!id || id.length > maximumCashFlowLineIdLength) {
    throw new ConvexError({ code: "INVALID_CASH_FLOW_LINE_ID" });
  }
  if (!name || name.length > maximumCashFlowLineNameLength) {
    throw new ConvexError({ code: "INVALID_CASH_FLOW_LINE_NAME" });
  }
  if (!Number.isFinite(line.amount) || !/^[A-Z0-9]{2,12}$/.test(currency)) {
    throw new ConvexError({ code: "INVALID_CASH_FLOW_LINE_VALUE" });
  }
  if (notes && notes.length > maximumCashFlowLineNotesLength) {
    throw new ConvexError({ code: "CASH_FLOW_LINE_NOTE_TOO_LONG" });
  }
  if (line.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(line.dueDate)) {
    throw new ConvexError({ code: "INVALID_CASH_FLOW_LINE_DATE" });
  }
  return {
    id,
    name,
    amount: line.formula !== undefined ? evaluateCashFlowAmount(line.formula) : Number(line.amount.toFixed(2)),
    formula: line.formula?.trim() || undefined,
    currency,
    notes,
    dueDate: line.dueDate,
    excludedFromTotals: line.excludedFromTotals || undefined
  };
}

export async function bumpBankLedgerRevision(ctx: MutationCtx, dates: Iterable<string>): Promise<void> {
  const existing = await ctx.db
    .query("bankLedgerRevision")
    .withIndex("by_key", (q) => q.eq("key", "default"))
    .unique();
  const updatedAt = new Date().toISOString();
  const next = {
    key: "default",
    revision: (existing?.revision ?? 0) + 1,
    updatedAt
  };
  if (existing) await ctx.db.patch(existing._id, next);
  else await ctx.db.insert("bankLedgerRevision", next);

  const months = new Set<string>();
  for (const date of dates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new ConvexError({ code: "INVALID_TRANSACTION_DATE" });
    }
    months.add(date.slice(0, 7));
  }
  for (const month of [...months].sort()) {
    const key = `month:${month}`;
    const stored = await ctx.db
      .query("bankLedgerRevision")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    const revision = {
      key,
      revision: (stored?.revision ?? 0) + 1,
      updatedAt
    };
    if (stored) await ctx.db.patch(stored._id, revision);
    else await ctx.db.insert("bankLedgerRevision", revision);
  }
}

const maximumLegacyLedgerMigrationBatchSize = 100;

function isBankTransactionSource(
  source: string
): source is "wise" | "revolut" | "slash" | "amex" | "mercury" | "flex" {
  return source === "wise" || source === "revolut" || source === "slash" || source === "amex" || source === "mercury" || source === "flex";
}

export const disposeOrphanedLegacyTeamAssignments = mutation({
  args: {
    serviceToken: v.string(),
    disposition: v.literal("discard-orphaned-team-assignment"),
    limit: v.optional(v.number())
  },
  returns: v.object({
    disposed: v.number(),
    remainingAssignments: v.number(),
    updatedAt: v.union(v.string(), v.null())
  }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const state = await ctx.db
      .query("dashboardState")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .unique();
    if (!state) return { disposed: 0, remainingAssignments: 0, updatedAt: null };
    if ((state.wiseStatementTransactions?.length ?? 0) > 0) {
      throw new ConvexError({ code: "LEGACY_TRANSACTIONS_NOT_MIGRATED" });
    }
    const assignments = state.transactionTeamAssignments ?? [];
    if (assignments.length === 0) {
      return { disposed: 0, remainingAssignments: 0, updatedAt: state.updatedAt };
    }
    const requestedLimit = args.limit === undefined || !Number.isFinite(args.limit)
      ? maximumLegacyLedgerMigrationBatchSize
      : Math.trunc(args.limit);
    const limit = Math.max(1, Math.min(maximumLegacyLedgerMigrationBatchSize, requestedLimit));
    const retained = [];
    const disposed = [];
    for (const assignment of assignments) {
      if (disposed.length >= limit) {
        retained.push(assignment);
        continue;
      }
      const transaction = await ctx.db
        .query("bankTransactions")
        .withIndex("by_transaction_id", (q) => q.eq("id", assignment.transactionId))
        .unique();
      if (transaction) retained.push(assignment);
      else disposed.push(assignment);
    }
    if (disposed.length === 0) {
      return {
        disposed: 0,
        remainingAssignments: assignments.length,
        updatedAt: state.updatedAt
      };
    }
    const disposedAt = nextUpdatedAt(state.updatedAt);
    for (const assignment of disposed) {
      const key = JSON.stringify([assignment.transactionId, assignment.teamId]);
      const existing = await ctx.db
        .query("bankLegacyReferenceDispositions")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique();
      if (
        existing
        && (
          existing.transactionId !== assignment.transactionId
          || existing.teamId !== assignment.teamId
          || existing.disposition !== args.disposition
        )
      ) {
        throw new ConvexError({ code: "LEGACY_REFERENCE_DISPOSITION_CONFLICT", key });
      }
      if (!existing) {
        await ctx.db.insert("bankLegacyReferenceDispositions", {
          key,
          transactionId: assignment.transactionId,
          teamId: assignment.teamId,
          disposition: args.disposition,
          disposedAt
        });
      }
    }
    await ctx.db.patch(state._id, {
      transactionTeamAssignments: retained.length > 0 ? retained : undefined,
      profitDistributionCache: undefined,
      updatedAt: disposedAt
    });
    return {
      disposed: disposed.length,
      remainingAssignments: retained.length,
      updatedAt: disposedAt
    };
  }
});

export const migrateLegacyLedgerBatch = mutation({
  args: {
    serviceToken: v.string(),
    limit: v.optional(v.number())
  },
  returns: v.object({
    processedTransactions: v.number(),
    insertedTransactions: v.number(),
    updatedTransactions: v.number(),
    appliedTeamAssignments: v.number(),
    orphanedTeamAssignments: v.number(),
    remainingTransactions: v.number(),
    remainingTeamAssignments: v.number(),
    isDone: v.boolean(),
    updatedAt: v.union(v.string(), v.null())
  }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const state = await ctx.db
      .query("dashboardState")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .unique();
    if (!state) {
      return {
        processedTransactions: 0,
        insertedTransactions: 0,
        updatedTransactions: 0,
        appliedTeamAssignments: 0,
        orphanedTeamAssignments: 0,
        remainingTransactions: 0,
        remainingTeamAssignments: 0,
        isDone: true,
        updatedAt: null
      };
    }

    const hasLegacyTransactionField = state.wiseStatementTransactions !== undefined;
    const hasLegacyAssignmentField = state.transactionTeamAssignments !== undefined;
    if (!hasLegacyTransactionField && !hasLegacyAssignmentField) {
      return {
        processedTransactions: 0,
        insertedTransactions: 0,
        updatedTransactions: 0,
        appliedTeamAssignments: 0,
        orphanedTeamAssignments: 0,
        remainingTransactions: 0,
        remainingTeamAssignments: 0,
        isDone: true,
        updatedAt: state.updatedAt
      };
    }

    const requestedLimit = args.limit === undefined || !Number.isFinite(args.limit)
      ? maximumLegacyLedgerMigrationBatchSize
      : Math.trunc(args.limit);
    const limit = Math.max(1, Math.min(maximumLegacyLedgerMigrationBatchSize, requestedLimit));
    const legacyTransactions = state.wiseStatementTransactions ?? [];
    const transactionBatch = legacyTransactions.slice(0, limit);
    const remainingTransactions = legacyTransactions.slice(transactionBatch.length);
    const legacyAssignments = state.transactionTeamAssignments ?? [];
    const assignmentByTransactionId = new Map(
      legacyAssignments.map((assignment) => [assignment.transactionId, assignment])
    );
    const processedTransactionIds = new Set(transactionBatch.map((item) => item.id));
    let remainingAssignments = legacyAssignments.filter(
      (assignment) => !processedTransactionIds.has(assignment.transactionId)
    );
    let insertedTransactions = 0;
    let updatedTransactions = 0;
    let appliedTeamAssignments = 0;
    let orphanedTeamAssignments = 0;
    const analyticsChangedDates = new Set<string>();
    const syncedAt = nextUpdatedAt(state.updatedAt);

    for (const legacyTransaction of transactionBatch) {
      analyticsChangedDates.add(legacyTransaction.date);
      if (!isBankTransactionSource(legacyTransaction.source)) {
        throw new ConvexError({
          code: "INVALID_LEGACY_BANK_SOURCE",
          transactionId: legacyTransaction.id,
          source: legacyTransaction.source
        });
      }
      const source = legacyTransaction.source;
      const legacyAssignment = assignmentByTransactionId.get(legacyTransaction.id);
      const assignedTeamId = legacyAssignment
        ? canonicalTeamId(legacyAssignment.teamId)
        : legacyTransaction.teamId
          ? canonicalTeamId(legacyTransaction.teamId)
          : undefined;
      const existing = await ctx.db
        .query("bankTransactions")
        .withIndex("by_transaction_id", (q) => q.eq("id", legacyTransaction.id))
        .unique();
      if (existing && existing.source !== source) {
        throw new ConvexError({
          code: "LEGACY_TRANSACTION_SOURCE_CONFLICT",
          transactionId: legacyTransaction.id,
          legacySource: source,
          storedSource: existing.source
        });
      }

      if (existing) {
        if (existing.profitContributionVersion !== undefined) {
          throw new ConvexError({
            code: "LEGACY_MIGRATION_VERSIONED_CONFLICT",
            transactionId: legacyTransaction.id
          });
        }
        await ctx.db.patch(existing._id, {
          ...legacyTransaction,
          source,
          category: existing.category,
          merchantName: existing.merchantName ?? legacyTransaction.merchantName,
          merchantKey: existing.merchantKey ?? legacyTransaction.merchantKey,
          classificationComplete: existing.classificationComplete ?? legacyTransaction.classificationComplete,
          categorySource: existing.categorySource ?? legacyTransaction.categorySource,
          categoryConfidence: existing.categoryConfidence ?? legacyTransaction.categoryConfidence,
          categoryReason: existing.categoryReason ?? legacyTransaction.categoryReason,
          matchedProviderId: existing.matchedProviderId ?? legacyTransaction.matchedProviderId,
          companyMatchSource: existing.companyMatchSource ?? legacyTransaction.companyMatchSource,
          companyConfidence: existing.companyConfidence ?? legacyTransaction.companyConfidence,
          companyMatchReason: existing.companyMatchReason ?? legacyTransaction.companyMatchReason,
          matchedInvoiceId: existing.matchedInvoiceId ?? legacyTransaction.matchedInvoiceId,
          teamId: existing.teamId ?? assignedTeamId,
          confidence: existing.confidence ?? legacyTransaction.confidence,
          matchReason: existing.matchReason ?? legacyTransaction.matchReason,
          syncedAt
        });
        updatedTransactions += 1;
      } else {
        await ctx.db.insert("bankTransactions", {
          ...legacyTransaction,
          source,
          ...(assignedTeamId ? { teamId: assignedTeamId } : {}),
          syncedAt
        });
        insertedTransactions += 1;
      }
      if (legacyAssignment) appliedTeamAssignments += 1;
    }

    if (transactionBatch.length === 0 && remainingAssignments.length > 0) {
      const assignmentBatch = remainingAssignments.slice(0, limit);
      remainingAssignments = remainingAssignments.slice(assignmentBatch.length);
      for (const assignment of assignmentBatch) {
        const existing = await ctx.db
          .query("bankTransactions")
          .withIndex("by_transaction_id", (q) => q.eq("id", assignment.transactionId))
          .unique();
        if (!existing) {
          throw new ConvexError({
            code: "ORPHANED_LEGACY_TEAM_ASSIGNMENT",
            transactionId: assignment.transactionId,
            teamId: assignment.teamId
          });
        }
        await ctx.db.patch(existing._id, { teamId: canonicalTeamId(assignment.teamId) });
        analyticsChangedDates.add(existing.date);
        appliedTeamAssignments += 1;
      }
    }

    const isDone = remainingTransactions.length === 0 && remainingAssignments.length === 0;
    await ctx.db.patch(state._id, {
      wiseStatementTransactions: remainingTransactions.length > 0 ? remainingTransactions : undefined,
      transactionTeamAssignments: remainingAssignments.length > 0 ? remainingAssignments : undefined,
      profitDistributionCache: undefined,
      updatedAt: syncedAt
    });
    if (analyticsChangedDates.size > 0) {
      await bumpBankLedgerRevision(ctx, analyticsChangedDates);
    }
    return {
      processedTransactions: transactionBatch.length,
      insertedTransactions,
      updatedTransactions,
      appliedTeamAssignments,
      orphanedTeamAssignments,
      remainingTransactions: remainingTransactions.length,
      remainingTeamAssignments: remainingAssignments.length,
      isDone,
      updatedAt: syncedAt
    };
  }
});

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

export const getAnalyticsDirectory = query({
  args: { serviceToken: v.string() },
  returns: v.object({
    providers: v.array(v.object({
      id: v.string(),
      name: v.string(),
      legalName: v.optional(v.string()),
      aliases: v.array(v.string()),
      type: providerType
    })),
    teams: v.array(v.object({
      id: v.string(),
      name: v.string()
    })),
    transactionCategories: v.array(transactionCategory),
    documentedTransactionIds: v.array(v.string())
  }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const state = await ctx.db
      .query("dashboardState")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .unique();
    return {
      providers: (state?.providers ?? []).map(({ id, name, legalName, aliases, type }) => ({
        id,
        name,
        legalName,
        aliases,
        type
      })),
      teams: (state?.teams ?? []).map(({ id, name }) => ({ id, name })),
      transactionCategories: await listTransactionCategories(ctx),
      documentedTransactionIds: (state?.expenses ?? []).flatMap((expense) =>
        expense.transactionId ? [expense.transactionId] : []
      )
    };
  }
});

export const getSavedFxRates = query({
  args: { serviceToken: v.string() }, returns: dashboardFields.fxRates,
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const state = await ctx.db.query("dashboardState").withIndex("by_key", q => q.eq("key", "default")).unique();
    return state?.fxRates ?? [];
  }
});

export const getState = query({
  args: { serviceToken: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      ...dashboardFields,
      transactionCategories: v.array(transactionCategory),
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
      wiseCardHolderTeamAssignments: state.wiseCardHolderTeamAssignments,
      wiseStatementImports: state.wiseStatementImports,
      revenueRuns: state.revenueRuns,
      revenueAccruals: state.revenueAccruals,
      paymentAllocations: state.paymentAllocations,
      holdings: state.holdings,
      fxRates: state.fxRates,
      fxTrackedAssets: state.fxTrackedAssets,
      automationRuns: state.automationRuns,
      profitDistributionAdjustments: state.profitDistributionAdjustments,
      profitDistributionCache: state.profitDistributionCache,
      meritTaxes: state.meritTaxes,
      aiSettings: state.aiSettings,
      cashFlowSnapshots: state.cashFlowSnapshots,
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
    const renamedCategories = new Map<string, string>();
    for (const category of initialTransactionCategories) {
      const existing = await ctx.db
        .query("transactionCategories")
        .withIndex("by_category_id", (q) => q.eq("id", category.id))
        .unique();
      if (!existing) {
        await ctx.db.insert("transactionCategories", {
          ...category,
          nameNormalized: category.name.toLowerCase(),
          createdAt: now,
          updatedAt: now
        });
        continue;
      }
      if (
        existing.name === category.name
        && existing.direction === category.direction
        && existing.system === category.system
      ) {
        continue;
      }
      const duplicate = await ctx.db
        .query("transactionCategories")
        .withIndex("by_name_normalized", (q) => q.eq("nameNormalized", category.name.toLowerCase()))
        .unique();
      if (duplicate && duplicate._id !== existing._id) {
        throw new ConvexError({
          code: "CATEGORY_EXISTS",
          message: `The built-in category ${category.name} conflicts with an existing category`
        });
      }
      if (existing.name !== category.name) renamedCategories.set(existing.name, category.name);
      await ctx.db.patch(existing._id, {
        name: category.name,
        nameNormalized: category.name.toLowerCase(),
        direction: category.direction,
        system: category.system,
        updatedAt: now
      });
    }
    if (renamedCategories.size > 0) {
      const state = await ctx.db.query("dashboardState").withIndex("by_key", (q) => q.eq("key", "default")).unique();
      if (state) {
        const renamedCategory = (category: string) => renamedCategories.get(category) ?? category;
        await ctx.db.patch(state._id, {
          expenses: state.expenses.map((expense) => ({
            ...expense,
            category: renamedCategory(expense.category)
          })),
          transactionCategoryRules: state.transactionCategoryRules.map((rule) => ({
            ...rule,
            category: renamedCategory(rule.category)
          })),
          revenuePartners: state.revenuePartners.map((partner) => ({
            ...partner,
            revenueCategory: partner.revenueCategory
              ? renamedCategory(partner.revenueCategory)
              : undefined
          })),
          updatedAt: nextUpdatedAt(state.updatedAt)
        });
      }
    }
    return listTransactionCategories(ctx);
  }
});

export const repairGenericTransactionCategoryAliases = mutation({
  args: { serviceToken: v.string() },
  returns: v.object({ removedAliases: v.number(), updatedAt: v.union(v.string(), v.null()) }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const state = await ctx.db.query("dashboardState").withIndex("by_key", (q) => q.eq("key", "default")).unique();
    if (!state) return { removedAliases: 0, updatedAt: null };

    const transactionCategoryRules = sanitizeStoredTransactionCategoryRules(state.transactionCategoryRules);
    const previousAliasCount = state.transactionCategoryRules.reduce((total, rule) => total + rule.aliases.length, 0);
    const nextAliasCount = transactionCategoryRules.reduce((total, rule) => total + rule.aliases.length, 0);
    const removedAliases = previousAliasCount - nextAliasCount;
    if (removedAliases === 0) return { removedAliases: 0, updatedAt: state.updatedAt };

    const updatedAt = nextUpdatedAt(state.updatedAt);
    await ctx.db.patch(state._id, { transactionCategoryRules, updatedAt });
    return { removedAliases, updatedAt };
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
      ? state.transactionCategoryRules.filter((rule) => rule.category === category.name).length
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
    syncLease: v.optional(v.object({ key: v.string(), leaseId: v.string() })),
    ...dashboardFields,
    transactionTeamAssignments: v.optional(v.array(transactionTeamAssignment)),
    wiseStatementTransactions: v.optional(v.array(transaction.omit("accountId", "mercuryEntity", "slashEntity"))),
    serviceToken: v.string(),
    expectedUpdatedAt: v.union(v.string(), v.null())
  },
  returns: v.object({ updatedAt: v.string() }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    if (args.syncLease) await requireSyncLease(ctx, args.syncLease.key, args.syncLease.leaseId);
    const existing = await ctx.db.query("dashboardState").withIndex("by_key", (q) => q.eq("key", "default")).unique();
    if ((existing?.updatedAt ?? null) !== args.expectedUpdatedAt) throw new ConvexError({ code: "STATE_CONFLICT" });
    for (const locked of existing?.invoices.filter(i => i.meritReplacementId) ?? []) {
      if (canonical(args.invoices.find(i => i.id === locked.id)) !== canonical(locked)
        || args.invoices.some(i => i.id !== locked.id && i.invoiceNumber === locked.invoiceNumber && i.externalId)
        || canonical(args.paymentAllocations.filter(a => a.invoiceId === locked.id)) !== canonical(existing!.paymentAllocations.filter(a => a.invoiceId === locked.id))) {
        throw new ConvexError("An invoice replacement is pending; check its status before changing this invoice or its payments");
      }
    }
    if (args.transactionTeamAssignments !== undefined || args.wiseStatementTransactions !== undefined) {
      throw new ConvexError({ code: "LEDGER_MIGRATION_IN_PROGRESS" });
    }
    if (args.wiseStatementImports.length > maximumWiseStatementImportHistory) {
      throw new ConvexError({
        code: "WISE_IMPORT_HISTORY_LIMIT",
        limit: maximumWiseStatementImportHistory
      });
    }

    await guardTrackerFinancialState(ctx, existing, args.invoices, args.paymentAllocations, args.manualReceivables);
    const updatedAt = nextUpdatedAt(existing?.updatedAt);
    const dashboardState = {
      providers: args.providers,
      invoices: args.invoices,
      expenses: args.expenses,
      manualReceivables: args.manualReceivables,
      teams: args.teams,
      transactionCategoryRules: args.transactionCategoryRules,
      revenuePartners: args.revenuePartners,
      wiseCardHolderTeamAssignments: args.wiseCardHolderTeamAssignments,
      wiseStatementImports: args.wiseStatementImports,
      revenueRuns: args.revenueRuns,
      revenueAccruals: args.revenueAccruals,
      paymentAllocations: args.paymentAllocations,
      holdings: args.holdings,
      fxRates: args.fxRates,
      fxTrackedAssets: args.fxTrackedAssets ?? existing?.fxTrackedAssets ?? [],
      automationRuns: args.automationRuns,
      profitDistributionAdjustments: args.profitDistributionAdjustments,
      profitDistributionCache: args.profitDistributionCache,
      meritTaxes: args.meritTaxes ?? existing?.meritTaxes ?? [],
      aiSettings: args.aiSettings,
      cashFlowSnapshots: args.cashFlowSnapshots ?? existing?.cashFlowSnapshots ?? [],
      updatedAt
    };
    if (existing) await ctx.db.patch(existing._id, dashboardState);
    else await ctx.db.insert("dashboardState", { key: "default", ...dashboardState });
    return { updatedAt };
  }
});

export const upsertCashFlowSnapshot = mutation({
  args: {
    serviceToken: v.string(),
    snapshot: cashFlowSnapshotInput
  },
  returns: cashFlowSnapshot,
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.snapshot.asOfDate) || args.snapshot.asOfDate > financeOperatingDate()) {
      throw new ConvexError({ code: "INVALID_CASH_FLOW_DATE" });
    }
    const sections = [
      args.snapshot.cashAccounts,
      args.snapshot.receivables,
      args.snapshot.openBalances,
      args.snapshot.payables,
      args.snapshot.investments
    ];
    if (sections.some((lines) => lines.length > maximumCashFlowLinesPerSection)) {
      throw new ConvexError({ code: "CASH_FLOW_SECTION_LIMIT" });
    }
    if (sections.reduce((total, lines) => total + lines.length, 0) > maximumCashFlowLinesPerSnapshot) {
      throw new ConvexError({ code: "CASH_FLOW_SNAPSHOT_LIMIT" });
    }
    const notes = args.snapshot.notes?.trim() || undefined;
    if (notes && notes.length > maximumCashFlowSnapshotNotesLength) {
      throw new ConvexError({ code: "CASH_FLOW_SNAPSHOT_NOTE_TOO_LONG" });
    }
    const growthValues = [
      args.snapshot.cashGrowthPercent,
      args.snapshot.spendGrowthPercent,
      args.snapshot.profitGrowthPercent
    ];
    if (growthValues.some((value) => value !== undefined && !Number.isFinite(value))) {
      throw new ConvexError({ code: "INVALID_CASH_FLOW_GROWTH" });
    }
    const state = await ctx.db
      .query("dashboardState")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .unique();
    if (!state) throw new ConvexError({ code: "DASHBOARD_STATE_MISSING" });
    const existing = (state.cashFlowSnapshots ?? []).find((snapshot) =>
      snapshot.id === args.snapshot.id || snapshot.asOfDate === args.snapshot.asOfDate
    );
    const updatedAt = nextUpdatedAt(state.updatedAt);
    const snapshot = {
      id: existing?.id ?? args.snapshot.id ?? `cash-flow-${args.snapshot.asOfDate}`,
      asOfDate: args.snapshot.asOfDate,
      cashAccounts: args.snapshot.cashAccounts.map(normalizedCashFlowLine),
      receivables: args.snapshot.receivables.map(normalizedCashFlowLine),
      openBalances: args.snapshot.openBalances.map(normalizedCashFlowLine),
      payables: args.snapshot.payables.map(normalizedCashFlowLine),
      investments: args.snapshot.investments.map(normalizedCashFlowLine),
      cashGrowthPercent: args.snapshot.cashGrowthPercent,
      spendGrowthPercent: args.snapshot.spendGrowthPercent,
      profitGrowthPercent: args.snapshot.profitGrowthPercent,
      notes,
      createdAt: existing?.createdAt ?? updatedAt,
      updatedAt
    };
    const cashFlowSnapshots = [
      snapshot,
      ...(state.cashFlowSnapshots ?? []).filter((item) => item.id !== snapshot.id)
    ]
      .sort((left, right) => right.asOfDate.localeCompare(left.asOfDate))
      .slice(0, maximumCashFlowSnapshots);
    await ctx.db.patch(state._id, { cashFlowSnapshots, updatedAt });
    return snapshot;
  }
});

export const recordWiseStatementImport = mutation({
  args: {
    serviceToken: v.string(),
    importRecord: wiseStatementImport
  },
  returns: v.object({ updatedAt: v.string() }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const state = await ctx.db
      .query("dashboardState")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .unique();
    if (!state) throw new ConvexError({ code: "DASHBOARD_STATE_MISSING" });
    const wiseStatementImports = migrateLegacyWiseStatementImports([
      args.importRecord,
      ...state.wiseStatementImports.filter((item) => item.id !== args.importRecord.id)
    ]);
    const updatedAt = nextUpdatedAt(state.updatedAt);
    await ctx.db.patch(state._id, { wiseStatementImports, updatedAt });
    return { updatedAt };
  }
});

export const clearLegacyLedgerState = mutation({
  args: {
    serviceToken: v.string(),
    expectedUpdatedAt: v.string()
  },
  returns: v.object({
    clearedTransactions: v.number(),
    clearedTeamAssignments: v.number(),
    updatedAt: v.string()
  }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const state = await ctx.db
      .query("dashboardState")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .unique();
    if (!state) throw new ConvexError({ code: "STATE_NOT_FOUND" });
    if (state.updatedAt !== args.expectedUpdatedAt) throw new ConvexError({ code: "STATE_CONFLICT" });
    const updatedAt = nextUpdatedAt(state.updatedAt);
    const clearedTransactions = state.wiseStatementTransactions?.length ?? 0;
    const clearedTeamAssignments = state.transactionTeamAssignments?.length ?? 0;
    await ctx.db.patch(state._id, {
      wiseStatementTransactions: undefined,
      transactionTeamAssignments: undefined,
      updatedAt
    });
    return { clearedTransactions, clearedTeamAssignments, updatedAt };
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
      transactions: 0,
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
    const deletedTransactions = 0;
    const deletedImports = state.wiseStatementImports.length;
    const updatedAt = nextUpdatedAt(state.updatedAt);
    await ctx.db.patch(state._id, {
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
    if (current.meritReplacementId) throw new ConvexError("Invoice replacement pending");
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
