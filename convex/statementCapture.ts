import { fullStatementManagement } from "./statementAccess";
import { ConvexError, v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { normalizeStatementActor, statementCompanies } from "../shared/statements";

const auth = { serviceToken: v.string(), actor: v.string() };
function authorize(token: string) {
  if (!process.env.CONVEX_SERVICE_TOKEN || token !== process.env.CONVEX_SERVICE_TOKEN) throw new ConvexError("Unauthorized");
}
async function member(ctx: QueryCtx | MutationCtx, actor: string) {
  const row = await ctx.db.query("statementMembers").withIndex("by_actor", q => q.eq("actor", normalizeStatementActor(actor))).unique();
  if (!row || !fullStatementManagement(row)) throw new ConvexError("Full statements management access required");
  return row;
}
export const status = query({
  args: auth, returns: v.object({ active: v.boolean() }),
  handler: async (ctx, args) => {
    authorize(args.serviceToken);
    const owner = await member(ctx, args.actor);
    const device = await ctx.db.query("statementCaptureDevices").withIndex("by_actor", q => q.eq("actor", owner.actor)).unique();
    return { active: device?.active ?? false };
  }
});
export const connect = mutation({
  args: { ...auth, tokenHash: v.string() }, returns: v.null(),
  handler: async (ctx, args) => {
    authorize(args.serviceToken);
    const owner = await member(ctx, args.actor);
    if (!/^[a-f0-9]{64}$/.test(args.tokenHash)) throw new ConvexError("Invalid device key");
    const existing = await ctx.db.query("statementCaptureDevices").withIndex("by_actor", q => q.eq("actor", owner.actor)).unique();
    if (existing?.active) throw new ConvexError("Disconnect the existing phone before creating a new setup link");
    const fields = { actor: owner.actor, tokenHash: args.tokenHash, active: true, createdAt: Date.now(), minuteStart: 0, minuteCount: 0, dayStart: 0, dayCount: 0 };
    const id = existing ? existing._id : await ctx.db.insert("statementCaptureDevices", fields);
    if (existing) await ctx.db.replace(id, fields);
    await ctx.db.insert("statementAudit", { actor: owner.actor, entityType: "capture_device", entityId: id, action: "connected", details: "Upload-only phone key; no timed expiry", createdAt: new Date().toISOString() });
    return null;
  }
});
export const disconnect = mutation({
  args: auth, returns: v.null(),
  handler: async (ctx, args) => {
    authorize(args.serviceToken);
    const owner = await member(ctx, args.actor);
    const row = await ctx.db.query("statementCaptureDevices").withIndex("by_actor", q => q.eq("actor", owner.actor)).unique();
    if (row) {
      await ctx.db.patch(row._id, { active: false });
      await ctx.db.insert("statementAudit", { actor: owner.actor, entityType: "capture_device", entityId: row._id, action: "disconnected", details: "", createdAt: new Date().toISOString() });
    }
    return null;
  }
});
// Atomic counters also bound concurrent requests; device keys never authorize a read.
export const acceptUpload = mutation({
  args: { serviceToken: v.string(), tokenHash: v.string() },
  returns: v.union(v.object({ actor: v.string(), retryAfter: v.literal(0) }), v.object({ actor: v.null(), retryAfter: v.number() })),
  handler: async (ctx, args) => {
    authorize(args.serviceToken);
    const row = await ctx.db.query("statementCaptureDevices").withIndex("by_tokenHash", q => q.eq("tokenHash", args.tokenHash)).unique();
    if (!row?.active) return { actor: null, retryAfter: 0 };
    const owner = await ctx.db.query("statementMembers").withIndex("by_actor", q => q.eq("actor", normalizeStatementActor(row.actor))).unique();
    if (!owner || !fullStatementManagement(owner)) return { actor: null, retryAfter: 0 };
    const now = Date.now(), minuteStart = now - row.minuteStart >= 60_000 ? now : row.minuteStart;
    const dayStart = now - row.dayStart >= 86_400_000 ? now : row.dayStart;
    const minuteCount = minuteStart === row.minuteStart ? row.minuteCount : 0;
    const dayCount = dayStart === row.dayStart ? row.dayCount : 0;
    if (minuteCount >= 5 || dayCount >= 120) return { actor: null, retryAfter: Math.max(1, Math.ceil(((dayCount >= 120 ? dayStart + 86_400_000 : minuteStart + 60_000) - now) / 1000)) };
    await ctx.db.patch(row._id, { minuteStart, minuteCount: minuteCount + 1, dayStart, dayCount: dayCount + 1 });
    return { actor: owner.actor, retryAfter: 0 as const };
  }
});
