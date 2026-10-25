import puppeteer from "@cloudflare/puppeteer";

export interface StatementText {
  pages: Array<{ page: number; text: string }>;
  method: "pdf-text" | "ocr" | "text";
  warnings: string[];
}

const assetBase = "https://finance.thatcanadian.dev/statement-ocr-assets/";
const maximumBytes = 15 * 1024 * 1024;
const maximumPages = 40;
const maximumCharacters = 240_000;
export class StatementOcrError extends Error {
  constructor(message: string, readonly retryAfterMs: number) { super(message); }
}

export function statementOcrHtml(bytes: Uint8Array, contentType: string, assets = assetBase): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  const payload = JSON.stringify({ data: btoa(binary), contentType, assets, maximumPages, maximumCharacters }).replace(/</g, "\\u003c");
  const origin = new URL(assets).origin;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval' ${origin} blob:; worker-src blob: ${origin}; connect-src ${origin} blob: data:; img-src blob: data:; style-src 'unsafe-inline'; base-uri 'none'"></head><body><pre id="result"></pre><script type="module">
const input = ${payload};
let ocr, pdf, loadingTask;
const finish = value => { document.getElementById('result').textContent = JSON.stringify(value); document.body.appendChild(Object.assign(document.createElement('span'), {id:'done',textContent:'Done'})); };
try {
  const data = Uint8Array.from(atob(input.data), character => character.charCodeAt(0));
  const pages = [], warnings = []; let method = 'pdf-text', characters = 0;
  async function recognize(image) {
    if (!ocr) {
      await new Promise((resolve,reject) => { const script = document.createElement('script'); script.src = input.assets+'tesseract.min.js'; script.onload = resolve; script.onerror = () => reject(Error('OCR runtime could not load')); document.head.appendChild(script); });
      ocr = await Tesseract.createWorker('eng+nld', 1, {workerPath:input.assets+'worker.min.js', corePath:input.assets+'core', langPath:input.assets, cacheMethod:'none', gzip:true});
    }
    method = 'ocr';
    const result = await ocr.recognize(image);
    if (result.data.confidence < 70) warnings.push('Page '+(pages.length+1)+' has low OCR confidence; verify its values against the original.');
    return result.data.text;
  }
  function addPage(page, text) {
    characters += text.length;
    if (characters > input.maximumCharacters) throw Error('Document text exceeds the extraction limit. Split the original into smaller files.');
    if (!text.trim()) warnings.push('Page '+page+' contains no readable text. Review the original.');
    pages.push({page,text});
  }
  if (input.contentType === 'application/pdf') {
    const pdfjs = await import(input.assets+'pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = input.assets+'pdf.worker.min.mjs';
    loadingTask = pdfjs.getDocument({data, isEvalSupported:false, enableXfa:false, cMapUrl:input.assets+'cmaps/', cMapPacked:true, standardFontDataUrl:input.assets+'standard_fonts/', wasmUrl:input.assets+'wasm/'}); pdf = await loadingTask.promise;
    if (pdf.numPages > input.maximumPages) throw Error('Documents may contain at most '+input.maximumPages+' pages. Split the original before retrying.');
    for (let index=1; index<=pdf.numPages; index++) {
      const page = await pdf.getPage(index), content = await page.getTextContent();
      let text = content.items.map(item => 'str' in item ? item.str+(item.hasEOL?'\\n':' ') : '').join('');
      const operations = await page.getOperatorList();
      const hasRasterContent = operations.fnArray.some((operator,index) => {
        const args = operations.argsArray[index];
        if(operator === pdfjs.OPS.paintImageXObject) return Number(args[1])*Number(args[2]) >= 100000;
        if(operator === pdfjs.OPS.paintInlineImageXObject) return Number(args[0]?.width)*Number(args[0]?.height) >= 100000;
        return operator === pdfjs.OPS.paintImageXObjectRepeat || operator === pdfjs.OPS.paintInlineImageXObjectGroup;
      });
      if (text.replace(/\\s/g,'').length < 45 || hasRasterContent) {
        const initial = page.getViewport({scale:1}), scale = Math.min(2,2200/Math.max(initial.width,initial.height));
        const viewport = page.getViewport({scale}), canvas = document.createElement('canvas'); canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
        await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
        const recognized = await recognize(canvas); canvas.width=canvas.height=0;
        if (text.trim().length >= 45) {
          text = 'NATIVE TEXT FROM THIS PAGE:\\n'+text+'\\nOCR OF THE SAME PAGE (overlapping evidence, not additional transactions):\\n'+recognized;
          warnings.push('Page '+index+' contains both native text and raster content; compare overlapping evidence against the original.');
        } else text = recognized;
      }
      addPage(index,text); page.cleanup();
    }
  } else {
    const blobUrl=URL.createObjectURL(new Blob([data],{type:input.contentType}));
    try { const image=new Image(); image.src=blobUrl; await image.decode(); if(image.naturalWidth*image.naturalHeight > 30_000_000) throw Error('Image exceeds 30 megapixels'); addPage(1,await recognize(image)); }
    finally {URL.revokeObjectURL(blobUrl);}
  }
  if (!pages.some(page=>page.text.trim())) throw Error('No readable text was found. Upload a clearer original.');
  finish({pages,method,warnings});
} catch(error) { finish({error:error instanceof Error?error.message:'Document text could not be read'}); }
finally { if(ocr) await ocr.terminate(); if(loadingTask) await loadingTask.destroy(); }
</script></body></html>`;
}

export function parseStatementOcrResult(value: unknown): StatementText {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid document text extraction result");
  const result = value as StatementText & { error?: string };
  if (result.error) throw new Error(result.error.slice(0, 500));
  if (!Array.isArray(result.pages) || !result.pages.length || result.pages.length > maximumPages || !["pdf-text", "ocr"].includes(result.method) || !Array.isArray(result.warnings) || result.warnings.some(value => typeof value !== "string")) throw new Error("Invalid document text extraction result");
  if (result.pages.some((page, index) => page.page !== index + 1 || typeof page.text !== "string") || result.pages.reduce((sum, page) => sum + page.text.length, 0) > maximumCharacters) throw new Error("Document text extraction was incomplete or too large");
  return result;
}

export async function extractStatementText(env: Pick<WorkerEnv, "BROWSER">, bytes: Uint8Array, contentType: string): Promise<StatementText> {
  if (!bytes.length || bytes.length > maximumBytes) throw new Error("Documents must be between 1 byte and 15 MB");
  if (contentType === "text/plain") {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.length > maximumCharacters) throw new Error("Document text exceeds the extraction limit");
    return { pages: [{ page: 1, text }], method: "text", warnings: [] };
  }
  if (!["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(contentType)) throw new Error("Use a PDF, PNG, JPEG, or WebP document");
  const browser = await puppeteer.launch({ fetch: async (input, init) => {
    const response = await env.BROWSER.fetch(input, init);
    if (response.status === 429 || response.status >= 500) {
      const header = response.headers.get("Retry-After");
      const delay = header && /^\d+$/.test(header) ? Number(header) * 1000 : header ? Date.parse(header) - Date.now() : 60000;
      await response.body?.cancel();
      throw new StatementOcrError(`Document text service returned ${response.status}; the original is preserved`, Number.isFinite(delay) ? Math.max(1000, Math.min(3_600_000, delay)) : 60000);
    }
    return response;
  } }, { keep_alive: 120000 });
  try {
    const page = await browser.newPage();
    await page.setCacheEnabled(false);
    await page.setContent(statementOcrHtml(bytes, contentType), { waitUntil: "domcontentloaded", timeout: 15000 });
    // Quick Actions HTML scraping can finish before async modules complete.
    // An explicit CDP wait ties successful extraction to our completion marker.
    await page.waitForSelector("#done", { timeout: 110000 });
    const text = await page.$eval("#result", element => element.textContent ?? "");
    if (!text) throw new Error("Document text extraction did not finish; retry the saved original");
    return parseStatementOcrResult(JSON.parse(text));
  } finally { await browser.close(); }
}
