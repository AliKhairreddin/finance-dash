import { statementCallbackTimeoutMs } from "../shared/statementProcessing";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

export const importBatch = internalAction({ args: { id: v.id("statementImports") }, returns: v.null(), handler: async (ctx, args) => {
  try { await ctx.runMutation(internal.statements.processImportBatch, args); }
  catch (error) { await ctx.runMutation(internal.statements.failImport, { ...args, error: error instanceof Error ? error.message : "Import failed" }); }
  return null;
} });
export const processDocument = internalAction({ args: { id: v.id("statementDocuments"), scheduledToken: v.optional(v.string()) }, returns: v.null(), handler: async (ctx, args) => {
  try {
    const target = await ctx.runQuery(internal.statements.processingTarget, {});
    const response = await fetch(target.url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${target.serviceToken}` }, body: JSON.stringify({ id: args.id }), signal: AbortSignal.timeout(statementCallbackTimeoutMs) });
    if (!response.ok) throw new Error(`Document processor returned ${response.status}`);
  } catch (error) {
    console.error("Statement document callback failed", args.id, error instanceof Error ? error.message.slice(0, 200) : "Unknown error");
    await ctx.runMutation(internal.statements.callbackFailed, { ...args, error: error instanceof Error ? error.message : "Document processor unavailable" });
  }
  return null;
} });
