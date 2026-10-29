import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { invoiceHtml } from "../worker/statementInvoicePdf";
import {
  invoiceDesignStyles,
  defaultInvoiceDesign,
} from "../shared/statementInvoiceDesign";
import { invoiceTotals, type InvoiceDraft } from "../shared/statementInvoices";
import { PDFDocument } from "pdf-lib";
await mkdir("output/pdf", { recursive: true });
const browser = await chromium.launch();
const results = [];
try {
  for (const template of invoiceDesignStyles) {
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
        { length: template === "technology" ? 65 : 4 },
        (_, i) => ({
          transactionId: `synthetic-${i}`,
          description: `Web hosting services — synthetic entry ${i + 1}. Recorded transaction evidence; no service period inferred.`,
          amount: "25.00",
          taxPercent: "0",
        }),
      ),
    };
    const design = {
      ...defaultInvoiceDesign("our:lovemedo", "LoveMeDo B.V. — SYNTHETIC"),
      template,
    };
    const page = await browser.newPage();
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
    const bytes = await page.pdf({
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<div></div>",
      footerTemplate:
        '<div style="width:100%;font-size:8px;text-align:center">SYNTHETIC DATA · Page <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      margin: { top: "0.4in", bottom: "0.45in", left: "0.5in", right: "0.5in" },
    });
    const pdf = await PDFDocument.load(bytes),
      pages = pdf.getPageCount();
    if (template === "technology" && pages < 2)
      throw new Error("Multi-page template did not paginate");
    await writeFile(`output/pdf/synthetic-${template}.pdf`, bytes);
    results.push({
      template,
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
