import {
  cashFlowCashAccountGroups,
  cashFlowOpenBalanceGroups,
  cashFlowPayableMonths,
  cashFlowPayableMonthTotals,
  cashFlowReportHistory,
  cashFlowSections,
  cashFlowSnapshotTotals,
  cashFlowUsdTotal
} from "../../../shared/cashFlowReport";
import { packCashFlowReportCards, splitCashFlowReportRows } from "../../../shared/cashFlowReportLayout";
import { convertCurrencyTotalsToUsd, sumCurrencyTotals, type UsdCurrencyTotal } from "../../../shared/currencyTotals";
import type { CashFlowLine, CashFlowSnapshot, FxRate } from "../../../shared/types";

const palette = {
  paper: "#f3f5f4", white: "#ffffff", ink: "#18332f", muted: "#657772",
  rule: "#e2e9e5", dark: "#103e35", mint: "#bce9d4", cash: "#288873",
  receivables: "#6278ad", openBalances: "#b98936", payables: "#b86455", investments: "#72885a"
};
const font = '"Geist Variable", Arial, sans-serif';
const margin = 56;
const gap = 28;
const bodyTop = 416;
const money = (amount: number) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2
}).format(amount);
const nativeAmount = (line: Pick<CashFlowLine, "amount" | "currency">) =>
  `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(line.amount)} ${line.currency}`;
const date = (value: string, full = true) => new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", ...(full ? { year: "numeric" as const } : {}), timeZone: "UTC"
}).format(new Date(`${value}T00:00:00Z`));

type TextOptions = { size?: number; weight?: number; color?: string; align?: CanvasTextAlign; maxWidth?: number };
function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, options: TextOptions = {}) {
  ctx.font = `${options.weight ?? 500} ${options.size ?? 18}px ${font}`;
  ctx.fillStyle = options.color ?? palette.ink;
  ctx.textAlign = options.align ?? "left";
  ctx.textBaseline = "middle";
  // Monetary values fit their allotted space without clipping significant digits.
  ctx.fillText(value, x, y, options.maxWidth);
}

function wrap(ctx: CanvasRenderingContext2D, value: string, width: number, size = 18, weight = 500): string[] {
  ctx.font = `${weight} ${size}px ${font}`;
  const lines: string[] = [];
  for (const paragraph of value.split("\n")) {
    let current = "";
    for (const word of paragraph.split(/[ \t]+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (ctx.measureText(candidate).width <= width) { current = candidate; continue; }
      if (current) lines.push(current);
      current = "";
      // Unbroken identifiers still wrap without truncating the original name.
      for (const char of word) {
        if (current && ctx.measureText(current + char).width > width) { lines.push(current); current = ""; }
        current += char;
      }
    }
    if (current) lines.push(current);
  }
  return lines.length ? lines : [""];
}

function box(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, fill: string, radius = 18) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.fill();
}

function rule(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, color = palette.rule) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + width, y); ctx.stroke();
}

type ReportRow = { id: string; name: string; lines: CashFlowLine[]; usd?: UsdCurrencyTotal };
const rowAmount = (row: ReportRow) => row.usd
  ? row.usd.excludedCurrencies.length ? "FX unavailable" : money(row.usd.totalUsd)
  : nativeAmount(row.lines[0]);
