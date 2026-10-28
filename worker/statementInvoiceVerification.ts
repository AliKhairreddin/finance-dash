import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { invoiceLayout, type InvoiceDraft } from "../shared/statementInvoices";
import { invoiceCopyPrompt, invoiceCopySchema } from "./statementInvoiceCopy";
import { invoiceAi } from "./statementInvoiceAi";
import { inspectInvoiceExample, renderInvoicePdf } from "./statementInvoicePdf";

// Fixed synthetic data only. This smoke check does not write financial records.
export async function verifyInvoiceCopy(env: Pick<WorkerEnv, "BROWSER" | "OPENROUTER_API_KEY">, model: string) {
  const pdf = await PDFDocument.create(), page = pdf.addPage([595, 842]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const text = (value: string, x: number, top: number, size = 10, heavy = false) => page.drawText(value, { x, y: 842 - top - size, size, font: heavy ? bold : regular });
  text("DEMO", 36, 32, 24, true); text("Invoice", 390, 32, 24, true);
  text("Demo Company", 36, 78); text("Example Street 1", 36, 92); text("1000 AA Amsterdam", 36, 106); text("VAT: TEST-SELLER", 36, 120);
  text("Number", 360, 84); text("999999", 455, 84);
  text("Date", 360, 108); text("2020-01-01", 455, 108);
  text("Currency", 360, 132); text("EUR", 455, 132);
  text("Bill to", 36, 186, 10, true); text("Old Customer", 36, 210);
  text("Old Street 9", 36, 228); text("9000 ZZ Old City", 36, 244);
  const line = (top: number) => page.drawLine({ start: { x: 36, y: 842 - top }, end: { x: 559, y: 842 - top }, thickness: 0.8, color: rgb(0.2, 0.3, 0.4) });
  line(160); line(314); line(336);
  text("Description", 36, 320, 10, true); text("Before tax", 334, 320, 10, true); text("Tax %", 422, 320, 10, true); text("Total", 510, 320, 10, true);
  text("OLD SERVICE", 36, 352); text("999.00", 346, 352); text("21%", 422, 352); text("1208.79", 510, 352);
  text("Before tax", 405, 470); text("999.00", 510, 470);
  text("Tax", 405, 494); text("209.79", 510, 494);
  line(520); text("Total EUR", 405, 532, 11, true); text("1208.79", 510, 532, 11, true);
  const bytes = await pdf.save(), inspected = await inspectInvoiceExample(env, bytes);
  const ai = await invoiceAi(env.OPENROUTER_API_KEY, model, invoiceCopyPrompt, { issuer: "Demo Company", width: inspected.width, height: inspected.height, positions: inspected.text }, { reasoningEffort: "none", outputSchema: invoiceCopySchema });
  const mapped = ai.result as { error?: string; copy?: unknown };
  if (mapped.error || !mapped.copy) throw new Error(mapped.error || "No copied layout was produced");
  let layout;
  try { layout = invoiceLayout({ ...mapped, headerPercent: 0, footerPercent: 0 }); }
  catch (error) { throw new Error(`${error instanceof Error ? error.message : "Invalid mapping"}: ${JSON.stringify((mapped.copy as { columns?: unknown }).columns)}`); }
  const draft: InvoiceDraft = { number: "10001", date: "2026-09-24", dueDate: "", customer: "New Customer", customerAddress: "New Street 2\n2000 BB New City", currency: "EUR", notes: "", taxMode: "included", lines: [{ transactionId: "synthetic", description: "New service", amount: "121.00", taxPercent: "21" }] };
  return { bytes: await renderInvoicePdf(env, bytes, layout, draft, true), model: ai.model };
}
