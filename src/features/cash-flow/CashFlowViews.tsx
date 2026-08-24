import {
  Download,
  FileText,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  TrendingUp,
  WalletCards,
  X
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { compareTableValues, SortableTableHead, type TableSortDirection } from "@/components/ui/sortable-table-head";
import { ToolbarSearchField } from "@/components/ui/filter-toolbar";
import { useUrlState } from "@/lib/url-state";
import { convertCurrencyTotalsToUsd } from "../../../shared/currencyTotals";
import { financeOperatingDate } from "../../../shared/operatingDate";
import { invoiceOutstanding, isLiquidAccountBalance } from "../../../shared/income";
import type {
  CashFlowLine,
  CashFlowSnapshot,
  CreateManualReceivablePayload,
  CurrencyTotals,
  DashboardSnapshot,
  FxRate,
  Invoice,
  LedgerItem,
  SaveCashFlowSnapshotPayload
} from "../../../shared/types";

type CashFlowSectionKey = "cashAccounts" | "receivables" | "openBalances" | "payables" | "investments";
type CashFlowLineSortKey = "amount" | "currency" | "included" | "name";
type OpenReceivableSortKey = "amount" | "dueDate" | "name" | "source" | "status";

const sectionDefinitions: Array<{ key: CashFlowSectionKey; label: string }> = [
  { key: "cashAccounts", label: "Cash in accounts" },
  { key: "receivables", label: "Receivables" },
  { key: "openBalances", label: "Open balances" },
  { key: "payables", label: "Payables" },
  { key: "investments", label: "Investments" }
];

function money(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(value);
}

function shortMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1
  }).format(value);
}

function dateLabel(value?: string): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

function line(id: string, name: string, amount: number, currency: string, notes?: string, dueDate?: string): CashFlowLine {
  return { id, name, amount: Number(amount.toFixed(2)), currency: currency.toUpperCase(), notes, dueDate };
}

function nativeTotals(lines: CashFlowLine[]): CurrencyTotals {
  return lines.filter((item) => !item.excludedFromTotals).reduce<CurrencyTotals>((totals, item) => ({
    ...totals,
    [item.currency]: (totals[item.currency] ?? 0) + item.amount
  }), {});
}

function usdTotal(lines: CashFlowLine[], rates: FxRate[]): number {
  return convertCurrencyTotalsToUsd(nativeTotals(lines), rates).totalUsd;
}

function snapshotTotals(snapshot: Pick<CashFlowSnapshot, CashFlowSectionKey>, rates: FxRate[]) {
  const cash = usdTotal(snapshot.cashAccounts, rates);
  const receivables = usdTotal(snapshot.receivables, rates);
  const openBalances = usdTotal(snapshot.openBalances, rates);
  const payables = usdTotal(snapshot.payables, rates);
  const investments = usdTotal(snapshot.investments, rates);
  const approximateCash = cash + receivables + openBalances;
  const profit = cash + receivables + openBalances - payables;
  return { cash, receivables, openBalances, approximateCash, payables, investments, profit, assets: profit + investments };
}

function invoiceCashFlowLine(invoice: Invoice, dashboard: DashboardSnapshot): CashFlowLine | null {
  if (invoice.documentType !== "sales_invoice" || invoice.status === "paid") return null;
  const outstanding = invoiceOutstanding(invoice, dashboard.paymentAllocations);
  if (outstanding <= 0) return null;
  const provider = invoice.providerId
    ? dashboard.providers.find((item) => item.id === invoice.providerId)
    : undefined;
  return line(
    `cash-flow-invoice-${invoice.id}`,
    provider?.name ?? invoice.customerName,
    outstanding,
    invoice.currency,
    invoice.invoiceNumber,
    invoice.dueDate
  );
}

function liveCashFlowDraft(dashboard: DashboardSnapshot): SaveCashFlowSnapshotPayload {
  const groupedInvoiceReceivables = new Map<string, CashFlowLine & { invoiceCount: number }>();
  for (const invoice of dashboard.invoices) {
    const invoiceLine = invoiceCashFlowLine(invoice, dashboard);
    if (!invoiceLine) continue;
    const providerKey = invoice.providerId ?? invoiceLine.name.trim().toLowerCase();
    const key = `${providerKey}:${invoiceLine.currency}`;
    const existing = groupedInvoiceReceivables.get(key);
    groupedInvoiceReceivables.set(key, existing
      ? {
          ...existing,
          amount: Number((existing.amount + invoiceLine.amount).toFixed(2)),
          dueDate: [existing.dueDate, invoiceLine.dueDate].filter((value): value is string => Boolean(value)).sort()[0],
          invoiceCount: existing.invoiceCount + 1
        }
      : {
          ...invoiceLine,
          id: `cash-flow-invoices-${key}`.slice(0, 200),
          invoiceCount: 1
        });
  }
  const invoiceReceivables = [...groupedInvoiceReceivables.values()].map(({ invoiceCount, ...item }) => ({
    ...item,
    notes: invoiceCount === 1 ? item.notes : `${invoiceCount} unpaid invoices`
  }));
  const manualReceivables = dashboard.receivables
    .filter((item) => item.source === "manual")
    .map((item) => line(`cash-flow-manual-${item.id}`, item.name, item.balance, item.currency, item.notes, item.dueDate));
  const cashAccounts = [
    ...dashboard.accounts
      .filter(isLiquidAccountBalance)
      .map((item) => line(`cash-flow-account-${item.id}`, item.name, item.balance, item.currency)),
    ...dashboard.holdings
      .filter((item) => item.kind === "cash")
      .map((item) => line(`cash-flow-holding-${item.id}`, item.name, item.balance, item.asset, item.notes))
  ];
  return {
    asOfDate: financeOperatingDate(),
    cashAccounts,
    receivables: [...invoiceReceivables, ...manualReceivables],
    openBalances: dashboard.openBalances.map((item) => line(item.id, item.name, item.balance, item.currency, item.notes, item.dueDate)),
    payables: dashboard.payables.map((item) => line(`cash-flow-payable-${item.id}`, item.supplier, item.balance, item.currency, item.category)),
    investments: [
      ...dashboard.investments.map((item) => line(item.id, item.name, item.balance, item.currency, item.notes)),
      ...dashboard.holdings
        .filter((item) => item.kind !== "cash")
        .map((item) => line(`cash-flow-investment-${item.id}`, item.name, item.balance, item.asset, item.notes))
    ]
  };
}

