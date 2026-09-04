import {
  BadgeDollarSign,
  BanknoteArrowUp,
  CircleAlert,
  CircleDollarSign,
  Landmark,
  Loader2,
  Pencil,
  Plus,
  ReceiptText,
  Trash2,
  WalletCards,
  X
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CalendarDatePicker } from "@/components/ui/calendar-period-picker";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { InfoPopover } from "@/components/ui/finance-visuals";
import {
  compareTableValues,
  SortableTableHead,
  type TableSortDirection
} from "@/components/ui/sortable-table-head";
import { useUrlState } from "@/lib/url-state";
import type { Provider } from "../../../shared/types";
import {
  type CreateMediaFundingEntryPayload,
  type CreateMediaFundingProviderPayload,
  type MediaFundingApiResponse,
  type MediaFundingAssignment,
  type MediaFundingBankFunding,
  type MediaFundingEntry,
  type MediaFundingProvider
} from "../../../shared/mediaFunding";
import { financeOperatingDate, shiftFinanceOperatingDate } from "../../../shared/operatingDate";

type ProviderSortKey = "assignments" | "balance" | "fee" | "funded" | "opening" | "provider" | "spend";
type ActivitySortKey = "date" | "fee" | "net" | "note" | "payment" | "type";
type AssignmentSortKey = "from" | "scope" | "target" | "to";
type FundingActivity =
  | { kind: "bank"; item: MediaFundingBankFunding }
  | { kind: "adjustment"; item: MediaFundingEntry };

const providerSortKeys: readonly ProviderSortKey[] = ["assignments", "balance", "fee", "funded", "opening", "provider", "spend"];
const activitySortKeys: readonly ActivitySortKey[] = ["date", "fee", "net", "note", "payment", "type"];
const assignmentSortKeys: readonly AssignmentSortKey[] = ["from", "scope", "target", "to"];

function money(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(`${value}T00:00:00`));
}

function providerAccent(providerId: string): number {
  let hash = 0;
  for (const character of providerId) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash % 6;
}

function providerSortValue(provider: MediaFundingProvider, key: ProviderSortKey): number | string {
  if (key === "assignments") return provider.assignmentCount;
  if (key === "balance") return provider.estimatedBalance;
  if (key === "fee") return provider.defaultFeePercent;
  if (key === "funded") return provider.netFunding;
  if (key === "opening") return provider.openingBalance;
  if (key === "spend") return provider.spend;
  return provider.name;
}

function activitySortValue(activity: FundingActivity, key: ActivitySortKey): number | string | undefined {
  if (key === "date") return activity.item.date;
  if (key === "type") return activity.kind === "bank" ? "Bank payment" : "Adjustment";
  if (key === "payment") return activity.kind === "bank" ? activity.item.grossAmount : undefined;
  if (key === "fee") return activity.kind === "bank" ? activity.item.feeAmount : undefined;
  if (key === "net") return activity.item.netAmount;
  return activity.kind === "bank"
    ? `${activity.item.counterparty} ${activity.item.description}`
    : activity.item.note;
}

function assignmentSortValue(assignment: MediaFundingAssignment, key: AssignmentSortKey): string {
  if (key === "scope") return assignment.scope;
  if (key === "from") return assignment.effectiveFrom;
  if (key === "to") return assignment.effectiveTo ?? "9999-12-31";
  return assignment.accountName ?? assignment.businessManagerName ?? assignment.targetKey;
}

async function apiErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  return body?.message || fallback;
}

async function sendJson<T>(url: string, method: "POST" | "PATCH", payload: unknown): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(await apiErrorMessage(response, "Media funding update failed"));
  return response.json() as Promise<T>;
}

export function FundingProviderBadge({ provider }: { provider: MediaFundingProvider }) {
  return <span className="funding-provider-badge" data-accent={providerAccent(provider.id)}>{provider.name}</span>;
}

