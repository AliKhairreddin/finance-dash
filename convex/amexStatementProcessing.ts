import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

export const process = internalAction({
  args: { id: v.id("amexStatementImports") }, returns: v.null(),
  handler: async (ctx, args) => {
    try {
      const done: boolean = await ctx.runMutation(internal.amexStatements.batch, args);
      if (done && globalThis.process.env.DOCUMENT_PROCESSOR_URL && globalThis.process.env.CONVEX_SERVICE_TOKEN) {
        // Existing classification backlog also retries these transactions every five minutes.
        const endpoint = new URL("/api/internal/amex/classify", globalThis.process.env.DOCUMENT_PROCESSOR_URL);
        const response = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${globalThis.process.env.CONVEX_SERVICE_TOKEN}` }, signal: AbortSignal.timeout(120_000) });
        if (!response.ok) console.error(JSON.stringify({ event: "amex_classification_deferred", status: response.status }));
      }
    } catch (error) {
      await ctx.runMutation(internal.amexStatements.fail, { ...args, error: error instanceof Error ? error.message : "Statement import failed" });
    }
    return null;
  }
});
