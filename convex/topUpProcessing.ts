import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
function endpoint() { const configured = process.env.DOCUMENT_PROCESSOR_URL; if (!configured || !process.env.CONVEX_SERVICE_TOKEN) throw new Error("Document processor is not configured"); return new URL("/api/internal/top-ups/process", configured); }
export const deliver = internalAction({ args: { id: v.id("topUpRequests"), version: v.number() }, returns: v.null(), handler: async (ctx, a) => {
  const token = crypto.randomUUID(); if (!await ctx.runMutation(internal.topUps.claimDelivery, { ...a, token })) return null;
  let error: string | undefined;
  try { const response = await fetch(endpoint(), { method: "POST", headers: { Authorization: `Bearer ${process.env.CONVEX_SERVICE_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ ...a, job: "notification" }), signal: AbortSignal.timeout(35_000) }); if (!response.ok) throw new Error(`Telegram delivery returned ${response.status}. Check bot membership in the Top-Up Request group.`); }
  catch (e) { error = e instanceof Error ? e.message : "Telegram delivery failed"; }
  await ctx.runMutation(internal.topUps.deliveryResult, { ...a, token, ...(error ? { error } : {}) }); return null;
} });
export const draft = internalAction({ args: { id: v.id("topUpRequests") }, returns: v.null(), handler: async (ctx, a) => {
  try { const response = await fetch(endpoint(), { method: "POST", headers: { Authorization: `Bearer ${process.env.CONVEX_SERVICE_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ ...a, job: "draft" }), signal: AbortSignal.timeout(150_000) }); if (!response.ok) throw new Error("Draft processor failed"); }
  catch { await ctx.runMutation(internal.topUps.failQueuedDraft, a); }
  return null;
} });
