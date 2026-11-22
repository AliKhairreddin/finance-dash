import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { owner } from "./ownerReviewSchema";

export const deliver = internalAction({
  args: { id: v.id("ownerReviews"), owner, attempt: v.number() }, returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.runMutation(internal.ownerReviews.claimMail, args);
    if (!job) return null;
    let state: "sent" | "failed" | "unconfirmed" = "failed";
    let error = "Email processor is not configured.";
    const base = process.env.DOCUMENT_PROCESSOR_URL;
    const token = process.env.CONVEX_SERVICE_TOKEN;
    if (base && token) {
      try {
        const response = await fetch(new URL("/api/internal/owner-review/email", base), {
          method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
          body: JSON.stringify({ ...job, id: args.id, owner: args.owner }), signal: AbortSignal.timeout(45000)
        });
        state = response.ok ? "sent" : response.status === 502 ? "unconfirmed" : "failed";
        const result = await response.json().catch(() => null) as { message?: string } | null;
        error = response.ok ? "" : result?.message?.slice(0, 160) || "Email service returned " + response.status + ".";

      } catch {
        state = "unconfirmed";
        error = "Delivery was not confirmed. Check with the owner before resending.";
      }
    }
    await ctx.runMutation(internal.ownerReviews.finishMail, { ...args, state, error });
    return null;
  }
});
