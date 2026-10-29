import { handleStatementAutomaticGeneration } from "./statementInvoices";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { normalizeStatementActor } from "../shared/statements";
import { parseTelegramAuthUsers } from "./telegram";
import { enforceSiteAuthentication, getDashboardSession } from "./auth";
import { secureHeaderMatches } from "./documentIntake";
import { handleStatementApi, handleStatementProcessing } from "./statements";
import { extractStatementText } from "./statementOcr";
import { extractStatementDetails } from "./statementExtraction";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { exactCallbackLanding, handleExactApi } from "./exact";
import { handleStatementInvoices } from "./statementInvoices";
import { renderInvoicePdf } from "./statementInvoicePdf";
import { invoiceAi } from "./statementInvoiceAi";
import { validateInvoiceAi } from "../shared/statementInvoices";
import { handleCaptureDevice, routeReceiptCapture } from "./receiptCapture";
import { handleMailboxApi, mailboxCallbackLanding } from "./statementMailboxes";
import { verifyInvoiceCopy } from "./statementInvoiceVerification";
import { defaultInvoiceDesign } from "../shared/statementInvoiceDesign";
import { statementCompanies } from "../shared/statements";
import { handleStatementResearch } from "./statementResearch";

export const statementsHostname = "statements.thatcanadian.dev";
export const statementsInbox = "statements@finance.thatcanadian.dev";
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

export function isStatementSurface(url: URL): boolean {
  return url.hostname === statementsHostname || /^\/statements(?:\/|$)/.test(url.pathname) || /^\/api\/statements(?:\/|$)/.test(url.pathname);
}