const rowExcluded = (row: ReportRow) => row.lines.every(line => line.excludedFromTotals);
const rowsTotal = (rows: ReportRow[], rates: FxRate[]) => cashFlowUsdTotal(rows.flatMap(row => row.lines), rates);
type Section = {
  id: string; title: string; color: string; rows: ReportRow[]; total: number; payable?: boolean; part?: string; usd?: boolean;
};
type RowLayout = { row: ReportRow; names: string[]; details: string[]; height: number };
function sectionLayout(ctx: CanvasRenderingContext2D, section: Section, width: number) {
  ctx.font = `600 23px ${font}`;
  const totalWidth = Math.min(width * .42, ctx.measureText(money(section.total)).width);
  const headings = wrap(ctx, section.title, width - 96 - totalWidth, 23, 600);
  const headerExtra = (headings.length - 1) * 28;
  const amountWidth = Math.max(228, ...section.rows.map((row) => {
    ctx.font = `600 18px ${font}`;
    return ctx.measureText(rowAmount(row)).width + 24;
  }));
  const nameWidth = Math.max(150, width - 56 - amountWidth - 24);
  const rows: RowLayout[] = section.rows.map((row) => {
    const names = wrap(ctx, row.name || "Untitled", nameWidth);
    const details: string[] = [];
    if (row.usd?.excludedCurrencies.length) details.push(`Missing FX: ${row.usd.excludedCurrencies.join(", ")}`);
    for (const line of row.lines) {
      const prefix = row.lines.length > 1 ? `${line.name} (${line.currency}): ` : "";
      if (line.excludedFromTotals) details.push(...wrap(ctx, `${prefix}Excluded from totals${row.usd ? ` · ${nativeAmount(line)}` : ""}`, width - 56, 15));
      if (line.formula) details.push(...wrap(ctx, `${prefix}Calculation: ${line.formula}`, width - 56, 15));
      if (line.notes) details.push(...wrap(ctx, `${prefix}${line.notes}`, width - 56, 15));
      if (line.dueDate) details.push(...wrap(ctx, `${prefix}Due ${date(line.dueDate)}`, width - 56, 15));
      if (section.payable) {
        const months = cashFlowPayableMonths(line.notes);
        if (months.length) details.push(...wrap(ctx, months.map(({ month, amount }) =>
          `${month.slice(0, 3)} ${nativeAmount({ amount, currency: line.currency })}`.replaceAll(" ", "\u00a0")).join("   ·   "), width - 56, 15));
      }
    }
    return { row, names, details, height: Math.max(34, names.length * 23 + 13) + details.length * 21 };
  });
  const monthTotals = section.payable ? cashFlowPayableMonthTotals(section.rows.flatMap(row => row.lines)) : [];
  const monthSummary = monthTotals.length ? wrap(ctx, monthTotals.map(({ month, amount, currency }) =>
    `${month.slice(0, 3)} ${nativeAmount({ amount, currency })}`.replaceAll(" ", "\u00a0")).join("   ·   "), width - 56, 15) : [];
  const height = 112 + headerExtra + (rows.length ? rows.reduce((sum, row) => sum + row.height, 0) : 38)
    + (monthSummary.length ? 46 + monthSummary.length * 21 : 0);
  return { rows, monthSummary, height, nameWidth, headings, headerExtra };
}

function drawSection(ctx: CanvasRenderingContext2D, section: Section, x: number, y: number, width: number) {
  const layout = sectionLayout(ctx, section, width);
  box(ctx, x, y, width, layout.height, palette.white);
  box(ctx, x + 26, y + 26, 5, 28, section.color, 2);
  layout.headings.forEach((heading, index) => text(ctx, heading, x + 44, y + 39 + index * 28, { size: 23, weight: 600 }));
  text(ctx, money(section.total), x + width - 28, y + 39, { size: 23, weight: 600, align: "right", maxWidth: width * .42 });
  text(ctx, `${section.rows.length} ${section.rows.length === 1 ? "entry" : "entries"}${section.part ? ` · ${section.part} · Subtotal` : ""}`, x + 28, y + 77 + layout.headerExtra, { size: 14, color: palette.muted });
  text(ctx, section.usd ? "USD EQUIVALENT" : "NATIVE BALANCE", x + width - 28, y + 77 + layout.headerExtra, { size: 13, color: palette.muted, align: "right" });
  rule(ctx, x + 28, y + 94 + layout.headerExtra, width - 56);
  let rowY = y + 100 + layout.headerExtra;
  if (!layout.rows.length) text(ctx, "No entries", x + 28, rowY + 18, { color: palette.muted });
  layout.rows.forEach((row, index) => {
    const color = rowExcluded(row.row) ? palette.muted : palette.ink;
    row.names.forEach((name, lineIndex) => text(ctx, name, x + 28, rowY + 17 + lineIndex * 23, { color }));
    text(ctx, rowAmount(row.row), x + width - 28, rowY + 17, { weight: 600, color, align: "right", maxWidth: width - 56 - layout.nameWidth - 24 });
    row.details.forEach((detail, index) => text(ctx, detail, x + 28, rowY + row.names.length * 23 + 17 + index * 21, { size: 15, color: palette.muted }));
    rowY += row.height;
    if (index < layout.rows.length - 1) rule(ctx, x + 28, rowY, width - 56, "#f0f3f1");
  });
  if (layout.monthSummary.length) {
    rule(ctx, x + 28, rowY + 10, width - 56);
    text(ctx, "MONTH TOTALS", x + 28, rowY + 30, { size: 13, weight: 600, color: palette.muted });
    layout.monthSummary.forEach((line, index) => text(ctx, line, x + 28, rowY + 54 + index * 21, { size: 15, color: palette.muted }));
  }
  return y + layout.height;
}

