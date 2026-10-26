import puppeteer from "@cloudflare/puppeteer";
import { invoiceLayout, invoiceTotals, validateInvoiceDraft, type InvoiceDraft, type InvoiceTemplateLayout } from "../shared/statementInvoices";
export type InvoiceBrand = { width: number; height: number; header: string; footer: string; text: Array<{ text: string; top: number; bottom: number }> };
const assets = "https://finance.thatcanadian.dev/statement-ocr-assets/";
const encode = (bytes: Uint8Array) => { let result = ""; for (let i = 0; i < bytes.length; i += 8192) result += String.fromCharCode(...bytes.subarray(i, i + 8192)); return btoa(result); };
export function invoiceTemplateHtml(bytes: Uint8Array, headerPercent: number, footerPercent: number) {
  const input = JSON.stringify({ data: encode(bytes), assets, headerPercent, footerPercent }).replaceAll("<", "\\u003c");
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' https://finance.thatcanadian.dev blob:; worker-src blob: https://finance.thatcanadian.dev; connect-src https://finance.thatcanadian.dev blob: data:; img-src data: blob:"><pre id="result"></pre><script type="module">
const input=${input};let task;
try { const pdfjs=await import(input.assets+'pdf.min.mjs');pdfjs.GlobalWorkerOptions.workerSrc=input.assets+'pdf.worker.min.mjs';
task=pdfjs.getDocument({data:Uint8Array.from(atob(input.data),c=>c.charCodeAt(0)),isEvalSupported:false,enableXfa:false,cMapUrl:input.assets+'cmaps/',cMapPacked:true,standardFontDataUrl:input.assets+'standard_fonts/',wasmUrl:input.assets+'wasm/'});
const pdf=await task.promise;if(pdf.numPages>5)throw Error('Use an example with no more than 5 pages');
const page=await pdf.getPage(1),size=page.getViewport({scale:1});if(size.width<300||size.height<400||size.width>1000||size.height>1400)throw Error('Use a standard-size invoice example');
const viewport=page.getViewport({scale:Math.min(2,1600/size.width)}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
function strip(percent,bottom){if(!percent)return '';const cropped=document.createElement('canvas');cropped.width=canvas.width;cropped.height=Math.ceil(canvas.height*percent/100);cropped.getContext('2d').drawImage(canvas,0,bottom?canvas.height-cropped.height:0,canvas.width,cropped.height,0,0,cropped.width,cropped.height);return cropped.toDataURL('image/png');}
const content=await page.getTextContent();const text=content.items.filter(x=>'str' in x).map(x=>({text:x.str,top:100*(1-(x.transform[5]+x.height)/size.height),bottom:100*(1-x.transform[5]/size.height)}));
document.getElementById('result').textContent=JSON.stringify({width:size.width,height:size.height,header:strip(input.headerPercent,false),footer:strip(input.footerPercent,true),text});
}catch(e){document.getElementById('result').textContent=JSON.stringify({error:e.message})}finally{if(task)await task.destroy();document.body.appendChild(Object.assign(document.createElement('span'),{id:'done'}));}</script>`;
}
export const invoiceEscape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
export function invoiceHtml(input: InvoiceDraft, profile: InvoiceTemplateLayout, draft: boolean): string {
  const value = validateInvoiceDraft(input), layout = invoiceLayout(profile), totals = invoiceTotals(value), esc = invoiceEscape;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src 'none'"><style>
  *{box-sizing:border-box}body{font-family:Arial,sans-serif;font-size:10pt;color:#17272c;margin:0;line-height:1.45}h1{font-size:23pt;margin:0 0 8pt}h2{font-size:10pt;margin:0 0 5pt;color:#4c6268}.details{display:flex;gap:24pt;margin-bottom:20pt}.details>div{flex:1;min-width:0}.text{white-space:pre-wrap;overflow-wrap:anywhere}.meta{margin:12pt 0 20pt;display:flex;gap:24pt;flex-wrap:wrap}.meta span{display:block;font-size:9pt;color:#4c6268}table{border-collapse:collapse;width:100%;table-layout:fixed}thead{display:table-header-group}tr{break-inside:avoid}th{text-align:left;background:#edf3f2;border-bottom:1pt solid #aabebb;padding:8pt 5pt;font-size:9pt}td{padding:9pt 5pt;border-bottom:.5pt solid #d9e1e0;vertical-align:top;overflow-wrap:anywhere}.amount{text-align:right;font-variant-numeric:tabular-nums}.totals{margin:16pt 0 20pt auto;width:240pt;break-inside:avoid}.totals div{display:flex;justify-content:space-between;padding:5pt}.total{border-top:1pt solid #7a9890;font-size:13pt;font-weight:700}.note{white-space:pre-wrap;overflow-wrap:anywhere;margin-top:16pt}.draft{color:#a44a13;font-size:11pt;font-weight:bold;margin-bottom:12pt}
  </style></head><body>${draft ? '<div class="draft">DRAFT — CHECK BEFORE USE</div>' : ""}<h1>Invoice</h1><div class="meta"><div><span>Invoice number</span>${esc(value.number)}</div><div><span>Invoice date</span>${esc(value.date)}</div>${value.dueDate ? `<div><span>Due date</span>${esc(value.dueDate)}</div>` : ""}<div><span>Currency</span>${esc(value.currency)}</div></div><div class="details"><div><h2>From</h2><div class="text">${esc(layout.sellerDetails)}</div></div><div><h2>Bill to</h2><div class="text"><b>${esc(value.customer)}</b>\n${esc(value.customerAddress)}</div></div></div><table><thead><tr><th style="width:53%">Description</th><th class="amount" style="width:17%">Before tax</th><th class="amount" style="width:12%">Tax %</th><th class="amount" style="width:18%">Total</th></tr></thead><tbody>${value.lines.map((line, i) => `<tr><td class="text">${esc(line.description)}</td><td class="amount">${totals.lines[i].net}</td><td class="amount">${esc(line.taxPercent)}%</td><td class="amount">${totals.lines[i].total}</td></tr>`).join("")}</tbody></table><div class="totals"><div><span>Before tax</span><span>${totals.net}</span></div><div><span>Tax</span><span>${totals.tax}</span></div><div class="total"><span>Total ${esc(value.currency)}</span><span>${totals.total}</span></div></div>${value.notes ? `<div class="note">${esc(value.notes)}</div>` : ""}${layout.paymentDetails ? `<div class="note">${esc(layout.paymentDetails)}</div>` : ""}</body></html>`;
}
async function openBrowser(env: Pick<WorkerEnv, "BROWSER">) { return puppeteer.launch(env.BROWSER); }
async function readBrand(page: Awaited<ReturnType<Awaited<ReturnType<typeof openBrowser>>["newPage"]>>, bytes: Uint8Array, profile: InvoiceTemplateLayout) {
  await page.setCacheEnabled(false);
  await page.setContent(invoiceTemplateHtml(bytes, profile.headerPercent, profile.footerPercent), { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForSelector("#done", { timeout: 60000 });
  const raw = await page.$eval("#result", element => element.textContent ?? ""); if (raw.length > 12 * 1024 * 1024) throw new Error("The example image is too large");
  const result = JSON.parse(raw) as InvoiceBrand & { error?: string }; if (result.error) throw new Error(result.error);
  if (!Number.isFinite(result.width) || !Number.isFinite(result.height) || !Array.isArray(result.text)) throw new Error("The example PDF could not be read");
  return result;
}
export async function inspectInvoiceExample(env: Pick<WorkerEnv, "BROWSER">, bytes: Uint8Array) {
  const browser = await openBrowser(env); try { return await readBrand(await browser.newPage(), bytes, { headerPercent: 0, footerPercent: 0, sellerDetails: "Example", paymentDetails: "" }); } finally { await browser.close(); }
}
export async function renderInvoicePdf(env: Pick<WorkerEnv, "BROWSER">, example: Uint8Array, profile: InvoiceTemplateLayout, draft: InvoiceDraft, isDraft: boolean): Promise<Uint8Array<ArrayBuffer>> {
  const layout = invoiceLayout(profile), browser = await openBrowser(env);
  try {
    const sourcePage = await browser.newPage(), brand = await readBrand(sourcePage, example, layout);
    // A fresh document prevents the example reader's restrictive CSP from
    // carrying over and disabling the invoice's print stylesheet.
    const page = await browser.newPage();
    await page.setContent(invoiceHtml(draft, layout, isDraft), { waitUntil: "load", timeout: 15000 });
    const headerHeight = brand.height * layout.headerPercent / 100, footerHeight = brand.height * layout.footerPercent / 100;
    const pdf = await page.pdf({ width: `${brand.width / 72}in`, height: `${brand.height / 72}in`, printBackground: true, displayHeaderFooter: true,
      margin: { top: `${(headerHeight + 28) / 72}in`, bottom: `${(footerHeight + 32) / 72}in`, left: "0.5in", right: "0.5in" },
      headerTemplate: `<div style="width:100%;margin-top:-15px">${brand.header ? `<img src="${brand.header}" style="width:100%;height:${headerHeight}pt">` : ""}</div>`,
      footerTemplate: `<div style="width:100%;font-size:8px;text-align:center"><div style="margin-bottom:6px">${isDraft ? "DRAFT · " : ""}Page <span class="pageNumber"></span> / <span class="totalPages"></span></div>${brand.footer ? `<img src="${brand.footer}" style="width:100%;height:${footerHeight}pt">` : ""}</div>` });
    if (pdf.length > 15 * 1024 * 1024) throw new Error("The invoice PDF is too large. Use fewer transactions");
    return new Uint8Array(pdf);
  } finally { await browser.close(); }
}