// Called before legacy finance routing: a session on the statements host cannot
// accidentally reach the finance API, reports, or other host-specific entrypoints.
export async function routeStatementSurface(request: Request, env: WorkerEnv): Promise<Response | null> {
  const capture = await routeReceiptCapture(request, env);
  if (capture) return capture;
  const url = new URL(request.url);
  if (url.pathname === "/api/internal/statements/research") return handleStatementResearch(request, env);
  if (url.pathname === "/api/internal/statements/verify-research") return handleStatementResearch(request, env, true);
  if (url.pathname === "/api/internal/statements/verify-invoice") {
    if (request.method !== "POST" || !env.CONVEX_SERVICE_TOKEN || !await secureHeaderMatches(request.headers.get("Authorization"), `Bearer ${env.CONVEX_SERVICE_TOKEN}`)) return json({ message: "Unauthorized" }, 401);
    try {
      const client = new ConvexHttpClient(env.CONVEX_URL), settings = await client.query(api.statements.processingSettings, { serviceToken: env.CONVEX_SERVICE_TOKEN }), aiSettings = JSON.parse(settings.aiSettingsJson);
      if (aiSettings?.provider !== "openrouter" || !aiSettings.model) throw new Error("Saved model unavailable");
      if (url.searchParams.get("layout") === "copy") {
        const result = await verifyInvoiceCopy(env, aiSettings.model);
        return new Response(result.bytes, { headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store", "X-Invoice-Model": result.model, "X-Invoice-ZDR": "true", "X-Invoice-Total": "121.00" } });
      }
      const ai = await invoiceAi(env.OPENROUTER_API_KEY, aiSettings.model, 'Return JSON {lines:[{transactionId:"sample",description:string}]} describing the supplied synthetic service. No amounts.', { transactionId: "sample", description: "Synthetic layout verification service" });
      const line = validateInvoiceAi(ai.result, ["sample"])[0];
      const example = await PDFDocument.create(), page = example.addPage([595, 842]), font = await example.embedFont(StandardFonts.Helvetica);
      page.drawText("DEMO COMPANY", { x: 36, y: 795, size: 22, font }); page.drawText("OLD INVOICE 999999 - MUST NOT APPEAR", { x: 36, y: 600, size: 12, font }); page.drawText("Demo company - Example bank details", { x: 36, y: 35, size: 10, font });
      const company = statementCompanies.find(c => c.id === url.searchParams.get("company"));
      const plain = url.searchParams.get("layout") === "plain" || Boolean(company);
      const result = await renderInvoicePdf(env, plain ? null : await example.save(), { headerPercent: plain ? 0 : 9, footerPercent: plain ? 0 : 8, sellerDetails: "Demo Company\nExample Street 1\nAmsterdam", paymentDetails: "Synthetic example only. Do not pay.", ...(company ? { design: defaultInvoiceDesign(`our:${company.id}`, company.name), sellerDetails: `${company.name}\nExample Street 1\nAmsterdam` } : {}) }, { number: "LAYOUT-TEST-001", date: "2026-10-26", dueDate: "", customer: "Example Customer", customerAddress: "Example street 2\nMontréal", customerVat: "TEST-VAT-123", notes: "Synthetic verification only. No financial records were created.", currency: "EUR", taxMode: "included", lines: Array.from({ length: company ? 2 : 70 }, (_, i) => ({ transactionId: `sample-${i}`, description: `${line.description} ${i + 1} — café, consultation and project work`, amount: "121.00", taxPercent: "21" })) }, true);
      return new Response(result, { headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store", "X-Invoice-Model": ai.model, "X-Invoice-ZDR": "true", "X-Invoice-Total": company ? "242.00" : "8470.00" } });
    } catch (error) { return json({ message: error instanceof Error ? error.message.slice(0, 500) : "Invoice verification failed" }, 502); }
  }
  if ((url.pathname.startsWith("/statement-ocr-assets/") || /^\/invoice-brands\/[a-z0-9-]+\.(png|svg|jpg)$/.test(url.pathname))) {
    if (!["GET", "HEAD"].includes(request.method)) return json({ message: "Method not allowed" }, 405);
    const response = await env.ASSETS.fetch(request);
    const headers = new Headers(response.headers);
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Cross-Origin-Resource-Policy", "cross-origin");
    headers.set("X-Content-Type-Options", "nosniff");
    return new Response(response.body, { status: response.status, headers });
  }
  if(url.pathname === "/api/statements/process-generation")return handleStatementAutomaticGeneration(request,env);
  if (url.pathname === "/api/statements/process") return handleStatementProcessing(request, env);
  if (url.pathname === "/api/internal/statements/verify-extraction") {
    if (request.method !== "POST" || !env.CONVEX_SERVICE_TOKEN || !await secureHeaderMatches(request.headers.get("Authorization"), `Bearer ${env.CONVEX_SERVICE_TOKEN}`)) return json({ message: "Unauthorized" }, 401);
    try {
      // A fixed synthetic fixture verifies deployed secrets/runtime without
      // creating ledger records or exposing an arbitrary extraction endpoint.
      const client = new ConvexHttpClient(env.CONVEX_URL);
      const settings = await client.query(api.statements.processingSettings, { serviceToken: env.CONVEX_SERVICE_TOKEN });
      const ai = JSON.parse(settings.aiSettingsJson) as { model?: string; provider?: string } | null;
      if (ai?.provider !== "openrouter" || !ai.model) throw new Error("The saved OpenRouter model is unavailable");
      const pdf = await PDFDocument.create(), page = pdf.addPage([700, 500]), font = await pdf.embedFont(StandardFonts.Helvetica);
      page.drawText("INVOICE\nBill to: AMG Holding\nSupplier: Test Supplies\nInvoice INV-2026-101\nInvoice date 2026-10-25\nTotal EUR 123.45\nPayment card ending 5196", { x: 40, y: 450, size: 18, font, lineHeight: 32 });
      const text = await extractStatementText(env, await pdf.save(), "application/pdf");
      if (!text.pages[0]?.text.includes("123.45")) throw new Error("Deployed PDF text extraction failed");
      const result = await extractStatementDetails({ apiKey: env.OPENROUTER_API_KEY, model: ai.model, pages: text.pages, fileName: "synthetic-verification.pdf" });
      if (result.extraction.documentType !== "invoice" || result.extraction.rows.length || result.extraction.amount !== "123.45" || result.extraction.currency !== "EUR" || result.extraction.companyId !== "amg-holding") throw new Error("Deployed AI extraction did not match the synthetic fixture");
      return json({ verified: true, model: ai.model, zdr: true, textMethod: text.method, company: result.extraction.companyId, bankTransactionsCreated: 0, costUsd: result.costUsd });
    } catch (error) { return json({ verified: false, message: error instanceof Error ? error.message.slice(0, 500) : "Extraction verification failed" }, 502); }
  }
  if (url.pathname === "/api/internal/statements/setup") {
    if (!env.CONVEX_SERVICE_TOKEN || !await secureHeaderMatches(request.headers.get("Authorization"), `Bearer ${env.CONVEX_SERVICE_TOKEN}`)) return json({ message: "Unauthorized" }, 401);
    if (!["POST", "GET"].includes(request.method)) return json({ message: "Method not allowed" }, 405);
    const client = new ConvexHttpClient(env.CONVEX_URL);
    try {
      if (request.method === "POST") await client.mutation(api.statements.initialize, { serviceToken: env.CONVEX_SERVICE_TOKEN });
      const config = await client.query(api.statements.bootstrap, { serviceToken: env.CONVEX_SERVICE_TOKEN, actor: "Ali" });
      const processing = await client.query(api.statements.processingSettings, { serviceToken: env.CONVEX_SERVICE_TOKEN });
      const ai = JSON.parse(processing.aiSettingsJson) as { model?: string; provider?: string } | null;
      const configured = [env.TELEGRAM_AUTH_USERS_JSON, env.TELEGRAM_TOPUP_USERS_JSON];
      const users = [...new Set(configured.flatMap(value => parseTelegramAuthUsers(value ?? "") ?? []).flatMap(user => {
        try { return [normalizeStatementActor(user.username)]; } catch { return []; }
      }))];
      return json({ hostname: statementsHostname, inbox: statementsInbox, companies: config.companies, cards: config.cards, users, model: ai?.provider === "openrouter" ? ai.model : null, zdr: true });
    } catch { return json({ message: "Statement setup could not be verified" }, 502); }
  }
  if (!isStatementSurface(url)) return null;
  if (["GET", "HEAD"].includes(request.method) && ["/favicon.svg", "/apple-touch-icon.png", "/site.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png"].includes(url.pathname)) return env.ASSETS.fetch(request);
  if (url.hostname === statementsHostname && url.pathname.startsWith("/api/") && url.pathname !== "/api/session" && !url.pathname.startsWith("/api/statements/")) return json({ message: "Not found" }, 404);
  const mailboxLanding = mailboxCallbackLanding(request);
  if (mailboxLanding) return mailboxLanding;
  const exactLanding = exactCallbackLanding(request);
  if (exactLanding) return exactLanding;
  const authentication = await enforceSiteAuthentication(request, env);
  if (authentication) return authentication;
  const session = await getDashboardSession(request, env);
  if (!session) return json({ message: "Authentication required" }, 401);
  try { normalizeStatementActor(session.username); } catch { return json({ message: "This account cannot access statements" }, 403); }
  if (url.pathname === "/api/session") return request.method === "GET" ? json(session) : json({ message: "Method not allowed" }, 405);
  if (url.pathname.startsWith("/api/statements/")) return await handleMailboxApi(request, env, session) ?? await handleCaptureDevice(request, env, session) ?? await handleExactApi(request, env, session) ?? await handleStatementInvoices(request, env, session) ?? await handleStatementApi(request, env, session) ?? json({ message: "Not found" }, 404);
  if (url.pathname.startsWith("/api/")) return json({ message: "Not found" }, 404);
  if (!["GET", "HEAD"].includes(request.method)) return json({ message: "Method not allowed" }, 405);
  // Static app assets use their original path; all app routes render the root SPA.
  return env.ASSETS.fetch(url.pathname.startsWith("/assets/") || /\.[a-z0-9]+$/i.test(url.pathname)
    ? request : new Request(new URL("/", url), request));
}
