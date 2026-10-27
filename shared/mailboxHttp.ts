import { readBoundedResponseJson } from "./boundedHttp";
import type { MailProvider } from "./statementMailboxes";
export class MailboxHttpError extends Error {
  constructor(message: string, public status: number, public delay = 60_000) { super(message); }
}
export const mailScopes = { gmail: "https://www.googleapis.com/auth/gmail.readonly", outlook: "offline_access https://graph.microsoft.com/Mail.Read https://graph.microsoft.com/User.Read" };
export const mailTokenUrl = (provider: MailProvider) => provider === "gmail" ? "https://oauth2.googleapis.com/token" : "https://login.microsoftonline.com/common/oauth2/v2.0/token";
export function mailboxUrl(value: string, provider: MailProvider): string {
  const url = new URL(value);
  if (url.username || url.password || url.hash || (provider === "gmail" ? url.origin !== "https://gmail.googleapis.com" || !url.pathname.startsWith("/gmail/v1/users/me/") : url.origin !== "https://graph.microsoft.com" || !url.pathname.startsWith("/v1.0/me"))) throw new Error("Invalid mailbox API destination");
  return url.href;
}
export async function mailboxResponse(url: string, bearer: string | null, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (bearer) headers.set("Authorization", `Bearer ${bearer}`);
  const response = await fetch(url, { ...init, headers, redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    const retry = response.headers.get("Retry-After"), parsed = retry ? (/^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()) : 60_000;
    let status = response.status;
    if (status === 403 && new URL(url).hostname === "gmail.googleapis.com") {
      // Gmail also reports quota exhaustion as 403. Inspect only documented
      // reason codes; never expose the provider body or its message text.
      try {
        const details = await readBoundedResponseJson<{ error?: { errors?: Array<{ reason?: string }> } }>(response, "Mailbox provider", 64000);
        if (details.error?.errors?.some(item => ["userRateLimitExceeded", "rateLimitExceeded", "dailyLimitExceeded", "quotaExceeded"].includes(item.reason ?? ""))) status = 429;
      } catch { /* A malformed error body remains a permission error. */ }
    } else await response.body?.cancel();
    throw new MailboxHttpError(status === 401 || status === 403 ? "Mailbox access was denied. Reconnect and approve read access." : status === 429 ? "Mailbox provider rate limit reached. Scanning will retry after the provider's delay." : status >= 500 ? "The mailbox provider is temporarily unavailable." : `The mailbox provider rejected the request (${status}).`, status, Number.isFinite(parsed) ? Math.max(60_000, parsed) : 60_000);
  }
  return response;
}
export async function mailboxJson(url: string, bearer: string | null, init: RequestInit = {}, maximum = 1024 * 1024): Promise<Record<string, unknown>> {
  const value = await readBoundedResponseJson<unknown>(await mailboxResponse(url, bearer, init), "Mailbox provider", maximum);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Mailbox provider returned an invalid response");
  return value as Record<string, unknown>;
}
export async function mailboxEncrypt(value: string, secret: string): Promise<string> {
  if (!/^[a-f0-9]{64}$/i.test(secret)) throw new Error("Mailbox credential encryption is not configured");
  const bytes = Uint8Array.from(secret.match(/../g)!, h => parseInt(h, 16));
  const key = await crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt"]), iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode("statements-mailboxes-v1") }, key, new TextEncoder().encode(value)));
  return `${Array.from(iv, x => x.toString(16).padStart(2, "0")).join("")}.${Array.from(encrypted, x => x.toString(16).padStart(2, "0")).join("")}`;
}
export async function mailboxDecrypt(value: string, secret: string): Promise<string> {
  if (!/^[a-f0-9]{64}$/i.test(secret) || !/^[a-f0-9]{24}\.[a-f0-9]+$/.test(value)) throw new Error("Mailbox credential encryption is unavailable");
  const fromHex = (s: string) => Uint8Array.from(s.match(/../g)!, h => parseInt(h, 16));
  const [nonce, encrypted] = value.split(".");
  const key = await crypto.subtle.importKey("raw", fromHex(secret), "AES-GCM", false, ["decrypt"]);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromHex(nonce), additionalData: new TextEncoder().encode("statements-mailboxes-v1") }, key, fromHex(encrypted)));
}
export function mailboxList(provider: MailProvider, from: number, to: number, cursor?: string): string {
  if (provider === "outlook") {
    if (cursor) { const safe = mailboxUrl(cursor, provider); if (new URL(safe).pathname !== "/v1.0/me/messages") throw new Error("Invalid Outlook message cursor"); return safe; }
    const url = new URL("https://graph.microsoft.com/v1.0/me/messages");
    url.search = new URLSearchParams({ "$select": "id", "$top": "10", "$filter": `receivedDateTime ge ${new Date(from).toISOString()} and receivedDateTime lt ${new Date(to).toISOString()} and isDraft eq false`, "$orderby": "receivedDateTime asc" }).toString();
    return url.href;
  }
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  url.search = new URLSearchParams({ maxResults: "10", q: `after:${Math.floor(from / 1000) - 1} before:${Math.ceil(to / 1000)} -in:spam -in:trash -in:drafts`, ...(cursor ? { pageToken: cursor } : {}) }).toString();
  return url.href;
}
export function mailboxPage(provider: MailProvider, value: Record<string, unknown>): { ids: string[]; next?: string } {
  const rows = provider === "gmail" ? value.messages : value.value;
  // Gmail legitimately omits messages for an empty page, but includes resultSizeEstimate.
  if (!Array.isArray(rows) && !(provider === "gmail" && rows === undefined && value.resultSizeEstimate === 0)) throw new Error("Mailbox provider returned an incomplete message page");
  const ids = (rows ?? []) as unknown[];
  if (ids.length > 10 || ids.some(row => !row || typeof row !== "object" || typeof (row as { id?: unknown }).id !== "string" || !(row as { id: string }).id || (row as { id: string }).id.length > 1000)) throw new Error("Mailbox provider returned invalid message IDs");
  const next = provider === "gmail" ? value.nextPageToken : value["@odata.nextLink"];
  if (next !== undefined && (typeof next !== "string" || !next || next.length > 16000)) throw new Error("Mailbox provider returned an invalid page cursor");
  return { ids: [...new Set(ids.map(row => (row as { id: string }).id))], next: next as string | undefined };
}
export async function mailboxBytes(response: Response, maximum: number): Promise<Uint8Array<ArrayBuffer>> {
  if (!response.body) throw new Error("Mailbox message body is missing");
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > maximum) throw new Error("Mailbox message exceeds the import size limit"); chunks.push(next.value); }
  } catch (error) { await reader.cancel(); throw error; } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return bytes;
}
