import {
  CalendarClock,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  Edit3,
  FilePlus2,
  Filter,
  Loader2,
  Mail,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  X
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import type {
  BillingCadence,
  CreateInvoicePayload,
  CurrencyTotals,
  DashboardSnapshot,
  Invoice,
  MeritSendMode,
  PaymentSource,
  Provider,
  RecordInvoicePaymentPayload,
  RevenueAccrual,
  RevenuePeriodPreset,
  RevenueRun,
  SyncRevenuePayload,
  UpdateInvoicePayload
} from "../../../shared/types";
import { isClosedBillingPeriod } from "../../../shared/income";

type InvoiceTab = "all" | "open" | "paid";
type InvoiceStatusFilter = "all" | "draft" | "open" | "paid" | "accruing";

const paymentSourceOptions: Array<{ value: PaymentSource; label: string }> = [
  { value: "wise", label: "Wise" },
  { value: "revolut", label: "Revolut" },
  { value: "slash", label: "Slash" },
  { value: "amex", label: "Amex" },
  { value: "cash", label: "Cash" },
  { value: "kraken", label: "Kraken" },
  { value: "trust", label: "Trust Wallet" },
  { value: "other", label: "Other" }
];

function money(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(value);
}

function dateLabel(value: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function dateTimeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Beirut",
    timeZoneName: "short"
  }).format(date);
}

function createdAtLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Asia/Beirut"
  }).format(date);
}

function createdDateKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Beirut"
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function toDateInput(value?: string): string {
  if (!value) return new Date().toISOString().slice(0, 10);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : date.toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function addTotal(totals: CurrencyTotals, currency: string, amount: number): void {
  totals[currency] = (totals[currency] ?? 0) + amount;
}

function formatTotals(totals: CurrencyTotals): string {
  const rows = Object.entries(totals).sort(([left], [right]) => left.localeCompare(right));
  return rows.length > 0 ? rows.map(([currency, amount]) => money(amount, currency)).join(" · ") : "—";
}

function cadenceLabel(cadence?: BillingCadence): string {
  if (!cadence) return "Manual";
  return cadence === "weekly" ? "Weekly" : "Monthly";
}

function periodLabel(start?: string, end?: string): string {
  if (!start && !end) return "No service period";
  if (start && end) return `${dateLabel(start)} – ${dateLabel(end)}`;
  return dateLabel(start ?? end ?? "");
}

function latestRevenueActivity(dashboard: DashboardSnapshot): string | undefined {
  const candidates = [
    ...dashboard.automationRuns.map((run) => run.completedAt ?? run.startedAt),
    ...dashboard.revenueRuns.map((run) => run.createdAt),
    ...dashboard.revenueAccruals.map((accrual) => accrual.updatedAt)
  ].filter(Boolean);
  return candidates.sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0];
}

function revenuePartnerForInvoice(invoice: Invoice, dashboard: DashboardSnapshot) {
  if (invoice.billingRuleId) {
    const direct = dashboard.revenuePartners.find((partner) => partner.id === invoice.billingRuleId);
    if (direct) return direct;
  }
  if (invoice.providerId) {
    return dashboard.revenuePartners.find((partner) => partner.providerId === invoice.providerId);
  }
  return undefined;
}

function invoiceIsSendReady(invoice: Invoice, providersById: Map<string, Provider>): boolean {
  const provider = invoice.providerId ? providersById.get(invoice.providerId) : undefined;
  return (
    invoice.documentType === "sales_invoice" &&
    invoice.status === "draft" &&
    invoice.meritDeliveryStatus === "not-sent" &&
    !invoice.externalId &&
    !invoice.meritCreationReservedAt &&
    !invoice.sendError &&
    Boolean(invoice.taxId) &&
    (invoice.origin !== "revenue" || Boolean(provider?.meritCustomerId))
  );
}

function invoiceCanBeDelivered(invoice: Invoice): boolean {
  return (
    invoice.documentType === "sales_invoice" &&
    invoice.status === "open" &&
    Boolean(invoice.externalId) &&
    (invoice.meritDeliveryStatus === "saved" || invoice.meritDeliveryStatus === "delivery-failed")
  );
}

function invoiceCanBeSelected(invoice: Invoice, providersById: Map<string, Provider>): boolean {
  return invoiceIsSendReady(invoice, providersById) || invoiceCanBeDelivered(invoice);
}

