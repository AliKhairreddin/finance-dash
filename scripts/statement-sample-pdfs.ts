import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { invoiceHtml } from "../worker/statementInvoicePdf";
import {
  invoiceDesignStyles,
  expenseInvoiceDesign,
  invoicePageDimensions,
} from "../shared/statementInvoiceDesign";
import { invoiceTotals, type InvoiceDraft } from "../shared/statementInvoices";
import { PDFDocument } from "pdf-lib";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
await mkdir("output/pdf", { recursive: true });
const browser = await chromium.launch();
const results = [];
const structures = new Set<string>();
try {
  for (const template of invoiceDesignStyles) for (const lineCount of [4, 65]) {
    const draft: InvoiceDraft = {
      documentType: "internal_support",
      taxAssessment: "unassessed",
      number: `SYNTHETIC-SUP-2026-${template.toUpperCase()}`,
      date: "2026-10-01",
      dueDate: "",
      customer: "Synthetic Hosting Company",
      customerAddress: "Example Lane 2\nExample City\nSynthetic data only",
      notes:
        "Synthetic demonstration — contains no real financial information.",
      currency: "EUR",
      taxMode: "included",
      lines: Array.from(
        { length: lineCount },
        (_, i) => ({
          transactionId: `synthetic-${i}`,
          description: `Web hosting services — synthetic entry ${i + 1}. Recorded transaction evidence; no service period inferred.`,
          amount: "25.00",
          taxPercent: "0",
        }),
      ),
    };
    const design = {
      ...expenseInvoiceDesign("Synthetic Hosting Company", []),
      template,
    };
    const page = await browser.newPage();
    const size = invoicePageDimensions(design);
    await page.setViewportSize({ width: Math.round((size.width - 72) * 96 / 72), height: 1200 });
    await page.emulateMedia({ media: "print" });
    await page.route("**/*", (route) => route.abort());
    await page.setContent(
      invoiceHtml(
        draft,
        {
          headerPercent: 0,
          footerPercent: 0,
          sellerDetails:
            "LoveMeDo B.V. — SYNTHETIC\nExample Lane 1\nExample City",
          paymentDetails: "",
          design,
        },
        false,
      ),
    );
    const regions = await page.locator("[data-section]").evaluateAll(nodes => nodes.map(node => {
      const b = node.getBoundingClientRect(); return { key: node.getAttribute("data-section"), x: b.x, y: b.y, width: b.width, height: b.height };
    }));
    for (const [i, a] of regions.entries()) for (const b of regions.slice(i + 1)) assert(Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) < 1 || Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) < 1, `${template}: ${a.key} overlaps ${b.key}`);
    const signature = JSON.stringify(regions.map(({ key, x, y, width }) => [key, Math.round(x / 20), Math.round(y / 20), Math.round(width / 20)]));
    if (lineCount === 4) { assert(!structures.has(signature), `Supplier ${template} repeats another page structure`); structures.add(signature); }
    const bytes = await page.pdf({
      width: `${size.width / 72}in`, height: `${size.height / 72}in`,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate:
        '<div style="width:100%;font-size:8px;text-align:center">SYNTHETIC DATA · Page <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      margin: { top: "0.4in", bottom: "0.45in", left: "0.5in", right: "0.5in" },
    });
    const pdf = await PDFDocument.load(bytes),
      pages = pdf.getPageCount();
    if (lineCount === 65 && pages < 2)
      throw new Error("Multi-page template did not paginate");
    const path = `output/pdf/synthetic-${template}${lineCount === 65 ? "-multipage" : ""}.pdf`;
    await writeFile(path, bytes);
    const text = execFileSync("pdftotext", [path, "-"], { encoding: "utf8" }).replace(/\s+/g, " ");
    for (let i = 1; i <= draft.lines.length; i++) assert(text.includes(`synthetic entry ${i}.`), `${template}: missing transaction ${i}`);
    assert(text.includes(invoiceTotals(draft).total), `${template}: missing total`);
    const pageSize = pdf.getPage(0).getSize(); assert.equal(pageSize.width > pageSize.height, template === "minimal");
    results.push({
      template,
      lines: lineCount,
      pages,
      total: invoiceTotals(draft).total,
      bytes: bytes.length,
    });
    await page.close();
  }
} finally {
  await browser.close();
}
await writeFile("output/pdf/validation.json", JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
