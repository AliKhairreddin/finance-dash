import {
  managementReportSheetDefinitions,
  type ManagementReportBusinessColumn,
  type ManagementReportBusinessLine,
  type ManagementReportBusinessUnit,
  type ManagementReportDashboard
} from "./managementReport";

export const reportMetricLabels = {
  revenue: "Revenue",
  "marketing-spend": "Marketing spend",
  "operating-spend": "Operating spend",
  "gross-profit": "Gross profit",
  "net-profit": "Net profit",
  "net-margin": "Net margin",
  "platform-spend": "Platform spend"
} as const;
export type ReportMetric = keyof typeof reportMetricLabels;
export type BusinessReportMetric = Exclude<ReportMetric, "platform-spend">;

export interface ReportBreakdownRow {
  id: string;
  label: string;
  basis: string;
  value: number | undefined;
  source: string;
  sourceRow: number;
  scope?: string;
  metric?: BusinessReportMetric;
}

export function reportColumn(unit: ManagementReportBusinessUnit, period: string): ManagementReportBusinessColumn | undefined {
  if (period !== "ytd") return unit.columns.find(column => column.kind === "month" && column.period === period);
  return unit.columns.find(column => column.kind === "ytd")
    ?? unit.columns.find(column => column.kind === "performance")
    ?? [...unit.columns].reverse().find(column => column.kind === "month" || column.kind === "annual");
}

function metricLine(unit: ManagementReportBusinessUnit, metric: BusinessReportMetric) {
  return [...unit.lines].reverse().find(line => line.metric === metric);
}

export function reportMetricValue(unit: ManagementReportBusinessUnit, period: string, metric: BusinessReportMetric): number | undefined {
  const column = reportColumn(unit, period);
  if (!column) return undefined;
  if (metric === "net-margin" && period !== "ytd") {
    const revenue = reportMetricValue(unit, period, "revenue");
    const profit = reportMetricValue(unit, period, "net-profit");
    return revenue === undefined || profit === undefined || revenue === 0 ? undefined : profit / revenue;
  }
  const line = metricLine(unit, metric);
  return metric === "net-margin" ? line?.percentages[column.key] : line?.values[column.key];
}

function columnLetters(column: number): string {
  let result = "";
  for (let value = column; value > 0; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + (value - 1) % 26) + result;
  return result;
}

function sourceFor(line: ManagementReportBusinessLine, column: ManagementReportBusinessColumn | undefined): string {
  return `${managementReportSheetDefinitions[line.sourceSheet].title} · ${column ? columnLetters(column.sourceColumn) : "row "}${line.sourceRow}`;
}

function lineRow(line: ManagementReportBusinessLine, unit: ManagementReportBusinessUnit, period: string): ReportBreakdownRow {
  const column = reportColumn(unit, period);
  return {
    id: line.lineId,
    label: line.label,
    basis: [line.subsection, line.base].filter(Boolean).join(" · ") || "Workbook line",
    value: column ? line.values[column.key] : undefined,
    source: sourceFor(line, column),
    sourceRow: line.sourceRow
  };
}

/** Only exact sheet/unit names are linked; a similarly named customer is not a unit. */
export function consolidatedLineUnit(dashboard: ManagementReportDashboard, line: ManagementReportBusinessLine) {
  const key = line.label.toLowerCase().replace(/[^a-z0-9]/g, "");
  const units = dashboard.businessUnits.filter(unit => key === unit.sourceSheet.replace(/[^a-z0-9]/g, "") || key === unit.name.toLowerCase().replace(/[^a-z0-9]/g, ""));
  return units.length === 1 ? units[0] : undefined;
}

function operatingAdjustments(unit: ManagementReportBusinessUnit): ManagementReportBusinessLine[] {
  const spend = metricLine(unit, "operating-spend");
  const profit = metricLine(unit, "net-profit");
  if (!spend || !profit) return [];
  return unit.lines.filter(line => line.sourceRow > spend.sourceRow && line.sourceRow < profit.sourceRow
    && line.section === "operating-spend" && !line.metric && !line.isSubtotal && !line.isRatio
    && !/^computed profit(?:\s|$)/i.test(line.label));
}

export function sumBreakdownRows(rows: ReportBreakdownRow[]): number | undefined {
  if (rows.length === 0 || rows.some(row => row.value === undefined)) return undefined;
  return rows.reduce((sum, row) => sum + row.value!, 0);
}