export function MediaFundingView({
  apiBase,
  companies,
  onOpenBankFunding,
  onOpenCompanies,
  onOpenMediaSpend
}: {
  apiBase: string;
  companies: Provider[];
  onOpenBankFunding: (companyName?: string, fromDate?: string) => void;
  onOpenCompanies: () => void;
  onOpenMediaSpend: () => void;
}) {
  const [data, setData] = useState<MediaFundingApiResponse | null>(null);
  const [selectedProviderId, setSelectedProviderId] = useUrlState("fundingProvider", "", { isValid: (value) => value.length <= 200 });
  const [sortKey, setSortKey] = useUrlState<ProviderSortKey>("fundingSort", "balance", { allowedValues: providerSortKeys });
  const [sortDirection, setSortDirection] = useUrlState<TableSortDirection>("fundingOrder", "desc", { allowedValues: ["asc", "desc"] });
  const [activitySortKey, setActivitySortKey] = useUrlState<ActivitySortKey>("fundingActivitySort", "date", { allowedValues: activitySortKeys });
  const [activitySortDirection, setActivitySortDirection] = useUrlState<TableSortDirection>("fundingActivityOrder", "desc", { allowedValues: ["asc", "desc"] });
  const [assignmentSortKey, setAssignmentSortKey] = useUrlState<AssignmentSortKey>("fundingAssignmentSort", "from", { allowedValues: assignmentSortKeys });
  const [assignmentSortDirection, setAssignmentSortDirection] = useUrlState<TableSortDirection>("fundingAssignmentOrder", "desc", { allowedValues: ["asc", "desc"] });
  const [providerDialog, setProviderDialog] = useState<MediaFundingProvider | "new" | null>(null);
  const [adjustmentDialogOpen, setAdjustmentDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadData(signal?: AbortSignal): Promise<void> {
    const response = await fetch(`${apiBase}/media-funding`, { signal });
    if (!response.ok) throw new Error(await apiErrorMessage(response, "Provider balances could not be loaded"));
    const next = await response.json() as MediaFundingApiResponse;
    setData(next);
    if (selectedProviderId && !next.providers.some((provider) => provider.id === selectedProviderId)) setSelectedProviderId("");
  }

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    void loadData(controller.signal)
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "Provider balances could not be loaded");
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, []);

  const providers = useMemo(() => [...(data?.providers ?? [])].sort((left, right) =>
    compareTableValues(providerSortValue(left, sortKey), providerSortValue(right, sortKey), sortDirection)
    || left.name.localeCompare(right.name)
  ), [data?.providers, sortDirection, sortKey]);
  const selectedProvider = data?.providers.find((provider) => provider.id === selectedProviderId) ?? null;
  const selectedActivities = useMemo(() => {
    const bank = (data?.bankFunding ?? [])
      .filter((item) => item.providerId === selectedProviderId)
      .map((item): FundingActivity => ({ kind: "bank", item }));
    const adjustments = (data?.entries ?? [])
      .filter((item) => item.providerId === selectedProviderId)
      .map((item): FundingActivity => ({ kind: "adjustment", item }));
    return [...bank, ...adjustments].sort((left, right) =>
      compareTableValues(activitySortValue(left, activitySortKey), activitySortValue(right, activitySortKey), activitySortDirection)
      || right.item.date.localeCompare(left.item.date)
      || left.item.id.localeCompare(right.item.id)
    );
  }, [activitySortDirection, activitySortKey, data?.bankFunding, data?.entries, selectedProviderId]);
  const selectedAssignments = useMemo(() => (data?.assignments ?? [])
    .filter((assignment) => assignment.providerId === selectedProviderId)
    .sort((left, right) =>
      compareTableValues(assignmentSortValue(left, assignmentSortKey), assignmentSortValue(right, assignmentSortKey), assignmentSortDirection)
      || left.targetKey.localeCompare(right.targetKey)
    ), [assignmentSortDirection, assignmentSortKey, data?.assignments, selectedProviderId]);

  function requestSort(next: ProviderSortKey): void {
    if (next === sortKey) return setSortDirection((current) => current === "asc" ? "desc" : "asc");
    setSortKey(next);
    setSortDirection(next === "provider" ? "asc" : "desc");
  }

  function requestActivitySort(next: ActivitySortKey): void {
    if (next === activitySortKey) return setActivitySortDirection((current) => current === "asc" ? "desc" : "asc");
    setActivitySortKey(next);
    setActivitySortDirection(next === "note" || next === "type" ? "asc" : "desc");
  }

  function requestAssignmentSort(next: AssignmentSortKey): void {
    if (next === assignmentSortKey) return setAssignmentSortDirection((current) => current === "asc" ? "desc" : "asc");
    setAssignmentSortKey(next);
    setAssignmentSortDirection(next === "scope" || next === "target" ? "asc" : "desc");
  }

  async function removeEntry(entry: MediaFundingEntry): Promise<void> {
    if (!window.confirm("Delete this balance adjustment?")) return;
    setError(null);
    const response = await fetch(`${apiBase}/media-funding/entries/${encodeURIComponent(entry.id)}`, { method: "DELETE" });
    if (!response.ok) return setError(await apiErrorMessage(response, "Balance adjustment could not be deleted"));
    await loadData();
  }

  async function removeProvider(provider: MediaFundingProvider): Promise<void> {
    if (!window.confirm(`Delete the funding-provider setup for ${provider.name}?`)) return;
    setError(null);
    const response = await fetch(`${apiBase}/media-funding/providers/${encodeURIComponent(provider.id)}`, { method: "DELETE" });
    if (!response.ok) return setError(await apiErrorMessage(response, "Funding provider could not be deleted"));
    setSelectedProviderId("");
    await loadData();
  }

  async function removeAssignment(assignment: MediaFundingAssignment): Promise<void> {
    const label = assignment.accountName ?? assignment.businessManagerName ?? assignment.targetKey;
    if (!window.confirm(`Remove the funding assignment for ${label}? Historical allocated spend will be recalculated.`)) return;
    setError(null);
    const response = await fetch(`${apiBase}/media-funding/assignments/${encodeURIComponent(assignment.id)}`, { method: "DELETE" });
    if (!response.ok) return setError(await apiErrorMessage(response, "Funding assignment could not be removed"));
    await loadData();
  }

  return (
    <section className="media-funding-page">
      <header className="media-spend-page-header">
        <div>
          <div className="media-spend-eyebrow"><span>Cash flow</span><Badge variant="outline">Live</Badge><Badge variant="outline">Estimated</Badge></div>
          <div className="media-spend-title-row">
            <h2>Provider balances</h2>
            <InfoPopover label="provider balances">
              <span>Posted or settled outgoing bank transactions categorized as Ad account funding and matched to the linked supplier become funding credits automatically.</span>
              <span>Available balance equals opening balance plus fee-adjusted bank funding and adjustments, minus LemonMax spend assigned to the provider.</span>
              <span>This derived balance does not create or duplicate cash transactions in official bank or analytics totals.</span>
            </InfoPopover>
          </div>
        </div>
        <Button className="primary-button" onClick={() => setProviderDialog("new")} type="button"><Plus size={15} /> Add provider</Button>
      </header>

      {error && <div className="income-callout warning media-spend-alert" role="alert"><CircleAlert size={17} /><span>{error}</span></div>}

      <div className="media-spend-summary" aria-label="Provider balance summary">
        <article className="media-spend-summary-card total"><span className="media-spend-summary-icon"><WalletCards size={17} /></span><div><span>Estimated balance</span><strong>{data ? money(data.summary.estimatedBalance, data.currency) : "—"}</strong></div></article>
        <article className="media-spend-summary-card"><span className="media-spend-summary-icon"><BanknoteArrowUp size={17} /></span><div><span>Net bank funding</span><strong>{data ? money(data.summary.netFunding, data.currency) : "—"}</strong></div></article>
        <article className="media-spend-summary-card"><span className="media-spend-summary-icon"><BadgeDollarSign size={17} /></span><div><span>Assigned spend</span><strong>{data ? money(data.summary.spend, data.currency) : "—"}</strong></div></article>
        <article className="media-spend-summary-card"><span className="media-spend-summary-icon"><ReceiptText size={17} /></span><div><span>Provider fees</span><strong>{data ? money(data.summary.fees, data.currency) : "—"}</strong></div></article>
      </div>

      <section className="panel media-funding-panel">
        <div className="media-funding-panel-header">
          <div><strong>Funding providers</strong><span>{data?.coveredThrough ? `LemonMax spend through ${dateLabel(data.coveredThrough)}` : "Awaiting LemonMax spend coverage"}</span></div>
          <div className="media-funding-detail-actions">
            <Button className="secondary-button" onClick={() => onOpenBankFunding()} type="button"><ReceiptText size={15} /> Review bank funding</Button>
            <Button className="secondary-button" onClick={onOpenMediaSpend} type="button"><Landmark size={15} /> Assign BMs and accounts</Button>
          </div>
        </div>
        {isLoading && !data ? (
          <div className="media-spend-loading"><Loader2 className="spin" size={22} /><span>Loading provider balances</span></div>
        ) : providers.length === 0 ? (
          <div className="empty-state media-funding-empty"><CircleDollarSign size={24} /><strong>No funding providers yet</strong></div>
        ) : (
          <div className="table-wrap media-funding-table-wrap">
            <table className="data-table dense media-funding-table">
              <thead><tr>
                <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="provider">Provider</SortableTableHead>
                <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={requestSort} sortKey="fee">Fee</SortableTableHead>
                <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={requestSort} sortKey="opening">Opening</SortableTableHead>
                <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={requestSort} sortKey="funded">Net funded</SortableTableHead>
                <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={requestSort} sortKey="spend">Spend</SortableTableHead>
                <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={requestSort} sortKey="balance">Balance</SortableTableHead>
                <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={requestSort} sortKey="assignments">Assignments</SortableTableHead>
              </tr></thead>
              <tbody>{providers.map((provider) => (
                <tr className={selectedProviderId === provider.id ? "selected" : ""} key={provider.id}>
                  <td><button className="bank-group-drilldown" onClick={() => setSelectedProviderId(provider.id)} type="button"><span><FundingProviderBadge provider={provider} /><small>{provider.bankFundingCount.toLocaleString()} bank payments · opening {dateLabel(provider.openingBalanceDate)}</small></span></button></td>
                  <td className="amount">{provider.defaultFeePercent.toLocaleString(undefined, { maximumFractionDigits: 4 })}%</td>
                  <td className="amount">{money(provider.openingBalance, provider.currency)}</td>
                  <td className="amount">{money(provider.netFunding, provider.currency)}</td>
                  <td className="amount">{money(provider.spend, provider.currency)}</td>
                  <td className={`amount media-funding-balance ${provider.estimatedBalance < 0 ? "negative" : ""}`}>{money(provider.estimatedBalance, provider.currency)}</td>
                  <td className="amount">{provider.assignmentCount.toLocaleString()}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      {selectedProvider && (
        <section className="panel media-funding-detail">
          <div className="media-funding-detail-header">
            <div><FundingProviderBadge provider={selectedProvider} /><span>Live bank funding and assigned LemonMax spend</span></div>
            <div className="media-funding-detail-actions">
              <Button aria-label={`Delete ${selectedProvider.name}`} className="icon-button danger" onClick={() => void removeProvider(selectedProvider)} type="button"><Trash2 size={14} /></Button>
              <Button className="secondary-button" onClick={() => setProviderDialog(selectedProvider)} type="button"><Pencil size={14} /> Edit</Button>
              <Button className="secondary-button" onClick={() => setAdjustmentDialogOpen(true)} type="button"><Plus size={14} /> Adjustment</Button>
              <Button className="primary-button" onClick={() => onOpenBankFunding(selectedProvider.name, shiftFinanceOperatingDate(selectedProvider.openingBalanceDate, 1))} type="button"><ReceiptText size={14} /> Review bank funding</Button>
            </div>
          </div>
          {selectedProvider.excludedFundingCount > 0 && (
            <div className="income-callout warning media-spend-alert" role="alert"><CircleAlert size={17} /><span>{selectedProvider.excludedFundingCount.toLocaleString()} matched funding transaction(s) use a non-USD currency and are excluded until converted or corrected.</span></div>
          )}
          <div className="media-funding-detail-metrics">
            <div><span>Gross bank paid</span><strong>{money(selectedProvider.grossFunding, selectedProvider.currency)}</strong></div>
            <div><span>Fees deducted</span><strong>{money(selectedProvider.fees, selectedProvider.currency)}</strong></div>
            <div><span>Adjustments</span><strong>{money(selectedProvider.adjustments, selectedProvider.currency)}</strong></div>
            <div><span>Available</span><strong className={selectedProvider.estimatedBalance < 0 ? "negative" : ""}>{money(selectedProvider.estimatedBalance, selectedProvider.currency)}</strong></div>
          </div>

          <div className="media-funding-detail-section">
            <div className="media-funding-section-title"><strong>Balance activity</strong><span>{selectedActivities.length.toLocaleString()} bank payments and adjustments</span></div>
            {selectedActivities.length === 0 ? <div className="empty-state compact"><ReceiptText size={20} /><strong>No bank funding or adjustments after the opening date</strong></div> : (
              <div className="table-wrap media-funding-ledger-wrap">
                <table className="data-table dense media-funding-ledger-table">
                  <thead><tr>
                    <SortableTableHead activeSortKey={activitySortKey} direction={activitySortDirection} onSort={requestActivitySort} sortKey="date">Date</SortableTableHead>
                    <SortableTableHead activeSortKey={activitySortKey} direction={activitySortDirection} onSort={requestActivitySort} sortKey="type">Source</SortableTableHead>
                    <SortableTableHead activeSortKey={activitySortKey} className="amount" direction={activitySortDirection} onSort={requestActivitySort} sortKey="payment">Payment</SortableTableHead>
                    <SortableTableHead activeSortKey={activitySortKey} className="amount" direction={activitySortDirection} onSort={requestActivitySort} sortKey="fee">Fee</SortableTableHead>
                    <SortableTableHead activeSortKey={activitySortKey} className="amount" direction={activitySortDirection} onSort={requestActivitySort} sortKey="net">Balance change</SortableTableHead>
                    <SortableTableHead activeSortKey={activitySortKey} direction={activitySortDirection} onSort={requestActivitySort} sortKey="note">Details</SortableTableHead>
                    <th aria-label="Actions" />
                  </tr></thead>
                  <tbody>{selectedActivities.map((activity) => activity.kind === "bank" ? (
                    <tr key={`bank-${activity.item.id}`}>
                      <td>{dateLabel(activity.item.date)}</td>
                      <td><span className="source-pill">{activity.item.source}</span></td>
                      <td className="amount">{money(activity.item.grossAmount, activity.item.currency)}</td>
                      <td className="amount">{money(activity.item.feeAmount, activity.item.currency)}<small>{activity.item.feePercent.toLocaleString(undefined, { maximumFractionDigits: 4 })}%</small></td>
                      <td className="amount">{money(activity.item.netAmount, activity.item.currency)}</td>
                      <td><strong>{activity.item.counterparty}</strong><small>{activity.item.description} · {activity.item.accountName}</small></td>
                      <td />
                    </tr>
                  ) : (
                    <tr key={`adjustment-${activity.item.id}`}>
                      <td>{dateLabel(activity.item.date)}</td>
                      <td><span className="source-pill">Adjustment</span></td>
                      <td className="amount">—</td>
                      <td className="amount">—</td>
                      <td className={`amount ${activity.item.netAmount < 0 ? "negative" : ""}`}>{money(activity.item.netAmount, selectedProvider.currency)}</td>
                      <td>{activity.item.note ?? "—"}</td>
                      <td><Button aria-label="Delete balance adjustment" className="icon-button danger" onClick={() => void removeEntry(activity.item)} type="button"><Trash2 size={14} /></Button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>

          <div className="media-funding-detail-section">
            <div className="media-funding-section-title"><strong>Assignments</strong><span>{selectedAssignments.length.toLocaleString()} historical and current</span></div>
            {selectedAssignments.length === 0 ? (
              <div className="empty-state compact"><Landmark size={20} /><strong>No BMs or ad accounts assigned</strong><Button className="secondary-button" onClick={onOpenMediaSpend} type="button">Open media spend</Button></div>
            ) : (
              <div className="table-wrap media-funding-ledger-wrap">
                <table className="data-table dense media-funding-ledger-table">
                  <thead><tr>
                    <SortableTableHead activeSortKey={assignmentSortKey} direction={assignmentSortDirection} onSort={requestAssignmentSort} sortKey="scope">Scope</SortableTableHead>
                    <SortableTableHead activeSortKey={assignmentSortKey} direction={assignmentSortDirection} onSort={requestAssignmentSort} sortKey="target">BM or ad account</SortableTableHead>
                    <SortableTableHead activeSortKey={assignmentSortKey} direction={assignmentSortDirection} onSort={requestAssignmentSort} sortKey="from">Effective from</SortableTableHead>
                    <SortableTableHead activeSortKey={assignmentSortKey} direction={assignmentSortDirection} onSort={requestAssignmentSort} sortKey="to">Effective to</SortableTableHead>
                    <th aria-label="Actions" />
                  </tr></thead>
                  <tbody>{selectedAssignments.map((assignment) => (
                    <tr key={assignment.id}>
                      <td><span className="source-pill">{assignment.scope === "business_manager" ? "BM" : "Ad account"}</span></td>
                      <td><strong>{assignment.accountName ?? assignment.businessManagerName ?? "Unnamed"}</strong><small>{assignment.accountId ?? assignment.businessManagerId}</small></td>
                      <td>{dateLabel(assignment.effectiveFrom)}</td>
                      <td>{assignment.effectiveTo ? dateLabel(assignment.effectiveTo) : "Current"}</td>
                      <td><Button aria-label="Remove funding assignment" className="icon-button danger" onClick={() => void removeAssignment(assignment)} type="button"><Trash2 size={14} /></Button></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}

      {providerDialog && (
        <FundingProviderDialog
          apiBase={apiBase}
          companies={companies}
          configuredCompanyIds={(data?.providers ?? []).map((item) => item.companyProviderId)}
          coveredThrough={data?.coveredThrough}
          provider={providerDialog === "new" ? undefined : providerDialog}
          onClose={() => setProviderDialog(null)}
          onOpenCompanies={onOpenCompanies}
          onSaved={async (providerId) => {
            setProviderDialog(null);
            if (providerId) setSelectedProviderId(providerId);
            await loadData();
          }}
        />
      )}
      {adjustmentDialogOpen && selectedProvider && (
        <FundingAdjustmentDialog
          apiBase={apiBase}
          provider={selectedProvider}
          onClose={() => setAdjustmentDialogOpen(false)}
          onSaved={async () => {
            setAdjustmentDialogOpen(false);
            await loadData();
          }}
        />
      )}
    </section>
  );
}

function FundingProviderDialog({
  apiBase,
  companies,
  configuredCompanyIds,
  coveredThrough,
  provider,
  onClose,
  onOpenCompanies,
  onSaved
}: {
  apiBase: string;
  companies: Provider[];
  configuredCompanyIds: string[];
  coveredThrough?: string;
  provider?: MediaFundingProvider;
  onClose: () => void;
  onOpenCompanies: () => void;
  onSaved: (providerId?: string) => Promise<void>;
}) {
  const supplierCompanies = useMemo(() => companies
    .filter((company) => company.type === "supplier" && (company.id === provider?.companyProviderId || !configuredCompanyIds.includes(company.id)))
    .sort((left, right) => left.name.localeCompare(right.name)), [companies, configuredCompanyIds, provider?.companyProviderId]);
  const [companyProviderId, setCompanyProviderId] = useState(provider?.companyProviderId ?? supplierCompanies[0]?.id ?? "");
  const [feePercent, setFeePercent] = useState(provider ? String(provider.defaultFeePercent) : "0");
  const [openingBalance, setOpeningBalance] = useState(provider ? String(provider.openingBalance) : "0");
  const [openingBalanceDate, setOpeningBalanceDate] = useState(provider?.openingBalanceDate ?? coveredThrough ?? shiftFinanceOperatingDate(financeOperatingDate(), -1));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsedFee = Number(feePercent);
  const parsedOpening = Number(openingBalance);
  const valid = Boolean(companyProviderId)
    && Number.isFinite(parsedFee) && parsedFee >= 0 && parsedFee < 100
    && Number.isFinite(parsedOpening) && parsedOpening >= 0
    && Boolean(openingBalanceDate) && openingBalanceDate <= financeOperatingDate();

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!valid) return;
    setSubmitting(true);
    setError(null);
    const payload: CreateMediaFundingProviderPayload = { companyProviderId, defaultFeePercent: parsedFee, openingBalance: parsedOpening, openingBalanceDate };
    try {
      if (provider) {
        await sendJson(`${apiBase}/media-funding/providers/${encodeURIComponent(provider.id)}`, "PATCH", payload);
        await onSaved();
      } else {
        const result = await sendJson<{ id: string }>(`${apiBase}/media-funding/providers`, "POST", payload);
        await onSaved(result.id);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Funding provider could not be saved");
      setSubmitting(false);
    }
  }

  return createPortal(
    <div className="modal-backdrop" role="presentation">
      <form className="modal media-funding-modal" role="dialog" aria-modal="true" aria-labelledby="funding-provider-title" onSubmit={(event) => void submit(event)}>
        <div className="modal-header"><div><p className="eyebrow">Media funding</p><h2 id="funding-provider-title">{provider ? "Edit provider" : "Add funding provider"}</h2></div><Button aria-label="Close" className="icon-button" onClick={onClose} type="button"><X size={18} /></Button></div>
        {error && <div className="inline-error">{error}</div>}
        {supplierCompanies.length === 0 ? (
          <div className="empty-state compact"><CircleDollarSign size={20} /><strong>Add a supplier company first</strong><Button className="secondary-button" onClick={() => { onClose(); onOpenCompanies(); }} type="button">Open companies</Button></div>
        ) : (
          <label>Supplier company<NativeSelect value={companyProviderId} onValueChange={setCompanyProviderId}>{supplierCompanies.map((company) => <NativeSelectOption key={company.id} value={company.id}>{company.name}</NativeSelectOption>)}</NativeSelect></label>
        )}
        <div className="form-grid">
          <label>Default fee %<Input min="0" max="99.99" step="0.0001" type="number" value={feePercent} onChange={(event) => setFeePercent(event.target.value)} /></label>
          <label>Currency<Input disabled value="USD" /></label>
        </div>
        <div className="form-grid">
          <label>Opening balance<Input min="0" step="0.01" type="number" value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} /></label>
          <label>Balance as of<CalendarDatePicker ariaLabel="Choose balance date" max={financeOperatingDate()} value={openingBalanceDate} onChange={setOpeningBalanceDate} /></label>
        </div>
        <p className="field-help">The opening balance includes all payments, fees, and spend through this date. Starting the next day, matched bank funding and assigned LemonMax spend update the balance automatically. Changing the fee recalculates all included bank funding after the opening date.</p>
        <div className="modal-actions"><Button className="secondary-button" disabled={submitting} onClick={onClose} type="button">Cancel</Button><Button className="primary-button" disabled={submitting || !valid} type="submit">{submitting ? <Loader2 className="spin" size={15} /> : <Plus size={15} />} Save provider</Button></div>
      </form>
    </div>,
    document.body
  );
}

function FundingAdjustmentDialog({
  apiBase,
  provider,
  onClose,
  onSaved
}: {
  apiBase: string;
  provider: MediaFundingProvider;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const firstAllowedDate = shiftFinanceOperatingDate(provider.openingBalanceDate, 1);
  const defaultDate = financeOperatingDate() < firstAllowedDate ? firstAllowedDate : financeOperatingDate();
  const [date, setDate] = useState(defaultDate);
  const [amount, setAmount] = useState("");
  const [direction, setDirection] = useState<"credit" | "debit">("credit");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const parsedAmount = Number(amount);
  const valid = amount.trim() !== "" && Number.isFinite(parsedAmount) && parsedAmount > 0
    && date >= firstAllowedDate && date <= financeOperatingDate() && Boolean(note.trim());

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!valid) return;
    setSubmitting(true);
    setError(null);
    const payload: CreateMediaFundingEntryPayload = {
      providerId: provider.id,
      type: "adjustment",
      date,
      adjustmentAmount: direction === "credit" ? parsedAmount : -parsedAmount,
      note: note.trim()
    };
    try {
      await sendJson(`${apiBase}/media-funding/entries`, "POST", payload);
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Balance adjustment could not be saved");
      setSubmitting(false);
    }
  }

  return createPortal(
    <div className="modal-backdrop" role="presentation">
      <form className="modal media-funding-modal" role="dialog" aria-modal="true" aria-labelledby="funding-adjustment-title" onSubmit={(event) => void submit(event)}>
        <div className="modal-header"><div><p className="eyebrow">{provider.name}</p><h2 id="funding-adjustment-title">Add balance adjustment</h2></div><Button aria-label="Close" className="icon-button" onClick={onClose} type="button"><X size={18} /></Button></div>
        {error && <div className="inline-error">{error}</div>}
        <div className="form-grid">
          <label>Date<Input min={firstAllowedDate} max={financeOperatingDate()} type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <label>Direction<NativeSelect value={direction} onValueChange={(value) => setDirection(value as "credit" | "debit")}><NativeSelectOption value="credit">Increase balance</NativeSelectOption><NativeSelectOption value="debit">Decrease balance</NativeSelectOption></NativeSelect></label>
        </div>
        <label>Adjustment amount<Input autoFocus min="0.01" step="0.01" type="number" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
        <label>Reason<Textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Required reason for this correction" /></label>
        <div className="modal-actions"><Button className="secondary-button" disabled={submitting} onClick={onClose} type="button">Cancel</Button><Button className="primary-button" disabled={submitting || !valid} type="submit">{submitting ? <Loader2 className="spin" size={15} /> : <Plus size={15} />} Save adjustment</Button></div>
      </form>
    </div>,
    document.body
  );
}