function drawGrowth(ctx: CanvasRenderingContext2D, snapshot: CashFlowSnapshot, x: number, y: number, width: number) {
  box(ctx, x, y, width, 158, "#e7eeea");
  text(ctx, "Week-over-week growth", x + 28, y + 34, { size: 21, weight: 600 });
  const columns = [["Cash", snapshot.cashGrowthPercent], ["Spend", snapshot.spendGrowthPercent], ["Profit", snapshot.profitGrowthPercent]] as const;
  columns.forEach(([label, value], index) => {
    const left = x + 28 + index * (width - 56) / 3;
    text(ctx, label, left, y + 78, { size: 15, color: palette.muted });
    text(ctx, value === undefined ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(2)}%`, left, y + 115, { size: 29, weight: 600, maxWidth: (width - 80) / 3 });
  });
}

function drawTrend(ctx: CanvasRenderingContext2D, snapshot: CashFlowSnapshot, history: CashFlowSnapshot[], rates: FxRate[], x: number, y: number, width: number, height: number) {
  box(ctx, x, y, width, height, palette.white);
  const rows = cashFlowReportHistory(snapshot, history);
  const values = rows.map((row) => cashFlowSnapshotTotals(row, rates));
  const series = [
    ["cash", "Cash", palette.cash], ["receivables", "Receivables", palette.receivables],
    ["payables", "Payables", palette.payables], ["assets", "Total assets", palette.dark]
  ] as const;
  text(ctx, "Position history", x + 28, y + 35, { size: 23, weight: 600 });
  text(ctx, `${rows.length} ${rows.length === 1 ? "snapshot" : "snapshots"} · USD equivalent`, x + width - 28, y + 35, { size: 14, color: palette.muted, align: "right" });
  const allValues = values.flatMap((value) => series.map(([key]) => value[key]));
  const min = Math.min(0, ...allValues);
  const max = Math.max(1, ...allValues);
  const bottom = y + height - 92;
  const top = y + 82;
  const left = x + 114;
  const right = x + width - 38;
  const chartY = (amount: number) => bottom - (amount - min) / (max - min) * (bottom - top);
  for (let index = 0; index <= 4; index++) {
    const amount = min + (max - min) * index / 4;
    const gridY = chartY(amount);
    rule(ctx, left, gridY, right - left);
    const label = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(amount);
    text(ctx, label, left - 18, gridY, { size: 14, color: palette.muted, align: "right", maxWidth: 88 });
  }
  const firstTime = Date.parse(rows[0].asOfDate);
  const lastTime = Date.parse(rows[rows.length - 1].asOfDate);
  const chartX = (index: number) => rows.length === 1 ? (left + right) / 2
    : left + (Date.parse(rows[index].asOfDate) - firstTime) / (lastTime - firstTime) * (right - left);
  for (const [key, , color] of series) {
    ctx.strokeStyle = color; ctx.lineWidth = key === "assets" ? 4 : 3;
    ctx.lineJoin = "round";
    ctx.beginPath();
    values.forEach((value, index) => { if (index) ctx.lineTo(chartX(index), chartY(value[key])); else ctx.moveTo(chartX(index), chartY(value[key])); });
    ctx.stroke();
    values.forEach((value, index) => {
      ctx.fillStyle = color; ctx.beginPath(); ctx.arc(chartX(index), chartY(value[key]), 4, 0, Math.PI * 2); ctx.fill();
    });
  }
  let lastLabelX = -Infinity;
  rows.forEach((row, index) => {
    const labelX = chartX(index);
    if (index !== rows.length - 1 && (labelX - lastLabelX < 108 || right - labelX < 108)) return;
    text(ctx, date(row.asOfDate, false), labelX, y + height - 65, { size: 14, color: palette.muted, align: "center" });
    lastLabelX = labelX;
  });
  series.forEach(([, label, color], index) => {
    const legendX = x + 28 + index * 175;
    box(ctx, legendX, y + height - 28, 19, 4, color, 2);
    text(ctx, label, legendX + 28, y + height - 26, { size: 14, color: palette.muted });
  });
}

function drawComposition(ctx: CanvasRenderingContext2D, snapshot: CashFlowSnapshot, rates: FxRate[], x: number, y: number, width: number, height: number) {
  box(ctx, x, y, width, height, palette.white);
  const totals = cashFlowSnapshotTotals(snapshot, rates);
  text(ctx, "Current composition", x + 28, y + 35, { size: 23, weight: 600 });
  const rows = [["Cash", totals.cash, palette.cash], ["Receivables", totals.receivables, palette.receivables],
    ["Open balances", totals.openBalances, palette.openBalances], ["Payables", totals.payables, palette.payables],
    ["Investments", totals.investments, palette.investments]] as const;
  const maximum = Math.max(1, ...rows.map(([, value]) => Math.abs(value)));
  const hasNegative = rows.some(([, value]) => value < 0);
  const barWidth = width - 56;
  const zero = x + 28 + (hasNegative ? barWidth / 2 : 0);
  const range = hasNegative ? barWidth / 2 : barWidth;
  rows.forEach(([label, amount, color], index) => {
    const rowY = y + 82 + index * (height - 125) / 4;
    text(ctx, label, x + 28, rowY, { size: 16, color: palette.muted });
    text(ctx, money(amount), x + width - 28, rowY, { size: 17, weight: 600, align: "right", maxWidth: width * .52 });
    box(ctx, x + 28, rowY + 16, barWidth, 6, palette.rule, 3);
    const length = Math.abs(amount) / maximum * range;
    if (length > 0) box(ctx, amount < 0 ? zero - length : zero, rowY + 16, length, 6, color, Math.min(3, length / 2));
    if (hasNegative) { ctx.fillStyle = palette.muted; ctx.fillRect(zero, rowY + 13, 1, 12); }
  });
}

function reportSections(snapshot: CashFlowSnapshot, rates: FxRate[]): Section[] {
  const groups = cashFlowOpenBalanceGroups(snapshot.openBalances);
  const definitions = [
    { id: "cash", title: "Cash in accounts", color: palette.cash, lines: snapshot.cashAccounts },
    { id: "receivables", title: "Receivables", color: palette.receivables, lines: snapshot.receivables },
    { id: "payables", title: "Payables", color: palette.payables, lines: snapshot.payables, payable: true },
    { id: "investments", title: "Investments", color: palette.investments, lines: snapshot.investments },
    ...(groups.length ? groups.map(group => ({ id: `open-${group.key}`, title: `Open balances · ${group.label}`, color: palette.openBalances, lines: group.lines }))
      : [{ id: "open", title: "Open balances", color: palette.openBalances, lines: [] }])
  ];
  return definitions.map(({ lines, ...section }) => ({
    ...section,
    usd: section.id === "cash",
    rows: section.id === "cash"
      ? cashFlowCashAccountGroups(lines).map(group => {
        const included = group.lines.filter(line => !line.excludedFromTotals);
        const usd = convertCurrencyTotalsToUsd(sumCurrencyTotals(included, line => line.amount), rates);
        // Offsetting unquoted balances must not masquerade as a complete total.
        usd.excludedCurrencies = convertCurrencyTotalsToUsd(sumCurrencyTotals(included, line => Math.abs(line.amount)), rates).excludedCurrencies;
        return { id: group.key, name: group.name, lines: group.lines, usd };
      })
      : lines.map(line => ({ id: line.id, name: line.name, lines: [line] })),
    total: cashFlowUsdTotal(lines, rates)
  }));
}

/** Compare measured layouts rather than stretching the page around fixed columns. */
export function planCashFlowPng(ctx: CanvasRenderingContext2D, snapshot: CashFlowSnapshot, rates: FxRate[], footer = "") {
  const sections = reportSections(snapshot, rates);
  const width = 1600;
  const columns = 2;
  const candidates = [740, 980, 1240].flatMap(maximumCardHeight => {
    const columnWidth = (width - margin * 2 - gap * (columns - 1)) / columns;
    const chunks = sections.flatMap(section => {
      const parts = splitCashFlowReportRows(section.rows, maximumCardHeight, rows => sectionLayout(ctx, { ...section, rows, total: rowsTotal(rows, rates) }, columnWidth).height);
      return parts.map((rows, index) => ({ ...section, id: `${section.id}:${index}`, rows, total: rowsTotal(rows, rates),
        part: parts.length > 1 ? `Part ${index + 1}/${parts.length}` : undefined }));
    });
    const details = chunks.map(section => ({ id: section.id, height: sectionLayout(ctx, section, columnWidth).height, span: 1, preferRight: section.id.startsWith("open") }));
    const trend = { id: "trend", span: 2, height: Math.max(470, Math.ceil(width * .325)) };
    const composition = { id: "composition", span: 1, height: Math.max(380, Math.ceil(width * .12)) };
    const growth = { id: "growth", span: 1, height: 158 };
    const open = details.filter(card => card.preferRight && card.id.endsWith(":0")).sort((a, b) => b.height - a.height);
    const anchor = open[0]?.height >= 400 ? [open[0]] : [];
    const primary = details.filter(card => card.id === "cash:0" || card.id === "receivables:0");
    const remaining = details.filter(card => !anchor.includes(card) && !primary.includes(card));
    const groupHeight = (id: string) => Math.max(...details.filter(card => card.id.split(":")[0] === id.split(":")[0]).map(card => card.height));
    const tallestGroupsFirst = [...remaining].sort((a, b) => groupHeight(b.id) - groupHeight(a.id)
      || a.id.split(":")[0].localeCompare(b.id.split(":")[0]) || Number(a.id.split(":")[1]) - Number(b.id.split(":")[1]));
    const orders = [
      [...anchor, ...primary, trend, ...remaining, composition, growth],
      [...anchor, ...primary, ...remaining, growth, trend, composition],
      [...anchor, trend, ...primary, composition, ...remaining, growth],
      [...anchor, ...primary, ...tallestGroupsFirst, trend, composition, growth]
    ];
    return orders.map(order => {
      const packed = packCashFlowReportCards(order, columns, columnWidth, gap);
      const footers = wrap(ctx, [snapshot.notes, footer].filter(Boolean).join("\n"), width - margin * 2 - 170, 14);
      const contentHeight = bodyTop + packed.height + 42 + footers.length * 21 + 25;
      const height = Math.max(Math.ceil(width / .78), contentHeight);
      // Prefer intact company groups and familiar reading order when the space
      // savings from splitting or moving charts first would be negligible.
      const readabilityCost = 1 + (chunks.length - sections.length) * .06 + (order.indexOf(trend) < order.indexOf(primary[0]) ? .02 : 0);
      return { width, height, columnWidth, placements: packed.placements, sections: chunks, footers,
        score: height * readabilityCost };
    });
  });
  return candidates.reduce((best, candidate) => candidate.score < best.score ? candidate : best);
}

/** Render to a supplied canvas so the downloaded artifact and visual QA use the same path. */
export function renderCashFlowPng(canvas: HTMLCanvasElement, snapshot: CashFlowSnapshot, history: CashFlowSnapshot[], rates: FxRate[]) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("PNG export could not create an image canvas.");
  const totals = cashFlowSnapshotTotals(snapshot, rates);
  const included = cashFlowSections.flatMap((key) => snapshot[key]).filter((line) => !line.excludedFromTotals);
  const fx = convertCurrencyTotalsToUsd(included.reduce<Record<string, number>>((result, line) => {
    // Absolute amounts keep offsetting balances from concealing a missing quote.
    result[line.currency] = (result[line.currency] ?? 0) + Math.abs(line.amount); return result;
  }, {}), rates);
  const footer = ["Totals and cash accounts in USD equivalent · Other detail balances in original currencies",
    fx.asOf ? `FX quotes as of ${date(fx.asOf.slice(0, 10))}` : "",
    fx.excludedCurrencies.length ? `Unconverted currencies excluded: ${fx.excludedCurrencies.join(", ")}` : "",
    fx.staleCurrencies.length ? `Stale FX: ${fx.staleCurrencies.join(", ")}` : ""].filter(Boolean).join("   /   ");
  const plan = planCashFlowPng(ctx, snapshot, rates, footer);
  const { width, height, columnWidth, footers } = plan;
  // Keep unusually large snapshots within browser canvas memory limits.
  const scale = Math.min(2, Math.sqrt(32_000_000 / (width * height)), 16000 / width, 16000 / height);
  canvas.width = Math.ceil(width * scale); canvas.height = Math.ceil(height * scale);
  ctx.scale(scale, scale);
  ctx.fillStyle = palette.paper; ctx.fillRect(0, 0, width, height);
  text(ctx, "FINANCE  /  POSITION REPORT", margin, 43, { size: 15, weight: 600, color: palette.cash });
  text(ctx, "Cash flow position", margin, 93, { size: 46, weight: 600 });
  text(ctx, date(snapshot.asOfDate), width - margin, 69, { size: 26, weight: 600, align: "right" });
  text(ctx, "AS OF DATE  ·  USD EQUIVALENT", width - margin, 101, { size: 13, color: palette.muted, align: "right" });
  const innerWidth = width - margin * 2;
  const heroY = 143;
  box(ctx, margin, heroY, innerWidth, 155, palette.dark, 22);
  const hero = [
    { label: "TOTAL ASSETS", value: totals.assets, detail: "Net position + investments", color: palette.mint },
    { label: "APPROXIMATE CASH", value: totals.approximateCash, detail: "Cash + receivables + open balances", color: palette.white },
    { label: "NET OPERATING POSITION", value: totals.profit, detail: "Approximate cash − payables", color: palette.white }
  ];
  hero.forEach((item, index) => {
    const x = margin + 34 + index * innerWidth / 3;
    text(ctx, item.label, x, heroY + 31, { size: 14, weight: 600, color: "#acc9bf" });
    text(ctx, money(item.value), x, heroY + 81, { size: index ? 43 : 52, weight: 600, color: item.color, maxWidth: innerWidth / 3 - 68 });
    text(ctx, item.detail, x, heroY + 126, { size: 15, color: "#acc9bf" });
    if (index) { ctx.fillStyle = "#335a50"; ctx.fillRect(x - 34, heroY + 28, 1, 99); }
  });
  const components = [["CASH", totals.cash, palette.cash, "+"], ["RECEIVABLES", totals.receivables, palette.receivables, "+"],
    ["OPEN BALANCES", totals.openBalances, palette.openBalances, "−"], ["PAYABLES", totals.payables, palette.payables, "+"],
    ["INVESTMENTS", totals.investments, palette.investments, "="]] as const;
  components.forEach(([label, amount, color, operator], index) => {
    const x = margin + index * innerWidth / 5;
    box(ctx, x, 325, 4, 48, color, 2);
    text(ctx, label, x + 17, 332, { size: 13, weight: 600, color: palette.muted });
    text(ctx, money(amount), x + 17, 364, { size: 29, weight: 600, maxWidth: innerWidth / 5 - 75 });
    if (index < 4) text(ctx, operator, x + innerWidth / 5 - 24, 350, { size: 25, color: palette.muted, align: "center" });
  });
  rule(ctx, margin, 395, innerWidth);
  for (const card of plan.placements) {
    const x = margin + card.column * (columnWidth + gap);
    const y = bodyTop + card.y;
    if (card.id === "trend") drawTrend(ctx, snapshot, history, rates, x, y, card.width, card.height);
    else if (card.id === "composition") drawComposition(ctx, snapshot, rates, x, y, card.width, card.height);
    else if (card.id === "growth") drawGrowth(ctx, snapshot, x, y, card.width);
    else drawSection(ctx, plan.sections.find(section => section.id === card.id)!, x, y, card.width);
  }
  footers.forEach((line, index) => text(ctx, line, margin, height - 28 - (footers.length - index - 1) * 21, { size: 14, color: palette.muted }));
  text(ctx, "FINANCE", width - margin, height - 28, { size: 14, weight: 600, color: palette.muted, align: "right" });
  return plan;
}

/** Render one portrait image before starting the direct PNG download. */
export async function buildCashFlowPng(snapshot: CashFlowSnapshot, history: CashFlowSnapshot[], rates: FxRate[]): Promise<Blob> {
  await document.fonts.load(`500 18px ${font}`);
  await document.fonts.load(`600 23px ${font}`);
  // Let the browser paint the exporting state before measuring the layout.
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  const canvas = document.createElement("canvas");
  try {
    renderCashFlowPng(canvas, snapshot, history, rates);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => {
      if (value) resolve(value); else reject(new Error("Could not encode the portrait PNG."));
    }, "image/png"));
  } finally { canvas.width = 1; canvas.height = 1; }
}

export async function downloadCashFlowPng(snapshot: CashFlowSnapshot, history: CashFlowSnapshot[], rates: FxRate[]) {
  const blob = await buildCashFlowPng(snapshot, history, rates);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = `cash-flow-${snapshot.asOfDate}-portrait.png`; link.href = url;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
