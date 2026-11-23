import { v } from "convex/values";
import { action, mutation, query } from "../../convex/_generated/server";
import { internal } from "../../convex/_generated/api";

const id = v.id("statementDocuments");

export const configureModel = mutation({
  args: {}, returns: v.null(),
  handler: async ctx => {
    await ctx.db.insert("dashboardState", {
      key: "default", updatedAt: new Date().toISOString(), aiSettings: { provider: "openrouter", model: "local-fixture" },
      providers: [], invoices: [], expenses: [], manualReceivables: [], teams: [], transactionCategoryRules: [],
      revenuePartners: [], wiseCardHolderTeamAssignments: [], wiseStatementImports: [], revenueRuns: [],
      revenueAccruals: [], paymentAllocations: [], holdings: [], fxRates: [], automationRuns: [], profitDistributionAdjustments: []
    });
    return null;
  }
});

export const queuedPdf = mutation({
  args: { storageId: v.id("_storage"), contentHash: v.string(), size: v.number() }, returns: id,
  handler: async (ctx, file) => {
    const timestamp = new Date().toISOString();
    return ctx.db.insert("statementDocuments", {
      ...file, fileName: "retry.pdf", contentType: "application/pdf", origin: "file", documentType: "unknown",
      status: "queued", attempts: 0, quarantined: false, evidence: [], reviewReasons: [], transactionIds: [],
      createdAt: timestamp, updatedAt: timestamp
    });
  }
});

export const snapshot = query({
  args: { id },
  handler: async (ctx, { id }) => {
    const doc = await ctx.db.get(id);
    if (!doc) throw new Error("Missing test statement");
    const jobs = (await ctx.db.system.query("_scheduled_functions").collect())
      .filter(job => job.args[0].id === id)
      .map(job => ({ name: job.name, at: job.scheduledTime, args: job.args[0] }));
    return { status: doc.status, attempts: doc.attempts, token: doc.attemptToken ?? null, until: doc.leaseUntil ?? null, updated: Date.parse(doc.updatedAt), jobs };
  }
});

export const expireHold = mutation({
  args: { id }, returns: v.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { leaseUntil: Date.now() - 1 });
    return null;
  }
});

export const dispatch = action({
  args: { id, scheduledToken: v.optional(v.string()) }, returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.runAction(internal.statementProcessing.processDocument, args);
    return null;
  }
});
