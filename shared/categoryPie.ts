import type { BankAnalyticsCategoryBreakdown, Transaction } from "./types";

const categoryChartPalette = [
  "#18181b",
  "#52525b",
  "#71717a",
  "#137333",
  "#b42318",
  "#8a5a00",
  "#0f766e",
  "#a16207",
  "#3f3f46",
  "#a1a1aa",
  "#7c3aed",
  "#64748b",
  "#be185d",
  "#2f855a",
  "#0369a1",
  "#4338ca",
  "#15803d",
  "#a21caf",
  "#0e7490",
  "#dc2626",
  "#4d7c0f",
  "#2563eb",
  "#b45309",
  "#6d28d9",
  "#047857"
] as const;

export type CategoryPieSegment = {
  category: string;
  amount: number;
  count: number;
  color: string;
};

export type CategoryPieGroup = {
  currency: string;
  total: number;
  segments: CategoryPieSegment[];
};

function piePoint(radius: number, angle: number): [number, number] {
  const radians = (angle * Math.PI) / 180;
  return [60 + radius * Math.cos(radians), 60 + radius * Math.sin(radians)];
}

export function categoryDonutSegmentPath(startAngle: number, endAngle: number): string {
  const outerRadius = 51;
  const innerRadius = 33;
  const sweep = Math.max(0, Math.min(360, endAngle - startAngle));
  if (sweep <= 0) return "";

  const [outerStartX, outerStartY] = piePoint(outerRadius, startAngle);
  const [innerStartX, innerStartY] = piePoint(innerRadius, startAngle);
  if (sweep >= 359.999) {
    const [outerMiddleX, outerMiddleY] = piePoint(outerRadius, startAngle + 180);
    const [innerMiddleX, innerMiddleY] = piePoint(innerRadius, startAngle + 180);
    return [
      `M ${outerStartX} ${outerStartY}`,
      `A ${outerRadius} ${outerRadius} 0 1 1 ${outerMiddleX} ${outerMiddleY}`,
      `A ${outerRadius} ${outerRadius} 0 1 1 ${outerStartX} ${outerStartY}`,
      `L ${innerStartX} ${innerStartY}`,
      `A ${innerRadius} ${innerRadius} 0 1 0 ${innerMiddleX} ${innerMiddleY}`,
      `A ${innerRadius} ${innerRadius} 0 1 0 ${innerStartX} ${innerStartY}`,
      "Z"
    ].join(" ");
  }

  const [outerEndX, outerEndY] = piePoint(outerRadius, endAngle);
  const [innerEndX, innerEndY] = piePoint(innerRadius, endAngle);
  const largeArc = sweep > 180 ? 1 : 0;
  return [
    `M ${outerStartX} ${outerStartY}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEndX} ${outerEndY}`,
    `L ${innerEndX} ${innerEndY}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStartX} ${innerStartY}`,
    "Z"
  ].join(" ");
}

function categoryChartHash(category: string): number {
  let hash = 0;
  for (let index = 0; index < category.length; index += 1) {
    hash = (hash * 31 + category.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function categoryChartColor(category: string, usedColors: Set<string>, index: number): string {
  const hash = categoryChartHash(category);

  for (let offset = 0; offset < categoryChartPalette.length; offset += 1) {
    const color = categoryChartPalette[(hash + offset) % categoryChartPalette.length];
    if (!usedColors.has(color)) return color;
  }

  let attempt = 0;
  while (true) {
    const hue = Math.round((hash + (index + attempt) * 137.508) % 360);
    const saturation = 58 + ((hash + attempt) % 16);
    const lightness = 36 + ((index + attempt) % 12);
    const color = `hsl(${hue} ${saturation}% ${lightness}%)`;
    if (!usedColors.has(color)) return color;
    attempt += 1;
  }
}

function validCount(value: number | undefined): number {
  return Number.isSafeInteger(value) && value !== undefined && value >= 0 ? value : 0;
}

export function analyticsCategoryPieGroups(
  rows: readonly BankAnalyticsCategoryBreakdown[],
  direction: Transaction["direction"]
): CategoryPieGroup[] {
  const totalsByCurrency = new Map<string, Map<string, { amount: number; count: number }>>();
  const categories = new Set<string>();

  for (const row of rows) {
    const category = row.category.trim();
    if (!category) continue;
    const totals = direction === "in" ? row.moneyIn : row.moneyOut;
    const counts = direction === "in" ? row.moneyInTransactionCounts : row.moneyOutTransactionCounts;

    for (const [rawCurrency, amount] of Object.entries(totals)) {
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const currency = rawCurrency.trim().toUpperCase();
      if (!currency) continue;
      const categoryTotals = totalsByCurrency.get(currency) ?? new Map<string, { amount: number; count: number }>();
      const existing = categoryTotals.get(category);
      categoryTotals.set(category, {
        amount: (existing?.amount ?? 0) + amount,
        count: (existing?.count ?? 0) + validCount(counts[rawCurrency])
      });
      totalsByCurrency.set(currency, categoryTotals);
      categories.add(category);
    }
  }

  const assignedColors = new Map<string, string>();
  const usedColors = new Set<string>();
  [...categories].sort((left, right) => left.localeCompare(right)).forEach((category, index) => {
    const color = categoryChartColor(category, usedColors, index);
    assignedColors.set(category, color);
    usedColors.add(color);
  });

  return [...totalsByCurrency].map(([currency, categoryTotals]) => {
    const segments = [...categoryTotals].map(([category, values]) => ({
      category,
      amount: values.amount,
      count: values.count,
      color: assignedColors.get(category)!
    })).sort((left, right) => right.amount - left.amount || left.category.localeCompare(right.category));
    return {
      currency,
      total: segments.reduce((sum, segment) => sum + segment.amount, 0),
      segments
    };
  }).filter((group) => Number.isFinite(group.total) && group.total > 0)
    .sort((left, right) => right.total - left.total || left.currency.localeCompare(right.currency));
}
