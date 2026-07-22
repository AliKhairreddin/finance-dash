import { mutation, query, type MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { ConvexError, v } from "convex/values";

const importLeaseMs = 15 * 60 * 1000;

const sheetSummary = v.object({
  key: v.string(),
  label: v.string(),
  rowCount: v.number(),
  nonEmptyRowCount: v.number(),
  visibility: v.optional(v.union(v.literal("visible"), v.literal("hidden"))),
  role: v.optional(v.union(v.literal("report"), v.literal("supporting")))
});

const sourceRow = v.object({
  sheetKey: v.string(),
  rowNumber: v.number(),
  cells: v.array(v.string())
});

const performanceFact = v.object({
  factId: v.string(),
  scope: v.string(),
  scopeId: v.string(),
  metric: v.string(),
  period: v.string(),
  value: v.number(),
  valueDecimal: v.optional(v.string()),
  unit: v.union(
    v.literal("currency"),
    v.literal("percent"),
    v.literal("count"),
    v.literal("rate"),
    v.literal("number")
  ),
  currency: v.optional(v.string()),
  scenario: v.optional(v.string()),
  section: v.optional(v.string()),
  dimension: v.optional(v.string()),
  sourceSheet: v.string(),
  sourceRow: v.number(),
  payload: v.optional(v.any())
});

const bankEntry = v.object({
  entryId: v.string(),
  date: v.string(),
  bankName: v.string(),
  segment: v.string(),
  amountUsd: v.number(),
  amountUsdDecimal: v.optional(v.string()),
  sourceRow: v.number(),
  payload: v.any()
});

function requireServiceToken(serviceToken: string): void {
  const expected = process.env.CONVEX_SERVICE_TOKEN;
  if (!expected || serviceToken !== expected) throw new ConvexError({ code: "UNAUTHORIZED" });
}

function requireImportToken(importToken: string): void {
  const expected = process.env.MANAGEMENT_REPORT_IMPORT_TOKEN;
  if (!expected || importToken !== expected) throw new ConvexError({ code: "UNAUTHORIZED_IMPORT" });
}

function leaseExpiry(): string {
  return new Date(Date.now() + importLeaseMs).toISOString();
}

async function requireActiveImport(
  ctx: MutationCtx,
  importId: string,
  attemptId: string
): Promise<Doc<"managementReportImports">> {
  const record = await ctx.db
    .query("managementReportImports")
    .withIndex("by_import_id", (q) => q.eq("importId", importId))
    .unique();
  if (!record) throw new ConvexError({ code: "IMPORT_NOT_FOUND" });
  if (record.status !== "importing" || record.attemptId !== attemptId) {
    throw new ConvexError({ code: "IMPORT_ATTEMPT_MISMATCH" });
  }
  if (record.leaseExpiresAt < new Date().toISOString()) {
    throw new ConvexError({ code: "IMPORT_LEASE_EXPIRED" });
  }
  await ctx.db.patch(record._id, { leaseExpiresAt: leaseExpiry() });
  return record;
}

export const beginImport = mutation({
  args: {
    importToken: v.string(),
    importId: v.string(),
    contentHash: v.string(),
    parserVersion: v.string(),
    attemptId: v.string(),
    sourceName: v.string(),
    sourceUrl: v.optional(v.string()),
    reportingThrough: v.string(),
    importedAt: v.string(),
    sheetSummaries: v.array(sheetSummary)
  },
  returns: v.object({ importId: v.string(), alreadyComplete: v.boolean() }),
  handler: async (ctx, args) => {
    requireImportToken(args.importToken);
    const byHash = await ctx.db
      .query("managementReportImports")
      .withIndex("by_content_hash", (q) => q.eq("contentHash", args.contentHash))
      .first();
    if (byHash?.status === "complete") return { importId: byHash.importId, alreadyComplete: true };

    const now = new Date().toISOString();
    if (byHash?.status === "importing" && byHash.attemptId !== args.attemptId && byHash.leaseExpiresAt >= now) {
      throw new ConvexError({ code: "IMPORT_ALREADY_RUNNING" });
    }

    const existing = byHash ?? await ctx.db
      .query("managementReportImports")
      .withIndex("by_import_id", (q) => q.eq("importId", args.importId))
      .unique();
    if (existing && existing.contentHash !== args.contentHash) {
      throw new ConvexError({ code: "IMPORT_ID_COLLISION" });
    }
    const importId = existing?.importId ?? args.importId;
    const next = {
      importId,
      contentHash: args.contentHash,
      parserVersion: args.parserVersion,
      attemptId: args.attemptId,
      leaseExpiresAt: leaseExpiry(),
      sourceName: args.sourceName,
      sourceUrl: args.sourceUrl,
      reportingThrough: args.reportingThrough,
      importedAt: args.importedAt,
      status: "importing" as const,
      sheetSummaries: args.sheetSummaries,
      sourceRowCount: 0,
      bankEntryCount: 0,
      factCount: 0,
      dashboard: undefined,
      error: undefined
    };
    if (existing) await ctx.db.patch(existing._id, next);
    else await ctx.db.insert("managementReportImports", next);
    return { importId, alreadyComplete: false };
  }
});

export const cleanupImportBatch = mutation({
  args: { importToken: v.string(), importId: v.string(), attemptId: v.string(), batchSize: v.optional(v.number()) },
  returns: v.object({ deleted: v.number(), hasMore: v.boolean() }),
  handler: async (ctx, args) => {
    requireImportToken(args.importToken);
    await requireActiveImport(ctx, args.importId, args.attemptId);
    const batchSize = Math.max(1, Math.min(200, Math.floor(args.batchSize ?? 100)));
    const [rows, facts, bankEntries] = await Promise.all([
      ctx.db.query("managementReportSourceRows").withIndex("by_import", (q) => q.eq("importId", args.importId)).take(batchSize),
      ctx.db.query("managementReportFacts").withIndex("by_import", (q) => q.eq("importId", args.importId)).take(batchSize),
      ctx.db.query("managementReportBankEntries").withIndex("by_import", (q) => q.eq("importId", args.importId)).take(batchSize)
    ]);
    for (const row of [...rows, ...facts, ...bankEntries]) await ctx.db.delete(row._id);
    const deleted = rows.length + facts.length + bankEntries.length;
    return {
      deleted,
      hasMore: rows.length === batchSize || facts.length === batchSize || bankEntries.length === batchSize
    };
  }
});

export const insertSourceRows = mutation({
  args: { importToken: v.string(), importId: v.string(), attemptId: v.string(), rows: v.array(sourceRow) },
  returns: v.object({ inserted: v.number() }),
  handler: async (ctx, args) => {
    requireImportToken(args.importToken);
    const record = await requireActiveImport(ctx, args.importId, args.attemptId);
    for (const row of args.rows) {
      await ctx.db.insert("managementReportSourceRows", { importId: args.importId, ...row });
    }
    await ctx.db.patch(record._id, { sourceRowCount: record.sourceRowCount + args.rows.length });
    return { inserted: args.rows.length };
  }
});

export const insertFacts = mutation({
  args: { importToken: v.string(), importId: v.string(), attemptId: v.string(), facts: v.array(performanceFact) },
  returns: v.object({ inserted: v.number() }),
  handler: async (ctx, args) => {
    requireImportToken(args.importToken);
    const record = await requireActiveImport(ctx, args.importId, args.attemptId);
    for (const fact of args.facts) {
      await ctx.db.insert("managementReportFacts", { importId: args.importId, ...fact });
    }
    await ctx.db.patch(record._id, { factCount: record.factCount + args.facts.length });
    return { inserted: args.facts.length };
  }
});

export const insertBankEntries = mutation({
  args: { importToken: v.string(), importId: v.string(), attemptId: v.string(), entries: v.array(bankEntry) },
  returns: v.object({ inserted: v.number() }),
  handler: async (ctx, args) => {
    requireImportToken(args.importToken);
    const record = await requireActiveImport(ctx, args.importId, args.attemptId);
    for (const entry of args.entries) {
      await ctx.db.insert("managementReportBankEntries", { importId: args.importId, ...entry });
    }
    await ctx.db.patch(record._id, { bankEntryCount: record.bankEntryCount + args.entries.length });
    return { inserted: args.entries.length };
  }
});

export const completeImport = mutation({
  args: {
    importToken: v.string(),
    importId: v.string(),
    attemptId: v.string(),
    sourceRowCount: v.number(),
    bankEntryCount: v.number(),
    factCount: v.number(),
    dashboard: v.any()
  },
  returns: v.object({ importId: v.string(), status: v.literal("complete") }),
  handler: async (ctx, args) => {
    requireImportToken(args.importToken);
    const record = await requireActiveImport(ctx, args.importId, args.attemptId);
    if (
      record.sourceRowCount !== args.sourceRowCount
      || record.bankEntryCount !== args.bankEntryCount
      || record.factCount !== args.factCount
    ) {
      throw new ConvexError({ code: "IMPORT_COUNT_MISMATCH" });
    }
    await ctx.db.patch(record._id, {
      status: "complete",
      dashboard: args.dashboard,
      error: undefined
    });
    return { importId: args.importId, status: "complete" as const };
  }
});

export const failImport = mutation({
  args: { importToken: v.string(), importId: v.string(), attemptId: v.string(), error: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    requireImportToken(args.importToken);
    const record = await ctx.db
      .query("managementReportImports")
      .withIndex("by_import_id", (q) => q.eq("importId", args.importId))
      .unique();
    if (record && record.status === "importing" && record.attemptId === args.attemptId) {
      await ctx.db.patch(record._id, { status: "failed", error: args.error.slice(0, 1000) });
    }
    return null;
  }
});

export const getDashboard = query({
  args: { serviceToken: v.string() },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const record = await ctx.db
      .query("managementReportImports")
      .withIndex("by_status_reporting_through_imported_at", (q) => q.eq("status", "complete"))
      .order("desc")
      .first();
    if (!record?.dashboard) return null;
    return { dashboard: record.dashboard };
  }
});

export const listImports = query({
  args: { serviceToken: v.string(), limit: v.optional(v.number()) },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const limit = Math.max(1, Math.min(50, Math.floor(args.limit ?? 20)));
    const records = await ctx.db.query("managementReportImports").order("desc").take(limit);
    return records.map((record) => ({
      importId: record.importId,
      contentHash: record.contentHash,
      parserVersion: record.parserVersion,
      sourceName: record.sourceName,
      sourceUrl: record.sourceUrl,
      reportingThrough: record.reportingThrough,
      importedAt: record.importedAt,
      status: record.status,
      sheetSummaries: record.sheetSummaries,
      sourceRowCount: record.sourceRowCount,
      bankEntryCount: record.bankEntryCount,
      factCount: record.factCount,
      error: record.error
    }));
  }
});
