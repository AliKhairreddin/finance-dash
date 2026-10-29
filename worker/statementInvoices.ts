import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { DashboardSession } from "../shared/types";
import { isStatementCompany, statementCompanies, normalizeStatementActor } from "../shared/statements";
import { invoiceLayout, invoiceText, applySavedInvoiceDetails, validateInvoicePair, type InvoiceDraft, type InvoiceTemplateLayout } from "../shared/statementInvoices";
import { boundedBytes, secureHeaderMatches } from "./documentIntake";
import { readBoundedResponseJson } from "../shared/boundedHttp";
import { inspectInvoiceExample, renderInvoicePdf } from "./statementInvoicePdf";
import { invoiceAi } from "./statementInvoiceAi";
import { invoiceCopyPrompt, invoiceCopySchema } from "./statementInvoiceCopy";
import type { StatementEnv } from "./statements";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
type Saved = { _id: Id<"statementInvoices">; state: string; revision: number; error?: string; leaseUntil: number; draft: InvoiceDraft; sources: Array<{ transactionId: string; description: string; date: string; amount: string; counterparty: string }>; instructions: string; pairDetailsJson?: string; layout: InvoiceTemplateLayout; templateUrl: string | null; pdfUrl: string | null };
const safeInvoice = (row: Saved) => ({ id: row._id, state: row.state, revision: row.revision, error: row.error, leaseUntil: row.leaseUntil, draft: row.draft, sources: row.sources, layout: row.layout });
async function bytesFrom(url: string, max = 5 * 1024 * 1024) { const response = await fetch(url, { signal: AbortSignal.timeout(30000) }); if (!response.ok) { await response.body?.cancel(); throw new Error("The saved PDF could not be read"); } return boundedBytes(response.body, max); }
async function savePdf(client: ConvexHttpClient, serviceToken: string, bytes: Uint8Array<ArrayBuffer>) {
  const url = await client.mutation(api.statements.generateUploadUrl, { serviceToken });
  const response = await fetch(url, { method: "POST", body: new Blob([bytes], { type: "application/pdf" }), headers: { "Content-Type": "application/pdf" }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) { await response.body?.cancel(); throw new Error("The PDF could not be saved"); }
  return (await readBoundedResponseJson<{ storageId: Id<"_storage"> }>(response, "Invoice storage", 4096)).storageId;
}
async function model(client: ConvexHttpClient, serviceToken: string) { const settings = await client.query(api.statements.processingSettings, { serviceToken }), ai = JSON.parse(settings.aiSettingsJson); if (ai?.provider !== "openrouter" || !ai.model) throw new Error("Save an OpenRouter model in Finance settings first"); return ai.model as string; }
function pdf(bytes: Uint8Array<ArrayBuffer>, name: string, download = false) { return new Response(bytes, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } }); }
export async function handleStatementInvoices(request: Request, env: StatementEnv, session: DashboardSession | null, renderPdf: typeof renderInvoicePdf = renderInvoicePdf): Promise<Response | null> {
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
      const ai = await invoiceAi(env.OPENROUTER_API_KEY, selectedModel, invoiceCopyPrompt, { issuer: saved.issuerName, width: inspected.width, height: inspected.height, positions: inspected.text }, { reasoningEffort: "none", outputSchema: invoiceCopySchema });
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
    const example = /^\/invoice-examples\/([a-zA-Z0-9]+)(?:\/(file|preview|read))?$/.exec(path);
    if (example) {
      const id = example[1] as Id<"statementInvoiceTemplates">;
      if (example[2] === "read" && request.method === "POST") return json(await readExample(id));
      if (!example[2] && request.method === "PATCH") { const input = await body(); return json({ id: await client.mutation(api.statementInvoices.approveTemplate, { ...auth, id, layoutJson: JSON.stringify(input.layout), confirmed: input.confirmed === true }) }); }
      const saved = JSON.parse(await client.query(api.statementInvoices.template, { ...auth, id }));
      if (example[2] === "file" && request.method === "GET") return pdf(await bytesFrom(saved.url), saved.fileName);
      if (example[2] === "preview" && request.method === "POST") {
        const input = await body(), layout = invoiceLayout(input.layout);
        return pdf(await renderPdf(env, await bytesFrom(saved.url), layout, { number: "10001", date: "2026-01-01", dueDate: "", customer: "Example customer", customerAddress: "Example address", notes: layout.copy && !layout.copy.fields.some(f => f.key === "notes") ? "" : "Layout check only.", currency: "EUR", taxMode: "included", lines: [{ transactionId: "example", description: "Example invoice line", amount: "100.00", taxPercent: "0" }] }, true), "invoice-layout-check.pdf");
      }
    }
    if (path === "/created-invoices/profile" && request.method === "POST") {
      const input = await body(); if (!isStatementCompany(input.companyId)) throw new Error("Choose a company");
      return json(JSON.parse(await client.query(api.statementInvoices.profile, { ...auth, companyId: input.companyId,financialAccountId:typeof input.financialAccountId==="string"?input.financialAccountId:undefined, otherName: invoiceText(input.otherName, "company name", 250) })));
    }
    if ((path === "/created-invoices/setup" || path === "/created-invoices/suggest-description") && request.method === "POST") {
      const input = await body(), setup = JSON.parse(await client.query(api.statementInvoices.setup, { ...auth, ids: input.ids as Id<"statementTransactions">[] }));
      if (path.endsWith("/setup")) return json(setup);
      const ai = await invoiceAi(env.OPENROUTER_API_KEY, await model(client, auth.serviceToken), 'Suggest one short, plain-English invoice description using only facts explicitly present in the selected transaction descriptions. Do not guess goods, services, addresses, VAT numbers, tax or payment status. If the descriptions do not identify what was bought, return an empty description. Return JSON {description:string}. This is a suggestion for the person to accept or edit.', { transactions: setup.sources });
      return json({ description: invoiceText((ai.result as { description?: unknown })?.description, "suggested description", 500), source: "AI suggestion from selected transactions" });
    }
    if (path === "/created-invoices" && request.method === "GET") return json(JSON.parse(await client.query(api.statementInvoices.list, auth)));
    if(path==="/created-invoices/design-preview" && request.method==="POST") {
      const input=await body(), designs=JSON.parse(await client.query(api.statementDesigns.list,auth));
      const selected=designs.find((d:{companyId:string})=>d.companyId===input.companyId);
      if(!selected?.design)throw new Error("Save the approved design before previewing it");
      const design=JSON.parse(selected.design.designJson);if(!selected.design.brandingAuthorized){delete design.logoPath;delete design.logoDataUrl;delete design.source;}
      return pdf(await renderPdf(env,null,{sellerDetails:`${statementCompanies.find(c=>c.id===input.companyId)?.name}\nSynthetic address for design preview`,paymentDetails:"",headerPercent:0,footerPercent:0,design},{number:"SAMPLE-001",date:"2026-01-15",dueDate:"",customer:"Synthetic counterparty",customerAddress:"Synthetic address",notes:"Synthetic design preview — no financial record is created.",currency:"EUR",documentType:"internal_support",taxAssessment:"unassessed",taxMode:"included",lines:[{transactionId:"sample",description:"Example service supported by transaction evidence",amount:"100.00",taxPercent:"0"}]},true),"design-preview.pdf");
    }
    let id: Id<"statementInvoices"> | undefined, generate = false;
    const regeneration=/^\/created-invoices\/([a-zA-Z0-9]+)\/regenerate$/.exec(path);
    if(regeneration && request.method==="POST") {
      const input=await body(), old=JSON.parse(await client.query(api.statementInvoices.get,{...auth,id:regeneration[1] as Id<"statementInvoices">})) as Saved;
      if(!["ready","stale","superseded","cancelled"].includes(old.state)||!old.pairDetailsJson)throw new Error("Select the current transactions and approved company details to generate a replacement");
      const setup=JSON.parse(await client.query(api.statementInvoices.setup,{...auth,ids:old.sources.map(s=>s.transactionId as Id<"statementTransactions">)})),details=applySavedInvoiceDetails(setup,JSON.parse(old.pairDetailsJson));
      id=await client.mutation(api.statementInvoices.begin,{...auth,requestId:String(input.requestId),ids:old.sources.map(s=>s.transactionId as Id<"statementTransactions">),draftJson:JSON.stringify(old.draft),plainDetailsJson:JSON.stringify(details),instructions:invoiceText(input.description??old.draft.lines[0].description,"description",500),regenerate:true});generate=true;
    }
    const history=/^\/created-invoices\/([a-zA-Z0-9]+)\/history$/.exec(path);
    if(history && request.method==="GET")return json(JSON.parse(await client.query(api.statementInvoices.history,{...auth,id:history[1] as Id<"statementInvoices">})));
    if (["/created-invoices", "/created-invoices/one-click"].includes(path) && request.method === "POST") {
      const input = await body();
      if (path.endsWith("/one-click")) {
        const setup = JSON.parse(await client.query(api.statementInvoices.setup, { ...auth, ids: input.ids as Id<"statementTransactions">[] }));
        const details = applySavedInvoiceDetails(setup, { ours: { name: statementCompanies.find(c => c.id === setup.companyId)!.name, address: "", vat: "" }, other: { name: setup.sources[0]?.counterparty ?? "", address: "", vat: "" }, description: "" });
        try { input.plainDetails = validateInvoicePair(details); } catch { return json({ correctionRequired: true, setup, details }); }
        input.draft = { number: "", date: "", dueDate: "", customer: "", customerAddress: "", notes: "", currency: "", taxMode: "included", lines: [] };
      }
      id = await client.mutation(api.statementInvoices.begin, { ...auth, requestId: String(input.requestId), ids: input.ids as Id<"statementTransactions">[], draftJson: JSON.stringify(input.draft), instructions: String(input.instructions ?? ""), regenerate: input.regenerate === true, ...(input.plainDetails ? { plainDetailsJson: JSON.stringify(input.plainDetails), remember: input.remember === true, profileRevision: Number(input.profileRevision) } : {}) }); generate = true;
    }
    const match = /^\/created-invoices\/([a-zA-Z0-9]+)(?:\/(generate|preview|finalize|file|discard))?$/.exec(path);
    if (match) { id = match[1] as Id<"statementInvoices">; generate = match[2] === "generate" && request.method === "POST"; }
    if (id) {
      if (generate) {
        const token = crypto.randomUUID(), claimed = await client.mutation(api.statementInvoices.claim, { ...auth, id, token });
        if (claimed) try {
          const row = JSON.parse(await client.query(api.statementInvoices.get, { ...auth, id })) as Saved;
          // Approved descriptions and transaction evidence are sufficient; enrichment is asynchronous.
          await client.mutation(api.statementInvoices.generated, { ...auth, id, token, resultJson: JSON.stringify({ lines: row.sources.map(source => ({ transactionId: source.transactionId, description: row.instructions.split("\n").filter(Boolean)[0]?.slice(0,500) || source.description.slice(0,500) })) }), model: "approved-evidence" });

        } catch (error) { const current = JSON.parse(await client.query(api.statementInvoices.get, { ...auth, id })) as Saved; if (current.state === "preparing") await client.mutation(api.statementInvoices.generated, { ...auth, id, token, error: "Generation failed; retry uses the same saved document." }); else if (current.state !== "ready") throw error; }
      }
      if (generate) {
        const renderToken = crypto.randomUUID();
        if (await client.mutation(api.statementInvoices.claimRender, {...auth,id,token:renderToken})) {
          try { const generated = JSON.parse(await client.query(api.statementInvoices.get,{...auth,id})) as Saved;
            const bytes = await renderPdf(env,null,generated.layout,generated.draft,false), storageId = await savePdf(client,auth.serviceToken,bytes);
            await client.mutation(api.statementInvoices.finalize,{...auth,id,revision:generated.revision,storageId,confirmed:true,renderToken});
          } finally { await client.mutation(api.statementInvoices.claimRender,{...auth,id,token:renderToken,release:true}); }
        }
      }
      if (match?.[2] === "discard" && request.method === "POST") await client.mutation(api.statementInvoices.discard, { ...auth, id });
      if (match && !match[2] && request.method === "PATCH") { const input = await body(); await client.mutation(api.statementInvoices.save, { ...auth, id, revision: Number(input.revision), draftJson: JSON.stringify(input.draft) }); }
      const row = JSON.parse(await client.query(api.statementInvoices.get, { ...auth, id, download: match?.[2] === "file" })) as Saved;
      if (match?.[2] === "file" && request.method === "GET") { if (!row.pdfUrl || !["ready", "stale", "superseded", "cancelled"].includes(row.state)) throw new Error("Save the final document first"); const bytes=await bytesFrom(row.pdfUrl,15*1024*1024),download=new URL(request.url).searchParams.get("download")==="1"; if(download)await client.mutation(api.statementLibrary.action,{...auth,source:"generated",ids:[id],action:"downloaded"});return pdf(bytes, `${row.draft.number}.pdf`, download); }
      if (match?.[2] === "preview" && request.method === "GET") { if (row.state !== "draft") throw new Error("Wait for the draft to finish"); return pdf(await renderPdf(env, row.templateUrl ? await bytesFrom(row.templateUrl) : null, row.layout, row.draft, true), `${row.draft.number}-draft.pdf`); }
      if (match?.[2] === "finalize" && request.method === "POST") {
        const input = await body(); if (row.state !== "draft" || Number(input.revision) !== row.revision) throw new Error("Check the latest invoice draft first");
        const renderToken=crypto.randomUUID();
        if(!await client.mutation(api.statementInvoices.claimRender,{...auth,id,token:renderToken}))throw new Error("This document is already being saved. Wait for the saved version.");
        try { const bytes=await renderPdf(env,row.templateUrl?await bytesFrom(row.templateUrl):null,row.layout,row.draft,false),storageId=await savePdf(client,auth.serviceToken,bytes);
          await client.mutation(api.statementInvoices.finalize,{...auth,id,revision:row.revision,storageId,confirmed:true,renderToken});
        } finally { await client.mutation(api.statementInvoices.claimRender,{...auth,id,token:renderToken,release:true}); }
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

export async function handleStatementAutomaticGeneration(request:Request,env:StatementEnv):Promise<Response>{
 if(request.method!=="POST"||!env.CONVEX_SERVICE_TOKEN||!await secureHeaderMatches(request.headers.get("Authorization"),`Bearer ${env.CONVEX_SERVICE_TOKEN}`))return json({message:"Unauthorized"},401);
 try{const input=JSON.parse(new TextDecoder().decode(await boundedBytes(request.body,4096))),client=new ConvexHttpClient(env.CONVEX_URL);const job=JSON.parse(await client.query(api.statementAutomation.job,{serviceToken:env.CONVEX_SERVICE_TOKEN,id:input.id,token:input.token}));
 const url=new URL("/api/statements/created-invoices/one-click",request.url);return (await handleStatementInvoices(new Request(url,{method:"POST",headers:{"Content-Type":"application/json",Origin:url.origin},body:JSON.stringify({requestId:job.requestId,ids:[job.transactionId]})}),env,{username:job.actor,role:"administrator"}))!;
 }catch(e){return json({message:e instanceof Error?e.message:"Generation failed"},400);}
}
