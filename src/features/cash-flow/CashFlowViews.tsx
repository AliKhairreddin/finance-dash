import { openItemDeletionBlockReason } from "../../../shared/manualReceivables";
import { Checkbox } from "@/components/ui/checkbox";
import { documentTransactionLink } from "../../../shared/financialDocuments";
import {
  Download,
  Edit3,
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
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { InfoPopover } from "@/components/ui/finance-visuals";
import { Textarea } from "@/components/ui/textarea";
import { evaluateCashFlowAmount, type CashFlowSectionKey } from "../../../shared/cashFlow";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { compareTableValues, SortableTableHead, type TableSortDirection } from "@/components/ui/sortable-table-head";
import { ToolbarSearchField } from "@/components/ui/filter-toolbar";
import { InvoiceEditorDialog } from "@/features/income/IncomeViews";
import { downloadInvoicePdfFile } from "@/lib/invoice-download";
import { useUrlState } from "@/lib/url-state";
import { cashFlowSnapshotTotals as snapshotTotals, cashFlowUsdTotal as usdTotal } from "../../../shared/cashFlowReport";
import { downloadCashFlowPng } from "./exportCashFlowPng";
import { SharePartnerUpdate } from "../partner-updates/SharePartnerUpdate";
import { financeOperatingDate } from "../../../shared/operatingDate";
import { invoiceOutstanding, isLiquidAccountBalance } from "../../../shared/income";
import type {
  CashFlowLine,
  CashFlowSnapshot,
  CreateInvoicePayload,
  CreateManualReceivablePayload,
  DashboardSnapshot,
  FxRate,
  Invoice,
  LedgerItem,
  SaveCashFlowSnapshotPayload,
  UpdateInvoicePayload
} from "../../../shared/types";

type CashFlowLineSortKey = "amount" | "currency" | "included" | "name" | "notes" | "dueDate";
type OpenReceivableSortKey = "amount" | "dueDate" | "name" | "source" | "status" | "currency" | "notes";

const apiBase = import.meta.env.VITE_API_BASE || "/api";

const sectionDefinitions: Array<{ key: CashFlowSectionKey; label: string }> = [
  { key: "cashAccounts", label: "Cash in accounts" },
  { key: "receivables", label: "Receivables" },
  { key: "openBalances", label: "Open balances" },
  { key: "payables", label: "Payables" },
  { key: "investments", label: "Investments" }
];

function money(value: number, currency = "USD"): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(value);
}

function invalidCashFlowLine(item: CashFlowLine): boolean {
  if (!Number.isFinite(item.amount)) return true;
  if (item.formula === undefined) return false;
  try { evaluateCashFlowAmount(item.formula); return false; } catch { return true; }
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
    notes: snapshot.notes,
    profitGrowthPercent: snapshot.profitGrowthPercent
  };
}

