import { ConvexHttpClient } from "convex/browser";
import type { FunctionReturnType } from "convex/server";
import PostalMime from "postal-mime";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { DashboardSession } from "../shared/types";
import { isStatementCompany, statementContext, statementWorkspaces, normalizeStatementActor, parseStatementCsv, statementSortKeys, statementCurrencyScale, validateStatementInput,
  type StatementActor, type StatementCompanyId, type StatementCsvMapping, type StatementTransactionInput } from "../shared/statements";
import { readBoundedResponseJson } from "../shared/boundedHttp";
import { boundedBytes, secureHeaderMatches } from "./documentIntake";
import { assignStatementDocumentCompany, extractStatementDetails, StatementAiError } from "./statementExtraction";
import { extractStatementText, StatementOcrError } from "./statementOcr";

export type StatementEnv = Pick<WorkerEnv, "CONVEX_URL" | "CONVEX_SERVICE_TOKEN" | "OPENROUTER_API_KEY" | "BROWSER">;
export const statementInbox = "statements@finance.thatcanadian.dev";
const maximumFileBytes = 15 * 1024 * 1024;
const maximumEmailBytes = 25 * 1024 * 1024;
const client = (env: StatementEnv) => new ConvexHttpClient(env.CONVEX_URL);
const auth = (env: StatementEnv, actor: StatementActor) => ({ serviceToken: env.CONVEX_SERVICE_TOKEN, actor });
const service = (env: StatementEnv) => ({ serviceToken: env.CONVEX_SERVICE_TOKEN });
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
const string = (value: unknown, maximum = 2000): string => {
  if (typeof value !== "string" || value.length > maximum) throw new Error("Invalid text field");
  return value.trim();
};
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a JSON object"); return value as Record<string, unknown>; }
async function body(request: Request): Promise<Record<string, unknown>> { return object(JSON.parse(new TextDecoder().decode(await boundedBytes(request.body, 1024 * 1024)))); }
function company(value: unknown): StatementCompanyId | undefined {
  if (value === undefined || value === null || value === "" || value === "all" || value === "mix") return undefined;
  if (!isStatementCompany(value)) throw new Error("Choose an included company");
  return value;
}
const fileName = (value: string) => value.replace(/[\x00-\x1f/\\]/g, "_").slice(0, 240) || "document.pdf";
export async function statementHash(bytes: Uint8Array<ArrayBuffer>): Promise<string> { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join(""); }
function inputFields(raw: unknown): StatementTransactionInput {
  const row = object(raw), fields: StatementTransactionInput = { date: string(row.date, 20), description: string(row.description, 1024), amount: string(row.amount, 40), currency: string(row.currency, 8), source: string(row.source, 100), direction: row.direction === "in" ? "in" : row.direction === "out" ? "out" : (() => { throw new Error("Choose money in or money out"); })() };
  const companyId = company(row.companyId); if (companyId) fields.companyId = companyId;
  for (const key of ["financialAccountId", "counterparty", "reference", "account", "providerId", "cardLastFour", "notes", "fee", "balance"] as const) if (row[key] !== undefined && row[key] !== "") fields[key] = string(row[key], key === "notes" ? 2000 : 512);
  validateStatementInput(fields);
  return fields;
}
function mapping(value: unknown): StatementCsvMapping {
  const raw = typeof value === "string" && value ? object(JSON.parse(value)) : value ? object(value) : {};
  const keys = ["date", "description", "amount", "currency", "direction", "source", "account", "providerId", "companyId", "counterparty", "reference", "cardLastFour", "fee", "balance", "notes"];
  const mapped: StatementCsvMapping = {};
  for (const [key, value] of Object.entries(raw)) { if (!keys.includes(key)) throw new Error("Unknown CSV mapping field"); mapped[key as keyof StatementTransactionInput] = string(value, 200); }
  return mapped;
}
function defaults(values: Record<string, unknown>): Partial<StatementTransactionInput> {
  const context = statementContext(String(values.companyId ?? "")), selected = context.companyId ?? company(values.companyId);
  return { ...context, ...(selected ? { companyId: selected } : {}), ...(typeof values.financialAccountId === "string" && values.financialAccountId ? { financialAccountId: values.financialAccountId } : {}), ...(typeof values.source === "string" && values.source.trim() ? { source: string(values.source, 100) } : {}),
    ...(typeof values.account === "string" && values.account.trim() ? { account: string(values.account, 512) } : {}), ...(typeof values.currency === "string" && values.currency.trim() ? { currency: string(values.currency, 8) } : {}) };
}
async function upload(request: Request): Promise<{ bytes: Uint8Array<ArrayBuffer>; name: string; type: "application/pdf" | "text/csv"; values: Record<string, unknown> }> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.startsWith("multipart/form-data;")) throw new Error("Upload the file using multipart/form-data");
  const bytes = await boundedBytes(request.body, maximumFileBytes + 64 * 1024);
  const form = await new Response(bytes, { headers: { "Content-Type": contentType } }).formData();
  const selected = form.get("file");
  if (!selected || typeof selected === "string" || selected.size === 0 || selected.size > maximumFileBytes) throw new Error("Choose a PDF or CSV no larger than 15 MB");
  const data = new Uint8Array(await selected.arrayBuffer()), name = fileName(selected.name);
  const pdf = new TextDecoder("ascii").decode(data.subarray(0, 5)) === "%PDF-";
  if (!pdf && (!/\.csv$/i.test(name) || data.includes(0))) throw new Error("Choose a valid PDF or UTF-8 CSV file");
  const values: Record<string, unknown> = {};
  for (const [key, value] of form.entries()) if (key !== "file" && typeof value === "string") values[key] = value;
  return { bytes: data, name, type: pdf ? "application/pdf" : "text/csv", values };
}
async function saveFile(env: StatementEnv, bytes: Uint8Array<ArrayBuffer>, contentType: string): Promise<Id<"_storage">> {
  const uploadUrl = await client(env).mutation(api.statements.generateUploadUrl, service(env));
  const response = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": contentType }, body: new Blob([bytes]), signal: AbortSignal.timeout(30_000) });
  if (!response.ok) { await response.body?.cancel(); throw new Error("The original file could not be saved"); }
  const result = await readBoundedResponseJson<{ storageId?: string }>(response, "Statement storage", 4096);
  if (!result.storageId) throw new Error("File storage returned no identifier");
  return result.storageId as Id<"_storage">;
}
export async function ingestPdf(env: StatementEnv, input: { bytes: Uint8Array<ArrayBuffer>; name: string; origin: "file" | "email"; actor?: StatementActor; companyId?: StatementCompanyId; financialAccountId?: string;
  sender?: string; subject?: string; messageId?: string; receivedAt?: string; emailRawStorageId?: Id<"_storage">; quarantined: boolean; sourceContext?: string; senderKnown?: boolean }) {
  if (new TextDecoder("ascii").decode(input.bytes.subarray(0, 5)) !== "%PDF-" || input.bytes.length > maximumFileBytes) throw new Error("A valid PDF no larger than 15 MB is required");
  const { bytes, name, ...metadata } = input;
  const storageId = await saveFile(env, bytes, "application/pdf");
  return client(env).mutation(api.statements.ingestDocument, { ...service(env), ...metadata, storageId, contentHash: await statementHash(bytes), fileName: fileName(name), contentType: "application/pdf", size: bytes.length });
}

