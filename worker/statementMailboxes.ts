import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { DashboardSession } from "../shared/types";
import { mailboxCallback, mailboxOrigin, mailProvider, mailboxScanDate, type MailProvider } from "../shared/statementMailboxes";
import { mailScopes } from "../shared/mailboxHttp";
import { normalizeStatementActor } from "../shared/statements";
import { boundedBytes } from "./documentIntake";
import { statementHash } from "./statements";
const base = "/api/statements/mailboxes";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
const cookieName = "__Host-mailbox-state";
const stateCookie = (value: string, age = 600) => `${cookieName}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`;
const cookie = (request: Request) => request.headers.get("Cookie")?.split(";").map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
const redirect = (result: string) => new Response(null, { status: 303, headers: { Location: `/?view=settings&mailboxResult=${result}`, "Set-Cookie": stateCookie("", 0), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
const random = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), x => x.toString(16).padStart(2, "0")).join("");
const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
export function mailboxAuthorizationUrl(provider: MailProvider, clientId: string, state: string, challenge: string): string {
  const url = new URL(provider === "gmail" ? "https://accounts.google.com/o/oauth2/v2/auth" : "https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
  url.search = new URLSearchParams({ client_id: clientId, redirect_uri: mailboxCallback(provider), response_type: "code", scope: mailScopes[provider], state, code_challenge: challenge, code_challenge_method: "S256", prompt: provider === "gmail" ? "consent select_account" : "select_account", ...(provider === "gmail" ? { access_type: "offline" } : { response_mode: "query" }) }).toString();
  return url.href;
}
// The main session cookie remains Strict. A same-origin POST restores it after
// the provider's cross-site return; no code is exchanged without the member session.
export function mailboxCallbackLanding(request: Request): Response | null {
  const url = new URL(request.url), match = /^\/api\/statements\/mailboxes\/(gmail|outlook)\/callback$/.exec(url.pathname);
  if (!match || request.method !== "GET" || url.origin !== mailboxOrigin) return null;
  const state = url.searchParams.get("state"), code = url.searchParams.get("code");
  if (!state || !/^[a-f0-9]{64}$/.test(state) || state !== cookie(request) || !code || code.length > 10000 || url.searchParams.has("error")) return redirect("authorization_failed");
  const nonce = random();
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Connecting mailbox</title><body><form method="post" action="${url.pathname}"><input type="hidden" name="state" value="${escape(state)}"><input type="hidden" name="code" value="${escape(code)}"><p>Connecting your mailbox…</p><button type="submit">Continue to Statements</button></form><script nonce="${nonce}">history.replaceState(null,"",location.pathname);document.forms[0].submit()</script></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'` } });
}
export async function handleMailboxApi(request: Request, env: Pick<WorkerEnv, "CONVEX_URL" | "CONVEX_SERVICE_TOKEN">, session: DashboardSession | null): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== base && !url.pathname.startsWith(`${base}/`)) return null;
  let actor; try { if (!session) throw new Error(); actor = normalizeStatementActor(session.username); } catch { return json({ message: "Statements access is required" }, 403); }
  if (request.method !== "GET" && request.headers.get("Origin") !== url.origin) return json({ message: "Open this action from Statements" }, 403);
  const client = new ConvexHttpClient(env.CONVEX_URL), auth = { serviceToken: env.CONVEX_SERVICE_TOKEN, actor };
  const providerRoute = /^\/(gmail|outlook)\/(connect|callback)$/.exec(url.pathname.slice(base.length));
  try {
    if (url.pathname === base && request.method === "GET") return json(await client.query(api.statementMailboxes.status, auth));
    if (providerRoute) {
      const provider = mailProvider(providerRoute[1]);
      if (url.origin !== mailboxOrigin) throw new Error("Connect mailboxes from statements.thatcanadian.dev");
      if (providerRoute[2] === "connect" && request.method === "POST") {
        const input = JSON.parse(new TextDecoder().decode(await boundedBytes(request.body, 4096)));
        if (input.approved !== true) throw new Error("Approve automatic document analysis and sharing with your Statements team");
        const state = random(), verifier = random(), scanFrom = mailboxScanDate(input.scanFrom);
        const clientId = await client.mutation(api.statementMailboxes.begin, { ...auth, provider, hash: await statementHash(new TextEncoder().encode(state)), verifier, scanFrom });
        const challenge = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
        return Response.json({ url: mailboxAuthorizationUrl(provider, clientId, state, challenge) }, { headers: { "Cache-Control": "no-store", "Set-Cookie": stateCookie(state) } });
      }
      if (providerRoute[2] === "callback" && request.method === "POST") {
        const form = new URLSearchParams(new TextDecoder().decode(await boundedBytes(request.body, 16000))), state = form.get("state"), code = form.get("code");
        if (!state || !/^[a-f0-9]{64}$/.test(state) || state !== cookie(request) || !code || code.length > 10000) return redirect("authorization_failed");
        await client.action(api.statementMailboxSync.finish, { ...auth, provider, hash: await statementHash(new TextEncoder().encode(state)), code });
        return redirect("connected");
      }
    }
    const connection = /^\/([a-z0-9]+)$/.exec(url.pathname.slice(base.length));
    if (connection && request.method === "POST") {
      const input = JSON.parse(new TextDecoder().decode(await boundedBytes(request.body, 4096)));
      if (input.action !== "disconnect" && input.action !== "scan") throw new Error("Choose a mailbox action");
      await client.mutation(api.statementMailboxes.update, { ...auth, id: connection[1] as Id<"statementMailboxes">, action: input.action, scanFrom: input.scanFrom === undefined ? undefined : mailboxScanDate(input.scanFrom) });
      return json({ saved: true }, 202);
    }
    return json({ message: "Mailbox route not found" }, 404);
  } catch (error) {
    if (providerRoute?.[2] === "callback") return redirect("authorization_failed");
    const raw = error instanceof Error ? error.message : "Mailbox request failed";
    const safe = /Uncaught ConvexError: ([^\n]+)/.exec(raw)?.[1] ?? (raw.startsWith("[CONVEX") ? "Mailbox request failed. Try again." : raw.split("\n")[0]);
    return json({ message: safe.slice(0, 300) }, 400);
  }
}
