import { v } from "convex/values";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mailboxProvider } from "./statementMailboxSchema";
import { mailboxCallback, type MailProvider } from "../shared/statementMailboxes";
import { mailboxBytes, mailboxDecrypt, mailboxEncrypt, mailboxJson, mailboxList, mailboxPage, mailboxResponse, mailboxUrl, MailboxHttpError, mailScopes, mailTokenUrl } from "../shared/mailboxHttp";
import { mailboxContent } from "../shared/mailboxContent";

type Tokens = { access_token: string; refresh_token: string; expires_in: number };
const key = () => { if (!process.env.MAILBOX_ENCRYPTION_KEY) throw new Error("Mailbox encryption is not configured"); return process.env.MAILBOX_ENCRYPTION_KEY; };
function tokens(value: Record<string, unknown>, refresh?: string): Tokens {
  const saved = { access_token: value.access_token, refresh_token: value.refresh_token ?? refresh, expires_in: value.expires_in };
  if (typeof saved.access_token !== "string" || !saved.access_token || saved.access_token.length > 20000 || typeof saved.refresh_token !== "string" || !saved.refresh_token || saved.refresh_token.length > 20000 || typeof saved.expires_in !== "number" || !Number.isFinite(saved.expires_in) || saved.expires_in <= 0) throw new Error("The provider did not grant background mailbox access. Reconnect and approve the requested permissions.");
  return saved as Tokens;
}
async function exchange(provider: MailProvider, values: Record<string, string>) {
  const clientId = process.env[provider === "gmail" ? "GMAIL_CLIENT_ID" : "OUTLOOK_CLIENT_ID"], clientSecret = process.env[provider === "gmail" ? "GMAIL_CLIENT_SECRET" : "OUTLOOK_CLIENT_SECRET"];
  if (!clientId || !clientSecret) throw new Error("Mailbox app credentials are not configured");
  return mailboxJson(mailTokenUrl(provider), null, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...values }) });
}
export const finish = action({ args: { serviceToken: v.string(), actor: v.string(), provider: mailboxProvider, hash: v.string(), code: v.string() }, returns: v.null(), handler: async (ctx, args) => {
  const state = await ctx.runMutation(internal.statementMailboxes.consume, { serviceToken: args.serviceToken, actor: args.actor, provider: args.provider, hash: args.hash });
  if (!args.code || args.code.length > 10000) throw new Error("Invalid mailbox authorization code");
  const result = await exchange(args.provider, { grant_type: "authorization_code", code: args.code, code_verifier: state.verifier, redirect_uri: mailboxCallback(args.provider), ...(args.provider === "outlook" ? { scope: mailScopes.outlook } : {}) });
  const saved = tokens(result);
  const scope = typeof result.scope === "string" ? result.scope.split(" ") : [];
  if (args.provider === "gmail" && !scope.includes(mailScopes.gmail)) throw new Error("Approve Gmail read access before connecting");
  const me = await mailboxJson(args.provider === "gmail" ? "https://gmail.googleapis.com/gmail/v1/users/me/profile" : "https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName", saved.access_token);
  const email = args.provider === "gmail" ? me.emailAddress : me.mail || me.userPrincipalName;
  const accountId = args.provider === "gmail" ? email : me.id;
  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || typeof accountId !== "string" || !accountId || accountId.length > 500) throw new Error("The mailbox identity could not be verified");
  await ctx.runMutation(internal.statementMailboxes.connected, { serviceToken: args.serviceToken, actor: args.actor, provider: args.provider, email: email.toLowerCase(), accountId: args.provider === "gmail" ? accountId.toLowerCase() : accountId, scanFrom: state.scanFrom, encryptedTokens: await mailboxEncrypt(JSON.stringify(saved), key()), expiresAt: Date.now() + saved.expires_in * 1000 });
  return null;
} });
async function accessToken(ctx: ActionCtx, row: Doc<"statementMailboxes">, token: string) {
  let saved = tokens(JSON.parse(await mailboxDecrypt(row.encryptedTokens!, key())));
  if (row.expiresAt <= Date.now() + 60_000) {
    try { saved = tokens(await exchange(row.provider, { grant_type: "refresh_token", refresh_token: saved.refresh_token, ...(row.provider === "outlook" ? { scope: mailScopes.outlook } : {}) }), saved.refresh_token); }
    catch (error) { if (error instanceof MailboxHttpError && [400, 401, 403].includes(error.status)) throw new MailboxHttpError("Mailbox authorization needs to be renewed. Reconnect this mailbox.", 401); throw error; }
    // Persist refresh-token rotation before reading any mail.
    await ctx.runMutation(internal.statementMailboxes.saveTokens, { id: row._id, token, encryptedTokens: await mailboxEncrypt(JSON.stringify(saved), key()), expiresAt: Date.now() + saved.expires_in * 1000 });
  }
  return saved.access_token;
}
export const pump = internalAction({ args: {}, returns: v.null(), handler: async ctx => {
  const ids = await ctx.runQuery(internal.statementMailboxes.due, {});
  for (const id of ids) await ctx.scheduler.runAfter(0, internal.statementMailboxSync.scan, { id });
  return null;
} });
export const scan = internalAction({ args: { id: v.id("statementMailboxes") }, returns: v.null(), handler: async (ctx, args) => {
  const token = crypto.randomUUID(), claimed = await ctx.runMutation(internal.statementMailboxes.claim, { ...args, token });
  if (!claimed) return null;
  const row = JSON.parse(claimed) as Doc<"statementMailboxes">;
  try {
    const bearer = await accessToken(ctx, row, token), url = mailboxList(row.provider, row.windowFrom, row.windowTo, row.cursor);
    const headers = row.provider === "outlook" ? { Prefer: 'IdType="ImmutableId"' } : undefined;
    const page = mailboxPage(row.provider, await mailboxJson(url, bearer, { headers }));
    if (page.next && (page.next === row.cursor || (row.provider === "outlook" && mailboxUrl(page.next, row.provider) === url))) throw new Error("The mailbox provider repeated its page cursor");
    for (const providerId of page.ids) {
      if (Date.now() > row.leaseUntil - 60000) throw new Error("Mailbox batch time limit reached");
      if (await ctx.runQuery(internal.statementMailboxes.seen, { ...args, token, providerId })) continue;
      let raw: Uint8Array<ArrayBuffer>, receivedAt: string;
      try {
        if (row.provider === "gmail") {
          const message = await mailboxJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(providerId)}?format=raw`, bearer, {}, 36 * 1024 * 1024);
          if (typeof message.raw !== "string" || !/^\d+$/.test(String(message.internalDate))) throw new Error("Gmail returned an incomplete message");
          raw = Uint8Array.from(atob(message.raw.replaceAll("-", "+").replaceAll("_", "/")), ch => ch.charCodeAt(0));
          receivedAt = new Date(Number(message.internalDate)).toISOString();
        } else {
          const path = `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(providerId)}`;
          const metadata = await mailboxJson(`${path}?$select=receivedDateTime`, bearer, { headers });
          if (typeof metadata.receivedDateTime !== "string" || !Number.isFinite(Date.parse(metadata.receivedDateTime))) throw new Error("Outlook returned an invalid received date");
          receivedAt = new Date(metadata.receivedDateTime).toISOString();
          raw = await mailboxBytes(await mailboxResponse(`${path}/$value`, bearer, { headers }), 25 * 1024 * 1024);
        }
      } catch (error) {
        // A message deleted between list and read no longer has accessible content.
        if (error instanceof MailboxHttpError && error.status === 404) { await ctx.runMutation(internal.statementMailboxes.record, { ...args, token, providerId, files: [], sender: "", subject: "", sourceContext: "", receivedAt: "", issue: "A message was deleted before it could be imported." }); continue; }
        throw error;
      }
      if (raw.length > 25 * 1024 * 1024) throw new Error("An email exceeds the 25 MB import limit. Import its receipt manually.");
      if (Date.parse(receivedAt) < Date.parse(row.scanFrom) || Date.parse(receivedAt) >= row.windowTo) continue;
      const parsed = await mailboxContent(raw), files: Array<{ storageId: Id<"_storage">; contentHash: string; fileName: string; size: number }> = [];
      const emailRawStorageId = parsed.files.length ? await ctx.storage.store(new Blob([raw], { type: "message/rfc822" })) : undefined;
      for (const file of parsed.files) {
        const storageId = await ctx.storage.store(new Blob([file.bytes], { type: "application/pdf" }));
        files.push({ storageId, contentHash: file.hash, fileName: file.name, size: file.bytes.length });
        // Clean files left by a crash/disconnect. The cleanup checks document
        // references, so it never removes an original committed by a replay.
        await ctx.scheduler.runAfter(12 * 60_000, internal.statementMailboxes.cleanupUploads, { files: [{ storageId, contentHash: file.hash }] });
      }
      await ctx.runMutation(internal.statementMailboxes.record, { ...args, token, providerId, files, emailRawStorageId, sender: parsed.sender, subject: parsed.subject, receivedAt, sourceContext: `Connected mailbox: ${row.email}\n${parsed.sourceContext}`.slice(0, 12000), issue: parsed.issue });
    }
    await ctx.runMutation(internal.statementMailboxes.checkpoint, { ...args, token, cursor: page.next });
  } catch (error) {
    const http = error instanceof MailboxHttpError ? error : null;
    await ctx.runMutation(internal.statementMailboxes.failed, { ...args, token, message: http?.message ?? "Mailbox scan could not finish. Saved documents and scan progress are preserved. Retry the scan or reconnect if it keeps failing.", reconnect: Boolean(http && [401, 403].includes(http.status)), delay: http?.delay ?? 60_000, resetCursor: Boolean(http && [400, 410].includes(http.status) && row.cursor) });
  }
  return null;
} });
