import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { validateExtraction } from "../shared/financialDocuments";

export const process = internalAction({
  args: { id: v.id("financialDocuments") }, returns: v.null(),
  handler: async (ctx, { id }) => {
    const token = crypto.randomUUID();
    if (!await ctx.runMutation(internal.documents.claim, { id, token })) return null;
    try {
      const endpoint = processEndpoint();
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${globalThis.process.env.CONVEX_SERVICE_TOKEN}` }, body: JSON.stringify({ id }), signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`Document processor returned ${response.status}`);
      const extraction = validateExtraction(await response.json());
      await ctx.runMutation(internal.documents.complete, { id, token, extraction });
    } catch (error) {
      await ctx.runMutation(internal.documents.recover, { id, token, error: error instanceof Error ? error.message : "Document processing failed" });
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
