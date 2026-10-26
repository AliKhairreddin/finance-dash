import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { DashboardSession } from "../shared/types";
import { exactOrigin, exactRedirectUri, isExactKind, exactWriteKinds, type ExactWriteKind } from "../shared/exact";
import { normalizeStatementActor } from "../shared/statements";
import { boundedBytes } from "./documentIntake";
import { statementHash } from "./statements";
import { readBoundedResponseJson } from "../shared/boundedHttp";

type Env = Pick<WorkerEnv, "CONVEX_URL" | "CONVEX_SERVICE_TOKEN">;
const base = "/api/statements/exact";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
const stateCookie = (state: string, age = 600) => `__Host-exact-state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
const redirect = (result: string) => new Response(null, { status: 303, headers: { Location: `/?view=exact&exactResult=${result}`, "Set-Cookie": stateCookie("", 0), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
function division(value: unknown): number { const n = Number(value); if (!Number.isSafeInteger(n) || n < 1) throw new Error("Choose an authorized Exact company"); return n; }
async function body(request: Request): Promise<Record<string, unknown>> { const result = JSON.parse(new TextDecoder().decode(await boundedBytes(request.body, 64000))); if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Invalid request"); return result; }
// The dashboard keeps a Strict session cookie. Exact's cross-site return first
// renders a same-origin form; submitting it restores the cookie without weakening
// session protection or exchanging a code before the member is authenticated.
export function exactCallbackLanding(request: Request): Response | null {
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== new URL(exactRedirectUri).origin || url.pathname !== `${base}/callback` || url.searchParams.get("resume") === "1") return null;
  const state = url.searchParams.get("state"), cookie = request.headers.get("Cookie")?.split(";").map(x => x.trim()).find(x => x.startsWith("__Host-exact-state="))?.slice("__Host-exact-state=".length);
  if (!state || state.length !== 72 || state !== cookie || !url.searchParams.get("code") || url.searchParams.has("error")) return redirect("authorization_failed");
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Connecting Exact</title><body><form action="${base}/callback" method="get"><input type="hidden" name="state" value="${escape(state)}"><input type="hidden" name="code" value="${escape(url.searchParams.get("code")!)}"><input type="hidden" name="resume" value="1"><p>Finishing your Exact connection…</p><button type="submit">Continue to Statements</button></form><script nonce="${nonce}">document.forms[0].submit()</script></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'` } });
}
export async function handleExactApi(request: Request, env: Env, session: DashboardSession | null): Promise<Response | null> {
  const url = new URL(request.url); if (!url.pathname.startsWith(`${base}/`)) return null;
  let actor; try { if (!session) throw new Error(); actor = normalizeStatementActor(session.username); } catch { return json({ message: "Statement access is required" }, 403); }
  if (!["GET", "HEAD"].includes(request.method) && request.headers.get("Origin") !== url.origin) return json({ message: "Open this action from Statements" }, 403);
  const client = new ConvexHttpClient(env.CONVEX_URL), auth = { serviceToken: env.CONVEX_SERVICE_TOKEN, actor }, path = url.pathname.slice(base.length);
  try {
    if (path === "/status" && request.method === "GET") return json(await client.query(api.exact.status, auth));
    if (path === "/records" && request.method === "GET") { const kind = url.searchParams.get("kind"); if (!isExactKind(kind) || kind === "deleted") throw new Error("Choose an Exact view"); const selected = url.searchParams.get("division"); return json(await client.query(api.exact.records, { ...auth, kind, division: selected && selected !== "all" ? division(selected) : undefined })); }
    if (path === "/operations" && request.method === "GET") return json(await client.query(api.exact.operations, auth));
    if (path === "/connect" && request.method === "POST") {
      if (url.origin !== new URL(exactRedirectUri).origin) throw new Error("Connect Exact from statements.thatcanadian.dev");
      const clientId = await client.query(api.exact.authorizationClient, auth);
      const state = crypto.randomUUID() + crypto.randomUUID();
      await client.mutation(api.exact.createOAuthState, { ...auth, hash: await statementHash(new TextEncoder().encode(state)) });
      const destination = new URL("/api/oauth2/auth", exactOrigin);
      destination.search = new URLSearchParams({ client_id: clientId, redirect_uri: exactRedirectUri, response_type: "code", state }).toString();
      return Response.json({ url: destination.href }, { headers: { "Set-Cookie": stateCookie(state), "Cache-Control": "no-store" } });
    }
    if (path === "/callback" && request.method === "GET") {
      const state = url.searchParams.get("state"), cookie = request.headers.get("Cookie")?.split(";").map(x => x.trim()).find(x => x.startsWith("__Host-exact-state="))?.slice("__Host-exact-state=".length);
      if (url.origin !== new URL(exactRedirectUri).origin || !state || state.length !== 72 || !cookie || state !== cookie || !url.searchParams.get("code") || url.searchParams.has("error")) return redirect("authorization_failed");
      await client.action(api.exactSync.finishAuthorization, { ...auth, hash: await statementHash(new TextEncoder().encode(state)), code: url.searchParams.get("code")! });
      return redirect("connected");
    }
    if (path === "/sync" && request.method === "POST") { const input = await body(request); await client.mutation(api.exact.resync, { ...auth, division: input.division && input.division !== "all" ? division(input.division) : undefined, full: input.full === true }); return json({ queued: true }, 202); }
    if (path === "/operations" && request.method === "POST") {
      const input = await body(request);
      if (!exactWriteKinds.includes(input.kind as ExactWriteKind) || !input.fields || typeof input.fields !== "object" || Array.isArray(input.fields) || typeof input.requestId !== "string") throw new Error("Invalid Exact change");
      const id = await client.mutation(api.exact.queueOperation, { ...auth, requestId: input.requestId, division: division(input.division), kind: input.kind as ExactWriteKind, providerId: typeof input.providerId === "string" ? input.providerId : undefined, expectedModified: typeof input.expectedModified === "string" ? input.expectedModified : undefined, inputJson: JSON.stringify(input.fields), confirmed: input.confirmed === true }); return json({ id }, 202);
    }
    if (path === "/attachments" && request.method === "POST") {
      const contentType = request.headers.get("Content-Type") ?? ""; if (!contentType.startsWith("multipart/form-data;")) throw new Error("Choose an attachment");
      const form = await new Response(await boundedBytes(request.body, 3 * 1024 * 1024 + 32000), { headers: { "Content-Type": contentType } }).formData();
      const file = form.get("file"); if (!file || typeof file === "string" || !file.size || file.size > 3 * 1024 * 1024) throw new Error("Choose an attachment no larger than 3 MB");
      const uploadUrl = await client.mutation(api.exact.uploadUrl, auth);
      const response = await fetch(uploadUrl, { method: "POST", body: file, headers: { "Content-Type": file.type || "application/octet-stream" }, signal: AbortSignal.timeout(15000) });
      if (!response.ok) { await response.body?.cancel(); throw new Error("Attachment could not be saved"); }
      const stored = await readBoundedResponseJson<{ storageId: Id<"_storage"> }>(response, "Storage", 4096);
      const id = await client.mutation(api.exact.queueAttachment, { ...auth, division: division(form.get("division")), documentId: String(form.get("documentId")), requestId: String(form.get("requestId")), storageId: stored.storageId, fileName: file.name.replace(/[\x00-\x1f/\\]/g, "_").slice(0, 200), confirmed: form.get("confirmed") === "true" }); return json({ id }, 202);
    }
    if (path === "/attachment" && request.method === "GET") {
      const file = await client.action(api.exactSync.download, { ...auth, division: division(url.searchParams.get("division")), providerId: url.searchParams.get("id") ?? "" });
      const bytes = Uint8Array.from(atob(file.base64), ch => ch.charCodeAt(0));
      return new Response(bytes, { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
    }
    return json({ message: "Exact route not found" }, 404);
  } catch (error) {
    if (path === "/callback") return redirect("authorization_failed");
    const raw = error instanceof Error ? error.message : "Exact request failed";
    const safe = /Uncaught ConvexError: ([^\n]+)/.exec(raw)?.[1] ?? (raw.startsWith("[CONVEX") ? "The Exact request failed. Please try again" : raw.split("\n")[0]);
    const message = safe.slice(0, 300);
    return json({ message }, 400);
  }
}