export async function handleStatementApi(request: Request, env: StatementEnv, session: DashboardSession | null): Promise<Response | null> {
  const url = new URL(request.url), path = url.pathname;
  if (path !== "/api/statements" && !path.startsWith("/api/statements/")) return null;
  let actor: StatementActor;
  try { if (!session) throw new Error(); actor = normalizeStatementActor(session.username); }
  catch { return json({ message: "Statement access is required" }, 403); }
  if (!["GET", "HEAD"].includes(request.method) && request.headers.get("Origin") !== url.origin) return json({ message: "Open this action from the Statement Dashboard" }, 403);
  const convex = client(env), credentials = auth(env, actor), route = path.slice("/api/statements".length);
  try {
    if (route === "/designs" && request.method === "GET") return json(JSON.parse(await convex.query(api.statementDesigns.list, credentials)));
    if (route === "/designs" && request.method === "POST") { const input = await body(request), companyId = company(input.companyId); if (!companyId) throw new Error("Choose a company"); return json(await convex.mutation(api.statementDesigns.save, { ...credentials, companyId, style: string(input.style,100), accent: string(input.accent,7), locked: input.locked === true, expectedVersion: Number(input.expectedVersion), brandingAuthorized: input.brandingAuthorized === true,logoDataUrl:typeof input.logoDataUrl==="string"?string(input.logoDataUrl,180000):undefined })); }
    if (route === "/library" && request.method === "GET") return json(JSON.parse(await convex.query(api.statementLibrary.page, { ...credentials, source: url.searchParams.get("source") === "generated" ? "generated" : "uploaded", cursor: url.searchParams.get("cursor") || undefined })));
    if (route === "/library/actions" && request.method === "POST") { const input = await body(request); return json(JSON.parse(await convex.mutation(api.statementLibrary.action, { ...credentials, source: input.source as "generated"|"uploaded", ids: input.ids as string[], action: input.action as "cancel"|"not_downloaded"|"downloaded" }))); }
    if (route === "/workspace/settings" && request.method === "GET") return json(JSON.parse(await convex.query(api.statementWorkspace.settings, credentials)));
    if (route === "/workspace/policy" && request.method === "POST") { const input = await body(request); const companyId = company(input.companyId); if (!companyId) throw new Error("Choose a legal company"); return json(await convex.mutation(api.statementWorkspace.savePolicy, { ...credentials, companyId, financialAccountId: typeof input.financialAccountId === "string" && input.financialAccountId ? input.financialAccountId : undefined, settingsJson: JSON.stringify(input.settings), revision: Number(input.revision) })); }
    if (route === "/workspace/account" && request.method === "POST") { const input = await body(request); const companyId = company(input.companyId); if (!companyId) throw new Error("Choose a legal company"); return json(await convex.mutation(api.statementWorkspace.saveAccount, { ...credentials, companyId, key: string(input.key,80), name: string(input.name,100), provider: string(input.provider,100), notes: string(input.notes ?? "",2000), historical: input.historical === true, verified: input.verified === true })); }
    if (route === "/workspace/member" && request.method === "POST") { const input = await body(request); return json(await convex.mutation(api.statementWorkspace.saveMember, { ...credentials, memberActor: normalizeStatementActor(string(input.memberActor)), companyIds: (input.companyIds as unknown[]).map(c => { const id = company(c); if (!id) throw new Error("Invalid company"); return id; }), accountIds: input.accountIds as string[], permissions: input.permissions as string[], manage: input.manage === true })); }
    if (route === "/merchants" && request.method === "GET") return json(JSON.parse(await convex.query(api.statementIntelligence.list, credentials)));
    const merchant = /^\/merchants\/([a-zA-Z0-9]+)$/.exec(route);
    if (merchant && request.method === "POST") { const input = await body(request); if (!["approve","discard","research"].includes(String(input.decision))) throw new Error("Invalid review action"); return json(await convex.mutation(api.statementIntelligence.review, { ...credentials, id: merchant[1] as Id<"statementMerchants">, decision: input.decision as "approve"|"discard"|"research", approvedJson: input.profile ? JSON.stringify(input.profile) : undefined, aliases: input.aliases as string[] | undefined })); }
    if (route === "/notifications" && request.method === "GET") return json(JSON.parse(await convex.query(api.statementWorkspace.notifications, credentials)));
    if (route === "/reminders" && request.method === "POST") { const input = await body(request); return json(await convex.mutation(api.statementWorkspace.remind, { ...credentials, transactionId: input.transactionId as Id<"statementTransactions">, dueAt: Number(input.dueAt), message: string(input.message,500) })); }
    const notification = /^\/notifications\/([a-zA-Z0-9]+)$/.exec(route); if (notification && request.method === "POST") return json(await convex.mutation(api.statementWorkspace.readNotification, { ...credentials, id: notification[1] as Id<"statementNotifications"> }));
    if (route === "/bootstrap" && request.method === "GET") return json(await convex.query(api.statements.bootstrap, credentials));
    if (["/transactions","/transactions/export"].includes(route) && request.method === "GET") {
      const sort = url.searchParams.get("sort") ?? "date", order = url.searchParams.get("order") ?? "desc", offset = Number(url.searchParams.get("offset") ?? 0);
      if (!statementSortKeys.includes(sort as typeof statementSortKeys[number]) || !["asc", "desc"].includes(order) || !Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid table sort or page");
      const selectedCompany = url.searchParams.get("companyId") || "all";
      const query = { ...credentials, exporting:route.endsWith("/export"), companyId: selectedCompany, search: url.searchParams.get("search") || undefined,
        status: url.searchParams.get("status") || undefined, currency: url.searchParams.get("currency") || undefined, direction: url.searchParams.get("direction") || undefined, source: url.searchParams.get("source") || undefined,
        from: url.searchParams.get("from") || undefined, to: url.searchParams.get("to") || undefined, sort, order, offset, limit: Number(url.searchParams.get("limit") || 50), ...Object.fromEntries(["financialAccountId", "card", "pdf", "address", "visibility", "amountFrom", "amountTo"].map(key => [key, url.searchParams.get(key) || undefined])), trashed: url.searchParams.get("trash") === "1" };
      type Page=FunctionReturnType<typeof api.statements.listTransactions>;
      const limit=query.exporting?20000:([10,25,50,100].includes(query.limit)?query.limit:50), sums=new Map<string,{inMinor:bigint;outMinor:bigint}>();let cursor:string|undefined,total=0,selected:Page["transactions"]=[];
      const started=Date.now(),key=sort as typeof statementSortKeys[number],factor=order==="asc"?1:-1;
      const compare=(a:Page["transactions"][number],b:Page["transactions"][number])=>{const av=key==="status"&&a.generatedInvoiceId?"ai_generated":a[key]??"",bv=key==="status"&&b.generatedInvoiceId?"ai_generated":b[key]??"";if(key==="amountMinor"){const x=BigInt(av)*10n**BigInt(8-statementCurrencyScale(a.currency)),y=BigInt(bv)*10n**BigInt(8-statementCurrencyScale(b.currency));return factor*(x<y?-1:x>y?1:0)||a._id.localeCompare(b._id);}return factor*String(av).localeCompare(String(bv))||a._id.localeCompare(b._id);};
      do {
        if(Date.now()-started>25000)throw new Error("The saved-data snapshot expired. Narrow the date range and retry; no incomplete totals are shown.");
        const page=await convex.consistentQuery(api.statements.listTransactions,{...query,scan:true,scanCursor:cursor});total+=page.total;
        if(query.exporting&&total>20000)throw new Error("Export supports 20,000 rows per snapshot. Narrow the date range; no partial file was exported.");
        selected=[...selected,...page.transactions].sort(compare).slice(0,offset+limit);
        for(const sum of page.totals){const value=sums.get(sum.currency)??{inMinor:0n,outMinor:0n};value.inMinor+=BigInt(sum.inMinor);value.outMinor+=BigInt(sum.outMinor);sums.set(sum.currency,value);}
        if(page.scanDone)break;if(!page.scanCursor||page.scanCursor===cursor)throw new Error("Incomplete saved-data scan");cursor=page.scanCursor;
      }while(true);
      return json({transactions:selected.slice(offset,offset+limit),total,hasMore:total>offset+limit,offset,truncated:false,totals:[...sums].map(([currency,v])=>({currency,inMinor:String(v.inMinor),outMinor:String(v.outMinor)}))});
    }
    if(route==="/transactions/export"&&request.method==="POST"){const input=await body(request);return json(await convex.query(api.statements.exportSelected,{...credentials,ids:input.ids as Id<"statementTransactions">[]}));}
    if (route === "/transactions" && request.method === "POST") {
      const input = await body(request);
      if (!Array.isArray(input.rows) || !input.rows.length || input.rows.length > 50) throw new Error("Enter between 1 and 50 transactions");
      return json(await convex.mutation(api.statements.createTransactions, { ...credentials, requestId: string(input.requestId, 100), rows: input.rows.map(inputFields) }), 201);
    }
    if (route === "/transactions/actions" && request.method === "POST") {
      const input = await body(request);
      if (!Array.isArray(input.ids) || !input.ids.length || input.ids.length > 50 || input.ids.some(id => typeof id !== "string")) throw new Error("Select between 1 and 50 transactions");
      if (!["reconcile", "complete", "done", "undo_done", "reopen", "trash", "restore", "forget", "undo_forget", "hide", "unhide", "request"].includes(String(input.action))) throw new Error("Choose a valid transaction action");
      return json(await convex.mutation(api.statements.transactionActions, { ...credentials, ids: input.ids as Id<"statementTransactions">[], action: input.action as "reconcile" | "complete" | "reopen" | "trash" | "restore", reason: typeof input.reason === "string" ? string(input.reason) : undefined }));
    }
    const transaction = /^\/transactions\/([a-zA-Z0-9]+)$/.exec(route);
    const transactionLinks = /^\/transactions\/([a-zA-Z0-9]+)\/links$/.exec(route);
    if (transactionLinks && request.method === "GET") return json(await convex.query(api.statements.listLinks, { ...credentials, transactionId: transactionLinks[1] as Id<"statementTransactions"> }));
    if (transaction && request.method === "PATCH") {
      const input = await body(request), expectedRevision = input.revision ?? input.expectedRevision;
      if (!Number.isSafeInteger(expectedRevision) || Number(expectedRevision) < 1) throw new Error("The current transaction revision is required");
      return json(await convex.mutation(api.statements.updateTransaction, { ...credentials, id: transaction[1] as Id<"statementTransactions">, expectedRevision: Number(expectedRevision), fields: inputFields(input), reviewed: input.reviewed === true }));
    }
    if (route === "/imports" && request.method === "GET") return json(await convex.query(api.statements.listImports, { ...credentials, cursor: url.searchParams.get("cursor") || undefined, companyId: url.searchParams.get("companyId") || undefined }));
    if (route === "/imports" && request.method === "POST") {
      const file = await upload(request), context = statementContext(String(file.values.companyId ?? "")), companyId = context.companyId ?? company(file.values.companyId);
      if (file.type === "application/pdf") { const saved = await ingestPdf(env, { bytes: file.bytes, name: file.name, origin: "file", actor, companyId, financialAccountId: typeof file.values.financialAccountId==="string"&&file.values.financialAccountId?file.values.financialAccountId:context.financialAccountId, quarantined: false }); return json({ documentId: saved.id }, 202); }
      const csvText = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes), parsed = parseStatementCsv(csvText, defaults(file.values), mapping(file.values.mapping));
      const storageId = await saveFile(env, file.bytes, "text/csv");
      const result = await convex.mutation(api.statements.stageImport, { ...credentials, fileName: file.name, contentHash: await statementHash(file.bytes), companyId, origin: "file", rows: parsed.rows,
        reviewReasons: [], errors: parsed.errors, storageId, csvText, mappingJson: JSON.stringify({ mapping: parsed.mapping, defaults: defaults(file.values) }) });
      const stored = await convex.query(api.statements.getImport, { ...credentials, id: result });
      return json({ import: stored, headers: parsed.headers, mapping: parsed.mapping, errors: parsed.errors }, 201);
    }
    const imported = /^\/imports\/([a-zA-Z0-9]+)(?:\/(confirm|file))?$/.exec(route);
    if (imported) {
      const id = imported[1] as Id<"statementImports">;
      if (request.method === "POST" && imported[2] === "confirm") { const input = await body(request); return json(await convex.mutation(api.statements.confirmImport, { ...credentials, id, reviewed: input.reviewed === true })); }
      const stored = await convex.query(api.statements.getImport, { ...credentials, id });
      if (!stored) return json({ message: "Import not found" }, 404);
      if (request.method === "GET" && imported[2] === "file") {
        const original = await convex.query(api.statements.getImportFile, { ...credentials, id });
        if (!original?.url) return json({ message: "Original file unavailable" }, 404);
        const response = await fetch(original.url, { signal: AbortSignal.timeout(30_000) });
        if (!response.ok) { await response.body?.cancel(); return json({ message: "The original file could not be loaded" }, 502); }
        return new Response(response.body, { headers: { "Content-Type": stored.csvText !== undefined ? "text/csv; charset=utf-8" : "application/pdf", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(stored.fileName)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
      }
      const savedMapping = stored.mappingJson ? object(JSON.parse(stored.mappingJson)) : {}, savedDefaults = savedMapping.defaults ? object(savedMapping.defaults) : {};
      if (request.method === "PATCH" && !imported[2]) {
        const input = await body(request);
        if (input.rows !== undefined) {
          if (!Array.isArray(input.rows) || !input.rows.length || input.rows.length > 1000) throw new Error("Enter between 1 and 1,000 complete transaction rows");
          const rows = input.rows.map(value => validateStatementInput(inputFields(value)));
          const errors = input.reviewed === true ? [] : stored.errors;
          await convex.mutation(api.statements.updateImport, { ...credentials, id, rows, reviewReasons: stored.reviewReasons, errors, mappingJson: JSON.stringify({ ...savedMapping, manualRows: true }) });
          return json({ import: await convex.query(api.statements.getImport, { ...credentials, id }), headers: [], mapping: mapping(savedMapping.mapping), errors });
        }
        if (stored.csvText === undefined) throw new Error("PDF-derived rows are reviewed from their document");
        const currentDefaults = defaults({ ...savedDefaults, ...input }), parsed = parseStatementCsv(stored.csvText, currentDefaults, mapping(input.mapping));
        await convex.mutation(api.statements.updateImport, { ...credentials, id, rows: parsed.rows, reviewReasons: [], errors: parsed.errors, mappingJson: JSON.stringify({ mapping: parsed.mapping, defaults: currentDefaults }) });
        return json({ import: await convex.query(api.statements.getImport, { ...credentials, id }), headers: parsed.headers, mapping: parsed.mapping, errors: parsed.errors });
      }
      if (request.method === "GET" && !imported[2]) { const parsed = stored.csvText !== undefined ? parseStatementCsv(stored.csvText, defaults(savedDefaults), mapping(savedMapping.mapping)) : { headers: [], mapping: {} }; return json({ import: stored, headers: parsed.headers, mapping: parsed.mapping, errors: stored.errors }); }
    }
    if (route === "/documents" && request.method === "GET") return json(await convex.query(api.statements.listDocuments, { ...credentials, cursor: url.searchParams.get("cursor") || undefined, companyId: url.searchParams.get("companyId") || undefined }));
    if (route === "/documents" && request.method === "POST") {
      const file = await upload(request); if (file.type !== "application/pdf") throw new Error("Upload CSV files from Statements");
      return json(await ingestPdf(env, { bytes: file.bytes, name: file.name, origin: "file", actor, ...statementContext(String(file.values.companyId ?? "")), financialAccountId:typeof file.values.financialAccountId==="string"&&file.values.financialAccountId?file.values.financialAccountId:statementContext(String(file.values.companyId??"")).financialAccountId, quarantined: false }), 202);
    }
    const document = /^\/documents\/([a-zA-Z0-9]+)(?:\/(file|email|retry|link|unlink|suggestions))?$/.exec(route);
    if (document) {
      const id = document[1] as Id<"statementDocuments">;
      if(request.method==="GET"&&document[2]==="suggestions")return json(JSON.parse(await convex.query(api.statements.documentSuggestions,{...credentials,id})));
      if (request.method === "POST" && document[2] === "retry") { const input = await body(request); return json(await convex.mutation(api.statements.retryDocument, { ...credentials, id, releaseQuarantine: input.releaseQuarantine === true })); }
      if (request.method === "POST" && (document[2] === "link" || document[2] === "unlink")) { const input = await body(request); return json(await convex.mutation(api.statements.linkDocument, { ...credentials, id, transactionId: string(input.transactionId, 100) as Id<"statementTransactions">, amount: typeof input.amount === "string" ? string(input.amount, 40) : undefined, note: typeof input.note === "string" ? string(input.note) : undefined, unlink: document[2] === "unlink" || input.unlink === true })); }
      if (request.method === "PATCH" && !document[2]) {
        const input = await body(request);
        if (!["unknown", "invoice", "receipt", "bank_statement", "supporting"].includes(String(input.documentType))) throw new Error("Choose the document type");
        return json(await convex.mutation(api.statements.reviewDocument, { ...credentials, id, companyId: company(input.companyId), financialAccountId: typeof input.financialAccountId === "string" && input.financialAccountId ? string(input.financialAccountId, 80) : undefined, documentType: input.documentType as "unknown" | "invoice" | "receipt" | "bank_statement" | "supporting", extracted: typeof input.extracted === "string" ? string(input.extracted, 300_000) : undefined,
          amount: typeof input.amount === "string" && input.amount ? string(input.amount, 40) : undefined, currency: typeof input.currency === "string" && input.currency ? string(input.currency, 8) : undefined, reviewed: input.reviewed === true }));
      }
      if (request.method === "GET") {
        if (document[2] && !["file", "email"].includes(document[2])) return json({ message: "Method not allowed" }, 405);
        const stored = await convex.query(api.statements.getDocument, { ...credentials, id, metadataOnly:!document[2] });
        if (!stored) return json({ message: "Document not found" }, 404);
        if (!document[2]) return json(stored.document);
        const originalUrl = document[2] === "email" ? stored.emailUrl : stored.url;
        if (!originalUrl) return json({ message: "The original file is unavailable" }, 404);
        const response = await fetch(originalUrl, { signal: AbortSignal.timeout(30_000) });
        if (!response.ok) { await response.body?.cancel(); return json({ message: "The original file could not be loaded" }, 502); }
        if (document[2] === "file" && url.searchParams.get("inline") !== "1") await convex.mutation(api.statementLibrary.action,{...credentials,source:"uploaded",ids:[id],action:"downloaded"});
        return new Response(response.body, { headers: { "Content-Type": document[2] === "email" ? "message/rfc822" : stored.document.contentType, "Content-Disposition": `${url.searchParams.get("inline") === "1" && document[2] !== "email" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(document[2] === "email" ? "original-email.eml" : stored.document.fileName)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox; default-src 'none'" } });
      }
    }
    if (route === "/cards" && request.method === "GET") return json(await convex.query(api.statements.listCards, credentials));
    const card = /^\/cards\/([a-zA-Z0-9]+)$/.exec(route);
    if ((route === "/cards" && request.method === "POST") || (card && request.method === "PATCH")) {
      const input = await body(request), companyId = company(input.companyId); if (!companyId) throw new Error("Select a company");
      return json(await convex.mutation(api.statements.saveCard, { ...credentials, ...(card ? { id: card[1] as Id<"statementCards"> } : {}), companyId, financialAccountId: typeof input.financialAccountId === "string" && input.financialAccountId ? string(input.financialAccountId, 80) : undefined, lastFour: string(input.lastFour, 4), label: typeof input.label === "string" ? string(input.label, 200) : "", source: typeof input.source === "string" ? string(input.source, 100) : undefined, account: typeof input.account === "string" ? string(input.account, 512) : undefined, active: input.active !== false }));
    }
    if (card && request.method === "DELETE") return json(await convex.mutation(api.statements.removeCard, { ...credentials, id: card[1] as Id<"statementCards"> }));
    const reference = /^\/address-book\/([a-zA-Z0-9]+)\/references$/.exec(route);
    if(reference) {
      const contactId=reference[1] as Id<"statementAddresses">;
      if(request.method==="GET")return json(JSON.parse(await convex.query(api.statements.contactReferences,{...credentials,contactId})));
      if(request.method==="POST") {
        await convex.query(api.statements.contactReferences,{...credentials,contactId});
        const contentType=request.headers.get("Content-Type")??"";
        if(!contentType.startsWith("multipart/form-data;"))throw new Error("Choose a reference file");
        const form=await new Response(await boundedBytes(request.body,10*1024*1024+32000),{headers:{"Content-Type":contentType}}).formData(),file=form.get("file");
        if(!file||typeof file==="string"||!["application/pdf","image/png","image/jpeg","image/webp"].includes(file.type)||file.size>10*1024*1024)throw new Error("Choose a PDF, PNG, JPEG or WebP under 10 MB");
        const bytes=new Uint8Array(await file.arrayBuffer()),magic=[...bytes.slice(0,12)];
        const valid=file.type==="application/pdf"?new TextDecoder().decode(bytes.slice(0,5))==="%PDF-":file.type==="image/png"?magic.slice(0,8).join() === "137,80,78,71,13,10,26,10":file.type==="image/jpeg"?magic[0]===255&&magic[1]===216&&magic[2]===255:new TextDecoder().decode(bytes.slice(0,4))==="RIFF"&&new TextDecoder().decode(bytes.slice(8,12))==="WEBP";
        if(!valid)throw new Error("File content does not match its type");
        const storageId=await saveFile(env,bytes,file.type);return json(await convex.mutation(api.statements.addContactReference,{...credentials,contactId,storageId,fileName:file.name.slice(0,250),contentType:file.type}));
      }
    }
    const referenceFile=/^\/contact-references\/([a-zA-Z0-9]+)$/.exec(route);
    if(referenceFile&&request.method==="GET"){
      const stored=JSON.parse(await convex.query(api.statements.contactReferenceFile,{...credentials,id:referenceFile[1] as Id<"statementContactReferences">})),response=await fetch(stored.url,{signal:AbortSignal.timeout(30000)});
      if(!response.ok)throw new Error("Reference unavailable");return new Response(response.body,{headers:{"Content-Type":stored.contentType,"Content-Disposition":`inline; filename*=UTF-8''${encodeURIComponent(stored.fileName)}`,"Cache-Control":"private, no-store","Content-Security-Policy":"sandbox; default-src 'none'","X-Content-Type-Options":"nosniff"}});
    }
    if (["/address-book","/address-book/export"].includes(route) && request.method === "GET") return json(await convex.query(api.statements.listAddresses, {...credentials,exporting:route.endsWith("/export")}));
    const address = /^\/address-book\/([a-zA-Z0-9]+)$/.exec(route);
    if ((route === "/address-book" && request.method === "POST") || (address && request.method === "PATCH")) {
      const input = await body(request), companyId = input.companyId === "all" ? "all" : company(input.companyId); if (!companyId) throw new Error("Select a company");
      return json(await convex.mutation(api.statements.saveAddress, { ...credentials, ...(address ? { id: address[1] as Id<"statementAddresses"> } : {}), companyId, financialAccountId: typeof input.financialAccountId === "string" && input.financialAccountId ? string(input.financialAccountId,80) : undefined, name: string(input.name, 200), email: typeof input.email === "string" ? string(input.email, 254) : undefined,
        addressLine1: typeof input.addressLine1 === "string" ? string(input.addressLine1, 250) : undefined, addressLine2: typeof input.addressLine2 === "string" ? string(input.addressLine2, 250) : undefined,
        city: typeof input.city === "string" ? string(input.city, 250) : undefined, postalCode: typeof input.postalCode === "string" ? string(input.postalCode, 250) : undefined,
        invoiceName: typeof input.invoiceName === "string" ? string(input.invoiceName, 250) : undefined, vat: typeof input.vat === "string" ? string(input.vat, 80) : undefined,
        description: typeof input.description === "string" ? string(input.description, 500) : undefined, reviewNote: typeof input.reviewNote === "string" ? string(input.reviewNote, 500) : undefined,
        aliases: Array.isArray(input.aliases) ? input.aliases.map(value => string(value, 200)) : undefined,
        country: typeof input.country === "string" ? string(input.country, 250) : undefined, notes: typeof input.notes === "string" ? string(input.notes) : "" }));
    }
    if (address && request.method === "DELETE") return json(await convex.mutation(api.statements.removeAddress, { ...credentials, id: address[1] as Id<"statementAddresses"> }));
    if (route === "/audit" && request.method === "GET") return json(await convex.query(api.statements.listAudit, { ...credentials, entityId: url.searchParams.get("entityId") || undefined }));
    if (route === "/settings" && request.method === "GET") return json(await convex.query(api.statements.settings, credentials));
    if (route === "/settings/senders" && request.method === "POST") { const input = await body(request); return json(await convex.mutation(api.statements.saveSender, { ...credentials, email: string(input.email, 254), senderActor: normalizeStatementActor(string(input.senderActor ?? actor, 100)) })); }
    if (route === "/settings/senders" && request.method === "DELETE") { const input = await body(request); return json(await convex.mutation(api.statements.removeSender, { ...credentials, id: string(input.id, 100) as Id<"statementSenders"> })); }
    return json({ message: "Statement endpoint not found" }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Statement request failed";
    return json({ message }, /revision|changed|edited by/i.test(message) ? 409 : /access|permission|unauthorized/i.test(message) ? 403 : 400);
  }
}

export async function handleStatementProcessing(request: Request, env: StatementEnv): Promise<Response> {
  if (!env.CONVEX_SERVICE_TOKEN || request.method !== "POST" || !await secureHeaderMatches(request.headers.get("Authorization"), `Bearer ${env.CONVEX_SERVICE_TOKEN}`)) return json({ message: "Unauthorized" }, 401);
  const convex = client(env);
  let claim: FunctionReturnType<typeof api.statements.claimDocument> = null;
  try {
    const input = await body(request), id = string(input.id, 100) as Id<"statementDocuments">;
    claim = await convex.mutation(api.statements.claimDocument, { ...service(env), id });
    if (!claim) return json({ processed: false });
    const settings = await convex.query(api.statements.processingSettings, service(env));
    const savedAi = object(JSON.parse(settings.aiSettingsJson) ?? {});
    if (savedAi.provider !== "openrouter" || typeof savedAi.model !== "string" || !savedAi.model.trim()) throw new Error("Select and save an AI model in the existing Finance Dashboard settings");
    if (!claim.url) throw new Error("The original PDF is unavailable");
    const response = await fetch(claim.url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) { await response.body?.cancel(); throw new Error("The original PDF could not be loaded"); }
    const bytes = await boundedBytes(response.body, maximumFileBytes), extractedText = await extractStatementText(env, bytes, claim.document.contentType);
    const result = await extractStatementDetails({ apiKey: env.OPENROUTER_API_KEY, model: savedAi.model, pages: extractedText.pages, context: claim.document.companyId, sourceContext: claim.document.sourceContext, fileName: claim.document.fileName });
    const extraction = result.extraction;
    assignStatementDocumentCompany(extraction, settings.cards);
    extraction.reviewReasons.push(...extractedText.warnings);
    await convex.mutation(api.statements.completeDocument, { ...service(env), id, attemptToken: claim.attemptToken, documentType: extraction.documentType, companyId: extraction.companyId,
      evidence: extraction.evidence, reviewReasons: extraction.reviewReasons, extracted: JSON.stringify({ ...extraction, textMethod: extractedText.method }), rows: extraction.documentType === "bank_statement" ? extraction.rows : undefined,
      errors: extraction.documentType === "bank_statement" && !extraction.complete ? ["The extraction is incomplete; correct all rows and verify the entire original before confirming"] : [],
      generationId: result.generationId, costUsd: result.costUsd });
    return json({ processed: true });
  } catch (error) {
    if (claim) await convex.mutation(api.statements.failDocument, { ...service(env), id: claim.document._id, attemptToken: claim.attemptToken, error: error instanceof Error ? error.message.slice(0, 1000) : "Document processing failed", retryAfterMs: error instanceof StatementAiError || error instanceof StatementOcrError ? error.retryAfterMs : undefined });
    return json({ message: "Document processing failed; the original is preserved" }, 502);
  }
}

export async function receiveStatementEmail(message: ForwardableEmailMessage, env: StatementEnv): Promise<void> {
  if (message.to.toLowerCase() !== statementInbox) { message.setReject("Unknown statement inbox"); return; }
  if (message.rawSize > maximumEmailBytes) { message.setReject("Email exceeds 25 MB"); return; }
  const raw = await boundedBytes(message.raw, maximumEmailBytes), parsed = await PostalMime.parse(raw);
  const pdfs = parsed.attachments.filter(attachment => {
    const bytes = new Uint8Array(attachment.content as ArrayBuffer);
    return new TextDecoder("ascii").decode(bytes.subarray(0, 5)) === "%PDF-";
  });
  if (!pdfs.length) { message.setReject("Forward an email containing a PDF attachment"); return; }
  if (pdfs.length > 10 || pdfs.some(file => (file.content as ArrayBuffer).byteLength > maximumFileBytes)) { message.setReject("Forward at most 10 PDFs, each no larger than 15 MB"); return; }
  const sender = message.from.trim().toLowerCase();
  const settings = await client(env).query(api.statements.processingSettings, service(env));
  const senderKnown = settings.allowedSenders.some(item => item.email.toLowerCase() === sender);
  const emailRawStorageId = await saveFile(env, raw, "message/rfc822"), rawHash = await statementHash(raw);
  const context = `Envelope sender: ${sender}\nFrom: ${parsed.from?.address ?? ""}\nSubject: ${parsed.subject ?? ""}\n${parsed.text ?? ""}`.slice(0, 12000);
  // Email headers are untrusted. Until authenticated ingress is attested, an
  // authorized dashboard member must release the preserved document for AI.
  for (const attachment of pdfs) await ingestPdf(env, { bytes: new Uint8Array(attachment.content as ArrayBuffer), name: attachment.filename || "forwarded.pdf", origin: "email", sender,
    subject: (parsed.subject ?? "").slice(0, 500), messageId: (parsed.messageId || `sha256:${rawHash}`).slice(0, 1000), receivedAt: new Date().toISOString(), emailRawStorageId, quarantined: true, senderKnown, sourceContext: context });
}
