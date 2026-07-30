import { PDFDocument, type PDFFont, type PDFPage, rgb } from "pdf-lib";
import type { ExpenseRecord, Transaction } from "./types";

const pageWidth = 595.28;
const pageHeight = 841.89;
const margin = 48;
const contentWidth = pageWidth - margin * 2;

function money(value: number, currency: string): string {
  return `${currency} ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function wrapText(text: string, font: PDFFont, fontSize: number, maxWidth: number): string[] {
  const paragraphs = text.replace(/\r/g, "").split("\n");
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (!line || font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

export async function generateMissingReceiptDeclarationPdf(
  expense: ExpenseRecord,
  transaction: Transaction
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${expense.recordNumber} - Missing source document declaration`);
  pdf.setSubject("Internal accounting source document for a missing supplier receipt or invoice");
  pdf.setCreator("Finance Operations Dashboard");
  pdf.setProducer("Finance Operations Dashboard");
  pdf.setCreationDate(new Date(expense.createdAt));

  const regular = await pdf.embedFont("Helvetica");
  const bold = await pdf.embedFont("Helvetica-Bold");
  let page!: PDFPage;
  let y = 0;
  let pageNumber = 0;

  function footer(target: PDFPage, number: number) {
    target.drawLine({
      start: { x: margin, y: 34 },
      end: { x: pageWidth - margin, y: 34 },
      thickness: 0.6,
      color: rgb(0.78, 0.81, 0.86)
    });
    target.drawText(
      "Internal record only - not issued by the supplier and not a substitute for a VAT invoice.",
      { x: margin, y: 19, size: 7.5, font: regular, color: rgb(0.35, 0.39, 0.45) }
    );
    target.drawText(`Page ${number}`, {
      x: pageWidth - margin - 35,
      y: 19,
      size: 7.5,
      font: regular,
      color: rgb(0.35, 0.39, 0.45)
    });
  }

  function addPage() {
    pageNumber += 1;
    page = pdf.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
    page.drawText("FINANCE OPERATIONS", {
      x: margin,
      y,
      size: 9,
      font: bold,
      color: rgb(0.12, 0.32, 0.55)
    });
    page.drawText(expense.recordNumber, {
      x: pageWidth - margin - bold.widthOfTextAtSize(expense.recordNumber, 9),
      y,
      size: 9,
      font: bold,
      color: rgb(0.12, 0.32, 0.55)
    });
    y -= 32;
  }

  function ensureSpace(required: number) {
    if (y - required < 52) addPage();
  }

  function sectionTitle(title: string) {
    ensureSpace(30);
    y -= 6;
    page.drawText(title.toUpperCase(), {
      x: margin,
      y,
      size: 8.5,
      font: bold,
      color: rgb(0.12, 0.32, 0.55)
    });
    y -= 9;
    page.drawLine({
      start: { x: margin, y },
      end: { x: pageWidth - margin, y },
      thickness: 0.8,
      color: rgb(0.76, 0.82, 0.89)
    });
    y -= 18;
  }

  function field(label: string, value: string) {
    const labelWidth = 145;
    const lines = wrapText(value || "-", regular, 9.5, contentWidth - labelWidth);
    const height = Math.max(18, lines.length * 13);
    ensureSpace(height);
    page.drawText(label, { x: margin, y, size: 8.5, font: bold, color: rgb(0.32, 0.36, 0.42) });
    lines.forEach((line, index) => {
      page.drawText(line, { x: margin + labelWidth, y: y - index * 13, size: 9.5, font: regular, color: rgb(0.08, 0.1, 0.14) });
    });
    y -= height;
  }

  function paragraph(text: string) {
    const lines = wrapText(text, regular, 9.5, contentWidth);
    const height = lines.length * 13 + 5;
    ensureSpace(height);
    lines.forEach((line, index) => {
      page.drawText(line, { x: margin, y: y - index * 13, size: 9.5, font: regular, color: rgb(0.08, 0.1, 0.14) });
    });
    y -= height;
  }

  addPage();
  page.drawText("MISSING SOURCE DOCUMENT DECLARATION", {
    x: margin,
    y,
    size: 18,
    font: bold,
    color: rgb(0.05, 0.12, 0.2)
  });
  y -= 28;
  page.drawRectangle({
    x: margin,
    y: y - 35,
    width: contentWidth,
    height: 44,
    color: rgb(1, 0.94, 0.91),
    borderColor: rgb(0.83, 0.27, 0.16),
    borderWidth: 1
  });
  page.drawText("INTERNAL SOURCE DOCUMENT - NOT A SUPPLIER RECEIPT", {
    x: margin + 13,
    y: y - 10,
    size: 10.5,
    font: bold,
    color: rgb(0.65, 0.13, 0.08)
  });
  page.drawText("Prepared because the original supplier receipt or invoice is unavailable.", {
    x: margin + 13,
    y: y - 26,
    size: 8.5,
    font: regular,
    color: rgb(0.45, 0.16, 0.12)
  });
  y -= 58;

  sectionTitle("Source document identification");
  field("Internal document number", expense.recordNumber);
  field("Preparation date", expense.createdAt.slice(0, 10));
  field("Accounting entry reference", expense.id);
  field("Original document", "Unavailable");

  sectionTitle("Business transaction");
  field("Supplier or payee", expense.supplierName);
  field("Supplier registry number", expense.supplierRegistrationNumber ?? "Not available");
  field("Supplier VAT number", expense.supplierVatNumber ?? "Not available");
  field("Transaction date", expense.transactionDate ?? transaction.date);
  field("Economic content", expense.description);
  field("Business purpose", expense.businessPurpose);
  field("Category", expense.category);
  field("Net amount", money(expense.netAmount, expense.currency));
  field("VAT amount", money(expense.vatAmount, expense.currency));
  field("Gross amount paid", money(expense.grossAmount, expense.currency));
  field("VAT treatment", expense.vatTreatment.replaceAll("_", " "));

  sectionTitle("Bank evidence");
  field("Bank source and account", `${transaction.source.toUpperCase()} - ${transaction.accountName}`);
  field("Bank transaction ID", transaction.id);
  field("Bank counterparty", transaction.counterparty);
  field("Bank description", transaction.description);
  field("Payment status", `${transaction.status} - money out`);

  sectionTitle("Declaration");
  paragraph(
    `Reason the supplier document is unavailable: ${expense.missingDocumentReason ?? "Not provided"}`
  );
  paragraph(
    "The preparer confirms that the information above reflects the business transaction shown in the linked bank record and that the cost was incurred for the stated business purpose."
  );
  paragraph(
    "This declaration preserves an internal accounting explanation and audit trail. It does not represent a document issued by the supplier and does not by itself establish entitlement to deduct input VAT."
  );
  field("Confirmed at", expense.declarationConfirmedAt ?? expense.createdAt);

  for (let index = 0; index < pdf.getPageCount(); index += 1) {
    footer(pdf.getPage(index), index + 1);
  }
  return pdf.save();
}
