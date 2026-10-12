import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { validateContractExtraction } from "../shared/companyDocuments";
export const process = internalAction({
  args: { id: v.id("companyDocuments") }, returns: v.null(),
  handler: async (ctx, { id }) => {
    const token = crypto.randomUUID();
    if (!await ctx.runMutation(internal.companyDocuments.claim, { id, token })) return null;
    let retryAfterMs: number | undefined;
    try {
      const configured = globalThis.process.env.DOCUMENT_PROCESSOR_URL;
      if (!configured || !globalThis.process.env.CONVEX_SERVICE_TOKEN) throw new Error("Document recognition is not configured");
      const endpoint = new URL("/api/internal/contracts/process", configured);
      if (endpoint.protocol !== "https:") throw new Error("Document processor must use HTTPS");
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${globalThis.process.env.CONVEX_SERVICE_TOKEN}` }, body: JSON.stringify({ id }), signal: AbortSignal.timeout(120000) });
      if (!response.ok) { const seconds = Number(response.headers.get("Retry-After")); if (seconds > 0) retryAfterMs = Math.min(900000, seconds * 1000); throw new Error(`Company recognition returned ${response.status}`); }
      await ctx.runMutation(internal.companyDocuments.complete, { id, token, extraction: validateContractExtraction(await response.json()) });
    } catch (error) { await ctx.runMutation(internal.companyDocuments.recover, { id, token, error: error instanceof Error ? error.message : "Recognition failed", ...(retryAfterMs ? { retryAfterMs } : {}) }); }
    return null;
  }
});
