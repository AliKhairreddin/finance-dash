import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { DashboardSession } from "../shared/types";
import { isStatementCompany, normalizeStatementActor } from "../shared/statements";
import { invoiceLayout, invoiceText, type InvoiceDraft, type InvoiceTemplateLayout } from "../shared/statementInvoices";
import { boundedBytes } from "./documentIntake";
import { readBoundedResponseJson } from "../shared/boundedHttp";
import { inspectInvoiceExample, renderInvoicePdf } from "./statementInvoicePdf";
import { invoiceAi } from "./statementInvoiceAi";
import { invoiceCopyPrompt } from "./statementInvoiceCopy";
import type { StatementEnv } from "./statements";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
type Saved = { _id: Id<"statementInvoices">; state: string; revision: number; error?: string; leaseUntil: number; draft: InvoiceDraft; sources: Array<{ transactionId: string; description: string; date: string; amount: string; counterparty: string }>; instructions: string; layout: InvoiceTemplateLayout; templateUrl: string | null; pdfUrl: string | null };
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
  async function readExample(id: Id<"statementInvoiceTemplates">) {
    const token = crypto.randomUUID();
    if (!await client.mutation(api.statementInvoices.claimExample, { ...auth, id, token })) return { id };
    try {
      const saved = JSON.parse(await client.query(api.statementInvoices.template, { ...auth, id })), bytes = await bytesFrom(saved.url);
      const inspected = await inspectInvoiceExample(env, bytes), selectedModel = await model(client, auth.serviceToken);
      if (inspected.pages !== 1 || !inspected.text.some(item => item.text.trim())) throw new Error("Upload a clear, text-based one-page example PDF");
      const ai = await invoiceAi(env.OPENROUTER_API_KEY, selectedModel, invoiceCopyPrompt, { issuer: saved.issuerName, width: inspected.width, height: inspected.height, positions: inspected.text });
      const mapped = ai.result as { error?: string; copy?: unknown; sellerDetails?: string; paymentDetails?: string };
      if (mapped.error || !mapped.copy) throw new Error(mapped.error || "The example layout could not be mapped");
      ai.result = invoiceLayout({ ...mapped, headerPercent: 0, footerPercent: 0 });
      await client.mutation(api.statementInvoices.completeExample, { ...auth, id, token, layoutJson: JSON.stringify(invoiceLayout(ai.result)), model: ai.model, costUsd: ai.costUsd });
      return { id };
    } catch (error) {
      const reason = error instanceof Error && !error.message.includes("[Request ID:") ? error.message.slice(0, 250) : "The example could not be read.";
      const message = `${reason} Your PDF is saved. Choose Read again to retry.`;
      await client.mutation(api.statementInvoices.completeExample, { ...auth, id, token, error: message });
      return { id, message };
    }
  }
  try {
    if (path === "/invoice-examples" && request.method === "GET") return json(JSON.parse(await client.query(api.statementInvoices.templates, auth)));
    if (path === "/invoice-examples" && request.method === "POST") {
      const contentType = request.headers.get("Content-Type") ?? ""; if (!contentType.startsWith("multipart/form-data;")) throw new Error("Choose an example PDF");
      const form = await new Response(await boundedBytes(request.body, 5 * 1024 * 1024 + 32000), { headers: { "Content-Type": contentType } }).formData(), file = form.get("file"), companyId = form.get("companyId");
      if (!file || typeof file === "string" || !isStatementCompany(companyId) || !file.size || file.size > 5 * 1024 * 1024) throw new Error("Choose a company and an example PDF under 5 MB");
      const member = await client.query(api.statements.bootstrap, auth); if (!member.canManage || !member.companies.some(c => c.id === companyId)) throw new Error("Company access required");
      const bytes = new Uint8Array(await file.arrayBuffer()); if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("Choose a valid PDF");
      const storageId = await savePdf(client, auth.serviceToken, bytes);
      const id = await client.mutation(api.statementInvoices.uploadExample, { ...auth, companyId, issuerName: invoiceText(form.get("issuerName"), "invoice issuer", 250, true), storageId, fileName: file.name.slice(0, 250) });
      return json(await readExample(id), 201);
    }
    const example = /^\/invoice-examples\/([a-z0-9]+)(?:\/(file|preview|read))?$/.exec(path);
    if (example) {
      const id = example[1] as Id<"statementInvoiceTemplates">;
      if (example[2] === "read" && request.method === "POST") return json(await readExample(id));
      if (!example[2] && request.method === "PATCH") { const input = await body(); return json({ id: await client.mutation(api.statementInvoices.approveTemplate, { ...auth, id, layoutJson: JSON.stringify(input.layout), confirmed: input.confirmed === true }) }); }
      const saved = JSON.parse(await client.query(api.statementInvoices.template, { ...auth, id }));
      if (example[2] === "file" && request.method === "GET") return pdf(await bytesFrom(saved.url), saved.fileName);
      if (example[2] === "preview" && request.method === "POST") {
        const input = await body(), layout = invoiceLayout(input.layout);
        return pdf(await renderInvoicePdf(env, await bytesFrom(saved.url), layout, { number: "10001", date: "2026-01-01", dueDate: "", customer: "Example customer", customerAddress: "Example address", notes: layout.copy && !layout.copy.fields.some(f => f.key === "notes") ? "" : "Layout check only.", currency: "EUR", taxMode: "included", lines: [{ transactionId: "example", description: "Example invoice line", amount: "100.00", taxPercent: "0" }] }, true), "invoice-layout-check.pdf");
      }
    }
    if (path === "/created-invoices/profile" && request.method === "POST") {
      const input = await body(); if (!isStatementCompany(input.companyId)) throw new Error("Choose a company");
      return json(JSON.parse(await client.query(api.statementInvoices.profile, { ...auth, companyId: input.companyId, otherName: invoiceText(input.otherName, "company name", 250) })));
    }
    if ((path === "/created-invoices/setup" || path === "/created-invoices/suggest-description") && request.method === "POST") {
      const input = await body(), setup = JSON.parse(await client.query(api.statementInvoices.setup, { ...auth, ids: input.ids as Id<"statementTransactions">[] }));
      if (path.endsWith("/setup")) return json(setup);
      const ai = await invoiceAi(env.OPENROUTER_API_KEY, await model(client, auth.serviceToken), 'Suggest one short, plain-English invoice description using only facts explicitly present in the selected transaction descriptions. Do not guess goods, services, addresses, VAT numbers, tax or payment status. If the descriptions do not identify what was bought, return an empty description. Return JSON {description:string}. This is a suggestion for the person to accept or edit.', { transactions: setup.sources });
      return json({ description: invoiceText((ai.result as { description?: unknown })?.description, "suggested description", 500), source: "AI suggestion from selected transactions" });
    }
    if (path === "/created-invoices" && request.method === "GET") return json(JSON.parse(await client.query(api.statementInvoices.list, auth)));
    let id: Id<"statementInvoices"> | undefined, generate = false;
    if (path === "/created-invoices" && request.method === "POST") {
      const input = await body(); id = await client.mutation(api.statementInvoices.begin, { ...auth, requestId: String(input.requestId), ids: input.ids as Id<"statementTransactions">[], draftJson: JSON.stringify(input.draft), instructions: String(input.instructions ?? ""), ...(input.plainDetails ? { plainDetailsJson: JSON.stringify(input.plainDetails), remember: input.remember === true, profileRevision: Number(input.profileRevision) } : {}) }); generate = true;
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
      if (match?.[2] === "preview" && request.method === "GET") { if (row.state !== "draft") throw new Error("Wait for the draft to finish"); return pdf(await renderInvoicePdf(env, row.templateUrl ? await bytesFrom(row.templateUrl) : null, row.layout, row.draft, true), `${row.draft.number}-draft.pdf`); }
      if (match?.[2] === "finalize" && request.method === "POST") {
        const input = await body(); if (input.confirmed !== true || row.state !== "draft" || Number(input.revision) !== row.revision) throw new Error("Check the latest invoice draft first");
        const bytes = await renderInvoicePdf(env, row.templateUrl ? await bytesFrom(row.templateUrl) : null, row.layout, row.draft, false), storageId = await savePdf(client, auth.serviceToken, bytes);
        await client.mutation(api.statementInvoices.finalize, { ...auth, id, revision: row.revision, storageId, confirmed: true });
        return json(safeInvoice(JSON.parse(await client.query(api.statementInvoices.get, { ...auth, id }))));
      }
      return json(safeInvoice(row));
    }
    return json({ message: "Invoice route not found" }, 404);
  } catch (error) {
    // Production Convex messages hide the reason; expected errors carry it in data.
    if (error instanceof ConvexError && typeof error.data === "string") return json({ message: error.data.slice(0, 500) }, 400);
    const raw = error instanceof Error ? error.message : "Invoice request failed";
    const reference = /\[Request ID: ([a-f0-9]+)\]/i.exec(raw)?.[1];
    if (reference) return json({ message: `The invoice request could not finish. Try again. If it happens again, share this reference: ${reference}` }, 500);
    return json({ message: raw.split("\n")[0].slice(0, 500) }, 400);
  }
}
