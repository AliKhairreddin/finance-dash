import { v, ConvexError } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  query,
  mutation,
  internalMutation,
  internalQuery,
  internalAction,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { StatementRow } from "../shared/statements";
import {
  merchantKey,
  validateMerchantSuggestion,
} from "../shared/statementIntelligence";
import { statementMember, requireScope, canReadScope } from "./statementAccess";
import { readBoundedResponseJson } from "../shared/boundedHttp";
export async function enqueueMerchant(ctx: MutationCtx, row: StatementRow, dryRun = false) {
  if (!row.companyId || !row.counterparty?.trim() || row.counterparty.length > 250) return false;
  const key = merchantKey(row.counterparty);
  const existing = await ctx.db
    .query("statementMerchants")
    .withIndex("by_scope_key", (q) =>
      q
        .eq("companyId", row.companyId!)
        .eq("financialAccountId", row.financialAccountId)
        .eq("key", key),
    )
    .unique();
  if (existing) return false; // Refresh is explicit; approved values cannot be replaced by imports.
  const contacts = (
    await Promise.all(
      [row.companyId, "all" as const].map((companyId) =>
        ctx.db
          .query("statementAddresses")
          .withIndex("by_companyId", (q) => q.eq("companyId", companyId))
          .take(500),
      ),
    )
  ).flat();
  const approvedContact = contacts.find(
    (c) =>
      (!c.financialAccountId ||
        c.financialAccountId === row.financialAccountId) &&
      !c.reviewNote &&
      c.addressLine1 &&
      [c.name, ...(c.aliases ?? [])].some((n) => merchantKey(n) === key),
  );
  const peers = await ctx.db
    .query("statementMerchants")
    .withIndex("by_company", (q) => q.eq("companyId", row.companyId!))
    .take(500);
  if (
    peers.some(
      (p) =>
        p.financialAccountId === row.financialAccountId &&
        p.approvedJson &&
        p.aliases.some((a) => merchantKey(a) === key),
    )
  )
    return false;
  // Approved contacts remain authoritative; research may fill website/category gaps as suggestions.
  void approvedContact;
  if (dryRun) return true;
  await ctx.db.insert("statementMerchants", {
    companyId: row.companyId,
    financialAccountId: row.financialAccountId,
    key,
    name: row.counterparty,
    aliases: [],
    status: "queued",
    attempts: 0,
    nextAttemptAt: Date.now(),
    leaseUntil: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  return true;
}

// Activation can enqueue historical merchants without editing any financial records.
export const enqueueExisting = internalMutation({
  args: { paginationOpts: paginationOptsValidator, dryRun: v.boolean() },
  returns: v.object({ scanned: v.number(), queued: v.number(), skipped: v.number(), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, args) => {
    const page = await ctx.db.query("statementTransactions").paginate({ ...args.paginationOpts, numItems: Math.min(100, args.paginationOpts.numItems) });
    let queued = 0;
    const seen = new Set<string>();
    for (const row of page.page) {
      const key = JSON.stringify([row.companyId, row.financialAccountId, merchantKey(row.counterparty ?? "")]);
      if (row.deletedAt || seen.has(key)) continue;
      seen.add(key);
      if (await enqueueMerchant(ctx, row, args.dryRun)) queued++;
    }
    return { scanned: page.page.length, queued, skipped: page.page.length - queued, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

export const researchJob = query({
  args: { serviceToken: v.string(), id: v.id("statementMerchants"), token: v.string() },
  returns: v.object({ name: v.string(), model: v.string() }),
  handler: async (ctx, args) => {
    if (!process.env.CONVEX_SERVICE_TOKEN || args.serviceToken !== process.env.CONVEX_SERVICE_TOKEN) throw new ConvexError("Unauthorized");
    const row = await ctx.db.get(args.id);
    if (!row || row.status !== "researching" || row.leaseToken !== args.token || row.leaseUntil <= Date.now()) throw new ConvexError("Research lease is unavailable");
    const settings = (await ctx.db.query("dashboardState").first())?.aiSettings;
    if (settings?.provider !== "openrouter" || !settings.model) throw new ConvexError("Select the statement AI model in Settings");
    return { name: row.name, model: settings.model };
  },
});
const auth = { serviceToken: v.string(), actor: v.string() };
export const list = query({
  args: auth,
  returns: v.string(),
  handler: async (ctx, args) => {
    const member = await statementMember(ctx, args, "contacts");
    const rows = (
      await Promise.all(
        member.companyIds.map((companyId) =>
          ctx.db
            .query("statementMerchants")
            .withIndex("by_company", (q) => q.eq("companyId", companyId))
            .take(500),
        ),
      )
    ).flat();
    return JSON.stringify(
      rows
        .filter((r) => canReadScope(member, r))
        .map(({ leaseToken: _token, ...row }) => row),
    );
  },
});
export const review = mutation({
  args: {
    ...auth,
    id: v.id("statementMerchants"),
    decision: v.union(
      v.literal("approve"),
      v.literal("discard"),
      v.literal("research"),
    ),
    approvedJson: v.optional(v.string()),
    aliases: v.optional(v.array(v.string())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const member = await statementMember(ctx, args, "contacts"),
      row = await ctx.db.get(args.id);
    if (!row) throw new ConvexError("Merchant not found");
    requireScope(member, row);
    if (args.decision === "research") {
      if (
        row.leaseUntil > Date.now() ||
        (row.researchedAt && Date.now() - row.researchedAt < 60000)
      )
        throw new ConvexError(
          "Research is already running or was requested recently",
        );
      await ctx.db.patch(row._id, {
        status: "queued",
        attempts: 0,
        nextAttemptAt: Date.now(),
        error: undefined,
      });
    } else if (args.decision === "discard")
      await ctx.db.patch(row._id, {
        status: row.approvedJson ? "approved" : "discarded",
        suggestionJson: undefined,
        nextAttemptAt: Date.now() + 30 * 86400000,
      });
    else {
      const suggestion = JSON.parse(row.suggestionJson ?? "{}");
      const approved = validateMerchantSuggestion(
        JSON.parse(args.approvedJson ?? row.suggestionJson ?? "{}"),
        suggestion.sources ?? [],
      );
      if (
        args.aliases?.some((a) => a.length > 250) ||
        (args.aliases?.length ?? 0) > 50
      )
        throw new ConvexError("Too many merchant aliases");
      await ctx.db.patch(row._id, {
        status: "approved",
        approvedJson: JSON.stringify(approved),
        aliases: args.aliases ?? row.aliases,
        approvedAt: Date.now(),
        approvedBy: member.actor,
        updatedAt: Date.now(),
        nextAttemptAt: Date.now() + 30 * 86400000,
      });
    }
    await ctx.db.insert("statementAudit", {
      entityType: "merchant",
      entityId: row._id,
      actor: member.actor,
      action: `research_${args.decision}`,
      details:
        args.decision === "approve"
          ? (args.approvedJson ?? row.suggestionJson ?? "")
          : "",
      createdAt: new Date().toISOString(),
    });
    return null;
  },
});
export const due = internalQuery({
  args: {},
  returns: v.array(v.id("statementMerchants")),
  handler: async (ctx) => {
    const rows = (
      await Promise.all(
        (
          ["queued", "failed", "researching", "approved", "suggested"] as const
        ).map((status) =>
          ctx.db
            .query("statementMerchants")
            .withIndex("by_status_next", (q) =>
              q.eq("status", status).lte("nextAttemptAt", Date.now()),
            )
            .take(10),
        ),
      )
    ).flat();
    return rows
      .filter((r) => r.attempts < 5 && r.leaseUntil <= Date.now())
      .slice(0, 3)
      .map((r) => r._id);
  },
});
export const claim = internalMutation({
  args: { id: v.id("statementMerchants"), token: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (
      !row ||
      !["queued", "failed", "researching", "approved", "suggested"].includes(
        row.status,
      ) ||
      row.leaseUntil > Date.now() ||
      row.attempts >= 5 ||
      row.nextAttemptAt > Date.now()
    )
      return null;
    await ctx.db.patch(row._id, {
      status: "researching",
      leaseToken: args.token,
      leaseUntil: Date.now() + 180000,
      attempts: row.attempts + 1,
    });
    return JSON.stringify(row);
  },
});
export const finish = internalMutation({
  args: {
    id: v.id("statementMerchants"),
    token: v.string(),
    suggestionJson: v.optional(v.string()),
    sources: v.array(v.string()),
    error: v.optional(v.string()),
    blocked: v.optional(v.boolean()),
    retryAfter: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row || row.leaseToken !== args.token) return null;
    const suggestion = args.suggestionJson
      ? validateMerchantSuggestion(
          JSON.parse(args.suggestionJson),
          args.sources,
        )
      : undefined;
    await ctx.db.patch(row._id, {
      status: suggestion ? "suggested" : args.blocked ? "blocked" : "failed",
      suggestionJson: suggestion
        ? JSON.stringify(suggestion)
        : row.suggestionJson,
      error: args.error?.slice(0, 500),
      researchedAt: suggestion ? Date.now() : row.researchedAt,
      attempts: suggestion ? 0 : row.attempts,
      leaseUntil: 0,
      leaseToken: undefined,
      nextAttemptAt:
        Date.now() +
        (suggestion || args.blocked
          ? 30 * 86400000
          : Math.max(args.retryAfter ?? 0, 60000 * 2 ** row.attempts)),
      updatedAt: Date.now(),
    });
    return null;
  },
});
export const pump = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    for (const id of await ctx.runQuery(internal.statementIntelligence.due, {}))
      await ctx.scheduler.runAfter(0, internal.statementIntelligence.research, {
        id,
      });
    return null;
  },
});
export const research = internalAction({
  args: { id: v.id("statementMerchants") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const token = crypto.randomUUID(),
      claimed = await ctx.runMutation(internal.statementIntelligence.claim, {
        ...args,
        token,
      });
    if (!claimed) return null;
    try {
      const target = await ctx.runQuery(internal.statements.processingTarget, {});
      const response = await fetch(new URL("/api/internal/statements/research", target.url), {
        method: "POST",
        headers: { Authorization: `Bearer ${target.serviceToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id: args.id, token }),
        signal: AbortSignal.timeout(125000),
      });
      const result = await readBoundedResponseJson<{
        suggestion?: unknown; sources?: string[]; message?: string; blocked?: boolean;
      }>(response, "Merchant research service", 500000);
      if (!response.ok) {
        const header = response.headers.get("Retry-After"), seconds = header
          ? /^\d+(?:\.\d+)?$/.test(header) ? Number(header) : Math.max(0, (Date.parse(header) - Date.now()) / 1000)
          : 60;
        await ctx.runMutation(internal.statementIntelligence.finish, {
          ...args, token, sources: [], blocked: result.blocked === true,
          error: typeof result.message === "string" ? result.message.slice(0, 500) : `Research service returned ${response.status}`,
          retryAfter: Number.isFinite(seconds) ? Math.min(seconds * 1000, 86400000) : 60000,
        });
        return null;
      }
      const sources = Array.isArray(result.sources) ? result.sources.filter(s => typeof s === "string").slice(0, 10) : [];
      const suggestion = validateMerchantSuggestion(result.suggestion, sources);
      await ctx.runMutation(internal.statementIntelligence.finish, {
        ...args, token, sources, suggestionJson: JSON.stringify(suggestion),
      });
    } catch (error) {
      await ctx.runMutation(internal.statementIntelligence.finish, {
        ...args,
        token,
        sources: [],
        error: error instanceof Error ? error.message : "Research failed",
      });
    }
    return null;
  },
});
