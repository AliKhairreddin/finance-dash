import type { ManagementReportBankEntry, ManagementReportBusinessUnit, ManagementReportDashboard } from "./managementReport";
import { reportColumn, reportMetricValue } from "./managementReportBreakdown";

export const owners = ["Amin", "Sanjin", "Ben"] as const;
export type Owner = typeof owners[number];
export function ownerForLogin(username: string): Owner | null {
  switch (username.trim().toLowerCase()) {
    case "amin": return "Amin";
    case "sanjin": case "sani": return "Sanjin";
    case "ben": case "beno": return "Ben";
    default: return null;
  }
}

export const ownerMetrics = ["revenue", "marketing-spend", "gross-profit", "operating-spend", "net-profit"] as const;
export type ReviewDecision = { owner: Owner; state: "approved" | "changes"; at: number; comment: string };
export type MailState = "queued" | "sending" | "sent" | "failed" | "unconfirmed";
export type ReviewSummary = {
  id: string; period: string; revision: number; current: boolean; publishedAt: number;
  decisions: ReviewDecision[]; importId: string;
  mail?: { owner: Owner; state: MailState; error: string }[];
};
export type ReviewAddresses = Record<Owner, string>;

export function reviewStatus(decisions: ReviewDecision[]) {
  if (decisions.some(row => row.state === "changes")) return "Changes requested";
  return owners.every(owner => decisions.some(row => row.owner === owner && row.state === "approved")) ? "Signed off" : "Awaiting approval";
}

function unitReport(unit: ManagementReportBusinessUnit, period: string) {
  const column = reportColumn(unit, period);
  if (!column) return null;
  return {
    id: unit.id, name: unit.name,
    metrics: ownerMetrics.map(key => ({ key, value: reportMetricValue(unit, period, key) ?? null })),
    lines: unit.lines.filter(line => !line.isRatio && !line.isSubtotal && line.values[column.key] !== undefined)
      .map(line => ({ id: line.lineId, label: line.label, group: line.subsection || line.section, value: line.values[column.key] }))
  };
}

export function canPublishPeriod(dashboard: ManagementReportDashboard, period: string) {
  return dashboard.status !== "invalid" && dashboard.trend.some(point => point.period === period)
    && period <= dashboard.metadata.asOf
    && (["revenue", "gross-profit", "net-profit"] as const).every(metric =>
      Number.isFinite(reportMetricValue(dashboard.consolidated, period, metric)));
}

export function ownerReport(dashboard: ManagementReportDashboard, period: string, owner: Owner) {
  const balance = dashboard.ownership.balances.find(row => row.canonicalName === owner);
  const equity = balance && dashboard.ownership.assetsLiabilities.find(row => row.section === "equity" && row.sourceRow === balance.sourceRow);
  return {
    balance: equity && (equity.amount !== undefined || equity.secondaryAmount !== undefined) ? balance!.balance : null,
    balanceAsOf: dashboard.metadata.asOf,
    company: unitReport(dashboard.consolidated, period)!,
    units: dashboard.businessUnits.flatMap(unit => {
      const report = unitReport(unit, period);
      return report ? [report] : [];
    })
  };
}
export type OwnerReport = ReturnType<typeof ownerReport>;

export function ownerTransaction(row: ManagementReportBankEntry) {
  return { id: row.entryId, date: row.date, bank: row.bankName, segment: row.segment,
    nature: row.nature, type: row.accountType, currency: row.currency, amount: row.amountIncludingVat,
    usd: row.amountUsdSource === "missing" ? null : row.amountUsd };
}
export type OwnerTransaction = ReturnType<typeof ownerTransaction>;
export function monthLabel(period: string) {
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(period + "T00:00:00Z"));
}
