import { PDFDocument, type PDFImage, type PDFFont, type PDFPage, rgb } from "pdf-lib";
import type { BankCardGroup, BankMerchantGroup } from "./bankMerchantGroups";
import { metaLogoPngBase64 } from "./metaLogo";
import type { Transaction } from "./types";

export interface BankExpenseReportPeriod {
  fromDate: string;
  toDate: string;
}

const pageWidth = 595.28;
const pageHeight = 841.89;
const margin = 50;
const footerLineY = 38;
const contentBottom = 64;
const ink = rgb(0.08, 0.1, 0.14);
const muted = rgb(0.37, 0.41, 0.48);
const line = rgb(0.78, 0.8, 0.84);
const soft = rgb(0.96, 0.97, 0.98);
const metaBlue = rgb(0.03, 0.46, 0.96);

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
  return values.length > 0 ? values.join(" | ") : "None";
}

function sourceLabel(source: Transaction["source"]): string {
  if (source === "wise") return "Wise";
  if (source === "revolut") return "Revolut";
  if (source === "slash") return "Slash";
  if (source === "amex") return "Amex";
  return source.toUpperCase();
}

function fitText(value: string, font: PDFFont, size: number, width: number): string {
  const normalized = value.replace(/\s+/g, " ").trim() || "None";
  if (font.widthOfTextAtSize(normalized, size) <= width) return normalized;
  let end = normalized.length;
  while (end > 1 && font.widthOfTextAtSize(`${normalized.slice(0, end)}...`, size) > width) end -= 1;
  return `${normalized.slice(0, end)}...`;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(7, "0");
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "merchant";
}

function reportId(group: Pick<BankMerchantGroup, "key" | "name">, period: BankExpenseReportPeriod): string {
  const prefix = slug(group.name).replace(/-/g, "").slice(0, 8).toUpperCase() || "MERCHANT";
  const periodKey = `${period.fromDate.replace(/-/g, "")}-${period.toDate.replace(/-/g, "")}`;
  return `INT-${prefix}-${periodKey}-${stableHash(`${group.key}:${period.fromDate}:${period.toDate}`)}`;
}

