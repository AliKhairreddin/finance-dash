import { combineCurrencyTotals, convertCurrencyTotalsToUsd } from "./currencyTotals";
import type { BankAnalyticsCategoryBreakdown, CurrencyTotals, FxRate, Transaction } from "./types";

const categoryChartPalette = [
  "#6554c0",
  "#0c66e4",
  "#008da6",
  "#e774bb",
  "#f5a524",
  "#403294"
] as const;

const otherCategoryColor = "#d4d4d8";

export type CategoryPieSegment = {
  category: string;
  categories: string[];
  amount: number;
  count: number;
  color: string;
  nativeTotals: CurrencyTotals;
};

export type CategoryPieGroup = {
  currency: "USD";
  total: number;
  nativeTotals: CurrencyTotals;
  excludedCurrencies: string[];
  staleCurrencies: string[];
  asOf?: string;
  segments: CategoryPieSegment[];
};

export type CategoryPieGroups = {
  in: CategoryPieGroup | null;
  out: CategoryPieGroup | null;
};

type PendingCategoryPieSegment = Omit<CategoryPieSegment, "color">;

function piePoint(radius: number, angle: number): [number, number] {
  const radians = (angle * Math.PI) / 180;
  return [60 + radius * Math.cos(radians), 60 + radius * Math.sin(radians)];
}

export function categoryDonutSegmentPath(startAngle: number, endAngle: number): string {
  const outerRadius = 51;
  const innerRadius = 31;
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

function validCount(value: number | undefined): number {
  return Number.isSafeInteger(value) && value !== undefined && value >= 0 ? value : 0;
}

function normalizedCounts(counts: Record<string, number>): Map<string, number> {
  const normalized = new Map<string, number>();
  for (const [rawCurrency, count] of Object.entries(counts)) {
    const currency = rawCurrency.trim().toUpperCase();
    if (!currency) continue;
    normalized.set(currency, (normalized.get(currency) ?? 0) + validCount(count));
  }
  return normalized;
}

function pendingDirectionSegments(
  rows: readonly BankAnalyticsCategoryBreakdown[],
  direction: Transaction["direction"],
  rates: FxRate[]
): { nativeTotals: CurrencyTotals; segments: PendingCategoryPieSegment[] } {
  const categories = new Map<string, { nativeTotals: CurrencyTotals; count: number }>();

  for (const row of rows) {
    const category = row.category.trim();
    if (!category) continue;
    const totals = direction === "in" ? row.moneyIn : row.moneyOut;
    const counts = normalizedCounts(
      direction === "in" ? row.moneyInTransactionCounts : row.moneyOutTransactionCounts
    );
    const existing = categories.get(category) ?? { nativeTotals: {}, count: 0 };

    for (const [rawCurrency, amount] of Object.entries(totals)) {
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const currency = rawCurrency.trim().toUpperCase();
      if (!currency) continue;
      existing.nativeTotals[currency] = (existing.nativeTotals[currency] ?? 0) + amount;
      existing.count += counts.get(currency) ?? 0;
    }
    categories.set(category, existing);
  }

  const nativeTotals = combineCurrencyTotals(...[...categories.values()].map((value) => value.nativeTotals));
  const segments = [...categories].map(([category, value]) => ({
    category,
    categories: [category],
    amount: convertCurrencyTotalsToUsd(value.nativeTotals, rates).totalUsd,
    count: value.count,
    nativeTotals: value.nativeTotals
  })).filter((segment) => Number.isFinite(segment.amount) && segment.amount > 0)
    .sort((left, right) => right.amount - left.amount || left.category.localeCompare(right.category));

  return { nativeTotals, segments };
}

function groupTail(
  segments: PendingCategoryPieSegment[],
  visibleCategoryLimit: number
): PendingCategoryPieSegment[] {
  const visible = segments.slice(0, visibleCategoryLimit);
  const tail = segments.slice(visibleCategoryLimit);
  if (tail.length === 0) return visible;
  return [
    ...visible,
    {
      category: "Other",
      categories: tail.map((segment) => segment.category),
      amount: tail.reduce((sum, segment) => sum + segment.amount, 0),
      count: tail.reduce((sum, segment) => sum + segment.count, 0),
      nativeTotals: combineCurrencyTotals(...tail.map((segment) => segment.nativeTotals))
    }
  ];
}

function categoricalColors(
  directions: Record<Transaction["direction"], PendingCategoryPieSegment[]>
): Map<string, string> {
  const neighbors = new Map<string, Set<string>>();
  for (const segments of Object.values(directions)) {
    const categories = segments.filter((segment) => segment.category !== "Other").map((segment) => segment.category);
    for (const category of categories) {
      const categoryNeighbors = neighbors.get(category) ?? new Set<string>();
      for (const other of categories) {
        if (other !== category) categoryNeighbors.add(other);
      }
      neighbors.set(category, categoryNeighbors);
    }
  }

  const assigned = new Map<string, string>();
  const orderedCategories = [...neighbors].sort((left, right) =>
    right[1].size - left[1].size || left[0].localeCompare(right[0])
  );
  for (const [category, categoryNeighbors] of orderedCategories) {
    const used = new Set([...categoryNeighbors].map((neighbor) => assigned.get(neighbor)).filter(Boolean));
    const color = categoryChartPalette.find((candidate) => !used.has(candidate))
      ?? categoryChartPalette[assigned.size % categoryChartPalette.length];
    assigned.set(category, color);
  }
  return assigned;
}

function finishGroup(
  nativeTotals: CurrencyTotals,
  segments: PendingCategoryPieSegment[],
  colors: Map<string, string>,
  rates: FxRate[]
): CategoryPieGroup | null {
  if (segments.length === 0) return null;
  const conversion = convertCurrencyTotalsToUsd(nativeTotals, rates);
  return {
    currency: "USD",
    total: segments.reduce((sum, segment) => sum + segment.amount, 0),
    nativeTotals,
    excludedCurrencies: conversion.excludedCurrencies,
    staleCurrencies: conversion.staleCurrencies,
    ...(conversion.asOf ? { asOf: conversion.asOf } : {}),
    segments: segments.map((segment) => ({
      ...segment,
      color: segment.category === "Other" ? otherCategoryColor : colors.get(segment.category)!
    }))
  };
}

export function analyticsCategoryPieGroups(
  rows: readonly BankAnalyticsCategoryBreakdown[],
  rates: FxRate[],
  visibleCategoryLimit = 5
): CategoryPieGroups {
  if (!Number.isSafeInteger(visibleCategoryLimit) || visibleCategoryLimit < 1 || visibleCategoryLimit > 8) {
    throw new Error("Analytics category chart limit must be between 1 and 8");
  }
  const inbound = pendingDirectionSegments(rows, "in", rates);
  const outbound = pendingDirectionSegments(rows, "out", rates);
  const pending = {
    in: groupTail(inbound.segments, visibleCategoryLimit),
    out: groupTail(outbound.segments, visibleCategoryLimit)
  };
  const colors = categoricalColors(pending);
  return {
    in: finishGroup(inbound.nativeTotals, pending.in, colors, rates),
    out: finishGroup(outbound.nativeTotals, pending.out, colors, rates)
  };
}
