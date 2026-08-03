import { PDFDocument, type PDFFont, type PDFPage, rgb } from "pdf-lib";
import type { SlashMerchantGroup } from "./slashMerchantGroups";

export interface SlashExpensePdfPeriod {
  fromDate: string;
  toDate: string;
}

const pageWidth = 612;
const pageHeight = 792;
const margin = 42;
const footerHeight = 35;

function money(value: number, currency: string): string {
  return `${currency} ${value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function currencySummary(totals: Readonly<Record<string, number>>): string {
  const values = Object.entries(totals)
    .filter(([, amount]) => Math.abs(amount) >= 0.005)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, amount]) => money(amount, currency));
  return values.length > 0 ? values.join(" · ") : "—";
}

function fitText(value: string, font: PDFFont, size: number, width: number): string {
  const normalized = value.replace(/\s+/g, " ").trim() || "—";
  if (font.widthOfTextAtSize(normalized, size) <= width) return normalized;
  let end = normalized.length;
  while (end > 1 && font.widthOfTextAtSize(`${normalized.slice(0, end)}…`, size) > width) end -= 1;
  return `${normalized.slice(0, end)}…`;
}

export async function generateSlashExpenseActivityPdf(
  group: SlashMerchantGroup,
  period: SlashExpensePdfPeriod,
  generatedAt = new Date()
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const title = `${group.name} - Slash expense activity - ${period.fromDate} to ${period.toDate}`;
  pdf.setTitle(title);
  pdf.setSubject("Grouped Slash transaction activity for expense review");
  pdf.setCreator("Finance Operations Dashboard");
  pdf.setProducer("Finance Operations Dashboard");
  pdf.setCreationDate(generatedAt);

  const regular = await pdf.embedFont("Helvetica");
  const bold = await pdf.embedFont("Helvetica-Bold");
  let page!: PDFPage;
  let y = 0;

  function addPage(): void {
    page = pdf.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
    page.drawText("FINANCE OPERATIONS", {
      x: margin,
      y,
      size: 8.5,
      font: bold,
      color: rgb(0.18, 0.18, 0.21)
    });
    page.drawText("SLASH", {
      x: pageWidth - margin - bold.widthOfTextAtSize("SLASH", 8.5),
      y,
      size: 8.5,
      font: bold,
      color: rgb(0.18, 0.18, 0.21)
    });
    y -= 28;
  }

  function drawField(label: string, value: string, x: number, width: number): void {
    page.drawText(label.toUpperCase(), {
      x,
      y,
      size: 7,
      font: bold,
      color: rgb(0.45, 0.45, 0.5)
    });
    page.drawText(fitText(value, regular, 9, width), {
      x,
      y: y - 14,
      size: 9,
      font: regular,
      color: rgb(0.08, 0.08, 0.1)
    });
  }

  function drawTableHeader(): void {
    page.drawRectangle({
      x: margin,
      y: y - 5,
      width: pageWidth - margin * 2,
      height: 20,
      color: rgb(0.95, 0.95, 0.96)
    });
    const headers = [
      { label: "Date", x: margin + 6 },
      { label: "Account", x: margin + 74 },
      { label: "Description", x: margin + 192 },
      { label: "Amount", x: pageWidth - margin - 82 }
    ];
    for (const header of headers) {
      page.drawText(header.label, { x: header.x, y, size: 7.5, font: bold, color: rgb(0.3, 0.3, 0.34) });
    }
    y -= 22;
  }

  function ensureTransactionSpace(): void {
    if (y >= footerHeight + 25) return;
    addPage();
    drawTableHeader();
  }

  addPage();
  page.drawText("SLASH EXPENSE ACTIVITY", {
    x: margin,
    y,
    size: 18,
    font: bold,
    color: rgb(0.04, 0.04, 0.05)
  });
  y -= 27;
  page.drawText(fitText(group.name, bold, 15, pageWidth - margin * 2), {
    x: margin,
    y,
    size: 15,
    font: bold,
    color: rgb(0.12, 0.12, 0.14)
  });
  y -= 28;

  drawField("Period", `${period.fromDate} to ${period.toDate}`, margin, 145);
  drawField("Transactions", group.transactionCount.toLocaleString("en-US"), margin + 178, 90);
  drawField("Accounts", group.accountNames.length.toLocaleString("en-US"), margin + 298, 70);
  drawField("Generated", generatedAt.toISOString().slice(0, 10), margin + 400, 100);
  y -= 38;
  drawField("Total spend", currencySummary(group.spend), margin, 145);
  drawField("Credits", currencySummary(group.credits), margin + 178, 145);
  drawField("Net activity", currencySummary(group.net), margin + 356, 145);
  y -= 42;
  drawTableHeader();

  for (const transaction of group.transactions) {
    ensureTransactionSpace();
    const signedAmount = transaction.direction === "out" ? -transaction.amount : transaction.amount;
    const description = transaction.merchantName
      || transaction.counterparty
      || transaction.rawName
      || transaction.description;
    page.drawText(transaction.date, { x: margin + 6, y, size: 7.5, font: regular, color: rgb(0.12, 0.12, 0.14) });
    page.drawText(fitText(transaction.accountName, regular, 7.5, 108), {
      x: margin + 74,
      y,
      size: 7.5,
      font: regular,
      color: rgb(0.12, 0.12, 0.14)
    });
    page.drawText(fitText(description, regular, 7.5, 228), {
      x: margin + 192,
      y,
      size: 7.5,
      font: regular,
      color: rgb(0.12, 0.12, 0.14)
    });
    const amount = money(signedAmount, transaction.currency);
    page.drawText(amount, {
      x: pageWidth - margin - regular.widthOfTextAtSize(amount, 7.5),
      y,
      size: 7.5,
      font: regular,
      color: signedAmount < 0 ? rgb(0.65, 0.12, 0.1) : rgb(0.08, 0.42, 0.2)
    });
    y -= 18;
    page.drawLine({
      start: { x: margin, y: y + 8 },
      end: { x: pageWidth - margin, y: y + 8 },
      thickness: 0.35,
      color: rgb(0.88, 0.88, 0.9)
    });
  }

  for (let index = 0; index < pdf.getPageCount(); index += 1) {
    const target = pdf.getPage(index);
    target.drawLine({
      start: { x: margin, y: 29 },
      end: { x: pageWidth - margin, y: 29 },
      thickness: 0.5,
      color: rgb(0.8, 0.8, 0.82)
    });
    target.drawText("Grouped bank activity for expense review; retain supplier invoices and receipts separately.", {
      x: margin,
      y: 16,
      size: 6.8,
      font: regular,
      color: rgb(0.4, 0.4, 0.44)
    });
    const pageLabel = `Page ${index + 1} of ${pdf.getPageCount()}`;
    target.drawText(pageLabel, {
      x: pageWidth - margin - regular.widthOfTextAtSize(pageLabel, 6.8),
      y: 16,
      size: 6.8,
      font: regular,
      color: rgb(0.4, 0.4, 0.44)
    });
  }

  return pdf.save();
}

export function slashExpensePdfFileName(group: Pick<SlashMerchantGroup, "name">, period: SlashExpensePdfPeriod): string {
  const merchant = group.name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "merchant";
  return `slash-${merchant}-${period.fromDate}-to-${period.toDate}.pdf`;
}