function decodeBase64(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function totalTransactions(cardGroups: readonly BankCardGroup[]): number {
  return cardGroups.reduce((total, card) => total + card.transactionCount, 0);
}

export async function generateBankExpenseReportPdf(
  group: BankMerchantGroup,
  period: BankExpenseReportPeriod,
  generatedAt = new Date()
): Promise<Uint8Array> {
  const groupedTransactionCount = totalTransactions(group.cardGroups);
  if (groupedTransactionCount !== group.transactionCount) {
    const missingCount = group.transactionCount - groupedTransactionCount;
    throw new Error(
      `${missingCount.toLocaleString("en-US")} merchant ${missingCount === 1 ? "transaction is" : "transactions are"} missing verified card metadata. Sync the bank source before generating this per-card report.`
    );
  }
  const pdf = await PDFDocument.create();
  const isMeta = group.key === "family:meta" || group.name.trim().toLowerCase() === "meta";
  const title = `${group.name} - internal billing report - ${period.fromDate} to ${period.toDate}`;
  pdf.setTitle(title);
  pdf.setSubject("Internal per-card bank activity summary; not a supplier-issued invoice or receipt");
  pdf.setCreator("Finance Operations Dashboard");
  pdf.setProducer("Finance Operations Dashboard");
  pdf.setCreationDate(generatedAt);
  pdf.setKeywords(["internal report", "per-card summary", "expense review"]);

  const regular = await pdf.embedFont("Helvetica");
  const bold = await pdf.embedFont("Helvetica-Bold");
  const metaLogo: PDFImage | null = isMeta ? await pdf.embedPng(decodeBase64(metaLogoPngBase64)) : null;
  let page!: PDFPage;
  let y = 0;

  function drawBrandHeader(section: string): void {
    page.drawText(section.toUpperCase(), {
      x: margin,
      y: pageHeight - margin + 2,
      size: 7.5,
      font: bold,
      color: muted
    });
    if (metaLogo) {
      page.drawImage(metaLogo, {
        x: pageWidth - margin - 106,
        y: pageHeight - margin - 8,
        width: 106,
        height: 21.1
      });
    } else {
      const brand = fitText(group.name, bold, 11, 180);
      page.drawText(brand, {
        x: pageWidth - margin - bold.widthOfTextAtSize(brand, 11),
        y: pageHeight - margin,
        size: 11,
        font: bold,
        color: ink
      });
    }
    page.drawLine({
      start: { x: margin, y: pageHeight - margin - 18 },
      end: { x: pageWidth - margin, y: pageHeight - margin - 18 },
      thickness: 0.6,
      color: line
    });
  }

  function addPage(section: string): void {
    page = pdf.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin - 50;
    drawBrandHeader(section);
  }

  function drawField(label: string, value: string, x: number, fieldY: number, width: number): void {
    page.drawText(label.toUpperCase(), { x, y: fieldY, size: 7, font: bold, color: muted });
    page.drawText(fitText(value, regular, 9, width), {
      x,
      y: fieldY - 15,
      size: 9,
      font: regular,
      color: ink
    });
  }

  function drawSummaryTableHeader(): void {
    page.drawRectangle({ x: margin, y: y - 6, width: pageWidth - margin * 2, height: 22, color: soft });
    const headers = [
      { label: "Card", x: margin + 7 },
      { label: "Source", x: margin + 198 },
      { label: "Transactions", x: margin + 273 },
      { label: "Spend", x: margin + 344 },
      { label: "Cashback", x: margin + 424 }
    ];
    for (const header of headers) {
      page.drawText(header.label, { x: header.x, y, size: 7.2, font: bold, color: muted });
    }
    y -= 24;
  }

  function drawSummaryRow(card: BankCardGroup): void {
    page.drawText(fitText(card.label, bold, 8, 180), { x: margin + 7, y, size: 8, font: bold, color: ink });
    page.drawText(sourceLabel(card.source), { x: margin + 198, y, size: 8, font: regular, color: ink });
    page.drawText(card.transactionCount.toLocaleString("en-US"), { x: margin + 273, y, size: 8, font: regular, color: ink });
    page.drawText(fitText(currencySummary(card.spend), regular, 7.6, 76), { x: margin + 344, y, size: 7.6, font: regular, color: ink });
    page.drawText(fitText(currencySummary(card.cashback), regular, 7.6, 64), { x: margin + 424, y, size: 7.6, font: regular, color: ink });
    y -= 22;
    page.drawLine({ start: { x: margin, y: y + 9 }, end: { x: pageWidth - margin, y: y + 9 }, thickness: 0.35, color: line });
  }

  function addCardSummaryContinuation(): void {
    addPage("Card summary");
    page.drawText("Card summary", { x: margin, y, size: 18, font: bold, color: ink });
    y -= 34;
    drawSummaryTableHeader();
  }

  addPage("Internal billing report");
  page.drawText("Internal billing report", { x: margin, y, size: 21, font: bold, color: ink });
  y -= 34;
  page.drawText(fitText(`${group.name} grouped bank activity`, bold, 15, pageWidth - margin * 2), {
    x: margin,
    y,
    size: 15,
    font: bold,
    color: ink
  });
  y -= 52;

  drawField("Period", `${period.fromDate} to ${period.toDate}`, margin, y, 180);
  drawField("Internal report ID", reportId(group, period), margin + 210, y, 285);
  y -= 48;
  drawField("Bank sources", group.sources.map(sourceLabel).join(", "), margin, y, 180);
  drawField("Generated", generatedAt.toISOString().slice(0, 10), margin + 210, y, 120);
  y -= 62;

  page.drawText("TOTAL SPEND", { x: margin, y, size: 7.5, font: bold, color: muted });
  page.drawText(fitText(currencySummary(group.spend), bold, 24, pageWidth - margin * 2), {
    x: margin,
    y: y - 30,
    size: 24,
    font: bold,
    color: ink
  });
  y -= 72;
  drawField("Transactions", group.transactionCount.toLocaleString("en-US"), margin, y, 100);
  drawField("Cards", group.cardGroups.length.toLocaleString("en-US"), margin + 140, y, 100);
  drawField("Cashback", currencySummary(group.cashback), margin + 280, y, 215);
  y -= 58;

  page.drawText("Card summary", { x: margin, y, size: 13, font: bold, color: ink });
  y -= 27;
  drawSummaryTableHeader();
  for (const card of group.cardGroups) {
    if (y < contentBottom + 35) addCardSummaryContinuation();
    drawSummaryRow(card);
  }

  const pageCount = pdf.getPageCount();
  for (let index = 0; index < pageCount; index += 1) {
    const target = pdf.getPage(index);
    target.drawLine({ start: { x: margin, y: footerLineY }, end: { x: pageWidth - margin, y: footerLineY }, thickness: 0.45, color: line });
    const footer = isMeta
      ? "Meta Platforms, Inc. | 1 Meta Way | Menlo Park, CA 94025 | United States"
      : "Internal finance operations report";
    target.drawText(fitText(footer, regular, 6.5, 380), { x: margin, y: 23, size: 6.5, font: regular, color: muted });
    const pageLabel = `Page ${index + 1} of ${pageCount}`;
    target.drawText(pageLabel, {
      x: pageWidth - margin - regular.widthOfTextAtSize(pageLabel, 6.5),
      y: 23,
      size: 6.5,
      font: regular,
      color: muted
    });
  }

  return pdf.save();
}

export function bankExpenseReportFileName(
  group: Pick<BankMerchantGroup, "name">,
  period: BankExpenseReportPeriod
): string {
  return `${slug(group.name)}-internal-billing-report-${period.fromDate}-to-${period.toDate}.pdf`;
}
