import { v } from "convex/values";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { exactOrigin, exactRedirectUri, exactResources, exactRows, exactInitialUrl, exactSafeUrl, exactCleanRow, exactCursor, exactWritePaths, type ExactWriteKind, exactDate } from "../shared/exact";
import { exactHttp, ExactHttpError, exactEncrypt, exactDecrypt } from "../shared/exactHttp";

type Tokens = { access_token: string; refresh_token: string; expires_in: number };
type Work = { type: "none" } | { type: "discover"; connection: Doc<"exactConnections"> } | { type: "dataset"; dataset: Doc<"exactDatasets"> } | { type: "operation"; operation: Doc<"exactOperations"> };
function encryptionKey() { const key = process.env.EXACT_ENCRYPTION_KEY; if (!key) throw new Error("Exact credential encryption is not configured"); return key; }
function tokens(value: unknown): Tokens {
  const row = value as Partial<Tokens> | null;
  if (!row || typeof row.access_token !== "string" || typeof row.refresh_token !== "string" || typeof row.expires_in !== "number" || row.expires_in < 1 || row.access_token.length > 10000 || row.refresh_token.length > 10000) throw new Error("Exact returned invalid authorization credentials");
  return row as Tokens;
}
async function exchange(params: Record<string, string>) {
  const clientId = process.env.EXACT_CLIENT_ID, clientSecret = process.env.EXACT_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Exact app credentials have not been configured");
  return tokens((await exactHttp(`${exactOrigin}/api/oauth2/token`, null, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }) })).value);
}
async function accessToken(ctx: ActionCtx, c: Doc<"exactConnections">, token: string): Promise<string> {
  if (!c.encryptedTokens) throw new Error("Connect Exact first");
  let saved = tokens(JSON.parse(await exactDecrypt(c.encryptedTokens, encryptionKey())));
  if (!c.expiresAt || c.expiresAt <= Date.now() + 30_000) {
    try {
      saved = await exchange({ grant_type: "refresh_token", refresh_token: saved.refresh_token });
      // Persist the rotated refresh token before any subsequent API call.
      await ctx.runMutation(internal.exact.saveConnection, { token, encryptedTokens: await exactEncrypt(JSON.stringify(saved), encryptionKey()), expiresAt: Date.now() + saved.expires_in * 1000 });
    } catch { throw new ExactHttpError("Exact credentials could not be refreshed safely; reconnect Exact", 401); }
  }
  return saved.access_token;
}
export const finishAuthorization = action({ args: { serviceToken: v.string(), actor: v.string(), hash: v.string(), code: v.string() }, returns: v.null(), handler: async (ctx, args) => {
  await ctx.runMutation(internal.exact.consumeOAuthState, { serviceToken: args.serviceToken, actor: args.actor, hash: args.hash });
  const token = crypto.randomUUID();
  const claimed: string | null = await ctx.runMutation(internal.exact.claim, { token, connecting: true });
  if (!claimed) throw new Error("Exact is busy. Start the connection again in a moment");
  try {
    if (!args.code || args.code.length > 2000) throw new Error("Invalid Exact authorization code");
    const saved = await exchange({ grant_type: "authorization_code", code: args.code, redirect_uri: exactRedirectUri });
    const me = exactRows((await exactHttp(`${exactOrigin}/api/v1/current/Me?$select=UserID,FullName,CurrentDivision`, saved.access_token)).value).rows[0];
    if (!me || typeof me.UserID !== "string" || !Number.isSafeInteger(me.CurrentDivision)) throw new Error("Exact user identity could not be verified");
    await ctx.runMutation(internal.exact.saveConnection, { token, encryptedTokens: await exactEncrypt(JSON.stringify(saved), encryptionKey()), expiresAt: Date.now() + saved.expires_in * 1000, userId: me.UserID, user: String(me.FullName ?? "Exact user"), currentDivision: Number(me.CurrentDivision) });
    await ctx.runMutation(internal.exact.release, { token, delay: 1300 });
  } catch {
    await ctx.runMutation(internal.exact.release, { token, delay: 60_000, reconnect: true, error: "Exact connection could not be completed. Start a fresh authorization for the same Exact user." });
    throw new Error("Exact connection could not be completed. Start Connect Exact again");
  }
  return null;
} });
export const pump = internalAction({ args: {}, returns: v.null(), handler: async ctx => {
  const token = crypto.randomUUID();
  const claimed: string | null = await ctx.runMutation(internal.exact.claim, { token }); if (!claimed) return null;
  let work: Work = { type: "none" }, delay = 1300, startedWrite = false;
  try {
    const c: Doc<"exactConnections"> = JSON.parse(claimed);
    work = JSON.parse(await ctx.runQuery(internal.exact.work, {})) as Work;
    if (work.type === "none") { await ctx.runMutation(internal.exact.release, { token, delay: 5 * 60_000 }); return null; }
    const bearer = await accessToken(ctx, c, token);
    if (work.type === "discover") {
      const co = work.connection;
      const path = `/api/v1/${co.currentDivision}/system/Divisions`, run = co.discoveryRun ?? Date.now();
      const url = co.discoveryPage ? exactSafeUrl(co.discoveryPage, path) : `${exactOrigin}${path}?$select=Code,Description,Hid,Currency,DivisionMoveDate,DivisionHRLinkUnlinkDate`;
      const response = await exactHttp(url, bearer); delay = response.delay;
      const page = exactRows(response.value);
      const rows = page.rows.map(row => {
        if (!Number.isSafeInteger(row.Code) || Number(row.Code) <= 0 || typeof row.Description !== "string") throw new Error("Exact returned an invalid company list");
        return { division: Number(row.Code), name: row.Description, code: String(row.Hid ?? row.Code), currency: String(row.Currency ?? ""), active: true, moveDate: [row.DivisionHRLinkUnlinkDate, row.DivisionMoveDate].map(exactDate).filter(Boolean).sort().at(-1) ?? "", discoveredAt: run };
      });
      await ctx.runMutation(internal.exact.discovered, { token, run, rows, next: page.next ? exactSafeUrl(page.next, path) : undefined });
    } else if (work.type === "dataset") {
      const ds = await ctx.runMutation(internal.exact.beginDataset, { token, id: work.dataset._id });
      const path = `/api/v1/${ds.division}/${exactResources[ds.kind].path}`;
      const url = ds.nextUrl ? exactSafeUrl(ds.nextUrl, path) : exactInitialUrl(ds.division, ds.kind, ds.cursor);
      const response = await exactHttp(url, bearer); delay = response.delay;
      const page = exactRows(response.value), rows = page.rows.map(row => exactCleanRow(ds.kind, row));
      let cursor = ds.cursor;
      if (exactResources[ds.kind].sync) for (const row of rows) { const value = exactCursor(row.Timestamp); if (BigInt(value) > BigInt(cursor)) cursor = value; }
      if (page.next && page.next === url) throw new Error("Exact returned a repeating page cursor");
      const next = page.next ? exactSafeUrl(page.next, path) : undefined, batchSize = ds.kind === "deleted" ? 20 : 200;
      // Checkpoint only after the whole provider page has been persisted. Interrupted
      // batches replay safely by provider ID instead of losing the uncommitted tail.
      for (let offset = 0; offset < Math.max(1, rows.length); offset += batchSize) await ctx.runMutation(internal.exact.applyPage, { token, id: ds._id, rows: rows.slice(offset, offset + batchSize), cursor, next, commitPage: offset + batchSize >= rows.length });
    } else {
      const op = work.operation;
      const path = `${exactOrigin}/api/v1/${op.division}/${op.kind === "attachment" ? "documents/DocumentAttachments" : exactWritePaths[op.kind as ExactWriteKind]}`;
      let payloadJson = op.payloadJson;
      if (op.kind === "attachment") {
        const saved = JSON.parse(op.payloadJson) as { storageId: Id<"_storage">; Document: string; FileName: string };
        const file = await ctx.storage.get(saved.storageId); if (!file || file.size > 3 * 1024 * 1024) throw new ExactHttpError("The saved attachment is unavailable or too large", 400);
        const bytes = new Uint8Array(await file.arrayBuffer()); let binary = "";
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        payloadJson = JSON.stringify({ Document: saved.Document, FileName: saved.FileName, Attachment: btoa(binary) });
      }
      if (op.method === "PUT") {
        const response = await exactHttp(`${path}(guid'${op.providerId}')?$select=Modified`, bearer); delay = response.delay;
        const envelope = response.value as { d?: { Modified?: string; results?: Array<{ Modified?: string }> } };
        const current = envelope.d?.results?.[0] ?? envelope.d;
        if (!current || String(current.Modified) !== op.expectedModified) throw new ExactHttpError("This record changed in Exact. Synchronize and review it again before editing", 409);
      }
      if (op.method === "PUT") {
        if (delay > 30_000) throw new ExactHttpError("Exact has reached its request limit. Update the records and try again later", 429, delay);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      await ctx.runMutation(internal.exact.operationState, { token, id: op._id, state: "running" }); startedWrite = true;
      const response = await exactHttp(op.method === "PUT" ? `${path}(guid'${op.providerId}')` : path, bearer, { method: op.method, headers: { "Content-Type": "application/json" }, body: payloadJson }); delay = response.delay;
      await ctx.runMutation(internal.exact.operationState, { token, id: op._id, state: "succeeded", message: "Saved in Exact. The synchronized view will update shortly." });
    }
    await ctx.runMutation(internal.exact.release, { token, delay });
  } catch (error) {
    const http = error instanceof ExactHttpError ? error : null;
    const message = http?.message ?? "Exact synchronization could not be completed. Saved records have been preserved.";
    delay = Math.max(http?.delay ?? 60_000, 60_000);
    if (work.type === "dataset") await ctx.runMutation(internal.exact.datasetFailed, { token, id: work.dataset._id, message, delay, denied: http?.status === 403 });
    if (work.type === "operation") await ctx.runMutation(internal.exact.operationState, { token, id: work.operation._id, state: startedWrite && (!http || http.status >= 500 || http.status === 408) ? "uncertain" : "failed", message: startedWrite && !http ? "Exact may have saved this change. Check the synchronized records before creating another request." : message });
    await ctx.runMutation(internal.exact.release, { token, delay, error: message, reconnect: http?.status === 401 });
  }
  return null;
} });
export const download = action({ args: { serviceToken: v.string(), actor: v.string(), division: v.number(), providerId: v.string() }, returns: v.object({ fileName: v.string(), base64: v.string() }), handler: async (ctx, args) => {
  const fileName: string = await ctx.runQuery(internal.exact.fileAccess, args), token = crypto.randomUUID();
  const claimed: string | null = await ctx.runMutation(internal.exact.claim, { token }); if (!claimed) throw new Error("Exact is synchronizing. Try the download again in a moment");
  try {
    const bearer = await accessToken(ctx, JSON.parse(claimed) as Doc<"exactConnections">, token);
    const response = await exactHttp(`${exactOrigin}/api/v1/${args.division}/documents/DocumentAttachments(guid'${args.providerId}')?$select=Attachment,FileName`, bearer);
    const envelope = response.value as { d?: { Attachment?: string; results?: Array<{ Attachment?: string }> } };
    const row = envelope.d?.results?.[0] ?? envelope.d;
    if (!row?.Attachment || typeof row.Attachment !== "string" || row.Attachment.length > 4 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(row.Attachment)) throw new Error("Exact returned an invalid or oversized attachment");
    await ctx.runMutation(internal.exact.release, { token, delay: response.delay });
    return { fileName, base64: row.Attachment };
  } catch (error) { await ctx.runMutation(internal.exact.release, { token, delay: error instanceof ExactHttpError ? error.delay : 60_000, reconnect: error instanceof ExactHttpError && error.status === 401 }); throw new Error(error instanceof ExactHttpError ? error.message : "The Exact attachment could not be downloaded"); }
} });
