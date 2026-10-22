import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { validateTopUpInput, topUpMessage, type TopUpRequest } from "../shared/topUps";
import { boundedBytes, ingestDocument, secureHeaderMatches } from "./documentIntake";
import { documentMaximumBytes } from "../shared/financialDocuments";
import { getDashboardSession } from "./auth";
import { parseTelegramAuthUsers, telegramApi } from "./telegram";
import { draftApi, prepareTopUpDraft } from "./topUpDrafts";
const client = (env: WorkerEnv) => new ConvexHttpClient(env.CONVEX_URL);
const auth = (env: WorkerEnv) => ({ serviceToken: env.CONVEX_SERVICE_TOKEN });
const group = (env: WorkerEnv) => env.TOPUP_TELEGRAM_CHAT_ID;
function telegramPerson(env: WorkerEnv, name: string) { const user = parseTelegramAuthUsers(env.TELEGRAM_AUTH_USERS_JSON)?.find(u => u.normalizedUsername === name.toLowerCase()); if (!user) throw new Error(`${name} is not configured for Telegram`); return user; }
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
async function signature(env: WorkerEnv, id: string, expires: string): Promise<string> { if (!env.AUTH_SESSION_SECRET?.trim()) throw new Error("Invoice link signing is not configured"); const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.AUTH_SESSION_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`topup-invoice:${id}:${expires}`))); return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join(""); }
async function invoiceLink(env: WorkerEnv, id: string): Promise<string> { const expires = String(Date.now() + 30 * 86400_000); const url = new URL(`/api/public/top-ups/${id}/invoice`, env.PUBLIC_APP_URL); url.searchParams.set("expires", expires); url.searchParams.set("token", await signature(env, id, expires)); return url.toString(); }
async function invoice(env: WorkerEnv, id: Id<"topUpRequests">): Promise<Response> { const convex = client(env), r = await convex.query(api.topUps.get, { ...auth(env), id }); if (!r) return json({ message: "Request not found" }, 404); const doc = await convex.query(api.documents.get, { ...auth(env), id: r.documentId }); if (!doc?.url) return json({ message: "Invoice is unavailable" }, 404); const file = await fetch(doc.url, { signal: AbortSignal.timeout(20_000) }); if (!file.ok) throw new Error("Invoice could not be read"); return new Response(file.body, { headers: { "Content-Type": r.contentType, "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(r.fileName)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'self'" } }); }
async function limit(request: Request, env: WorkerEnv, kind: string, maximum: number) { const raw = `${kind}:${request.headers.get("CF-Connecting-IP") ?? "local"}`; const hashed = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw))), b => b.toString(16).padStart(2, "0")).join(""); return client(env).mutation(api.topUps.rateLimit, { ...auth(env), key: hashed, limit: maximum }); }
export async function handlePublicTopUps(request: Request, env: WorkerEnv): Promise<Response | null> {
  const url = new URL(request.url); if (!url.pathname.startsWith("/api/public/top-ups")) return null;
  try {
    const share = /^\/api\/public\/top-ups\/([^/]+)\/invoice$/.exec(url.pathname);
    if (share && request.method === "GET") { const expires = url.searchParams.get("expires") ?? ""; if (!/^\d{13}$/.test(expires) || Number(expires) <= Date.now() || Number(expires) > Date.now() + 31 * 86400_000 || !await secureHeaderMatches(url.searchParams.get("token"), await signature(env, share[1], expires))) return json({ message: "This invoice link has expired or is invalid" }, 403); return invoice(env, share[1] as Id<"topUpRequests">); }
    if (url.pathname === "/api/public/top-ups/options" && request.method === "GET") { if (!await limit(request, env, "search", 500)) return json({ message: "Search limit reached. Try again later." }, 429); return json(await client(env).query(api.topUps.options, { ...auth(env), search: (url.searchParams.get("search") ?? "").slice(0, 200) })); }
    if (url.pathname !== "/api/public/top-ups" || request.method !== "POST") return json({ message: "Not found" }, 404);
    if (request.headers.get("Origin") !== url.origin) return json({ message: "Submit this form from our website" }, 403);
    if (Number(request.headers.get("Content-Length")) > documentMaximumBytes + 20000) return json({ message: "Invoice is too large" }, 413);
    if (!await limit(request, env, "submit", 20)) return json({ message: "Too many requests. Try again in an hour." }, 429);
    const bytes = await boundedBytes(request.body, documentMaximumBytes + 20000);
    const form = await new Request(url, { method: "POST", headers: { "Content-Type": request.headers.get("Content-Type") ?? "" }, body: bytes }).formData();
    if (form.get("website")) return json({ message: "Invalid submission" }, 400);
    const input = validateTopUpInput(JSON.parse(String(form.get("details") ?? "null"))); const convex = client(env);
    const previous = await convex.query(api.topUps.bySubmission, { ...auth(env), submissionId: input.submissionId });
    if (previous) return json({ number: previous.number, status: previous.status });
    const file = form.get("invoice"); if (!(file instanceof File) || !file.size || file.size > documentMaximumBytes) throw new Error("Upload an invoice (PDF, JPG, PNG or WebP, maximum 10 MB)");
    const doc = await ingestDocument(env, { bytes: new Uint8Array(await file.arrayBuffer()), fileName: file.name, contentType: file.type, source: "upload", sourceContext: `Top-up request from ${input.member}; company ${input.companyName}; ${input.notes}`, entity: input.entity });
    const r = await convex.mutation(api.topUps.create, { ...auth(env), input, documentId: doc.id as Id<"financialDocuments"> }); return json({ number: r.number, status: r.status }, 201);
  } catch (e) { return json({ message: e instanceof Error ? e.message.replace(/\[Request ID:.*$/s, "").slice(0, 400) : "Request could not be saved" }, 400); }
}
export async function sendTopUpNotification(env: WorkerEnv, id: Id<"topUpRequests">, version: number): Promise<void> {
  const convex = client(env), r = await convex.query(api.topUps.get, { ...auth(env), id }); if (!r || r.version !== version || r.telegramVersion === version) return;
  if (!group(env)) throw new Error("Top-up Telegram group is not configured");
  const person = r.status === "pending" ? telegramPerson(env, "Amin") : telegramPerson(env, "Ali M");
  const mention = `<a href="tg://user?id=${person.chatId}">${r.status === "pending" ? "@AminGhossein" : "@AliMUser"}</a>`;
  const link = await invoiceLink(env, id);
  const escaped = topUpMessage(r as TopUpRequest, link, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const buttons = r.status === "pending" ? [[{ text: "Approve", callback_data: `tu:approve:${id}:${version}` }, { text: "Adjust amount", callback_data: `tu:adjust:${id}:${version}` }]] : r.status === "approved" ? [[{ text: "Paid", callback_data: `tu:paid:${id}:${version}` }]] : [];
  if (r.telegramMessageId) { try { await telegramApi(env, "editMessageReplyMarkup", { chat_id: group(env), message_id: r.telegramMessageId, reply_markup: { inline_keyboard: [] } }); } catch { /* The state/version check also rejects stale buttons. */ } }
  const message = await telegramApi(env, "sendMessage", { chat_id: group(env), text: `${escaped.replace(/📎 View Invoice: [^\n]+/, `📎 <a href="${link.replace(/&/g, "&amp;")}">View Invoice (${r.contentType === "application/pdf" ? "pdf link" : "file link"})</a>`)}${mention}`, parse_mode: "HTML", link_preview_options: { is_disabled: true }, reply_markup: { inline_keyboard: buttons } }) as { message_id: number };
  await convex.mutation(api.topUps.saveMessage, { ...auth(env), id, version, messageId: message.message_id });
}
export async function handleTopUpTelegram(value: unknown, env: WorkerEnv): Promise<boolean> {
  const update = value as { callback_query?: { id: string; data?: string; from: { id: number }; message?: { message_id: number; chat: { id: number } } }; message?: { chat: { id: number }; from?: { id: number }; text?: string; reply_to_message?: { message_id: number } } };
  const cb = update?.callback_query;
  if (cb?.data?.startsWith("tu:")) {
    let message = "Request updated";
    try {
      if (String(cb.message?.chat.id) !== group(env)) throw new Error("Use the Top-Up Request group");
      const [, action, rawId, rawVersion, extra] = cb.data.split(":"); if (extra || !["approve", "adjust", "paid"].includes(action)) throw new Error("Invalid action");
      const person = telegramPerson(env, action === "paid" ? "Ali M" : "Amin"); if (String(cb.from.id) !== person.chatId) throw new Error(`Only ${person.username} can ${action === "paid" ? "confirm payment" : "approve or adjust"} this request`);
      const id = rawId as Id<"topUpRequests">, version = Number(rawVersion), convex = client(env); const r = await convex.query(api.topUps.get, { ...auth(env), id });
      if (!r || r.version !== version || r.telegramMessageId !== cb.message?.message_id) throw new Error("This message is out of date. Use the latest request message.");
      if (action === "adjust") {
        if (r.status !== "pending") throw new Error("Only pending requests can be adjusted");
        const prompt = await telegramApi(env, "sendMessage", { chat_id: group(env), text: `Amin: reply to this message with the new amount for top-up #${r.number} in ${r.currency} (for example 20800.50). Expires in 10 minutes.`, reply_markup: { force_reply: true, input_field_placeholder: `Amount in ${r.currency}` } }) as { message_id: number };
        await convex.mutation(api.topUps.adjustmentPrompt, { ...auth(env), id, version, promptId: prompt.message_id, userId: person.chatId }); message = "Reply to the amount prompt";
      } else { await convex.mutation(api.topUps.transition, { ...auth(env), id, version, action: action as "approve" | "paid", actor: person.username }); message = action === "paid" ? "Marked paid in the dashboard" : "Approved. Ali M will receive the paid button."; }
    } catch (e) { message = e instanceof Error ? e.message.slice(0, 190) : "Could not update this request"; }
    await telegramApi(env, "answerCallbackQuery", { callback_query_id: cb.id, text: message, show_alert: true }); return true;
  }
  const m = update?.message;
  if (m && String(m.chat?.id) === group(env) && m.reply_to_message && m.from) {
    const convex = client(env); const r = await convex.query(api.topUps.findAdjustment, { ...auth(env), promptId: m.reply_to_message.message_id, userId: String(m.from.id) }); if (!r) return true;
    const raw = m.text?.trim() ?? ""; if (!/^\d+(?:\.\d{1,2})?$/.test(raw) || Number(raw) <= 0) { await telegramApi(env, "sendMessage", { chat_id: group(env), text: "Reply with a positive amount only, with up to two decimals (for example 20800.50)." }); return true; }
    await convex.mutation(api.topUps.transition, { ...auth(env), id: r._id, version: r.version, action: "adjust", actor: "Amin", amount: Number(raw) }); return true;
  }
  return false;
}
export async function handleTopUpApi(request: Request, env: WorkerEnv): Promise<Response | null> {
  const url = new URL(request.url); if (!url.pathname.startsWith("/api/top-ups")) return null;
  try {
    const convex = client(env);
    if (request.method === "GET" && url.pathname === "/api/top-ups") return json(await convex.query(api.topUps.list, { ...auth(env), paginationOpts: { cursor: url.searchParams.get("cursor"), numItems: 200 } }));
    if (request.method === "GET" && url.pathname === "/api/top-ups/summary") return json(await convex.query(api.topUps.summary, auth(env)));
    const match = /^\/api\/top-ups\/([^/]+)(?:\/(invoice|action|draft|draft-options|retry-notification|reconcile-draft))?$/.exec(url.pathname); if (!match) return json({ message: "Not found" }, 404); const id = match[1] as Id<"topUpRequests">;
    if (request.method === "GET" && match[2] === "invoice") return invoice(env, id);
    if (request.method === "GET" && !match[2]) return json(await convex.query(api.topUps.get, { ...auth(env), id }));
    const session = await getDashboardSession(request, env); if (session?.role !== "administrator") return json({ message: "Administrator access required" }, 403);
    if (request.method === "GET" && match[2] === "draft-options") { const bank = await draftApi(env); return json((await bank.accounts()).map(({ id, name, currency, state }) => ({ id, name, currency, state }))); }
    if (request.method !== "POST") return json({ message: "Method not allowed" }, 405);
    if (request.headers.get("Origin") !== url.origin) return json({ message: "Submit this action from the dashboard" }, 403);
    if (match[2] === "retry-notification") { await convex.mutation(api.topUps.retryNotification, { ...auth(env), id }); return json({ ok: true }); }
    const body = JSON.parse(new TextDecoder().decode(await boundedBytes(request.body, 12_000)));
    if (match[2] === "reconcile-draft") {
      const r = await convex.query(api.topUps.get, { ...auth(env), id }); if (!r) throw new Error("Request not found");
      let draftId: string | undefined;
      if (body.draftId) {
        if (typeof body.draftId !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(body.draftId)) throw new Error("Enter a valid Revolut draft ID");
        const bank = await draftApi(env), draft = await bank.draft(body.draftId);
        if (!draft.title?.startsWith(`Top-up #${r.number} · `) || draft.payments?.length !== 1 || draft.payments[0].currency !== r.currency || Math.abs(draft.payments[0].amount - r.amount) > 0.009) throw new Error("This Revolut draft does not match the approved request"); draftId = draft.id;
      }
      await convex.mutation(api.topUps.reconcileDraft, { ...auth(env), id, actor: session.username, confirmedNoDraft: body.confirmedNoDraft === true, ...(draftId ? { draftId } : {}) }); return json({ ok: true });
    }
    if (match[2] === "action") { const actor = session.username; return json(await convex.mutation(api.topUps.transition, { ...auth(env), id, version: body.version, action: body.action, amount: body.amount, actor })); }
    if (match[2] === "draft") { if (body.reviewed !== true || typeof body.sourceAccountId !== "string") throw new Error("Verify the invoice and funding account first"); await prepareTopUpDraft(env, id, body); return json(await convex.query(api.topUps.get, { ...auth(env), id })); }
    return json({ message: "Not found" }, 404);
  } catch (e) { return json({ message: e instanceof Error ? e.message.slice(0, 500) : "Request could not be completed" }, 400); }
}
export async function topUpSetup(env: WorkerEnv): Promise<unknown> {
  const bot = await telegramApi(env, "getMe", {}) as { id: number; username: string };
  const recipients = ["Amin", "Ali M"].map(name => telegramPerson(env, name).username);
  try {
    const chat = await telegramApi(env, "getChat", { chat_id: group(env) }) as { title: string };
    const member = await telegramApi(env, "getChatMember", { chat_id: group(env), user_id: bot.id }) as { status: string };
    const membership = await Promise.all(recipients.map(async name => { try { const person = telegramPerson(env, name); const info = await telegramApi(env, "getChatMember", { chat_id: group(env), user_id: Number(person.chatId) }) as { status: string }; return { username: name, status: info.status }; } catch { return { username: name, status: "unknown" }; } }));
    const ready = !["left", "kicked"].includes(member.status) && membership.every(m => !["left", "kicked", "unknown"].includes(m.status));
    return { botUsername: bot.username, groupId: group(env), groupTitle: chat.title, botStatus: member.status, ready, recipients, membership, ...(ready ? {} : { message: "Ensure Amin and Ali M are members of the Top-Up Request group and the bot can send messages" }), alaaConfigured: !!env.TELEGRAM_TOPUP_USERS_JSON };
  } catch { return { botUsername: bot.username, groupId: group(env), ready: false, message: "Add this bot to the Top-Up Request group and allow it to send messages", recipients, alaaConfigured: !!env.TELEGRAM_TOPUP_USERS_JSON }; }
}
