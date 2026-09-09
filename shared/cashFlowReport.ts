import { convertCurrencyTotalsToUsd } from "./currencyTotals";
import type { CashFlowLine, CashFlowSnapshot, CurrencyTotals, FxRate } from "./types";
import { wiseEntityFromAccountName, wiseEntityShortLabel } from "./wiseEntities";

export const cashFlowSections = ["cashAccounts", "receivables", "openBalances", "payables", "investments"] as const;
type Position = Pick<CashFlowSnapshot, (typeof cashFlowSections)[number]>;

/** Group only the exported cash rows; keep every source balance for conversion,
 * exclusions and notes, and keep the two Wise entities separate. */
export function cashFlowCashAccountGroups(lines: CashFlowLine[]): Array<{ key: string; name: string; lines: CashFlowLine[] }> {
  const groups = new Map<string, { key: string; name: string; lines: CashFlowLine[] }>();
  for (const line of lines) {
    let name = line.name.trim().replace(/\s+/g, " ");
    const words = name.split(" ");
    if (words.length > 1 && words.at(-1)?.toUpperCase() === line.currency.trim().toUpperCase()) {
      name = words.slice(0, -1).join(" ").replace(/[\s·–—-]+$/, "");
    }
    const source = line.id.match(/^cash-flow-account-(wise|revolut|slash|amex)-/)?.[1];
    if (source === "wise" || /\bwise\b/i.test(name)) {
      const entity = wiseEntityFromAccountName(name);
      const shortEntity = name.match(/^wise[\s·–—-]+(dn|lmd)$/i)?.[1].toUpperCase();
      if (entity || shortEntity) name = `Wise ${entity ? wiseEntityShortLabel(entity) : shortEntity}`;
    } else if (source) {
      name = { revolut: "Revolut", slash: "Slash", amex: "Amex" }[source]!;
    }
    const key = name ? name.toLowerCase() : line.id;
    const group = groups.get(key);
    if (group) group.lines.push(line);
    else groups.set(key, { key, name, lines: [line] });
  }
  return [...groups.values()];
}

export function cashFlowUsdTotal(lines: CashFlowLine[], rates: FxRate[]): number {
  const totals = lines.filter((item) => !item.excludedFromTotals).reduce<CurrencyTotals>((result, item) => {
    result[item.currency] = (result[item.currency] ?? 0) + item.amount;
    return result;
  }, {});
  return convertCurrencyTotalsToUsd(totals, rates).totalUsd;
}

export function cashFlowSnapshotTotals(snapshot: Position, rates: FxRate[]) {
  const cash = cashFlowUsdTotal(snapshot.cashAccounts, rates);
  const receivables = cashFlowUsdTotal(snapshot.receivables, rates);
  const openBalances = cashFlowUsdTotal(snapshot.openBalances, rates);
  const payables = cashFlowUsdTotal(snapshot.payables, rates);
  const investments = cashFlowUsdTotal(snapshot.investments, rates);
  const approximateCash = cash + receivables + openBalances;
  const profit = approximateCash - payables;
  return { cash, receivables, openBalances, approximateCash, payables, investments, profit, assets: profit + investments };
}

export function cashFlowOpenBalanceGroups(lines: CashFlowLine[]): Array<{ key: string; label: string; lines: CashFlowLine[] }> {
  const groups = [
    { key: "cognitive", label: "Cognitive", lines: [] as CashFlowLine[] },
    { key: "wagner", label: "Wagner", lines: [] as CashFlowLine[] },
    { key: "other", label: "Other", lines: [] as CashFlowLine[] }
  ];
  for (const line of lines) {
    // Only explicit company suffixes identify a group; supplier names alone do not.
    const suffix = line.name.match(/(?:^|[-–—·|])\s*(cog|cognitive|wagner)\s*$/i)?.[1].toLowerCase();
    const key = suffix === "wagner" ? "wagner" : suffix === "cog" || suffix === "cognitive" ? "cognitive" : "other";
    groups.find((group) => group.key === key)!.lines.push(line);
  }
  return groups.filter((group) => group.lines.length > 0);
}

const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The imported snapshot stores its payable month breakdown in each line's notes. */
export function cashFlowPayableMonths(notes?: string): Array<{ month: string; amount: number }> {
  const values = new Map<string, number>();
  const pattern = new RegExp(`(${months.join("|")})\\s+\\$?(-?[\\d,]+(?:\\.\\d+)?)`, "gi");
  for (const match of (notes ?? "").matchAll(pattern)) {
    const month = months.find((value) => value.toLowerCase() === match[1].toLowerCase())!;
    const amount = Number(match[2].replaceAll(",", ""));
    if (Number.isFinite(amount)) values.set(month, amount);
  }
  return months.filter((month) => values.has(month)).map((month) => ({ month, amount: values.get(month)! }));
}

export function cashFlowPayableMonthTotals(lines: CashFlowLine[]): Array<{ month: string; currency: string; amount: number }> {
  const totals = new Map<string, { month: string; currency: string; amount: number }>();
  for (const line of lines.filter((item) => !item.excludedFromTotals)) {
    for (const { month, amount } of cashFlowPayableMonths(line.notes)) {
      const key = `${month}:${line.currency}`;
      totals.set(key, { month, currency: line.currency, amount: (totals.get(key)?.amount ?? 0) + amount });
    }
  }
  return [...totals.values()].sort((a, b) => months.indexOf(a.month) - months.indexOf(b.month) || a.currency.localeCompare(b.currency));
}

export function cashFlowReportHistory(snapshot: CashFlowSnapshot, history: CashFlowSnapshot[]) {
  const byDate = new Map<string, CashFlowSnapshot>();
  for (const item of [...history].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))) {
    if (item.asOfDate <= snapshot.asOfDate) byDate.set(item.asOfDate, item);
  }
  byDate.set(snapshot.asOfDate, snapshot);
  return [...byDate.values()].sort((a, b) => a.asOfDate.localeCompare(b.asOfDate)).slice(-12);
}
