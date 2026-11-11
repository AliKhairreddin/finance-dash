// Explicit administrator maintenance. Prepare locally, review, then apply the manifest.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import type { InvoiceDraft, InvoiceTemplateLayout } from "../shared/statementInvoices";
import { invoiceTotals } from "../shared/statementInvoices";
import { invoiceHtml } from "../worker/statementInvoicePdf";
import { productionEnvironment, productionServiceEnvironment, productionUrl } from "./deploy-production";

type Saved = { _id: Id<"statementInvoices">; number: string; documentType?: string; state: string; revision: number; storageId?: Id<"_storage">; pdfUrl?: string; templateUrl?: string; draft: InvoiceDraft; layout: InvoiceTemplateLayout; draftJson: string; sourceJson: string; plainLayoutJson?: string };
type Item = { saved: Saved; beforePath: string; afterPath: string; sha256: string; storageId?: Id<"_storage">; applied?: boolean };
type Manifest = { productionUrl: string; items: Item[]; skipped: number; createdAt: string };
const [mode, input] = process.argv.slice(2);
if (!["--prepare", "--apply"].includes(mode) || mode === "--apply" && !input) throw Error("Use --prepare or --apply <reviewed-manifest.json>");
const env = productionServiceEnvironment(productionEnvironment(process.env));
const client = new ConvexHttpClient(productionUrl), auth = { serviceToken: env.CONVEX_SERVICE_TOKEN!, actor: "Ali" };
const removed = /Supporting document|Expense record|Prepared internally|Prepared by|Supplier:/i;
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const save = (path: string, value: unknown) => writeFileSync(path, JSON.stringify(value, null, 2), { mode: 0o600 });
const text = (path: string) => execFileSync("pdftotext", [path, "-"], { encoding: "utf8" });
const read = async (id: Id<"statementInvoices">): Promise<Saved> => JSON.parse(await client.query(api.statementInvoices.get, { ...auth, id }));
const run = (args: string[]) => JSON.parse(execFileSync("npx", ["convex", "run", ...args, "--deployment", "famous-oyster-878", "--codegen", "disable", "--typecheck", "disable"], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024 }));
function references(items: Item[]) {
  return run(["--inline-query", `const ids=${JSON.stringify(items.map(i => i.saved._id))}; const result=[]; for(const id of ids){ const invoice=await ctx.db.get(id); const documents=await ctx.db.query("statementDocuments").withIndex("by_generatedInvoiceId",q=>q.eq("generatedInvoiceId",id)).take(2); const transactions=[]; for(const s of JSON.parse(invoice.sourceJson))transactions.push(await ctx.db.get(s.transactionId)); const links=[]; for(const d of documents)links.push(...await ctx.db.query("statementLinks").withIndex("by_documentId",q=>q.eq("documentId",d._id)).take(201)); result.push({id,documents,transactions,links}); } return result;`]);
}
function validatePdf(path: string, saved: Saved) {
  const bytes = readFileSync(path); assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  const content = text(path); assert(!removed.test(content), `Extra wording remains in ${saved.number}`);
  for (const value of [saved.number, saved.draft.date, saved.draft.customer, ...saved.layout.sellerDetails.split("\n").filter(Boolean), ...saved.draft.lines.map(line => line.description), invoiceTotals(saved.draft).total]) assert(content.replace(/\s+/g, " ").includes(value.replace(/\s+/g, " ")), `Missing ${value}`);
}
if (mode === "--prepare") {
  const dir = resolve(`.local/statement-pdf-refresh-${Date.now()}`); mkdirSync(dir, { recursive: true, mode: 0o700 });
  const listing = JSON.parse(await client.query(api.statementInvoices.list, auth)); assert.equal(listing.truncated, false, "Use paginated maintenance for more than 100 documents");
  const manifest: Manifest = { productionUrl, items: [], skipped: 0, createdAt: new Date().toISOString() };
  const browser = await chromium.launch();
  try {
    for (const row of listing.invoices) {
      const saved = await read(row.id);
      if (!saved.pdfUrl) { manifest.skipped++; continue; }
      const response = await fetch(saved.pdfUrl, { signal: AbortSignal.timeout(30000) }); assert.equal(response.status, 200);
      const beforePath = `${dir}/${saved._id}-before.pdf`, afterPath = `${dir}/${saved._id}-after.pdf`;
      writeFileSync(beforePath, Buffer.from(await response.arrayBuffer()), { mode: 0o600 });
      if (!removed.test(text(beforePath))) { manifest.skipped++; continue; }
      assert.equal(saved.documentType, "internal_support"); assert.equal(saved.state, "ready");
      assert(!saved.templateUrl && !saved.layout.copy && !saved.layout.headerPercent && !saved.layout.footerPercent && !saved.layout.design?.logoPath && !saved.layout.design?.logoDataUrl, "Review nonstandard or image-based layouts separately");
      const page = await browser.newPage(); await page.route("**/*", route => route.abort());
      await page.setContent(invoiceHtml(saved.draft, saved.layout, false), { waitUntil: "load" });
      const bytes = await page.pdf({ width: `${595.28 / 72}in`, height: `${841.89 / 72}in`, printBackground: true, displayHeaderFooter: true,
        margin: { top: `${28 / 72}in`, bottom: `${32 / 72}in`, left: "0.5in", right: "0.5in" },
        headerTemplate: '<div style="width:100%;margin-top:-15px"></div>',
        footerTemplate: '<div style="width:100%;font-size:8px;text-align:center"><div style="margin-bottom:6px">Page <span class="pageNumber"></span> / <span class="totalPages"></span></div></div>' });
      await page.close(); writeFileSync(afterPath, bytes, { mode: 0o600 }); validatePdf(afterPath, saved);
      manifest.items.push({ saved, beforePath, afterPath, sha256: hash(bytes) });
    }
  } finally { await browser.close(); }
  save(`${dir}/references-before.json`, references(manifest.items)); save(`${dir}/manifest.json`, manifest);
  console.log(JSON.stringify({ prepared: manifest.items.length, skipped: manifest.skipped, manifest: `${dir}/manifest.json` }));
} else {
  const manifestPath = resolve(input), manifest: Manifest = JSON.parse(readFileSync(manifestPath, "utf8")); assert.equal(manifest.productionUrl, productionUrl);
  // Validate all reviewed files and unchanged snapshots before the first upload.
  for (const item of manifest.items) {
    assert.equal(hash(readFileSync(item.afterPath)), item.sha256); validatePdf(item.afterPath, item.saved);
    const current = await read(item.saved._id);
    for (const key of ["number", "state", "documentType", "draftJson", "sourceJson", "plainLayoutJson"] as const) assert.deepEqual(current[key], item.saved[key]);
    if (item.storageId && current.storageId === item.storageId && current.revision === item.saved.revision + 1) item.applied = true;
    assert.equal(current.revision, item.saved.revision + (item.applied ? 1 : 0));
    assert.equal(current.storageId, item.applied ? item.storageId : item.saved.storageId);
  }
  const before = references(manifest.items); save(manifestPath.replace("manifest.json", `references-apply-${Date.now()}.json`), before);
  for (const item of manifest.items) {
    if (!item.storageId) {
      const url = await client.mutation(api.statements.generateUploadUrl, { serviceToken: auth.serviceToken });
      const response = await fetch(url, { method: "POST", body: new Blob([readFileSync(item.afterPath)], { type: "application/pdf" }), headers: { "Content-Type": "application/pdf" }, signal: AbortSignal.timeout(30000) }); assert.equal(response.status, 200);
      item.storageId = (await response.json() as { storageId: Id<"_storage"> }).storageId; save(manifestPath, manifest);
    }
    if (!item.applied) {
      run(["statementInvoices:replaceRenderedPdf", JSON.stringify({ actor: auth.actor, id: item.saved._id, expectedRevision: item.saved.revision, expectedStorageId: item.saved.storageId, storageId: item.storageId })]);
      item.applied = true; save(manifestPath, manifest);
    }
    const current = await read(item.saved._id); assert.equal(current.storageId, item.storageId);
    assert.equal(current.draftJson, item.saved.draftJson); assert.equal(current.sourceJson, item.saved.sourceJson);
    const response = await fetch(current.pdfUrl!, { signal: AbortSignal.timeout(30000) }); assert.equal(response.status, 200);
    assert.equal(hash(Buffer.from(await response.arrayBuffer())), item.sha256);
  }
  const after = references(manifest.items); save(manifestPath.replace("manifest.json", "references-after.json"), after);
  for (let i = 0; i < before.length; i++) {
    assert.deepEqual(after[i].transactions, before[i].transactions); assert.deepEqual(after[i].links, before[i].links);
    assert.equal(after[i].documents.length, before[i].documents.length);
    for (let d = 0; d < before[i].documents.length; d++) assert.deepEqual(after[i].documents[d], { ...before[i].documents[d], storageId: after[i].documents[d].storageId, size: after[i].documents[d].size, updatedAt: after[i].documents[d].updatedAt });
  }
  console.log(JSON.stringify({ updated: manifest.items.length, skipped: manifest.skipped, preserved: "numbers, dates, amounts, snapshots, transaction links and archived originals", manifest: manifestPath }));
}
