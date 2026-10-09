import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { validateExtraction } from "../shared/financialDocuments";

export const process = internalAction({
  args: { id: v.id("financialDocuments") }, returns: v.null(),
  handler: async (ctx, { id }) => {
    const token = crypto.randomUUID();
    if (!await ctx.runMutation(internal.documents.claim, { id, token })) return null;
    let retryAfterMs: number | undefined;
    try {
      const endpoint = processEndpoint();
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${globalThis.process.env.CONVEX_SERVICE_TOKEN}` }, body: JSON.stringify({ id }), signal: AbortSignal.timeout(120_000) });
      if (!response.ok) {
        const retry = response.headers.get("Retry-After");
        if (retry && /^\d+$/.test(retry)) retryAfterMs = Math.min(900_000, Number(retry) * 1000);
        throw new Error(`Document processor returned ${response.status}`);
      }
      const extraction = validateExtraction(await response.json());
      await ctx.runMutation(internal.documents.complete, { id, token, extraction });
    } catch (error) {
      await ctx.runMutation(internal.documents.recover, { id, token, error: error instanceof Error ? error.message : "Document processing failed", ...(retryAfterMs ? { retryAfterMs } : {}) });
    }
    return null;
  }
});

function processEndpoint(): string {
  const endpoint = globalThis.process.env.DOCUMENT_PROCESSOR_URL;
  if (!endpoint || !globalThis.process.env.CONVEX_SERVICE_TOKEN) throw new Error("Document processor is not configured");
  const url = new URL(endpoint);
  if (url.protocol !== "https:") throw new Error("Document processor must use HTTPS");
  return url.toString();
}
