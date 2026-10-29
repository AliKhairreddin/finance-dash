import { ConvexError, v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { canReadScope } from "./statementAccess";
import { merchantKey } from "../shared/statementIntelligence";
import { readBoundedResponseJson } from "../shared/boundedHttp";

// Existing automation is never inferred. A policy must explicitly record verified precedence.
export async function applyStatementRules(
  ctx: MutationCtx,
  transactionId: Id<"statementTransactions">,
) {
  const row = await ctx.db.get(transactionId);
  if (
    !row?.companyId ||
    row.deletedAt ||
    row.forgottenAt ||
    row.doneAt ||
    row.reviewReasons.length
  )
    return;
  const policies = await ctx.db
    .query("statementPolicies")
    .withIndex("by_company", (q) => q.eq("companyId", row.companyId!))
    .take(100);
  const policy =
    policies.find((p) => p.financialAccountId === row.financialAccountId) ??
    policies.find((p) => !p.financialAccountId);
  if (!policy) return;
  const settings = JSON.parse(policy.settingsJson);
  if (
    !settings.rulePrecedenceVerified ||
    settings.ruleOrder !== "complete_then_request" ||
    !settings.automaticRulePolicy?.trim()
  )
    return;
  if (
    settings.ruleMerchant &&
    merchantKey(row.counterparty ?? "") !== merchantKey(settings.ruleMerchant)
  )
    return;
  const owner = await ctx.db
    .query("statementMembers")
    .withIndex("by_actor", (q) =>
      q.eq("actor", policy.actor as "Ali" | "Ali M" | "Alaa"),
    )
    .unique();
  if (!owner?.permissions?.includes("settings") || !canReadScope(owner, row))
    return;
  const links = await ctx.db
    .query("statementLinks")
    .withIndex("by_transactionId", (q) => q.eq("transactionId", row._id))
    .take(201);
  let valid =
    links.length > 0 &&
    links.length <= 200 &&
    links.every((l) => l.currency === row.currency) &&
    links.reduce((sum, l) => sum + BigInt(l.amountMinor), 0n) ===
      BigInt(row.amountMinor);
  for (const link of links) {
    const document = await ctx.db.get(link.documentId);
    if (
      !document ||
      document.status !== "ready" ||
      document.quarantined ||
      document.cancelledAt ||
      document.financialAccountId !== row.financialAccountId ||
      !canReadScope(owner, document)
    ) {
      valid = false;
      break;
    }
    if (
      document.generatedInvoiceId &&
      (await ctx.db.get(document.generatedInvoiceId))?.state !== "ready"
    ) {
      valid = false;
      break;
    }
  }
  const now = new Date().toISOString();
  if (
    settings.automaticComplete &&
    owner.permissions.includes("complete") &&
    valid &&
    !row.completedAt
  ) {
    await ctx.db.patch(row._id, {
      status: "completed",
      reviewState: "reviewed",
      completedAt: now,
      completedBy: owner.actor,
      completionReason: `automatic_rule: ${policy._id} revision ${policy.revision}`,
      revision: row.revision + 1,
      updatedAt: now,
    });
    await ctx.db.insert("statementAudit", {
      entityType: "transaction",
      entityId: row._id,
      actor: owner.actor,
      action: "automatic_complete",
      details: JSON.stringify({
        policyId: policy._id,
        revision: policy.revision,
      }),
      createdAt: now,
    });
    return;
  }
  if (
    !settings.automaticRequest ||
    !owner.permissions.includes("generate") ||
    valid ||
    row.generatedInvoiceState === "ready" ||
    row.completedAt
  )
    return;
  const key = `${row._id}:${row.financialRevision ?? row.revision}`;
  if (
    await ctx.db
      .query("statementAutomationJobs")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique()
  )
    return;
  await ctx.db.insert("statementAutomationJobs", {
    key,
    transactionId: row._id,
    actor: owner.actor,
    policyId: policy._id,
    requestId: "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = Math.floor(Math.random() * 16);
      return (c === "x" ? r : (r & 3) | 8).toString(16);
    }),
    state: "queued",
    attempts: 0,
    leaseUntil: 0,
    nextAttemptAt: Date.now(),
    createdAt: Date.now(),
  });
  await ctx.db.patch(row._id, { documentState: "requested" });
  await ctx.db.insert("statementAudit", {
    entityType: "transaction",
    entityId: row._id,
    actor: owner.actor,
    action: "automatic_document_request",
    details: JSON.stringify({
      policyId: policy._id,
      revision: policy.revision,
    }),
    createdAt: now,
  });
}
export const due = internalQuery({
  args: {},
  returns: v.array(v.id("statementAutomationJobs")),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("statementAutomationJobs")
      .withIndex("by_next", (q) => q.lte("nextAttemptAt", Date.now()))
      .take(25);
    return rows
      .filter(
        (r) =>
          ["queued", "failed", "running"].includes(r.state) &&
          r.attempts < 5 &&
          r.leaseUntil <= Date.now(),
      )
      .slice(0, 2)
      .map((r) => r._id);
  },
});
export const claim = internalMutation({
  args: { id: v.id("statementAutomationJobs"), token: v.string() },
  returns: v.boolean(),
  handler: async (ctx, a) => {
    const row = await ctx.db.get(a.id);
    if (
      !row ||
      !["queued", "failed", "running"].includes(row.state) ||
      row.attempts >= 5 ||
      row.leaseUntil > Date.now()
    )
      return false;
    await ctx.db.patch(row._id, {
      state: "running",
      token: a.token,
      leaseUntil: Date.now() + 300000,
      attempts: row.attempts + 1,
    });
    return true;
  },
});
export const job = query({
  args: {
    serviceToken: v.string(),
    id: v.id("statementAutomationJobs"),
    token: v.string(),
  },
  returns: v.string(),
  handler: async (ctx, a) => {
    if (
      !process.env.CONVEX_SERVICE_TOKEN ||
      a.serviceToken !== process.env.CONVEX_SERVICE_TOKEN
    )
      throw new ConvexError("Unauthorized");
    const job = await ctx.db.get(a.id);
    if (
      !job ||
      job.token !== a.token ||
      job.leaseUntil < Date.now() ||
      job.state !== "running"
    )
      throw new ConvexError("Job lease expired");
    const owner = await ctx.db
        .query("statementMembers")
        .withIndex("by_actor", (q) => q.eq("actor", job.actor))
        .unique(),
      row = await ctx.db.get(job.transactionId),
      policy = await ctx.db.get(job.policyId);
    const settings = policy ? JSON.parse(policy.settingsJson) : {};
    if (
      !owner?.permissions?.includes("settings") ||
      !owner?.permissions?.includes("generate") ||
      !row ||
      !canReadScope(owner, row) ||
      row.forgottenAt ||
      row.deletedAt ||
      row.doneAt ||
      row.completedAt ||
      row.reviewReasons.length > 0 ||
      job.key !== `${row._id}:${row.financialRevision ?? row.revision}` ||
      !policy ||
      policy.actor !== job.actor ||
      policy.companyId !== row.companyId ||
      (policy.financialAccountId &&
        policy.financialAccountId !== row.financialAccountId) ||
      !settings.automaticRequest ||
      !settings.rulePrecedenceVerified ||
      settings.ruleOrder !== "complete_then_request" ||
      !settings.automaticRulePolicy?.trim() ||
      (settings.ruleMerchant &&
        merchantKey(row.counterparty ?? "") !==
          merchantKey(settings.ruleMerchant))
    )
      throw new ConvexError("Automatic generation is no longer authorized");
    return JSON.stringify({
      actor: job.actor,
      transactionId: job.transactionId,
      requestId: job.requestId,
    });
  },
});
export const finish = internalMutation({
  args: {
    id: v.id("statementAutomationJobs"),
    token: v.string(),
    state: v.union(
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("blocked"),
    ),
    message: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, a) => {
    const job = await ctx.db.get(a.id);
    if (!job || job.token !== a.token) return null;
    await ctx.db.patch(job._id, {
      state: a.state,
      error: a.message.slice(0, 500),
      token: undefined,
      leaseUntil: 0,
      nextAttemptAt:
        a.state === "failed" && job.attempts < 5
          ? Date.now() + 60000 * 2 ** job.attempts
          : Number.MAX_SAFE_INTEGER,
    });
    const row = await ctx.db.get(job.transactionId);
    if (
      row &&
      (a.state === "blocked" || (a.state === "failed" && job.attempts >= 5))
    )
      await ctx.db.patch(row._id, { documentState: "failed" });
    if (
      row?.companyId &&
      (a.state === "blocked" || (a.state === "failed" && job.attempts >= 5))
    )
      await ctx.db.insert("statementNotifications", {
        actor: job.actor,
        transactionId: row._id,
        companyId: row.companyId,
        financialAccountId: row.financialAccountId,
        message: a.message.slice(0, 500),
        dueAt: Date.now(),
        createdAt: Date.now(),
      });
    return null;
  },
});
export const pump = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    for (const id of await ctx.runQuery(internal.statementAutomation.due, {}))
      await ctx.scheduler.runAfter(0, internal.statementAutomation.run, { id });
    return null;
  },
});
export const run = internalAction({
  args: { id: v.id("statementAutomationJobs") },
  returns: v.null(),
  handler: async (ctx, a) => {
    const token = crypto.randomUUID();
    if (
      !(await ctx.runMutation(internal.statementAutomation.claim, {
        ...a,
        token,
      }))
    )
      return null;
    let configured = false;
    try {
      const target = await ctx.runQuery(
        internal.statements.processingTarget,
        {},
      );
      configured = true;
      const url = new URL("/api/statements/process-generation", target.url);
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${target.serviceToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ...a, token }),
        signal: AbortSignal.timeout(240000),
      });
      const result = await readBoundedResponseJson<{
        correctionRequired?: boolean;
        state?: string;
        message?: string;
      }>(response, "Automatic generation", 100000);
      await ctx.runMutation(internal.statementAutomation.finish, {
        ...a,
        token,
        state:
          response.ok && result.state === "ready"
            ? "succeeded"
            : result.correctionRequired
              ? "blocked"
              : "failed",
        message: result.correctionRequired
          ? "Automatic document needs approved company details. Open Generate AI Invoice to correct them."
          : (result.message ??
            (result.state === "ready"
              ? "Document saved"
              : "Generation will retry")),
      });
    } catch (e) {
      await ctx.runMutation(internal.statementAutomation.finish, {
        ...a,
        token,
        state: configured ? "failed" : "blocked",
        message:
          e instanceof Error ? e.message : "Automatic generation unavailable",
      });
    }
    return null;
  },
});