export function RevenueView({
  dashboard,
  onSyncRevenue,
  onDraftRevenueRun,
  onOpenInvoices
}: {
  dashboard: DashboardSnapshot;
  onSyncRevenue: (payload: SyncRevenuePayload) => Promise<RevenueRun[]>;
  onDraftRevenueRun: (run: RevenueRun) => Promise<void>;
  onOpenInvoices: () => void;
}) {
  const [periodPreset, setPeriodPreset] = useState<RevenuePeriodPreset>("last-week");
  const [partnerId, setPartnerId] = useState("all");
  const [currency, setCurrency] = useState("all");
  const [cadence, setCadence] = useState<"all" | BillingCadence>("all");
  const [status, setStatus] = useState("all");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [draftingRunId, setDraftingRunId] = useState<string | null>(null);
  const [pullResults, setPullResults] = useState<RevenueRun[]>([]);
  const [error, setError] = useState<string | null>(null);

  const partnersById = useMemo(
    () => new Map(dashboard.revenuePartners.map((partner) => [partner.id, partner])),
    [dashboard.revenuePartners]
  );
  const teamsById = useMemo(() => new Map(dashboard.teams.map((team) => [team.id, team])), [dashboard.teams]);
  const currencies = useMemo(
    () => [...new Set([...pullResults.map((run) => run.currency), ...dashboard.revenueRuns.map((run) => run.currency), ...dashboard.revenueAccruals.map((row) => row.currency)])].sort(),
    [dashboard.revenueAccruals, dashboard.revenueRuns, pullResults]
  );
  const savedRunIds = new Set(dashboard.revenueRuns.map((run) => run.id));
  const displayedRuns = [
    ...pullResults.filter((run) => !savedRunIds.has(run.id)),
    ...dashboard.revenueRuns
  ];
  const visibleRuns = displayedRuns.filter((run) => {
    const partner = partnersById.get(run.partnerId);
    return (
      (partnerId === "all" || run.partnerId === partnerId) &&
      (currency === "all" || run.currency === currency) &&
      (cadence === "all" || partner?.billingCadence === cadence) &&
      (status === "all" || run.status === status)
    );
  });
  const visibleAccruals = dashboard.revenueAccruals.filter((accrual) => {
    return (
      accrual.status === "accruing" &&
      (partnerId === "all" || accrual.partnerId === partnerId) &&
      (currency === "all" || accrual.currency === currency) &&
      (cadence === "all" || accrual.billingCadence === cadence) &&
      (status === "all" || status === "accruing")
    );
  });
  const totalRevenue: CurrencyTotals = {};
  const draftedRevenue: CurrencyTotals = {};
  const accruingRevenue: CurrencyTotals = {};
  for (const run of visibleRuns) {
    if (run.status !== "failed" && run.status !== "skipped") addTotal(totalRevenue, run.currency, run.revenue);
    if (run.status === "drafted") addTotal(draftedRevenue, run.currency, run.revenue);
  }
  for (const row of visibleAccruals) addTotal(accruingRevenue, row.currency, row.amount);

  const latestActivity = latestRevenueActivity(dashboard);
  const lastAutomation = dashboard.automationRuns
    .slice()
    .sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime())[0];

  async function handlePull(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const runs = await onSyncRevenue({
        partnerId: partnerId === "all" ? undefined : partnerId,
        periodPreset,
        periodStart: periodPreset === "custom" ? periodStart : undefined,
        periodEnd: periodPreset === "custom" ? periodEnd : undefined
      });
      setPullResults(runs);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Revenue could not be pulled");
    } finally {
      setBusy(false);
    }
  }

  async function prepareDraft(run: RevenueRun) {
    setDraftingRunId(run.id);
    setError(null);
    try {
      await onDraftRevenueRun(run);
      setPullResults((results) => results.filter((item) => item.id !== run.id));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Revenue draft could not be prepared");
    } finally {
      setDraftingRunId(null);
    }
  }

  return (
    <div className="income-page-stack">
      <section className="income-schedule-strip" aria-label="Revenue automation schedule">
        <div className="schedule-icon"><CalendarClock size={20} /></div>
        <div className="schedule-primary">
          <span className="eyebrow">Weekly automation</span>
          <strong>Every Monday at 09:00 · Asia/Beirut</strong>
          <small>Pulls the prior Monday–Sunday and refreshes current-period previews for weekly and monthly rules.</small>
        </div>
        <div className="schedule-meta">
          <span>Last activity</span>
          <strong>{latestActivity ? dateTimeLabel(latestActivity) : "No activity yet"}</strong>
          {lastAutomation && <small className={`automation-state ${lastAutomation.status}`}>{lastAutomation.status}</small>}
        </div>
        <Button className="secondary-button" type="button" onClick={onOpenInvoices}>
          View invoices <ChevronRight size={15} />
        </Button>
      </section>

      <section className="panel">
        <div className="panel-header income-panel-header">
          <div>
            <p className="eyebrow">Revenue tracking</p>
            <h2>Earned income, draft readiness, and current-period accruals</h2>
          </div>
          <span className="total-pill">{dashboard.revenuePartners.filter((partner) => partner.enabled).length} active rules</span>
        </div>

        <form className="income-filter-bar revenue-pull-bar" onSubmit={handlePull}>
          <label>
            Company / rule
            <NativeSelect value={partnerId} onChange={(event) => setPartnerId(event.target.value)}>
              <NativeSelectOption value="all">All revenue rules</NativeSelectOption>
              {dashboard.revenuePartners.map((partner) => (
                <NativeSelectOption key={partner.id} value={partner.id}>
                  {partner.name} · {partner.teamId ? teamsById.get(partner.teamId)?.name ?? "Unknown team" : "Company-level"} · {cadenceLabel(partner.billingCadence)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label>
            Currency
            <NativeSelect value={currency} onChange={(event) => setCurrency(event.target.value)}>
              <NativeSelectOption value="all">All currencies</NativeSelectOption>
              {currencies.map((item) => <NativeSelectOption key={item} value={item}>{item}</NativeSelectOption>)}
            </NativeSelect>
          </label>
          <label>
            Cadence
            <NativeSelect value={cadence} onChange={(event) => setCadence(event.target.value as "all" | BillingCadence)}>
              <NativeSelectOption value="all">All cadences</NativeSelectOption>
              <NativeSelectOption value="weekly">Weekly</NativeSelectOption>
              <NativeSelectOption value="monthly">Monthly</NativeSelectOption>
            </NativeSelect>
          </label>
          <label>
            Status
            <NativeSelect value={status} onChange={(event) => setStatus(event.target.value)}>
              <NativeSelectOption value="all">All statuses</NativeSelectOption>
              <NativeSelectOption value="pulled">Pulled</NativeSelectOption>
              <NativeSelectOption value="drafted">Drafted</NativeSelectOption>
              <NativeSelectOption value="invoiced">Invoiced</NativeSelectOption>
              <NativeSelectOption value="accruing">Accruing</NativeSelectOption>
              <NativeSelectOption value="failed">Failed</NativeSelectOption>
            </NativeSelect>
          </label>
          <label>
            Pull period
            <NativeSelect value={periodPreset} onChange={(event) => setPeriodPreset(event.target.value as RevenuePeriodPreset)}>
              <NativeSelectOption value="last-week">Last week</NativeSelectOption>
              <NativeSelectOption value="last-7-days">Last 7 days</NativeSelectOption>
              <NativeSelectOption value="this-week">This week to date</NativeSelectOption>
              <NativeSelectOption value="this-month">This month to date</NativeSelectOption>
              <NativeSelectOption value="custom">Custom</NativeSelectOption>
            </NativeSelect>
          </label>
          {periodPreset === "custom" && (
            <>
              <label>Start<Input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} /></label>
              <label>End<Input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} /></label>
            </>
          )}
          <Button className="primary-button income-pull-button" type="submit" disabled={busy || (periodPreset === "custom" && (!periodStart || !periodEnd))}>
            {busy ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />} Pull now
          </Button>
        </form>

        {error && <div className="inline-error">{error}</div>}

        <div className="income-summary-grid">
          <IncomeSummary label="Revenue shown" value={formatTotals(totalRevenue)} detail={`${visibleRuns.length} saved or current result rows`} />
          <IncomeSummary label="Drafts prepared" value={formatTotals(draftedRevenue)} detail="Ready for invoice review" tone="draft" />
          <IncomeSummary label="Accruing now" value={formatTotals(accruingRevenue)} detail={`${visibleAccruals.length} current-period invoice previews`} tone="accruing" />
          <IncomeSummary label="Automation" value={lastAutomation?.status ?? "Scheduled"} detail="Monday 09:00 Beirut" tone={lastAutomation?.status === "failed" ? "warning" : ""} />
        </div>

        <div className="table-section-heading">
          <div><h3>Revenue activity</h3><p>Pull results stay temporary until you prepare a draft invoice.</p></div>
          <Button className="icon-text-button" type="button" onClick={onOpenInvoices}><FilePlus2 size={15} /> Invoices</Button>
        </div>
        <div className="table-wrap">
          <table className="data-table revenue-table modern-income-table">
            <thead><tr><th>Company</th><th>Period</th><th>Cadence</th><th>Activity</th><th>Amount</th><th>Status</th><th>Invoice</th></tr></thead>
            <tbody>
              {visibleRuns.length > 0 ? visibleRuns.map((run) => {
                const partner = partnersById.get(run.partnerId);
                const canPrepareDraft = Boolean(
                  partner &&
                  run.status === "pulled" &&
                  run.revenue > 0 &&
                  isClosedBillingPeriod(partner, run)
                );
                return (
                  <tr key={`${run.id}-${run.createdAt}`}>
                    <td className="counterparty-cell"><strong>{run.partnerName}</strong><small>{run.revenueCategory || "Revenue"}</small></td>
                    <td>{periodLabel(run.periodStart, run.periodEnd)}</td>
                    <td><span className="cadence-badge">{cadenceLabel(partner?.billingCadence)}</span></td>
                    <td><span>{run.conversions ?? 0} conversions</span><small>{dateTimeLabel(run.createdAt)}</small></td>
                    <td className="amount">{run.status === "failed" ? "—" : money(run.revenue, run.currency)}</td>
                    <td><span className={`status-pill invoice-status-${run.status}`}>{run.status}</span>{run.error && <small>{run.error}</small>}</td>
                    <td>{run.invoiceId
                      ? <Button className="text-link-button" type="button" onClick={onOpenInvoices}>{run.externalInvoiceId ?? "View draft"}</Button>
                      : canPrepareDraft
                        ? <Button className="icon-text-button" type="button" disabled={draftingRunId !== null} onClick={() => void prepareDraft(run)}>{draftingRunId === run.id ? <Loader2 className="spin" size={14} /> : <FilePlus2 size={14} />} Prepare draft</Button>
                        : <span className="muted-cell">{run.status === "pulled" && run.revenue > 0 ? "Period still open" : "Not drafted"}</span>}</td>
                  </tr>
                );
              }) : <tr><td colSpan={7}>No revenue activity matches these filters</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel accrual-panel">
        <div className="panel-header compact">
          <div><p className="eyebrow">Open-income preview</p><h2>Invoices building now</h2></div>
          <span className="total-pill">{visibleAccruals.length} accruing</span>
        </div>
        <div className="accrual-explainer"><Sparkles size={17} /><span>Weekly and monthly rows are maintained by Monday automation. Manual pulls are temporary lookups and do not alter these saved previews.</span></div>
        <div className="table-wrap">
          <table className="data-table modern-income-table">
            <thead><tr><th>Company</th><th>Billing period</th><th>Accrued through</th><th>Cadence</th><th>Current amount</th><th>Status</th></tr></thead>
            <tbody>
              {visibleAccruals.length > 0 ? visibleAccruals.map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.partnerName}</strong></td>
                  <td>{periodLabel(row.periodStart, row.periodEnd)}</td>
                  <td>{dateLabel(row.accruedThrough)}</td>
                  <td><span className="cadence-badge">{cadenceLabel(row.billingCadence)}</span></td>
                  <td className="amount">{money(row.amount, row.currency)}</td>
                  <td><span className="status-pill invoice-status-accruing">Accruing</span></td>
                </tr>
              )) : <tr><td colSpan={6}>No active accruals match these filters</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function IncomeSummary({ label, value, detail, tone = "" }: { label: string; value: string; detail: string; tone?: string }) {
  return <article className={`income-summary-card ${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

type DisplayInvoiceRow =
  | { kind: "invoice"; id: string; status: "draft" | "open" | "paid"; invoice: Invoice; accrual?: never }
  | { kind: "accrual"; id: string; status: "accruing"; invoice?: never; accrual: RevenueAccrual };

export function InvoicesView({
  dashboard,
  providersById,
  onCreateDraft,
  onUpdateDraft,
  onSendInvoices,
  onRecordPayment
}: {
  dashboard: DashboardSnapshot;
  providersById: Map<string, Provider>;
  onCreateDraft: (payload: CreateInvoicePayload) => Promise<void>;
  onUpdateDraft: (invoiceId: string, payload: UpdateInvoicePayload) => Promise<void>;
  onSendInvoices: (invoiceIds: string[], mode: MeritSendMode) => Promise<void>;
  onRecordPayment: (invoiceId: string, payload: RecordInvoicePaymentPayload) => Promise<void>;
}) {
  const [tab, setTab] = useState<InvoiceTab>("all");
  const [query, setQuery] = useState("");
  const [companyId, setCompanyId] = useState("all");
  const [currency, setCurrency] = useState("all");
  const [statusFilter, setStatusFilter] = useState<InvoiceStatusFilter>("all");
  const [cadence, setCadence] = useState<"all" | BillingCadence | "manual">("all");
  const [createdDate, setCreatedDate] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editorInvoice, setEditorInvoice] = useState<Invoice | "new" | null>(null);
  const [sendIds, setSendIds] = useState<string[] | null>(null);
  const [paymentInvoice, setPaymentInvoice] = useState<Invoice | null>(null);

  const salesInvoices = dashboard.invoices.filter((invoice) => invoice.documentType === "sales_invoice");
  const activeAccruals = dashboard.revenueAccruals.filter((row) => row.status === "accruing");
  const allRows: DisplayInvoiceRow[] = [
    ...salesInvoices.map((invoice): DisplayInvoiceRow => ({ kind: "invoice", id: invoice.id, status: invoice.status, invoice })),
    ...activeAccruals.map((accrual): DisplayInvoiceRow => ({ kind: "accrual", id: accrual.id, status: "accruing", accrual }))
  ];
  const currencies = [...new Set(allRows.map((row) => row.kind === "invoice" ? row.invoice.currency : row.accrual.currency))].sort();
  const providers = dashboard.providers.filter((provider) => provider.type === "client").sort((left, right) => left.name.localeCompare(right.name));
  const meritIntegration = dashboard.integrationStatus.find((integration) => integration.id === "merit");
  const meritWriteEnabled = meritIntegration?.writeEnabled === true;

  function rowProviderId(row: DisplayInvoiceRow): string | undefined {
    return row.kind === "invoice" ? row.invoice.providerId : row.accrual.providerId;
  }

  function rowCadence(row: DisplayInvoiceRow): BillingCadence | "manual" {
    if (row.kind === "accrual") return row.accrual.billingCadence;
    return revenuePartnerForInvoice(row.invoice, dashboard)?.billingCadence ?? "manual";
  }

  const visibleRows = allRows
    .filter((row) => {
      if (tab === "open" && !["draft", "open", "accruing"].includes(row.status)) return false;
      if (tab === "paid" && row.status !== "paid") return false;
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (companyId !== "all" && rowProviderId(row) !== companyId) return false;
      const rowCurrency = row.kind === "invoice" ? row.invoice.currency : row.accrual.currency;
      if (currency !== "all" && rowCurrency !== currency) return false;
      if (cadence !== "all" && rowCadence(row) !== cadence) return false;
      if (createdDate && (row.kind !== "invoice" || createdDateKey(row.invoice.createdAt) !== createdDate)) return false;
      const search = query.trim().toLowerCase();
      if (!search) return true;
      const provider = rowProviderId(row) ? providersById.get(rowProviderId(row) ?? "") : undefined;
      const text = row.kind === "invoice"
        ? `${row.invoice.customerName} ${row.invoice.description} ${row.invoice.invoiceNumber} ${provider?.name ?? ""}`
        : `${row.accrual.partnerName} ${provider?.name ?? ""}`;
      return text.toLowerCase().includes(search);
    })
    .sort((left, right) => {
      const leftDate = left.kind === "invoice" ? left.invoice.dueDate : left.accrual.periodEnd;
      const rightDate = right.kind === "invoice" ? right.invoice.dueDate : right.accrual.periodEnd;
      return leftDate.localeCompare(rightDate);
    });

  const draftTotals: CurrencyTotals = {};
  const openTotals: CurrencyTotals = {};
  const accruingTotals: CurrencyTotals = {};
  for (const invoice of salesInvoices) {
    if (invoice.status === "draft") addTotal(draftTotals, invoice.currency, invoice.amount);
    if (invoice.status === "open") {
      const allocated = dashboard.paymentAllocations.filter((allocation) => allocation.invoiceId === invoice.id).reduce((total, item) => total + item.amount, 0);
      addTotal(openTotals, invoice.currency, Math.max(0, invoice.amount - allocated));
    }
  }
  for (const accrual of activeAccruals) addTotal(accruingTotals, accrual.currency, accrual.amount);
  const expectedTotals: CurrencyTotals = { ...openTotals };
  for (const [itemCurrency, amount] of Object.entries(draftTotals)) addTotal(expectedTotals, itemCurrency, amount);
  for (const [itemCurrency, amount] of Object.entries(accruingTotals)) addTotal(expectedTotals, itemCurrency, amount);

  const actionableVisibleIds = visibleRows
    .filter((row): row is Extract<DisplayInvoiceRow, { kind: "invoice" }> => row.kind === "invoice" && invoiceCanBeSelected(row.invoice, providersById))
    .map((row) => row.invoice.id);
  const allActionableSelected = actionableVisibleIds.length > 0 && actionableVisibleIds.every((id) => selectedIds.includes(id));
  const selectedInvoices = salesInvoices.filter((invoice) => selectedIds.includes(invoice.id));
  const selectedDraftCount = selectedInvoices.filter((invoice) => invoice.status === "draft").length;
  const selectedDeliveryCount = selectedInvoices.filter(invoiceCanBeDelivered).length;

  useEffect(() => {
    const validIds = new Set(salesInvoices.filter((invoice) => invoiceCanBeSelected(invoice, providersById)).map((invoice) => invoice.id));
    setSelectedIds((current) => current.filter((id) => validIds.has(id)));
  }, [dashboard.invoices, dashboard.providers, providersById]);

  function toggleSelected(id: string, checked: boolean) {
    setSelectedIds((current) => checked ? [...new Set([...current, id])] : current.filter((item) => item !== id));
  }

  return (
    <div className="income-page-stack">
      <section className="invoice-total-band" aria-label="Invoice totals">
        <IncomeSummary label="Open" value={formatTotals(openTotals)} detail="Sent, less recorded payments" tone="open" />
        <IncomeSummary label="Drafts" value={formatTotals(draftTotals)} detail="Prepared, not yet in Merit" tone="draft" />
        <IncomeSummary label="Accruing" value={formatTotals(accruingTotals)} detail="Current-period invoice previews" tone="accruing" />
        <IncomeSummary label="Expected income" value={formatTotals(expectedTotals)} detail="Open + drafts + accruing" tone="expected" />
      </section>

      <section className="panel">
        <div className="panel-header income-panel-header">
          <div><p className="eyebrow">Invoices</p><h2>Prepare, send, match, and record payment</h2></div>
          <Button className="primary-button" type="button" onClick={() => setEditorInvoice("new")}><FilePlus2 size={16} /> Create manual invoice</Button>
        </div>

        <div className="invoice-tabs-row">
          <div className="segmented-control invoice-tabs" aria-label="Invoice view">
            {([
              ["all", `All ${allRows.length}`],
              ["open", `Open ${allRows.filter((row) => ["draft", "open", "accruing"].includes(row.status)).length}`],
              ["paid", `Paid ${salesInvoices.filter((invoice) => invoice.status === "paid").length}`]
            ] as Array<[InvoiceTab, string]>).map(([id, label]) => (
              <Button key={id} className={tab === id ? "active" : ""} type="button" onClick={() => setTab(id)}>{label}</Button>
            ))}
          </div>
          {selectedIds.length > 0 && (
            <div className="selection-action-bar">
              <span>
                {selectedIds.length} selected
                {selectedDraftCount > 0 ? ` · ${selectedDraftCount} draft${selectedDraftCount === 1 ? "" : "s"}` : ""}
                {selectedDeliveryCount > 0 ? ` · ${selectedDeliveryCount} in Merit` : ""}
              </span>
              <Button className="primary-button" type="button" onClick={() => setSendIds(selectedIds)} disabled={!meritWriteEnabled}>
                {selectedDraftCount === 0 ? <Mail size={15} /> : <Send size={15} />}
                {selectedDraftCount === 0 ? "Deliver selected" : "Review selected"}
              </Button>
              <Button className="icon-button" type="button" aria-label="Clear selection" onClick={() => setSelectedIds([])}><X size={15} /></Button>
            </div>
          )}
        </div>

        <div className="income-filter-bar invoice-filter-bar">
          <label className="income-search-field"><Search size={15} /><Input aria-label="Search invoices" placeholder="Search company, invoice, description" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <label>Company<NativeSelect value={companyId} onChange={(event) => setCompanyId(event.target.value)}><NativeSelectOption value="all">All companies</NativeSelectOption>{providers.map((provider) => <NativeSelectOption key={provider.id} value={provider.id}>{provider.name}</NativeSelectOption>)}</NativeSelect></label>
          <label>Currency<NativeSelect value={currency} onChange={(event) => setCurrency(event.target.value)}><NativeSelectOption value="all">All currencies</NativeSelectOption>{currencies.map((item) => <NativeSelectOption key={item} value={item}>{item}</NativeSelectOption>)}</NativeSelect></label>
          <label>Status<NativeSelect value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as InvoiceStatusFilter)}><NativeSelectOption value="all">All statuses</NativeSelectOption><NativeSelectOption value="draft">Draft</NativeSelectOption><NativeSelectOption value="open">Open</NativeSelectOption><NativeSelectOption value="paid">Paid</NativeSelectOption><NativeSelectOption value="accruing">Accruing</NativeSelectOption></NativeSelect></label>
          <label>Cadence<NativeSelect value={cadence} onChange={(event) => setCadence(event.target.value as "all" | BillingCadence | "manual")}><NativeSelectOption value="all">All cadences</NativeSelectOption><NativeSelectOption value="weekly">Weekly</NativeSelectOption><NativeSelectOption value="monthly">Monthly</NativeSelectOption><NativeSelectOption value="manual">Manual</NativeSelectOption></NativeSelect></label>
          <label>Created date<Input type="date" aria-label="Filter invoices by created date" value={createdDate} onChange={(event) => setCreatedDate(event.target.value)} /></label>
          <Button className="icon-text-button clear-filter-button" type="button" disabled={!query && companyId === "all" && currency === "all" && statusFilter === "all" && cadence === "all" && !createdDate} onClick={() => { setQuery(""); setCompanyId("all"); setCurrency("all"); setStatusFilter("all"); setCadence("all"); setCreatedDate(""); }}><Filter size={14} /> Clear</Button>
        </div>

        {!meritWriteEnabled && (
          <div className="income-callout warning"><CircleAlert size={17} /><span>Merit writes are currently disabled by the deployment switch. Draft review and local payment controls remain available.</span></div>
        )}
        <div className="invoice-selection-help">
          <Check size={15} />
          <span>Select drafts to save or save & deliver in bulk. Select open Merit invoices to deliver them in bulk. Record payments one invoice at a time so each bank allocation stays accurate.</span>
        </div>

        <div className="table-wrap">
          <table className="data-table modern-income-table invoice-control-table">
            <thead><tr><th className="selection-column"><Checkbox aria-label="Select all actionable invoices in this view" checked={allActionableSelected} disabled={actionableVisibleIds.length === 0} title="Select drafts to save or deliver, and existing Merit invoices to deliver" onCheckedChange={(checked) => setSelectedIds(checked === true ? [...new Set([...selectedIds, ...actionableVisibleIds])] : selectedIds.filter((id) => !actionableVisibleIds.includes(id)))} /></th><th>Invoice / company</th><th>Created at</th><th>Period</th><th>Amount</th><th>Cadence</th><th>Status</th><th>Payment forecast</th><th>Actions</th></tr></thead>
            <tbody>
              {visibleRows.length > 0 ? visibleRows.map((row) => {
                if (row.kind === "accrual") {
                  return <tr key={row.id} className="accrual-row"><td className="selection-column"><Checkbox disabled aria-label="Accrual cannot be selected" /></td><td className="counterparty-cell"><strong>{row.accrual.partnerName}</strong><small>Future invoice · current through {dateLabel(row.accrual.accruedThrough)}</small></td><td className="muted-cell">—</td><td>{periodLabel(row.accrual.periodStart, row.accrual.periodEnd)}</td><td className="amount">{money(row.accrual.amount, row.accrual.currency)}</td><td><span className="cadence-badge">{cadenceLabel(row.accrual.billingCadence)}</span></td><td><span className="status-pill invoice-status-accruing">Accruing</span></td><td><span className="forecast-copy"><Clock3 size={14} /> Starts after invoice is sent</span></td><td><span className="muted-cell">Monday automation</span></td></tr>;
                }
                const invoice = row.invoice;
                const provider = invoice.providerId ? providersById.get(invoice.providerId) : undefined;
                const invoiceCadence = revenuePartnerForInvoice(invoice, dashboard)?.billingCadence;
                const prediction = dashboard.invoicePredictions.find((item) => item.invoiceId === invoice.id);
                const allocations = dashboard.paymentAllocations.filter((allocation) => allocation.invoiceId === invoice.id);
                const paidAmount = allocations.reduce((total, allocation) => total + allocation.amount, 0);
                const ready = invoiceIsSendReady(invoice, providersById);
                const sendBlockReason = invoice.sendError
                  ?? (invoice.meritCreationReservedAt
                    ? "Merit creation was already attempted. Review Merit, then edit this draft before retrying."
                    : invoice.origin === "revenue" && !provider?.meritCustomerId
                      ? "Edit the revenue rule and choose the customer imported from Merit"
                    : !invoice.taxId
                      ? "Edit the draft and choose a Merit tax first"
                      : "This draft is not send-ready");
                const canDeliverExisting = invoiceCanBeDelivered(invoice);
                const selectable = ready || canDeliverExisting;
                return (
                  <tr key={invoice.id}>
                    <td className="selection-column"><Checkbox aria-label={`Select ${invoice.invoiceNumber}`} checked={selectedIds.includes(invoice.id)} disabled={!selectable} title={ready ? "Select draft to save or deliver" : canDeliverExisting ? "Select existing Merit invoice for delivery" : sendBlockReason} onCheckedChange={(checked) => toggleSelected(invoice.id, checked === true)} /></td>
                    <td className="counterparty-cell"><strong>{invoice.invoiceNumber || "Draft invoice"}</strong><span>{provider?.name ?? invoice.customerName}</span><small>{invoice.description}</small></td>
                    <td className="invoice-created-cell">{createdAtLabel(invoice.createdAt)}</td>
                    <td><span>{periodLabel(invoice.periodStart, invoice.periodEnd)}</span><small>Due {dateLabel(invoice.dueDate)}</small></td>
                    <td className="amount"><strong>{money(invoice.amount, invoice.currency)}</strong>{paidAmount > 0 && invoice.status !== "paid" && <small>{money(paidAmount, invoice.currency)} recorded</small>}</td>
                    <td><span className="cadence-badge">{cadenceLabel(invoiceCadence)}</span></td>
                    <td>
                      <span className={`status-pill invoice-status-${invoice.status}`}>{invoice.status}</span>
                      {invoice.meritDeliveryStatus !== "not-sent" && (
                        <small className={invoice.meritDeliveryStatus === "delivery-failed" ? "danger-text" : undefined}>
                          {invoice.meritDeliveryStatus === "delivered"
                            ? "Delivered by Merit"
                            : invoice.meritDeliveryStatus === "delivery-failed"
                              ? "Merit delivery failed"
                              : "Saved in Merit"}
                        </small>
                      )}
                      {(invoice.meritDeliveryError || invoice.sendError) && <small className="danger-text">{invoice.meritDeliveryError ?? invoice.sendError}</small>}
                    </td>
                    <td><PaymentForecast invoice={invoice} prediction={prediction} /></td>
                    <td><div className="row-actions invoice-row-actions">
                      {invoice.status === "draft" && <Button className="icon-text-button" type="button" onClick={() => setEditorInvoice(invoice)}><Edit3 size={14} /> Edit</Button>}
                      {invoice.status === "draft" && <Button className="icon-text-button" type="button" disabled={!ready || !meritWriteEnabled} title={ready ? "Choose how Merit should handle this invoice" : sendBlockReason} onClick={() => setSendIds([invoice.id])}><Send size={14} /> Send</Button>}
                      {canDeliverExisting && <Button className="icon-text-button" type="button" disabled={!meritWriteEnabled} title={invoice.meritDeliveryStatus === "delivery-failed" ? "Retry delivery using the existing Merit invoice" : "Ask Merit to deliver the existing invoice"} onClick={() => setSendIds([invoice.id])}><Mail size={14} /> {invoice.meritDeliveryStatus === "delivery-failed" ? "Retry delivery" : "Deliver"}</Button>}
                      {invoice.status === "open" && <Button className="icon-text-button" type="button" onClick={() => setPaymentInvoice(invoice)}><Check size={14} /> Mark paid</Button>}
                      {invoice.status === "paid" && (
                        <div className="paid-allocation-list">
                          {allocations.length > 0 ? allocations.map((allocation) => (
                            <div className="paid-allocation-entry" key={allocation.id}>
                              <span className="paid-source-copy">
                                {paymentSourceOptions.find((item) => item.value === allocation.source)?.label ?? allocation.source}
                                {` · ${dateLabel(allocation.paidAt)} · ${money(allocation.amount, allocation.currency)}`}
                              </span>
                              {allocation.note && <small>{allocation.note}</small>}
                            </div>
                          )) : <span className="paid-source-copy">Paid in dashboard</span>}
                        </div>
                      )}
                    </div></td>
                  </tr>
                );
              }) : <tr><td colSpan={9}>No invoices match this view</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {editorInvoice && <InvoiceEditorDialog dashboard={dashboard} invoice={editorInvoice === "new" ? undefined : editorInvoice} onClose={() => setEditorInvoice(null)} onSubmit={async (payload) => { if (editorInvoice === "new") await onCreateDraft(payload as CreateInvoicePayload); else await onUpdateDraft(editorInvoice.id, payload as UpdateInvoicePayload); setEditorInvoice(null); }} />}
      {sendIds && <SendInvoicesDialog invoiceIds={sendIds} invoices={salesInvoices.filter((invoice) => sendIds.includes(invoice.id))} providersById={providersById} onClose={() => setSendIds(null)} onSend={async (mode) => { await onSendInvoices(sendIds, mode); setSendIds(null); setSelectedIds([]); }} />}
      {paymentInvoice && <MarkPaidDialog dashboard={dashboard} invoice={paymentInvoice} onClose={() => setPaymentInvoice(null)} onSubmit={async (payload) => { await onRecordPayment(paymentInvoice.id, payload); setPaymentInvoice(null); }} />}
    </div>
  );
}

function PaymentForecast({ invoice, prediction }: { invoice: Invoice; prediction?: DashboardSnapshot["invoicePredictions"][number] }) {
  if (invoice.status === "draft") return <span className="forecast-copy muted"><Clock3 size={14} /> Forecast starts from issue date</span>;
  if (invoice.status === "paid") return <span className="forecast-copy good"><Check size={14} /> Paid {invoice.paidAt ? dateLabel(invoice.paidAt) : ""}</span>;
  const sampleSize = prediction?.sampleSize ?? 0;
  if (sampleSize < 5) return <span className="forecast-copy learning"><Sparkles size={14} /> Need {5 - sampleSize} of 5 matched payment{5 - sampleSize === 1 ? "" : "s"}</span>;
  if (!prediction?.predictedDate) return <span className="forecast-copy muted"><Clock3 size={14} /> Forecast unavailable</span>;
  return <span className="forecast-copy"><CalendarClock size={14} /><strong>{dateLabel(prediction.predictedDate)}</strong><small>Median {prediction.medianDays} days · last 5 matched</small></span>;
}

function InvoiceEditorDialog({ dashboard, invoice, onClose, onSubmit }: { dashboard: DashboardSnapshot; invoice?: Invoice; onClose: () => void; onSubmit: (payload: CreateInvoicePayload | UpdateInvoicePayload) => Promise<void> }) {
  const today = new Date().toISOString().slice(0, 10);
  const [providerId, setProviderId] = useState(invoice?.providerId ?? "");
  const initialProvider = invoice?.providerId ? dashboard.providers.find((provider) => provider.id === invoice.providerId) : undefined;
  const [amount, setAmount] = useState(invoice ? String(invoice.amount) : "");
  const [currency, setCurrency] = useState(invoice?.currency ?? initialProvider?.defaultCurrency ?? "USD");
  const [issueDate, setIssueDate] = useState(toDateInput(invoice?.issueDate ?? today));
  const [dueDate, setDueDate] = useState(toDateInput(invoice?.dueDate ?? addDays(today, initialProvider?.paymentTermsDays ?? 30)));
  const [periodStart, setPeriodStart] = useState(invoice?.periodStart ?? "");
  const [periodEnd, setPeriodEnd] = useState(invoice?.periodEnd ?? "");
  const initialRule = initialProvider ? dashboard.revenuePartners.find((item) => item.providerId === initialProvider.id) : undefined;
  const [taxId, setTaxId] = useState(invoice?.taxId ?? initialRule?.defaultMeritTaxId ?? initialProvider?.defaultMeritTaxId ?? "");
  const [description, setDescription] = useState(invoice?.description ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clients = dashboard.providers.filter((provider) => provider.type === "client");
  const selectedProvider = providerId ? clients.find((provider) => provider.id === providerId) : undefined;
  const officialCustomerName = selectedProvider?.legalName?.trim() || selectedProvider?.name;
  const companyOptions = clients.map((provider) => ({
    value: provider.id,
    label: provider.name
  }));
  const taxOptions = dashboard.meritTaxes.map((tax) => ({
    value: tax.id,
    label: `${tax.name} · ${tax.taxPct}%`
  }));

  function chooseProvider(nextId: string) {
    setProviderId(nextId);
    const provider = clients.find((item) => item.id === nextId);
    if (!provider) return;
    if (provider.defaultCurrency) setCurrency(provider.defaultCurrency);
    setDueDate(addDays(issueDate, provider.paymentTermsDays ?? 30));
    const rule = dashboard.revenuePartners.find((item) => item.providerId === provider.id);
    setTaxId(rule?.defaultMeritTaxId ?? provider.defaultMeritTaxId ?? "");
    if (!description && rule?.defaultMeritItemCode) setDescription(rule.defaultMeritItemCode);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!selectedProvider || !officialCustomerName) {
      setError("Choose a company before saving this invoice");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const core: UpdateInvoicePayload = {
        providerId: selectedProvider.id,
        customerName: officialCustomerName,
        amount: Number(amount),
        currency: currency.trim().toUpperCase(),
        issueDate,
        dueDate,
        description: description.trim(),
        taxId: taxId || undefined,
        periodStart: periodStart || undefined,
        periodEnd: periodEnd || undefined
      };
      if (invoice) await onSubmit(core);
      else await onSubmit({ ...core, documentType: "sales_invoice" });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Invoice draft could not be saved");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="modal wide-modal invoice-editor-modal" role="dialog" aria-modal="true" aria-labelledby="invoice-editor-title" onSubmit={handleSubmit}>
        <div className="modal-header"><div><p className="eyebrow">Sales invoice</p><h2 id="invoice-editor-title">{invoice ? `Edit ${invoice.invoiceNumber}` : "Create manual invoice"}</h2></div><Button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></Button></div>
        <div className="modal-body-stack invoice-editor-body">
          {error && <div className="inline-error">{error}</div>}
          <div className="invoice-form-grid">
            <div className="invoice-field invoice-company-field">
              <label htmlFor="invoice-company">Company</label>
              <SearchableSelect
                id="invoice-company"
                value={providerId}
                options={companyOptions}
                onValueChange={chooseProvider}
                placeholder="Search or choose a company"
                emptyMessage="No companies found"
                ariaLabel="Company"
              />
            </div>
          </div>
          {selectedProvider?.meritCustomerId && (
            <div className="merit-customer-preview">
              <div className="merit-customer-heading"><div><span>Merit customer</span><strong>{officialCustomerName}</strong></div><small>ID {selectedProvider.meritCustomerId}</small></div>
              <dl>
                <div><dt>Billing email</dt><dd>{selectedProvider.email || "Not saved"}</dd></div>
                <div><dt>Billing address</dt><dd>{selectedProvider.address || selectedProvider.country || "Not saved"}</dd></div>
                <div><dt>Currency</dt><dd>{selectedProvider.defaultCurrency || currency}</dd></div>
                <div><dt>Terms</dt><dd>{selectedProvider.paymentTermsDays ?? 0} days</dd></div>
              </dl>
              <p>Merit will render its saved company identity and invoice template; this draft supplies the service period, line description, net amount, tax, issue date, and due date.</p>
            </div>
          )}
          <div className="invoice-financial-grid">
            <div className="invoice-money-fields">
              <div className="invoice-field"><label htmlFor="invoice-amount">Net amount</label><Input id="invoice-amount" type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></div>
              <div className="invoice-field"><label htmlFor="invoice-currency">Currency</label><Input id="invoice-currency" value={currency} maxLength={6} onChange={(event) => setCurrency(event.target.value.toUpperCase())} /></div>
            </div>
            <div className="invoice-field">
              <label htmlFor="invoice-tax">Merit tax</label>
              <SearchableSelect
                id="invoice-tax"
                value={taxId}
                options={taxOptions}
                onValueChange={setTaxId}
                placeholder="Search or choose a tax"
                emptyMessage="No taxes found"
                ariaLabel="Merit tax"
              />
            </div>
          </div>
          <div className="invoice-form-grid">
            <div className="invoice-field"><label htmlFor="invoice-issue-date">Issue date</label><Input id="invoice-issue-date" type="date" value={issueDate} onChange={(event) => setIssueDate(event.target.value)} /></div>
            <div className="invoice-field"><label htmlFor="invoice-due-date">Due date</label><Input id="invoice-due-date" type="date" min={issueDate} value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></div>
          </div>
          <div className="invoice-form-grid">
            <div className="invoice-field"><label htmlFor="invoice-period-start">Service period start</label><Input id="invoice-period-start" type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} /></div>
            <div className="invoice-field"><label htmlFor="invoice-period-end">Service period end</label><Input id="invoice-period-end" type="date" min={periodStart || undefined} value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} /></div>
          </div>
          <div className="invoice-field"><label htmlFor="invoice-description">Description / Merit item</label><Textarea id="invoice-description" rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What this invoice covers" /></div>
          <div className="income-callout"><CircleAlert size={16} /><span>Saving here creates or updates a dashboard draft only. Nothing is written to Merit until you choose a send action.</span></div>
        </div>
        <div className="modal-actions"><Button type="button" className="secondary-button" onClick={onClose} disabled={submitting}>Cancel</Button><Button type="submit" className="primary-button" disabled={submitting || !selectedProvider || Number(amount) <= 0 || !currency.trim() || !issueDate || !dueDate || !description.trim()}>{submitting ? <Loader2 className="spin" size={16} /> : <FilePlus2 size={16} />} Save draft</Button></div>
      </form>
    </div>
  );
}

function SendInvoicesDialog({ invoiceIds, invoices, providersById, onClose, onSend }: { invoiceIds: string[]; invoices: Invoice[]; providersById: Map<string, Provider>; onClose: () => void; onSend: (mode: MeritSendMode) => Promise<void> }) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [busyMode, setBusyMode] = useState<MeritSendMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const totals: CurrencyTotals = {};
  for (const invoice of invoices) addTotal(totals, invoice.currency, invoice.amount);
  const deliveryOnly =
    invoices.length > 0 &&
    invoices.every(
      (invoice) =>
        invoice.status === "open" &&
        Boolean(invoice.externalId) &&
        (invoice.meritDeliveryStatus === "saved" || invoice.meritDeliveryStatus === "delivery-failed")
    );
  const isDeliveryRetry = deliveryOnly && invoices.some((invoice) => invoice.meritDeliveryStatus === "delivery-failed");
  const draftCount = invoices.filter((invoice) => invoice.status === "draft").length;
  const existingCount = invoices.length - draftCount;
  const mixedSelection = draftCount > 0 && existingCount > 0;
  const unknownDeliveryCount = invoices.filter((invoice) => invoice.origin === "merit" && invoiceCanBeDelivered(invoice)).length;

  async function send(mode: MeritSendMode) {
    if (!acknowledged) return;
    setBusyMode(mode);
    setError(null);
    try {
      await onSend(mode);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Invoices could not be sent to Merit");
      setBusyMode(null);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal send-choice-modal" role="dialog" aria-modal="true" aria-labelledby="send-choice-title">
        <div className="modal-header"><div><p className="eyebrow">External Merit action</p><h2 id="send-choice-title">{deliveryOnly ? `${isDeliveryRetry ? "Retry delivery for" : "Deliver"} ${invoiceIds.length} invoice${invoiceIds.length === 1 ? "" : "s"}` : mixedSelection ? `Review ${invoiceIds.length} selected invoices` : `Send ${invoiceIds.length} draft${invoiceIds.length === 1 ? "" : "s"}`}</h2></div><Button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></Button></div>
        <div className="send-review-summary"><span>Selected total</span><strong>{formatTotals(totals)}</strong><small>{deliveryOnly ? "These invoices already exist in Merit. This action only requests client delivery; it does not create them again." : mixedSelection ? `${draftCount} draft${draftCount === 1 ? "" : "s"} will be created; ${existingCount} existing Merit invoice${existingCount === 1 ? "" : "s"} can be delivered in the same action.` : "Each draft uses its linked Merit customer, saved tax, and invoice details shown below."}</small></div>
        <div className="invoice-send-review-list">
          {invoices.map((invoice) => {
            const provider = invoice.providerId ? providersById.get(invoice.providerId) : undefined;
            return (
              <div key={invoice.id}>
                <span>{invoice.status === "draft" ? "Draft" : "In Merit"}</span>
                <strong>{provider?.legalName || provider?.name || invoice.customerName}</strong>
                <small>{periodLabel(invoice.periodStart, invoice.periodEnd)} · due {dateLabel(invoice.dueDate)} · {money(invoice.amount, invoice.currency)}</small>
                <small>{invoice.description}</small>
              </div>
            );
          })}
        </div>
        {unknownDeliveryCount > 0 && (
          <div className="income-callout warning"><CircleAlert size={16} /><span>Merit’s invoice list does not report prior email delivery. Delivering {unknownDeliveryCount} imported invoice{unknownDeliveryCount === 1 ? "" : "s"} may resend them to the saved customer contacts.</span></div>
        )}
        <div className={`send-option-grid${deliveryOnly ? " single" : ""}`}>
          {deliveryOnly ? (
            <button type="button" className="send-option-card primary" disabled={!acknowledged || busyMode !== null} onClick={() => void send("deliver")}><span className="send-option-icon"><Mail size={20} /></span><strong>{isDeliveryRetry ? "Retry Merit delivery" : "Deliver through Merit"}</strong><small>Ask Merit to email/deliver the existing invoice to the client without creating another invoice.</small><span className="send-option-action">{busyMode === "deliver" ? <Loader2 className="spin" size={16} /> : <>{isDeliveryRetry ? "Retry delivery" : "Deliver existing invoice"} <ChevronRight size={15} /></>}</span></button>
          ) : (
            <>
              <button type="button" className="send-option-card" disabled={!acknowledged || busyMode !== null} onClick={() => void send("save")}><span className="send-option-icon"><FilePlus2 size={20} /></span><strong>Save draft{draftCount === 1 ? "" : "s"} in Merit</strong><small>Create the selected drafts in Merit. Existing Merit invoices stay unchanged.</small><span className="send-option-action">{busyMode === "save" ? <Loader2 className="spin" size={16} /> : <>Choose save only <ChevronRight size={15} /></>}</span></button>
              <button type="button" className="send-option-card primary" disabled={!acknowledged || busyMode !== null} onClick={() => void send("deliver")}><span className="send-option-icon"><Mail size={20} /></span><strong>{mixedSelection ? "Create & deliver all" : "Save & deliver"}</strong><small>Create each draft, then ask Merit to deliver every selected invoice to its saved customer.</small><span className="send-option-action">{busyMode === "deliver" ? <Loader2 className="spin" size={16} /> : <>Choose save & deliver <ChevronRight size={15} /></>}</span></button>
            </>
          )}
        </div>
        <label className="merit-confirmation-check"><Checkbox checked={acknowledged} onCheckedChange={(checked) => setAcknowledged(checked === true)} />{unknownDeliveryCount > 0 ? "I understand this may resend imported Merit invoices to their saved customer contacts." : deliveryOnly ? "I understand this asks Merit to deliver/email an existing invoice to the client." : "I understand either option writes real invoices to Merit."}</label>
        {error && <div className="inline-error">{error}</div>}
        <div className="modal-actions"><Button type="button" className="secondary-button" onClick={onClose} disabled={busyMode !== null}>Cancel</Button></div>
      </div>
    </div>
  );
}

function MarkPaidDialog({ dashboard, invoice, onClose, onSubmit }: { dashboard: DashboardSnapshot; invoice: Invoice; onClose: () => void; onSubmit: (payload: RecordInvoicePaymentPayload) => Promise<void> }) {
  const allocated = dashboard.paymentAllocations.filter((item) => item.invoiceId === invoice.id).reduce((total, item) => total + item.amount, 0);
  const remaining = Math.max(0, invoice.amount - allocated);
  const eligibleTransactions = dashboard.transactions
    .filter(
      (transaction) =>
        transaction.direction === "in" &&
        transaction.currency === invoice.currency &&
        (transaction.status === "posted" || transaction.status === "settled")
    )
    .map((transaction) => {
      const transactionAllocated = dashboard.paymentAllocations
        .filter((allocation) => allocation.transactionId === transaction.id)
        .reduce((total, allocation) => total + allocation.amount, 0);
      return { transaction, allocated: transactionAllocated, available: Math.max(0, Math.abs(transaction.amount) - transactionAllocated) };
    })
    .filter(
      (row) =>
        row.available > 0 &&
        (!row.transaction.matchedInvoiceId || row.transaction.matchedInvoiceId === invoice.id || row.allocated > 0)
    )
    .sort((left, right) => right.transaction.date.localeCompare(left.transaction.date));
  const [amount, setAmount] = useState(String(remaining));
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [source, setSource] = useState<PaymentSource>("wise");
  const [transactionId, setTransactionId] = useState("");
  const [accountName, setAccountName] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedTransaction = eligibleTransactions.find((row) => row.transaction.id === transactionId);
  const maximumPayment = selectedTransaction ? Math.min(remaining, selectedTransaction.available) : remaining;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        amount: Number(amount),
        paidAt,
        source,
        accountName: accountName.trim() || undefined,
        transactionId: transactionId || undefined,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Payment could not be recorded");
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="modal payment-modal" role="dialog" aria-modal="true" aria-labelledby="mark-paid-title" onSubmit={handleSubmit}>
        <div className="modal-header"><div><p className="eyebrow">Dashboard payment</p><h2 id="mark-paid-title">Record payment for {invoice.invoiceNumber}</h2></div><Button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></Button></div>
        <div className="merit-unchanged-banner"><CircleAlert size={18} /><div><strong>Merit will stay unchanged</strong><span>This only updates payment status and history in this dashboard.</span></div></div>
        {error && <div className="inline-error">{error}</div>}
        <label>
          Matched bank transaction (optional)
          <NativeSelect
            value={transactionId}
            onChange={(event) => {
              const nextId = event.target.value;
              setTransactionId(nextId);
              const row = eligibleTransactions.find((item) => item.transaction.id === nextId);
              if (!row) return;
              const nextSource = row.transaction.source;
              setSource(paymentSourceOptions.some((item) => item.value === nextSource) ? nextSource as PaymentSource : "other");
              setAccountName(row.transaction.accountName);
              setReference(row.transaction.id);
              setPaidAt(toDateInput(row.transaction.date));
              setAmount(String(Math.min(remaining, row.available)));
            }}
          >
            <NativeSelectOption value="">No transaction · manual payment only</NativeSelectOption>
            {eligibleTransactions.map(({ transaction, available }) => (
              <NativeSelectOption key={transaction.id} value={transaction.id}>
                {dateLabel(transaction.date)} · {transaction.accountName} · {transaction.counterparty} · {money(available, transaction.currency)} remaining
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <small className="field-help">Confirming a real match makes this payment eligible for the five-payment forecast history.</small>
        </label>
        <div className="form-grid"><label>Amount<Input type="number" min="0.01" max={maximumPayment || undefined} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} /></label><label>Payment date<Input type="date" value={paidAt} onChange={(event) => setPaidAt(event.target.value)} /></label></div>
        <div className="form-grid"><label>Paid in / source<NativeSelect value={source} onChange={(event) => setSource(event.target.value as PaymentSource)}>{paymentSourceOptions.map((item) => <NativeSelectOption key={item.value} value={item.value}>{item.label}</NativeSelectOption>)}</NativeSelect></label><label>Account / wallet<Input value={accountName} onChange={(event) => setAccountName(event.target.value)} placeholder="e.g. Wise USD balance" /></label></div>
        <label>Transaction reference<Input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Bank or internal reference" /></label>
        <label>Payment note<Textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional context for this payment" /></label>
        <div className="payment-balance-line"><span>Invoice {money(invoice.amount, invoice.currency)}</span><span>Already recorded {money(allocated, invoice.currency)}</span>{selectedTransaction && <span>Transaction available {money(selectedTransaction.available, invoice.currency)}</span>}<strong>Remaining {money(remaining, invoice.currency)}</strong></div>
        <div className="modal-actions"><Button type="button" className="secondary-button" onClick={onClose} disabled={submitting}>Cancel</Button><Button type="submit" className="primary-button" disabled={submitting || Number(amount) <= 0 || Number(amount) > maximumPayment || !paidAt}>{submitting ? <Loader2 className="spin" size={16} /> : <Check size={16} />} Record in dashboard</Button></div>
      </form>
    </div>
  );
}
