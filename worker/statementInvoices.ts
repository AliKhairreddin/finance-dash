import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { DashboardSession } from "../shared/types";
import { isStatementCompany, normalizeStatementActor } from "../shared/statements";
import { invoiceLayout, type InvoiceDraft, type InvoiceTemplateLayout } from "../shared/statementInvoices";
import { boundedBytes } from "./documentIntake";
import { readBoundedResponseJson } from "../shared/boundedHttp";
import { inspectInvoiceExample, renderInvoicePdf } from "./statementInvoicePdf";
import { invoiceAi } from "./statementInvoiceAi";
import { extractStatementText } from "./statementOcr";
import type { StatementEnv } from "./statements";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
type Saved = { _id: Id<"statementInvoices">; state: string; revision: number; error?: string; leaseUntil: number; draft: InvoiceDraft; sources: Array<{ transactionId: string; description: string; date: string; amount: string; counterparty: string }>; instructions: string; layout: InvoiceTemplateLayout; templateUrl: string; pdfUrl: string | null };
const safeInvoice = (row: Saved) => ({ id: row._id, state: row.state, revision: row.revision, error: row.error, leaseUntil: row.leaseUntil, draft: row.draft, sources: row.sources, layout: row.layout });
async function bytesFrom(url: string, max = 5 * 1024 * 1024) { const response = await fetch(url, { signal: AbortSignal.timeout(30000) }); if (!response.ok) { await response.body?.cancel(); throw new Error("The saved PDF could not be read"); } return boundedBytes(response.body, max); }
async function savePdf(client: ConvexHttpClient, serviceToken: string, bytes: Uint8Array<ArrayBuffer>) {
  const url = await client.mutation(api.statements.generateUploadUrl, { serviceToken });
  const response = await fetch(url, { method: "POST", body: new Blob([bytes], { type: "application/pdf" }), headers: { "Content-Type": "application/pdf" }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) { await response.body?.cancel(); throw new Error("The PDF could not be saved"); }
  return (await readBoundedResponseJson<{ storageId: Id<"_storage"> }>(response, "Invoice storage", 4096)).storageId;
}
async function model(client: ConvexHttpClient, serviceToken: string) { const settings = await client.query(api.statements.processingSettings, { serviceToken }), ai = JSON.parse(settings.aiSettingsJson); if (ai?.provider !== "openrouter" || !ai.model) throw new Error("Save an OpenRouter model in Finance settings first"); return ai.model as string; }
function pdf(bytes: Uint8Array<ArrayBuffer>, name: string) { return new Response(bytes, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(name)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } }); }
export async function handleStatementInvoices(request: Request, env: StatementEnv, session: DashboardSession | null): Promise<Response | null> {
  const path = new URL(request.url).pathname.replace(/^\/api\/statements/, "");
  if (!/^\/(invoice-examples|created-invoices)(\/|$)/.test(path)) return null;
  let actor: string; try { if (!session) throw new Error(); actor = normalizeStatementActor(session.username); } catch { return json({ message: "Statement access is required" }, 403); }
  if (!["GET", "HEAD"].includes(request.method) && request.headers.get("Origin") !== new URL(request.url).origin) return json({ message: "Open this action from Statements" }, 403);
  const client = new ConvexHttpClient(env.CONVEX_URL), auth = { serviceToken: env.CONVEX_SERVICE_TOKEN, actor };
  const body = async () => JSON.parse(new TextDecoder().decode(await boundedBytes(request.body, 250000))) as Record<string, unknown>;
  try {
    if (path === "/invoice-examples" && request.method === "GET") return json(JSON.parse(await client.query(api.statementInvoices.templates, auth)));
    if (path === "/invoice-examples" && request.method === "POST") {
      const contentType = request.headers.get("Content-Type") ?? ""; if (!contentType.startsWith("multipart/form-data;")) throw new Error("Choose an example PDF");
      const form = await new Response(await boundedBytes(request.body, 5 * 1024 * 1024 + 32000), { headers: { "Content-Type": contentType } }).formData(), file = form.get("file"), companyId = form.get("companyId");
      if (!file || typeof file === "string" || !isStatementCompany(companyId) || !file.size || file.size > 5 * 1024 * 1024) throw new Error("Choose a company and an example PDF under 5 MB");
      const member = await client.query(api.statements.bootstrap, auth); if (!member.canManage || !member.companies.some(c => c.id === companyId)) throw new Error("Company access required");
      const bytes = new Uint8Array(await file.arrayBuffer()); if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("Choose a valid PDF");
      const inspected = await inspectInvoiceExample(env, bytes), selectedModel = await model(client, auth.serviceToken);
      const text = inspected.text.length ? undefined : (await extractStatementText(env, bytes, "application/pdf")).pages[0].text;
      const ai = await invoiceAi(env.OPENROUTER_API_KEY, selectedModel, 'Read the example invoice. Return JSON {headerPercent:number,footerPercent:number,sellerDetails:string,paymentDetails:string}. Header is the top 0–30% of page 1; footer is the bottom 0–20%. Keep only static seller branding/logo/contact details in those strips. Never include the old invoice number, date, buyer, amounts, page number or line items. If no safe strip exists, set it to 0. Text positions are percentages from the top. Extract only literal seller company/address/tax ID and payment details; never buyer details. Do not invent missing details. All fields will be reviewed by a person.', { companyId, positions: inspected.text, scannedText: text });
      const layout = invoiceLayout(ai.result), storageId = await savePdf(client, auth.serviceToken, bytes);
      return json({ id: await client.mutation(api.statementInvoices.saveTemplate, { ...auth, companyId, storageId, fileName: file.name.slice(0, 250), layoutJson: JSON.stringify(layout), model: ai.model, costUsd: ai.costUsd }) }, 201);
    }
    const example = /^\/invoice-examples\/([a-z0-9]+)(?:\/(file|preview))?$/.exec(path);
    if (example) {
      const id = example[1] as Id<"statementInvoiceTemplates">;
      if (!example[2] && request.method === "PATCH") { const input = await body(); return json({ id: await client.mutation(api.statementInvoices.approveTemplate, { ...auth, id, layoutJson: JSON.stringify(input.layout), confirmed: input.confirmed === true }) }); }
      const saved = JSON.parse(await client.query(api.statementInvoices.template, { ...auth, id }));
      if (example[2] === "file" && request.method === "GET") return pdf(await bytesFrom(saved.url), saved.fileName);
      if (example[2] === "preview" && request.method === "POST") {
        const input = await body(), layout = invoiceLayout(input.layout);
        return pdf(await renderInvoicePdf(env, await bytesFrom(saved.url), layout, { number: "EXAMPLE-001", date: "2026-01-01", dueDate: "", customer: "Example customer", customerAddress: "Example address", notes: "Layout check only. No invoice has been issued.", currency: "EUR", taxMode: "included", lines: [{ transactionId: "example", description: "Example invoice line", amount: "100.00", taxPercent: "0" }] }, true), "invoice-layout-check.pdf");
      }
    }
    if (path === "/created-invoices" && request.method === "GET") return json(JSON.parse(await client.query(api.statementInvoices.list, auth)));
    let id: Id<"statementInvoices"> | undefined, generate = false;
    if (path === "/created-invoices" && request.method === "POST") {
      const input = await body(); id = await client.mutation(api.statementInvoices.begin, { ...auth, requestId: String(input.requestId), ids: input.ids as Id<"statementTransactions">[], draftJson: JSON.stringify(input.draft), instructions: String(input.instructions ?? "") }); generate = true;
    }
    const match = /^\/created-invoices\/([a-z0-9]+)(?:\/(generate|preview|finalize|file|discard))?$/.exec(path);
    if (match) { id = match[1] as Id<"statementInvoices">; generate = match[2] === "generate" && request.method === "POST"; }
    if (id) {
      if (generate) {
        const token = crypto.randomUUID(), claimed = await client.mutation(api.statementInvoices.claim, { ...auth, id, token });
        if (claimed) try {
          const row = JSON.parse(await client.query(api.statementInvoices.get, { ...auth, id })) as Saved;
          const ai = await invoiceAi(env.OPENROUTER_API_KEY, await model(client, auth.serviceToken), 'Write clear invoice line descriptions based on the selected transactions and the user instructions. Return JSON {lines:[{transactionId:string,description:string}]}, exactly one line for every supplied transaction. Keep IDs unchanged. Do not return amounts, dates, rates or totals. Do not assert the invoice is paid or invent services. Use only supplied facts; if instructions ask to change amounts, leave that for human review.', { instructions: row.instructions, transactions: row.sources, seller: row.layout.sellerDetails, customer: row.draft.customer });
          await client.mutation(api.statementInvoices.generated, { ...auth, id, token, resultJson: JSON.stringify(ai.result), model: ai.model, costUsd: ai.costUsd });
        } catch { await client.mutation(api.statementInvoices.generated, { ...auth, id, token, error: "AI could not finish this draft. Your selection is saved. Try AI again." }); }
      }
      if (match?.[2] === "discard" && request.method === "POST") await client.mutation(api.statementInvoices.discard, { ...auth, id });
      if (match && !match[2] && request.method === "PATCH") { const input = await body(); await client.mutation(api.statementInvoices.save, { ...auth, id, revision: Number(input.revision), draftJson: JSON.stringify(input.draft) }); }
      const row = JSON.parse(await client.query(api.statementInvoices.get, { ...auth, id })) as Saved;
      if (match?.[2] === "file" && request.method === "GET") { if (!row.pdfUrl || row.state !== "ready") throw new Error("Save the final invoice first"); return pdf(await bytesFrom(row.pdfUrl, 15 * 1024 * 1024), `${row.draft.number}.pdf`); }
      if (match?.[2] === "preview" && request.method === "GET") { if (row.state !== "draft") throw new Error("Wait for the draft to finish"); return pdf(await renderInvoicePdf(env, await bytesFrom(row.templateUrl), row.layout, row.draft, true), `${row.draft.number}-draft.pdf`); }
      if (match?.[2] === "finalize" && request.method === "POST") {
        const input = await body(); if (input.confirmed !== true || row.state !== "draft" || Number(input.revision) !== row.revision) throw new Error("Check the latest invoice draft first");
        const bytes = await renderInvoicePdf(env, await bytesFrom(row.templateUrl), row.layout, row.draft, false), storageId = await savePdf(client, auth.serviceToken, bytes);
        await client.mutation(api.statementInvoices.finalize, { ...auth, id, revision: row.revision, storageId, confirmed: true });
        return json(safeInvoice(JSON.parse(await client.query(api.statementInvoices.get, { ...auth, id }))));
      }
      return json(safeInvoice(row));
    }
    return json({ message: "Invoice route not found" }, 404);
  } catch (error) { const raw = error instanceof Error ? error.message : "Invoice request failed"; return json({ message: (/Uncaught ConvexError: ([^\n]+)/.exec(raw)?.[1] ?? raw.split("\n")[0]).slice(0, 500) }, 400); }
}
