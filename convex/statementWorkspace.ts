import { v, ConvexError } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { statementActor, statementCompany } from "./statementSchema";
import {
  statementMember,
  requireScope,
  canReadScope,
  requirePermission,
  validateAccount,
} from "./statementAccess";
import {
  statementPermissions,
  statementAccounts,
  statementIdentity,
} from "../shared/statements";
const auth = { serviceToken: v.string(), actor: v.string() };
const stamp = () => new Date().toISOString();
export const settings = query({
  args: auth,
  returns: v.string(),
  handler: async (ctx, args) => {
    const member = await statementMember(ctx, args, "settings");
    const accounts = (await ctx.db.query("statementAccounts").take(500)).filter(
      (a) => canReadScope(member, { ...a, financialAccountId: a.key }),
    );
    const policies = (
      await Promise.all(
        member.companyIds.map((companyId) =>
          ctx.db
            .query("statementPolicies")
            .withIndex("by_company", (q) => q.eq("companyId", companyId))
            .take(100),
        ),
      )
    )
      .flat()
      .filter((p) => canReadScope(member, p));
    const members = member.manage
      ? await ctx.db.query("statementMembers").take(100)
      : [];
    return JSON.stringify({
      accounts,
      policies,
      members,
      permissions: statementPermissions,
    });
  },
});
export const saveAccount = mutation({
  args: {
    ...auth,
    key: v.string(),
    companyId: statementCompany,
    name: v.string(),
    provider: v.string(),
    historical: v.boolean(),
    verified: v.boolean(),
    notes: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const member = await statementMember(ctx, args, "settings");
    requireScope(member, { companyId: args.companyId });
    if (!member.manage) throw new ConvexError("Administrator required");
    if (
      !/^[a-z0-9-]{1,80}$/.test(args.key) ||
      !args.name.trim() ||
      args.name.length > 100 ||
      !args.provider.trim() ||
      args.provider.length > 100 ||
      args.notes.length > 2000
    )
      throw new ConvexError("Invalid account details");
    const old = await ctx.db
      .query("statementAccounts")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    const known = statementAccounts.find((a) => a.id === args.key);
    if (
      known &&
      (args.companyId !== known.companyId ||
        args.historical !== known.historical ||
        args.provider !== known.provider)
    )
      throw new ConvexError(
        "Preserve historical account and provider identity",
      );
    if (old && old.companyId !== args.companyId)
      throw new ConvexError(
        "Account ownership requires a separately reviewed migration",
      );
    const { actor: _actor, serviceToken: _token, ...fields } = args;
    if (old) {
      requireScope(member, { ...old, financialAccountId: old.key });
      await ctx.db.patch(old._id, fields);
    } else {
      await ctx.db.insert("statementAccounts", {
        ...fields,
        settingsJson: "{}",
      });
      await ctx.db.patch(member._id, {
        accountIds: [...(member.accountIds ?? []), args.key],
      });
    }
    await ctx.db.insert("statementAudit", {
      actor: member.actor,
      entityType: "account",
      entityId: args.key,
      action: "account_saved",
      details: JSON.stringify(fields),
      createdAt: stamp(),
    });
    return null;
  },
});
export const savePolicy = mutation({
  args: {
    ...auth,
    companyId: statementCompany,
    financialAccountId: v.optional(v.string()),
    settingsJson: v.string(),
    revision: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const member = await statementMember(ctx, args, "settings");
    requireScope(member, args);
    await validateAccount(ctx, args);
    if (args.settingsJson.length > 20000)
      throw new ConvexError("Settings too large");
    const settings = JSON.parse(args.settingsJson);
    if (!settings || Array.isArray(settings) || typeof settings !== "object")
      throw new ConvexError("Invalid settings");
    if (
      settings.salesInvoiceApproved &&
      (!settings.legalName?.trim() ||
        !settings.legalAddress?.trim() ||
        !settings.taxPolicy?.trim() ||
        !/^\d{1,3}(?:\.\d{1,2})?$/.test(settings.taxRate ?? "") ||
        Number(settings.taxRate) > 100 ||
        !["transaction", "generation"].includes(settings.invoiceDatePolicy))
    )
      throw new ConvexError(
        "Approved sales invoices require verified legal details, an explicit tax policy/rate and a date policy",
      );
    if (
      (settings.automaticComplete || settings.automaticRequest) &&
      (!settings.rulePrecedenceVerified ||
        settings.ruleOrder !== "complete_then_request" ||
        !settings.automaticRulePolicy?.trim())
    )
      throw new ConvexError(
        "Verify and record the automatic rule precedence before enabling rules",
      );
    const old = (
      await ctx.db
        .query("statementPolicies")
        .withIndex("by_company", (q) => q.eq("companyId", args.companyId))
        .take(100)
    ).find((p) => p.financialAccountId === args.financialAccountId);
    if ((old?.revision ?? 0) !== args.revision)
      throw new ConvexError("Settings changed; reload first");
    const fields = {
      companyId: args.companyId,
      financialAccountId: args.financialAccountId,
      settingsJson: JSON.stringify(settings),
      revision: args.revision + 1,
      actor: member.actor,
      updatedAt: stamp(),
    };
    const id = old
      ? (await ctx.db.patch(old._id, fields), old._id)
      : await ctx.db.insert("statementPolicies", fields);
    await ctx.db.insert("statementAudit", {
      actor: member.actor,
      entityType: "policy",
      entityId: id,
      action: "settings_saved",
      details: JSON.stringify({
        before: old?.settingsJson,
        after: fields.settingsJson,
      }),
      createdAt: stamp(),
    });
    return null;
  },
});
export const saveMember = mutation({
  args: {
    ...auth,
    memberActor: statementActor,
    companyIds: v.array(statementCompany),
    accountIds: v.array(v.string()),
    permissions: v.array(v.string()),
    manage: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const member = await statementMember(ctx, args, "settings");
    if (!member.manage) throw new ConvexError("Administrator required");
    if (args.memberActor === member.actor)
      throw new ConvexError(
        "Another administrator must change your permissions",
      );
    if (
      args.companyIds.some((c) => !member.companyIds.includes(c)) ||
      args.accountIds.some((a) => !member.accountIds?.includes(a)) ||
      args.permissions.some(
        (p) =>
          !statementPermissions.some((x) => x === p) ||
          !member.permissions?.includes(p),
      )
    )
      throw new ConvexError("You cannot grant access you do not hold");
    const old = await ctx.db
      .query("statementMembers")
      .withIndex("by_actor", (q) => q.eq("actor", args.memberActor))
      .unique();
    const fields = {
      actor: args.memberActor,
      companyIds: args.companyIds,
      accountIds: args.accountIds,
      permissions: args.permissions,
      manage: args.manage,
    };
    if (old) await ctx.db.patch(old._id, fields);
    else await ctx.db.insert("statementMembers", fields);
    await ctx.db.insert("statementAudit", {
      actor: member.actor,
      entityType: "member",
      entityId: args.memberActor,
      action: "permissions_updated",
      details: JSON.stringify(fields),
      createdAt: stamp(),
    });
    return null;
  },
});
export const notifications = query({
  args: auth,
  returns: v.string(),
  handler: async (ctx, args) => {
    const member = await statementMember(ctx, args, "reminders");
    const rows = await ctx.db
      .query("statementNotifications")
      .withIndex("by_actor_due", (q) => q.eq("actor", member.actor))
      .order("desc")
      .take(200);
    return JSON.stringify(rows.filter((r) => canReadScope(member, r)));
  },
});
export const remind = mutation({
  args: {
    ...auth,
    transactionId: v.id("statementTransactions"),
    dueAt: v.number(),
    message: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const member = await statementMember(ctx, args, "reminders"),
      row = await ctx.db.get(args.transactionId);
    if (!row?.companyId) throw new ConvexError("Assign a company first");
    requireScope(member, row);
    if (
      !args.message.trim() ||
      args.message.length > 500 ||
      !Number.isFinite(args.dueAt) ||
      args.dueAt < Date.now()
    )
      throw new ConvexError("Enter a future reminder and message");
    await ctx.db.insert("statementNotifications", {
      actor: member.actor,
      transactionId: row._id,
      companyId: row.companyId,
      financialAccountId: row.financialAccountId,
      message: args.message.trim(),
      dueAt: args.dueAt,
      createdAt: Date.now(),
    });
    return null;
  },
});
export const readNotification = mutation({
  args: { ...auth, id: v.id("statementNotifications") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const member = await statementMember(ctx, args, "reminders"),
      row = await ctx.db.get(args.id);
    if (!row || row.actor !== member.actor)
      throw new ConvexError("Notification not found");
    requireScope(member, row);
    await ctx.db.patch(row._id, { readAt: Date.now() });
    return null;
  },
});
// Explicit, bounded migration; never invoked during deployment or initialization of an existing DB.
export const migrateWorkflow = internalMutation({
  args: { paginationOpts: paginationOptsValidator, dryRun: v.boolean() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const page = await ctx.db.query("statementTransactions").paginate({
      ...args.paginationOpts,
      numItems: Math.min(100, args.paginationOpts.numItems),
    });
    let changed = 0;
    for (const row of page.page) {
      if (row.financialRevision !== undefined) continue;
      changed++;
      if (!args.dryRun) {
        const events = await ctx.db
          .query("statementAudit")
          .withIndex("by_entityId", (q) => q.eq("entityId", row._id))
          .order("desc")
          .take(200);
        const completion =
          row.status === "completed"
            ? events.find((e) => e.action === "complete")
            : undefined;
        await ctx.db.patch(row._id, {
          financialRevision: row.revision,
          reviewState: row.reviewReasons.length
            ? "unresolved"
            : row.status === "pending"
              ? "pending"
              : "reviewed",
          documentState:
            row.generatedInvoiceState === "ready" || row.documentIds.length
              ? "available"
              : "missing",
          completedAt: completion?.createdAt,
          completedBy: completion?.actor,
          completionReason:
            row.status === "completed"
              ? "historical_completion_reason_unverified"
              : undefined,
        });
      }
    }
    return JSON.stringify({
      changed,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
      dryRun: args.dryRun,
    });
  },
});
export const migrateAccess = internalMutation({
  args: { dryRun: v.boolean() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const members = await ctx.db.query("statementMembers").take(100);
    const pending = members.filter((m) => !m.permissions);
    if (!args.dryRun)
      for (const member of pending)
        await ctx.db.patch(member._id, {
          permissions: statementPermissions.filter(
            (p) => member.manage || !["settings"].includes(p),
          ),
          accountIds: [],
        });
    // Existing membership is preserved; no LoveMeDo or historical account access is inferred.
    return JSON.stringify({
      members: pending.map((m) => m.actor),
      accountGrants: [],
      dryRun: args.dryRun,
    });
  },
});

