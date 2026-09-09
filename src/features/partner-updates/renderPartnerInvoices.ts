import { convertCurrencyTotalsToUsd, sumCurrencyTotals } from "../../../shared/currencyTotals";
import type { PartnerReportData } from "../../../shared/partnerUpdates";

const font = '"Geist Variable", Arial, sans-serif';
const money = (amount: number, currency: string) => `${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

export function renderPartnerInvoices(canvas: HTMLCanvasElement, data: PartnerReportData) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Open-invoice image could not create a canvas.");
  const width = 1600;
  const wrap = (text: string, max: number, size: number, weight = 500) => {
    ctx.font = `${weight} ${size}px ${font}`;
    const lines: string[] = [];
    let current = "";
    for (const char of text.replace(/\s+/g, " ")) {
      if (ctx.measureText(current + char).width > max) { lines.push(current); current = ""; }
      current += char;
    }
    if (current) lines.push(current);
    return lines;
  };
  const rows = data.invoices.map(row => ({
    ...row, names: wrap(row.name, 660, 25, 600), notesLines: wrap(row.notes ?? "", 1300, 19),
    references: wrap(`${row.reference} · ${row.status}`, 660, 19)
  })).map(row => ({ ...row, height: Math.max(100, 34 + row.names.length * 32 + row.references.length * 25) + row.notesLines.length * 25 + 22 }));
  const nativeTotals = sumCurrencyTotals(data.invoices, row => row.amount);
  const usd = convertCurrencyTotalsToUsd(nativeTotals, data.rates);
  const totalsLines = wrap(Object.entries(nativeTotals).sort(([a], [b]) => a.localeCompare(b)).map(([currency, amount]) => money(amount, currency)).join("   ·   ") || "No outstanding balances", 1416, 23);
  const top = 360 + totalsLines.length * 30;
  const height = Math.max(1000, top + rows.reduce((sum, row) => sum + row.height, 0) + 100);
  const scale = Math.min(2, Math.sqrt(32_000_000 / (width * height)), 16000 / height);
  canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(height * scale);
  ctx.scale(scale, scale);
  ctx.fillStyle = "#f3f5f4"; ctx.fillRect(0, 0, width, height);
  const text = (value: string, x: number, y: number, size = 23, color = "#18332f", weight = 500, align: CanvasTextAlign = "left", max = 1450) => {
    ctx.font = `${weight} ${size}px ${font}`; ctx.fillStyle = color; ctx.textAlign = align;
    ctx.fillText(value, x, y, max);
  };
  text("FINANCE  /  PARTNER UPDATE", 64, 60, 18, "#288873", 600);
  text("Open invoices", 64, 133, 52, "#18332f", 600);
  text(new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Beirut" }).format(new Date(data.capturedAt)) + " · Beirut", 64, 177, 22, "#657772");
  ctx.fillStyle = "#103e35"; ctx.beginPath(); ctx.roundRect(64, 215, 1472, 100 + totalsLines.length * 30, 20); ctx.fill();
  text(`${rows.length} OPEN ITEMS · OUTSTANDING`, 94, 252, 19, "#acc9bf", 600);
  text(usd.excludedCurrencies.length ? "USD total unavailable" : money(usd.totalUsd, "USD"), 1506, 257, 31, "#bce9d4", 600, "right", 750);
  totalsLines.forEach((line, index) => text(line, 94, 299 + index * 30, 23, "#ffffff"));
  text("COMPANY / ITEM", 90, top - 14, 17, "#657772", 600);
  text("DUE DATE", 1040, top - 14, 17, "#657772", 600, "right");
  text("REMAINING", 1508, top - 14, 17, "#657772", 600, "right");
  let y = top + 12;
  for (const row of rows) {
    ctx.fillStyle = "#ffffff"; ctx.fillRect(64, y, 1472, row.height - 2);
    row.names.forEach((name, index) => text(name, 90, y + 40 + index * 32, 25, "#18332f", 600));
    row.references.forEach((line, index) => text(line, 90, y + 40 + row.names.length * 32 + index * 25, 19, "#657772"));
    text(row.dueDate ?? "—", 1040, y + 40, 23, "#657772", 500, "right", 280);
    text(money(row.amount, row.currency), 1508, y + 40, 28, "#18332f", 600, "right", 420);
    row.notesLines.forEach((line, index) => text(line, 90, y + 40 + row.names.length * 32 + row.references.length * 25 + index * 25, 19, "#657772"));
    y += row.height;
  }
  if (!rows.length) text("No open invoices or manual receivables.", 90, y + 70, 28);
  const note = ["Remaining amounts include recorded payments. Drafts and manual receivables are labeled.",
    usd.excludedCurrencies.length ? `Missing USD rates: ${usd.excludedCurrencies.join(", ")}.` : "",
    usd.staleCurrencies.length ? `Stale FX: ${usd.staleCurrencies.join(", ")}.` : ""
  ].filter(Boolean).join(" ");
  text(note, 64, height - 38, 18, "#657772");
}
