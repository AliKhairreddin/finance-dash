import { invoiceCopyHtml } from "./statementInvoiceCopy";
import puppeteer from "@cloudflare/puppeteer";
import { invoiceLayout, invoiceTotals, validateInvoiceDraft, type InvoiceDraft, type InvoiceTemplateLayout } from "../shared/statementInvoices";
export type InvoiceBrand = { width: number; height: number; header: string; footer: string; image?: string; pages?: number; text: Array<{ text: string; top: number; bottom: number; x: number; y: number; width: number; height: number; font: string }> };
const assets = "https://finance.thatcanadian.dev/statement-ocr-assets/";
const encode = (bytes: Uint8Array) => { let result = ""; for (let i = 0; i < bytes.length; i += 8192) result += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(result); };
export function invoiceTemplateHtml(bytes: Uint8Array, headerPercent: number, footerPercent: number, copy?: InvoiceTemplateLayout["copy"]) {
  const input = JSON.stringify({ data: encode(bytes), assets, headerPercent, footerPercent, masks: copy ? [...copy.erase.map(b => ({ ...b, background: "#ffffff" })), ...copy.fields.map(f => ({ x: f.x, y: f.y, width: f.width, height: f.height, background: f.background }))] : [] }).replaceAll("<", "\\u003c");
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' https://finance.thatcanadian.dev blob:; worker-src blob: https://finance.thatcanadian.dev; connect-src https://finance.thatcanadian.dev blob: data:; img-src data: blob:"><pre id="result"></pre><script type="module">
const input=${input};let task;
try { const pdfjs=await import(input.assets+'pdf.min.mjs');pdfjs.GlobalWorkerOptions.workerSrc=input.assets+'pdf.worker.min.mjs';
task=pdfjs.getDocument({data:Uint8Array.from(atob(input.data),c=>c.charCodeAt(0)),isEvalSupported:false,enableXfa:false,cMapUrl:input.assets+'cmaps/',cMapPacked:true,standardFontDataUrl:input.assets+'standard_fonts/',wasmUrl:input.assets+'wasm/'});
const pdf=await task.promise;if(pdf.numPages>5)throw Error('Use an example with no more than 5 pages');
const page=await pdf.getPage(1);if(page.rotate)throw Error('Use an upright example PDF without page rotation');const size=page.getViewport({scale:1});if(size.width<300||size.height<400||size.width>1000||size.height>1400)throw Error('Use a standard-size invoice example');
const viewport=page.getViewport({scale:Math.min(2,1600/size.width)}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
function strip(percent,bottom){if(!percent)return '';const cropped=document.createElement('canvas');cropped.width=canvas.width;cropped.height=Math.ceil(canvas.height*percent/100);cropped.getContext('2d').drawImage(canvas,0,bottom?canvas.height-cropped.height:0,canvas.width,cropped.height,0,0,cropped.width,cropped.height);return cropped.toDataURL('image/png');}
const content=await page.getTextContent();const text=content.items.filter(x=>'str' in x&&x.str.trim()&&x.width>0&&x.height>0).map(x=>({text:x.str,x:x.transform[4],y:size.height-x.transform[5]-x.height,width:x.width,height:x.height,font:x.fontName,top:100*(1-(x.transform[5]+x.height)/size.height),bottom:100*(1-x.transform[5]/size.height)}));
// Remove old values from the embedded raster itself, not only from an overlay.
const paint=canvas.getContext('2d'),factor=viewport.scale;for(const mask of input.masks){paint.fillStyle=mask.background;paint.fillRect(mask.x*factor,mask.y*factor,mask.width*factor,mask.height*factor);}
document.getElementById('result').textContent=JSON.stringify({width:size.width,height:size.height,header:strip(input.headerPercent,false),footer:strip(input.footerPercent,true),image:canvas.toDataURL('image/png'),pages:pdf.numPages,text});
}catch(e){document.getElementById('result').textContent=JSON.stringify({error:e.message})}finally{if(task)await task.destroy();document.body.appendChild(Object.assign(document.createElement('span'),{id:'done'}));}</script>`;
}
export const invoiceEscape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
export function invoiceHtml(input: InvoiceDraft, profile: InvoiceTemplateLayout, draft: boolean): string {
  const value = validateInvoiceDraft(input), layout = invoiceLayout(profile), totals = invoiceTotals(value), esc = invoiceEscape;
  const design = layout.design;
  const templateCss = {
    corporate: ".meta{padding:12pt;background:#f3f5f8}.details h2{text-transform:uppercase;letter-spacing:1pt}",
    minimal: ".brand{border:0;margin-bottom:36pt}th{background:white;border-bottom:1pt solid #bbb}.details{gap:36pt}.totals div{padding:8pt}",
    technology: ".brand{border-bottom-width:4pt}.meta{border:1pt solid #d8dee8;padding:12pt;border-radius:6pt}h1{font-size:26pt}.amount{font-family:monospace}",
    insurance: ".details{padding:16pt;background:#f5f7fa;border-left-width:4pt}h1{font-family:Georgia,serif}.brand strong{font-family:Georgia,serif}.meta span{text-transform:uppercase}",
    professional_services: "body{font-family:Georgia,serif;line-height:1.6}.brand{border-bottom:1pt solid #999}.meta{padding-bottom:12pt;border-bottom:1pt solid #ddd}th{font-family:Arial,sans-serif;text-transform:uppercase}",
    retail: "h1{font-size:28pt}.brand{justify-content:center}.meta{justify-content:space-between}.total{font-size:17pt;background:#f6f6f6;padding:12pt!important}",
    subscription: ".meta{display:grid;grid-template-columns:1fr 1fr 1fr;border-top:1pt solid #ddd;border-bottom:1pt solid #ddd;padding:14pt 0}.brand{margin-bottom:14pt}th{padding-top:12pt;padding-bottom:12pt}.total{border-top-width:3pt}"
  };

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src 'none'; img-src https://finance.thatcanadian.dev"><style>
  *{box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:10pt;color:#17272c;margin:0;line-height:1.45}h1{font-size:23pt;margin:0 0 8pt}h2{font-size:10pt;margin:0 0 5pt;color:#4c6268}.details{display:flex;gap:24pt;margin-bottom:20pt}.details>div{flex:1;min-width:0}.text{white-space:pre-wrap;overflow-wrap:anywhere}.meta{margin:12pt 0 20pt;display:flex;gap:24pt;flex-wrap:wrap}.meta span{display:block;font-size:9pt;color:#4c6268}table{border-collapse:collapse;width:100%;table-layout:fixed}thead{display:table-header-group}tr{break-inside:avoid}th{text-align:left;background:#edf3f2;border-bottom:1pt solid #aabebb;padding:8pt 5pt;font-size:9pt}td{padding:9pt 5pt;border-bottom:.5pt solid #d9e1e0;vertical-align:top;overflow-wrap:anywhere}.amount{text-align:right;font-variant-numeric:tabular-nums}.totals{margin:16pt 0 20pt auto;width:240pt;break-inside:avoid}.totals div{display:flex;justify-content:space-between;padding:5pt}.total{border-top:1pt solid #7a9890;font-size:13pt;font-weight:700}.note{white-space:pre-wrap;overflow-wrap:anywhere;margin-top:16pt}.draft{color:#a44a13;font-size:11pt;font-weight:bold;margin-bottom:12pt}
  ${design ? `body{font-family:${design.font === "serif" ? "Georgia,serif" : "Arial,sans-serif"};color:#252b31;background:white}h1{color:#252b31}th{background:#f7f7f7;border-color:${design.accent}}.total{border-color:${design.accent}}.brand{display:flex;align-items:center;justify-content:flex-start;gap:12pt;margin-bottom:24pt;padding-bottom:14pt;border-bottom:${design.style === "rule" ? "3" : "1"}pt solid ${design.accent}}.brand strong{font-size:${design.style === "minimal" ? "20" : "17"}pt;color:#252b31;letter-spacing:${design.style === "minimal" ? "1" : "0"}pt}.brand img{max-width:150pt;max-height:48pt;object-fit:contain}.logo-crop{width:150pt;height:48pt;overflow:hidden;display:flex;align-items:center}.logo-crop img{width:150pt;height:150pt;max-height:none}.details{${design.style === "frame" ? `padding:12pt;border-left:2pt solid ${design.accent};` : ""}}` : ""}
  ${design?.template ? templateCss[design.template] : ""}
  </style></head><body>${design ? `<div class="brand">${design.logoDataUrl || design.logoPath ? `<span class="${design.logoMode === "padded" ? "logo-crop" : "logo"}"><img src="${esc(design.logoDataUrl || `https://finance.thatcanadian.dev${design.logoPath}`)}" alt="${esc(design.name)}"></span>${design.logoMode === "mark" ? `<strong>${esc(design.name)}</strong>` : ""}` : `<strong>${esc(design.name)}</strong>`}</div>` : ""}${draft ? '<div class="draft">DRAFT — CHECK BEFORE USE</div>' : ""}<h1>${value.documentType === "internal_support" ? "Supporting document" : "Invoice"}</h1>${value.documentType === "internal_support" ? '<p class="note">Internal accounting record. Not a supplier-issued invoice. Tax has not been assessed.</p>' : ""}<div class="meta"><div><span>Document number</span>${esc(value.number)}</div><div><span>${value.documentType === "internal_support" ? "Transaction date" : "Issue date"}</span>${esc(value.date)}</div>${value.dueDate ? `<div><span>Due date</span>${esc(value.dueDate)}</div>` : ""}<div><span>Currency</span>${esc(value.currency)}</div></div><div class="details"><div><h2>${value.documentType === "internal_support" ? "Prepared by" : "From"}</h2><div class="text">${esc(layout.sellerDetails)}</div></div><div><h2>${value.documentType === "internal_support" ? "Counterparty" : "Bill to"}</h2><div class="text"><b>${esc(value.customer)}</b>\n${esc(value.customerAddress)}${value.customerVat ? `\nVAT: ${esc(value.customerVat)}` : ""}</div></div></div><table><thead><tr><th style="width:53%">Description</th><th class="amount" style="width:17%">${value.taxAssessment === "unassessed" ? "Recorded amount" : "Before tax"}</th><th class="amount" style="width:12%">Tax %</th><th class="amount" style="width:18%">Total</th></tr></thead><tbody>${value.lines.map((line, i) => `<tr><td class="text">${esc(line.description)}</td><td class="amount">${totals.lines[i].net}</td><td class="amount">${value.taxAssessment === "unassessed" ? "—" : `${esc(line.taxPercent)}%`}</td><td class="amount">${totals.lines[i].total}</td></tr>`).join("")}</tbody></table><div class="totals"><div><span>${value.taxAssessment === "unassessed" ? "Recorded amount" : "Before tax"}</span><span>${totals.net}</span></div><div><span>Tax</span><span>${value.taxAssessment === "unassessed" ? "Not assessed" : totals.tax}</span></div><div class="total"><span>Total ${esc(value.currency)}</span><span>${totals.total}</span></div></div>${value.notes ? `<div class="note">${esc(value.notes)}</div>` : ""}${layout.paymentDetails ? `<div class="note">${esc(layout.paymentDetails)}</div>` : ""}</body></html>`;
}
async function openBrowser(env: Pick<WorkerEnv, "BROWSER">) { return puppeteer.launch(env.BROWSER); }
async function readBrand(page: Awaited<ReturnType<Awaited<ReturnType<typeof openBrowser>>["newPage"]>>, bytes: Uint8Array, profile: InvoiceTemplateLayout) {
  await page.setCacheEnabled(false);
  await page.setContent(invoiceTemplateHtml(bytes, profile.headerPercent, profile.footerPercent, profile.copy), { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForSelector("#done", { timeout: 60000 });
  const raw = await page.$eval("#result", element => element.textContent ?? ""); if (raw.length > 12 * 1024 * 1024) throw new Error("The example image is too large");
  const result = JSON.parse(raw) as InvoiceBrand & { error?: string }; if (result.error) throw new Error(result.error);
  if (!Number.isFinite(result.width) || !Number.isFinite(result.height) || !Array.isArray(result.text)) throw new Error("The example PDF could not be read");
  return result;
}
export async function inspectInvoiceExample(env: Pick<WorkerEnv, "BROWSER">, bytes: Uint8Array) {
  const browser = await openBrowser(env); try { return await readBrand(await browser.newPage(), bytes, { headerPercent: 0, footerPercent: 0, sellerDetails: "Example", paymentDetails: "" }); } finally { await browser.close(); }
}
export async function renderInvoicePdf(env: Pick<WorkerEnv, "BROWSER">, example: Uint8Array | null, profile: InvoiceTemplateLayout, draft: InvoiceDraft, isDraft: boolean): Promise<Uint8Array<ArrayBuffer>> {
  const layout = invoiceLayout(profile), browser = await openBrowser(env);
  try {
    const brand: InvoiceBrand = example === null ? { width: 595.28, height: 841.89, header: "", footer: "", text: [] } : await readBrand(await browser.newPage(), example, layout);
    if (example === null && (layout.headerPercent || layout.footerPercent)) throw new Error("Plain invoices do not use PDF header or footer images");
    if (layout.copy) {
      if (!example || brand.pages !== 1 || !brand.image) throw new Error("Use a one-page PDF for the saved example design");
      if (Math.abs(brand.width - layout.copy.width) > 2 || Math.abs(brand.height - layout.copy.height) > 2) throw new Error("The example page size changed. Read it again in Settings.");
      const page = await browser.newPage();
      await page.setContent(invoiceCopyHtml(draft, layout, brand.image, isDraft), { waitUntil: "load", timeout: 15000 });
      const overflow = await page.$$eval("[data-copy-field]", nodes => nodes.filter(n => n.scrollHeight > n.clientHeight + 2 || n.scrollWidth > n.clientWidth + 2).map(n => n.getAttribute("data-copy-field")));
      if (overflow.length) throw new Error(`The ${overflow.join(", ")} text does not fit this example. Shorten it or choose fewer transactions.`);
      const pdf = await page.pdf({ width: `${brand.width / 72}in`, height: `${brand.height / 72}in`, printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
      if (pdf.length > 15 * 1024 * 1024) throw new Error("The invoice PDF is too large");
      return new Uint8Array(pdf);
    }
    // A fresh document prevents the example reader's restrictive CSP from
    // carrying over and disabling the invoice's print stylesheet.
    const page = await browser.newPage();
    await page.setContent(invoiceHtml(draft, layout, isDraft), { waitUntil: "load", timeout: 15000 });
    if (layout.design?.logoPath || layout.design?.logoDataUrl) {
      const loaded = await page.$$eval(".brand img", images => images.every(i => (i as HTMLImageElement).complete && (i as HTMLImageElement).naturalWidth > 0));
      if (!loaded) throw new Error("The company logo could not load. Please try the PDF again.");
    }
    const headerHeight = brand.height * layout.headerPercent / 100, footerHeight = brand.height * layout.footerPercent / 100;
    const pdf = await page.pdf({ width: `${brand.width / 72}in`, height: `${brand.height / 72}in`, printBackground: true, displayHeaderFooter: true,
      margin: { top: `${(headerHeight + 28) / 72}in`, bottom: `${(footerHeight + 32) / 72}in`, left: "0.5in", right: "0.5in" },
      headerTemplate: `<div style="width:100%;margin-top:-15px">${brand.header ? `<img src="${brand.header}" style="width:100%;height:${headerHeight}pt">` : ""}</div>`,
      footerTemplate: `<div style="width:100%;font-size:8px;text-align:center"><div style="margin-bottom:6px">${isDraft ? "DRAFT · " : ""}Page <span class="pageNumber"></span> / <span class="totalPages"></span></div>${brand.footer ? `<img src="${brand.footer}" style="width:100%;height:${footerHeight}pt">` : ""}</div>` });
    if (pdf.length > 15 * 1024 * 1024) throw new Error("The invoice PDF is too large. Use fewer transactions");
    return new Uint8Array(pdf);
  } finally { await browser.close(); }
}