// Run only during an explicitly authorized, write-frozen migration. Every operation supports dry run.
export const seedAccountMetadata = internalMutation({
  args: { dryRun: v.boolean() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const pending = [];
    for (const account of statementAccounts) {
      const found = await ctx.db
        .query("statementAccounts")
        .withIndex("by_key", (q) => q.eq("key", account.id))
        .unique();
      if (found) continue;
      pending.push(account.id);
      if (!args.dryRun)
        await ctx.db.insert("statementAccounts", {
          key: account.id,
          companyId: account.companyId,
          name: account.name,
          provider: account.provider,
          historical: account.historical,
          verified: false,
          notes: "Mapping requires verification",
          settingsJson: "{}",
        });
    }
    return JSON.stringify({
      pending,
      dryRun: args.dryRun,
      transactionsMoved: 0,
      cardsAssigned: 0,
    });
  },
});
export const migrateIdentity = internalMutation({
  args: { paginationOpts: paginationOptsValidator, dryRun: v.boolean() },
  returns: v.string(),
  handler: async (ctx, args) => {
    const page = await ctx.db.query("statementTransactions").paginate({
        ...args.paginationOpts,
        numItems: Math.min(100, args.paginationOpts.numItems),
      }),
      changes = [],
      conflicts = [];
    const proposed = new Map<string, string>();
    for (const row of page.page) {
      const identity = statementIdentity(row);
      if (identity) {
        const other = proposed.get(identity);
        if (other && other !== row._id) {
          conflicts.push({ id: row._id, other });
          continue;
        }
        proposed.set(identity, row._id);
      }
      if (identity === row.identity) continue;
      const match = identity
        ? await ctx.db
            .query("statementTransactions")
            .withIndex("by_identity", (q) => q.eq("identity", identity))
            .first()
        : null;
      if (match && match._id !== row._id) {
        conflicts.push({ id: row._id, other: match._id });
        continue;
      }
      changes.push({ id: row._id, before: row.identity, after: identity });
    }
    if (conflicts.length && !args.dryRun)
      throw new ConvexError(
        "Identity collisions require review before migration",
      );
    if (!args.dryRun)
      for (const change of changes)
        await ctx.db.patch(change.id, { identity: change.after });
    return JSON.stringify({
      changes,
      conflicts,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
      dryRun: args.dryRun,
    });
  },
});
export const migrationManifest = query({
  args: { ...auth, cursor: v.optional(v.string()) },
  returns: v.string(),
  handler: async (ctx, args) => {
    const member = await statementMember(ctx, args, "settings");
    if (!member.manage) throw new ConvexError("Administrator required");
    const page = await ctx.db
      .query("statementTransactions")
      .paginate({ cursor: args.cursor ?? null, numItems: 100 });
    const rows = page.page
      .filter((r) => canReadScope(member, r))
      .map((r) => ({
        id: r._id,
        companyId: r.companyId,
        financialAccountId: r.financialAccountId,
        source: r.source,
        account: r.account,
        providerId: r.providerId,
        identity: r.identity,
        proposedIdentity: statementIdentity(r),
        cardLastFour: r.cardLastFour,
        date: r.date,
        currency: r.currency,
        amountMinor: r.amountMinor,
        direction: r.direction,
        documentIds: r.documentIds,
      }));
    return JSON.stringify({
      rows,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    });
  },
});