function EditableCashFlowSection({
  sectionKey,
  title,
  lines,
  rates,
  saving,
  onSave,
  onLive,
  onChange
}: {
  sectionKey: CashFlowSectionKey;
  title: string;
  lines: CashFlowLine[];
  rates: FxRate[];
  saving: boolean;
  onSave: () => void;
  onLive: () => void;
  onChange: (lines: CashFlowLine[]) => void;
}) {
  const [sortKey, setSortKey] = useUrlState<CashFlowLineSortKey>(`cashFlow${sectionKey}Sort`, "name", {
    allowedValues: ["amount", "currency", "included", "name", "notes", "dueDate"]
  });
  const [sortDirection, setSortDirection] = useUrlState<TableSortDirection>(`cashFlow${sectionKey}Order`, "asc", {
    allowedValues: ["asc", "desc"]
  });
  const [query, setQuery] = useUrlState(`cashFlow${sectionKey}Query`, "");
  const sortValue = (item: CashFlowLine) => sortKey === "included" ? !item.excludedFromTotals : item[sortKey];
  const visibleLines = lines.filter(item => `${item.name} ${item.notes ?? ""} ${item.currency}`.toLowerCase().includes(query.trim().toLowerCase())).sort((left, right) =>
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
        <div><h3>{title}</h3><span>{lines.some(invalidCashFlowLine) ? "—" : money(usdTotal(lines, rates))}</span></div>
        <div className="row-actions">
        <Button className="icon-text-button" type="button" disabled={saving} onClick={onLive}><RefreshCw size={14} /> Live values</Button>
        <Button className="icon-text-button" type="button" disabled={saving || lines.some(invalidCashFlowLine)} onClick={onSave}><Save size={14} /> Save</Button>
        <Button
          className="icon-text-button"
          type="button"
          onClick={() => onChange([...lines, line(`cash-flow-line-${crypto.randomUUID()}`, "", 0, "USD")])}
        >
          <Plus size={14} /> Add row
        </Button>
        </div>
      </div>
      {sectionKey === "openBalances" && <div className="list-toolbar"><ToolbarSearchField ariaLabel="Search open balances" placeholder="Search balances" value={query} onChange={setQuery} /></div>}
      <div className="table-wrap">
        <table className="data-table cash-flow-entry-table">
          <thead><tr>
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="name">Name</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={requestSort} sortKey="amount" description="Enter an amount or arithmetic such as =1000+250-50. The result updates immediately; formulas are saved with the snapshot.">Amount / formula</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="currency">Currency</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="included">Included</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="dueDate">Due</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="notes">Notes</SortableTableHead>
            <th scope="col">Actions</th>
          </tr></thead>
          <tbody>
            {visibleLines.length > 0 ? visibleLines.map((item) => (
              <tr key={item.id}>
                <td><Input aria-label={`${title} name`} value={item.name} onChange={(event) => update(item.id, { name: event.target.value })} /></td>
                <td className="amount"><CashFlowAmountInput item={item} title={title} onChange={(patch) => update(item.id, patch)} /></td>
                <td><Input aria-label={`${item.name || title} currency`} maxLength={12} value={item.currency} onChange={(event) => update(item.id, { currency: event.target.value.toUpperCase() })} /></td>
                <td><input aria-label={`Include ${item.name || "row"} in totals`} checked={!item.excludedFromTotals} className="cash-flow-include-checkbox" type="checkbox" onChange={(event) => update(item.id, { excludedFromTotals: event.target.checked ? undefined : true })} /></td>
                <td><Input aria-label={`${item.name || title} due date`} type="date" value={item.dueDate ?? ""} onChange={(event) => update(item.id, { dueDate: event.target.value || undefined })} /></td>
                <td><Input aria-label={`${item.name || title} notes`} maxLength={256} value={item.notes ?? ""} onChange={(event) => update(item.id, { notes: event.target.value || undefined })} /></td>
                <td><Button className="icon-button destructive-icon-button" type="button" aria-label={`Remove ${item.name || "row"}`} onClick={() => onChange(lines.filter((lineItem) => lineItem.id !== item.id))}><Trash2 size={14} /></Button></td>
              </tr>
            )) : <tr><td colSpan={7}>No rows</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CashFlowAmountInput({ item, title, onChange }: { item: CashFlowLine; title: string; onChange: (patch: Partial<CashFlowLine>) => void }) {
  const [input, setInput] = useState(item.formula ?? String(item.amount));
  useEffect(() => { setInput(item.formula ?? String(item.amount)); }, [item.formula, item.amount]);
  let error: string | null = null;
  try { evaluateCashFlowAmount(input); } catch (caught) { error = caught instanceof Error ? caught.message : "Invalid formula"; }
  return <><Input aria-label={`${item.name || title} amount`} aria-invalid={Boolean(error)} maxLength={257} value={input} onChange={event => {
    const value = event.target.value;
    setInput(value);
    try {
      onChange({ amount: evaluateCashFlowAmount(value), formula: value.trim().startsWith("=") ? value.trim() : undefined });
    } catch {
      onChange({ formula: value });
    }
  }} />{error ? <small className="inline-error" role="alert">{error}</small> : item.formula ? <small>{money(item.amount, item.currency)}</small> : null}</>;
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

export function CashFlowPositionView({
  dashboard,
  canShareUpdates,
  onSave
}: {
  dashboard: DashboardSnapshot;
  canShareUpdates: boolean;
  onSave: (payload: SaveCashFlowSnapshotPayload) => Promise<CashFlowSnapshot>;
}) {
  const [selectedSnapshotId, setSelectedSnapshotId] = useUrlState("cashFlowSnapshot", "live");
  const [draft, setDraft] = useState<SaveCashFlowSnapshotPayload>(() => {
    const selected = dashboard.cashFlowSnapshots.find((item) => item.id === selectedSnapshotId);
    return selected ? snapshotPayload(selected) : liveCashFlowDraft(dashboard);
  });
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const selectedSnapshot = dashboard.cashFlowSnapshots.find((item) => item.id === selectedSnapshotId);

  const loadedSnapshotId = useRef(selectedSnapshotId);
  const dirtySections = useRef(new Set<CashFlowSectionKey>());
  useEffect(() => {
    if (loadedSnapshotId.current !== selectedSnapshotId) {
      loadedSnapshotId.current = selectedSnapshotId;
      dirtySections.current.clear();
      setDraft(selectedSnapshot ? snapshotPayload(selectedSnapshot) : liveCashFlowDraft(dashboard));
    } else if (selectedSnapshotId === "live") {
      const live = liveCashFlowDraft(dashboard);
      setDraft(current => ({ ...current, ...Object.fromEntries(sectionDefinitions
        .filter(section => !dirtySections.current.has(section.key))
        .map(section => [section.key, live[section.key]])) }));
    }
  }, [selectedSnapshotId, dashboard]);

  const preview: CashFlowSnapshot = {
    ...draft,
    id: draft.id ?? "preview",
    createdAt: selectedSnapshot?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  const invalidAmounts = sectionDefinitions.some(section => draft[section.key].some(invalidCashFlowLine));
  const totals = invalidAmounts
    ? { cash: NaN, receivables: NaN, openBalances: NaN, payables: NaN, investments: NaN, approximateCash: NaN, profit: NaN, assets: NaN }
    : snapshotTotals(preview, dashboard.fxRates);

  function setSection(key: CashFlowSectionKey, lines: CashFlowLine[]) {
    dirtySections.current.add(key);
    setDraft((current) => ({ ...current, [key]: lines }));
    setNotice(null);
    setSaveError(null);
  }

  async function save(section?: CashFlowSectionKey) {
    setSaving(true);
    setNotice(null);
    setSaveError(null);
    try {
      const baseline = selectedSnapshot ? snapshotPayload(selectedSnapshot) : liveCashFlowDraft(dashboard);
      const saved = await onSave(section ? { ...baseline, id: draft.id, asOfDate: draft.asOfDate, [section]: draft[section], section } : draft);
      if (section) {
        dirtySections.current.delete(section);
        setDraft(current => ({ ...current, id: saved.id, [section]: saved[section] }));
      } else {
        dirtySections.current.clear();
        setDraft(snapshotPayload(saved));
      }
      loadedSnapshotId.current = saved.id;
      setSelectedSnapshotId(saved.id);
      setNotice(`Saved ${dateLabel(saved.asOfDate)}`);
    } catch (caught) {
      setSaveError(caught instanceof Error ? caught.message : "Cash flow snapshot could not be saved");
    } finally {
      setSaving(false);
    }
  }

  async function exportPng() {
    setExporting(true);
    setExportError(null);
    try {
      await downloadCashFlowPng(preview, dashboard.cashFlowSnapshots, dashboard.fxRates);
    } catch (caught) {
      setExportError(caught instanceof Error ? caught.message : "Cash flow image could not be exported");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="cash-flow-page-stack" aria-busy={saving}>
      <section className="cash-flow-topbar">
        <div><p className="eyebrow">Cash Flow</p><h1>Position</h1></div>
        <div className="cash-flow-topbar-actions">
          <NativeSelect disabled={saving} aria-label="Cash flow snapshot" value={selectedSnapshotId} onValueChange={setSelectedSnapshotId}>
            <NativeSelectOption value="live">New from live data</NativeSelectOption>
            {dashboard.cashFlowSnapshots.map((snapshot) => <NativeSelectOption key={snapshot.id} value={snapshot.id}>{dateLabel(snapshot.asOfDate)}</NativeSelectOption>)}
          </NativeSelect>
          <Input disabled={saving} aria-label="Cash flow date" type="date" value={draft.asOfDate} max={financeOperatingDate()} onChange={(event) => setDraft((current) => ({ ...current, asOfDate: event.target.value }))} />
          <Button className="icon-text-button" type="button" disabled={saving} onClick={() => { dirtySections.current.clear(); setSelectedSnapshotId("live"); setDraft(liveCashFlowDraft(dashboard)); }}><RefreshCw size={15} /> Use live values</Button>
          <Button className="icon-text-button" type="button" title="Download portrait PNG" disabled={exporting || !draft.asOfDate || sectionDefinitions.some(section => draft[section.key].some(invalidCashFlowLine))} onClick={() => void exportPng()}>{exporting ? <Loader2 className="spin" size={15} /> : <Download size={15} />} Export PNG</Button>
          {canShareUpdates && <SharePartnerUpdate />}
          <Button className="primary-button" type="button" disabled={saving || !draft.asOfDate || sectionDefinitions.some(section => draft[section.key].some(invalidCashFlowLine))} onClick={() => void save()}>{saving ? <Loader2 className="spin" size={15} /> : <Save size={15} />} Save all</Button>
        </div>
      </section>
      {notice && <div className="cash-flow-save-notice" role="status">{notice}</div>}
      {saveError && <div className="inline-error" role="alert">{saveError}</div>}
      {exportError && <div className="inline-error" role="alert">{exportError}</div>}
      <section className="cash-flow-metric-grid" aria-label="Cash flow totals">
        <CashFlowMetric label="Cash" value={totals.cash} tone="cash" />
        <CashFlowMetric label="Receivables" value={totals.receivables} tone="receivable" />
        <CashFlowMetric label="Open balances" value={totals.openBalances} tone="open-balance" />
        <CashFlowMetric label="Approximate cash" value={totals.approximateCash} tone="approximate" />
        <CashFlowMetric label="Payables" value={totals.payables} tone="payable" />
        <CashFlowMetric label="Net operating position" value={totals.profit} tone="profit" />
        <CashFlowMetric label="Investments" value={totals.investments} tone="investment" />
        <CashFlowMetric label="Total assets" value={totals.assets} tone="assets" />
      </section>
      <section className="panel cash-flow-snapshot-details">
        <div className="panel-header compact-panel-header"><div><p className="eyebrow">Snapshot</p><h2>Details</h2></div></div>
        <label className="cash-flow-report-note">Report note <InfoPopover label="Report notes">Notes are saved with the dated snapshot and included in exported reports.</InfoPopover><Textarea disabled={saving} aria-label="Cash flow report note" maxLength={1000} value={draft.notes ?? ""} onChange={event => setDraft(current => ({ ...current, notes: event.target.value || undefined }))} /></label>
        <div className="cash-flow-growth-inputs">
          <label>Cash growth (%)<Input disabled={saving} aria-label="Cash growth percent" type="number" step="0.01" value={draft.cashGrowthPercent ?? ""} onChange={(event) => setDraft((current) => ({ ...current, cashGrowthPercent: event.target.value === "" ? undefined : Number(event.target.value) }))} /></label>
          <label>Spend growth (%)<Input disabled={saving} aria-label="Spend growth percent" type="number" step="0.01" value={draft.spendGrowthPercent ?? ""} onChange={(event) => setDraft((current) => ({ ...current, spendGrowthPercent: event.target.value === "" ? undefined : Number(event.target.value) }))} /></label>
          <label>Profit growth (%)<Input disabled={saving} aria-label="Profit growth percent" type="number" step="0.01" value={draft.profitGrowthPercent ?? ""} onChange={(event) => setDraft((current) => ({ ...current, profitGrowthPercent: event.target.value === "" ? undefined : Number(event.target.value) }))} /></label>
        </div>
      </section>
      <fieldset disabled={saving} className="cash-flow-editor-fieldset">
      <div className="cash-flow-editor-grid">
        {sectionDefinitions.map((section) => <EditableCashFlowSection key={section.key} sectionKey={section.key} title={section.label} lines={draft[section.key]} rates={dashboard.fxRates} saving={saving} onSave={() => void save(section.key)} onLive={() => setSection(section.key, liveCashFlowDraft(dashboard)[section.key])} onChange={(lines) => setSection(section.key, lines)} />)}
      </div>
      </fieldset>
      {!invalidAmounts && <section className="cash-flow-chart-grid">
        <article className="panel"><div className="panel-header"><div><p className="eyebrow">Trend</p><h2>Position history</h2></div><TrendingUp size={19} /></div><TrendChart snapshots={[...dashboard.cashFlowSnapshots.filter((item) => item.id !== preview.id), preview]} rates={dashboard.fxRates} /></article>
        <article className="panel"><div className="panel-header"><div><p className="eyebrow">Mix</p><h2>Current composition</h2></div><WalletCards size={19} /></div><CompositionChart snapshot={preview} rates={dashboard.fxRates} /></article>
      </section>}
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
  canShareUpdates,
  onCreateManualReceivable,
  onUpdateManualReceivable,
  onDeleteOpenItems,
  onPrepareInvoiceEdit,
  onUpdateInvoice
}: {
  dashboard: DashboardSnapshot;
  canShareUpdates: boolean;
  onCreateManualReceivable: (payload: CreateManualReceivablePayload) => Promise<void>;
  onUpdateManualReceivable: (id: string, payload: CreateManualReceivablePayload) => Promise<void>;
  onDeleteOpenItems: (ids: string[]) => Promise<void>;
  onPrepareInvoiceEdit: (invoiceId: string) => Promise<CreateInvoicePayload>;
  onUpdateInvoice: (invoiceId: string, payload: UpdateInvoicePayload) => Promise<Invoice>;
}) {
  const [query, setQuery] = useUrlState("cashFlowOpenQuery", "");
  const [matchFilter, setMatchFilter] = useUrlState("cashFlowOpenMatch", "all", { allowedValues: ["all", "matched", "unmatched"] });
  const [sortKey, setSortKey] = useUrlState<OpenReceivableSortKey>("cashFlowOpenSort", "dueDate", {
    allowedValues: ["amount", "dueDate", "name", "source", "status", "currency", "notes"]
  });
  const [sortDirection, setSortDirection] = useUrlState<TableSortDirection>("cashFlowOpenOrder", "asc", {
    allowedValues: ["asc", "desc"]
  });
  const [dialogKind, setDialogKind] = useState<"commission" | "receivable" | null>(null);
  const [selectedIds, setSelectedIds] = useState(new Set<string>());
  const [deleting, setDeleting] = useState(false);
  const [deleteRows, setDeleteRows] = useState<OpenReceivableRow[]>([]);
  const [editingManual, setEditingManual] = useState<LedgerItem | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [editingInvoice, setEditingInvoice] = useState<Invoice | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const rows = useMemo<OpenReceivableRow[]>(() => [
    ...dashboard.invoices.flatMap((invoice) => {
      const lineItem = invoiceCashFlowLine(invoice, dashboard);
      if (!lineItem) return [];
      return [{
        id: invoice.id,
        name: lineItem.name,
        source: invoice.invoiceNumber || "Dashboard invoice",
        status: `${invoice.status === "draft" ? "Draft" : "Open"}${invoice.transactionId ? " · Matched" : ""}`,
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
    .filter(row => matchFilter === "all" || (matchFilter === "matched" ? Boolean(row.invoice?.transactionId) : !row.invoice?.transactionId))
    .filter((row) => `${row.name} ${row.source} ${row.status} ${row.currency} ${row.notes ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((left, right) => compareTableValues(left[sortKey], right[sortKey], sortDirection) || left.id.localeCompare(right.id));
  const total = usdTotal(visibleRows.map((row) => line(row.id, row.name, row.amount, row.currency)), dashboard.fxRates);

  const selectedRows = visibleRows.filter(row => selectedIds.has(row.id));
  const deletionReason = selectedRows.map(row => row.invoice ? openItemDeletionBlockReason(row.invoice, dashboard.paymentAllocations) : undefined).find(Boolean);

  function exportRows() {
    const exported = selectedRows.length ? selectedRows : visibleRows;
    const cell = (value: string | number | undefined) => typeof value === "number" ? String(value) : `"${(value ?? "").replace(/^[=+\-@\t\r]/, "'$&").replaceAll('"', '""')}"`;
    const csv = [["Company / item", "Source", "Status", "Due date", "Amount", "Currency", "Notes"], ...exported.map(row => [row.name, row.source, row.status, row.dueDate, row.amount, row.currency, row.notes])].map(row => row.map(cell).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = `open-invoices-${financeOperatingDate()}.csv`;
    document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function confirmDelete() {
    setDeleting(true); setEditError(null);
    try {
      await onDeleteOpenItems(deleteRows.map(row => row.id));
      setSelectedIds(new Set()); setDeleteRows([]);
    } catch (caught) { setEditError(caught instanceof Error ? caught.message : "Open items could not be deleted"); }
    finally { setDeleting(false); }
  }

  function requestSort(next: OpenReceivableSortKey) {
    if (next === sortKey) setSortDirection((current) => current === "asc" ? "desc" : "asc");
    else {
      setSortKey(next);
      setSortDirection(next === "amount" ? "desc" : "asc");
    }
  }

  async function editInvoice(invoice: Invoice) {
    setEditingId(invoice.id);
    setEditError(null);
    try {
      if (invoice.status === "open" && invoice.origin === "merit") {
        const details = await onPrepareInvoiceEdit(invoice.id);
        setEditingInvoice({
          ...invoice,
          amount: details.amount,
          description: details.description,
          periodStart: details.periodStart,
          periodEnd: details.periodEnd,
          taxId: details.taxId
        });
      } else {
        setEditingInvoice(invoice);
      }
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Invoice details could not be loaded");
    } finally {
      setEditingId(null);
    }
  }

  async function downloadInvoice(invoice: Invoice) {
    setDownloadingId(invoice.id);
    setEditError(null);
    try {
      await downloadInvoicePdfFile(invoice, apiBase);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Invoice PDF could not be downloaded");
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <div className="cash-flow-page-stack">
      <section className="cash-flow-topbar">
        <div><p className="eyebrow">Cash Flow</p><h1>Open invoices</h1></div>
        <div className="cash-flow-topbar-actions">
          <Button className="icon-text-button" type="button" disabled={!visibleRows.length} onClick={exportRows}><Download size={15} /> {selectedRows.length ? `Export selected (${selectedRows.length})` : "Export all"}</Button>
          {canShareUpdates && <SharePartnerUpdate />}
          <Button className="icon-text-button destructive-icon-button" type="button" disabled={!selectedRows.length || Boolean(deletionReason) || selectedRows.length > 200} onClick={() => setDeleteRows(selectedRows)}><Trash2 size={15} /> Delete selected{selectedRows.length ? ` (${selectedRows.length})` : ""}</Button>
          {deletionReason && <InfoPopover label="Why these items cannot be deleted">{deletionReason}</InfoPopover>}

          <Button className="icon-text-button" type="button" onClick={() => setDialogKind("receivable")}><Plus size={15} /> Add receivable</Button>
          <Button className="primary-button" type="button" onClick={() => setDialogKind("commission")}><Plus size={15} /> Add Sanjin commission</Button>
        </div>
      </section>
      <section className="cash-flow-open-summary">
        <article><FileText size={19} /><span>Open items</span><strong>{visibleRows.length}</strong></article>
        <article><WalletCards size={19} /><span>Approximate total</span><strong>{money(total)}</strong></article>
      </section>
      <section className="panel">
        <div className="list-toolbar"><ToolbarSearchField ariaLabel="Search open invoices and receivables" placeholder="Search open items" value={query} onChange={setQuery} /><NativeSelect aria-label="Filter open invoices by bank match" value={matchFilter} onValueChange={value => setMatchFilter(value as typeof matchFilter)}><NativeSelectOption value="all">All bank matches</NativeSelectOption><NativeSelectOption value="matched">Matched</NativeSelectOption><NativeSelectOption value="unmatched">Unmatched</NativeSelectOption></NativeSelect></div>
        {editError && <div className="inline-error" role="alert">{editError}</div>}
        <div className="table-wrap">
          <table className="data-table cash-flow-open-table">
            <thead><tr>
              <th scope="col"><Checkbox aria-label="Select all visible open items" checked={visibleRows.length > 0 && selectedRows.length === visibleRows.length} indeterminate={selectedRows.length > 0 && selectedRows.length < visibleRows.length} onCheckedChange={checked => setSelectedIds(checked ? new Set(visibleRows.map(row => row.id)) : new Set())} /></th>
              <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="name">Company / item</SortableTableHead>
              <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="source">Source</SortableTableHead>
              <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="status">Status / match</SortableTableHead>
              <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="dueDate">Expected / due</SortableTableHead>
              <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={requestSort} sortKey="amount">Amount</SortableTableHead>
              <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="currency">Currency</SortableTableHead>
              <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="notes">Notes</SortableTableHead>
              <th scope="col">Actions</th>
            </tr></thead>
            <tbody>{visibleRows.length > 0 ? visibleRows.map((row) => <tr key={row.id}>
              <td><Checkbox aria-label={`Select ${row.name} ${row.source}`} checked={selectedIds.has(row.id)} onCheckedChange={checked => setSelectedIds(current => { const next = new Set(current); if (checked) next.add(row.id); else next.delete(row.id); return next; })} /></td>
              <td><strong>{row.name}</strong></td>
              <td>{row.source}</td>
              <td><span className={`status-pill invoice-status-${row.invoice?.status ?? "open"}`}>{row.status}</span>{row.invoice?.transactionId && <a href={documentTransactionLink(row.invoice.transactionId)}>View transaction</a>}</td>
              <td>{dateLabel(row.dueDate)}</td>
              <td className="amount"><strong>{money(row.amount, row.currency)}</strong></td>
              <td>{row.currency}</td>
              <td>{row.notes || "—"}</td>
              <td>{row.manual ? <div className="row-actions"><Button className="icon-text-button" type="button" onClick={() => setEditingManual(row.manual!)}><Edit3 size={14} /> Edit</Button><Button className="icon-text-button destructive-icon-button" type="button" onClick={() => setDeleteRows([row])}><Trash2 size={14} /> Remove</Button></div> : row.invoice ? <div className="row-actions"><Button className="icon-text-button" type="button" disabled={editingId !== null} onClick={() => void editInvoice(row.invoice!)}>{editingId === row.id ? <Loader2 className="spin" size={14} /> : <Edit3 size={14} />} Edit</Button>{row.invoice.externalId && <Button className="icon-text-button" type="button" disabled={downloadingId !== null} onClick={() => void downloadInvoice(row.invoice!)}>{downloadingId === row.id ? <Loader2 className="spin" size={14} /> : <Download size={14} />} PDF</Button>}</div> : null}</td>
            </tr>) : <tr><td colSpan={9}>No open items</td></tr>}</tbody>
          </table>
        </div>
      </section>
      {deleteRows.length > 0 && createPortal(<div className="modal-backdrop"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-open-items-title">
        <h2 id="delete-open-items-title">Delete {deleteRows.length} open {deleteRows.length === 1 ? "item" : "items"}?</h2>
        <p>{deleteRows.map(row => row.name).slice(0, 5).join(", ")}{deleteRows.length > 5 ? ` and ${deleteRows.length - 5} more` : ""}</p>
        {editError && <div className="inline-error" role="alert">{editError}</div>}
        <div className="modal-actions"><Button type="button" disabled={deleting} onClick={() => setDeleteRows([])}>Cancel</Button><Button type="button" variant="destructive" disabled={deleting} onClick={() => void confirmDelete()}>{deleting ? "Deleting…" : "Delete"}</Button></div>
      </div></div>, document.body)}
      {editingManual && <ManualReceivableDialog kind="receivable" item={editingManual} onClose={() => setEditingManual(null)} onSubmit={async payload => { await onUpdateManualReceivable(editingManual.id, payload); setEditingManual(null); }} />}
      {dialogKind && <ManualReceivableDialog kind={dialogKind} onClose={() => setDialogKind(null)} onSubmit={async (payload) => { await onCreateManualReceivable(payload); setDialogKind(null); }} />}
      {editingInvoice && <InvoiceEditorDialog
        dashboard={dashboard}
        invoice={editingInvoice}
        onClose={() => setEditingInvoice(null)}
        onSubmit={async (payload) => {
          const updated = await onUpdateInvoice(editingInvoice.id, payload as UpdateInvoicePayload);
          setEditingInvoice(null);
          return updated;
        }}
      />}
    </div>
  );
}

function ManualReceivableDialog({
  kind,
  item,
  onClose,
  onSubmit
}: {
  kind: "commission" | "receivable";
  item?: LedgerItem;
  onClose: () => void;
  onSubmit: (payload: CreateManualReceivablePayload) => Promise<void>;
}) {
  const [name, setName] = useState(item?.name ?? (kind === "commission" ? "Sanjin commission" : ""));
  const [amount, setAmount] = useState(item ? String(item.balance) : "");
  const [currency, setCurrency] = useState(item?.currency ?? "USD");
  const [dueDate, setDueDate] = useState(item?.dueDate ?? "");
  const [notes, setNotes] = useState(item?.notes ?? (kind === "commission" ? "Commission" : ""));
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
    <div className="modal-header"><div><p className="eyebrow">Cash Flow</p><h2 id="manual-receivable-title">{item ? "Edit receivable" : kind === "commission" ? "Add Sanjin commission" : "Add receivable without invoice"}</h2></div><Button className="icon-button" type="button" aria-label="Close" onClick={onClose}><X size={18} /></Button></div>
    {error && <div className="inline-error">{error}</div>}
    <label>Name<Input value={name} onChange={(event) => setName(event.target.value)} /></label>
    <div className="form-grid"><label>Amount<Input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label><label>Currency<Input maxLength={12} value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} /></label></div>
    <label>Expected payment date<Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
    <label>Note<Input value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
    <div className="modal-actions"><Button className="secondary-button" type="button" onClick={onClose} disabled={submitting}>Cancel</Button><Button className="primary-button" type="submit" disabled={submitting || !name.trim() || Number(amount) <= 0 || !currency.trim()}>{submitting ? <Loader2 className="spin" size={15} /> : <Save size={15} />} Save</Button></div>
  </form></div>, document.body);
}