function snapshotPayload(snapshot: CashFlowSnapshot): SaveCashFlowSnapshotPayload {
  return {
    id: snapshot.id,
    asOfDate: snapshot.asOfDate,
    cashAccounts: snapshot.cashAccounts,
    receivables: snapshot.receivables,
    openBalances: snapshot.openBalances,
    payables: snapshot.payables,
    investments: snapshot.investments,
    cashGrowthPercent: snapshot.cashGrowthPercent,
    spendGrowthPercent: snapshot.spendGrowthPercent,
    profitGrowthPercent: snapshot.profitGrowthPercent
  };
}

function EditableCashFlowSection({
  sectionKey,
  title,
  lines,
  rates,
  onChange
}: {
  sectionKey: CashFlowSectionKey;
  title: string;
  lines: CashFlowLine[];
  rates: FxRate[];
  onChange: (lines: CashFlowLine[]) => void;
}) {
  const [sortKey, setSortKey] = useUrlState<CashFlowLineSortKey>(`cashFlow${sectionKey}Sort`, "name", {
    allowedValues: ["amount", "currency", "included", "name"]
  });
  const [sortDirection, setSortDirection] = useUrlState<TableSortDirection>(`cashFlow${sectionKey}Order`, "asc", {
    allowedValues: ["asc", "desc"]
  });
  const sortValue = (item: CashFlowLine) => sortKey === "included" ? !item.excludedFromTotals : item[sortKey];
  const visibleLines = [...lines].sort((left, right) =>
    compareTableValues(sortValue(left), sortValue(right), sortDirection) || left.id.localeCompare(right.id)
  );

  function requestSort(next: CashFlowLineSortKey) {
    if (next === sortKey) setSortDirection((current) => current === "asc" ? "desc" : "asc");
    else {
      setSortKey(next);
      setSortDirection(next === "amount" ? "desc" : "asc");
    }
  }

  function update(id: string, patch: Partial<CashFlowLine>) {
    onChange(lines.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  return (
    <section className="panel cash-flow-editor-section">
      <div className="panel-header compact-panel-header">
        <div><h3>{title}</h3><span>{money(usdTotal(lines, rates))}</span></div>
        <Button
          className="icon-text-button"
          type="button"
          onClick={() => onChange([...lines, line(`cash-flow-line-${crypto.randomUUID()}`, "", 0, "USD")])}
        >
          <Plus size={14} /> Add row
        </Button>
      </div>
      <div className="table-wrap">
        <table className="data-table cash-flow-entry-table">
          <thead><tr>
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="name">Name</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={requestSort} sortKey="amount">Amount</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="currency">Currency</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="included">Included</SortableTableHead>
            <th scope="col">Actions</th>
          </tr></thead>
          <tbody>
            {visibleLines.length > 0 ? visibleLines.map((item) => (
              <tr key={item.id}>
                <td><Input aria-label={`${title} name`} value={item.name} onChange={(event) => update(item.id, { name: event.target.value })} /></td>
                <td className="amount"><Input aria-label={`${item.name || title} amount`} type="number" step="0.01" value={item.amount} onChange={(event) => update(item.id, { amount: Number(event.target.value) })} /></td>
                <td><Input aria-label={`${item.name || title} currency`} maxLength={12} value={item.currency} onChange={(event) => update(item.id, { currency: event.target.value.toUpperCase() })} /></td>
                <td><input aria-label={`Include ${item.name || "row"} in totals`} checked={!item.excludedFromTotals} className="cash-flow-include-checkbox" type="checkbox" onChange={(event) => update(item.id, { excludedFromTotals: event.target.checked ? undefined : true })} /></td>
                <td><Button className="icon-button destructive-icon-button" type="button" aria-label={`Remove ${item.name || "row"}`} onClick={() => onChange(lines.filter((lineItem) => lineItem.id !== item.id))}><Trash2 size={14} /></Button></td>
              </tr>
            )) : <tr><td colSpan={5}>No rows</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TrendChart({ snapshots, rates }: { snapshots: CashFlowSnapshot[]; rates: FxRate[] }) {
  const rows = [...snapshots].sort((left, right) => left.asOfDate.localeCompare(right.asOfDate)).slice(-12);
  if (rows.length < 2) return <div className="cash-flow-chart-empty">Save two dated snapshots to show trends.</div>;
  const width = 760;
  const height = 280;
  const padding = { top: 22, right: 20, bottom: 42, left: 64 };
  const series = [
    { key: "cash" as const, label: "Cash", color: "#0ea5e9" },
    { key: "receivables" as const, label: "Receivables", color: "#8b5cf6" },
    { key: "payables" as const, label: "Payables", color: "#ef4444" },
    { key: "assets" as const, label: "Assets", color: "#16a34a" }
  ];
  const values = rows.map((row) => ({ date: row.asOfDate, ...snapshotTotals(row, rates) }));
  const maximum = Math.max(1, ...values.flatMap((row) => series.map((item) => row[item.key])));
  const x = (index: number) => padding.left + index * ((width - padding.left - padding.right) / (values.length - 1));
  const y = (value: number) => height - padding.bottom - (value / maximum) * (height - padding.top - padding.bottom);
  return (
    <svg className="cash-flow-chart" role="img" aria-label="Cash flow position trend" viewBox={`0 0 ${width} ${height}`}>
      {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
        const value = maximum * ratio;
        return <g key={ratio}><line x1={padding.left} x2={width - padding.right} y1={y(value)} y2={y(value)} className="cash-flow-chart-axis-grid" /><text x={padding.left - 10} y={y(value) + 4} textAnchor="end">{shortMoney(value)}</text></g>;
      })}
      {series.map((item) => (
        <polyline key={item.key} fill="none" stroke={item.color} strokeWidth="3" points={values.map((row, index) => `${x(index)},${y(row[item.key])}`).join(" ")} />
      ))}
      {values.map((row, index) => <text key={row.date} x={x(index)} y={height - 14} textAnchor="middle">{row.date.slice(5)}</text>)}
      {series.map((item, index) => <g key={item.key} transform={`translate(${padding.left + index * 130},8)`}><rect width="12" height="12" rx="3" fill={item.color} /><text x="18" y="11">{item.label}</text></g>)}
    </svg>
  );
}

function CompositionChart({ snapshot, rates }: { snapshot: Pick<CashFlowSnapshot, CashFlowSectionKey>; rates: FxRate[] }) {
  const totals = snapshotTotals(snapshot, rates);
  const rows = [
    { label: "Cash", value: totals.cash, color: "#0ea5e9" },
    { label: "Receivables", value: totals.receivables, color: "#8b5cf6" },
    { label: "Open balances", value: totals.openBalances, color: "#f59e0b" },
    { label: "Payables", value: totals.payables, color: "#ef4444" },
    { label: "Investments", value: totals.investments, color: "#16a34a" }
  ];
  const maximum = Math.max(1, ...rows.map((row) => Math.abs(row.value)));
  return <div className="cash-flow-composition" role="img" aria-label="Current cash flow composition">{rows.map((row) => <div key={row.label}><span>{row.label}</span><div><i style={{ background: row.color, width: `${Math.max(2, Math.abs(row.value) / maximum * 100)}%` }} /></div><strong>{money(row.value)}</strong></div>)}</div>;
}

const cashFlowExportMonths = ["August", "July", "June", "May", "April", "March", "February", "January", "December"] as const;

function payableMonthAmounts(notes?: string): Partial<Record<(typeof cashFlowExportMonths)[number], number>> {
  if (!notes) return {};
  const values: Partial<Record<(typeof cashFlowExportMonths)[number], number>> = {};
  const pattern = /(August|July|June|May|April|March|February|January|December)\s+\$?(-?[\d,]+(?:\.\d+)?)/gi;
  for (const match of notes.matchAll(pattern)) {
    const month = cashFlowExportMonths.find((item) => item.toLowerCase() === match[1].toLowerCase());
    const amount = Number(match[2].replaceAll(",", ""));
    if (month && Number.isFinite(amount)) values[month] = amount;
  }
  return values;
}

type SheetCellOptions = {
  align?: CanvasTextAlign;
  border?: string;
  fill?: string;
  fontSize?: number;
  fontWeight?: number;
  textColor?: string;
};

function drawSheetCell(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  text: string,
  options: SheetCellOptions = {}
) {
  const align = options.align ?? "left";
  context.fillStyle = options.fill ?? "#ffffff";
  context.fillRect(x, y, width, height);
  context.strokeStyle = options.border ?? "#18212f";
  context.lineWidth = 1;
  context.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  context.save();
  context.beginPath();
  context.rect(x + 1, y + 1, width - 2, height - 2);
  context.clip();
  context.fillStyle = options.textColor ?? "#111827";
  context.font = `${options.fontWeight ?? 500} ${options.fontSize ?? 17}px Inter, Arial, sans-serif`;
  context.textAlign = align;
  context.textBaseline = "middle";
  const inset = 10;
  const textX = align === "right" ? x + width - inset : align === "center" ? x + width / 2 : x + inset;
  context.fillText(text, textX, y + height / 2, width - inset * 2);
  context.restore();
}

function drawSheetSection(
  context: CanvasRenderingContext2D,
  title: string,
  lines: CashFlowLine[],
  rates: FxRate[],
  x: number,
  y: number,
  width: number,
  rowHeight: number,
  headerFill = "#f6a313"
): number {
  const titleHeight = 36;
  const columnHeight = 30;
  const totalHeight = 34;
  const amountWidth = Math.round(width * 0.34);
  const nameWidth = width - amountWidth;
  drawSheetCell(context, x, y, width, titleHeight, title, { align: "center", fill: headerFill, fontSize: 19, fontWeight: 750 });
  drawSheetCell(context, x, y + titleHeight, nameWidth, columnHeight, "Account", { align: "center", fill: headerFill, fontSize: 15, fontWeight: 700 });
  drawSheetCell(context, x + nameWidth, y + titleHeight, amountWidth, columnHeight, "Balance", { align: "center", fill: headerFill, fontSize: 15, fontWeight: 700 });
  let cursorY = y + titleHeight + columnHeight;
  const rows = lines.length > 0 ? lines : [line("empty", "No entries", 0, "USD")];
  rows.forEach((item, index) => {
    const fill = index % 2 === 0 ? "#ffffff" : "#f8fafc";
    const textColor = item.excludedFromTotals ? "#64748b" : "#111827";
    drawSheetCell(context, x, cursorY, nameWidth, rowHeight, item.name || "Untitled", { fill, fontSize: 15, textColor });
    drawSheetCell(context, x + nameWidth, cursorY, amountWidth, rowHeight, money(item.amount, item.currency), { align: "right", fill, fontSize: 15, fontWeight: 600, textColor });
    cursorY += rowHeight;
  });
  drawSheetCell(context, x, cursorY, nameWidth, totalHeight, `Total ${title}`, { fill: headerFill, fontSize: 16, fontWeight: 750 });
  drawSheetCell(context, x + nameWidth, cursorY, amountWidth, totalHeight, money(usdTotal(lines, rates)), { align: "right", fill: headerFill, fontSize: 16, fontWeight: 750 });
  return cursorY + totalHeight;
}

function downloadCashFlowPng(snapshot: CashFlowSnapshot, history: CashFlowSnapshot[], rates: FxRate[]) {
  const width = 3200;
  const height = 1800;
  const canvas = document.createElement("canvas");
  canvas.width = width * 2;
  canvas.height = height * 2;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.scale(2, 2);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  const totals = snapshotTotals(snapshot, rates);
  const margin = 50;
  const top = 88;
  const leftWidth = 600;
  const middleWidth = 620;
  const gap = 12;
  const leftX = margin;
  const middleX = leftX + leftWidth + gap;
  const rightX = middleX + middleWidth + gap;
  const rightWidth = width - margin - rightX;
  const orange = "#f6a313";
  const red = "#ef0909";
  const darkRed = "#8f0000";
  drawSheetCell(context, margin, 24, width - margin * 2, 50, `Cash Flow Position · ${dateLabel(snapshot.asOfDate)}`, { align: "center", fill: orange, fontSize: 25, fontWeight: 800 });

  const maximumTableRows = Math.max(snapshot.openBalances.length, snapshot.payables.length, snapshot.cashAccounts.length + snapshot.receivables.length + 5, 1);
  const rowHeight = Math.min(28, Math.max(20, Math.floor(910 / maximumTableRows)));
  const cashEndY = drawSheetSection(context, "Cash in Accounts", snapshot.cashAccounts, rates, leftX, top, leftWidth, rowHeight, orange);
  drawSheetSection(context, "Receivables", snapshot.receivables, rates, leftX, cashEndY + gap, leftWidth, rowHeight, orange);
  drawSheetSection(context, "Open Balance", snapshot.openBalances, rates, middleX, top, middleWidth, rowHeight, orange);

  const payableTitleHeight = 36;
  const payableHeaderHeight = 30;
  const payableNameWidth = 420;
  const payableBalanceWidth = 205;
  const monthWidth = (rightWidth - payableNameWidth - payableBalanceWidth) / cashFlowExportMonths.length;
  drawSheetCell(context, rightX, top, payableNameWidth + payableBalanceWidth, payableTitleHeight, "Payables", { align: "center", fill: red, fontSize: 19, fontWeight: 800, textColor: "#ffffff" });
  drawSheetCell(context, rightX + payableNameWidth + payableBalanceWidth, top, rightWidth - payableNameWidth - payableBalanceWidth, payableTitleHeight, "Months", { align: "center", fill: darkRed, fontSize: 19, fontWeight: 800, textColor: "#ffffff" });
  drawSheetCell(context, rightX, top + payableTitleHeight, payableNameWidth, payableHeaderHeight, "Supplier / Platform", { align: "center", fill: red, fontSize: 14, fontWeight: 750, textColor: "#ffffff" });
  drawSheetCell(context, rightX + payableNameWidth, top + payableTitleHeight, payableBalanceWidth, payableHeaderHeight, "Balance", { align: "center", fill: red, fontSize: 14, fontWeight: 750, textColor: "#ffffff" });
  cashFlowExportMonths.forEach((month, index) => drawSheetCell(
    context,
    rightX + payableNameWidth + payableBalanceWidth + monthWidth * index,
    top + payableTitleHeight,
    monthWidth,
    payableHeaderHeight,
    month === "February" ? "Feb" : month === "January" ? "Jan" : month,
    { align: "center", fill: darkRed, fontSize: 13, fontWeight: 750, textColor: "#ffffff" }
  ));
  let payableY = top + payableTitleHeight + payableHeaderHeight;
  const payableRows = snapshot.payables.length > 0 ? snapshot.payables : [line("empty", "No entries", 0, "USD")];
  payableRows.forEach((item, index) => {
    const fill = index % 2 === 0 ? "#ffffff" : "#f8fafc";
    const textColor = item.excludedFromTotals ? "#64748b" : "#111827";
    drawSheetCell(context, rightX, payableY, payableNameWidth, rowHeight, item.name || "Untitled", { fill, fontSize: 14, textColor });
    drawSheetCell(context, rightX + payableNameWidth, payableY, payableBalanceWidth, rowHeight, money(item.amount, item.currency), { align: "right", fill, fontSize: 14, fontWeight: 650, textColor });
    const monthValues = payableMonthAmounts(item.notes);
    cashFlowExportMonths.forEach((month, monthIndex) => drawSheetCell(
      context,
      rightX + payableNameWidth + payableBalanceWidth + monthWidth * monthIndex,
      payableY,
      monthWidth,
      rowHeight,
      monthValues[month] === undefined ? "" : money(monthValues[month] ?? 0),
      { align: "right", fill, fontSize: 12, textColor }
    ));
    payableY += rowHeight;
  });
  const payableMonthTotals = cashFlowExportMonths.map((month) => snapshot.payables.reduce((sum, item) => sum + (payableMonthAmounts(item.notes)[month] ?? 0), 0));
  drawSheetCell(context, rightX, payableY, payableNameWidth, 34, "Total", { fill: red, fontSize: 16, fontWeight: 800, textColor: "#ffffff" });
  drawSheetCell(context, rightX + payableNameWidth, payableY, payableBalanceWidth, 34, money(totals.payables), { align: "right", fill: red, fontSize: 15, fontWeight: 800, textColor: "#ffffff" });
  payableMonthTotals.forEach((value, index) => drawSheetCell(context, rightX + payableNameWidth + payableBalanceWidth + monthWidth * index, payableY, monthWidth, 34, value === 0 ? "$0.00" : money(value), { align: "right", fill: darkRed, fontSize: 12, fontWeight: 750, textColor: "#ffffff" }));

  const summaryTop = payableY + 50;
  const summaryLabelWidth = 430;
  const summaryValueWidth = 260;
  const investmentX = rightX + summaryLabelWidth + summaryValueWidth + 26;
  const investmentWidth = rightWidth - summaryLabelWidth - summaryValueWidth - 26;
  const summaryRows = [
    ["Total Approximate Cash in Account", totals.approximateCash, "#18e018"],
    ["Total Cash in", totals.cash, "#f7b31d"],
    ["Total Spend without payments", totals.payables, "#f20f0f"],
    ["Profit", totals.profit, "#19e51f"]
  ] as const;
  summaryRows.forEach(([label, value, fill], index) => {
    drawSheetCell(context, rightX, summaryTop + index * 36, summaryLabelWidth, 36, label, { align: "right", fill, fontSize: 16, fontWeight: 800 });
    drawSheetCell(context, rightX + summaryLabelWidth, summaryTop + index * 36, summaryValueWidth, 36, money(value), { align: "right", fill, fontSize: 16, fontWeight: 800 });
  });
  drawSheetCell(context, investmentX, summaryTop, investmentWidth, 36, "Investments", { align: "center", fill: "#12d90f", fontSize: 17, fontWeight: 800 });
  let investmentY = summaryTop + 36;
  const investmentNameWidth = investmentWidth * 0.58;
  const investmentRows = snapshot.investments.length > 0 ? snapshot.investments : [line("empty", "No investments", 0, "USD")];
  investmentRows.forEach((item, index) => {
    const fill = index % 2 === 0 ? "#ffffff" : "#f8fafc";
    drawSheetCell(context, investmentX, investmentY, investmentNameWidth, 32, item.name || "Untitled", { fill, fontSize: 14 });
    drawSheetCell(context, investmentX + investmentNameWidth, investmentY, investmentWidth - investmentNameWidth, 32, money(item.amount, item.currency), { align: "right", fill, fontSize: 14, fontWeight: 700 });
    investmentY += 32;
  });
  drawSheetCell(context, investmentX, investmentY, investmentNameWidth, 34, "Total Investments", { fill: "#12d90f", fontSize: 15, fontWeight: 800 });
  drawSheetCell(context, investmentX + investmentNameWidth, investmentY, investmentWidth - investmentNameWidth, 34, money(totals.investments), { align: "right", fill: "#12d90f", fontSize: 15, fontWeight: 800 });

  const assetsTop = Math.max(summaryTop + 178, investmentY + 52);
  drawSheetCell(context, rightX, assetsTop, Math.round(rightWidth * 0.57), 48, "Total Assets (Profit + Investment)", { align: "center", fill: "#d9e8ff", fontSize: 20, fontWeight: 800 });
  drawSheetCell(context, rightX + Math.round(rightWidth * 0.57), assetsTop, rightWidth - Math.round(rightWidth * 0.57), 48, money(totals.assets), { align: "center", fill: "#d9e8ff", fontSize: 20, fontWeight: 800 });
  const growthRows = [
    ["Cash Growth vs Last week", snapshot.cashGrowthPercent],
    ["Spend Growth vs Last week", snapshot.spendGrowthPercent],
    ["Profit Growth vs Last week", snapshot.profitGrowthPercent]
  ] as const;
  growthRows.forEach(([label, value], index) => {
    const y = assetsTop + 68 + index * 32;
    drawSheetCell(context, rightX, y, 430, 32, label, { fill: "#10dfe7", fontSize: 14, fontWeight: 650 });
    drawSheetCell(context, rightX + 430, y, 170, 32, value === undefined ? "—" : `${value.toFixed(2)}%`, { align: "right", fill: "#10dfe7", fontSize: 14, fontWeight: 750 });
  });

  const cursorY = 1215;
  context.fillStyle = "#111827";
  context.font = "800 25px Inter, Arial, sans-serif";
  context.fillText("Graphs", margin, cursorY - 30);
  const points = [...history].sort((left, right) => left.asOfDate.localeCompare(right.asOfDate)).slice(-12);
  const chartX = margin + 86;
  const chartY = cursorY + 62;
  const chartWidth = 1910;
  const chartHeight = 370;
  context.fillStyle = "#f8fafc";
  context.strokeStyle = "#cbd5e1";
  context.lineWidth = 2;
  context.fillRect(margin, cursorY, 2080, 500);
  context.strokeRect(margin + 1, cursorY + 1, 2078, 498);
  context.fillStyle = "#111827";
  context.font = "750 20px Inter, Arial, sans-serif";
  context.fillText("Position trend", margin + 22, cursorY + 34);
  const chartRows = points.length > 0 ? points : [snapshot];
  const chartValues = chartRows.map((row) => snapshotTotals(row, rates));
  const maximum = Math.max(1, ...chartValues.flatMap((row) => [row.cash, row.receivables, row.payables, row.assets]));
  const colors = ["#0ea5e9", "#8b5cf6", "#ef4444", "#16a34a"];
  const keys = ["cash", "receivables", "payables", "assets"] as const;
  context.lineWidth = 2;
  for (let grid = 0; grid <= 4; grid += 1) {
    const y = chartY + chartHeight - grid * chartHeight / 4;
    context.strokeStyle = "#e2e8f0";
    context.beginPath();
    context.moveTo(chartX, y);
    context.lineTo(chartX + chartWidth, y);
    context.stroke();
  }
  keys.forEach((key, seriesIndex) => {
    context.strokeStyle = colors[seriesIndex];
    context.lineWidth = 4;
    context.beginPath();
    chartValues.forEach((row, index) => {
      const x = chartX + (chartValues.length === 1 ? chartWidth / 2 : index * chartWidth / (chartValues.length - 1));
      const y = chartY + chartHeight - row[key] / maximum * chartHeight;
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    });
    context.stroke();
  });
  context.fillStyle = "#64748b";
  context.font = "500 15px Inter, Arial, sans-serif";
  ["Cash", "Receivables", "Payables", "Assets"].forEach((label, index) => {
    const legendX = margin + 22 + index * 190;
    context.fillStyle = colors[index];
    context.fillRect(legendX, cursorY + 455, 16, 16);
    context.fillStyle = "#475569";
    context.fillText(label, legendX + 24, cursorY + 468);
  });

  const mixX = margin + 2100;
  const mixWidth = width - margin - mixX;
  context.fillStyle = "#f8fafc";
  context.strokeStyle = "#cbd5e1";
  context.fillRect(mixX, cursorY, mixWidth, 500);
  context.strokeRect(mixX + 1, cursorY + 1, mixWidth - 2, 498);
  context.fillStyle = "#111827";
  context.font = "750 20px Inter, Arial, sans-serif";
  context.fillText("Current composition", mixX + 22, cursorY + 34);
  const composition = [
    ["Cash", totals.cash, "#0ea5e9"],
    ["Receivables", totals.receivables, "#8b5cf6"],
    ["Open balances", totals.openBalances, "#f59e0b"],
    ["Payables", totals.payables, "#ef4444"],
    ["Investments", totals.investments, "#16a34a"]
  ] as const;
  const compositionMaximum = Math.max(1, ...composition.map((item) => Math.abs(item[1])));
  composition.forEach(([label, value, color], index) => {
    const y = cursorY + 78 + index * 78;
    context.fillStyle = "#475569";
    context.font = "650 15px Inter, Arial, sans-serif";
    context.fillText(label, mixX + 22, y);
    context.textAlign = "right";
    context.fillText(money(value), mixX + mixWidth - 22, y);
    context.textAlign = "left";
    context.fillStyle = "#e2e8f0";
    context.fillRect(mixX + 22, y + 16, mixWidth - 44, 18);
    context.fillStyle = color;
    context.fillRect(mixX + 22, y + 16, Math.max(5, (mixWidth - 44) * Math.abs(value) / compositionMaximum), 18);
  });
  const link = document.createElement("a");
  link.download = `cash-flow-${snapshot.asOfDate}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
}

export function CashFlowPositionView({
  dashboard,
  onSave
}: {
  dashboard: DashboardSnapshot;
  onSave: (payload: SaveCashFlowSnapshotPayload) => Promise<CashFlowSnapshot>;
}) {
  const [selectedSnapshotId, setSelectedSnapshotId] = useUrlState("cashFlowSnapshot", "live");
  const [draft, setDraft] = useState<SaveCashFlowSnapshotPayload>(() => {
    const selected = dashboard.cashFlowSnapshots.find((item) => item.id === selectedSnapshotId);
    return selected ? snapshotPayload(selected) : liveCashFlowDraft(dashboard);
  });
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const selectedSnapshot = dashboard.cashFlowSnapshots.find((item) => item.id === selectedSnapshotId);

  useEffect(() => {
    const selected = dashboard.cashFlowSnapshots.find((item) => item.id === selectedSnapshotId);
    setDraft(selected ? snapshotPayload(selected) : liveCashFlowDraft(dashboard));
  }, [selectedSnapshotId]);

  const preview: CashFlowSnapshot = {
    ...draft,
    id: draft.id ?? "preview",
    createdAt: selectedSnapshot?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const totals = snapshotTotals(preview, dashboard.fxRates);

  function setSection(key: CashFlowSectionKey, lines: CashFlowLine[]) {
    setDraft((current) => ({ ...current, [key]: lines }));
    setNotice(null);
    setSaveError(null);
  }

  async function save() {
    setSaving(true);
    setNotice(null);
    setSaveError(null);
    try {
      const saved = await onSave(draft);
      setDraft(snapshotPayload(saved));
      setSelectedSnapshotId(saved.id);
      setNotice(`Saved ${dateLabel(saved.asOfDate)}`);
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "Cash flow snapshot could not be saved");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="cash-flow-page-stack">
      <section className="cash-flow-topbar">
        <div><p className="eyebrow">Cash Flow</p><h1>Position</h1></div>
        <div className="cash-flow-topbar-actions">
          <NativeSelect aria-label="Cash flow snapshot" value={selectedSnapshotId} onValueChange={setSelectedSnapshotId}>
            <NativeSelectOption value="live">New from live data</NativeSelectOption>
            {dashboard.cashFlowSnapshots.map((snapshot) => <NativeSelectOption key={snapshot.id} value={snapshot.id}>{dateLabel(snapshot.asOfDate)}</NativeSelectOption>)}
          </NativeSelect>
          <Input aria-label="Cash flow date" type="date" value={draft.asOfDate} max={financeOperatingDate()} onChange={(event) => setDraft((current) => ({ ...current, asOfDate: event.target.value }))} />
          <Button className="icon-text-button" type="button" onClick={() => { setSelectedSnapshotId("live"); setDraft(liveCashFlowDraft(dashboard)); }}><RefreshCw size={15} /> Use live values</Button>
          <Button className="icon-text-button" type="button" onClick={() => downloadCashFlowPng(preview, [...dashboard.cashFlowSnapshots.filter((item) => item.id !== preview.id), preview], dashboard.fxRates)}><Download size={15} /> Export PNG</Button>
          <Button className="primary-button" type="button" disabled={saving || !draft.asOfDate} onClick={() => void save()}>{saving ? <Loader2 className="spin" size={15} /> : <Save size={15} />} Save</Button>
        </div>
      </section>
      {notice && <div className="cash-flow-save-notice" role="status">{notice}</div>}
      {saveError && <div className="inline-error" role="alert">{saveError}</div>}
      <section className="cash-flow-metric-grid" aria-label="Cash flow totals">
        <CashFlowMetric label="Cash" value={totals.cash} tone="cash" />
        <CashFlowMetric label="Receivables" value={totals.receivables} tone="receivable" />
        <CashFlowMetric label="Open balances" value={totals.openBalances} tone="open-balance" />
        <CashFlowMetric label="Approximate cash" value={totals.approximateCash} tone="approximate" />
        <CashFlowMetric label="Payables" value={totals.payables} tone="payable" />
        <CashFlowMetric label="Profit" value={totals.profit} tone="profit" />
        <CashFlowMetric label="Investments" value={totals.investments} tone="investment" />
        <CashFlowMetric label="Total assets" value={totals.assets} tone="assets" />
      </section>
      <section className="panel cash-flow-snapshot-details">
        <div className="panel-header compact-panel-header"><div><p className="eyebrow">Snapshot</p><h2>Details</h2></div></div>
        <div className="cash-flow-growth-inputs">
          <label>Cash growth (%)<Input aria-label="Cash growth percent" type="number" step="0.01" value={draft.cashGrowthPercent ?? ""} onChange={(event) => setDraft((current) => ({ ...current, cashGrowthPercent: event.target.value === "" ? undefined : Number(event.target.value) }))} /></label>
          <label>Spend growth (%)<Input aria-label="Spend growth percent" type="number" step="0.01" value={draft.spendGrowthPercent ?? ""} onChange={(event) => setDraft((current) => ({ ...current, spendGrowthPercent: event.target.value === "" ? undefined : Number(event.target.value) }))} /></label>
          <label>Profit growth (%)<Input aria-label="Profit growth percent" type="number" step="0.01" value={draft.profitGrowthPercent ?? ""} onChange={(event) => setDraft((current) => ({ ...current, profitGrowthPercent: event.target.value === "" ? undefined : Number(event.target.value) }))} /></label>
        </div>
      </section>
      <div className="cash-flow-editor-grid">
        {sectionDefinitions.map((section) => <EditableCashFlowSection key={section.key} sectionKey={section.key} title={section.label} lines={draft[section.key]} rates={dashboard.fxRates} onChange={(lines) => setSection(section.key, lines)} />)}
      </div>
      <section className="cash-flow-chart-grid">
        <article className="panel"><div className="panel-header"><div><p className="eyebrow">Trend</p><h2>Position history</h2></div><TrendingUp size={19} /></div><TrendChart snapshots={[...dashboard.cashFlowSnapshots.filter((item) => item.id !== preview.id), preview]} rates={dashboard.fxRates} /></article>
        <article className="panel"><div className="panel-header"><div><p className="eyebrow">Mix</p><h2>Current composition</h2></div><WalletCards size={19} /></div><CompositionChart snapshot={preview} rates={dashboard.fxRates} /></article>
      </section>
    </div>
  );
}

function CashFlowMetric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <article className={`cash-flow-metric ${tone}`}><span>{label}</span><strong>{money(value)}</strong></article>;
}

type OpenReceivableRow = {
  id: string;
  name: string;
  source: string;
  status: string;
  amount: number;
  currency: string;
  dueDate?: string;
  notes?: string;
  invoice?: Invoice;
  manual?: LedgerItem;
};

export function CashFlowOpenInvoicesView({
  dashboard,
  onCreateManualReceivable,
  onDeleteManualReceivable
}: {
  dashboard: DashboardSnapshot;
  onCreateManualReceivable: (payload: CreateManualReceivablePayload) => Promise<void>;
  onDeleteManualReceivable: (receivableId: string) => Promise<void>;
}) {
  const [query, setQuery] = useUrlState("cashFlowOpenQuery", "");
  const [sortKey, setSortKey] = useUrlState<OpenReceivableSortKey>("cashFlowOpenSort", "dueDate", {
    allowedValues: ["amount", "dueDate", "name", "source", "status"]
  });
  const [sortDirection, setSortDirection] = useUrlState<TableSortDirection>("cashFlowOpenOrder", "asc", {
    allowedValues: ["asc", "desc"]
  });
  const [dialogKind, setDialogKind] = useState<"commission" | "receivable" | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const rows = useMemo<OpenReceivableRow[]>(() => [
    ...dashboard.invoices.flatMap((invoice) => {
      const lineItem = invoiceCashFlowLine(invoice, dashboard);
      if (!lineItem) return [];
      return [{
        id: invoice.id,
        name: lineItem.name,
        source: invoice.invoiceNumber || "Dashboard invoice",
        status: invoice.status === "draft" ? "Draft" : "Open",
        amount: lineItem.amount,
        currency: lineItem.currency,
        dueDate: invoice.dueDate,
        notes: invoice.description,
        invoice
      }];
    }),
    ...dashboard.receivables.filter((item) => item.source === "manual").map((item) => ({
      id: item.id,
      name: item.name,
      source: item.notes?.toLowerCase().includes("commission") ? "Commission" : "Manual receivable",
      status: "Open",
      amount: item.balance,
      currency: item.currency,
      dueDate: item.dueDate,
      notes: item.notes,
      manual: item
    }))
  ], [dashboard.invoices, dashboard.paymentAllocations, dashboard.providers, dashboard.receivables]);
  const visibleRows = rows
    .filter((row) => `${row.name} ${row.source} ${row.status} ${row.currency} ${row.notes ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((left, right) => compareTableValues(left[sortKey], right[sortKey], sortDirection) || left.id.localeCompare(right.id));
  const total = usdTotal(visibleRows.map((row) => line(row.id, row.name, row.amount, row.currency)), dashboard.fxRates);

  function requestSort(next: OpenReceivableSortKey) {
    if (next === sortKey) setSortDirection((current) => current === "asc" ? "desc" : "asc");
    else {
      setSortKey(next);
      setSortDirection(next === "amount" ? "desc" : "asc");
    }
  }

  return (
    <div className="cash-flow-page-stack">
      <section className="cash-flow-topbar">
        <div><p className="eyebrow">Cash Flow</p><h1>Open invoices</h1></div>
        <div className="cash-flow-topbar-actions">
          <Button className="icon-text-button" type="button" onClick={() => setDialogKind("receivable")}><Plus size={15} /> Add receivable</Button>
          <Button className="primary-button" type="button" onClick={() => setDialogKind("commission")}><Plus size={15} /> Add Sanjin commission</Button>
        </div>
      </section>
      <section className="cash-flow-open-summary">
        <article><FileText size={19} /><span>Open items</span><strong>{visibleRows.length}</strong></article>
        <article><WalletCards size={19} /><span>Approximate total</span><strong>{money(total)}</strong></article>
      </section>
      <section className="panel">
        <div className="list-toolbar"><ToolbarSearchField ariaLabel="Search open invoices and receivables" placeholder="Search open items" value={query} onChange={setQuery} /></div>
        <div className="table-wrap">
          <table className="data-table cash-flow-open-table">
            <thead><tr>
              <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="name">Company / item</SortableTableHead>
              <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="source">Source</SortableTableHead>
              <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="status">Status</SortableTableHead>
              <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="dueDate">Expected / due</SortableTableHead>
              <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={requestSort} sortKey="amount">Amount</SortableTableHead>
              <th scope="col">Actions</th>
            </tr></thead>
            <tbody>{visibleRows.length > 0 ? visibleRows.map((row) => <tr key={row.id}>
              <td><strong>{row.name}</strong>{row.notes && <small>{row.notes}</small>}</td>
              <td>{row.source}</td>
              <td><span className={`status-pill invoice-status-${row.invoice?.status ?? "open"}`}>{row.status}</span></td>
              <td>{dateLabel(row.dueDate)}</td>
              <td className="amount"><strong>{money(row.amount, row.currency)}</strong></td>
              <td>{row.manual ? <Button className="icon-text-button destructive-icon-button" type="button" disabled={deletingId === row.id} onClick={async () => { setDeletingId(row.id); try { await onDeleteManualReceivable(row.id); } finally { setDeletingId(null); } }}>{deletingId === row.id ? <Loader2 className="spin" size={14} /> : <Trash2 size={14} />} Remove</Button> : <span className="muted-cell">Manage in Invoices</span>}</td>
            </tr>) : <tr><td colSpan={6}>No open items</td></tr>}</tbody>
          </table>
        </div>
      </section>
      {dialogKind && <ManualReceivableDialog kind={dialogKind} onClose={() => setDialogKind(null)} onSubmit={async (payload) => { await onCreateManualReceivable(payload); setDialogKind(null); }} />}
    </div>
  );
}

function ManualReceivableDialog({
  kind,
  onClose,
  onSubmit
}: {
  kind: "commission" | "receivable";
  onClose: () => void;
  onSubmit: (payload: CreateManualReceivablePayload) => Promise<void>;
}) {
  const [name, setName] = useState(kind === "commission" ? "Sanjin commission" : "");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [dueDate, setDueDate] = useState("");
  const [notes, setNotes] = useState(kind === "commission" ? "Commission" : "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ name, amount: Number(amount), currency, dueDate: dueDate || undefined, notes: notes || undefined });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Open item could not be saved");
      setSubmitting(false);
    }
  }

  return createPortal(<div className="modal-backdrop" role="presentation"><form className="modal payment-modal" role="dialog" aria-modal="true" aria-labelledby="manual-receivable-title" onSubmit={submit}>
    <div className="modal-header"><div><p className="eyebrow">Cash Flow</p><h2 id="manual-receivable-title">{kind === "commission" ? "Add Sanjin commission" : "Add receivable without invoice"}</h2></div><Button className="icon-button" type="button" aria-label="Close" onClick={onClose}><X size={18} /></Button></div>
    {error && <div className="inline-error">{error}</div>}
    <label>Name<Input value={name} onChange={(event) => setName(event.target.value)} /></label>
    <div className="form-grid"><label>Amount<Input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label><label>Currency<Input maxLength={12} value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} /></label></div>
    <label>Expected payment date<Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
    <label>Note<Input value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
    <div className="modal-actions"><Button className="secondary-button" type="button" onClick={onClose} disabled={submitting}>Cancel</Button><Button className="primary-button" type="submit" disabled={submitting || !name.trim() || Number(amount) <= 0 || !currency.trim()}>{submitting ? <Loader2 className="spin" size={15} /> : <Save size={15} />} Save</Button></div>
  </form></div>, document.body);
}