// Deployment-operator entry point for explicit initial grants. It is never called by
// startup, a public route or a migration automatically; old membership is not guessed.
export const configureAccess = internalMutation({
  args: {
    memberActor: statementActor,
    companyIds: v.array(statementCompany),
    accountIds: v.array(v.string()),
    permissions: v.array(v.string()),
    manage: v.boolean(),
    operator: v.string(),
    reason: v.string(),
    dryRun: v.boolean(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    if (!args.operator.trim() || args.reason.trim().length < 10)
      throw new ConvexError(
        "Record the authorizing operator and access policy reason",
      );
    if (
      args.permissions.some(
        (p) => !statementPermissions.some((known) => known === p),
      )
    )
      throw new ConvexError("Unknown action permission");
    for (const key of args.accountIds) {
      const account = await ctx.db
        .query("statementAccounts")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique();
      if (!account || !args.companyIds.includes(account.companyId))
        throw new ConvexError(
          "Each account grant requires its legal company and seeded account metadata",
        );
    }
    const old = await ctx.db
      .query("statementMembers")
      .withIndex("by_actor", (q) => q.eq("actor", args.memberActor))
      .unique();
    const after = {
      actor: args.memberActor,
      companyIds: [...new Set(args.companyIds)],
      accountIds: [...new Set(args.accountIds)],
      permissions: [...new Set(args.permissions)],
      manage: args.manage,
    };
    if (!args.dryRun) {
      const id = old
        ? (await ctx.db.patch(old._id, after), old._id)
        : await ctx.db.insert("statementMembers", after);
      await ctx.db.insert("statementAudit", {
        entityType: "member",
        entityId: id,
        actor: args.operator,
        action: "explicit_access_configuration",
        details: JSON.stringify({ before: old, after, reason: args.reason }),
        createdAt: stamp(),
      });
    }
    return JSON.stringify({ before: old, after, dryRun: args.dryRun });
  },
});
export const configureNumberSequence = internalMutation({
  args: {
    companyId: statementCompany,
    documentType: v.union(
      v.literal("internal_support"),
      v.literal("sales_invoice"),
    ),
    year: v.string(),
    next: v.number(),
    operator: v.string(),
    reason: v.string(),
    dryRun: v.boolean(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    if (
      !/^\d{4}$/.test(args.year) ||
      !Number.isSafeInteger(args.next) ||
      args.next < 1 ||
      !args.operator.trim() ||
      args.reason.trim().length < 10
    )
      throw new ConvexError(
        "Enter an approved year, next number, operator and policy reason",
      );
    const issuerKey = `legal:${args.companyId}`,
      old = await ctx.db
        .query("statementNumberSequences")
        .withIndex("by_issuer_type_year", (q) =>
          q
            .eq("issuerKey", issuerKey)
            .eq("documentType", args.documentType)
            .eq("year", args.year),
        )
        .unique();
    if (old && args.next < old.next)
      throw new ConvexError("Number sequences cannot be decreased or reused");
    const after = {
      issuerKey,
      documentType: args.documentType,
      year: args.year,
      next: args.next,
    };
    if (!args.dryRun) {
      const id = old
        ? (await ctx.db.patch(old._id, after), old._id)
        : await ctx.db.insert("statementNumberSequences", after);
      await ctx.db.insert("statementAudit", {
        entityType: "number_sequence",
        entityId: id,
        actor: args.operator,
        action: "explicit_number_configuration",
        details: JSON.stringify({ before: old, after, reason: args.reason }),
        createdAt: stamp(),
      });
    }
    return JSON.stringify({ before: old, after, dryRun: args.dryRun });
  },
});
