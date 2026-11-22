import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { DashboardSession } from "../shared/types";
import { financeReviewAccess, ownerReviewAccess } from "../shared/dashboardAccess";
import { monthLabel, ownerForLogin, owners, type ReviewAddresses } from "../shared/ownerReview";
import { boundedBytes, secureHeaderMatches } from "./documentIntake";

type Env = Pick<WorkerEnv, "CONVEX_URL" | "CONVEX_SERVICE_TOKEN" | "OWNER_REVIEW_EMAIL">;
function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}
async function readInput(request: Request): Promise<Record<string, unknown>> {
  const body = JSON.parse(new TextDecoder().decode(await boundedBytes(request.body, 12000)));
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid request");
  return body;
}

export async function handleOwnerReview(request: Request, env: Env, session: DashboardSession) {
  const url = new URL(request.url);
  const finance = session.role === "administrator" || session.role === "finance-operator";
  const owner = session.role === "owner" ? ownerForLogin(session.username) : null;
  if (!(finance && financeReviewAccess(request)) && !(owner && ownerReviewAccess(request))) return json({ message: "Access denied" }, 403);
  if (request.method === "POST" && request.headers.has("Origin") && request.headers.get("Origin") !== url.origin) return json({ message: "Origin mismatch" }, 403);
  let input: Record<string, unknown> = {};
  if (request.method === "POST") {
    try { input = await readInput(request); } catch { return json({ message: "Invalid review request" }, 400); }
  }
  const db = new ConvexHttpClient(env.CONVEX_URL);
  const auth = { serviceToken: env.CONVEX_SERVICE_TOKEN };
  const id = (request.method === "POST" ? input.id : url.searchParams.get("id")) as Id<"ownerReviews">;
  const cursor = url.searchParams.get("cursor");
  try {
    switch (url.pathname) {
      case "/api/monthly-review/list": return json(await db.query(api.ownerReviews.list, { ...auth, finance, cursor }));
      case "/api/monthly-review/contacts":
        if (request.method === "GET") return json(await db.query(api.ownerReviews.contacts, auth));
        return json(await db.mutation(api.ownerReviews.saveContacts, { ...auth, addresses: input.addresses as ReviewAddresses }));
      case "/api/monthly-review/publish":
        return json(await db.mutation(api.ownerReviews.publish, { ...auth, period: String(input.period), actor: session.username,
          importId: String(input.importId), expectedRevision: Number(input.expectedRevision) }));
      case "/api/monthly-review/report": return json(await db.query(api.ownerReviews.report, { ...auth, id, owner: owner! }));
      case "/api/monthly-review/transactions": return json(await db.query(api.ownerReviews.transactions, { ...auth, id, cursor }));
      case "/api/monthly-review/decision":
        if (input.state !== "approved" && input.state !== "changes") return json({ message: "Choose a review decision" }, 400);
        return json(await db.mutation(api.ownerReviews.decide, { ...auth, id, owner: owner!, state: input.state, comment: String(input.comment ?? "") }));
      case "/api/monthly-review/retry-email": {
        const recipient = owners.find(name => name === input.owner);
        if (!recipient) return json({ message: "Unknown recipient" }, 400);
        return json(await db.mutation(api.ownerReviews.retryEmail, { ...auth, id, owner: recipient }));
      }
      default: return json({ message: "Unknown review action" }, 404);
    }
  } catch (e) {
    if (e instanceof ConvexError && typeof e.data === "string") return json({ message: e.data }, 409);
    return json({ message: "The monthly review request could not be completed. Reload and try again." }, 502);
  }
}

export async function sendOwnerReviewEmail(request: Request, env: Env) {
  if (request.method !== "POST" || !env.CONVEX_SERVICE_TOKEN || !await secureHeaderMatches(request.headers.get("Authorization"), "Bearer " + env.CONVEX_SERVICE_TOKEN)) return json({ message: "Unauthorized" }, 401);
  if (!env.OWNER_REVIEW_EMAIL) return json({ message: "Email sending is not configured" }, 503);
  try {
    const { owner, period, id, email, revision } = await readInput(request);
    if (!owners.some(name => name === owner) || typeof id !== "string" || !/^[a-zA-Z0-9]+$/.test(id)
      || typeof email !== "string" || typeof period !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(period)
      || typeof revision !== "number" || !Number.isInteger(revision)) return json({ message: "Invalid publication" }, 400);
    const month = monthLabel(period);
    const link = "https://finance.thatcanadian.dev/?page=owner&review=" + encodeURIComponent(id);
    const intro = "Finance has published " + month + " (version " + revision + ") for your review.";
    const action = "Sign in to review the figures, approve the month, or request changes.";
    await env.OWNER_REVIEW_EMAIL.send({ from: "reviews@finance.thatcanadian.dev", to: email, subject: month + " is ready for your sign-off",
      text: "Hi " + owner + ",\n\n" + intro + " " + action + "\n\n" + link,
      html: "<p>Hi " + owner + ",</p><p>" + intro + " " + action + '</p><p><a href="' + link.replaceAll("&", "&amp;") + '">Review ' + month + "</a></p>" });
    return json({ accepted: true });
  } catch (e) {
    const code = e && typeof e === "object" && "code" in e && typeof e.code === "string" && /^E_[A-Z_]+$/.test(e.code) ? e.code : null;
    return json({ message: code || "Email acceptance could not be confirmed." }, code ? 422 : 502);
  }
}
