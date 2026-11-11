import { mutation, query } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { assertActiveBankSyncLease } from "./bankLease";

function auth(token: string) {
  if (!process.env.CONVEX_SERVICE_TOKEN || token !== process.env.CONVEX_SERVICE_TOKEN) throw new ConvexError({ code: "UNAUTHORIZED" });
}
const credential = { serviceToken: v.string(), connectionKey: v.string(), leaseToken: v.string(), leaseFence: v.number() };
const control = v.object({ activatedAt: v.string(), modifiedThrough: v.optional(v.string()), retryAt: v.number() });
export const get = query({ args: { serviceToken: v.string(), connectionKey: v.string() }, returns: v.union(v.null(), control), handler: async (ctx, args) => {
  auth(args.serviceToken);
  const row = await ctx.db.query("flexSyncControls").withIndex("by_connection", q => q.eq("connectionKey", args.connectionKey)).unique();
  return row ? { activatedAt: row.activatedAt, modifiedThrough: row.modifiedThrough, retryAt: row.retryAt } : null;
} });
export const update = mutation({ args: { ...credential, modifiedThrough: v.optional(v.string()), retryAt: v.optional(v.number()) }, returns: control, handler: async (ctx, args) => {
  auth(args.serviceToken);
  await assertActiveBankSyncLease(ctx, "flex", args);
  // Alert history is operational data; the financial ledger is retained separately.
  for (const expired of await ctx.db.query("flexAlertDeliveries").withIndex("by_created", q => q.lt("createdAt", Date.now() - 90 * 86400_000)).take(100)) await ctx.db.delete(expired._id);
  const row = await ctx.db.query("flexSyncControls").withIndex("by_connection", q => q.eq("connectionKey", args.connectionKey)).unique();
  const next = { activatedAt: row?.activatedAt ?? new Date().toISOString(),
    ...(row?.modifiedThrough ? { modifiedThrough: row.modifiedThrough } : {}), retryAt: row?.retryAt ?? 0 };
  if (args.modifiedThrough) {
    if (!Number.isFinite(Date.parse(args.modifiedThrough))) throw new Error("Invalid Flex modification watermark");
    if (!next.modifiedThrough || next.modifiedThrough < args.modifiedThrough) next.modifiedThrough = args.modifiedThrough;
  }
  if (args.retryAt !== undefined) {
    if (!Number.isFinite(args.retryAt) || args.retryAt < 0) throw new Error("Invalid Flex retry time");
    next.retryAt = args.retryAt;
  }
  if (row) await ctx.db.patch(row._id, next); else await ctx.db.insert("flexSyncControls", { connectionKey: args.connectionKey, ...next });
  return next;
} });

/** State changes and the notification outbox commit atomically with provider-scoped deduplication. */
export const observe = mutation({ args: { ...credential, observations: v.array(v.object({ key: v.string(), at: v.string(), active: v.boolean(),
  eventKey: v.string(), message: v.string(), recoveryMessage: v.optional(v.string()), recipients: v.array(v.string()), always: v.boolean() })) },
  returns: v.null(), handler: async (ctx, args) => {
    auth(args.serviceToken); await assertActiveBankSyncLease(ctx, "flex", args);
    if (args.observations.length > 200) throw new Error("Too many Flex alert observations");
    for (const observation of args.observations) {
      if (!Number.isFinite(Date.parse(observation.at)) || observation.message.length > 4000 || observation.recipients.length > 10) throw new Error("Invalid Flex alert");
      const key = `${args.connectionKey}:${observation.key}`;
      const previous = await ctx.db.query("flexAlertStates").withIndex("by_key", q => q.eq("key", key)).unique();
      const older = previous && observation.at < previous.at;
      const message = observation.always && observation.active ? observation.message
        : older ? undefined
        : observation.active && !previous?.active ? observation.message
        : !observation.active && previous?.active && observation.at > previous.at ? observation.recoveryMessage : undefined;
      if (message) for (const recipient of observation.recipients) {
        const deliveryKey = `${args.connectionKey}:${observation.eventKey}:${recipient}`;
        const existing = await ctx.db.query("flexAlertDeliveries").withIndex("by_key", q => q.eq("key", deliveryKey)).unique();
        if (!existing) await ctx.db.insert("flexAlertDeliveries", { key: deliveryKey, connectionKey: args.connectionKey, message, recipient, status: "pending", attempts: 0, nextAttemptAt: Date.now(), createdAt: Date.now() });
      }
      if (older || previous?.active && !observation.active && observation.at === previous.at) continue;
      if (previous) await ctx.db.patch(previous._id, { at: observation.at, active: observation.active });
      else await ctx.db.insert("flexAlertStates", { key, at: observation.at, active: observation.active });
    }
    return null;
} });
export const pending = query({ args: { serviceToken: v.string(), connectionKey: v.string() }, returns: v.array(v.object({ id: v.id("flexAlertDeliveries"), message: v.string(), recipient: v.string() })), handler: async (ctx, args) => {
  auth(args.serviceToken);
  const rows = await ctx.db.query("flexAlertDeliveries").withIndex("by_connection_status_next_attempt", q => q.eq("connectionKey", args.connectionKey).eq("status", "pending").lte("nextAttemptAt", Date.now())).take(25);
  return rows.map(row => ({ id: row._id, message: row.message, recipient: row.recipient }));
} });
export const deliveryResult = mutation({ args: { ...credential, id: v.id("flexAlertDeliveries"), success: v.boolean() }, returns: v.null(), handler: async (ctx, args) => {
  auth(args.serviceToken); await assertActiveBankSyncLease(ctx, "flex", args);
  const row = await ctx.db.get(args.id); if (!row || row.status !== "pending") return null;
  if (row.connectionKey !== args.connectionKey) throw new Error("Flex notification connection mismatch");
  const attempts = row.attempts + 1;
  await ctx.db.patch(row._id, { attempts, status: args.success ? "sent" : attempts >= 8 ? "failed" : "pending", nextAttemptAt: Date.now() + Math.min(3600_000, 60_000 * 2 ** attempts) });
  return null;
} });