export function businessMetricBreakdown(dashboard: ManagementReportDashboard, unit: ManagementReportBusinessUnit, period: string, metric: BusinessReportMetric) {
  const column = reportColumn(unit, period);
  const subtotal = metricLine(unit, metric);
  const reported = reportMetricValue(unit, period, metric);
  const adjustments = operatingAdjustments(unit);
  let rows: ReportBreakdownRow[];
  if (metric === "revenue" || metric === "marketing-spend" || metric === "operating-spend") {
    rows = subtotal ? unit.lines.filter(line => line.section === metric && !line.isSubtotal && !line.isRatio && line.sourceRow <= subtotal.sourceRow).map(line => {
      const row = lineRow(line, unit, period);
      const child = unit.id === dashboard.consolidated.id ? consolidatedLineUnit(dashboard, line) : undefined;
      return child ? { ...row, label: child.name, basis: "Reported business-unit subtotal", scope: child.id, metric } : row;
    }) : [];
  } else {
    const terms: Array<[BusinessReportMetric, number]> = metric === "gross-profit"
      ? [["revenue", 1], ["marketing-spend", -1]]
      : metric === "net-profit" ? [["gross-profit", 1], ["operating-spend", -1]]
        : [["net-profit", 1], ["revenue", 1]];
    rows = terms.map(([key, sign]) => {
      const line = metricLine(unit, key);
      const value = reportMetricValue(unit, period, key);
      return {
        id: key, label: `${sign < 0 ? "Less: " : ""}${reportMetricLabels[key]}`,
        basis: metric === "net-margin" ? key === "net-profit" ? "Numerator" : "Denominator" : sign < 0 ? "Deduction" : "Starting amount",
        value: value === undefined ? undefined : sign * value,
        source: line ? sourceFor(line, column) : "Not reported", sourceRow: line?.sourceRow ?? 0,
        scope: unit.id, metric: key
      };
    });
    if (metric === "net-profit") rows.push(...adjustments.map(line => {
      const row = lineRow(line, unit, period);
      return { ...row, basis: "Deduction below operating subtotal", value: row.value === undefined ? undefined : -row.value };
    }));
  }
  const exclusions = metric === "operating-spend"
    ? (unit.id === dashboard.consolidated.id
      ? [...new Set(rows.flatMap(row => row.scope ? [row.scope] : []))].flatMap(id => {
          const child = dashboard.businessUnits.find(candidate => candidate.id === id)!;
          return operatingAdjustments(child).map(line => ({ ...lineRow(line, child, period), basis: child.name }));
        })
      : adjustments.map(line => lineRow(line, unit, period)))
    : [];
  const total = metric === "net-margin"
    ? rows[0]?.value === undefined || rows[1]?.value === undefined || rows[1].value === 0 ? undefined : rows[0].value / rows[1].value
    : sumBreakdownRows(rows);
  const difference = reported === undefined || total === undefined ? undefined : reported - total;
  return { reported, rows, exclusions, total, difference, source: subtotal ? sourceFor(subtotal, column) : undefined };
}

/** Match the positive allocations represented by the summary donut, excluding YTD/total duplicates. */
export function platformSpendRows(dashboard: ManagementReportDashboard, period: string, platform?: string): ReportBreakdownRow[] {
  return dashboard.platforms.filter(row => !row.isTotal && !/ytd/i.test(row.periodLabel) && row.spend > 0
    && (period === "ytd" ? row.period <= dashboard.metadata.asOf : row.period === period)
    && (!platform || row.platform === platform)).map(row => ({
      id: row.platformMetricId, label: row.platform, basis: row.periodLabel, value: row.spend,
      source: `${managementReportSheetDefinitions.plp.title} · row ${row.sourceRow}`, sourceRow: row.sourceRow
    }));
}

export interface ReportBreakdownTarget {
  metric?: ReportMetric;
  scope?: string;
  period?: string;
  platform?: string;
}

export function reportBreakdownUrl(current: string, target: ReportBreakdownTarget): string {
  const url = new URL(current);
  url.searchParams.set("page", "management");
  if (target.metric) {
    url.searchParams.set("managementSection", "breakdown");
    url.searchParams.set("managementMetric", target.metric);
  } else {
    url.searchParams.delete("managementSection");
    url.searchParams.delete("managementMetric");
  }
  for (const [key, value] of [["managementScope", target.scope], ["managementPlatform", target.platform]]) {
    if (value) url.searchParams.set(key!, value);
    else url.searchParams.delete(key!);
  }
  if (target.period) url.searchParams.set("managementPeriod", target.period);
  return `${url.pathname}${url.search}${url.hash}`;
}
