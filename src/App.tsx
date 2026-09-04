import {
  ArrowDownUp,
  ArrowDownRight,
  ArrowUpRight,
  BadgeDollarSign,
  Banknote,
  BookOpen,
  Building2,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleDollarSign,
  CreditCard,
  Download,
  FileText,
  FilePlus2,
  Home,
  ReceiptText,
  Info,
  KeyRound,
  Landmark,
  Link2,
  Loader2,
  LogOut,
  Moon,
  PanelRightOpen,
  Pencil,
  Pin,
  PieChart,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  Upload,
  UserRound,
  WalletCards,
  X
} from "lucide-react";
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { Menu } from "@base-ui/react/menu";
import {
  Fragment,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { BankPeriodPicker, CalendarPeriodPicker } from "@/components/ui/calendar-period-picker";
import { Checkbox } from "@/components/ui/checkbox";
import { ActiveFilterBar, type ActiveFilter, FilterFieldGroup, FilterPopover, ToolbarSearchField } from "@/components/ui/filter-toolbar";
import { AnimatedNumber, InfoPopover } from "@/components/ui/finance-visuals";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { compareTableValues, SortableTableHead } from "@/components/ui/sortable-table-head";
import { Textarea } from "@/components/ui/textarea";
import { useUrlDateRangeState, useUrlState } from "@/lib/url-state";
import type {
  AiPromptPayload,
  AiPromptResult,
  BankAnalyticsAggregate,
  BankAnalyticsCategoryCompaniesPage,
  BankAnalyticsRelationship,
  BankAnalyticsSnapshot,
  BankPeriodDirectionMetrics,
  BankPeriodMetrics,
  BankPeriodSourceMetrics,
  BulkRecordInvoicePaymentsPayload,
  CreateExpensePayload,
  CreateHoldingPayload,
  CreateInvoicePayload,
  CreateManualReceivablePayload,
  CreateRevenuePartnerPayload,
  CreateProviderPayload,
  CreateTeamPayload,
  CreateTransactionCategoryPayload,
  CurrencyTotals,
  DataSource,
  DashboardSession,
  DashboardSnapshot,
  DeleteInvoicesPayload,
  DraftRevenueRunPayload,
  ExpenseRecord,
  FxRate,
  ImportWiseStatementPayload,
  ImportWiseStatementResult,
  Invoice,
  MeritSendMode,
  MeritTax,
  MatchInvoicePaymentPayload,
  OpenRouterZdrModel,
  ProfitDistributionAdjustment,
  ProfitDistributionBucket,
  ProfitDistributionPartnerId,
  ProfitDistributionPartnerLedger,
  Provider,
  ProviderType,
  RevenuePartner,
  RevenuePullResult,
  RevenueRun,
  RecordInvoicePaymentPayload,
  SaveProfitDistributionAdjustmentPayload,
  SaveAiSettingsPayload,
  SaveCashFlowSnapshotPayload,
  CashFlowSnapshot,
  SendInvoicesPayload,
  SendInvoicesResult,
  SyncRevenuePayload,
  Team,
  Transaction,
  TransactionCategory,
  TransactionReviewBootstrap,
  TransactionReviewCompany,
  TransactionMatchFilter,
  TransactionPage,
  TransactionSortKey,
  TransactionOverrideScope,
  UpdateHoldingPayload,
  UpdateInvoicePayload,
  UpdateProviderPayload,
  UpdateRevenuePartnerPayload,
  UpdateTransactionCategoryDefinitionPayload,
  WiseEntity
} from "../shared/types";
import type {
  BankActivityGroupType,
  BankActivitySummary,
  BankCardGroupSummary,
  BankMerchantGroupSummary
} from "../shared/bankMerchantGroups";
import { type BankSource, bankSourceLabel, bankSources, isBankSource } from "../shared/banks";
import { financeOperatingDate, shiftFinanceOperatingDate } from "../shared/operatingDate";
import {
  isRequiredTransactionCategory,
  isReviewOnlyTransactionCategory,
  transactionBusinessCategory,
  transactionCategoryOptionsForDirection
} from "../shared/categories";
import { combineCurrencyTotals, convertCurrencyTotalsToUsd, hasCurrencyTotals, sumCurrencyTotals } from "../shared/currencyTotals";
import {
  analyticsCategoryPieGroups,
  categoryDonutSegmentPath,
  type CategoryPieGroup,
  type CategoryPieSegment
} from "../shared/categoryPie";
import {
  analyticsCurrentPeriodRanges,
  analyticsDateRange,
  analyticsPeriodLabel,
  analyticsPeriodModes,
  analyticsPresetWarmRanges,
  type AnalyticsDateRange,
  type AnalyticsPeriodMode,
  type AnalyticsPeriodSelection
} from "../shared/analyticsPeriod";
import {
  profitDistributionAdjustmentId,
  profitDistributionBucketLabels,
  profitDistributionPartners
} from "../shared/distribution";
import {
  hasNonZeroAccountBalance,
  isLiquidAccountBalance,
  latestIncomeAutomationTimestamp,
  unreadIncomeAutomationCount
} from "../shared/income";
import {
  revolutDefaultActivityWindowDays,
  type RevolutTransactionDateRange
} from "../shared/revolutApi";
import {
  slashDefaultActivityWindowDays,
  type SlashTransactionDateRange
} from "../shared/slashApi";
import {
  isInternalTransferTransaction,
  isNonOperatingMovementTransaction,
  transactionCounterpartyLabel,
  transactionDescriptionLabel,
  transactionMovementLabel
} from "../shared/transactionPresentation";
import {
  parseWiseStatementCsv,
  prepareWiseStatementImport
} from "../shared/wiseStatements";
import {
  verifyWiseStatementAccount,
  wiseEntities,
  wiseEntityLabel,
  wiseEntityShortLabel,
  wiseEntityViews,
  wiseStatementAccountCoverage,
  type WiseEntityView
} from "../shared/wiseEntities";
import { AllBankTransactionsView, HoldingsView } from "@/features/banking/BankingViews";
import {
  BankAccountActivityView,
  BankActivityViewToggle,
  BankCardActivityView,
  BankMerchantGroupView,
  bankActivityViewModes,
  type BankActivityViewMode
} from "@/features/banking/BankActivityViews";
import { exportBankTransactionsCsv } from "@/features/banking/exportTransactions";
import { InvoicesView as IncomeInvoicesView, RevenueView as IncomeRevenueView } from "@/features/income/IncomeViews";
import { ExpenseEditorDialog, ExpensesView } from "@/features/expenses/ExpensesView";
import { ManagementReportView } from "@/features/management-report/ManagementReportView";
import { CashFlowOpenInvoicesView, CashFlowPositionView } from "@/features/cash-flow/CashFlowViews";
import { MediaFundingView } from "@/features/media-funding/MediaFundingView";
import { MediaSpendView } from "@/features/media-spend/MediaSpendView";

const apiBase = import.meta.env.VITE_API_BASE || "/api";
const activeTabs = ["overview", "management", "media-spend", "media-funding", "banks", "analytics", "distribution", "cash-flow", "cash-flow-invoices", "revenue", "invoices", "expenses", "providers", "settings"] as const;
type ActiveTab = (typeof activeTabs)[number];
type BankTab = "all" | BankSource | "holdings";
type ThemeMode = "light" | "dark";
type SortDirection = "asc" | "desc";
type BankTransactionDateRange = {
  fromDate: string;
  toDate: string;
};
type TransactionPageRequest = {
  key: string;
  dateRange: BankTransactionDateRange;
  source?: BankSource;
  direction?: "in" | "out";
  wiseEntity?: WiseEntity;
  accountId?: string;
  category?: string;
  team?: string;
  match: TransactionMatchFilter;
  search?: string;
  groupType?: BankActivityGroupType;
  groupKey?: string;
  sortKey: TransactionSortKey;
  order: SortDirection;
};
type BankPeriodActivityMetrics = Pick<BankPeriodSourceMetrics, "moneyIn" | "moneyOut">;
type TransactionPageState = {
  requestKey: string;
  transactions: Transaction[];
  cursor: string | null;
  previousCursors: Array<string | null>;
  continueCursor: string | null;
  isDone: boolean;
  totalCount?: number;
  failedCursor?: string | null;
  failedNavigation?: TransactionPageNavigation;
  isLoading: boolean;
  error: string | null;
};
type TransactionPageNavigation = "reset" | "next" | "previous";
type BankActivitySummaryState = {
  requestKey: string;
  summary: BankActivitySummary | null;
  isLoading: boolean;
  error: string | null;
};
type TransactionDetailPopover = {
  id: string;
  title: string;
  details: string[];
  left: number;
  top: number;
  placement: "above" | "below";
};
type CategorySearchMenuPosition = {
  left: number;
  top: number;
  width: number;
  placement: "above" | "below";
};
type DirectoryDeleteTarget =
  | { kind: "provider"; provider: Provider }
  | { kind: "revenue-partner"; partner: RevenuePartner };
const themeStorageKey = "finance-dash-theme";
const incomeAutomationReadStorageKey = "finance-dash-income-automation-read-at";
const bankTabs: readonly BankTab[] = ["all", "wise", "revolut", "slash", "amex", "holdings"];
const transactionSortKeys: readonly TransactionSortKey[] = [
  "account",
  "amount",
  "category",
  "company",
  "counterparty",
  "date",
  "direction",
  "document",
  "match",
  "period",
  "source",
  "team"
];
const transactionTablePageSize = 100;
const analyticsBuildDefaultRetryMs = 1_000;
const analyticsLiveRefreshMs = 5 * 60_000;
const analyticsMonthOptions = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"
] as const;

type AnalyticsCategoryView = {
  direction: "in" | "out";
  category: string;
};

function analyticsCategoryViewValue(selection: AnalyticsCategoryView): string {
  return `${selection.direction}:${selection.category}`;
}

type AnalyticsCategoryCompanyView = {
  companyKey: string;
  providerId?: string;
  merchantName: string;
  nativeTotals: CurrencyTotals;
  amountUsd: number;
  transactionCount: number;
};

function localIsoDate(daysFromToday = 0): string {
  return shiftFinanceOperatingDate(financeOperatingDate(), daysFromToday);
}

function defaultBankTransactionDateRange(windowDays: number): BankTransactionDateRange {
  return {
    fromDate: localIsoDate(1 - windowDays),
    toDate: localIsoDate()
  };
}

function defaultRevolutTransactionDateRange(): RevolutTransactionDateRange {
  return defaultBankTransactionDateRange(revolutDefaultActivityWindowDays);
}

function defaultSlashTransactionDateRange(): SlashTransactionDateRange {
  return defaultBankTransactionDateRange(slashDefaultActivityWindowDays);
}

async function apiErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: string } | null;
  return body?.message || fallback;
}

function analyticsRetryAfterMs(value: string | null, now = Date.now()): number {
  if (!value) return analyticsBuildDefaultRetryMs;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000);
  const retryAt = Date.parse(value);
  return Number.isNaN(retryAt) ? analyticsBuildDefaultRetryMs : Math.max(0, retryAt - now);
}

function waitForAnalyticsRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    const abort = () => {
      window.clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function analyticsSnapshotKey(range: AnalyticsDateRange): string {
  return `${range.fromDate}:${range.toDate}`;
}

async function fetchAnalyticsSnapshotRange(
  range: AnalyticsDateRange,
  signal: AbortSignal,
  onBuildReason?: (reason: "historical-coverage" | "snapshot") => void
): Promise<BankAnalyticsSnapshot> {
  const query = new URLSearchParams({
    fromDate: range.fromDate,
    toDate: range.toDate
  });
  while (!signal.aborted) {
    const response = await fetch(`${apiBase}/analytics?${query.toString()}`, { signal });
    if (response.status === 202) {
      const body = (await response.json().catch(() => null)) as { status?: string; reason?: string } | null;
      if (body?.status !== "building") {
        throw new Error("Analytics returned an invalid build status");
      }
      onBuildReason?.(body.reason === "historical-coverage" ? "historical-coverage" : "snapshot");
      await waitForAnalyticsRetry(analyticsRetryAfterMs(response.headers.get("Retry-After")), signal);
      continue;
    }
    if (!response.ok) {
      throw new Error(await apiErrorMessage(response, "Analytics snapshot could not be loaded"));
    }
    const snapshot = (await response.json()) as BankAnalyticsSnapshot;
    if (
      snapshot.version !== 3
      || snapshot.fromDate !== range.fromDate
      || snapshot.toDate !== range.toDate
    ) {
      throw new Error("Analytics returned a snapshot for the wrong period");
    }
    return snapshot;
  }
  throw new DOMException("Aborted", "AbortError");
}

const timezoneOptions = [
  { label: "GMT zero", value: "UTC" },
  { label: "Eastern Time", value: "America/New_York" },
  { label: "London", value: "Europe/London" },
  { label: "Lebanon", value: "Asia/Beirut" },
  { label: "Dubai", value: "Asia/Dubai" },
  { label: "Los Angeles", value: "America/Los_Angeles" }
];

function money(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(value);
}

function optionalMoney(value: number | null | undefined, currency = "USD"): string {
  return typeof value === "number" ? money(value, currency) : "—";
}

function formatCurrencyTotals(totals: CurrencyTotals): string {
  const values = Object.entries(totals).sort(([left], [right]) => left.localeCompare(right));
  return values.length > 0 ? values.map(([currency, total]) => money(total, currency)).join(" · ") : "—";
}

function formatUsdCurrencyTotal(totals: CurrencyTotals, rates: FxRate[], emptyValue = "—"): string {
  if (!hasCurrencyTotals(totals)) return emptyValue;
  const conversion = convertCurrencyTotalsToUsd(totals, rates);
  const amount = money(conversion.totalUsd, "USD");
  return conversion.excludedCurrencies.length > 0 ? `Partial ${amount}` : amount;
}

function nativeCurrencyBreakdown(totals: CurrencyTotals): string | undefined {
  const breakdown = formatCurrencyTotals(totals);
  return breakdown === "—" ? undefined : `Native: ${breakdown}`;
}

function negateCurrencyTotals(totals: CurrencyTotals): CurrencyTotals {
  return Object.fromEntries(Object.entries(totals).map(([currency, amount]) => [currency, -amount]));
}

function currencyTotalsTone(totals: CurrencyTotals): "good" | "danger" | "" {
  const amounts = Object.values(totals);
  const hasPositive = amounts.some((amount) => amount > 0);
  const hasNegative = amounts.some((amount) => amount < 0);
  if (hasPositive && !hasNegative) return "good";
  if (hasNegative && !hasPositive) return "danger";
  return "";
}

function maybeDate(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateLabel(value);
}

function compactMoney(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: value > 999999 ? 1 : 0,
    notation: "compact"
  }).format(value);
}

function dateLabel(value: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function dateTimeLabel(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function dateRangeLabel(start: string, end: string): string {
  if (start === end) return dateLabel(start);
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  if (startDate.getFullYear() !== endDate.getFullYear()) {
    return `${dateLabel(start)} – ${dateLabel(end)}`;
  }
  const compactStart = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric"
  }).format(startDate);
  if (startDate.getMonth() === endDate.getMonth()) {
    const compactEnd = new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      year: "numeric"
    }).format(endDate);
    return `${compactStart} – ${compactEnd}`;
  }
  const compactEnd = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(endDate);
  return `${compactStart} – ${compactEnd}`;
}

function monthLabel(value: string): string {
  return dateLabel(`${value}-01`);
}

function normalizeLookupName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function providerLabel(provider?: Provider): string {
  return provider ? provider.name : "Unmatched company";
}

function providerTypeLabel(type: ProviderType): string {
  const labels: Record<ProviderType, string> = {
    client: "Client",
    supplier: "Supplier"
  };
  return labels[type];
}

function providerTagLabel(provider?: Pick<Provider, "tags">): string {
  return provider?.tags.length ? provider.tags.join(" · ") : "No tags";
}

function providerTypeForTransaction(transaction: Pick<Transaction, "direction">): ProviderType {
  return transaction.direction === "in" ? "client" : "supplier";
}

function providerDueDate(provider?: Provider, issueDate = new Date().toISOString().slice(0, 10)): string {
  const date = new Date(`${issueDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + (provider?.paymentTermsDays ?? 30));
  return date.toISOString().slice(0, 10);
}

function effectiveCategory(transaction: Transaction): string {
  return transactionBusinessCategory(transaction.category);
}

function categoryNeedsReview(transaction: Transaction): boolean {
  return isReviewOnlyTransactionCategory(transaction.category);
}

function transactionCategoryChoices(
  currentCategory: string,
  direction: Transaction["direction"],
  categories: TransactionCategory[]
): string[] {
  const current = transactionBusinessCategory(currentCategory);
  const options = transactionCategoryOptionsForDirection(direction, categories);
  return options.includes(current) ? [...options] : [current, ...options];
}

function formatTransactionGroups(rows: Transaction[]): string {
  return groupedTransactionMoney(rows) || "—";
}

function bankInvoiceName(transaction: Transaction): string {
  return transaction.counterparty || transaction.rawName;
}

function sourceLabel(value: DataSource | string): string {
  return bankSourceLabel(value as DataSource);
}

function revenueTeamLabel(teamId: string | undefined, teamName: string | undefined, teamsById: Map<string, Team>): string {
  if (!teamId) return "Partner-level";
  return teamName || teamsById.get(teamId)?.name || teamId;
}

function groupedTransactionMoney(rows: Transaction[], direction?: Transaction["direction"]): string {
  const visibleRows = direction ? rows.filter((row) => row.direction === direction) : rows;
  return formatCurrencyTotals(sumCurrencyTotals(visibleRows, (row) => row.amount));
}

function emptyBankPeriodDirectionMetrics(): BankPeriodDirectionMetrics {
  return {
    transactionCount: 0,
    categorizedTransactionCount: 0,
    unassignedOwnerTransactionCount: 0,
    volume: {}
  };
}

function combineBankPeriodDirectionMetrics(
  moneyIn: BankPeriodDirectionMetrics,
  moneyOut: BankPeriodDirectionMetrics
): BankPeriodDirectionMetrics {
  return {
    transactionCount: moneyIn.transactionCount + moneyOut.transactionCount,
    categorizedTransactionCount: moneyIn.categorizedTransactionCount + moneyOut.categorizedTransactionCount,
    unassignedOwnerTransactionCount: moneyIn.unassignedOwnerTransactionCount + moneyOut.unassignedOwnerTransactionCount,
    volume: combineCurrencyTotals(moneyIn.volume, moneyOut.volume)
  };
}

function resolvedBankPeriodActivity(
  activity: BankPeriodActivityMetrics | null,
  ready: boolean
): BankPeriodActivityMetrics | null {
  if (activity) return activity;
  if (!ready) return null;
  return {
    moneyIn: emptyBankPeriodDirectionMetrics(),
    moneyOut: emptyBankPeriodDirectionMetrics()
  };
}

function groupedAccountMoney(rows: DashboardSnapshot["accounts"]): string {
  const totals = new Map<string, number>();
  for (const row of rows) {
    totals.set(row.currency, (totals.get(row.currency) ?? 0) + row.balance);
  }
  const values = [...totals.entries()].sort(([left], [right]) => left.localeCompare(right));
  return values.length > 0 ? values.map(([currency, total]) => money(total, currency)).join(" · ") : "—";
}

function groupedHoldingMoney(rows: DashboardSnapshot["holdings"]): string {
  const totals = new Map<string, { balance: number; assetType: DashboardSnapshot["holdings"][number]["assetType"] }>();
  for (const row of rows) {
    const asset = row.asset.toUpperCase();
    const current = totals.get(asset);
    totals.set(asset, { balance: (current?.balance ?? 0) + row.balance, assetType: row.assetType });
  }
  const values = [...totals.entries()].sort(([left], [right]) => left.localeCompare(right));
  return values.length > 0
    ? values.map(([asset, total]) => total.assetType === "fiat"
      ? money(total.balance, asset)
      : `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 }).format(total.balance)} ${asset}`
    ).join(" · ")
    : "—";
}

function formatShare(amount: number, total: number): string {
  if (total <= 0) return "0%";
  const share = (amount / total) * 100;
  return share < 1 ? "<1%" : `${share.toFixed(0)}%`;
}

function detailPopoverPosition(anchor: DOMRect): Pick<TransactionDetailPopover, "left" | "top" | "placement"> {
  const viewportPadding = 12;
  const gap = 8;
  const popoverWidth = Math.min(360, window.innerWidth - viewportPadding * 2);
  const popoverMinHeight = 150;
  const placement = anchor.bottom + gap + popoverMinHeight <= window.innerHeight - viewportPadding ? "below" : "above";
  const left = Math.min(
    Math.max(viewportPadding, anchor.left - 6),
    Math.max(viewportPadding, window.innerWidth - viewportPadding - popoverWidth)
  );
  const top = placement === "below" ? anchor.bottom + gap : anchor.top - gap;

  return { left, top, placement };
}

function categorySearchMenuPosition(anchor: DOMRect, visibleOptions: number): CategorySearchMenuPosition {
  const viewportPadding = 12;
  const gap = 4;
  const width = Math.min(Math.max(anchor.width, 244), window.innerWidth - viewportPadding * 2);
  const optionRows = Math.max(1, Math.min(visibleOptions, 6));
  const estimatedHeight = 58 + optionRows * 34;
  const placement = anchor.bottom + gap + estimatedHeight <= window.innerHeight - viewportPadding ? "below" : "above";
  const left = Math.min(
    Math.max(viewportPadding, anchor.left),
    Math.max(viewportPadding, window.innerWidth - viewportPadding - width)
  );
  const top = placement === "below" ? anchor.bottom + gap : anchor.top - gap;

  return { left, top, width, placement };
}

function App() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    return window.localStorage.getItem(themeStorageKey) === "dark" ? "dark" : "light";
  });
  const [dashboard, setDashboard] = useState<DashboardSnapshot | null>(null);
  const [session, setSession] = useState<DashboardSession | null>(null);
  const [transactionReview, setTransactionReview] = useState<TransactionReviewBootstrap | null>(null);
  const [activeTab, setActiveTab] = useUrlState<ActiveTab>("page", "overview", {
    allowedValues: activeTabs,
    history: "push"
  });
  const [incomeAutomationReadAt, setIncomeAutomationReadAt] = useState<string | undefined>(() => {
    return window.localStorage.getItem(incomeAutomationReadStorageKey) ?? undefined;
  });
  const [bankTab, setBankTab] = useUrlState<BankTab>("bankView", "all", {
    allowedValues: bankTabs,
    history: "push"
  });
  const [bankActivityView, setBankActivityView] = useUrlState<BankActivityViewMode>("bankMode", "transactions", {
    allowedValues: bankActivityViewModes
  });
  const [bankGroupType, setBankGroupType] = useUrlState<"" | BankActivityGroupType>("bankGroupType", "", {
    allowedValues: ["", "merchant", "card", "account"]
  });
  const [bankGroupKey, setBankGroupKey] = useUrlState("bankGroupKey", "");
  const [bankGroupLabel, setBankGroupLabel] = useUrlState("bankGroupLabel", "");
  const [allBankSource, setAllBankSource] = useUrlState<"all" | BankSource>("allBankSource", "all", {
    allowedValues: ["all", ...bankSources.map((source) => source.id)]
  });
  const [wiseEntityView, setWiseEntityView] = useUrlState<WiseEntityView>(
    "wiseEntity",
    "all",
    { allowedValues: wiseEntityViews }
  );
  const [bankDirection, setBankDirection] = useUrlState<"all" | "in" | "out">("bankDirection", "all", {
    allowedValues: ["all", "in", "out"]
  });
  const [teamFilter, setTeamFilter] = useUrlState("bankTeam", "all");
  const [bankAccountFilter, setBankAccountFilter] = useUrlState("bankAccount", "all");
  const [bankCategoryFilter, setBankCategoryFilter] = useUrlState("bankCategory", "all");
  const defaultRevolutRange = useMemo(defaultRevolutTransactionDateRange, []);
  const defaultSlashRange = useMemo(defaultSlashTransactionDateRange, []);
  const defaultAllBankRange = useMemo(
    () => defaultBankTransactionDateRange(revolutDefaultActivityWindowDays),
    []
  );
  const defaultWiseRange = useMemo(
    () => defaultBankTransactionDateRange(revolutDefaultActivityWindowDays),
    []
  );
  const [allBankDateRange, setAllBankDateRange] = useUrlDateRangeState(
    "allBankFrom",
    "allBankTo",
    defaultAllBankRange
  );
  const [wiseDateRange, setWiseDateRange] = useUrlDateRangeState(
    "wiseFrom",
    "wiseTo",
    defaultWiseRange
  );
  const [revolutDateRange, setRevolutDateRange] = useUrlDateRangeState(
    "revolutFrom",
    "revolutTo",
    defaultRevolutRange
  );
  const [slashDateRange, setSlashDateRange] = useUrlDateRangeState(
    "slashFrom",
    "slashTo",
    defaultSlashRange
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [transactionPageState, setTransactionPageState] = useState<TransactionPageState>({
    requestKey: "",
    transactions: [],
    cursor: null,
    previousCursors: [],
    continueCursor: null,
    isDone: true,
    isLoading: false,
    error: null
  });
  const transactionPageAbortRef = useRef<AbortController | null>(null);
  const transactionPageRequestVersionRef = useRef(0);
  const transactionPageRequestRef = useRef<TransactionPageRequest | null>(null);
  const [bankActivitySummaryState, setBankActivitySummaryState] = useState<BankActivitySummaryState>({
    requestKey: "",
    summary: null,
    isLoading: false,
    error: null
  });
  const bankActivitySummaryAbortRef = useRef<AbortController | null>(null);
  const [bankActivitySummaryRetry, setBankActivitySummaryRetry] = useState(0);
  const historicalSyncRequestKeysRef = useRef(new Set<string>());
  const [isImportingWise, setIsImportingWise] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useUrlState("bankQuery", "");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState(searchTerm);
  const [matchFilter, setMatchFilter] = useUrlState<TransactionMatchFilter>("bankMatch", "all", {
    allowedValues: ["needs-review", "matched", "all"]
  });
  const [transactionSortKey, setTransactionSortKey] = useUrlState<TransactionSortKey>("bankSort", "date", {
    allowedValues: transactionSortKeys
  });
  const [transactionSortDirection, setTransactionSortDirection] = useUrlState<SortDirection>("bankOrder", "desc", {
    allowedValues: ["asc", "desc"]
  });
  const isTransactionReviewer = session?.role === "transaction-reviewer";

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearchTerm(searchTerm), 300);
    return () => window.clearTimeout(timeout);
  }, [searchTerm]);

  const transactionPageRequest = useMemo<TransactionPageRequest | null>(() => {
    if ((!isTransactionReviewer && activeTab !== "banks") || (!isTransactionReviewer && bankTab === "holdings")) return null;
    const effectiveBankTab: Exclude<BankTab, "holdings"> = isTransactionReviewer || bankTab === "holdings"
      ? "all"
      : bankTab;
    const source = effectiveBankTab === "all"
      ? allBankSource === "all" ? undefined : allBankSource
      : effectiveBankTab;
    const direction = bankDirection !== "all" ? bankDirection : undefined;
    const dateRange = effectiveBankTab === "all"
      ? allBankDateRange
      : source === "wise"
        ? wiseDateRange
        : source === "revolut"
          ? revolutDateRange
          : source === "slash"
            ? slashDateRange
            : allBankDateRange;
    const wiseEntity = source === "wise" && wiseEntityView !== "all" ? wiseEntityView : undefined;
    const accountId = bankAccountFilter === "all" ? undefined : bankAccountFilter;
    const category = bankCategoryFilter === "all" ? undefined : bankCategoryFilter;
    const team = teamFilter === "all" ? undefined : teamFilter;
    const search = debouncedSearchTerm.trim() || undefined;
    const groupType = bankGroupType && bankGroupKey ? bankGroupType : undefined;
    const groupKey = groupType ? bankGroupKey : undefined;
    const request = {
      dateRange,
      ...(source ? { source } : {}),
      ...(direction ? { direction } : {}),
      ...(wiseEntity ? { wiseEntity } : {}),
      ...(accountId ? { accountId } : {}),
      ...(category ? { category } : {}),
      ...(team ? { team } : {}),
      ...(search ? { search } : {}),
      ...(groupType && groupKey ? { groupType, groupKey } : {}),
      match: matchFilter,
      sortKey: transactionSortKey,
      order: transactionSortDirection
    };
    return { ...request, key: JSON.stringify(request) };
  }, [
    activeTab,
    allBankSource,
    allBankDateRange,
    bankAccountFilter,
    bankCategoryFilter,
    bankDirection,
    bankGroupKey,
    bankGroupType,
    bankTab,
    debouncedSearchTerm,
    matchFilter,
    revolutDateRange,
    slashDateRange,
    teamFilter,
    transactionSortDirection,
    transactionSortKey,
    wiseDateRange,
    wiseEntityView,
    isTransactionReviewer
  ]);
  transactionPageRequestRef.current = transactionPageRequest;
  const [invoiceTransaction, setInvoiceTransaction] = useState<Transaction | null>(null);
  const [invoiceMatchTransaction, setInvoiceMatchTransaction] = useState<Transaction | null>(null);
  const [expenseTransaction, setExpenseTransaction] = useState<Transaction | null>(null);
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [editingRevenuePartner, setEditingRevenuePartner] = useState<RevenuePartner | null>(null);
  const [creatingRevenueRuleProviderId, setCreatingRevenueRuleProviderId] = useState<string | null>(null);
  const [directoryDeleteTarget, setDirectoryDeleteTarget] = useState<DirectoryDeleteTarget | null>(null);
  const [analyticsSnapshots, setAnalyticsSnapshots] = useState<Record<string, BankAnalyticsSnapshot>>({});
  const [analyticsBuildReasons, setAnalyticsBuildReasons] = useState<Record<string, "historical-coverage" | "snapshot">>({});
  const [analyticsDataRevision, setAnalyticsDataRevision] = useState(0);
  const analyticsSnapshotRequestsRef = useRef(new Map<string, Promise<BankAnalyticsSnapshot>>());

  function invalidateAnalyticsData(): void {
    setAnalyticsSnapshots({});
    setAnalyticsDataRevision((revision) => revision + 1);
  }

  const ensureAnalyticsSnapshot = useCallback((range: AnalyticsDateRange): Promise<BankAnalyticsSnapshot> => {
    const key = analyticsSnapshotKey(range);
    const existing = analyticsSnapshotRequestsRef.current.get(key);
    if (existing) return existing;

    const controller = new AbortController();
    let request: Promise<BankAnalyticsSnapshot>;
    request = fetchAnalyticsSnapshotRange(range, controller.signal, (reason) => {
      setAnalyticsBuildReasons((current) => current[key] === reason ? current : { ...current, [key]: reason });
    })
      .then((snapshot) => {
        setAnalyticsSnapshots((current) => current[key]?.generatedAt === snapshot.generatedAt
          ? current
          : { ...current, [key]: snapshot });
        return snapshot;
      })
      .finally(() => {
        if (analyticsSnapshotRequestsRef.current.get(key) === request) {
          analyticsSnapshotRequestsRef.current.delete(key);
        }
        setAnalyticsBuildReasons((current) => {
          if (!(key in current)) return current;
          const { [key]: _completed, ...remaining } = current;
          return remaining;
        });
      });
    analyticsSnapshotRequestsRef.current.set(key, request);
    return request;
  }, []);

  const bankPeriodRange = !isTransactionReviewer && activeTab === "banks" && bankTab !== "holdings"
    ? transactionPageRequest?.dateRange ?? null
    : null;
  const bankPeriodRangeKey = bankPeriodRange ? analyticsSnapshotKey(bankPeriodRange) : null;
  const bankPeriodMetrics = bankPeriodRangeKey
    ? analyticsSnapshots[bankPeriodRangeKey]?.bankPeriod ?? null
    : null;
  const [isLoadingBankPeriodMetrics, setIsLoadingBankPeriodMetrics] = useState(false);
  const [bankPeriodMetricsError, setBankPeriodMetricsError] = useState<string | null>(null);

  useEffect(() => {
    if (!bankPeriodRange) {
      setIsLoadingBankPeriodMetrics(false);
      setBankPeriodMetricsError(null);
      return;
    }
    let cancelled = false;
    setIsLoadingBankPeriodMetrics(!analyticsSnapshots[analyticsSnapshotKey(bankPeriodRange)]);
    setBankPeriodMetricsError(null);
    void ensureAnalyticsSnapshot(bankPeriodRange)
      .catch((error: unknown) => {
        if (!cancelled) {
          setBankPeriodMetricsError(error instanceof Error ? error.message : "Period totals could not be calculated");
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingBankPeriodMetrics(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    analyticsDataRevision,
    bankPeriodRange?.fromDate,
    bankPeriodRange?.toDate,
    ensureAnalyticsSnapshot
  ]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", themeMode === "dark");
    window.localStorage.setItem(themeStorageKey, themeMode);
  }, [themeMode]);

  function toggleThemeMode() {
    setThemeMode((current) => (current === "dark" ? "light" : "dark"));
  }

  async function loadDashboard() {
    setError(null);
    const response = await fetch(`${apiBase}/dashboard`);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message || "Could not load dashboard data");
    }
    setDashboard((await response.json()) as DashboardSnapshot);
  }

  async function loadApplication() {
    setError(null);
    const sessionResponse = await fetch(`${apiBase}/session`);
    if (!sessionResponse.ok) {
      throw new Error(await apiErrorMessage(sessionResponse, "Could not load account access"));
    }
    const nextSession = (await sessionResponse.json()) as DashboardSession;
    setSession(nextSession);
    if (nextSession.role === "transaction-reviewer") {
      const reviewResponse = await fetch(`${apiBase}/transaction-review`);
      if (!reviewResponse.ok) {
        throw new Error(await apiErrorMessage(reviewResponse, "Could not load transaction review"));
      }
      setTransactionReview((await reviewResponse.json()) as TransactionReviewBootstrap);
      setDashboard(null);
      return;
    }
    setTransactionReview(null);
    await loadDashboard();
  }

  async function retryDashboard() {
    setIsLoading(true);
    try {
      await loadApplication();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load dashboard");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadApplication()
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load dashboard"))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    if (!dashboard) return;
    let cancelled = false;

    async function warmRanges(ranges: AnalyticsDateRange[]): Promise<void> {
      for (const range of ranges) {
        if (cancelled) return;
        await ensureAnalyticsSnapshot(range).catch(() => undefined);
      }
    }

    void warmRanges(analyticsPresetWarmRanges(localIsoDate()));
    const liveRefresh = window.setInterval(() => {
      void warmRanges(analyticsCurrentPeriodRanges(localIsoDate()));
    }, analyticsLiveRefreshMs);

    return () => {
      cancelled = true;
      window.clearInterval(liveRefresh);
    };
  }, [analyticsDataRevision, dashboard?.asOf, ensureAnalyticsSnapshot]);

  async function requestTransactionPage(
    request: TransactionPageRequest,
    cursor: string | null,
    signal: AbortSignal
  ): Promise<TransactionPage> {
    const query = transactionRequestQuery(request);
    if (cursor) query.set("cursor", cursor);
    const response = await fetch(`${apiBase}/transactions?${query.toString()}`, { signal });
    if (!response.ok) {
      throw new Error(await apiErrorMessage(response, "Transactions could not be loaded"));
    }
    return (await response.json()) as TransactionPage;
  }

  function transactionRequestQuery(request: TransactionPageRequest): URLSearchParams {
    const query = new URLSearchParams({
      fromDate: request.dateRange.fromDate,
      toDate: request.dateRange.toDate,
      order: request.order,
      sort: request.sortKey,
      match: request.match,
      limit: String(transactionTablePageSize)
    });
    if (request.source) query.set("source", request.source);
    if (request.direction) query.set("direction", request.direction);
    if (request.wiseEntity) query.set("wiseEntity", request.wiseEntity);
    if (request.accountId) query.set("accountId", request.accountId);
    if (request.category) query.set("category", request.category);
    if (request.team) query.set("team", request.team);
    if (request.search) query.set("search", request.search);
    if (request.groupType && request.groupKey) {
      query.set("groupType", request.groupType);
      query.set("groupKey", request.groupKey);
    }
    return query;
  }

  async function waitForHistoricalTransactionSync(jobKey: string, requestKey?: string): Promise<void> {
    while (requestKey === undefined || transactionPageRequestRef.current?.key === requestKey) {
      await new Promise((resolve) => window.setTimeout(resolve, 5_000));
      const query = new URLSearchParams({ key: jobKey });
      const response = await fetch(`${apiBase}/transactions/sync?${query.toString()}`);
      if (response.status === 202) continue;
      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "Historical transaction sync failed"));
      }
      return;
    }
  }

  async function repairAllSlashMetadata(): Promise<boolean> {
    let repaired = false;
    while (true) {
      const response = await fetch(`${apiBase}/transactions/slash-metadata-repair`, { method: "POST" });
      if (!response.ok && response.status !== 202) {
        throw new Error(await apiErrorMessage(response, "Historical Slash card metadata could not be repaired"));
      }
      const repair = (await response.json()) as { status?: string; key?: string };
      if (repair.status === "complete") return repaired;
      if (!repair.key) throw new Error("Historical Slash metadata repair returned no job key");
      repaired = true;
      await waitForHistoricalTransactionSync(repair.key);
    }
  }

  async function loadTransactionPage(
    request: TransactionPageRequest,
    cursor: string | null,
    navigation: TransactionPageNavigation
  ): Promise<void> {
    if (transactionPageRequestRef.current?.key !== request.key) return;
    transactionPageAbortRef.current?.abort();
    const controller = new AbortController();
    transactionPageAbortRef.current = controller;
    const version = transactionPageRequestVersionRef.current + 1;
    transactionPageRequestVersionRef.current = version;
    const currentRequest = transactionPageState.requestKey === request.key;
    const previousCursors = navigation === "next"
      ? [...(currentRequest ? transactionPageState.previousCursors : []), currentRequest ? transactionPageState.cursor : null]
      : navigation === "previous"
        ? (currentRequest ? transactionPageState.previousCursors.slice(0, -1) : [])
        : [];
    setTransactionPageState((current) => ({
      requestKey: request.key,
      transactions: current.requestKey === request.key ? current.transactions : [],
      cursor: current.requestKey === request.key ? current.cursor : null,
      previousCursors: current.requestKey === request.key ? current.previousCursors : [],
      continueCursor: current.requestKey === request.key ? current.continueCursor : null,
      isDone: current.requestKey === request.key ? current.isDone : false,
      totalCount: current.requestKey === request.key ? current.totalCount : undefined,
      isLoading: true,
      error: null
    }));

    try {
      const page = await requestTransactionPage(request, cursor, controller.signal);
      if (
        version !== transactionPageRequestVersionRef.current
        || controller.signal.aborted
        || transactionPageRequestRef.current?.key !== request.key
      ) return;
      setTransactionPageState({
        requestKey: request.key,
        transactions: page.transactions,
        cursor,
        previousCursors,
        continueCursor: page.continueCursor,
        isDone: page.isDone,
        totalCount: page.totalCount,
        isLoading: false,
        error: null
      });
      if (!isTransactionReviewer && navigation === "reset" && page.coverage?.some((item) => item.missingRanges.length > 0)) {
        const requests = page.coverage.flatMap((item) => {
          if (item.missingRanges.length === 0) return [];
          const fromDate = item.missingRanges.reduce(
            (earliest, range) => range.fromDate < earliest ? range.fromDate : earliest,
            item.missingRanges[0].fromDate
          );
          const toDate = item.missingRanges.reduce(
            (latest, range) => range.toDate > latest ? range.toDate : latest,
            item.missingRanges[0].toDate
          );
          const key = `${item.source}:${fromDate}:${toDate}`;
          if (historicalSyncRequestKeysRef.current.has(key)) return [];
          historicalSyncRequestKeysRef.current.add(key);
          return [{ key, source: item.source, fromDate, toDate }];
        });
        if (requests.length > 0) {
          setNotice("Historical bank activity is syncing in the background.");
          void Promise.all(requests.map(async ({ key, ...payload }) => {
            const response = await fetch(`${apiBase}/transactions/sync`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload)
            });
            if (!response.ok) {
              throw new Error(await apiErrorMessage(response, "Historical transaction sync could not be queued"));
            }
            const queued = (await response.json()) as { key?: string };
            if (!queued.key) throw new Error("Historical transaction sync returned no job key");
            await waitForHistoricalTransactionSync(queued.key, request.key);
          })).then(() => {
            for (const requestItem of requests) historicalSyncRequestKeysRef.current.delete(requestItem.key);
            invalidateAnalyticsData();
            const latestRequest = transactionPageRequestRef.current;
            if (latestRequest?.key === request.key) {
              setNotice("Historical bank activity is up to date.");
              void loadTransactionPage(latestRequest, null, "reset");
            }
          }).catch((syncError: unknown) => {
            for (const requestItem of requests) historicalSyncRequestKeysRef.current.delete(requestItem.key);
            if (transactionPageRequestRef.current?.key === request.key) {
              setNotice(syncError instanceof Error ? syncError.message : "Historical transaction sync failed");
            }
          });
        }
      }
    } catch (caught) {
      if (
        controller.signal.aborted
        || version !== transactionPageRequestVersionRef.current
        || transactionPageRequestRef.current?.key !== request.key
      ) return;
      setTransactionPageState((current) => ({
        ...current,
        requestKey: request.key,
        failedCursor: cursor,
        failedNavigation: navigation,
        isDone: false,
        isLoading: false,
        error: caught instanceof Error ? caught.message : "Transactions could not be loaded"
      }));
    }
  }

  useEffect(() => {
    if (!transactionPageRequest) {
      transactionPageAbortRef.current?.abort();
      transactionPageRequestVersionRef.current += 1;
      setTransactionPageState({
        requestKey: "",
        transactions: [],
        cursor: null,
        previousCursors: [],
        continueCursor: null,
        isDone: true,
        isLoading: false,
        error: null
      });
      return;
    }
    void loadTransactionPage(transactionPageRequest, null, "reset");
    return () => transactionPageAbortRef.current?.abort();
  }, [transactionPageRequest?.key]);

  async function loadNextTransactionPage(): Promise<void> {
    const latestRequest = transactionPageRequestRef.current;
    if (!latestRequest || transactionPageState.isLoading) return;
    const currentRequest = transactionPageState.requestKey === latestRequest.key;
    if (
      currentRequest
      && transactionPageState.error
      && transactionPageState.failedNavigation
    ) {
      await loadTransactionPage(
        latestRequest,
        transactionPageState.failedCursor ?? null,
        transactionPageState.failedNavigation
      );
      return;
    }
    if (currentRequest && transactionPageState.isDone && !transactionPageState.error) return;
    await loadTransactionPage(
      latestRequest,
      currentRequest ? transactionPageState.continueCursor : null,
      currentRequest ? "next" : "reset"
    );
  }

  async function loadPreviousTransactionPage(): Promise<void> {
    const latestRequest = transactionPageRequestRef.current;
    if (
      !latestRequest
      || transactionPageState.isLoading
      || transactionPageState.requestKey !== latestRequest.key
      || transactionPageState.previousCursors.length === 0
    ) return;
    await loadTransactionPage(
      latestRequest,
      transactionPageState.previousCursors.at(-1) ?? null,
      "previous"
    );
  }

  async function refreshCurrentTransactionPage(): Promise<void> {
    const latestRequest = transactionPageRequestRef.current;
    if (!latestRequest) return;
    await loadTransactionPage(latestRequest, null, "reset");
  }

  const transactionPageIsCurrent = transactionPageState.requestKey === transactionPageRequest?.key;
  const loadedBankTransactions = transactionPageIsCurrent ? transactionPageState.transactions : [];
  const isLoadingTransactionPage = transactionPageIsCurrent
    ? transactionPageState.isLoading
    : transactionPageRequest !== null;
  const transactionPageError = transactionPageIsCurrent ? transactionPageState.error : null;
  const hasPreviousTransactions = Boolean(
    transactionPageIsCurrent && transactionPageState.previousCursors.length > 0
  );
  const hasMoreTransactions = Boolean(
    transactionPageRequest
    && (!transactionPageIsCurrent || !transactionPageState.isDone || transactionPageState.error)
  );

  useEffect(() => {
    if (isTransactionReviewer || bankActivityView === "transactions" || !transactionPageRequest) {
      bankActivitySummaryAbortRef.current?.abort();
      if (!transactionPageRequest) {
        setBankActivitySummaryState({ requestKey: "", summary: null, isLoading: false, error: null });
      }
      return;
    }
    const request = transactionPageRequest;
    const controller = new AbortController();
    bankActivitySummaryAbortRef.current?.abort();
    bankActivitySummaryAbortRef.current = controller;
    setBankActivitySummaryState({ requestKey: request.key, summary: null, isLoading: true, error: null });
    const query = transactionRequestQuery(request);
    void fetch(`${apiBase}/transactions/summary?${query.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await apiErrorMessage(response, "Bank activity summary could not be loaded"));
        return (await response.json()) as BankActivitySummary;
      })
      .then((summary) => {
        if (!controller.signal.aborted && transactionPageRequestRef.current?.key === request.key) {
          setBankActivitySummaryState({ requestKey: request.key, summary, isLoading: false, error: null });
        }
      })
      .catch((caught: unknown) => {
        if (!controller.signal.aborted && transactionPageRequestRef.current?.key === request.key) {
          setBankActivitySummaryState({
            requestKey: request.key,
            summary: null,
            isLoading: false,
            error: caught instanceof Error ? caught.message : "Bank activity summary could not be loaded"
          });
        }
      });
    return () => controller.abort();
  }, [bankActivitySummaryRetry, bankActivityView !== "transactions", transactionPageRequest?.key, isTransactionReviewer]);

  const bankActivitySummary = bankActivitySummaryState.requestKey === transactionPageRequest?.key
    ? bankActivitySummaryState.summary
    : null;
  const isLoadingBankActivitySummary = bankActivitySummaryState.requestKey === transactionPageRequest?.key
    ? bankActivitySummaryState.isLoading
    : bankActivityView !== "transactions";
  const bankActivitySummaryError = bankActivitySummaryState.requestKey === transactionPageRequest?.key
    ? bankActivitySummaryState.error
    : null;

  async function retryBankActivitySummary(): Promise<void> {
    setBankActivitySummaryRetry((value) => value + 1);
  }

  const latestIncomeAutomation = useMemo(
    () => latestIncomeAutomationTimestamp(dashboard?.automationRuns ?? []),
    [dashboard?.automationRuns]
  );
  const incomeAutomationUnreadCount = useMemo(
    () => unreadIncomeAutomationCount(dashboard?.automationRuns ?? [], incomeAutomationReadAt),
    [dashboard?.automationRuns, incomeAutomationReadAt]
  );

  useEffect(() => {
    if (activeTab !== "revenue" || !latestIncomeAutomation || latestIncomeAutomation === incomeAutomationReadAt) return;
    window.localStorage.setItem(incomeAutomationReadStorageKey, latestIncomeAutomation);
    setIncomeAutomationReadAt(latestIncomeAutomation);
  }, [activeTab, incomeAutomationReadAt, latestIncomeAutomation]);

  const providersById = useMemo(() => {
    const map = new Map<string, Provider>();
    for (const provider of dashboard?.providers ?? []) map.set(provider.id, provider);
    return map;
  }, [dashboard?.providers]);

  const teamsById = useMemo(() => {
    const map = new Map<string, Team>();
    for (const team of dashboard?.teams ?? transactionReview?.teams ?? []) map.set(team.id, team);
    return map;
  }, [dashboard?.teams, transactionReview?.teams]);

  const allBankTransactions = useMemo(() => {
    if (activeTab !== "banks" || bankTab !== "all") return [];
    return loadedBankTransactions;
  }, [activeTab, bankTab, loadedBankTransactions]);

  const wiseTransactions = useMemo(
    () => bankTab === "wise" ? loadedBankTransactions : [],
    [bankTab, loadedBankTransactions]
  );

  const slashTransactions = useMemo(
    () => bankTab === "slash" ? loadedBankTransactions : [],
    [bankTab, loadedBankTransactions]
  );

  const revolutTransactions = useMemo(
    () => bankTab === "revolut" ? loadedBankTransactions : [],
    [bankTab, loadedBankTransactions]
  );

  const amexTransactions = useMemo(
    () => bankTab === "amex" ? loadedBankTransactions : [],
    [bankTab, loadedBankTransactions]
  );

  function applyTransactionUpdate(updated: Transaction) {
    invalidateAnalyticsData();
    setDashboard((current) => {
      if (!current) return current;
      return {
        ...current,
        transactionReviewPreview: current.transactionReviewPreview.map((transaction) =>
          transaction.id === updated.id ? updated : transaction
        )
      };
    });
    setTransactionPageState((current) => ({
      ...current,
      transactions: current.transactions.map((transaction) =>
        transaction.id === updated.id ? updated : transaction
      )
    }));
  }

  async function syncNow() {
    setIsSyncing(true);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch(`${apiBase}/sync`, { method: "POST" });
      if (!response.ok) {
        throw new Error(await apiErrorMessage(response, "Refresh and sync failed"));
      }
      setDashboard((await response.json()) as DashboardSnapshot);
      if (activeTab === "banks" && bankTab === "slash") {
        setNotice("Repairing historical Slash account and card metadata...");
        const repairedHistory = await repairAllSlashMetadata();
        if (!repairedHistory) {
          setNotice("Refreshing the selected Slash period...");
          const periodResponse = await fetch(`${apiBase}/transactions/sync`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ source: "slash", ...slashDateRange })
          });
          if (!periodResponse.ok) {
            throw new Error(await apiErrorMessage(periodResponse, "Selected Slash period could not be refreshed"));
          }
          const queued = (await periodResponse.json()) as { key?: string };
          if (!queued.key) throw new Error("Selected Slash period refresh returned no job key");
          await waitForHistoricalTransactionSync(queued.key);
        }
      }
      await refreshCurrentTransactionPage();
      invalidateAnalyticsData();
      setNotice(activeTab === "banks" && bankTab === "slash"
        ? "Refresh and sync complete. Historical Slash account and card metadata is up to date."
        : "Refresh and sync complete. New bank transactions were imported and categorized automatically.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh and sync failed");
    } finally {
      setIsSyncing(false);
    }
  }

  async function loadAllBankTransactions(dateRange: BankTransactionDateRange) {
    setNotice(null);
    setError(null);
    setAllBankDateRange(dateRange);
  }

  async function filterWiseTransactions(dateRange: BankTransactionDateRange) {
    setNotice(null);
    setWiseDateRange(dateRange);
  }

  async function loadRevolutTransactions(dateRange: RevolutTransactionDateRange) {
    setNotice(null);
    setError(null);
    setRevolutDateRange(dateRange);
  }

  async function loadSlashTransactions(dateRange: SlashTransactionDateRange) {
    setNotice(null);
    setError(null);
    setSlashDateRange(dateRange);
  }

  async function importWiseStatements(files: FileList | null) {
    if (!files?.length) return;
    if (!dashboard) return;
    setIsImportingWise(true);
    setNotice(null);
    setError(null);
    try {
      const filePayloads: Array<{
        fileName: string;
        payload: ImportWiseStatementPayload;
      }> = [];
      for (const file of Array.from(files)) {
        const text = await file.text();
        const parsedStatements = parseWiseStatementCsv(text, file.name);
        for (const parsed of parsedStatements) {
          const verifiedAccount = verifyWiseStatementAccount(
            parsed.metadata,
            dashboard.accounts,
            wiseEntityView
          );
          filePayloads.push({
            fileName: file.name,
            payload: prepareWiseStatementImport(parsed, verifiedAccount)
          });
        }
      }

      let nextDashboard: DashboardSnapshot | null = dashboard;
      let processedTransactions = 0;
      let newTransactions = 0;
      let duplicateTransactions = 0;
      const importedEntities = new Set<WiseEntity>();
      for (const { fileName, payload } of filePayloads) {
        const response = await fetch(`${apiBase}/wise/import-statement`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          throw new Error(await apiErrorMessage(response, `${fileName} could not be imported`));
        }
        const result = (await response.json()) as ImportWiseStatementResult;
        nextDashboard = result.dashboard;
        processedTransactions += result.summary.processedTransactions;
        newTransactions += result.summary.newTransactions;
        duplicateTransactions += result.summary.duplicateTransactions;
        importedEntities.add(payload.wiseEntity);
      }
      if (nextDashboard) setDashboard(nextDashboard);
      await refreshCurrentTransactionPage();
      invalidateAnalyticsData();
      const importedFiles = files.length;
      const entityLabel = [...importedEntities]
        .map(wiseEntityShortLabel)
        .sort()
        .join(" + ");
      setNotice(
        `Processed ${importedFiles} verified ${entityLabel} Wise CSV${importedFiles === 1 ? "" : "s"}: ${processedTransactions} transaction${
          processedTransactions === 1 ? "" : "s"
        }, ${newTransactions} new, ${duplicateTransactions} duplicate${duplicateTransactions === 1 ? "" : "s"}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wise statement import failed");
    } finally {
      setIsImportingWise(false);
    }
  }

  async function syncRevenue(payload: SyncRevenuePayload): Promise<RevenueRun[]> {
    setNotice(null);
    setError(null);
    const response = await fetch(`${apiBase}/revenue/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error(await apiErrorMessage(response, "Revenue sync failed"));
    }
    const result = (await response.json()) as RevenuePullResult;
    setNotice("Revenue pulled for review. The result has not been saved.");
    return result.runs;
  }

  async function draftRevenueRun(run: RevenueRun) {
    setNotice(null);
    setError(null);
    const payload: DraftRevenueRunPayload = {
      partnerId: run.partnerId,
      periodStart: run.periodStart,
      periodEnd: run.periodEnd,
      timezone: run.timezone
    };
    const response = await fetch(`${apiBase}/revenue/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error(await apiErrorMessage(response, "Revenue draft could not be prepared"));
    }
    await loadDashboard();
    setNotice("Invoice draft prepared from the closed revenue period. Nothing was sent to Merit.");
  }

  async function matchTransaction(
    transaction: Transaction,
    providerId?: string,
    scope: TransactionOverrideScope = "transaction"
  ) {
    const selectedProviderId = providerId || transaction.matchedProviderId;
    if (!selectedProviderId) {
      setError("Choose a company before saving the match.");
      return;
    }
    setError(null);
    const response = await fetch(
      isTransactionReviewer
        ? `${apiBase}/transactions/${encodeURIComponent(transaction.id)}/company`
        : `${apiBase}/matches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(isTransactionReviewer
        ? { providerId: selectedProviderId, scope }
        : {
          transactionId: transaction.id,
          providerId: selectedProviderId,
          invoiceId: transaction.matchedInvoiceId,
          scope
        })
    });
    if (!response.ok) {
      setError(await apiErrorMessage(response, "Match failed"));
      return;
    }
    applyTransactionUpdate((await response.json()) as Transaction);
    if (scope === "merchant") await refreshCurrentTransactionPage();
    setNotice(
      scope === "merchant"
        ? `Matched all ${transaction.merchantName ?? transaction.counterparty} transactions to this company.`
        : "Company match updated for this transaction only."
    );
  }

  async function updateTransactionCategory(
    transaction: Transaction,
    category: string,
    scope: TransactionOverrideScope = "transaction"
  ) {
    setError(null);
    const response = await fetch(`${apiBase}/transactions/${transaction.id}/category`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, scope })
    });
    if (!response.ok) {
      setError(await apiErrorMessage(response, "Category update failed"));
      return;
    }
    applyTransactionUpdate((await response.json()) as Transaction);
    if (scope === "merchant") await refreshCurrentTransactionPage();
    setNotice(
      scope === "merchant"
        ? `Applied ${category} to all ${transaction.merchantName ?? transaction.counterparty} transactions.`
        : `Applied ${category} to this transaction only.`
    );
  }

  async function saveProfitDistributionAdjustment(payload: SaveProfitDistributionAdjustmentPayload) {
    setError(null);
    const response = await fetch(`${apiBase}/distribution/adjustments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error(await apiErrorMessage(response, "Distribution adjustment could not be saved"));
    }
    setDashboard((await response.json()) as DashboardSnapshot);
    setNotice("Distribution adjustment saved.");
  }

  async function assignTransactionTeam(transaction: Transaction, teamId?: string) {
    setError(null);
    const response = await fetch(`${apiBase}/transactions/${transaction.id}/team`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId: teamId || null })
    });
    if (!response.ok) {
      setError(await apiErrorMessage(response, "Owner assignment failed"));
      return;
    }
    applyTransactionUpdate((await response.json()) as Transaction);
    setNotice(teamId ? `Assigned ${transaction.counterparty} to ${teamsById.get(teamId)?.name ?? "owner"}.` : "Transaction owner cleared.");
  }

  async function createTeam(payload: CreateTeamPayload) {
    const response = await fetch(`${apiBase}/teams`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error(await apiErrorMessage(response, "Owner could not be created"));
    }
    await loadDashboard();
    setNotice(`${payload.name.trim()} owner added.`);
  }

  function applyTransactionCategories(
    categories: TransactionCategory[],
    renamedFrom?: string,
    renamedTo?: string
  ) {
    if (renamedFrom && renamedTo && renamedFrom !== renamedTo) {
      invalidateAnalyticsData();
      setTransactionPageState((current) => ({
        ...current,
        transactions: current.transactions.map((transaction) =>
          transaction.category === renamedFrom ? { ...transaction, category: renamedTo } : transaction
        )
      }));
    }
    setDashboard((current) => {
      if (!current) return current;
      if (!renamedFrom || !renamedTo || renamedFrom === renamedTo) {
        return { ...current, transactionCategories: categories };
      }
      return {
        ...current,
        transactionCategories: categories,
        transactionReviewPreview: current.transactionReviewPreview.map((transaction) =>
          transaction.category === renamedFrom ? { ...transaction, category: renamedTo } : transaction
        ),
        transactionCategoryRules: current.transactionCategoryRules.map((rule) =>
          rule.category === renamedFrom ? { ...rule, category: renamedTo } : rule
        ),
        revenuePartners: current.revenuePartners.map((partner) =>
          partner.revenueCategory === renamedFrom ? { ...partner, revenueCategory: renamedTo } : partner
        )
      };
    });
  }

  async function createTransactionCategory(payload: CreateTransactionCategoryPayload) {
    const response = await fetch(`${apiBase}/settings/categories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error(await apiErrorMessage(response, "Category could not be created"));
    }
    applyTransactionCategories((await response.json()) as TransactionCategory[]);
    setNotice(`${payload.name.trim()} category added.`);
  }

  async function updateTransactionCategoryDefinition(
    category: TransactionCategory,
    payload: UpdateTransactionCategoryDefinitionPayload
  ) {
    const response = await fetch(`${apiBase}/settings/categories/${encodeURIComponent(category.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error(await apiErrorMessage(response, "Category could not be updated"));
    }
    applyTransactionCategories(
      (await response.json()) as TransactionCategory[],
      category.name,
      payload.name.trim().replace(/\s+/g, " ")
    );
    setNotice(`${payload.name.trim()} category saved.`);
  }

  async function deleteTransactionCategoryDefinition(category: TransactionCategory) {
    const response = await fetch(`${apiBase}/settings/categories/${encodeURIComponent(category.id)}`, {
      method: "DELETE"
    });
    if (!response.ok) {
      throw new Error(await apiErrorMessage(response, "Category could not be deleted"));
    }
    applyTransactionCategories((await response.json()) as TransactionCategory[]);
    setNotice(`${category.name} category deleted.`);
  }

  async function submitProvider(payload: CreateProviderPayload) {
    const response = await fetch(`${apiBase}/providers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error(await apiErrorMessage(response, "Provider could not be created"));
    }
    await loadDashboard();
  }

  async function saveProvider(providerId: string, payload: UpdateProviderPayload) {
    const response = await fetch(`${apiBase}/providers/${providerId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error(await apiErrorMessage(response, "Provider could not be saved"));
    }
    await loadDashboard();
  }

  async function removeProvider(provider: Provider) {
    const response = await fetch(`${apiBase}/providers/${provider.id}`, { method: "DELETE" });
    if (!response.ok) {
      throw new Error(await apiErrorMessage(response, "Company could not be deleted"));
    }
    await loadDashboard();
    await refreshCurrentTransactionPage();
    setNotice(`${provider.name} deleted. Existing financial records were kept and company matches were cleared.`);
  }

  async function saveRevenuePartner(partnerId: string, payload: UpdateRevenuePartnerPayload) {
    const response = await fetch(`${apiBase}/revenue-partners/${partnerId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error(await apiErrorMessage(response, "Revenue partner could not be saved"));
    }
    await loadDashboard();
  }

  async function createRevenuePartner(payload: CreateRevenuePartnerPayload) {
    const response = await fetch(`${apiBase}/revenue-partners`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error(await apiErrorMessage(response, "Revenue rule could not be created"));
    }
    await loadDashboard();
  }

  async function removeRevenuePartner(partner: RevenuePartner) {
    const response = await fetch(`${apiBase}/revenue-partners/${partner.id}`, { method: "DELETE" });
    if (!response.ok) {
      throw new Error(await apiErrorMessage(response, "Revenue client could not be deleted"));
    }
    await loadDashboard();
    setNotice(`${partner.name} deleted from the revenue client directory. Existing run and invoice history was kept.`);
  }

  async function saveAiSettings(payload: SaveAiSettingsPayload) {
    const response = await fetch(`${apiBase}/settings/ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error(await apiErrorMessage(response, "AI settings could not be saved"));
    }
    setDashboard((await response.json()) as DashboardSnapshot);
  }

  async function runAiPrompt(payload: AiPromptPayload): Promise<AiPromptResult> {
    const response = await fetch(`${apiBase}/ai/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error(await apiErrorMessage(response, "AI prompt failed"));
    }
    return (await response.json()) as AiPromptResult;
  }

  async function submitInvoice(payload: CreateInvoicePayload): Promise<Invoice> {
    const response = await fetch(`${apiBase}/invoices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error(await apiErrorMessage(response, "Document draft could not be created"));
    }
    const invoice = (await response.json()) as Invoice;
    await loadDashboard();
    if (payload.transactionId) await refreshCurrentTransactionPage();
    setNotice(
      payload.documentType === "sales_invoice"
        ? "Sales invoice draft saved. Choose whether to send it to Merit."
        : "Supplier bill draft recorded."
    );
    return invoice;
  }

  async function submitExpense(payload: CreateExpensePayload): Promise<ExpenseRecord> {
    const response = await fetch(`${apiBase}/expenses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(await apiErrorMessage(response, "Expense record could not be created"));
    const expense = (await response.json()) as ExpenseRecord;
    await loadDashboard();
    if (payload.transactionId) await refreshCurrentTransactionPage();
    setNotice(
      expense.paymentStatus === "paid"
        ? "Paid expense saved with its accounting source document."
        : "Supplier bill saved and included in payables."
    );
    return expense;
  }

  async function matchExpensePayment(expenseId: string, transactionId: string): Promise<void> {
    const response = await fetch(`${apiBase}/expenses/${encodeURIComponent(expenseId)}/match-payment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactionId })
    });
    if (!response.ok) throw new Error(await apiErrorMessage(response, "Supplier bill could not be matched to the payment"));
    await loadDashboard();
    await refreshCurrentTransactionPage();
    setNotice("Outgoing bank payment matched to the supplier bill.");
  }

  function openTransactionDocument(transaction: Transaction) {
    if (transaction.direction === "in") setInvoiceTransaction(transaction);
    else setExpenseTransaction(transaction);
  }

  async function createManualReceivable(payload: CreateManualReceivablePayload) {
    const response = await fetch(`${apiBase}/receivables`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error(await apiErrorMessage(response, "Manual receivable could not be added"));
    }
    await loadDashboard();
    setNotice(`${payload.name.trim()} added to receivables.`);
  }

  async function deleteManualReceivable(receivableId: string) {
    const response = await fetch(`${apiBase}/receivables/${encodeURIComponent(receivableId)}`, {
      method: "DELETE"
    });
    if (!response.ok) throw new Error(await apiErrorMessage(response, "Manual receivable could not be removed"));
    await loadDashboard();
    setNotice("Manual receivable removed.");
  }

  async function saveCashFlowSnapshot(payload: SaveCashFlowSnapshotPayload): Promise<CashFlowSnapshot> {
    const response = await fetch(`${apiBase}/cash-flow/snapshots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(await apiErrorMessage(response, "Cash flow snapshot could not be saved"));
    const snapshot = (await response.json()) as CashFlowSnapshot;
    await loadDashboard();
    setNotice(`Cash flow snapshot saved for ${snapshot.asOfDate}.`);
    return snapshot;
  }

  async function updateInvoiceDraft(invoiceId: string, payload: UpdateInvoicePayload): Promise<Invoice> {
    const response = await fetch(`${apiBase}/invoices/${encodeURIComponent(invoiceId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message || "Invoice could not be updated");
    }
    const invoice = (await response.json()) as Invoice;
    await loadDashboard();
    setNotice(invoice.status === "open" ? "Open invoice changes saved in the dashboard." : "Invoice draft saved. Choose whether to send it to Merit.");
    return invoice;
  }

  async function prepareInvoiceDuplicate(invoiceId: string): Promise<CreateInvoicePayload> {
    const response = await fetch(`${apiBase}/invoices/${encodeURIComponent(invoiceId)}/duplicate-preview`);
    if (!response.ok) {
      throw new Error(await apiErrorMessage(response, "Invoice could not be duplicated"));
    }
    return (await response.json()) as CreateInvoicePayload;
  }

  async function deleteInvoiceDrafts(invoiceIds: string[]): Promise<void> {
    const payload: DeleteInvoicesPayload = { invoiceIds };
    const response = await fetch(`${apiBase}/invoices`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error(await apiErrorMessage(response, "Invoice drafts could not be deleted"));
    }
    const deletedInvoices = (await response.json()) as Invoice[];
    await loadDashboard();
    await refreshCurrentTransactionPage();
    setNotice(
      `${deletedInvoices.length} dashboard draft${deletedInvoices.length === 1 ? "" : "s"} deleted. Merit was not changed.`
    );
  }

  async function sendInvoices(invoiceIds: string[], mode: MeritSendMode) {
    const payload: SendInvoicesPayload = { invoiceIds, mode, confirmation: "SEND_TO_MERIT" };
    const response = await fetch(`${apiBase}/invoices/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message || "Invoices could not be sent to Merit");
    }
    const result = (await response.json()) as SendInvoicesResult;
    setDashboard(result.dashboard);
    const failed = result.outcomes.filter((outcome) => outcome.status === "failed");
    if (failed.length > 0) {
      throw new Error(
        `${failed.length} invoice${failed.length === 1 ? "" : "s"} failed to send. ${failed.map((outcome) => outcome.message).filter(Boolean).join(" · ")}`
      );
    }
    setNotice(
      mode === "deliver"
        ? `${invoiceIds.length} invoice${invoiceIds.length === 1 ? "" : "s"} saved and queued for client delivery through Merit.`
        : `${invoiceIds.length} invoice${invoiceIds.length === 1 ? "" : "s"} saved in Merit without client delivery.`
    );
  }

  async function recordInvoicePayment(invoiceId: string, payload: RecordInvoicePaymentPayload) {
    const response = await fetch(`${apiBase}/invoices/${encodeURIComponent(invoiceId)}/payments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message || "Payment could not be recorded");
    }
    await loadDashboard();
    if (payload.transactionId) await refreshCurrentTransactionPage();
    setNotice("Payment recorded in this dashboard only. Merit was not changed.");
  }

  async function recordBulkInvoicePayments(payload: BulkRecordInvoicePaymentsPayload) {
    const response = await fetch(`${apiBase}/invoices/payments/bulk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(await apiErrorMessage(response, "Payments could not be recorded"));
    setDashboard((await response.json()) as DashboardSnapshot);
    setNotice(`${payload.invoiceIds.length} invoice${payload.invoiceIds.length === 1 ? "" : "s"} recorded as paid in this dashboard only. Merit was not changed.`);
  }

  async function matchInvoicePayment(transaction: Transaction, invoiceId?: string) {
    const payload: MatchInvoicePaymentPayload = {
      invoiceId,
      confirmation: "REVIEWED_INVOICE_MATCH"
    };
    const response = await fetch(`${apiBase}/transactions/${encodeURIComponent(transaction.id)}/invoice-match`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(await apiErrorMessage(response, "Invoice match could not be saved"));
    setDashboard((await response.json()) as DashboardSnapshot);
    await refreshCurrentTransactionPage();
    setNotice(invoiceId ? "Bank transaction matched to the invoice. Merit was not changed." : "Automatic invoice matching disabled for this transaction.");
  }

  async function createHolding(payload: CreateHoldingPayload) {
    const response = await fetch(`${apiBase}/holdings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message || "Holding could not be created");
    }
    await loadDashboard();
    setNotice("Holding added to cash and wallets.");
  }

  async function updateHolding(holdingId: string, payload: UpdateHoldingPayload) {
    const response = await fetch(`${apiBase}/holdings/${encodeURIComponent(holdingId)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message || "Holding could not be updated");
    }
    await loadDashboard();
    setNotice("Holding updated.");
  }

  async function deleteHolding(holdingId: string) {
    const response = await fetch(`${apiBase}/holdings/${encodeURIComponent(holdingId)}`, { method: "DELETE" });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message || "Holding could not be deleted");
    }
    await loadDashboard();
    setNotice("Holding deleted from the dashboard.");
  }

  async function refreshFxRates() {
    const response = await fetch(`${apiBase}/fx/refresh`, { method: "POST" });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message || "Conversion rates could not be refreshed");
    }
    const nextDashboard = (await response.json()) as DashboardSnapshot;
    setDashboard(nextDashboard);
    setNotice(
      nextDashboard.approximateUsdTotals.staleAssets.length > 0 || nextDashboard.approximateUsdTotals.excludedAssets.length > 0
        ? "Conversion refresh completed with stale or unsupported assets; review the warning below the total."
        : "Coinbase conversion rates refreshed. USD totals remain approximate."
    );
  }

  function clearBankGroupDrilldown(): void {
    setBankGroupType("");
    setBankGroupKey("");
    setBankGroupLabel("");
  }

  function changeBankActivityView(view: BankActivityViewMode): void {
    if (view !== "transactions") clearBankGroupDrilldown();
    setBankActivityView(view);
  }

  function openBankActivityGroup(type: BankActivityGroupType, key: string, label: string): void {
    setBankGroupType(type);
    setBankGroupKey(key);
    setBankGroupLabel(label);
    setBankActivityView("transactions");
  }

  function openProviderBankFunding(companyName?: string, fromDate?: string): void {
    setActiveTab("banks");
    setBankTab("all");
    setBankActivityView("transactions");
    clearBankGroupDrilldown();
    setAllBankSource("all");
    setBankAccountFilter("all");
    setTeamFilter("all");
    setMatchFilter("all");
    setBankDirection("out");
    setBankCategoryFilter("Ad account funding");
    setSearchTerm(companyName ?? "");
    if (fromDate) setAllBankDateRange({ fromDate, toDate: financeOperatingDate() });
  }

  if (isLoading) {
    return (
      <main className="loading-screen" role="status" aria-live="polite">
        <div className="floating-theme-toggle">
          <ThemeToggle themeMode={themeMode} onToggle={toggleThemeMode} />
        </div>
        <Loader2 className="spin" size={28} />
        <span>Loading finance dashboard</span>
      </main>
    );
  }

  if (isTransactionReviewer && transactionReview && session) {
    return (
      <TransactionReviewerWorkspace
        access={transactionReview}
        dateRange={allBankDateRange}
        direction={bankDirection}
        error={error}
        hasMore={hasMoreTransactions}
        hasPrevious={hasPreviousTransactions}
        isLoading={isLoadingTransactionPage}
        loadError={transactionPageError}
        match={matchFilter}
        notice={notice}
        onAssignTeam={assignTransactionTeam}
        onDismissMessage={() => (error ? setError(null) : setNotice(null))}
        onLoadMore={loadNextTransactionPage}
        onLoadPrevious={loadPreviousTransactionPage}
        onMatch={matchTransaction}
        onUpdateCategory={updateTransactionCategory}
        searchTerm={searchTerm}
        session={session}
        setAccount={setBankAccountFilter}
        setCategory={setBankCategoryFilter}
        setDateRange={setAllBankDateRange}
        setDirection={setBankDirection}
        setMatch={setMatchFilter}
        setSearchTerm={setSearchTerm}
        setSortDirection={setTransactionSortDirection}
        setSortKey={setTransactionSortKey}
        setSource={setAllBankSource}
        setTeam={setTeamFilter}
        sortDirection={transactionSortDirection}
        sortKey={transactionSortKey}
        source={allBankSource}
        team={teamFilter}
        category={bankCategoryFilter}
        account={bankAccountFilter}
        themeMode={themeMode}
        toggleThemeMode={toggleThemeMode}
        totalCount={transactionPageIsCurrent ? transactionPageState.totalCount : undefined}
        transactions={loadedBankTransactions}
      />
    );
  }

  if (!dashboard) {
    return (
      <main className="loading-screen" role="alert" aria-live="assertive">
        <div className="floating-theme-toggle">
          <ThemeToggle themeMode={themeMode} onToggle={toggleThemeMode} />
        </div>
        <CircleAlert size={28} />
        <span>{error || "Dashboard could not load"}</span>
        <Button className="secondary-button" onClick={() => void retryDashboard()}>
          <RefreshCw size={16} />
          Retry
        </Button>
      </main>
    );
  }

  const hasReceivables = dashboard.receivables.length > 0;
  const hasOpenBalances = dashboard.openBalances.length > 0;
  const hasPayables = dashboard.payables.length > 0;
  const hasNetOperatingAssets = hasCurrencyTotals(dashboard.metrics.netOperatingAssets);
  const netOperatingAssetsTone = currencyTotalsTone(dashboard.metrics.netOperatingAssets);
  const liquidAccounts = dashboard.accounts.filter((account) =>
    isLiquidAccountBalance(account) && hasNonZeroAccountBalance(account)
  );
  const cardAccounts = dashboard.accounts.filter((account) => !isLiquidAccountBalance(account));
  const cardLiabilities = sumCurrencyTotals(cardAccounts, (account) => Math.abs(account.balance));
  const overviewConversions = [
    cardLiabilities,
    dashboard.metrics.totalCash,
    dashboard.metrics.totalReceivables,
    dashboard.metrics.totalOpenBalance,
    dashboard.metrics.totalPayables,
    dashboard.metrics.netOperatingAssets,
    dashboard.metrics.totalAssets
  ].map((totals) => convertCurrencyTotalsToUsd(totals, dashboard.fxRates));
  const overviewExcludedCurrencies = [...new Set([
    ...dashboard.approximateUsdTotals.excludedAssets,
    ...overviewConversions.flatMap((conversion) => conversion.excludedCurrencies)
  ])].sort();
  const overviewStaleCurrencies = [...new Set([
    ...dashboard.approximateUsdTotals.staleAssets,
    ...overviewConversions.flatMap((conversion) => conversion.staleCurrencies)
  ])].sort();
  const incompleteLiquiditySources = dashboard.integrationStatus
    .filter((status) => (status.id === "wise" || status.id === "revolut" || status.id === "slash") && status.mode === "partial")
    .map((status) => status.label);
  const wiseStatus = dashboard.integrationStatus.find((integration) => integration.id === "wise");
  return (
    <main className="app-shell">
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        incomeAutomationUnreadCount={incomeAutomationUnreadCount}
        themeMode={themeMode}
        onToggleTheme={toggleThemeMode}
        onSync={syncNow}
        isSyncing={isSyncing}
      />
      <div className="main-column">
        {(error || notice) && (
          <div className={error ? "toast error" : "toast"} role={error ? "alert" : "status"} aria-live={error ? "assertive" : "polite"}>
            {error ? <CircleAlert size={16} /> : <Check size={16} />}
            <span>{error || notice}</span>
            <Button aria-label="Dismiss" onClick={() => (error ? setError(null) : setNotice(null))}>
              <X size={14} />
            </Button>
          </div>
        )}

        <div className="route-stage" key={activeTab}>
      {activeTab === "overview" && (
        <>
          <section className="liquidity-hero" aria-label="Available liquidity in US dollars">
            <div className="liquidity-hero-main">
              <InfoPopover label="available liquidity">
                <span>Connected bank balances, manual cash, exchanges, and crypto wallets converted to USD. Card debt is shown separately and is not deducted.</span>
                <span>{dashboard.approximateUsdTotals.asOf ? `Oldest included quote ${maybeDate(dashboard.approximateUsdTotals.asOf)}` : "All included balances are already in USD"} · refreshes hourly and with Sync.</span>
              </InfoPopover>
              <strong><AnimatedNumber animationKey="overview-liquid-assets" value={money(dashboard.approximateUsdTotals.totalUsd, "USD")} /></strong>
              <div className="liquidity-hero-title"><CircleDollarSign size={20} /><span>Available liquidity{dashboard.approximateUsdTotals.excludedAssets.length > 0 ? " · partial" : ""}</span></div>
            </div>
            <div className="liquidity-breakdown">
              <article>
                <strong><AnimatedNumber animationKey="overview-liquid-bank-accounts" value={money(dashboard.approximateUsdTotals.accountsUsd, "USD")} /></strong>
                <span>Connected accounts</span>
                <small>{groupedAccountMoney(liquidAccounts)}</small>
              </article>
              <article>
                <strong><AnimatedNumber animationKey="overview-cash-crypto" value={money(dashboard.approximateUsdTotals.holdingsUsd, "USD")} /></strong>
                <span>Cash & wallets</span>
                <small>{groupedHoldingMoney(dashboard.holdings)}</small>
              </article>
              <article className="liability">
                <InfoPopover label="card debt"><span>Card debt is shown for visibility but is not deducted from available liquidity.</span></InfoPopover>
                <strong><AnimatedNumber animationKey="overview-card-liabilities" value={formatUsdCurrencyTotal(cardLiabilities, dashboard.fxRates, money(0))} /></strong>
                <span>Card debt · not deducted</span>
                <small>{nativeCurrencyBreakdown(cardLiabilities) ?? "No card debt"}</small>
              </article>
            </div>
          </section>
          {(incompleteLiquiditySources.length > 0 || overviewStaleCurrencies.length > 0 || overviewExcludedCurrencies.length > 0) && (
            <div className="income-callout warning liquidity-warning" role="status">
              <CircleAlert size={17} />
              <span>
                <strong>Partial data coverage.</strong>
                {incompleteLiquiditySources.length > 0 && <> {incompleteLiquiditySources.join(", ")} did not fully sync, so totals use available balances only.</>}
                {overviewStaleCurrencies.length > 0 && <> Last-known quotes are being used for {overviewStaleCurrencies.join(", ")}.</>}
                {overviewExcludedCurrencies.length > 0 && <> {overviewExcludedCurrencies.join(", ")} {overviewExcludedCurrencies.length === 1 ? "is" : "are"} excluded from converted totals because no current USD quote was returned.</>}
              </span>
            </div>
          )}
          <section className="metric-grid" aria-label="Working capital summary">
            <div className="metric-grid-heading">Working capital · converted to USD</div>
            <MetricCard
              icon={<BadgeDollarSign />}
              label="Outstanding receivables"
              value={formatUsdCurrencyTotal(dashboard.metrics.totalReceivables, dashboard.fxRates, money(0))}
              detail={hasReceivables ? "Customer invoices and manual receivable balances still due" : "Nothing is currently due from customers"}
              breakdown={nativeCurrencyBreakdown(dashboard.metrics.totalReceivables)}
            />
            <MetricCard
              icon={<WalletCards />}
              label="Other open balances"
              value={formatUsdCurrencyTotal(dashboard.metrics.totalOpenBalance, dashboard.fxRates, money(0))}
              detail={hasOpenBalances ? "Other customer and provider balances outside receivables" : "No other open customer or provider balances"}
              breakdown={nativeCurrencyBreakdown(dashboard.metrics.totalOpenBalance)}
            />
            <MetricCard
              icon={<ArrowDownRight />}
              label="Supplier payables"
              value={formatUsdCurrencyTotal(dashboard.metrics.totalPayables, dashboard.fxRates, money(0))}
              detail={hasPayables ? "Unpaid supplier and platform balances" : "Nothing is currently due to suppliers"}
              breakdown={nativeCurrencyBreakdown(dashboard.metrics.totalPayables)}
              danger={hasPayables}
            />
            <MetricCard
              icon={<ShieldCheck />}
              label="Net operating assets"
              value={formatUsdCurrencyTotal(dashboard.metrics.netOperatingAssets, dashboard.fxRates)}
              detail={hasNetOperatingAssets ? "Cash plus receivables and other balances, less supplier payables" : "Waiting for operating balances"}
              breakdown={nativeCurrencyBreakdown(dashboard.metrics.netOperatingAssets)}
              good={netOperatingAssetsTone === "good"}
              danger={netOperatingAssetsTone === "danger"}
            />
          </section>
          <Overview
            dashboard={dashboard}
            providersById={providersById}
            onOpenInvoice={openTransactionDocument}
            onQuickMatch={matchTransaction}
            onCreateManualReceivable={createManualReceivable}
          />
        </>
      )}

      {activeTab === "management" && <ManagementReportView apiBase={apiBase} />}

      {activeTab === "media-spend" && <MediaSpendView apiBase={apiBase} onOpenProviderBalances={() => setActiveTab("media-funding")} />}

      {activeTab === "media-funding" && (
        <MediaFundingView
          apiBase={apiBase}
          companies={dashboard.providers}
          onOpenBankFunding={openProviderBankFunding}
          onOpenCompanies={() => setActiveTab("providers")}
          onOpenMediaSpend={() => setActiveTab("media-spend")}
        />
      )}

      {activeTab === "cash-flow" && (
        <CashFlowPositionView dashboard={dashboard} onSave={saveCashFlowSnapshot} />
      )}

      {activeTab === "cash-flow-invoices" && (
        <CashFlowOpenInvoicesView
          dashboard={dashboard}
          onCreateManualReceivable={createManualReceivable}
          onDeleteManualReceivable={deleteManualReceivable}
          onPrepareInvoiceEdit={prepareInvoiceDuplicate}
          onUpdateInvoice={updateInvoiceDraft}
        />
      )}

      {activeTab === "banks" && (
        <BanksView
          dashboard={dashboard}
          activeBank={bankTab}
          setActiveBank={setBankTab}
          activityView={bankActivityView}
          setActivityView={changeBankActivityView}
          bankGroupType={bankGroupType}
          bankGroupLabel={bankGroupLabel}
          onClearBankGroup={clearBankGroupDrilldown}
          onOpenMerchantGroup={(group) => openBankActivityGroup("merchant", group.key, group.name)}
          onOpenCardGroup={(group) => openBankActivityGroup("card", group.key, group.label)}
          onOpenAccountGroup={(group) => openBankActivityGroup("account", group.key, group.accountName)}
          wiseEntityView={wiseEntityView}
          setWiseEntityView={setWiseEntityView}
          bankDirection={bankDirection}
          setBankDirection={setBankDirection}
          bankAccountFilter={bankAccountFilter}
          setBankAccountFilter={setBankAccountFilter}
          bankCategoryFilter={bankCategoryFilter}
          setBankCategoryFilter={setBankCategoryFilter}
          teamFilter={teamFilter}
          setTeamFilter={setTeamFilter}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          matchFilter={matchFilter}
          setMatchFilter={setMatchFilter}
          transactionSortKey={transactionSortKey}
          setTransactionSortKey={setTransactionSortKey}
          transactionSortDirection={transactionSortDirection}
          setTransactionSortDirection={setTransactionSortDirection}
          allBankTransactions={allBankTransactions}
          allBankDateRange={allBankDateRange}
          allBankSource={allBankSource}
          setAllBankSource={setAllBankSource}
          wiseTransactions={wiseTransactions}
          wiseDateRange={wiseDateRange}
          revolutTransactions={revolutTransactions}
          revolutDateRange={revolutDateRange}
          slashTransactions={slashTransactions}
          slashDateRange={slashDateRange}
          amexTransactions={amexTransactions}
          bankPeriodMetrics={bankPeriodMetrics}
          bankPeriodMetricsError={bankPeriodMetricsError}
          isLoadingBankPeriodMetrics={isLoadingBankPeriodMetrics}
          providersById={providersById}
          isImportingWise={isImportingWise}
          isLoadingTransactions={isLoadingTransactionPage}
          transactionLoadError={transactionPageError}
          hasPreviousTransactions={hasPreviousTransactions}
          hasMoreTransactions={hasMoreTransactions}
          transactionPageTotalCount={transactionPageIsCurrent ? transactionPageState.totalCount : undefined}
          bankActivitySummary={bankActivitySummary}
          isLoadingBankActivitySummary={isLoadingBankActivitySummary}
          bankActivitySummaryError={bankActivitySummaryError}
          onImportWiseStatements={importWiseStatements}
          onLoadPreviousTransactions={loadPreviousTransactionPage}
          onLoadMoreTransactions={loadNextTransactionPage}
          onRetryBankActivitySummary={retryBankActivitySummary}
          onLoadAllBankTransactions={loadAllBankTransactions}
          onFilterWiseTransactions={filterWiseTransactions}
          onLoadRevolutTransactions={loadRevolutTransactions}
          onLoadSlashTransactions={loadSlashTransactions}
          onMatch={matchTransaction}
          onAssignTeam={assignTransactionTeam}
          onUpdateCategory={updateTransactionCategory}
          onOpenInvoice={openTransactionDocument}
          onMatchInvoice={setInvoiceMatchTransaction}
          onCreateHolding={createHolding}
          onUpdateHolding={updateHolding}
          onDeleteHolding={deleteHolding}
          onRefreshRates={refreshFxRates}
        />
      )}

      {activeTab === "analytics" && (
        <AnalyticsView
          analyticsBuildReasons={analyticsBuildReasons}
          analyticsDataRevision={analyticsDataRevision}
          analyticsSnapshots={analyticsSnapshots}
          dashboard={dashboard}
          ensureAnalyticsSnapshot={ensureAnalyticsSnapshot}
          onViewCategoryTransactions={(selection, range) => {
            setActiveTab("banks");
            setBankTab("all");
            setBankActivityView("transactions");
            clearBankGroupDrilldown();
            setAllBankSource("all");
            setBankAccountFilter("all");
            setTeamFilter("all");
            setMatchFilter("all");
            setSearchTerm("");
            setBankDirection(selection.direction);
            setBankCategoryFilter(selection.category);
            setAllBankDateRange(range);
          }}
        />
      )}

      {activeTab === "distribution" && (
        <DistributionView dashboard={dashboard} onSaveAdjustment={saveProfitDistributionAdjustment} />
      )}

      {activeTab === "revenue" && (
        <IncomeRevenueView
          dashboard={dashboard}
          onSyncRevenue={syncRevenue}
          onDraftRevenueRun={draftRevenueRun}
          onOpenInvoices={() => setActiveTab("invoices")}
        />
      )}

      {activeTab === "invoices" && (
        <IncomeInvoicesView
          dashboard={dashboard}
          providersById={providersById}
          onCreateDraft={submitInvoice}
          onPrepareDuplicate={prepareInvoiceDuplicate}
          onDeleteDrafts={deleteInvoiceDrafts}
          onUpdateDraft={updateInvoiceDraft}
          onSendInvoices={sendInvoices}
          onBulkRecordPayments={recordBulkInvoicePayments}
          onRecordPayment={recordInvoicePayment}
        />
      )}

      {activeTab === "expenses" && (
        <ExpensesView
          apiBase={apiBase}
          dashboard={dashboard}
          onCreateExpense={submitExpense}
          onMatchPayment={matchExpensePayment}
        />
      )}

      {activeTab === "providers" && (
        <ProvidersView
          providers={dashboard.providers}
          revenuePartners={dashboard.revenuePartners}
          taxes={dashboard.meritTaxes}
          teamsById={teamsById}
          onAdd={() => {
            setEditingProvider(null);
            setProviderModalOpen(true);
          }}
          onEditProvider={(provider) => {
            setEditingProvider(provider);
            setProviderModalOpen(true);
          }}
          onEditRevenuePartner={setEditingRevenuePartner}
          onAddRevenuePartner={(provider) => {
            setEditingRevenuePartner(null);
            setCreatingRevenueRuleProviderId(provider.id);
          }}
          onDeleteProvider={(provider) => setDirectoryDeleteTarget({ kind: "provider", provider })}
          onDeleteRevenuePartner={(partner) => setDirectoryDeleteTarget({ kind: "revenue-partner", partner })}
        />
      )}

      {activeTab === "settings" && (
        <SettingsView
          dashboard={dashboard}
          onCreateTeam={createTeam}
          onCreateCategory={createTransactionCategory}
          onUpdateCategory={updateTransactionCategoryDefinition}
          onDeleteCategory={deleteTransactionCategoryDefinition}
          onSaveAiSettings={saveAiSettings}
          onRunAiPrompt={runAiPrompt}
        />
      )}
        </div>

      {invoiceTransaction && (
        <InvoiceModal
          transaction={invoiceTransaction}
          provider={invoiceTransaction.matchedProviderId ? providersById.get(invoiceTransaction.matchedProviderId) : undefined}
          providers={dashboard.providers}
          onClose={() => setInvoiceTransaction(null)}
          onSubmit={async (payload) => {
            await submitInvoice(payload);
            setInvoiceTransaction(null);
          }}
        />
      )}

      {invoiceMatchTransaction && (
        <InvoicePaymentMatchDialog
          transaction={invoiceMatchTransaction}
          dashboard={dashboard}
          onClose={() => setInvoiceMatchTransaction(null)}
          onSubmit={async (invoiceId) => {
            await matchInvoicePayment(invoiceMatchTransaction, invoiceId);
            setInvoiceMatchTransaction(null);
          }}
        />
      )}

      {expenseTransaction && (
        <ExpenseEditorDialog
          apiBase={apiBase}
          dashboard={dashboard}
          transaction={expenseTransaction}
          onClose={() => setExpenseTransaction(null)}
          onCreateExpense={async (payload) => {
            const expense = await submitExpense(payload);
            setExpenseTransaction(null);
            return expense;
          }}
          onMatchPayment={async (expenseId, transactionId) => {
            await matchExpensePayment(expenseId, transactionId);
            setExpenseTransaction(null);
          }}
        />
      )}

      {providerModalOpen && (
        <ProviderModal
          provider={editingProvider ?? undefined}
          taxes={dashboard.meritTaxes}
          onClose={() => {
            setProviderModalOpen(false);
            setEditingProvider(null);
          }}
          onSubmit={async (payload) => {
            if (editingProvider) {
              await saveProvider(editingProvider.id, payload);
            } else {
              await submitProvider(payload);
            }
            setProviderModalOpen(false);
            setEditingProvider(null);
            setNotice("Company saved. Matching transactions to it will keep learning bank aliases.");
          }}
        />
      )}
      {(editingRevenuePartner || creatingRevenueRuleProviderId) && (
        <RevenuePartnerModal
          partner={editingRevenuePartner ?? undefined}
          initialProviderId={creatingRevenueRuleProviderId ?? undefined}
          providers={dashboard.providers}
          teams={dashboard.teams}
          taxes={dashboard.meritTaxes}
          categories={dashboard.transactionCategories}
          onClose={() => {
            setEditingRevenuePartner(null);
            setCreatingRevenueRuleProviderId(null);
          }}
          onSubmit={async (payload) => {
            if (editingRevenuePartner) await saveRevenuePartner(editingRevenuePartner.id, payload);
            else await createRevenuePartner(payload);
            setEditingRevenuePartner(null);
            setCreatingRevenueRuleProviderId(null);
            setNotice(editingRevenuePartner ? "Revenue rule saved." : "Revenue rule added to the client.");
          }}
        />
      )}
      {directoryDeleteTarget && (
        <DeleteCompanyDialog
          target={directoryDeleteTarget}
          onClose={() => setDirectoryDeleteTarget(null)}
          onConfirm={async () => {
            if (directoryDeleteTarget.kind === "provider") {
              await removeProvider(directoryDeleteTarget.provider);
            } else {
              await removeRevenuePartner(directoryDeleteTarget.partner);
            }
            setDirectoryDeleteTarget(null);
          }}
        />
      )}
      </div>
    </main>
  );
}

function TransactionReviewerWorkspace({
  access,
  account,
  category,
  dateRange,
  direction,
  error,
  hasMore,
  hasPrevious,
  isLoading,
  loadError,
  match,
  notice,
  onAssignTeam,
  onDismissMessage,
  onLoadMore,
  onLoadPrevious,
  onMatch,
  onUpdateCategory,
  searchTerm,
  session,
  setAccount,
  setCategory,
  setDateRange,
  setDirection,
  setMatch,
  setSearchTerm,
  setSortDirection,
  setSortKey,
  setSource,
  setTeam,
  sortDirection,
  sortKey,
  source,
  team,
  themeMode,
  toggleThemeMode,
  totalCount,
  transactions
}: {
  access: TransactionReviewBootstrap;
  account: string;
  category: string;
  dateRange: BankTransactionDateRange;
  direction: "all" | "in" | "out";
  error: string | null;
  hasMore: boolean;
  hasPrevious: boolean;
  isLoading: boolean;
  loadError: string | null;
  match: TransactionMatchFilter;
  notice: string | null;
  onAssignTeam: (transaction: Transaction, teamId?: string) => Promise<void>;
  onDismissMessage: () => void;
  onLoadMore: () => Promise<void>;
  onLoadPrevious: () => Promise<void>;
  onMatch: (transaction: Transaction, providerId?: string, scope?: TransactionOverrideScope) => Promise<void>;
  onUpdateCategory: (transaction: Transaction, category: string, scope?: TransactionOverrideScope) => Promise<void>;
  searchTerm: string;
  session: DashboardSession;
  setAccount: (value: string) => void;
  setCategory: (value: string) => void;
  setDateRange: (value: BankTransactionDateRange) => void;
  setDirection: (value: "all" | "in" | "out") => void;
  setMatch: (value: TransactionMatchFilter) => void;
  setSearchTerm: (value: string) => void;
  setSortDirection: (value: SortDirection) => void;
  setSortKey: (value: TransactionSortKey) => void;
  setSource: (value: "all" | BankSource) => void;
  setTeam: (value: string) => void;
  sortDirection: SortDirection;
  sortKey: TransactionSortKey;
  source: "all" | BankSource;
  team: string;
  themeMode: ThemeMode;
  toggleThemeMode: () => void;
  totalCount?: number;
  transactions: Transaction[];
}) {
  const companiesById = useMemo(
    () => new Map(access.companies.map((company) => [company.id, company])),
    [access.companies]
  );
  const accountOptions = useMemo(
    () => access.accounts
      .filter((item) => source === "all" || item.source === source)
      .sort((left, right) => sourceLabel(left.source).localeCompare(sourceLabel(right.source)) || left.name.localeCompare(right.name)),
    [access.accounts, source]
  );

  useEffect(() => {
    if (account !== "all" && !accountOptions.some((item) => item.id === account)) setAccount("all");
  }, [account, accountOptions, setAccount]);

  const filters: ActiveFilter[] = [
    ...(source === "all" ? [] : [{ key: "source", label: `Source: ${sourceLabel(source)}`, onRemove: () => setSource("all") }]),
    ...(account === "all" ? [] : [{ key: "account", label: `Account: ${accountOptions.find((item) => item.id === account)?.name ?? account}`, onRemove: () => setAccount("all") }]),
    ...(direction === "all" ? [] : [{ key: "direction", label: `Direction: ${direction === "in" ? "Money in" : "Money out"}`, onRemove: () => setDirection("all") }]),
    ...(category === "all" ? [] : [{ key: "category", label: `Category: ${category}`, onRemove: () => setCategory("all") }]),
    ...(match === "all" ? [] : [{ key: "match", label: match === "matched" ? "Status: Categorized" : "Status: Needs category", onRemove: () => setMatch("all") }]),
    ...(team === "all" ? [] : [{ key: "team", label: `Owner: ${team === "unassigned" ? "Unassigned" : access.teams.find((item) => item.id === team)?.name ?? team}`, onRemove: () => setTeam("all") }])
  ];

  function requestSort(nextSortKey: TransactionSortKey) {
    if (nextSortKey === sortKey) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(nextSortKey);
    setSortDirection("asc");
  }

  return (
    <main className="transaction-reviewer-shell">
      <header className="transaction-reviewer-header">
        <div className="transaction-reviewer-brand">
          <Banknote aria-hidden="true" size={19} />
          <div><strong>Finance</strong><span>Transaction review</span></div>
        </div>
        <div className="transaction-reviewer-account">
          <span>{session.username}</span>
          <ThemeToggle themeMode={themeMode} onToggle={toggleThemeMode} />
          <a className="secondary-button transaction-reviewer-logout" href="/logout"><LogOut aria-hidden="true" size={15} /> Log out</a>
        </div>
      </header>
      <div className="transaction-reviewer-content">
        {(error || notice) && (
          <div className={error ? "toast error" : "toast"} role={error ? "alert" : "status"} aria-live={error ? "assertive" : "polite"}>
            {error ? <CircleAlert size={16} /> : <Check size={16} />}
            <span>{error || notice}</span>
            <Button aria-label="Dismiss" onClick={onDismissMessage}><X size={14} /></Button>
          </div>
        )}
        <section className="panel wide-panel transaction-reviewer-panel">
          <div className="panel-header compact transaction-reviewer-panel-header">
            <div><p className="eyebrow">Bank transactions</p><h2>Review and correct</h2></div>
            <div className="list-toolbar transaction-reviewer-toolbar">
              <div className="list-toolbar-main">
                <ToolbarSearchField
                  ariaLabel="Search bank transactions"
                  className="bank-toolbar-search"
                  placeholder="Search transactions"
                  value={searchTerm}
                  onChange={setSearchTerm}
                />
                <FilterPopover activeCount={filters.length} title="Transaction filters">
                  <FilterFieldGroup title="Transaction">
                    <label>Source
                      <NativeSelect aria-label="Filter transactions by source" value={source} onValueChange={(value) => setSource(value as "all" | BankSource)}>
                        <NativeSelectOption value="all">All sources</NativeSelectOption>
                        {bankSources.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.label}</NativeSelectOption>)}
                      </NativeSelect>
                    </label>
                    <label>Account
                      <NativeSelect aria-label="Filter transactions by account" value={account} onValueChange={setAccount}>
                        <NativeSelectOption value="all">All accounts</NativeSelectOption>
                        {accountOptions.map((item) => <NativeSelectOption key={item.id} value={item.id}>{source === "all" ? `${sourceLabel(item.source)} · ${item.name}` : item.name}</NativeSelectOption>)}
                      </NativeSelect>
                    </label>
                    <label>Direction
                      <NativeSelect aria-label="Filter transactions by direction" value={direction} onValueChange={(value) => setDirection(value as "all" | "in" | "out")}>
                        <NativeSelectOption value="all">Money in & out</NativeSelectOption>
                        <NativeSelectOption value="in">Money in</NativeSelectOption>
                        <NativeSelectOption value="out">Money out</NativeSelectOption>
                      </NativeSelect>
                    </label>
                    <label>Status
                      <NativeSelect aria-label="Filter transactions by category status" value={match} onValueChange={(value) => setMatch(value as TransactionMatchFilter)}>
                        <NativeSelectOption value="all">All transactions</NativeSelectOption>
                        <NativeSelectOption value="matched">Categorized</NativeSelectOption>
                        <NativeSelectOption value="needs-review">Needs category</NativeSelectOption>
                      </NativeSelect>
                    </label>
                    <label>Category
                      <NativeSelect aria-label="Filter transactions by category" value={category} onValueChange={setCategory}>
                        <NativeSelectOption value="all">All categories</NativeSelectOption>
                        {[...access.categories].sort((left, right) => left.name.localeCompare(right.name)).map((item) => <NativeSelectOption key={item.id} value={item.name}>{item.name}</NativeSelectOption>)}
                      </NativeSelect>
                    </label>
                    <label>Owner
                      <NativeSelect aria-label="Filter transactions by owner" value={team} onValueChange={setTeam}>
                        <NativeSelectOption value="all">All owners</NativeSelectOption>
                        <NativeSelectOption value="unassigned">Unassigned</NativeSelectOption>
                        {access.teams.map((item) => <NativeSelectOption key={item.id} value={item.id}>{item.name}</NativeSelectOption>)}
                      </NativeSelect>
                    </label>
                  </FilterFieldGroup>
                </FilterPopover>
              </div>
              <BankDateRangeControls
                dateRange={dateRange}
                isLoading={isLoading}
                onLoad={async (value) => setDateRange(value)}
                windowDays={revolutDefaultActivityWindowDays}
              />
            </div>
          </div>
          <ActiveFilterBar
            filters={filters}
            resultLabel={totalCount === undefined ? `${transactions.length} transactions on this page` : `${transactions.length} of ${totalCount.toLocaleString("en-US")} matching transactions`}
            onClearAll={() => {
              setSource("all");
              setAccount("all");
              setDirection("all");
              setCategory("all");
              setMatch("all");
              setTeam("all");
            }}
          />
          <TransactionTable
            categories={access.categories}
            expenses={[]}
            hasMore={hasMore}
            hasPrevious={hasPrevious}
            isLoading={isLoading}
            loadError={loadError}
            onAssignTeam={onAssignTeam}
            onLoadMore={onLoadMore}
            onLoadPrevious={onLoadPrevious}
            onMatch={onMatch}
            onMatchInvoice={() => undefined}
            onOpenInvoice={() => undefined}
            onSort={requestSort}
            onUpdateCategory={onUpdateCategory}
            providers={access.companies}
            providersById={companiesById}
            reviewMode
            rows={transactions}
            sortDirection={sortDirection}
            sortKey={sortKey}
            source="all"
            teams={access.teams}
            totalCount={totalCount}
          />
        </section>
      </div>
    </main>
  );
}

function ThemeToggle({ themeMode, onToggle }: { themeMode: ThemeMode; onToggle: () => void }) {
  const isDark = themeMode === "dark";
  return (
    <Button
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      aria-pressed={isDark}
      className={`theme-toggle ${isDark ? "dark" : "light"}`}
      onClick={onToggle}
      title={`Switch to ${isDark ? "light" : "dark"} mode`}
      type="button"
    >
      <span className="theme-toggle-option">
        <Sun size={15} />
      </span>
      <span className="theme-toggle-option">
        <Moon size={15} />
      </span>
      <span className="theme-toggle-thumb" aria-hidden="true">
        {isDark ? <Moon size={16} /> : <Sun size={16} />}
      </span>
    </Button>
  );
}

function SidebarActions({
  id,
  open,
  themeMode,
  onToggleOpen,
  onToggleTheme,
  onSync,
  isSyncing,
  mobile = false
}: {
  id: string;
  open: boolean;
  themeMode: ThemeMode;
  onToggleOpen: () => void;
  onToggleTheme: () => void;
  onSync: () => Promise<void>;
  isSyncing: boolean;
  mobile?: boolean;
}) {
  const nextTheme = themeMode === "dark" ? "light" : "dark";
  const menuId = `${id}-menu`;
  return (
    <div className={`sidebar-actions-group ${mobile ? "mobile-sidebar-actions" : ""}`}>
      <Button
        aria-controls={menuId}
        aria-expanded={open}
        className="sidebar-actions-trigger"
        data-testid={`${id}-trigger`}
        onClick={onToggleOpen}
        type="button"
      >
        <UserRound aria-hidden="true" size={16} />
        <span>Account</span>
        <ChevronDown aria-hidden="true" className={open ? "open" : ""} size={15} />
      </Button>
      {open && (
        <div className="sidebar-actions-list" data-testid={`${id}-menu`} id={menuId}>
          <Button
            aria-label={`Switch to ${nextTheme} mode`}
            className="sidebar-action-item"
            onClick={onToggleTheme}
            title={`Switch to ${nextTheme} mode`}
            type="button"
          >
            {themeMode === "dark" ? <Sun aria-hidden="true" size={15} /> : <Moon aria-hidden="true" size={15} />}
            <span>{nextTheme === "dark" ? "Dark mode" : "Light mode"}</span>
          </Button>
          <Button
            aria-label="Refresh and sync dashboard data"
            className="sidebar-action-item"
            disabled={isSyncing}
            onClick={() => void onSync()}
            title="Import current bank activity and refresh dashboard data"
            type="button"
          >
            {isSyncing ? <Loader2 aria-hidden="true" className="spin" size={15} /> : <RefreshCw aria-hidden="true" size={15} />}
            <span>{isSyncing ? "Syncing" : "Sync data"}</span>
          </Button>
          <a className="sidebar-action-item sidebar-logout-action" href="/logout">
            <LogOut aria-hidden="true" size={15} />
            <span>Log out</span>
          </a>
        </div>
      )}
    </div>
  );
}

function Sidebar({
  activeTab,
  setActiveTab,
  incomeAutomationUnreadCount,
  themeMode,
  onToggleTheme,
  onSync,
  isSyncing
}: {
  activeTab: ActiveTab;
  setActiveTab: React.Dispatch<React.SetStateAction<ActiveTab>>;
  incomeAutomationUnreadCount: number;
  themeMode: ThemeMode;
  onToggleTheme: () => void;
  onSync: () => Promise<void>;
  isSyncing: boolean;
}) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  type SidebarItem = { id: ActiveTab; label: string; icon: React.ReactNode };
  const primaryItems: SidebarItem[] = [
    { id: "overview", label: "Overview", icon: <Home size={17} /> },
    { id: "analytics", label: "Analytics", icon: <PieChart size={17} /> },
    { id: "media-spend", label: "Media spend", icon: <BadgeDollarSign size={17} /> },
    { id: "banks", label: "Banks", icon: <Landmark size={17} /> },
  ];
  const operationsItems: SidebarItem[] = [
    { id: "management", label: "Management", icon: <BookOpen size={17} /> },
    { id: "distribution", label: "Distribution", icon: <CircleDollarSign size={17} /> }
  ];
  const accountingItems: SidebarItem[] = [
    { id: "revenue", label: "Revenue", icon: <BadgeDollarSign size={17} /> },
    { id: "invoices", label: "Invoices", icon: <FileText size={17} /> },
    { id: "expenses", label: "Expenses", icon: <ReceiptText size={17} /> }
  ];
  const cashFlowItems: SidebarItem[] = [
    { id: "cash-flow", label: "Position", icon: <WalletCards size={17} /> },
    { id: "cash-flow-invoices", label: "Open invoices", icon: <FileText size={17} /> },
    { id: "media-funding", label: "Provider funds", icon: <CircleDollarSign size={17} /> }
  ];
  const workspaceItems: SidebarItem[] = [
    { id: "providers", label: "Companies", icon: <Building2 size={17} /> },
    { id: "settings", label: "Settings", icon: <Settings size={17} /> }
  ];
  const activeItem = [...primaryItems, ...cashFlowItems, ...accountingItems, ...operationsItems, ...workspaceItems]
    .find((item) => item.id === activeTab) ?? primaryItems[0];

  useEffect(() => {
    if (!mobileMenuOpen && !actionsMenuOpen) return;

    function closeOnOutsidePress(event: PointerEvent) {
      if (!sidebarRef.current?.contains(event.target as Node)) {
        setMobileMenuOpen(false);
        setActionsMenuOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMobileMenuOpen(false);
        setActionsMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [actionsMenuOpen, mobileMenuOpen]);

  function selectTab(id: ActiveTab) {
    setActiveTab(id);
    setMobileMenuOpen(false);
    setActionsMenuOpen(false);
  }

  function navigationButton(item: SidebarItem, nested = false, mobile = false) {
    const unreadCount = item.id === "revenue" ? incomeAutomationUnreadCount : 0;
    return (
      <Button
        key={item.id}
        aria-label={unreadCount > 0 ? `${item.label}, ${unreadCount} unread automation ${unreadCount === 1 ? "update" : "updates"}` : item.label}
        className={`${activeTab === item.id ? "active" : ""} ${nested ? "nested" : ""} ${unreadCount > 0 ? "has-meta" : ""}`}
        onClick={() => selectTab(item.id)}
        aria-current={activeTab === item.id ? "page" : undefined}
        role={mobile ? "menuitem" : undefined}
        title={item.label}
        type="button"
      >
        {item.icon}
        <span>{item.label}</span>
        {unreadCount > 0 && (
          <span aria-hidden="true" className="sidebar-notification-badge">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </Button>
    );
  }

  return (
    <aside className="sidebar" aria-label="Finance dashboard navigation" ref={sidebarRef}>
      <div className="mobile-command-bar">
        <div className="mobile-nav-shell">
          <Button
            aria-controls="mobile-navigation-menu"
            aria-expanded={mobileMenuOpen}
            aria-haspopup="menu"
            className="mobile-nav-trigger"
            data-testid="mobile-nav-trigger"
            onClick={() => {
              setMobileMenuOpen((current) => !current);
              setActionsMenuOpen(false);
            }}
            type="button"
          >
            <span className="mobile-nav-current">{activeItem.icon}<span>{activeItem.label}</span></span>
            <ChevronDown className={mobileMenuOpen ? "open" : ""} size={18} />
          </Button>
          {mobileMenuOpen && (
            <div className="mobile-nav-menu" data-testid="mobile-nav-menu" id="mobile-navigation-menu" role="menu">
              {primaryItems.map((item) => navigationButton(item, false, true))}
              <div className="mobile-nav-group-label">Accounting</div>
              {accountingItems.map((item) => navigationButton(item, false, true))}
              <div className="mobile-nav-group-label">Cash Flow</div>
              {cashFlowItems.map((item) => navigationButton(item, false, true))}
              <div className="mobile-nav-group-label has-badge">
                <span>Operations</span>
                <span className="sidebar-beta-badge">Beta</span>
              </div>
              {operationsItems.map((item) => navigationButton(item, false, true))}
              <div className="mobile-nav-group-label">Workspace</div>
              {workspaceItems.map((item) => navigationButton(item, false, true))}
            </div>
          )}
        </div>
        <SidebarActions
          id="mobile-account-actions"
          isSyncing={isSyncing}
          mobile
          onSync={onSync}
          onToggleOpen={() => {
            setActionsMenuOpen((current) => !current);
            setMobileMenuOpen(false);
          }}
          onToggleTheme={onToggleTheme}
          open={actionsMenuOpen}
          themeMode={themeMode}
        />
      </div>
      <div className="sidebar-brand">
        <Banknote size={19} />
        <strong>Finance</strong>
      </div>
      <nav className="sidebar-nav">
        {primaryItems.map((item) => navigationButton(item))}
        <div className="sidebar-section-label">Accounting</div>
        <div className="sidebar-income-group">
          {accountingItems.map((item) => navigationButton(item, true))}
        </div>
        <div className="sidebar-section-label">Cash Flow</div>
        <div className="sidebar-income-group">
          {cashFlowItems.map((item) => navigationButton(item, true))}
        </div>
        <div className="sidebar-section-label has-badge">
          <span>Operations</span>
          <span className="sidebar-beta-badge">Beta</span>
        </div>
        <div className="sidebar-income-group">
          {operationsItems.map((item) => navigationButton(item, true))}
        </div>
        <div className="sidebar-section-label">Workspace</div>
        <div className="sidebar-income-group">
          {workspaceItems.map((item) => navigationButton(item, true))}
        </div>
      </nav>
      <div className="sidebar-footer">
        {activeTab === "management" && <p>Live operations · report imported separately</p>}
        <SidebarActions
          id="desktop-account-actions"
          isSyncing={isSyncing}
          onSync={onSync}
          onToggleOpen={() => setActionsMenuOpen((current) => !current)}
          onToggleTheme={onToggleTheme}
          open={actionsMenuOpen}
          themeMode={themeMode}
        />
      </div>
    </aside>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  breakdown,
  danger,
  good
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  breakdown?: string;
  danger?: boolean;
  good?: boolean;
}) {
  return (
    <article className={`metric-card ${danger ? "danger" : ""} ${good ? "good" : ""}`}>
      <div className="metric-icon">{icon}</div>
      <div className="metric-card-content">
        <InfoPopover label={label}>{detail}</InfoPopover>
        <strong><AnimatedNumber animationKey={`overview-metric-${label}`} value={value} /></strong>
        <span>{label}</span>
        {breakdown && <small className="currency-breakdown">{breakdown}</small>}
      </div>
    </article>
  );
}

function Overview({
  dashboard,
  providersById,
  onOpenInvoice,
  onQuickMatch,
  onCreateManualReceivable
}: {
  dashboard: DashboardSnapshot;
  providersById: Map<string, Provider>;
  onOpenInvoice: (transaction: Transaction) => void;
  onQuickMatch: (transaction: Transaction, providerId?: string) => void;
  onCreateManualReceivable: (payload: CreateManualReceivablePayload) => Promise<void>;
}) {
  const [manualReceivableOpen, setManualReceivableOpen] = useState(false);
  const reviewRows = dashboard.transactionReviewPreview.filter(categoryNeedsReview).slice(0, 5);
  const payableMonths = Array.from(new Set(dashboard.payables.flatMap((payable) => Object.keys(payable.monthBuckets))));
  const hasPayables = dashboard.payables.length > 0;
  const netOperatingAssetsTone = currencyTotalsTone(dashboard.metrics.netOperatingAssets);
  const assetsTone = currencyTotalsTone(dashboard.metrics.totalAssets);

  return (
    <div className="overview-grid">
      <div className="overview-balances-grid">
        <section className="panel">
          <div className="panel-header compact">
            <h2>Account balances</h2>
            <span className="total-pill" title={nativeCurrencyBreakdown(dashboard.metrics.totalCash)}>{formatUsdCurrencyTotal(dashboard.metrics.totalCash, dashboard.fxRates)}</span>
          </div>
          <SimpleMoneyTable
            nameLabel="Account"
            rows={dashboard.accounts.filter(hasNonZeroAccountBalance).map((item) => ({
              id: item.id,
              name: item.name,
              title: item.name,
              amount: item.balance,
              currency: item.currency,
              source: sourceLabel(item.source)
            }))}
            emptyLabel="No connected account balances"
          />
        </section>

        <div className="overview-balance-stack">
          <section className="panel">
            <div className="panel-header compact">
              <h2>Outstanding receivables</h2>
              <div className="receivables-header-actions">
                <span className="total-pill" title={nativeCurrencyBreakdown(dashboard.metrics.totalReceivables)}>{formatUsdCurrencyTotal(dashboard.metrics.totalReceivables, dashboard.fxRates, money(0))}</span>
                <Button className="icon-text-button receivables-add-button" type="button" onClick={() => setManualReceivableOpen(true)}>
                  <Plus size={14} /> Add
                </Button>
              </div>
            </div>
            <SimpleMoneyTable
              nameLabel="Receivable"
              rows={dashboard.receivables.map((item) => ({
                id: item.id,
                name: item.id.startsWith("open-invoices-") ? `Invoices · ${item.currency}` : item.name,
                title: item.id.startsWith("open-invoices-") ? `Open invoices · ${item.currency}` : item.name,
                amount: item.balance,
                currency: item.currency,
                source: sourceLabel(item.source)
              }))}
              emptyLabel="No outstanding receivables"
            />
          </section>

          <section className="panel">
            <div className="panel-header compact">
              <h2>Other open balances</h2>
              <span className="total-pill" title={nativeCurrencyBreakdown(dashboard.metrics.totalOpenBalance)}>{formatUsdCurrencyTotal(dashboard.metrics.totalOpenBalance, dashboard.fxRates, money(0))}</span>
            </div>
            <SimpleMoneyTable
              nameLabel="Balance item"
              rows={dashboard.openBalances.map((item) => ({
                id: item.id,
                name: item.name,
                title: item.name,
                amount: item.balance,
                currency: item.currency,
                source: sourceLabel(item.source)
              }))}
              emptyLabel="No other open balances"
              dense
            />
          </section>
        </div>
      </div>

      <section className="panel">
        <div className="panel-header compact">
          <h2>Supplier payables</h2>
          <span className={`total-pill ${hasPayables ? "danger" : ""}`} title={nativeCurrencyBreakdown(dashboard.metrics.totalPayables)}>{formatUsdCurrencyTotal(dashboard.metrics.totalPayables, dashboard.fxRates, money(0))}</span>
        </div>
        <div className="table-wrap">
          <table className="data-table payables-table">
            <thead>
              <tr>
                <th>Supplier or platform</th>
                <th>Amount due</th>
                {payableMonths.map((month) => (
                  <th key={month}>{month}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dashboard.payables.length > 0 ? (
                dashboard.payables.map((payable) => (
                  <tr key={payable.id}>
                    <td>
                      <strong>{payable.supplier}</strong>
                      <small>{payable.category}</small>
                    </td>
                    <td className="amount danger-text">{money(payable.balance, payable.currency)}</td>
                    {payableMonths.map((month) => {
                      const hasMonth = Object.prototype.hasOwnProperty.call(payable.monthBuckets, month);
                      return (
                        <td className="amount" key={month}>
                          {hasMonth ? money(payable.monthBuckets[month], payable.currency) : "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={2 + payableMonths.length}>Nothing is currently due to suppliers</td>
                </tr>
              )}
            </tbody>
            {dashboard.payables.length > 0 && (
              <tfoot>
                <tr>
                  <td>Total</td>
                  <td className="amount">{formatCurrencyTotals(dashboard.metrics.totalPayables)}</td>
                  {payableMonths.map((month) => (
                    <td className="amount" key={month}>
                      {formatCurrencyTotals(dashboard.metrics.monthTotals[month] ?? {})}
                    </td>
                  ))}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      <div className="overview-bottom-grid">
        <section className="panel">
          <div className="panel-header compact">
            <h2>Net assets calculation</h2>
            <span className={`total-pill ${assetsTone}`} title={nativeCurrencyBreakdown(dashboard.metrics.totalAssets)}>{formatUsdCurrencyTotal(dashboard.metrics.totalAssets, dashboard.fxRates)}</span>
          </div>
          <div className="bridge">
            <BridgeRow label="Account balances" value={dashboard.metrics.totalCash} emptyValue={money(0)} />
            <BridgeRow label="Outstanding receivables" value={dashboard.metrics.totalReceivables} emptyValue={money(0)} />
            <BridgeRow label="Other open balances" value={dashboard.metrics.totalOpenBalance} emptyValue={money(0)} />
            <BridgeRow label="Gross operating assets" value={dashboard.metrics.totalFloat} emptyValue={money(0)} />
            <BridgeRow label="Less: supplier payables" value={hasPayables ? negateCurrencyTotals(dashboard.metrics.totalPayables) : {}} emptyValue={money(0)} danger={hasPayables} />
            <BridgeRow
              label="Net operating assets"
              value={dashboard.metrics.netOperatingAssets}
              emptyValue={money(0)}
              good={netOperatingAssetsTone === "good"}
              danger={netOperatingAssetsTone === "danger"}
            />
            <BridgeRow label="Investments" value={dashboard.metrics.investments} emptyValue={money(0)} />
            <BridgeRow label="Total assets" value={dashboard.metrics.totalAssets} emptyValue={money(0)} good={assetsTone === "good"} danger={assetsTone === "danger"} />
          </div>
        </section>

        <section className="panel">
          <div className="panel-header compact">
            <h2>Transactions to review</h2>
            <span className={`total-pill ${reviewRows.length > 0 ? "warning" : ""}`}>{reviewRows.length} {reviewRows.length === 1 ? "item" : "items"}</span>
          </div>
          <div className="review-list overview-review-list">
            {reviewRows.length > 0 ? (
              reviewRows.map((transaction) => {
                const provider = transaction.matchedProviderId ? providersById.get(transaction.matchedProviderId) : undefined;
                return (
                  <article className="review-row" key={transaction.id}>
                    <div className={`direction-badge ${transaction.direction}`}>
                      {transaction.direction === "in" ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
                    </div>
                    <div className="review-copy">
                      <strong>{transaction.merchantName ?? transaction.counterparty}</strong>
                      <span>{transaction.description}</span>
                    </div>
                    <div className="review-amount">{money(transaction.amount, transaction.currency)}</div>
                    <div className="review-actions">
                      <div className="match-chip">{providerLabel(provider)}</div>
                      <Button className="icon-text-button" onClick={() => provider && onQuickMatch(transaction, provider.id)} disabled={!provider}>
                        <ShieldCheck size={15} />
                        Match
                      </Button>
                      <Button className="icon-text-button" onClick={() => onOpenInvoice(transaction)}>
                        <FilePlus2 size={15} />
                        Document
                      </Button>
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="empty-state">All transactions are categorized</div>
            )}
          </div>
        </section>
      </div>

      {manualReceivableOpen && (
        <ManualReceivableDialog
          onClose={() => setManualReceivableOpen(false)}
          onSubmit={async (payload) => {
            await onCreateManualReceivable(payload);
            setManualReceivableOpen(false);
          }}
        />
      )}
    </div>
  );
}

function BankHeadlineMetric({
  label,
  value,
  tone,
  title
}: {
  label: string;
  value: string;
  tone?: "good" | "warning";
  title?: string;
}) {
  return (
    <div className={`bank-headline-metric ${tone ?? ""}`} title={title}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function BankDetailsDrawer({
  children,
  label,
  open,
  onOpenChange
}: {
  children: ReactNode;
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <BaseDialog.Root open={open} onOpenChange={(nextOpen) => onOpenChange(nextOpen)}>
      {createPortal(
        <BaseDialog.Trigger className="bank-details-nudge" aria-label={`Open ${label} details`}>
          <PanelRightOpen aria-hidden="true" size={17} />
          <span>Details</span>
        </BaseDialog.Trigger>,
        document.body
      )}
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="bank-details-backdrop" />
        <BaseDialog.Popup className="bank-details-drawer">
          <div className="bank-details-drawer-header">
            <div>
              <p className="eyebrow">Bank details</p>
              <BaseDialog.Title>{label}</BaseDialog.Title>
            </div>
            <BaseDialog.Close className="icon-button" aria-label="Close bank details">
              <X aria-hidden="true" size={18} />
            </BaseDialog.Close>
          </div>
          <BaseDialog.Description className="screen-reader-only">
            Account, balance, and selected-period details for {label}.
          </BaseDialog.Description>
          <div className="bank-details-drawer-body">{children}</div>
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

type BankDetailAccountSortKey = "balance" | "name" | "source";

function BankDetailsAccountTable({
  emptyLabel,
  rows,
  secondaryLabel
}: {
  emptyLabel: string;
  rows: Array<{
    id: string;
    name: string;
    title: string;
    amount: number;
    currency: string;
    source: string;
    statementCoverage?: {
      importedAt?: string;
      periodEnd?: string;
      periodStart?: string;
    };
  }>;
  secondaryLabel: string;
}) {
  const [sortKey, setSortKey] = useUrlState<BankDetailAccountSortKey>("bankDetailSort", "balance", {
    allowedValues: ["balance", "name", "source"]
  });
  const [sortDirection, setSortDirection] = useUrlState<SortDirection>("bankDetailOrder", "desc", {
    allowedValues: ["asc", "desc"]
  });
  const sortedRows = useMemo(() => [...rows].sort((left, right) => {
    const leftValue = sortKey === "balance" ? left.amount : sortKey === "source" ? left.source : left.name;
    const rightValue = sortKey === "balance" ? right.amount : sortKey === "source" ? right.source : right.name;
    return compareTableValues(leftValue, rightValue, sortDirection) || left.name.localeCompare(right.name);
  }), [rows, sortDirection, sortKey]);

  function requestSort(nextSortKey: BankDetailAccountSortKey) {
    if (nextSortKey === sortKey) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(nextSortKey);
    setSortDirection(nextSortKey === "balance" ? "desc" : "asc");
  }

  return (
    <div className="bank-details-account-table-wrap">
      <table className="data-table bank-details-account-table">
        <thead>
          <tr>
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="name">Account</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="source">{secondaryLabel}</SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} className="amount" direction={sortDirection} onSort={requestSort} sortKey="balance">Balance</SortableTableHead>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row) => {
            const coverageLabel = row.statementCoverage?.periodStart && row.statementCoverage.periodEnd
              ? dateRangeLabel(row.statementCoverage.periodStart, row.statementCoverage.periodEnd)
              : "No CSV uploaded";
            const uploadLabel = row.statementCoverage?.importedAt
              ? dateTimeLabel(row.statementCoverage.importedAt)
              : "Never";

            return (
              <Fragment key={row.id}>
                <tr className={row.statementCoverage ? "bank-details-account-row has-coverage" : "bank-details-account-row"}>
                  <td>
                    <div className="bank-details-account-name">
                      <strong title={row.title}>{row.name}</strong>
                    </div>
                  </td>
                  <td><span className={`source-pill ${row.source.toLowerCase()}`}>{row.source}</span></td>
                  <td className={`amount ${row.amount < 0 ? "danger-text" : ""}`}>{money(row.amount, row.currency)}</td>
                </tr>
                {row.statementCoverage && (
                  <tr className="bank-details-account-coverage-row">
                    <td colSpan={3}>
                      <dl className="bank-details-account-coverage" aria-label={`${row.name} statement coverage`}>
                        <div>
                          <dt>Transactions cover</dt>
                          <dd className={row.statementCoverage.periodStart && row.statementCoverage.periodEnd ? "" : "warning-text"}>{coverageLabel}</dd>
                        </div>
                        <div>
                          <dt>Last uploaded</dt>
                          <dd className={row.statementCoverage.importedAt ? "" : "warning-text"}>{uploadLabel}</dd>
                        </div>
                      </dl>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {sortedRows.length === 0 && <tr><td colSpan={3}>{emptyLabel}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function BanksView({
  dashboard,
  activeBank,
  setActiveBank,
  activityView,
  setActivityView,
  bankGroupType,
  bankGroupLabel,
  onClearBankGroup,
  onOpenMerchantGroup,
  onOpenCardGroup,
  onOpenAccountGroup,
  wiseEntityView,
  setWiseEntityView,
  bankDirection,
  setBankDirection,
  bankAccountFilter,
  setBankAccountFilter,
  bankCategoryFilter,
  setBankCategoryFilter,
  teamFilter,
  setTeamFilter,
  searchTerm,
  setSearchTerm,
  matchFilter,
  setMatchFilter,
  transactionSortKey,
  setTransactionSortKey,
  transactionSortDirection,
  setTransactionSortDirection,
  allBankTransactions,
  allBankDateRange,
  allBankSource,
  setAllBankSource,
  wiseTransactions,
  wiseDateRange,
  revolutTransactions,
  revolutDateRange,
  slashTransactions,
  slashDateRange,
  amexTransactions,
  bankPeriodMetrics,
  bankPeriodMetricsError,
  isLoadingBankPeriodMetrics,
  providersById,
  isImportingWise,
  isLoadingTransactions,
  transactionLoadError,
  hasPreviousTransactions,
  hasMoreTransactions,
  transactionPageTotalCount,
  bankActivitySummary,
  isLoadingBankActivitySummary,
  bankActivitySummaryError,
  onImportWiseStatements,
  onLoadPreviousTransactions,
  onLoadMoreTransactions,
  onRetryBankActivitySummary,
  onLoadAllBankTransactions,
  onFilterWiseTransactions,
  onLoadRevolutTransactions,
  onLoadSlashTransactions,
  onMatch,
  onAssignTeam,
  onUpdateCategory,
  onOpenInvoice,
  onMatchInvoice,
  onCreateHolding,
  onUpdateHolding,
  onDeleteHolding,
  onRefreshRates
}: {
  dashboard: DashboardSnapshot;
  activeBank: BankTab;
  setActiveBank: (source: BankTab) => void;
  activityView: BankActivityViewMode;
  setActivityView: (view: BankActivityViewMode) => void;
  bankGroupType: "" | BankActivityGroupType;
  bankGroupLabel: string;
  onClearBankGroup: () => void;
  onOpenMerchantGroup: (group: BankMerchantGroupSummary) => void;
  onOpenCardGroup: (group: BankCardGroupSummary) => void;
  onOpenAccountGroup: (group: BankCardGroupSummary) => void;
  wiseEntityView: WiseEntityView;
  setWiseEntityView: (entity: WiseEntityView) => void;
  bankDirection: "all" | "in" | "out";
  setBankDirection: (direction: "all" | "in" | "out") => void;
  bankAccountFilter: string;
  setBankAccountFilter: (accountId: string) => void;
  bankCategoryFilter: string;
  setBankCategoryFilter: (category: string) => void;
  teamFilter: string;
  setTeamFilter: (teamId: string) => void;
  searchTerm: string;
  setSearchTerm: (value: string) => void;
  matchFilter: TransactionMatchFilter;
  setMatchFilter: (value: TransactionMatchFilter) => void;
  transactionSortKey: TransactionSortKey;
  setTransactionSortKey: (value: TransactionSortKey) => void;
  transactionSortDirection: SortDirection;
  setTransactionSortDirection: (value: SortDirection) => void;
  allBankTransactions: Transaction[];
  allBankDateRange: BankTransactionDateRange;
  allBankSource: "all" | BankSource;
  setAllBankSource: (source: "all" | BankSource) => void;
  wiseTransactions: Transaction[];
  wiseDateRange: BankTransactionDateRange;
  revolutTransactions: Transaction[];
  revolutDateRange: RevolutTransactionDateRange;
  slashTransactions: Transaction[];
  slashDateRange: SlashTransactionDateRange;
  amexTransactions: Transaction[];
  bankPeriodMetrics: BankPeriodMetrics | null;
  bankPeriodMetricsError: string | null;
  isLoadingBankPeriodMetrics: boolean;
  providersById: Map<string, Provider>;
  isImportingWise: boolean;
  isLoadingTransactions: boolean;
  transactionLoadError: string | null;
  hasPreviousTransactions: boolean;
  hasMoreTransactions: boolean;
  transactionPageTotalCount?: number;
  bankActivitySummary: BankActivitySummary | null;
  isLoadingBankActivitySummary: boolean;
  bankActivitySummaryError: string | null;
  onImportWiseStatements: (files: FileList | null) => Promise<void>;
  onLoadPreviousTransactions: () => Promise<void>;
  onLoadMoreTransactions: () => Promise<void>;
  onRetryBankActivitySummary: () => Promise<void>;
  onLoadAllBankTransactions: (dateRange: BankTransactionDateRange) => Promise<void>;
  onFilterWiseTransactions: (dateRange: BankTransactionDateRange) => Promise<void>;
  onLoadRevolutTransactions: (dateRange: RevolutTransactionDateRange) => Promise<void>;
  onLoadSlashTransactions: (dateRange: SlashTransactionDateRange) => Promise<void>;
  onMatch: (transaction: Transaction, providerId?: string) => void;
  onAssignTeam: (transaction: Transaction, teamId?: string) => void;
  onUpdateCategory: (transaction: Transaction, category: string) => void;
  onOpenInvoice: (transaction: Transaction) => void;
  onMatchInvoice: (transaction: Transaction) => void;
  onCreateHolding: (payload: CreateHoldingPayload) => Promise<void>;
  onUpdateHolding: (holdingId: string, payload: UpdateHoldingPayload) => Promise<void>;
  onDeleteHolding: (holdingId: string) => Promise<void>;
  onRefreshRates: () => Promise<void>;
}) {
  const [bankDetailsOpen, setBankDetailsOpen] = useState(false);
  const accountsBySource = new Map<BankSource, DashboardSnapshot["accounts"]>();
  const statusBySource = new Map<BankSource, DashboardSnapshot["integrationStatus"][number]>();
  for (const status of dashboard.integrationStatus) {
    const source = status.id as DataSource;
    if (status.id !== "openrouter" && status.id !== "coinbase" && isBankSource(source)) {
      statusBySource.set(source, status);
    }
  }
  for (const source of bankSources) {
    accountsBySource.set(
      source.id,
      dashboard.accounts.filter((account) =>
        account.source === source.id
        && hasNonZeroAccountBalance(account)
        && (
          source.id !== "wise"
          || wiseEntityView === "all"
          || account.wiseEntity === wiseEntityView
        )
      )
    );
  }
  const activeSource = bankSources.find((source) => source.id === activeBank);
  const activeSourceAccounts = activeSource ? (accountsBySource.get(activeSource.id) ?? []) : [];
  const activeSourceDisplayAccounts = activeSource?.id === "slash"
    ? activeSourceAccounts.filter((account) => account.slashAccountSubtype === "credit")
    : activeSourceAccounts;
  const activeSourceBalance = sumCurrencyTotals(activeSourceDisplayAccounts, (account) => account.balance);
  const activeSourceStatus = activeSource ? statusBySource.get(activeSource.id) : undefined;

  useEffect(() => {
    if (bankAccountFilter === "all" || !activeSource) return;
    const selectedAccount = dashboard.accounts.find((account) => account.id === bankAccountFilter);
    if (!selectedAccount || selectedAccount.source !== activeSource.id) setBankAccountFilter("all");
  }, [activeSource, bankAccountFilter, dashboard.accounts, setBankAccountFilter]);
  const periodMetricsReady = bankPeriodMetrics !== null && bankPeriodMetricsError === null;
  const periodSourceById = new Map(
    periodMetricsReady ? bankPeriodMetrics.sources.map((item) => [item.source, item]) : []
  );
  const wisePeriodActivity = wiseEntityView === "all"
    ? periodSourceById.get("wise") ?? null
    : periodMetricsReady
      ? bankPeriodMetrics.wiseEntities.find((item) => item.wiseEntity === wiseEntityView) ?? null
      : null;
  const periodMetricPlaceholder = bankPeriodMetricsError
    ? "Unavailable"
    : isLoadingBankPeriodMetrics || !bankPeriodMetrics
      ? "Calculating…"
      : "0";
  const allTabPeriodActivity = periodMetricsReady
    ? (
      allBankSource === "all"
        ? bankPeriodMetrics.sources
        : bankPeriodMetrics.sources.filter((item) => item.source === allBankSource)
    ).reduce<BankPeriodActivityMetrics>((total, activity) => ({
      moneyIn: combineBankPeriodDirectionMetrics(total.moneyIn, activity.moneyIn),
      moneyOut: combineBankPeriodDirectionMetrics(total.moneyOut, activity.moneyOut)
    }), {
      moneyIn: emptyBankPeriodDirectionMetrics(),
      moneyOut: emptyBankPeriodDirectionMetrics()
    })
    : null;
  const allTabPeriodTransactionCount = allTabPeriodActivity
    ? allTabPeriodActivity.moneyIn.transactionCount + allTabPeriodActivity.moneyOut.transactionCount
    : null;
  const activePeriodActivity = activeSource?.id === "wise"
    ? wisePeriodActivity
    : activeSource
      ? periodSourceById.get(activeSource.id) ?? null
      : null;
  const activePeriodTransactionCount = activePeriodActivity
    ? activePeriodActivity.moneyIn.transactionCount + activePeriodActivity.moneyOut.transactionCount
    : null;
  const slashAccounts = dashboard.accounts.filter((account) => account.source === "slash");
  const slashCashBalance = sumCurrencyTotals(
    slashAccounts.filter((account) => account.slashAccountSubtype === "cash"),
    (account) => account.balance
  );
  const slashCardCredit = sumCurrencyTotals(
    slashAccounts.filter((account) => account.slashAccountSubtype === "credit"),
    (account) => account.balance
  );
  const periodSlashCashback = periodMetricsReady && bankPeriodMetrics
    ? bankPeriodMetrics.slashCashback
    : null;
  const cashbackEarnedUsd = periodSlashCashback
    ? convertCurrencyTotalsToUsd(periodSlashCashback.earned, dashboard.fxRates)
    : null;
  const cashbackEligibleSpendUsd = periodSlashCashback
    ? convertCurrencyTotalsToUsd(periodSlashCashback.eligibleSpend, dashboard.fxRates)
    : null;
  const effectiveCashbackRate = cashbackEarnedUsd
    && cashbackEligibleSpendUsd
    && cashbackEarnedUsd.excludedCurrencies.length === 0
    && cashbackEligibleSpendUsd.excludedCurrencies.length === 0
    && cashbackEligibleSpendUsd.totalUsd > 0
    ? (cashbackEarnedUsd.totalUsd / cashbackEligibleSpendUsd.totalUsd) * 100
    : undefined;
  const detailAccounts = activeSource
    ? dashboard.accounts.filter((account) =>
      account.source === activeSource.id
      && (
        activeSource.id !== "wise"
        || wiseEntityView === "all"
        || account.wiseEntity === wiseEntityView
      )
    )
    : [];
  const wiseStatementCoverageByBalanceId = new Map(
    wiseStatementAccountCoverage(
      dashboard.accounts,
      dashboard.wiseStatementImports,
      wiseEntityView
    ).map((coverage) => [coverage.balanceId, coverage])
  );
  const activeBankLabel = activeSource
    ? activeSource.id === "wise" && wiseEntityView !== "all"
      ? `Wise · ${wiseEntityShortLabel(wiseEntityView)}`
      : activeSource.label
    : activeBank === "holdings"
      ? "Cash & wallet holdings"
      : "All bank activity";

  useEffect(() => {
    setBankDetailsOpen(false);
  }, [activeBank, wiseEntityView]);

  const headerMetrics = activeBank === "all" ? (
    <>
      <BankHeadlineMetric
        label="Period money in"
        value={allTabPeriodActivity
          ? formatUsdCurrencyTotal(allTabPeriodActivity.moneyIn.volume, dashboard.fxRates, money(0))
          : periodMetricPlaceholder}
        title={allTabPeriodActivity ? nativeCurrencyBreakdown(allTabPeriodActivity.moneyIn.volume) : undefined}
      />
      <BankHeadlineMetric
        label="Period spent"
        value={allTabPeriodActivity
          ? formatUsdCurrencyTotal(allTabPeriodActivity.moneyOut.volume, dashboard.fxRates, money(0))
          : periodMetricPlaceholder}
        title={allTabPeriodActivity ? nativeCurrencyBreakdown(allTabPeriodActivity.moneyOut.volume) : undefined}
      />
      <BankHeadlineMetric
        label="Transactions"
        value={allTabPeriodTransactionCount === null ? periodMetricPlaceholder : String(allTabPeriodTransactionCount)}
      />
    </>
  ) : activeSource ? (
    <>
      <BankHeadlineMetric
        label={activeSource.id === "slash" ? "Available card credit" : "Live balance"}
        value={activeSource.id === "slash"
          ? formatUsdCurrencyTotal(slashCardCredit, dashboard.fxRates)
          : formatUsdCurrencyTotal(activeSourceBalance, dashboard.fxRates)}
        title={activeSource.id === "slash"
          ? nativeCurrencyBreakdown(slashCardCredit)
          : activeSourceDisplayAccounts.length > 0
            ? nativeCurrencyBreakdown(activeSourceBalance)
            : "No live balance available"}
      />
      {activeSource.id === "slash" ? (
        <>
          <BankHeadlineMetric
            label="Cash balance"
            value={formatUsdCurrencyTotal(slashCashBalance, dashboard.fxRates)}
            title={nativeCurrencyBreakdown(slashCashBalance)}
          />
          <BankHeadlineMetric
            label="Period cashback"
            value={periodSlashCashback
              ? formatUsdCurrencyTotal(periodSlashCashback.earned, dashboard.fxRates, money(0))
              : periodMetricPlaceholder}
            tone="good"
            title={periodSlashCashback ? nativeCurrencyBreakdown(periodSlashCashback.earned) : undefined}
          />
        </>
      ) : (
        <>
          <BankHeadlineMetric
            label="Period money in"
            value={activePeriodActivity
              ? formatUsdCurrencyTotal(activePeriodActivity.moneyIn.volume, dashboard.fxRates, money(0))
              : periodMetricPlaceholder}
            title={activePeriodActivity ? nativeCurrencyBreakdown(activePeriodActivity.moneyIn.volume) : undefined}
          />
          <BankHeadlineMetric
            label="Period money out"
            value={activePeriodActivity
              ? formatUsdCurrencyTotal(activePeriodActivity.moneyOut.volume, dashboard.fxRates, money(0))
              : periodMetricPlaceholder}
            title={activePeriodActivity ? nativeCurrencyBreakdown(activePeriodActivity.moneyOut.volume) : undefined}
          />
        </>
      )}
    </>
  ) : null;

  const bankDetails = activeBank === "all" ? (
    <>
      <section className="bank-details-section">
        <h3>Connected sources</h3>
        <div className="bank-details-summary-grid">
          {bankSources.map((source) => {
            const accounts = accountsBySource.get(source.id) ?? [];
            const status = statusBySource.get(source.id);
            const sourceSlashAccounts = source.id === "slash" ? slashAccounts : [];
            const slashCreditAccounts = sourceSlashAccounts.filter((account) => account.slashAccountSubtype === "credit");
            const summaryAccounts = source.id === "slash"
              ? slashCreditAccounts.length > 0
                ? slashCreditAccounts
                : sourceSlashAccounts.filter((account) => account.slashAccountSubtype === "cash")
              : accounts;
            const accountTotals = sumCurrencyTotals(summaryAccounts, (account) => account.balance);
            const sourcePeriodActivity = periodSourceById.get(source.id);
            const periodTransactionCount = sourcePeriodActivity
              ? sourcePeriodActivity.moneyIn.transactionCount + sourcePeriodActivity.moneyOut.transactionCount
              : null;
            return (
              <SummaryTile
                key={source.id}
                label={`${source.label} ${status?.mode ?? "partial"}${source.id === "slash" ? " · available credit" : ""}`}
                value={summaryAccounts.length > 0 || (source.id === "slash" && status?.mode === "live")
                  ? formatUsdCurrencyTotal(accountTotals, dashboard.fxRates)
                  : periodTransactionCount === null
                    ? periodMetricPlaceholder
                    : `${periodTransactionCount} transactions`}
                detail={summaryAccounts.length > 0 ? nativeCurrencyBreakdown(accountTotals) : undefined}
              />
            );
          })}
        </div>
      </section>
      <section className="bank-details-section">
        <h3>Selected period</h3>
        <div className="bridge">
          <div className="bridge-row"><span>Money in</span><strong className="good-text">{allTabPeriodActivity ? formatCurrencyTotals(allTabPeriodActivity.moneyIn.volume) : periodMetricPlaceholder}</strong></div>
          <div className="bridge-row"><span>Money out</span><strong className="danger-text">{allTabPeriodActivity ? formatCurrencyTotals(allTabPeriodActivity.moneyOut.volume) : periodMetricPlaceholder}</strong></div>
          <div className="bridge-row"><span>Transactions</span><strong>{allTabPeriodTransactionCount === null ? periodMetricPlaceholder : allTabPeriodTransactionCount}</strong></div>
        </div>
      </section>
    </>
  ) : activeSource ? (
    <>
      <section className="bank-details-section">
        <div className="bank-details-section-heading">
          <h3>{activeSource.id === "amex" ? "Cards" : "Accounts"}</h3>
          <span className={`status-pill ${activeSourceStatus?.mode === "live" ? "good" : "warning"}`}>{activeSourceStatus?.mode ?? "partial"}</span>
        </div>
        <BankDetailsAccountTable
          secondaryLabel={activeSource.id === "slash" ? "Type" : "Source"}
          rows={detailAccounts.map((account) => {
            const wiseBalanceId = activeSource.id === "wise"
              ? account.id.match(/^wise-\d+-(\d+)$/)?.[1]
              : undefined;
            const statementCoverage = wiseBalanceId
              ? wiseStatementCoverageByBalanceId.get(wiseBalanceId)
              : undefined;
            return {
              id: account.id,
              name: account.name,
              title: account.name,
              amount: account.balance,
              currency: account.currency,
              source: activeSource.id === "slash"
                ? account.slashAccountSubtype === "credit" ? "Available card credit" : "Cash"
                : activeSource.label,
              ...(statementCoverage ? { statementCoverage } : {})
            };
          })}
          emptyLabel={`No ${activeSource.label} accounts available`}
        />
      </section>
      <section className="bank-details-section">
        <h3>Selected period</h3>
        <div className="bridge">
          <div className="bridge-row"><span>Money in</span><strong className="good-text">{activePeriodActivity ? formatCurrencyTotals(activePeriodActivity.moneyIn.volume) : periodMetricPlaceholder}</strong></div>
          <div className="bridge-row"><span>Money out</span><strong className="danger-text">{activePeriodActivity ? formatCurrencyTotals(activePeriodActivity.moneyOut.volume) : periodMetricPlaceholder}</strong></div>
          <div className="bridge-row"><span>Transactions</span><strong>{activePeriodTransactionCount === null ? periodMetricPlaceholder : activePeriodTransactionCount}</strong></div>
        </div>
      </section>
      {activeSource.id === "slash" && (
        <section className="bank-details-section">
          <div className="bank-details-section-heading">
            <h3>Cashback</h3>
            <span className="total-pill good" title={periodSlashCashback ? nativeCurrencyBreakdown(periodSlashCashback.earned) : undefined}>
              {periodSlashCashback
                ? formatUsdCurrencyTotal(periodSlashCashback.earned, dashboard.fxRates, money(0))
                : periodMetricPlaceholder}
            </span>
          </div>
          <div className="bridge">
            <div className="bridge-row"><span>Eligible purchases</span><strong>{periodSlashCashback ? periodSlashCashback.eligiblePurchaseCount : periodMetricPlaceholder}</strong></div>
            <div className="bridge-row"><span>Eligible spend</span><strong>{periodSlashCashback ? formatUsdCurrencyTotal(periodSlashCashback.eligibleSpend, dashboard.fxRates, money(0)) : periodMetricPlaceholder}</strong></div>
            <div className="bridge-row"><span>Effective rate</span><strong>{!periodSlashCashback ? periodMetricPlaceholder : effectiveCashbackRate === undefined ? "—" : `${effectiveCashbackRate.toFixed(2)}%`}</strong></div>
            <div className="bridge-row"><span>Cashback credited</span><strong>{periodSlashCashback ? formatUsdCurrencyTotal(periodSlashCashback.credited, dashboard.fxRates, money(0)) : periodMetricPlaceholder}</strong></div>
          </div>
        </section>
      )}
      {activeSourceStatus?.issue && (
        <div className="integration-alert"><CircleAlert aria-hidden="true" size={16} /><span>{activeSourceStatus.issue}</span></div>
      )}
    </>
  ) : null;

  return (
    <div className="banks-layout">
      <section className="panel wide-panel bank-overview-bar">
        <div className="panel-header bank-overview-header">
          <div className="bank-overview-title">
            <p className="eyebrow">Banks</p>
            <h2>{activeBankLabel}</h2>
          </div>
          {headerMetrics && (
            <div className="bank-headline-metrics" aria-label={`${activeBankLabel} key metrics`}>
              {headerMetrics}
            </div>
          )}
          <div className="bank-header-controls">
            {activeBank === "wise" && (
              <NativeSelect
                aria-label="Wise entity"
                className="wise-entity-select"
                value={wiseEntityView}
                onValueChange={(value) => setWiseEntityView(value as WiseEntityView)}
              >
                <NativeSelectOption value="all">All entities</NativeSelectOption>
                {wiseEntities.map((entity) => (
                  <NativeSelectOption key={entity.id} value={entity.id}>{entity.shortLabel}</NativeSelectOption>
                ))}
              </NativeSelect>
            )}
            <div className="bank-source-select">
              <NativeSelect
                aria-label="Bank source"
                value={activeBank}
                onValueChange={(value) => setActiveBank(value as BankTab)}
              >
                <NativeSelectOption value="all">All</NativeSelectOption>
                {bankSources.map((source) => (
                  <NativeSelectOption key={source.id} value={source.id}>
                    {source.label}
                  </NativeSelectOption>
                ))}
                <NativeSelectOption value="holdings">Cash & wallets</NativeSelectOption>
              </NativeSelect>
            </div>
          </div>
        </div>
      </section>

      {activeBank === "all" && (
        <AllBankTransactionsView
            activityView={activityView}
            bankGroupType={bankGroupType}
            bankGroupLabel={bankGroupLabel}
            dashboard={dashboard}
            period={allBankDateRange}
            providersById={providersById}
            source={allBankSource}
            setSource={setAllBankSource}
            setActivityView={setActivityView}
            transactions={allBankTransactions}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            bankDirection={bankDirection}
            setBankDirection={setBankDirection}
            bankAccountFilter={bankAccountFilter}
            setBankAccountFilter={setBankAccountFilter}
            bankCategoryFilter={bankCategoryFilter}
            setBankCategoryFilter={setBankCategoryFilter}
            teamFilter={teamFilter}
            setTeamFilter={setTeamFilter}
            matchFilter={matchFilter}
            setMatchFilter={setMatchFilter}
            transactionSortKey={transactionSortKey}
            setTransactionSortKey={setTransactionSortKey}
            transactionSortDirection={transactionSortDirection}
            setTransactionSortDirection={setTransactionSortDirection}
            hasPrevious={hasPreviousTransactions}
            hasMore={hasMoreTransactions}
            isLoading={isLoadingTransactions}
            loadError={transactionLoadError}
            totalCount={transactionPageTotalCount}
            activitySummary={bankActivitySummary}
            isLoadingActivitySummary={isLoadingBankActivitySummary}
            activitySummaryError={bankActivitySummaryError}
            onLoadPrevious={onLoadPreviousTransactions}
            onLoadMore={onLoadMoreTransactions}
            onRetryActivitySummary={onRetryBankActivitySummary}
            onClearBankGroup={onClearBankGroup}
            onOpenMerchantGroup={onOpenMerchantGroup}
            onOpenCardGroup={onOpenCardGroup}
            onOpenAccountGroup={onOpenAccountGroup}
            onMatchInvoice={onMatchInvoice}
            rangeControls={(
              <BankDateRangeControls
                dateRange={allBankDateRange}
                isLoading={isLoadingTransactions}
                onLoad={onLoadAllBankTransactions}
                windowDays={revolutDefaultActivityWindowDays}
              />
            )}
        />
      )}
      {activeBank === "wise" && (
        <BankReconciliationView
          activityView={activityView}
          bankGroupType={bankGroupType}
          bankGroupLabel={bankGroupLabel}
          dashboard={dashboard}
          period={wiseDateRange}
          rows={wiseTransactions}
          source="wise"
          providersById={providersById}
          bankDirection={bankDirection}
          setBankDirection={setBankDirection}
          bankAccountFilter={bankAccountFilter}
          setBankAccountFilter={setBankAccountFilter}
          bankCategoryFilter={bankCategoryFilter}
          setBankCategoryFilter={setBankCategoryFilter}
          teamFilter={teamFilter}
          setTeamFilter={setTeamFilter}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          matchFilter={matchFilter}
          setMatchFilter={setMatchFilter}
          transactionSortKey={transactionSortKey}
          setTransactionSortKey={setTransactionSortKey}
          transactionSortDirection={transactionSortDirection}
          setTransactionSortDirection={setTransactionSortDirection}
          setActivityView={setActivityView}
          hasPreviousTransactions={hasPreviousTransactions}
          hasMoreTransactions={hasMoreTransactions}
          isLoadingTransactions={isLoadingTransactions}
          transactionLoadError={transactionLoadError}
          transactionPageTotalCount={transactionPageTotalCount}
          bankActivitySummary={bankActivitySummary}
          isLoadingBankActivitySummary={isLoadingBankActivitySummary}
          bankActivitySummaryError={bankActivitySummaryError}
          isImportingWise={isImportingWise}
          onImportWiseStatements={onImportWiseStatements}
          onLoadMoreTransactions={onLoadMoreTransactions}
          onLoadPreviousTransactions={onLoadPreviousTransactions}
          onRetryBankActivitySummary={onRetryBankActivitySummary}
          onClearBankGroup={onClearBankGroup}
          onOpenMerchantGroup={onOpenMerchantGroup}
          onOpenCardGroup={onOpenCardGroup}
          onOpenAccountGroup={onOpenAccountGroup}
          wiseEntityView={wiseEntityView}
          periodActivity={wisePeriodActivity}
          periodMetricsError={bankPeriodMetricsError}
          periodMetricsLoading={isLoadingBankPeriodMetrics}
          periodMetricsReady={periodMetricsReady}
          onMatch={onMatch}
          onAssignTeam={onAssignTeam}
          onUpdateCategory={onUpdateCategory}
          onOpenInvoice={onOpenInvoice}
          onMatchInvoice={onMatchInvoice}
          rangeControls={(
            <BankDateRangeControls
              dateRange={wiseDateRange}
              isLoading={isLoadingTransactions}
              onLoad={onFilterWiseTransactions}
              windowDays={revolutDefaultActivityWindowDays}
            />
          )}
        />
      )}
      {activeBank === "revolut" && (
        <RevolutView
          activityView={activityView}
          bankGroupType={bankGroupType}
          bankGroupLabel={bankGroupLabel}
          dashboard={dashboard}
          period={revolutDateRange}
          rows={revolutTransactions}
          dateRange={revolutDateRange}
          isLoadingDateRange={isLoadingTransactions}
          onLoadDateRange={onLoadRevolutTransactions}
          providersById={providersById}
          bankDirection={bankDirection}
          setBankDirection={setBankDirection}
          bankAccountFilter={bankAccountFilter}
          setBankAccountFilter={setBankAccountFilter}
          bankCategoryFilter={bankCategoryFilter}
          setBankCategoryFilter={setBankCategoryFilter}
          teamFilter={teamFilter}
          setTeamFilter={setTeamFilter}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          matchFilter={matchFilter}
          setMatchFilter={setMatchFilter}
          transactionSortKey={transactionSortKey}
          setTransactionSortKey={setTransactionSortKey}
          transactionSortDirection={transactionSortDirection}
          setTransactionSortDirection={setTransactionSortDirection}
          setActivityView={setActivityView}
          hasPreviousTransactions={hasPreviousTransactions}
          hasMoreTransactions={hasMoreTransactions}
          isLoadingTransactions={isLoadingTransactions}
          transactionLoadError={transactionLoadError}
          transactionPageTotalCount={transactionPageTotalCount}
          bankActivitySummary={bankActivitySummary}
          isLoadingBankActivitySummary={isLoadingBankActivitySummary}
          bankActivitySummaryError={bankActivitySummaryError}
          periodActivity={periodSourceById.get("revolut") ?? null}
          periodMetricsError={bankPeriodMetricsError}
          periodMetricsLoading={isLoadingBankPeriodMetrics}
          periodMetricsReady={periodMetricsReady}
          onLoadMoreTransactions={onLoadMoreTransactions}
          onLoadPreviousTransactions={onLoadPreviousTransactions}
          onRetryBankActivitySummary={onRetryBankActivitySummary}
          onClearBankGroup={onClearBankGroup}
          onOpenMerchantGroup={onOpenMerchantGroup}
          onOpenCardGroup={onOpenCardGroup}
          onOpenAccountGroup={onOpenAccountGroup}
          onMatch={onMatch}
          onAssignTeam={onAssignTeam}
          onUpdateCategory={onUpdateCategory}
          onOpenInvoice={onOpenInvoice}
          onMatchInvoice={onMatchInvoice}
        />
      )}
      {activeBank === "slash" && (
        <SlashView
          activityView={activityView}
          bankGroupType={bankGroupType}
          bankGroupLabel={bankGroupLabel}
          dashboard={dashboard}
          period={slashDateRange}
          rows={slashTransactions}
          dateRange={slashDateRange}
          isLoadingDateRange={isLoadingTransactions}
          onLoadDateRange={onLoadSlashTransactions}
          providersById={providersById}
          bankDirection={bankDirection}
          setBankDirection={setBankDirection}
          bankAccountFilter={bankAccountFilter}
          setBankAccountFilter={setBankAccountFilter}
          bankCategoryFilter={bankCategoryFilter}
          setBankCategoryFilter={setBankCategoryFilter}
          teamFilter={teamFilter}
          setTeamFilter={setTeamFilter}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          matchFilter={matchFilter}
          setMatchFilter={setMatchFilter}
          transactionSortKey={transactionSortKey}
          setTransactionSortKey={setTransactionSortKey}
          transactionSortDirection={transactionSortDirection}
          setTransactionSortDirection={setTransactionSortDirection}
          setActivityView={setActivityView}
          hasPreviousTransactions={hasPreviousTransactions}
          hasMoreTransactions={hasMoreTransactions}
          isLoadingTransactions={isLoadingTransactions}
          transactionLoadError={transactionLoadError}
          transactionPageTotalCount={transactionPageTotalCount}
          bankActivitySummary={bankActivitySummary}
          isLoadingBankActivitySummary={isLoadingBankActivitySummary}
          bankActivitySummaryError={bankActivitySummaryError}
          periodActivity={periodSourceById.get("slash") ?? null}
          periodMetricsError={bankPeriodMetricsError}
          periodMetricsLoading={isLoadingBankPeriodMetrics}
          periodMetricsReady={periodMetricsReady}
          onLoadMoreTransactions={onLoadMoreTransactions}
          onLoadPreviousTransactions={onLoadPreviousTransactions}
          onRetryBankActivitySummary={onRetryBankActivitySummary}
          onClearBankGroup={onClearBankGroup}
          onOpenMerchantGroup={onOpenMerchantGroup}
          onOpenCardGroup={onOpenCardGroup}
          onOpenAccountGroup={onOpenAccountGroup}
          onMatch={onMatch}
          onAssignTeam={onAssignTeam}
          onUpdateCategory={onUpdateCategory}
          onOpenInvoice={onOpenInvoice}
          onMatchInvoice={onMatchInvoice}
        />
      )}
      {activeBank === "amex" && (
        <AmexView
          activityView={activityView}
          bankGroupType={bankGroupType}
          bankGroupLabel={bankGroupLabel}
          dashboard={dashboard}
          period={allBankDateRange}
          rows={amexTransactions}
          dateRange={allBankDateRange}
          isLoadingDateRange={isLoadingTransactions}
          providersById={providersById}
          bankDirection={bankDirection}
          setBankDirection={setBankDirection}
          bankAccountFilter={bankAccountFilter}
          setBankAccountFilter={setBankAccountFilter}
          bankCategoryFilter={bankCategoryFilter}
          setBankCategoryFilter={setBankCategoryFilter}
          teamFilter={teamFilter}
          setTeamFilter={setTeamFilter}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          matchFilter={matchFilter}
          setMatchFilter={setMatchFilter}
          transactionSortKey={transactionSortKey}
          setTransactionSortKey={setTransactionSortKey}
          transactionSortDirection={transactionSortDirection}
          setTransactionSortDirection={setTransactionSortDirection}
          setActivityView={setActivityView}
          hasPreviousTransactions={hasPreviousTransactions}
          hasMoreTransactions={hasMoreTransactions}
          isLoadingTransactions={isLoadingTransactions}
          transactionLoadError={transactionLoadError}
          transactionPageTotalCount={transactionPageTotalCount}
          bankActivitySummary={bankActivitySummary}
          isLoadingBankActivitySummary={isLoadingBankActivitySummary}
          bankActivitySummaryError={bankActivitySummaryError}
          periodActivity={periodSourceById.get("amex") ?? null}
          periodMetricsError={bankPeriodMetricsError}
          periodMetricsLoading={isLoadingBankPeriodMetrics}
          periodMetricsReady={periodMetricsReady}
          onLoadDateRange={onLoadAllBankTransactions}
          onLoadMoreTransactions={onLoadMoreTransactions}
          onLoadPreviousTransactions={onLoadPreviousTransactions}
          onRetryBankActivitySummary={onRetryBankActivitySummary}
          onClearBankGroup={onClearBankGroup}
          onOpenMerchantGroup={onOpenMerchantGroup}
          onOpenCardGroup={onOpenCardGroup}
          onOpenAccountGroup={onOpenAccountGroup}
          onMatch={onMatch}
          onAssignTeam={onAssignTeam}
          onUpdateCategory={onUpdateCategory}
          onOpenInvoice={onOpenInvoice}
          onMatchInvoice={onMatchInvoice}
        />
      )}
      {activeBank === "holdings" && (
        <HoldingsView
          dashboard={dashboard}
          onCreate={onCreateHolding}
          onUpdate={onUpdateHolding}
          onDelete={onDeleteHolding}
          onRefreshRates={onRefreshRates}
        />
      )}
      {bankDetails && (
        <BankDetailsDrawer
          label={activeBankLabel}
          open={bankDetailsOpen}
          onOpenChange={setBankDetailsOpen}
        >
          {bankDetails}
        </BankDetailsDrawer>
      )}
    </div>
  );
}

type BankReconciliationViewProps = {
  activityView: BankActivityViewMode;
  setActivityView: (view: BankActivityViewMode) => void;
  bankGroupType: "" | BankActivityGroupType;
  bankGroupLabel: string;
  period: BankTransactionDateRange;
  dashboard: DashboardSnapshot;
  rows: Transaction[];
  source: BankSource;
  providersById: Map<string, Provider>;
  bankDirection: "all" | "in" | "out";
  setBankDirection: (direction: "all" | "in" | "out") => void;
  bankAccountFilter: string;
  setBankAccountFilter: (accountId: string) => void;
  bankCategoryFilter: string;
  setBankCategoryFilter: (category: string) => void;
  teamFilter: string;
  setTeamFilter: (teamId: string) => void;
  searchTerm: string;
  setSearchTerm: (value: string) => void;
  matchFilter: TransactionMatchFilter;
  setMatchFilter: (value: TransactionMatchFilter) => void;
  transactionSortKey: TransactionSortKey;
  setTransactionSortKey: (value: TransactionSortKey) => void;
  transactionSortDirection: SortDirection;
  setTransactionSortDirection: (value: SortDirection) => void;
  hasPreviousTransactions: boolean;
  hasMoreTransactions: boolean;
  isLoadingTransactions: boolean;
  transactionLoadError: string | null;
  transactionPageTotalCount?: number;
  bankActivitySummary: BankActivitySummary | null;
  isLoadingBankActivitySummary: boolean;
  bankActivitySummaryError: string | null;
  periodActivity: BankPeriodActivityMetrics | null;
  periodMetricsError: string | null;
  periodMetricsLoading: boolean;
  periodMetricsReady: boolean;
  onLoadPreviousTransactions: () => Promise<void>;
  onLoadMoreTransactions: () => Promise<void>;
  onRetryBankActivitySummary: () => Promise<void>;
  onClearBankGroup: () => void;
  onOpenMerchantGroup: (group: BankMerchantGroupSummary) => void;
  onOpenCardGroup: (group: BankCardGroupSummary) => void;
  onOpenAccountGroup: (group: BankCardGroupSummary) => void;
  isImportingWise?: boolean;
  onImportWiseStatements?: (files: FileList | null) => Promise<void>;
  wiseEntityView?: WiseEntityView;
  onMatch: (transaction: Transaction, providerId: string | undefined, scope: TransactionOverrideScope) => void;
  onAssignTeam: (transaction: Transaction, teamId?: string) => void;
  onUpdateCategory: (transaction: Transaction, category: string, scope: TransactionOverrideScope) => void;
  onOpenInvoice: (transaction: Transaction) => void;
  onMatchInvoice: (transaction: Transaction) => void;
  wide?: boolean;
  rangeControls?: ReactNode;
  tableFooter?: ReactNode;
};

function BankReconciliationView({
  activityView,
  setActivityView,
  bankGroupType,
  bankGroupLabel,
  period,
  dashboard,
  rows,
  source,
  providersById,
  bankDirection,
  setBankDirection,
  bankAccountFilter,
  setBankAccountFilter,
  bankCategoryFilter,
  setBankCategoryFilter,
  teamFilter,
  setTeamFilter,
  searchTerm,
  setSearchTerm,
  matchFilter,
  setMatchFilter,
  transactionSortKey,
  setTransactionSortKey,
  transactionSortDirection,
  setTransactionSortDirection,
  hasPreviousTransactions,
  hasMoreTransactions,
  isLoadingTransactions,
  transactionLoadError,
  transactionPageTotalCount,
  bankActivitySummary,
  isLoadingBankActivitySummary,
  bankActivitySummaryError,
  periodActivity,
  periodMetricsError,
  periodMetricsLoading,
  periodMetricsReady,
  onLoadPreviousTransactions,
  onLoadMoreTransactions,
  onRetryBankActivitySummary,
  onClearBankGroup,
  onOpenMerchantGroup,
  onOpenCardGroup,
  onOpenAccountGroup,
  isImportingWise,
  onImportWiseStatements,
  wiseEntityView,
  onMatch,
  onAssignTeam,
  onUpdateCategory,
  onOpenInvoice,
  onMatchInvoice,
  wide = false,
  rangeControls,
  tableFooter
}: BankReconciliationViewProps) {
  const sourceLabel = bankSourceLabel(source);
  const wiseFileInputRef = useRef<HTMLInputElement>(null);
  const integrationStatus = dashboard.integrationStatus.find((integration) => integration.id === source);
  const teamsById = useMemo(() => new Map(dashboard.teams.map((team) => [team.id, team])), [dashboard.teams]);
  const resolvedPeriodActivity = resolvedBankPeriodActivity(periodActivity, periodMetricsReady);
  const periodDirection = resolvedPeriodActivity
    ? bankDirection === "all"
      ? combineBankPeriodDirectionMetrics(resolvedPeriodActivity.moneyIn, resolvedPeriodActivity.moneyOut)
      : resolvedPeriodActivity[bankDirection === "in" ? "moneyIn" : "moneyOut"]
    : null;
  const periodMetricPlaceholder = periodMetricsError
    ? "Unavailable"
    : periodMetricsLoading || !periodMetricsReady
      ? "Calculating…"
      : "0";
  const directionLabel = bankDirection === "all"
    ? "Money in & out"
    : bankDirection === "in"
      ? (source === "slash" ? "Added" : "Money in")
      : (source === "slash" ? "Spent / sent" : "Money out");
  const categoryStatusLabel = matchFilter === "matched"
    ? "Categorized"
    : matchFilter === "all"
      ? "All transactions"
      : "Needs category";
  const accountOptions = dashboard.accounts
    .filter((account) => account.source === source)
    .sort((left, right) => left.name.localeCompare(right.name));
  const slashVirtualAccounts = [...new Map(
    dashboard.accounts
      .filter((account) => account.source === "slash")
      .flatMap((account) => account.slashVirtualAccounts ?? [])
      .filter((account) => !account.closedAt)
      .map((account) => [account.id, account] as const)
  ).values()].sort((left, right) =>
    Number(left.accountType !== "primary") - Number(right.accountType !== "primary")
    || left.name.localeCompare(right.name)
  );
  const activeFilters: ActiveFilter[] = [
    ...(bankGroupType ? [{
      key: "activity-group",
      label: `${bankGroupType === "merchant" ? "Group" : bankGroupType === "card" ? "Card" : source === "slash" ? "Virtual account" : "Account"}: ${bankGroupLabel}`,
      onRemove: onClearBankGroup
    }] : []),
    ...(bankAccountFilter === "all" ? [] : [{
      key: "account",
      label: `Account: ${accountOptions.find((account) => account.id === bankAccountFilter)?.name ?? bankAccountFilter}`,
      onRemove: () => setBankAccountFilter("all")
    }]),
    ...(bankDirection === "all" ? [] : [{
      key: "direction",
      label: `Direction: ${directionLabel}`,
      onRemove: () => setBankDirection("all")
    }]),
    ...(matchFilter === "all" ? [] : [{
      key: "status",
      label: `Status: ${categoryStatusLabel}`,
      onRemove: () => setMatchFilter("all")
    }]),
    ...(bankCategoryFilter === "all" ? [] : [{
      key: "category",
      label: `Category: ${bankCategoryFilter}`,
      onRemove: () => setBankCategoryFilter("all")
    }]),
    ...(teamFilter === "all" ? [] : [{
      key: "owner",
      label: `Owner: ${teamFilter === "unassigned" ? "Unassigned" : dashboard.teams.find((team) => team.id === teamFilter)?.name ?? teamFilter}`,
      onRemove: () => setTeamFilter("all")
    }])
  ];
  const transactionResultLabel = transactionPageTotalCount === undefined
    ? `${rows.length} transactions on this page`
    : `${rows.length} of ${transactionPageTotalCount.toLocaleString("en-US")} matching transactions`;

  return (
    <section className={`panel ${wide ? "wide-panel" : ""}`}>
      <div className="panel-header bank-reconciliation-header">
        <div className="list-toolbar reconciliation-toolbar">
          <div className="list-toolbar-main">
            <ToolbarSearchField
              ariaLabel={`Search ${sourceLabel} transactions`}
              placeholder="Search"
              value={searchTerm}
              onChange={setSearchTerm}
            />
            <FilterPopover
              activeCount={activeFilters.length}
              label="Filters"
              title="Bank transaction filters"
            >
              <FilterFieldGroup title="Transaction">
                <label>
                  Account
                  <NativeSelect aria-label={`Filter ${sourceLabel} transactions by account`} value={bankAccountFilter} onValueChange={setBankAccountFilter}>
                    <NativeSelectOption value="all">All accounts</NativeSelectOption>
                    {accountOptions.map((account) => <NativeSelectOption key={account.id} value={account.id}>{account.name}</NativeSelectOption>)}
                  </NativeSelect>
                </label>
                <label>
                  Direction
                  <NativeSelect aria-label={`Filter ${sourceLabel} transactions by direction`} value={bankDirection} onValueChange={(value) => setBankDirection(value as "all" | "in" | "out")}>
                    <NativeSelectOption value="all">Money in &amp; out</NativeSelectOption>
                    <NativeSelectOption value="in">{source === "slash" ? "Added" : "Money in"}</NativeSelectOption>
                    <NativeSelectOption value="out">{source === "slash" ? "Spent / sent" : "Money out"}</NativeSelectOption>
                  </NativeSelect>
                </label>
                <label>
                  Transaction status
                  <NativeSelect aria-label={`Filter ${sourceLabel} transactions by transaction status`} value={matchFilter} onValueChange={(value) => setMatchFilter(value as TransactionMatchFilter)}>
                    <NativeSelectOption value="all">All transactions</NativeSelectOption>
                    <NativeSelectOption value="matched">Categorized</NativeSelectOption>
                    <NativeSelectOption value="needs-review">Needs category</NativeSelectOption>
                  </NativeSelect>
                </label>
                <label>
                  Category
                  <NativeSelect aria-label={`Filter ${sourceLabel} transactions by category`} value={bankCategoryFilter} onValueChange={setBankCategoryFilter}>
                    <NativeSelectOption value="all">All categories</NativeSelectOption>
                    {[...dashboard.transactionCategories]
                      .sort((left, right) => left.name.localeCompare(right.name))
                      .map((category) => <NativeSelectOption key={category.id} value={category.name}>{category.name}</NativeSelectOption>)}
                  </NativeSelect>
                </label>
                <label>
                  Owner
                  <NativeSelect aria-label="Filter transactions by owner" value={teamFilter} onValueChange={setTeamFilter}>
                    <NativeSelectOption value="all">All owners</NativeSelectOption>
                    <NativeSelectOption value="unassigned">Unassigned</NativeSelectOption>
                    {dashboard.teams.map((team) => (
                      <NativeSelectOption key={team.id} value={team.id}>
                        {team.name}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </label>
              </FilterFieldGroup>
            </FilterPopover>
            <BankActivityViewToggle value={activityView} onChange={setActivityView} virtualAccounts={source === "slash"} />
          </div>
          <div className="list-toolbar-actions">
            {rangeControls}
            {onImportWiseStatements ? (
              <>
                <Menu.Root>
                  <Menu.Trigger
                    aria-label="Import or export CSV"
                    className="icon-button reconciliation-transfer-trigger"
                    title="Import or export CSV"
                  >
                    {isImportingWise
                      ? <Loader2 className="spin" size={16} aria-hidden="true" />
                      : <ArrowDownUp size={16} aria-hidden="true" />}
                  </Menu.Trigger>
                  <Menu.Portal>
                    <Menu.Positioner className="reconciliation-transfer-positioner" sideOffset={6} align="end">
                      <Menu.Popup className="reconciliation-transfer-menu">
                        <Menu.Item
                          className="reconciliation-transfer-item"
                          disabled={isImportingWise}
                          onClick={() => wiseFileInputRef.current?.click()}
                        >
                          <Download size={15} aria-hidden="true" />
                          <span>Import CSV</span>
                        </Menu.Item>
                        <Menu.Item
                          className="reconciliation-transfer-item"
                          disabled={rows.length === 0}
                          onClick={() => exportBankTransactionsCsv({
                            providersById,
                            rows,
                            scope: sourceLabel,
                            teamsById
                          })}
                        >
                          <Upload size={15} aria-hidden="true" />
                          <span>Export loaded CSV</span>
                        </Menu.Item>
                      </Menu.Popup>
                    </Menu.Positioner>
                  </Menu.Portal>
                </Menu.Root>
                <input
                  ref={wiseFileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  multiple
                  disabled={isImportingWise}
                  hidden
                  onChange={(event) => {
                    void onImportWiseStatements(event.target.files);
                    event.target.value = "";
                  }}
                />
              </>
            ) : (
              <Button
                aria-label={`Export ${sourceLabel} CSV`}
                className="icon-button"
                type="button"
                disabled={rows.length === 0}
                title={`Export ${rows.length} loaded row${rows.length === 1 ? "" : "s"} from this filtered view`}
                onClick={() => exportBankTransactionsCsv({
                  providersById,
                  rows,
                  scope: sourceLabel,
                  teamsById
                })}
              >
                <Upload size={15} aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>
      </div>
      <ActiveFilterBar
        filters={activeFilters}
        resultLabel={transactionResultLabel}
        onClearAll={() => {
          onClearBankGroup();
          setBankAccountFilter("all");
          setBankDirection("all");
          setMatchFilter("all");
          setBankCategoryFilter("all");
          setTeamFilter("all");
        }}
      />
      <span className="screen-reader-only" role="status" aria-live="polite">
        {transactionResultLabel}. Direction: {directionLabel}. Transaction status: {categoryStatusLabel}.
      </span>
      <div className="wise-summary-grid">
        <SummaryTile
          label="Period volume"
          value={periodDirection
            ? formatUsdCurrencyTotal(periodDirection.volume, dashboard.fxRates, money(0))
            : periodMetricPlaceholder}
          detail={periodDirection ? nativeCurrencyBreakdown(periodDirection.volume) : undefined}
        />
        <SummaryTile label="Period transactions" value={periodDirection ? String(periodDirection.transactionCount) : periodMetricPlaceholder} />
        <SummaryTile label="Period categorized" value={periodDirection ? String(periodDirection.categorizedTransactionCount) : periodMetricPlaceholder} />
        <SummaryTile label="Period without owner" value={periodDirection ? String(periodDirection.unassignedOwnerTransactionCount) : periodMetricPlaceholder} />
      </div>
      {periodMetricsError && (
        <div className="integration-alert">
          <CircleAlert size={16} />
          <span>Period totals could not be calculated: {periodMetricsError}</span>
        </div>
      )}
      {integrationStatus?.issue && (
        <div className="integration-alert">
          <CircleAlert size={16} />
          <span>{integrationStatus.issue}</span>
        </div>
      )}
      {activityView === "transactions" ? <TransactionTable
        rows={rows}
        expenses={dashboard.expenses}
        categories={dashboard.transactionCategories}
        teams={dashboard.teams}
        providers={dashboard.providers}
        providersById={providersById}
        sortKey={transactionSortKey}
        sortDirection={transactionSortDirection}
        onSort={(nextSortKey) => {
          if (nextSortKey === transactionSortKey) {
            setTransactionSortDirection(transactionSortDirection === "asc" ? "desc" : "asc");
            return;
          }
          setTransactionSortKey(nextSortKey);
          setTransactionSortDirection("asc");
        }}
        onMatch={onMatch}
        onAssignTeam={onAssignTeam}
        onUpdateCategory={onUpdateCategory}
        onOpenInvoice={onOpenInvoice}
        onMatchInvoice={onMatchInvoice}
        hasPrevious={hasPreviousTransactions}
        hasMore={hasMoreTransactions}
        isLoading={isLoadingTransactions}
        loadError={transactionLoadError}
        totalCount={transactionPageTotalCount}
        onLoadPrevious={onLoadPreviousTransactions}
        onLoadMore={onLoadMoreTransactions}
        showWiseEntity={source === "wise" && wiseEntityView === "all"}
        source={source}
      /> : activityView === "groups" ? (
        <BankMerchantGroupView
          groups={bankActivitySummary?.merchantGroups ?? []}
          isLoading={isLoadingBankActivitySummary}
          loadError={bankActivitySummaryError}
          onRetry={onRetryBankActivitySummary}
          period={period}
          onOpenGroup={onOpenMerchantGroup}
        />
      ) : activityView === "cards" ? (
        <BankCardActivityView
          groups={bankActivitySummary?.cardGroups ?? []}
          isLoading={isLoadingBankActivitySummary}
          loadError={bankActivitySummaryError}
          onRetry={onRetryBankActivitySummary}
          onOpenGroup={onOpenCardGroup}
        />
      ) : (
        <BankAccountActivityView
          groups={bankActivitySummary?.accountGroups ?? []}
          virtualAccounts={source === "slash" ? slashVirtualAccounts : undefined}
          isLoading={isLoadingBankActivitySummary}
          loadError={bankActivitySummaryError}
          onRetry={onRetryBankActivitySummary}
          onOpenGroup={onOpenAccountGroup}
        />
      )}
      {tableFooter}
    </section>
  );
}

function emptyBankAnalyticsAggregate(): BankAnalyticsAggregate {
  return {
    transactionCount: 0,
    moneyInTransactionCount: 0,
    moneyOutTransactionCount: 0,
    matchedTransactionCount: 0,
    needsReviewCount: 0,
    moneyIn: {},
    moneyOut: {},
    moneyInTransactionCounts: {},
    moneyOutTransactionCounts: {}
  };
}

function analyticsAggregateMoney(
  aggregate: BankAnalyticsAggregate,
  direction: Transaction["direction"]
): string {
  return formatCurrencyTotals(direction === "in" ? aggregate.moneyIn : aggregate.moneyOut);
}

function analyticsRelationshipLabel(relationship: BankAnalyticsRelationship): string {
  if (relationship === "client") return "Client";
  if (relationship === "supplier") return "Supplier";
  return "Unknown";
}

function useAnalyticsCategoryCompanies({
  analytics,
  dashboard,
  range,
  segment,
  selection
}: {
  analytics: BankAnalyticsSnapshot | null;
  dashboard: DashboardSnapshot;
  range: AnalyticsDateRange;
  segment: CategoryPieSegment | null;
  selection: AnalyticsCategoryView | null;
}) {
  const currencies = segment ? Object.keys(segment.nativeTotals).sort() : [];
  const currenciesKey = currencies.join(":");
  const selectionKey = selection
    ? `${range.fromDate}:${range.toDate}:${analyticsCategoryViewValue(selection)}`
    : "";
  const [loaded, setLoaded] = useState<{ key: string; companies: AnalyticsCategoryCompanyView[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!selection || !analytics || !segment || segment.categories.length !== 1 || selection.category === "Other") {
      setLoaded(null);
      setLoading(false);
      setError(null);
      return;
    }
    const activeSelection = selection;
    const controller = new AbortController();
    const companies = new Map<string, Omit<AnalyticsCategoryCompanyView, "amountUsd">>();
    setLoaded({ key: selectionKey, companies: [] });
    setLoading(true);
    setError(null);

    function publishCompanies(): void {
      setLoaded({
        key: selectionKey,
        companies: [...companies.values()].map((company) => ({
          ...company,
          amountUsd: convertCurrencyTotalsToUsd(company.nativeTotals, dashboard.fxRates).totalUsd
        }))
      });
    }

    async function loadCurrency(currency: string): Promise<void> {
      let cursor: string | null = null;
      const seenCursors = new Set<string>();
      for (let pageNumber = 0; pageNumber < 1_000; pageNumber += 1) {
        const query = new URLSearchParams({
          fromDate: range.fromDate,
          toDate: range.toDate,
          direction: activeSelection.direction,
          currency,
          category: activeSelection.category,
          limit: String(transactionTablePageSize)
        });
        if (cursor) query.set("cursor", cursor);
        const response = await fetch(`${apiBase}/analytics/category-companies?${query.toString()}`, {
          signal: controller.signal
        });
        if (!response.ok) throw new Error(await apiErrorMessage(response, "Category companies could not be loaded"));
        const page = (await response.json()) as BankAnalyticsCategoryCompaniesPage;
        if (
          page.version !== 1
          || page.fromDate !== range.fromDate
          || page.toDate !== range.toDate
          || page.direction !== activeSelection.direction
          || page.currency !== currency
          || page.category !== activeSelection.category
        ) {
          throw new Error("Category companies returned data for the wrong slice");
        }
        for (const company of page.companies) {
          const existing = companies.get(company.companyKey);
          companies.set(company.companyKey, {
            companyKey: company.companyKey,
            ...(company.providerId ? { providerId: company.providerId } : {}),
            merchantName: existing?.merchantName ?? company.merchantName,
            nativeTotals: {
              ...(existing?.nativeTotals ?? {}),
              [currency]: (existing?.nativeTotals[currency] ?? 0) + company.amount
            },
            transactionCount: (existing?.transactionCount ?? 0) + company.transactionCount
          });
        }
        publishCompanies();
        if (page.isDone) return;
        if (!page.continueCursor || seenCursors.has(page.continueCursor)) {
          throw new Error("Category companies pagination did not advance");
        }
        seenCursors.add(page.continueCursor);
        cursor = page.continueCursor;
      }
      throw new Error("Category companies exceeded the supported page limit");
    }

    void Promise.all(currencies.map(loadCurrency))
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Category companies could not be loaded");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [analytics, attempt, currenciesKey, dashboard.fxRates, range.fromDate, range.toDate, segment, selection?.category, selection?.direction, selectionKey]);

  const companies = loaded?.key === selectionKey
    ? [...loaded.companies].sort((left, right) => right.amountUsd - left.amountUsd || left.merchantName.localeCompare(right.merchantName))
    : [];
  return { companies, error, loading, retry: () => setAttempt((current) => current + 1) };
}

function AnalyticsView({
  dashboard,
  analyticsSnapshots,
  analyticsBuildReasons,
  analyticsDataRevision,
  ensureAnalyticsSnapshot,
  onViewCategoryTransactions
}: {
  dashboard: DashboardSnapshot;
  analyticsSnapshots: Record<string, BankAnalyticsSnapshot>;
  analyticsBuildReasons: Record<string, "historical-coverage" | "snapshot">;
  analyticsDataRevision: number;
  ensureAnalyticsSnapshot: (range: AnalyticsDateRange) => Promise<BankAnalyticsSnapshot>;
  onViewCategoryTransactions: (selection: AnalyticsCategoryView, range: AnalyticsDateRange) => void;
}) {
  const analyticsToday = localIsoDate();
  const currentAnalyticsYear = Number(analyticsToday.slice(0, 4));
  const currentAnalyticsMonth = Number(analyticsToday.slice(5, 7));
  const currentAnalyticsQuarter = Math.floor((currentAnalyticsMonth - 1) / 3) + 1;
  const [periodMode, setPeriodMode] = useUrlState<AnalyticsPeriodMode>(
    "analyticsPeriod",
    "ytd",
    { allowedValues: analyticsPeriodModes }
  );
  const [periodYear, setPeriodYear] = useUrlState("analyticsYear", String(currentAnalyticsYear));
  const [periodMonth, setPeriodMonth] = useUrlState("analyticsMonth", String(currentAnalyticsMonth), {
    allowedValues: analyticsMonthOptions.map((_, index) => String(index + 1))
  });
  const [periodQuarter, setPeriodQuarter] = useUrlState<string>("analyticsQuarter", String(currentAnalyticsQuarter), {
    allowedValues: ["1", "2", "3", "4"]
  });
  const [customPeriod, setCustomPeriod] = useUrlDateRangeState(
    "analyticsFrom",
    "analyticsTo",
    { fromDate: analyticsToday, toDate: analyticsToday }
  );
  const [spendCategory, setSpendCategory] = useUrlState("analyticsSpendCategory", "", {
    isValid: (value) => value.trim().length > 0 && value.length <= 160
  });
  const [revenueCategory, setRevenueCategory] = useUrlState("analyticsRevenueCategory", "", {
    isValid: (value) => value.trim().length > 0 && value.length <= 160
  });
  const [categoryDetailValue, setCategoryDetailValue] = useUrlState<"" | "in" | "out">(
    "analyticsCategoryDetail",
    "",
    { allowedValues: ["", "in", "out"] }
  );
  const categoryDetailOpen = categoryDetailValue !== "";
  const analyticsYearOptions = useMemo(
    () => Array.from({ length: currentAnalyticsYear - 2000 + 1 }, (_, index) => String(currentAnalyticsYear - index)),
    [currentAnalyticsYear]
  );
  const selectedAnalyticsYear = analyticsYearOptions.includes(periodYear)
    ? Number(periodYear)
    : currentAnalyticsYear;
  const selectedAnalyticsMonth = selectedAnalyticsYear === currentAnalyticsYear
    ? Math.min(Number(periodMonth), currentAnalyticsMonth)
    : Number(periodMonth);
  const selectedAnalyticsQuarter = selectedAnalyticsYear === currentAnalyticsYear
    ? Math.min(Number(periodQuarter), currentAnalyticsQuarter)
    : Number(periodQuarter);
  const periodSelection: AnalyticsPeriodSelection = {
    mode: periodMode,
    year: selectedAnalyticsYear,
    month: selectedAnalyticsMonth,
    quarter: selectedAnalyticsQuarter,
    fromDate: customPeriod.fromDate,
    toDate: customPeriod.toDate
  };
  const selectedAnalyticsRange = analyticsDateRange(periodSelection, analyticsToday);
  const selectedAnalyticsRangeKey = `${selectedAnalyticsRange.fromDate}:${selectedAnalyticsRange.toDate}`;
  const [isLoadingAnalyticsPeriod, setIsLoadingAnalyticsPeriod] = useState(false);
  const [analyticsPeriodError, setAnalyticsPeriodError] = useState<string | null>(null);
  const [analyticsLoadAttempt, setAnalyticsLoadAttempt] = useState(0);

  useEffect(() => {
    if (!analyticsYearOptions.includes(periodYear)) {
      setPeriodYear(String(currentAnalyticsYear));
    }
  }, [analyticsYearOptions, currentAnalyticsYear, periodYear, setPeriodYear]);

  useEffect(() => {
    if (periodMode === "month" && periodMonth !== String(selectedAnalyticsMonth)) {
      setPeriodMonth(String(selectedAnalyticsMonth));
    }
    if (periodMode === "quarter" && periodQuarter !== String(selectedAnalyticsQuarter)) {
      setPeriodQuarter(String(selectedAnalyticsQuarter));
    }
  }, [
    periodMode,
    periodMonth,
    periodQuarter,
    selectedAnalyticsMonth,
    selectedAnalyticsQuarter,
    setPeriodMonth,
    setPeriodQuarter
  ]);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingAnalyticsPeriod(!analyticsSnapshots[selectedAnalyticsRangeKey]);
    setAnalyticsPeriodError(null);

    void ensureAnalyticsSnapshot(selectedAnalyticsRange)
      .catch((error: unknown) => {
        if (cancelled) return;
        setAnalyticsPeriodError(error instanceof Error ? error.message : "Analytics snapshot could not be loaded");
      })
      .finally(() => {
        if (!cancelled) setIsLoadingAnalyticsPeriod(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    analyticsDataRevision,
    analyticsLoadAttempt,
    ensureAnalyticsSnapshot,
    selectedAnalyticsRange.fromDate,
    selectedAnalyticsRange.toDate,
    selectedAnalyticsRangeKey
  ]);

  const analytics = analyticsSnapshots[selectedAnalyticsRangeKey] ?? null;
  const analyticsBuildReason = analyticsBuildReasons[selectedAnalyticsRangeKey] ?? null;
  const analyticsPeriodBusy = isLoadingAnalyticsPeriod || analyticsBuildReason !== null;
  const summary = analytics?.summary;
  const categoryRows = analytics?.categories ?? [];
  const categoryPieGroups = useMemo(
    () => analyticsCategoryPieGroups(categoryRows, dashboard.fxRates),
    [categoryRows, dashboard.fxRates]
  );
  const spendPieGroup = categoryPieGroups.out;
  const revenuePieGroup = categoryPieGroups.in;
  const spendCategoryView = spendCategory ? { direction: "out" as const, category: spendCategory } : null;
  const revenueCategoryView = revenueCategory ? { direction: "in" as const, category: revenueCategory } : null;
  const selectedSpendSegment = spendPieGroup?.segments.find((segment) => segment.category === spendCategory) ?? null;
  const selectedRevenueSegment = revenuePieGroup?.segments.find((segment) => segment.category === revenueCategory) ?? null;

  useEffect(() => {
    if (!analytics) return;
    const defaultSpend = spendPieGroup?.segments.find((segment) => segment.category !== "Other") ?? spendPieGroup?.segments[0];
    const defaultRevenue = revenuePieGroup?.segments.find((segment) => segment.category !== "Other") ?? revenuePieGroup?.segments[0];
    if (!selectedSpendSegment && spendCategory !== (defaultSpend?.category ?? "")) {
      setSpendCategory(defaultSpend?.category ?? "");
    }
    if (!selectedRevenueSegment && revenueCategory !== (defaultRevenue?.category ?? "")) {
      setRevenueCategory(defaultRevenue?.category ?? "");
    }
  }, [
    analytics,
    revenueCategory,
    revenuePieGroup,
    selectedRevenueSegment,
    selectedSpendSegment,
    setRevenueCategory,
    setSpendCategory,
    spendCategory,
    spendPieGroup
  ]);

  const spendCompaniesState = useAnalyticsCategoryCompanies({
    analytics,
    dashboard,
    range: selectedAnalyticsRange,
    segment: selectedSpendSegment,
    selection: spendCategoryView
  });
  const revenueCompaniesState = useAnalyticsCategoryCompanies({
    analytics,
    dashboard,
    range: selectedAnalyticsRange,
    segment: selectedRevenueSegment,
    selection: revenueCategoryView
  });
  type AnalyticsRollupSortKey = "name" | "transactions" | "moneyIn" | "moneyOut" | "needsReview";
  const [ownerSortKey, setOwnerSortKey] = useUrlState<AnalyticsRollupSortKey>("analyticsOwnerSort", "transactions", {
    allowedValues: ["name", "transactions", "moneyIn", "moneyOut", "needsReview"]
  });
  const [ownerSortDirection, setOwnerSortDirection] = useUrlState<SortDirection>("analyticsOwnerOrder", "desc", {
    allowedValues: ["asc", "desc"]
  });
  const [sourceSortKey, setSourceSortKey] = useUrlState<AnalyticsRollupSortKey>("analyticsSourceSort", "transactions", {
    allowedValues: ["name", "transactions", "moneyIn", "moneyOut", "needsReview"]
  });
  const [sourceSortDirection, setSourceSortDirection] = useUrlState<SortDirection>("analyticsSourceOrder", "desc", {
    allowedValues: ["asc", "desc"]
  });
  const rollupSortValue = (aggregate: BankAnalyticsAggregate, name: string, key: AnalyticsRollupSortKey): string | number => {
    if (key === "name") return name;
    if (key === "transactions") return aggregate.transactionCount;
    if (key === "needsReview") return aggregate.needsReviewCount;
    return convertCurrencyTotalsToUsd(key === "moneyIn" ? aggregate.moneyIn : aggregate.moneyOut, dashboard.fxRates).totalUsd;
  };
  const teamRows = (analytics?.teams ?? []).map((aggregate) => ({
    id: aggregate.teamId ?? "unassigned",
    name: aggregate.teamName,
    aggregate
  })).sort((left, right) => compareTableValues(
    rollupSortValue(left.aggregate, left.name, ownerSortKey),
    rollupSortValue(right.aggregate, right.name, ownerSortKey),
    ownerSortDirection
  ) || left.name.localeCompare(right.name));
  const sourceRows = (analytics?.sources ?? []).map((aggregate) => ({
    source: aggregate.source,
    aggregate
  })).sort((left, right) => compareTableValues(
    rollupSortValue(left.aggregate, sourceLabel(left.source), sourceSortKey),
    rollupSortValue(right.aggregate, sourceLabel(right.source), sourceSortKey),
    sourceSortDirection
  ) || sourceLabel(left.source).localeCompare(sourceLabel(right.source)));

  function requestRollupSort(
    key: AnalyticsRollupSortKey,
    currentKey: AnalyticsRollupSortKey,
    direction: SortDirection,
    setKey: (value: AnalyticsRollupSortKey) => void,
    setDirection: (value: SortDirection) => void
  ): void {
    if (key === currentKey) {
      setDirection(direction === "asc" ? "desc" : "asc");
      return;
    }
    setKey(key);
    setDirection(key === "name" ? "asc" : "desc");
  }

  const relationshipRows = analytics?.relationships ?? [];
  const companyRows = [
    ...(analytics?.providers ?? []).map((provider) => ({
      id: `provider-${provider.providerId}`,
      name: provider.providerName,
      relationship: analyticsRelationshipLabel(provider.relationship),
      coverage: provider.directoryMatch ? "Company matched" : "Missing directory entry",
      statusClass: provider.directoryMatch ? "good" as const : "warning" as const,
      aggregate: provider
    })),
    ...(analytics?.unmatchedMerchants.rows ?? []).map((merchant) => ({
      id: `merchant-${merchant.merchantKey}`,
      name: merchant.merchantName,
      relationship: "Unknown",
      coverage: merchant.estimateError > 0
        ? `${merchant.estimatedTransactionCount.toLocaleString()} estimated rank count`
        : "Merchant only",
      statusClass: "warning" as const,
      aggregate: merchant
    })),
    ...(analytics?.unmatchedMerchants.other
      ? [{
          id: "merchant-other",
          name: "Other unmatched activity",
          relationship: "Unknown",
          coverage: `${analytics.unmatchedMerchants.evictedCandidateCount.toLocaleString()} candidate evictions`,
          statusClass: "warning" as const,
          aggregate: analytics.unmatchedMerchants.other
        }]
      : [])
  ];
  const categoryCompanyRows = (companies: AnalyticsCategoryCompanyView[]) => companies.map((company) => ({
    ...company,
    name: company.providerId
      ? dashboard.providers.find((provider) => provider.id === company.providerId)?.name ?? company.merchantName
      : company.merchantName,
    kind: company.providerId ? "Matched company" : "Merchant"
  })).sort((left, right) => right.amountUsd - left.amountUsd || left.name.localeCompare(right.name));
  const spendCategoryCompanyRows = categoryCompanyRows(spendCompaniesState.companies);
  const revenueCategoryCompanyRows = categoryCompanyRows(revenueCompaniesState.companies);
  const detailSelection = categoryDetailValue === "out" ? spendCategoryView : categoryDetailValue === "in" ? revenueCategoryView : null;
  const detailSegment = categoryDetailValue === "out" ? selectedSpendSegment : categoryDetailValue === "in" ? selectedRevenueSegment : null;
  const detailCompaniesState = categoryDetailValue === "out" ? spendCompaniesState : revenueCompaniesState;
  const detailCompanyRows = categoryDetailValue === "out" ? spendCategoryCompanyRows : revenueCategoryCompanyRows;

  function inspectAnalyticsCategory(selection: AnalyticsCategoryView): void {
    if (selection.direction === "out") setSpendCategory(selection.category);
    else setRevenueCategory(selection.category);
  }

  function openAnalyticsCategoryDetail(direction: "in" | "out"): void {
    const segment = direction === "out" ? selectedSpendSegment : selectedRevenueSegment;
    if (!segment || segment.category === "Other") return;
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("analyticsCategoryDetail", direction);
    window.history.pushState(
      { ...window.history.state, analyticsCategoryDetailEntry: true },
      "",
      `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`
    );
    window.dispatchEvent(new Event("finance-dash:url-state-change"));
  }

  function closeAnalyticsCategoryDetail(): void {
    if (window.history.state?.analyticsCategoryDetailEntry === true) {
      window.history.back();
      return;
    }
    setCategoryDetailValue("");
  }

  return (
    <div className="categorization-layout">
      <section className="panel wide-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Analytics</p>
            <h2>Money flow, owners, sources, companies, and review load</h2>
          </div>
          <div className="filters analytics-global-filters">
            <CalendarPeriodPicker
              ariaLabel="Choose analytics period"
              dateRange={selectedAnalyticsRange}
              onApply={(dateRange) => {
                setCustomPeriod(dateRange);
                setPeriodMode("custom");
              }}
              onSelectPreset={(value) => setPeriodMode(value as AnalyticsPeriodMode)}
              presetAriaLabel="Analytics period presets"
              presetOptions={[
                { value: "today", label: "Today" },
                { value: "yesterday", label: "Yesterday" },
                { value: "last_7_days", label: "Last 7 days" },
                { value: "last_30_days", label: "Last 30 days" },
                { value: "this_week", label: "This week" },
                { value: "last_week", label: "Last week" },
                { value: "this_month", label: "This month" },
                { value: "last_month", label: "Last month" },
                { value: "this_quarter", label: "This quarter" },
                { value: "last_quarter", label: "Last quarter" },
                { value: "month", label: "Month" },
                { value: "quarter", label: "Quarter" },
                { value: "ytd", label: "YTD" },
                { value: "year", label: "Year" }
              ]}
              triggerClassName="analytics-period-calendar-trigger"
              triggerLabel={analyticsPeriodLabel(periodSelection, analyticsToday)}
            />
            <span className="analytics-period-status" aria-live="polite">
              <span className={`analytics-period-value ${analyticsPeriodBusy ? "loading" : ""}`}>
                {analyticsPeriodBusy && <Loader2 className="spin" aria-hidden="true" size={13} />}
                {analyticsPeriodBusy
                  ? `${analyticsBuildReason === "historical-coverage" ? "Syncing" : "Building"} period…`
                  : analytics
                    ? `${analytics.summary.transactionCount.toLocaleString()} transactions`
                    : "No snapshot"}
              </span>
              <InfoPopover label="analytics period data">
                <span>Every Analytics card and rollup uses this calendar period.</span>
                <span>Completed monthly and quarterly snapshots are cached in Convex and warmed while the dashboard is open.</span>
                <span>Only ranges whose underlying monthly revision changed are rebuilt.</span>
              </InfoPopover>
              {analyticsPeriodError && (
                <>
                  <span className="danger-text" role="alert">{analyticsPeriodError}</span>
                  <Button
                    type="button"
                    className="icon-button analytics-period-error"
                    aria-label="Retry analytics snapshot"
                    title="Retry analytics snapshot"
                    onClick={() => setAnalyticsLoadAttempt((attempt) => attempt + 1)}
                  >
                    <RefreshCw aria-hidden="true" size={15} />
                  </Button>
                </>
              )}
            </span>
          </div>
        </div>
        <div className="wise-summary-grid categorization-summary">
          <SummaryTile
            label="Money in"
            value={formatUsdCurrencyTotal(summary?.moneyIn ?? {}, dashboard.fxRates)}
            detail={nativeCurrencyBreakdown(summary?.moneyIn ?? {})}
          />
          <SummaryTile
            label="Money out"
            value={formatUsdCurrencyTotal(summary?.moneyOut ?? {}, dashboard.fxRates)}
            detail={nativeCurrencyBreakdown(summary?.moneyOut ?? {})}
          />
          <SummaryTile label="Owners" value={analytics ? String(summary?.activeTeamCount ?? 0) : "—"} />
          <SummaryTile label="Sources" value={analytics ? String(summary?.activeSourceCount ?? 0) : "—"} />
          <SummaryTile label="Needs review" value={analytics ? String(summary?.needsReviewCount ?? 0) : "—"} />
        </div>
      </section>

      {categoryDetailOpen && detailSelection && detailSegment ? (
        <AnalyticsCategoryBreakdownPanel
          companyRows={detailCompanyRows}
          error={detailCompaniesState.error}
          loading={detailCompaniesState.loading}
          periodLabel={analyticsPeriodLabel(periodSelection, analyticsToday)}
          segment={detailSegment}
          selection={detailSelection}
          onBack={closeAnalyticsCategoryDetail}
          onRetry={detailCompaniesState.retry}
          onViewTransactions={() => onViewCategoryTransactions(detailSelection, selectedAnalyticsRange)}
        />
      ) : <>
      <CategoryDistributionPanel
        title="Spend by category"
        direction="out"
        tone="danger"
        group={spendPieGroup}
        selectedCategory={spendCategory}
        companyRows={spendCategoryCompanyRows}
        companiesError={spendCompaniesState.error}
        companiesLoading={spendCompaniesState.loading}
        emptyLabel="No spend transactions yet"
        loading={isLoadingAnalyticsPeriod}
        onRetryCompanies={spendCompaniesState.retry}
        onSelectCategory={(category) => inspectAnalyticsCategory({ direction: "out", category })}
        onOpenBreakdown={() => openAnalyticsCategoryDetail("out")}
      />
      <CategoryDistributionPanel
        title="Revenue by category"
        direction="in"
        tone="good"
        group={revenuePieGroup}
        selectedCategory={revenueCategory}
        companyRows={revenueCategoryCompanyRows}
        companiesError={revenueCompaniesState.error}
        companiesLoading={revenueCompaniesState.loading}
        emptyLabel="No revenue transactions yet"
        loading={isLoadingAnalyticsPeriod}
        onRetryCompanies={revenueCompaniesState.retry}
        onSelectCategory={(category) => inspectAnalyticsCategory({ direction: "in", category })}
        onOpenBreakdown={() => openAnalyticsCategoryDetail("in")}
      />

      {analytics && <>

      <section className="panel wide-panel">
        <div className="panel-header compact">
          <h2>By owner</h2>
          <span className="total-pill">{teamRows.length} owners</span>
        </div>
        <div className="table-wrap">
          <table className="data-table analytics-table">
            <thead>
              <tr>
                <SortableTableHead activeSortKey={ownerSortKey} direction={ownerSortDirection} onSort={(key) => requestRollupSort(key, ownerSortKey, ownerSortDirection, setOwnerSortKey, setOwnerSortDirection)} sortKey="name">Owner</SortableTableHead>
                <SortableTableHead activeSortKey={ownerSortKey} direction={ownerSortDirection} onSort={(key) => requestRollupSort(key, ownerSortKey, ownerSortDirection, setOwnerSortKey, setOwnerSortDirection)} sortKey="transactions">Transactions</SortableTableHead>
                <SortableTableHead activeSortKey={ownerSortKey} direction={ownerSortDirection} onSort={(key) => requestRollupSort(key, ownerSortKey, ownerSortDirection, setOwnerSortKey, setOwnerSortDirection)} sortKey="moneyIn">Money in</SortableTableHead>
                <SortableTableHead activeSortKey={ownerSortKey} direction={ownerSortDirection} onSort={(key) => requestRollupSort(key, ownerSortKey, ownerSortDirection, setOwnerSortKey, setOwnerSortDirection)} sortKey="moneyOut">Money out</SortableTableHead>
                <SortableTableHead activeSortKey={ownerSortKey} direction={ownerSortDirection} onSort={(key) => requestRollupSort(key, ownerSortKey, ownerSortDirection, setOwnerSortKey, setOwnerSortDirection)} sortKey="needsReview">Needs review</SortableTableHead>
              </tr>
            </thead>
            <tbody>
              {teamRows.map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.name}</strong></td>
                  <td>{row.aggregate.transactionCount}</td>
                  <td className="amount good-text">{analyticsAggregateMoney(row.aggregate, "in")}</td>
                  <td className="amount danger-text">{analyticsAggregateMoney(row.aggregate, "out")}</td>
                  <td>{row.aggregate.needsReviewCount}</td>
                </tr>
              ))}
              {teamRows.length === 0 && (
                <tr><td colSpan={5}>No transaction owners in this period</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel wide-panel">
        <div className="panel-header compact">
          <h2>By source</h2>
          <span className="total-pill">{sourceRows.length} sources</span>
        </div>
        <div className="table-wrap">
          <table className="data-table analytics-table">
            <thead>
              <tr>
                <SortableTableHead activeSortKey={sourceSortKey} direction={sourceSortDirection} onSort={(key) => requestRollupSort(key, sourceSortKey, sourceSortDirection, setSourceSortKey, setSourceSortDirection)} sortKey="name">Source</SortableTableHead>
                <SortableTableHead activeSortKey={sourceSortKey} direction={sourceSortDirection} onSort={(key) => requestRollupSort(key, sourceSortKey, sourceSortDirection, setSourceSortKey, setSourceSortDirection)} sortKey="transactions">Transactions</SortableTableHead>
                <SortableTableHead activeSortKey={sourceSortKey} direction={sourceSortDirection} onSort={(key) => requestRollupSort(key, sourceSortKey, sourceSortDirection, setSourceSortKey, setSourceSortDirection)} sortKey="moneyIn">Money in</SortableTableHead>
                <SortableTableHead activeSortKey={sourceSortKey} direction={sourceSortDirection} onSort={(key) => requestRollupSort(key, sourceSortKey, sourceSortDirection, setSourceSortKey, setSourceSortDirection)} sortKey="moneyOut">Money out</SortableTableHead>
                <SortableTableHead activeSortKey={sourceSortKey} direction={sourceSortDirection} onSort={(key) => requestRollupSort(key, sourceSortKey, sourceSortDirection, setSourceSortKey, setSourceSortDirection)} sortKey="needsReview">Needs review</SortableTableHead>
              </tr>
            </thead>
            <tbody>
              {sourceRows.map((row) => (
                <tr key={row.source}>
                  <td><span className={`source-pill ${row.source}`}>{sourceLabel(row.source)}</span></td>
                  <td>{row.aggregate.transactionCount}</td>
                  <td className="amount good-text">{analyticsAggregateMoney(row.aggregate, "in")}</td>
                  <td className="amount danger-text">{analyticsAggregateMoney(row.aggregate, "out")}</td>
                  <td>{row.aggregate.needsReviewCount}</td>
                </tr>
              ))}
              {sourceRows.length === 0 && (
                <tr><td colSpan={5}>No transaction sources in this period</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel wide-panel">
        <div className="panel-header compact">
          <h2>By category</h2>
          <span className="total-pill">{categoryRows.length} buckets</span>
        </div>
        <div className="table-wrap">
          <table className="data-table category-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Rows</th>
                <th>Matched</th>
                <th>Money in</th>
                <th>Money out</th>
                <th>Needs review</th>
              </tr>
            </thead>
            <tbody>
              {categoryRows.length > 0 ? categoryRows.map((row) => (
                <tr key={row.category}>
                  <td><strong>{row.category}</strong></td>
                  <td>{row.transactionCount}</td>
                  <td>{row.matchedTransactionCount}</td>
                  <td className="amount good-text">{analyticsAggregateMoney(row, "in")}</td>
                  <td className="amount danger-text">{analyticsAggregateMoney(row, "out")}</td>
                  <td>{row.needsReviewCount}</td>
                </tr>
              )) : (
                <tr><td colSpan={6}>No categorized transactions yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header compact">
          <h2>By company relationship</h2>
          <span className="total-pill">{relationshipRows.length} relationships</span>
        </div>
        <div className="bridge categorization-bridge">
          {relationshipRows.map((row) => (
            <div className="bridge-row" key={row.relationship}>
              <span>{analyticsRelationshipLabel(row.relationship)}</span>
              <strong>{row.transactionCount}</strong>
              <small>In {analyticsAggregateMoney(row, "in")} · Out {analyticsAggregateMoney(row, "out")}</small>
            </div>
          ))}
          {relationshipRows.length === 0 && <div className="money-empty">No company relationships yet</div>}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header compact">
          <h2>Needs review</h2>
          <span className="total-pill warning">{summary?.needsReviewCount ?? 0} rows</span>
        </div>
        <div className="review-list compact-review-list">
          {(analytics?.reviewSamples ?? []).map((transaction) => (
            <article className="review-row" key={transaction.id}>
              <div className={`direction-badge ${transaction.direction}`}>
                {transaction.direction === "in" ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
              </div>
              <div>
                <strong>{transaction.company}</strong>
                <span>{transaction.category} · {transaction.reason}</span>
              </div>
              <div className="review-amount">{money(transaction.amount, transaction.currency)}</div>
            </article>
          ))}
          {(summary?.needsReviewCount ?? 0) === 0 && <div className="empty-state">No transaction rows need review</div>}
        </div>
      </section>

      <section className="panel wide-panel">
        <div className="panel-header compact">
          <h2>Company rollup</h2>
          <div className="row-actions">
            <span className="total-pill">{companyRows.length} rows</span>
            <InfoPopover label="company rollup limits">
              <span>Matched companies are exact.</span>
              <span>Unmatched merchants use a bounded 40-row heavy-hitter set; evicted activity is preserved exactly in Other.</span>
            </InfoPopover>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table rollup-table">
            <thead>
              <tr>
                <th>Company</th>
                <th title="Business relationship to your company">Relationship</th>
                <th>Coverage</th>
                <th>Transactions</th>
                <th>Money in</th>
                <th>Money out</th>
                <th>Needs review</th>
              </tr>
            </thead>
            <tbody>
              {companyRows.length > 0 ? companyRows.map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.name}</strong></td>
                  <td>{row.relationship}</td>
                  <td><span className={`status-pill ${row.statusClass}`}>{row.coverage}</span></td>
                  <td>{row.aggregate.transactionCount}</td>
                  <td className="amount good-text">{analyticsAggregateMoney(row.aggregate, "in")}</td>
                  <td className="amount danger-text">{analyticsAggregateMoney(row.aggregate, "out")}</td>
                  <td>{row.aggregate.needsReviewCount}</td>
                </tr>
              )) : (
                <tr><td colSpan={7}>No company rollup yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      </>}
      </>}
    </div>
  );
}

type AnalyticsCategoryBreakdownSortKey = "name" | "transactions" | "amount" | "share";

const analyticsCategoryBreakdownSortKeys: readonly AnalyticsCategoryBreakdownSortKey[] = [
  "name",
  "transactions",
  "amount",
  "share"
];

function AnalyticsCategoryBreakdownPanel({
  selection,
  periodLabel,
  segment,
  companyRows,
  loading,
  error,
  onBack,
  onRetry,
  onViewTransactions
}: {
  selection: AnalyticsCategoryView;
  periodLabel: string;
  segment: CategoryPieSegment;
  companyRows: Array<AnalyticsCategoryCompanyView & { name: string; kind: string }>;
  loading: boolean;
  error: string | null;
  onBack: () => void;
  onRetry: () => void;
  onViewTransactions: () => void;
}) {
  const [sortKey, setSortKey] = useUrlState<AnalyticsCategoryBreakdownSortKey>(
    "analyticsCategorySort",
    "amount",
    { allowedValues: analyticsCategoryBreakdownSortKeys }
  );
  const [sortDirection, setSortDirection] = useUrlState<SortDirection>(
    "analyticsCategoryOrder",
    "desc",
    { allowedValues: ["asc", "desc"] }
  );
  const sortedRows = useMemo(() => [...companyRows].sort((left, right) => {
    const sortValue = (company: typeof left): number | string => {
      if (sortKey === "name") return company.name;
      if (sortKey === "transactions") return company.transactionCount;
      if (sortKey === "share") return segment.amount > 0 ? company.amountUsd / segment.amount : 0;
      return company.amountUsd;
    };
    return compareTableValues(sortValue(left), sortValue(right), sortDirection)
      || left.name.localeCompare(right.name);
  }), [companyRows, segment.amount, sortDirection, sortKey]);
  const tone = selection.direction === "out" ? "danger" : "good";

  function requestSort(nextSortKey: AnalyticsCategoryBreakdownSortKey): void {
    if (nextSortKey === sortKey) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(nextSortKey);
    setSortDirection(nextSortKey === "name" ? "asc" : "desc");
  }

  return (
    <section className="panel wide-panel analytics-category-companies analytics-category-breakdown">
      <div className="panel-header analytics-category-companies-header analytics-category-breakdown-header">
        <div className="analytics-category-title">
          <Button type="button" className="icon-button" aria-label="Back to category charts" onClick={onBack}>
            <ChevronLeft aria-hidden="true" size={17} />
          </Button>
          <div>
            <p className="eyebrow">
              {periodLabel} · {selection.direction === "out" ? "Spend" : "Revenue"} · USD estimate
            </p>
            <h2>{selection.category}</h2>
          </div>
        </div>
        <Button type="button" className="secondary-button analytics-category-transactions" onClick={onViewTransactions}>
          View all transactions <ArrowUpRight aria-hidden="true" size={14} />
        </Button>
      </div>

      <div className="analytics-category-overview" aria-label={`${selection.category} category summary`}>
        <div>
          <span>USD estimate</span>
          <strong className={tone}>{money(segment.amount, "USD")}</strong>
        </div>
        <div>
          <span>Transactions</span>
          <strong>{segment.count.toLocaleString()}</strong>
        </div>
        <div>
          <span>Companies and merchants</span>
          <strong>{companyRows.length.toLocaleString()}</strong>
        </div>
        <div className="analytics-category-native-total">
          <span>Native total</span>
          <strong title={formatCurrencyTotals(segment.nativeTotals)}>{formatCurrencyTotals(segment.nativeTotals)}</strong>
        </div>
      </div>

      <div className="analytics-category-table-heading">
        <div className="analytics-category-table-title">
          <h3>Company and merchant breakdown</h3>
          <InfoPopover label="category breakdown amounts">
            <span>Amounts are converted to USD for a comparable share. Native amounts remain the source of truth.</span>
          </InfoPopover>
        </div>
        {loading && (
          <span className="analytics-category-loading" aria-live="polite">
            <Loader2 className="spin" aria-hidden="true" size={14} /> Loading breakdown…
          </span>
        )}
      </div>

      {error ? (
        <div className="analytics-category-state danger-text" role="alert">
          <span>{error}</span>
          <Button type="button" className="secondary-button" onClick={onRetry}>
            <RefreshCw aria-hidden="true" size={14} /> Retry
          </Button>
        </div>
      ) : companyRows.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table analytics-company-table">
            <thead>
              <tr>
                <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={requestSort} sortKey="name">Company or merchant</SortableTableHead>
                <SortableTableHead activeSortKey={sortKey} className="analytics-company-numeric" direction={sortDirection} onSort={requestSort} sortKey="transactions">Transactions</SortableTableHead>
                <SortableTableHead activeSortKey={sortKey} className="analytics-company-numeric" direction={sortDirection} onSort={requestSort} sortKey="amount">Amount (USD)</SortableTableHead>
                <SortableTableHead activeSortKey={sortKey} className="analytics-company-numeric" direction={sortDirection} onSort={requestSort} sortKey="share">Share</SortableTableHead>
              </tr>
            </thead>
            <tbody aria-label={`${selection.category} company and merchant shares`}>
              {sortedRows.map((company) => (
                <tr key={company.companyKey}>
                  <td>
                    <span className="analytics-company-name">
                      <strong>{company.name}</strong>
                      <small>{company.kind} · Native {formatCurrencyTotals(company.nativeTotals)}</small>
                    </span>
                  </td>
                  <td className="analytics-company-numeric">{company.transactionCount.toLocaleString()}</td>
                  <td className="analytics-company-numeric"><strong>{money(company.amountUsd, "USD")}</strong></td>
                  <td className="analytics-company-numeric"><strong>{formatShare(company.amountUsd, segment.amount)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="analytics-category-state">
          {loading ? (
            <><Loader2 className="spin" aria-hidden="true" size={16} /> Loading companies and merchants…</>
          ) : (
            "No companies or merchants make up this category in the selected period."
          )}
        </div>
      )}
    </section>
  );
}

function CategoryDistributionPanel({
  title,
  direction,
  tone,
  group,
  selectedCategory,
  companyRows,
  companiesError,
  companiesLoading,
  emptyLabel,
  loading,
  onRetryCompanies,
  onSelectCategory,
  onOpenBreakdown
}: {
  title: string;
  direction: "in" | "out";
  tone: "good" | "danger";
  group: CategoryPieGroup | null;
  selectedCategory: string | null;
  companyRows: Array<AnalyticsCategoryCompanyView & { name: string; kind: string }>;
  companiesError: string | null;
  companiesLoading: boolean;
  emptyLabel: string;
  loading: boolean;
  onRetryCompanies: () => void;
  onSelectCategory: (category: string) => void;
  onOpenBreakdown: () => void;
}) {
  const selectedSegment = group?.segments.find((segment) => segment.category === selectedCategory) ?? null;
  const previewSegment = selectedSegment;

  return (
    <section className={`panel wide-panel category-distribution-panel ${tone}`} data-direction={direction}>
      <div className="category-distribution-header">
        <div className="category-distribution-heading">
          <h2>{title}</h2>
          <span>USD estimate</span>
          <InfoPopover label={`${title} USD estimate`}>
            <span>Non-USD activity is converted with the latest dashboard exchange rates. Native amounts remain the source of truth.</span>
            {group?.asOf && <span>Oldest rate used: {dateLabel(group.asOf)}.</span>}
            {(group?.staleCurrencies.length ?? 0) > 0 && <span>Last-known rates are used for {group!.staleCurrencies.join(", ")}.</span>}
            {(group?.excludedCurrencies.length ?? 0) > 0 && <span>{group!.excludedCurrencies.join(", ")} activity is excluded because no USD quote is available.</span>}
          </InfoPopover>
        </div>
        <div className="category-distribution-total">
          <span>Total</span>
          <strong className={tone}>{group ? money(group.total, "USD") : "—"}</strong>
        </div>
      </div>
      {group ? (
        <div className="category-distribution-body">
          <div className="category-pie-visual category-distribution-chart">
            <CategoryPieSvg
              group={group}
              selectedCategory={selectedSegment?.category ?? null}
              onSelectCategory={onSelectCategory}
            />
            <div className="pie-center category-distribution-center" aria-live="polite">
              <span>{previewSegment?.category ?? "Total"}</span>
              <strong>{compactMoney(previewSegment?.amount ?? group.total, "USD")}</strong>
              <small>{previewSegment ? formatShare(previewSegment.amount, group.total) : "100%"}</small>
            </div>
          </div>
          <div className="category-distribution-legend" aria-label={`${title} category shares`}>
            {group.segments.map((segment, index) => {
              const selected = segment.category === selectedSegment?.category;
              return (
                <button
                  aria-label={`${selected ? "Selected" : "Select"} ${segment.category}: ${money(segment.amount, "USD")}, ${formatShare(segment.amount, group.total)}, ${segment.count.toLocaleString()} ${segment.count === 1 ? "transaction" : "transactions"}`}
                  aria-pressed={selected}
                  className={`category-distribution-row ${selected ? "active selected" : ""}`}
                  key={segment.category}
                  onClick={() => onSelectCategory(segment.category)}
                  type="button"
                >
                  <span className="category-distribution-rank">{index + 1}</span>
                  <span className="legend-swatch" style={{ backgroundColor: segment.color }} />
                  <span className="legend-name" title={segment.category}>{segment.category}</span>
                  <strong>{money(segment.amount, "USD")}</strong>
                  <small>{formatShare(segment.amount, group.total)}</small>
                  <span className="category-distribution-pin" aria-hidden="true">
                    {selected && <Pin size={13} />}
                  </span>
                </button>
              );
            })}
          </div>
          <CategoryDistributionPreview
            companyRows={companyRows}
            error={companiesError}
            group={group}
            loading={companiesLoading}
            previewSegment={previewSegment}
            selected={previewSegment?.category === selectedSegment?.category}
            onOpenBreakdown={onOpenBreakdown}
            onRetry={onRetryCompanies}
          />
        </div>
      ) : (
        <div className="money-empty category-chart-empty">
          {loading && <Loader2 className="spin" aria-hidden="true" size={15} />}
          {loading ? "Syncing transactions…" : emptyLabel}
        </div>
      )}
    </section>
  );
}

function CategoryDistributionPreview({
  group,
  previewSegment,
  selected,
  companyRows,
  loading,
  error,
  onOpenBreakdown,
  onRetry,
}: {
  group: CategoryPieGroup;
  previewSegment: CategoryPieSegment | null;
  selected: boolean;
  companyRows: Array<AnalyticsCategoryCompanyView & { name: string; kind: string }>;
  loading: boolean;
  error: string | null;
  onOpenBreakdown: () => void;
  onRetry: () => void;
}) {
  if (!previewSegment) {
    return (
      <aside className="category-distribution-preview empty" aria-live="polite">
        <span className="category-preview-icon"><PieChart aria-hidden="true" size={21} /></span>
        <strong>Select a category</strong>
        <span>Choose a slice or row to preview its details.</span>
      </aside>
    );
  }

  const isOther = previewSegment.category === "Other";
  const visibleCompanies = selected ? companyRows.slice(0, 2) : [];

  return (
    <aside className="category-distribution-preview" aria-live="polite">
      <div className="category-preview-summary">
        <h3>{previewSegment.category} details</h3>
        <p><strong>{compactMoney(previewSegment.amount, "USD")}</strong> <span>converted</span></p>
        <p><strong>{previewSegment.count.toLocaleString()}</strong> <span>{previewSegment.count === 1 ? "transaction" : "transactions"}</span></p>
        <p className="category-preview-native" title={formatCurrencyTotals(previewSegment.nativeTotals)}>
          Native: {formatCurrencyTotals(previewSegment.nativeTotals)}
        </p>
      </div>
      <div className="category-preview-companies">
        {isOther ? (
          <>
            <h4>{previewSegment.categories.length.toLocaleString()} smaller categories</h4>
            <div className="category-preview-tail">
              {previewSegment.categories.slice(0, 4).map((category) => <span key={category}>{category}</span>)}
              {previewSegment.categories.length > 4 && <span>+{previewSegment.categories.length - 4} more</span>}
            </div>
          </>
        ) : !selected ? (
          <div className="category-preview-hint">Click to pin this category and load its top companies.</div>
        ) : error ? (
          <div className="category-preview-error" role="alert">
            <span>{error}</span>
            <Button type="button" className="secondary-button" onClick={onRetry}>
              <RefreshCw aria-hidden="true" size={13} /> Retry
            </Button>
          </div>
        ) : (
          <>
            <h4>Top companies</h4>
            {visibleCompanies.map((company, index) => (
              <div className="category-preview-company" key={company.companyKey}>
                <span>{index + 1}</span>
                <span className="legend-swatch" style={{ backgroundColor: previewSegment.color }} />
                <strong title={company.name}>{company.name}</strong>
                <span>{money(company.amountUsd, "USD")}</span>
                <small>{formatShare(company.amountUsd, previewSegment.amount)}</small>
              </div>
            ))}
            {loading && <div className="category-preview-loading"><Loader2 className="spin" aria-hidden="true" size={14} /> Loading companies…</div>}
            {!loading && visibleCompanies.length === 0 && (
              <div className="category-preview-hint">No matched companies or merchants in this category.</div>
            )}
          </>
        )}
      </div>
      {!isOther && selected && (
        <Button
          type="button"
          className="secondary-button category-preview-action"
          onClick={onOpenBreakdown}
        >
          View category breakdown <ChevronRight aria-hidden="true" size={14} />
        </Button>
      )}
    </aside>
  );
}

function CategoryPieSvg({
  group,
  selectedCategory,
  onSelectCategory
}: {
  group: CategoryPieGroup;
  selectedCategory: string | null;
  onSelectCategory: (category: string) => void;
}) {
  let angle = -90;

  return (
    <svg
      aria-hidden="true"
      className={`category-pie-svg ${selectedCategory ? "has-active" : ""}`}
      focusable="false"
      viewBox="0 0 120 120"
    >
      <circle className="pie-track" cx="60" cy="60" r="41" />
      {group.segments.map((segment, index) => {
        const startAngle = angle;
        angle = index === group.segments.length - 1
          ? 270
          : Math.min(270, angle + (segment.amount / group.total) * 360);
        return (
          <path
            className={`pie-segment ${selectedCategory === segment.category ? "active selected" : ""}`}
            data-category={segment.category}
            d={categoryDonutSegmentPath(startAngle, angle)}
            fill={segment.color}
            key={segment.category}
            onClick={() => onSelectCategory(segment.category)}
          >
            <title>
              {segment.category}: {money(segment.amount, "USD")} ({formatShare(segment.amount, group.total)})
            </title>
          </path>
        );
      })}
    </svg>
  );
}

function SimpleMoneyTable({
  rows,
  dense,
  emptyLabel = "No live rows",
  nameLabel = "Account",
  secondaryLabel = "Source"
}: {
  rows: Array<{ id: string; name: string; title: string; amount: number; currency: string; source: string }>;
  dense?: boolean;
  emptyLabel?: string;
  nameLabel?: string;
  secondaryLabel?: string;
}) {
  return (
    <div className={`money-list ${dense ? "dense" : ""}`}>
      <div className="money-row money-head">
        <span>{nameLabel}</span>
        <span>{secondaryLabel}</span>
        <span>Balance</span>
      </div>
      {rows.length > 0 ? (
        rows.map((row) => (
          <div className="money-row" key={row.id}>
            <span className="money-name" title={row.title}>
              {row.name}
            </span>
            <span className={`source-pill ${row.source.toLowerCase()}`}>{row.source}</span>
            <span className={`money-amount ${row.amount < 0 ? "danger-text" : ""}`}>
              {money(row.amount, row.currency)}
            </span>
          </div>
        ))
      ) : (
        <div className="money-empty">{emptyLabel}</div>
      )}
    </div>
  );
}

function ManualReceivableDialog({
  onClose,
  onSubmit
}: {
  onClose: () => void;
  onSubmit: (payload: CreateManualReceivablePayload) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        name: name.trim(),
        amount: Number(amount),
        currency: currency.trim().toUpperCase()
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Manual receivable could not be added");
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div className="modal-backdrop" role="presentation">
      <form className="modal manual-receivable-modal" role="dialog" aria-modal="true" aria-labelledby="manual-receivable-title" onSubmit={handleSubmit}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Receivables</p>
            <h2 id="manual-receivable-title">Add manual receivable</h2>
          </div>
          <Button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></Button>
        </div>
        {error && <div className="inline-error">{error}</div>}
        <label>
          Name
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="VAT, TAX, or another receivable" required />
        </label>
        <div className="manual-receivable-fields">
          <label>
            Amount
            <Input type="number" min="0.01" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required />
          </label>
          <label>
            Currency
            <Input value={currency} maxLength={12} onChange={(event) => setCurrency(event.target.value.toUpperCase())} required />
          </label>
        </div>
        <div className="modal-actions">
          <Button className="secondary-button" type="button" onClick={onClose}>Cancel</Button>
          <Button className="primary-button" type="submit" disabled={submitting || !name.trim() || !amount || !currency.trim()}>
            {submitting ? <Loader2 className="spin" size={15} /> : <Plus size={15} />} Add receivable
          </Button>
        </div>
      </form>
    </div>,
    document.body
  );
}

function BridgeRow({
  label,
  value,
  danger,
  good,
  currency = "USD",
  emptyValue = "—"
}: {
  label: string;
  value: CurrencyTotals | number | null | undefined;
  danger?: boolean;
  good?: boolean;
  currency?: string;
  emptyValue?: string;
}) {
  const formattedValue = typeof value === "number" || value == null
    ? optionalMoney(value, currency)
    : hasCurrencyTotals(value)
      ? formatCurrencyTotals(value)
      : emptyValue;
  return (
    <div className="bridge-row">
      <span>{label}</span>
      <strong className={danger ? "danger-text" : good ? "good-text" : ""}>{formattedValue}</strong>
    </div>
  );
}

function SummaryTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="summary-tile">
      <strong><AnimatedNumber animationKey={`summary-${label}`} value={value} /></strong>
      <span>{label}</span>
      {detail && <small className="currency-breakdown">{detail}</small>}
    </div>
  );
}

function CategorySearchSelect({
  value,
  options,
  onChange,
  label
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  label: string;
}) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuPosition, setMenuPosition] = useState<CategorySearchMenuPosition | null>(null);
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return options;
    return options.filter((option) => option.toLowerCase().includes(normalizedQuery));
  }, [options, query]);
  const activeOptionId = isOpen && filteredOptions[activeIndex] ? `${listboxId}-option-${activeIndex}` : undefined;

  function updateMenuPosition(visibleOptions = filteredOptions.length) {
    const anchor = triggerRef.current?.getBoundingClientRect();
    if (!anchor) return;
    setMenuPosition(categorySearchMenuPosition(anchor, visibleOptions));
  }

  function openMenu(nextQuery = "") {
    setQuery(nextQuery);
    setIsOpen(true);
    updateMenuPosition(nextQuery ? options.filter((option) => option.toLowerCase().includes(nextQuery.toLowerCase())).length : options.length);
  }

  function closeMenu() {
    setIsOpen(false);
    setQuery("");
    setActiveIndex(0);
    setMenuPosition(null);
  }

  function selectCategory(category: string) {
    if (category !== value) onChange(category);
    closeMenu();
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  useEffect(() => {
    if (!isOpen) return;
    updateMenuPosition(filteredOptions.length);
    const selectedIndex = filteredOptions.findIndex((option) => option === value);
    setActiveIndex(query.trim() ? 0 : Math.max(selectedIndex, 0));
  }, [filteredOptions, isOpen, query, value]);

  useEffect(() => {
    if (!isOpen) return;
    requestAnimationFrame(() => inputRef.current?.focus());

    function closeOnPointerDown(event: PointerEvent) {
      if (!(event.target instanceof Node) || rootRef.current?.contains(event.target)) return;
      if (event.target instanceof Element && event.target.closest(".category-combobox-menu")) return;
      closeMenu();
    }

    function closeOnViewportChange() {
      closeMenu();
    }

    function closeOnOutsideScroll(event: Event) {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      if (event.target instanceof Element && event.target.closest(".category-combobox-menu")) return;
      closeMenu();
    }

    document.addEventListener("pointerdown", closeOnPointerDown);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnOutsideScroll, true);

    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnOutsideScroll, true);
    };
  }, [isOpen]);

  function handleTriggerKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openMenu();
      return;
    }

    if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) {
      event.preventDefault();
      openMenu(event.key);
    }
  }

  function handleSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, Math.max(filteredOptions.length - 1, 0)));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const category = filteredOptions[activeIndex];
      if (category) selectCategory(category);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      requestAnimationFrame(() => triggerRef.current?.focus());
      return;
    }

    if (event.key === "Tab") closeMenu();
  }

  return (
    <div className="category-combobox" ref={rootRef}>
      <button
        type="button"
        className="category-combobox-trigger"
        aria-label={label}
        aria-controls={isOpen ? listboxId : undefined}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        onClick={() => (isOpen ? closeMenu() : openMenu())}
        onKeyDown={handleTriggerKeyDown}
        ref={triggerRef}
      >
        <span title={value}>{value}</span>
      </button>
      {isOpen && menuPosition && createPortal(
        <div
          className={`category-combobox-menu ${menuPosition.placement}`}
          style={{ left: menuPosition.left, top: menuPosition.top, width: menuPosition.width }}
        >
          <div className="category-combobox-search">
            <Search size={14} />
            <input
              ref={inputRef}
              value={query}
              placeholder="Search category"
              role="combobox"
              aria-controls={listboxId}
              aria-expanded={isOpen}
              aria-activedescendant={activeOptionId}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={handleSearchKeyDown}
            />
            {query && (
              <button
                type="button"
                className="category-combobox-clear"
                aria-label="Clear category search"
                onClick={() => setQuery("")}
                onMouseDown={(event) => event.preventDefault()}
              >
                <X size={13} />
              </button>
            )}
          </div>
          <div className="category-combobox-options" id={listboxId} role="listbox" aria-label={label}>
            {filteredOptions.length > 0 ? (
              filteredOptions.map((category, index) => (
                <button
                  type="button"
                  className={`category-combobox-option ${index === activeIndex ? "active" : ""}`}
                  id={`${listboxId}-option-${index}`}
                  key={category}
                  role="option"
                  aria-selected={category === value}
                  onClick={() => selectCategory(category)}
                  onMouseEnter={() => setActiveIndex(index)}
                >
                  <span>{category}</span>
                </button>
              ))
            ) : (
              <div className="category-combobox-empty">No categories found</div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

function TransactionTable({
  rows,
  expenses,
  categories,
  teams,
  providers,
  providersById,
  sortKey,
  sortDirection,
  onSort,
  onMatch,
  onAssignTeam,
  onUpdateCategory,
  onOpenInvoice,
  onMatchInvoice,
  hasPrevious,
  hasMore,
  isLoading,
  loadError,
  totalCount,
  onLoadPrevious,
  onLoadMore,
  showWiseEntity = false,
  source,
  reviewMode = false
}: {
  rows: Transaction[];
  expenses: ExpenseRecord[];
  categories: TransactionCategory[];
  teams: Team[];
  providers: readonly TransactionReviewCompany[];
  providersById: ReadonlyMap<string, TransactionReviewCompany>;
  sortKey: TransactionSortKey;
  sortDirection: SortDirection;
  onSort: (sortKey: TransactionSortKey) => void;
  onMatch: (transaction: Transaction, providerId: string | undefined, scope: TransactionOverrideScope) => void;
  onAssignTeam: (transaction: Transaction, teamId?: string) => void;
  onUpdateCategory: (transaction: Transaction, category: string, scope: TransactionOverrideScope) => void;
  onOpenInvoice: (transaction: Transaction) => void;
  onMatchInvoice: (transaction: Transaction) => void;
  hasPrevious: boolean;
  hasMore: boolean;
  isLoading: boolean;
  loadError: string | null;
  totalCount?: number;
  onLoadPrevious: () => Promise<void>;
  onLoadMore: () => Promise<void>;
  showWiseEntity?: boolean;
  source: BankSource | "all";
  reviewMode?: boolean;
}) {
  const [detailPopover, setDetailPopover] = useState<TransactionDetailPopover | null>(null);
  const [pendingOverride, setPendingOverride] = useState<
    | { kind: "category"; transaction: Transaction; value: string }
    | { kind: "company"; transaction: Transaction; value: string }
    | null
  >(null);
  const expenseByTransactionId = useMemo(
    () => new Map(expenses.flatMap((expense) => expense.transactionId ? [[expense.transactionId, expense] as const] : [])),
    [expenses]
  );
  const clientProviders = useMemo(
    () => providers.filter((provider) => provider.type === "client"),
    [providers]
  );
  const supplierProviders = useMemo(
    () => providers.filter((provider) => provider.type === "supplier"),
    [providers]
  );

  useEffect(() => {
    if (!detailPopover) return;

    function closeOnPointerDown(event: PointerEvent) {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest("[data-transaction-detail-popover], [data-transaction-detail-trigger]")) return;
      setDetailPopover(null);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setDetailPopover(null);
    }

    function closeOnViewportChange() {
      setDetailPopover(null);
    }

    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnViewportChange);
    window.addEventListener("scroll", closeOnViewportChange, true);

    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnViewportChange);
      window.removeEventListener("scroll", closeOnViewportChange, true);
    };
  }, [detailPopover]);

  function toggleDetailPopover(
    id: string,
    title: string,
    detail: string | readonly string[],
    event: ReactMouseEvent<HTMLButtonElement>
  ) {
    const details = (typeof detail === "string" ? [detail] : detail)
      .map((item) => item.trim())
      .filter(Boolean);
    if (details.length === 0) {
      setDetailPopover(null);
      return;
    }
    const position = detailPopoverPosition(event.currentTarget.getBoundingClientRect());

    setDetailPopover((current) => current?.id === id ? null : {
      id,
      title,
      details,
      ...position
    });
  }

  function detailInfoButton(id: string, title: string, detail: string | readonly string[], label: string) {
    const isOpen = detailPopover?.id === id;

    return (
      <button
        type="button"
        className="transaction-detail-trigger"
        title={label}
        aria-label={label}
        aria-expanded={isOpen}
        aria-describedby={isOpen ? "transaction-detail-popover" : undefined}
        data-transaction-detail-trigger
        onClick={(event) => toggleDetailPopover(id, title, detail, event)}
      >
        <Info size={12} strokeWidth={2.5} />
      </button>
    );
  }

  function applyPendingOverride(scope: TransactionOverrideScope) {
    if (!pendingOverride) return;
    if (pendingOverride.kind === "category") {
      onUpdateCategory(pendingOverride.transaction, pendingOverride.value, scope);
    } else {
      onMatch(pendingOverride.transaction, pendingOverride.value, scope);
    }
    setPendingOverride(null);
  }

  const pendingMerchantName = pendingOverride?.transaction.merchantName?.trim();
  const pendingValueLabel = pendingOverride?.kind === "company"
    ? providersById.get(pendingOverride.value)?.name ?? pendingOverride.value
    : pendingOverride?.value;

  return (
    <div className="table-wrap">
      {pendingOverride && createPortal(
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setPendingOverride(null)}>
          <div
            className="modal confirmation-modal transaction-override-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="transaction-override-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <p className="eyebrow">Manual override</p>
                <h2 id="transaction-override-title">
                  Apply {pendingOverride.kind === "category" ? "category" : "company"} change
                </h2>
              </div>
              <Button className="icon-button" type="button" aria-label="Close" onClick={() => setPendingOverride(null)}>
                <X size={16} />
              </Button>
            </div>
            <p>
              Set <strong>{pendingValueLabel}</strong> for {pendingMerchantName ?? pendingOverride.transaction.counterparty}.
            </p>
            <div className="modal-actions transaction-override-actions">
              <Button className="secondary-button" type="button" onClick={() => applyPendingOverride("transaction")}>
                This transaction only
              </Button>
              <Button
                type="button"
                disabled={!pendingMerchantName}
                title={pendingMerchantName ? `Apply to every ${pendingMerchantName} transaction` : "AI merchant identification is still pending"}
                onClick={() => applyPendingOverride("merchant")}
              >
                All {pendingMerchantName ?? "equivalent"} transactions
              </Button>
            </div>
            <small>
              {pendingMerchantName
                ? "The merchant-wide choice updates existing equivalents and teaches future transactions."
                : "Merchant-wide changes become available after AI merchant identification completes."}
            </small>
          </div>
        </div>,
        document.body
      )}
      {detailPopover && createPortal(
        <div
          id="transaction-detail-popover"
          className={`transaction-detail-popover ${detailPopover.placement}`}
          role="tooltip"
          data-transaction-detail-popover
          style={{ left: detailPopover.left, top: detailPopover.top }}
        >
          <strong>{detailPopover.title}</strong>
          {detailPopover.details.map((detail, index) => <span key={`${detailPopover.id}-${index}`}>{detail}</span>)}
        </div>,
        document.body
      )}
      <table className="data-table activity-table transaction-table">
        <colgroup>
          <col className="transaction-date-col" />
          {source === "all" && <col className="transaction-source-col" />}
          <col className="transaction-counterparty-col" />
          <col className="transaction-direction-col" />
          <col className="transaction-amount-col" />
          <col className="transaction-team-col" />
          <col className="transaction-category-col" />
          <col className="transaction-company-col" />
          {!reviewMode && <col className="transaction-document-col" />}
          {!reviewMode && <col className="transaction-actions-col" />}
        </colgroup>
        <thead>
          <tr>
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={onSort} sortKey="date">Date</SortableTableHead>
            {source === "all" && (
              <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={onSort} sortKey="source">Source</SortableTableHead>
            )}
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={onSort} sortKey="counterparty">Counterparty</SortableTableHead>
            <SortableTableHead
              activeSortKey={sortKey}
              description={source === "slash"
                ? "Slash records a daily card payment twice: Cash sent is the cash side and Card paid is the card-balance side. Card spend is the actual purchase."
                : undefined}
              direction={sortDirection}
              label="Movement"
              onSort={onSort}
              sortKey="direction"
            >
              Movement
            </SortableTableHead>
            <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={onSort} sortKey="amount">Amount</SortableTableHead>
            <SortableTableHead
              activeSortKey={sortKey}
              description="Optional responsibility attribution. Choose the person or group responsible for this transaction."
              direction={sortDirection}
              label="Owner"
              onSort={onSort}
              sortKey="team"
            >
              <>Owner <span className="column-note">Optional</span></>
            </SortableTableHead>
            <SortableTableHead
              activeSortKey={sortKey}
              description="Required. AI categorization keeps analytics current. A manual change can apply to one transaction or all equivalent merchant transactions."
              direction={sortDirection}
              label="Category"
              onSort={onSort}
              sortKey="category"
            >
              <>Category <span className="required-mark" aria-hidden="true">*</span></>
            </SortableTableHead>
            <SortableTableHead
              activeSortKey={sortKey}
              description="Optional directory match. Unmatched transactions still group in analytics by their AI merchant name."
              direction={sortDirection}
              label="Company"
              onSort={onSort}
              sortKey="company"
            >
              <>Company <span className="column-note">Optional</span></>
            </SortableTableHead>
            {!reviewMode && (
              <SortableTableHead activeSortKey={sortKey} direction={sortDirection} onSort={onSort} sortKey="document">Document</SortableTableHead>
            )}
            {!reviewMode && <th scope="col">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? (
            rows.map((transaction) => {
              const expense = expenseByTransactionId.get(transaction.id);
              const expectedProviderType = providerTypeForTransaction(transaction);
              const matchedProvider = transaction.matchedProviderId ? providersById.get(transaction.matchedProviderId) : undefined;
              const provider = matchedProvider?.type === expectedProviderType ? matchedProvider : undefined;
              const categoryConfidence = transaction.categoryConfidence ?? 0;
              const displayCategory = effectiveCategory(transaction);
              const internalTransfer = isInternalTransferTransaction(transaction);
              const nonOperatingMovement = isNonOperatingMovementTransaction(transaction);
              const voided = transaction.status === "voided";
              const counterpartyLabel = transactionCounterpartyLabel(transaction);
              const transactionDescription = transactionDescriptionLabel(transaction);
              const cashbackDetail = transaction.cashback
                ? `Cashback earned ${money(transaction.cashback.amount, transaction.currency)}${transaction.amount > 0
                  ? ` · ${((transaction.cashback.amount / transaction.amount) * 100).toFixed(2)}% effective`
                  : ""}`
                : undefined;
              const transactionDetails = cashbackDetail
                ? [transactionDescription, cashbackDetail]
                : [transactionDescription];
              const categoryDetail = `${(categoryConfidence * 100).toFixed(0)}% · ${transaction.categoryReason ?? "AI classification pending"}`;
              const counterpartyDetailId = `${transaction.id}-counterparty-description`;
              const categoryDetailId = `${transaction.id}-category-description`;
              const documentTitle = nonOperatingMovement
                ? `${displayCategory} does not need an invoice or receipt`
                : transaction.direction === "in"
                ? "Create exceptional sales invoice draft"
                : expense
                  ? `Expense documented as ${expense.recordNumber}`
                  : "Review expense and attach source document";
              const providerOptions = expectedProviderType === "client" ? clientProviders : supplierProviders;
              const companyPlaceholder = transaction.direction === "in" ? "Optional client" : "Optional supplier";
              return (
                <tr key={transaction.id}>
                  <td>{dateLabel(transaction.date)}</td>
                  {source === "all" && (
                    <td><span className={`bank-source-badge source-${transaction.source}`}>{sourceLabel(transaction.source)}</span></td>
                  )}
                  <td className="counterparty-cell">
                    <div className="transaction-counterparty-heading">
                      {showWiseEntity && transaction.wiseEntity && (
                        <span
                          className={`wise-entity-badge entity-${transaction.wiseEntity}`}
                          title={wiseEntityLabel(transaction.wiseEntity)}
                        >
                          {wiseEntityShortLabel(transaction.wiseEntity)}
                        </span>
                      )}
                      <strong>{counterpartyLabel}</strong>
                    </div>
                    <small className="transaction-detail-line">
                      <span className="transaction-detail-text">{transactionDescription}</span>
                      {detailInfoButton(
                        counterpartyDetailId,
                        "Transaction details",
                        transactionDetails,
                        `Show full transaction details for ${counterpartyLabel}`
                      )}
                    </small>
                    {cashbackDetail && <small className="good-text">{cashbackDetail}</small>}
                  </td>
                  <td>
                    <span className={`direction-label ${internalTransfer ? "transfer" : transaction.direction}`}>
                      {transaction.direction === "in" ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                      {transactionMovementLabel(transaction)}
                    </span>
                  </td>
                  <td className="amount">{money(transaction.amount, transaction.currency)}</td>
                  <td>
                    <div className="team-select">
                      <NativeSelect
                        aria-label={`Owner for ${transaction.merchantName ?? transaction.counterparty}`}
                        value={transaction.teamId ?? ""}
                        onValueChange={(value) => onAssignTeam(transaction, value || undefined)}
                      >
                        <NativeSelectOption value="">No owner</NativeSelectOption>
                        {teams.map((team) => (
                          <NativeSelectOption key={team.id} value={team.id}>
                            {team.name}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </div>
                  </td>
                  <td>
                    {voided ? (
                      <span
                        className="status-pill"
                        title="Card authorization cancelled or reversed before settlement; no category is required."
                      >
                        Voided
                      </span>
                    ) : (
                    <div className="category-select">
                      <div className="category-control-row">
                        <CategorySearchSelect
                          value={displayCategory}
                          options={transactionCategoryChoices(displayCategory, transaction.direction, categories)}
                          label={`Search category for ${transaction.merchantName ?? transaction.counterparty}`}
                          onChange={(category) => setPendingOverride({ kind: "category", transaction, value: category })}
                        />
                      </div>
                      <small className={`transaction-detail-line ${categoryConfidence >= 0.86 ? "good-text" : categoryConfidence > 0 ? "warning-text" : ""}`}>
                        <span className="transaction-detail-text">{categoryDetail}</span>
                        {detailInfoButton(
                          categoryDetailId,
                          displayCategory,
                          categoryDetail,
                          `Show category description for ${displayCategory}`
                        )}
                      </small>
                    </div>
                    )}
                  </td>
                  <td>
                    <div className="company-match">
                      {nonOperatingMovement ? (
                        <span className="status-pill">Not applicable</span>
                      ) : (
                      <NativeSelect
                        className="company-select"
                        value={provider?.id ?? ""}
                        onValueChange={(value) => {
                          if (!value) return;
                          setPendingOverride({ kind: "company", transaction, value });
                        }}
                        aria-label={`Company for ${transaction.counterparty}`}
                      >
                        {!provider && (
                          <NativeSelectOption value="" disabled>
                            {companyPlaceholder}
                          </NativeSelectOption>
                        )}
                        {providerOptions.map((item) => (
                          <NativeSelectOption key={item.id} value={item.id}>
                            {item.name}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                      )}
                      {!nonOperatingMovement && provider && <small>{providerTagLabel(provider)}</small>}
                    </div>
                  </td>
                  {!reviewMode && <td>
                    {nonOperatingMovement ? (
                      <span className="status-pill">Not required</span>
                    ) : transaction.matchedInvoiceId || expense ? (
                      <div className="transaction-document-match"><span className="status-pill good">{expense ? "Expense linked" : "Invoice linked"}</span>{transaction.invoiceMatchSource && !expense && <small>{transaction.invoiceMatchSource === "ai" ? "AI matched" : transaction.invoiceMatchSource === "exact" ? "Exact match" : transaction.invoiceMatchSource === "tolerance" ? "Fee-tolerant match" : "Manual"}</small>}</div>
                    ) : (
                      <div className="transaction-document-match"><span className="status-pill">None</span>{transaction.invoiceMatchSource === "manual" && <small>Manual override</small>}</div>
                    )}
                  </td>}
                  {!reviewMode && <td>
                    <div className="row-actions">
                      {transaction.direction === "in" && !nonOperatingMovement && !expense && <Button className={`icon-button ${transaction.matchedInvoiceId ? "matched-action" : ""}`} title={transaction.matchedInvoiceId ? "Invoice matched — review or replace" : "Match to an existing invoice"} onClick={() => onMatchInvoice(transaction)}>{transaction.matchedInvoiceId ? <Check size={16} /> : <Link2 size={16} />}</Button>}
                      <Button className="icon-button" title={documentTitle} disabled={nonOperatingMovement || Boolean(expense)} onClick={() => onOpenInvoice(transaction)}>
                        {transaction.direction === "in" ? <FilePlus2 size={16} /> : <ReceiptText size={16} />}
                      </Button>
                    </div>
                  </td>}
                </tr>
              );
            })
          ) : (
            <tr>
              <td colSpan={7 + (source === "all" ? 1 : 0) + (reviewMode ? 0 : 2)}>{isLoading ? "Loading transactions…" : "No loaded transactions match these filters"}</td>
            </tr>
          )}
        </tbody>
      </table>
      {(hasPrevious || hasMore || isLoading || loadError) && (
        <div className="bank-table-pagination">
          <span className={loadError ? "danger-text" : undefined}>
            {loadError ?? (totalCount === undefined
              ? `${rows.length} transactions on this page`
              : `${rows.length} of ${totalCount.toLocaleString("en-US")} matching transactions`)}
          </span>
          <div className="bank-table-pagination-actions">
            <Button
              className="secondary-button"
              type="button"
              disabled={isLoading || !hasPrevious}
              onClick={() => void onLoadPrevious()}
            >
              <ChevronLeft size={15} /> Previous {transactionTablePageSize}
            </Button>
            <Button
              className="secondary-button"
              type="button"
              disabled={isLoading || (!hasMore && !loadError)}
              onClick={() => void onLoadMore()}
            >
              {isLoading ? <Loader2 className="spin" size={15} /> : loadError ? <RefreshCw size={15} /> : <ChevronRight size={15} />}
              {isLoading ? "Loading" : loadError ? "Retry" : `Next ${transactionTablePageSize}`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

type DistributionAdjustmentTarget = {
  month: string;
  currency: string;
  partnerId: ProfitDistributionPartnerId;
  partnerName: string;
  bucket: ProfitDistributionBucket;
  currentAmount: number;
  adjustment?: ProfitDistributionAdjustment;
};

function distributionAdjustmentFor(
  adjustments: ProfitDistributionAdjustment[],
  month: string,
  currency: string,
  partnerId: ProfitDistributionPartnerId,
  bucket: ProfitDistributionBucket
): ProfitDistributionAdjustment | undefined {
  const id = profitDistributionAdjustmentId({ month, currency, partnerId, bucket });
  return adjustments.find((adjustment) => adjustment.id === id);
}

function distributionBucketAmount(row: ProfitDistributionPartnerLedger, bucket: ProfitDistributionBucket): number {
  if (bucket === "profit-share") return row.profitSharePayable;
  if (bucket === "salary") return row.salaryPayable;
  return row.distributionPayable;
}

function DistributionAmountButton({
  value,
  currency,
  disabled,
  adjusted,
  title,
  onClick
}: {
  value: number;
  currency: string;
  disabled: boolean;
  adjusted: boolean;
  title: string;
  onClick: () => void;
}) {
  if (disabled) return <span className="muted-cell">—</span>;

  return (
    <button
      className={`amount-adjust-button ${adjusted ? "adjusted" : ""}`}
      title={title}
      type="button"
      onClick={onClick}
    >
      <span>{money(value, currency)}</span>
      <Pencil size={13} />
    </button>
  );
}

function DistributionView({
  dashboard,
  onSaveAdjustment
}: {
  dashboard: DashboardSnapshot;
  onSaveAdjustment: (payload: SaveProfitDistributionAdjustmentPayload) => Promise<void>;
}) {
  const distribution = dashboard.profitDistribution;
  const monthOptions = useMemo(
    () => [...new Set(distribution.months.map((month) => month.month))].sort((left, right) => right.localeCompare(left)),
    [distribution.months]
  );
  const currencyOptions = useMemo(() => distribution.currencies.map((currency) => currency.currency), [distribution.currencies]);
  const [selectedMonth, setSelectedMonth] = useUrlState(
    "distributionMonth",
    monthOptions[0] ?? new Date().toISOString().slice(0, 7)
  );
  const [selectedCurrency, setSelectedCurrency] = useUrlState(
    "distributionCurrency",
    currencyOptions.includes("EUR") ? "EUR" : currencyOptions[0] ?? "EUR"
  );
  const [editingAdjustment, setEditingAdjustment] = useState<DistributionAdjustmentTarget | null>(null);
  const monthOptionsKey = monthOptions.join("|");
  const currencyOptionsKey = currencyOptions.join("|");
  const selectedMonthCurrencies = useMemo(
    () => distribution.months.filter((month) => month.month === selectedMonth).map((month) => month.currency),
    [distribution.months, selectedMonth]
  );
  const selectedMonthCurrenciesKey = selectedMonthCurrencies.join("|");

  useEffect(() => {
    if (monthOptions.length > 0 && !monthOptions.includes(selectedMonth)) {
      setSelectedMonth(monthOptions[0]);
    }
  }, [monthOptions, monthOptionsKey, selectedMonth]);

  useEffect(() => {
    if (currencyOptions.length === 0) return;
    const allowedCurrencies = selectedMonthCurrencies.length > 0 ? selectedMonthCurrencies : currencyOptions;
    if (!allowedCurrencies.includes(selectedCurrency)) {
      setSelectedCurrency(allowedCurrencies.includes("EUR") ? "EUR" : allowedCurrencies[0]);
    }
  }, [currencyOptions, currencyOptionsKey, selectedCurrency, selectedMonthCurrencies, selectedMonthCurrenciesKey]);

  const selectedLedger =
    distribution.months.find((month) => month.month === selectedMonth && month.currency === selectedCurrency) ??
    distribution.months[0];
  const currencySummary = distribution.currencies.find((currency) => currency.currency === selectedCurrency);
  const payableTotal = currencySummary ? { [currencySummary.currency]: currencySummary.totalPayable } : {};
  const paidTotal = currencySummary ? { [currencySummary.currency]: currencySummary.totalPaid } : {};
  const remainingTotal = currencySummary ? { [currencySummary.currency]: currencySummary.remaining } : {};
  const balanceRows = distribution.partners.filter((partner) => partner.currency === selectedCurrency);
  const partnerOrder = new Map(profitDistributionPartners.map((partner, index) => [partner.id, index]));
  const selectedPartners = selectedLedger
    ? [...selectedLedger.partners].sort(
        (left, right) => (partnerOrder.get(left.partnerId) ?? 0) - (partnerOrder.get(right.partnerId) ?? 0)
      )
    : [];
  const sortedBalanceRows = [...balanceRows].sort(
    (left, right) => (partnerOrder.get(left.partnerId) ?? 0) - (partnerOrder.get(right.partnerId) ?? 0)
  );

  function openAdjustment(row: ProfitDistributionPartnerLedger, bucket: ProfitDistributionBucket) {
    if (!selectedLedger) return;
    setEditingAdjustment({
      month: selectedLedger.month,
      currency: selectedLedger.currency,
      partnerId: row.partnerId,
      partnerName: row.entityName ? `${row.partnerName} / ${row.entityName}` : row.partnerName,
      bucket,
      currentAmount: distributionBucketAmount(row, bucket),
      adjustment: distributionAdjustmentFor(
        distribution.adjustments,
        selectedLedger.month,
        selectedLedger.currency,
        row.partnerId,
        bucket
      )
    });
  }

  function bucketCanAdjust(row: ProfitDistributionPartnerLedger, bucket: ProfitDistributionBucket): boolean {
    const existing = selectedLedger
      ? distributionAdjustmentFor(distribution.adjustments, selectedLedger.month, selectedLedger.currency, row.partnerId, bucket)
      : undefined;
    if (existing) return true;
    if (bucket === "profit-share") return row.partnerId === "ishan";
    if (bucket === "salary") return row.salaryPayable > 0;
    return true;
  }

  return (
    <div className="distribution-layout">
      <section className="panel wide-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Distribution</p>
            <h2>Partner payables, paid amounts, and remaining balances</h2>
          </div>
          <span className="total-pill" title={nativeCurrencyBreakdown(remainingTotal)}>{formatUsdCurrencyTotal(remainingTotal, dashboard.fxRates)} remaining</span>
        </div>
        <div className="revenue-controls distribution-controls">
          <label>
            Month
            <NativeSelect value={selectedMonth} onValueChange={setSelectedMonth}>
              {monthOptions.map((month) => (
                <NativeSelectOption key={month} value={month}>
                  {monthLabel(month)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label>
            Currency
            <NativeSelect value={selectedCurrency} onValueChange={setSelectedCurrency}>
              {(selectedMonthCurrencies.length > 0 ? selectedMonthCurrencies : currencyOptions).map((currency) => (
                <NativeSelectOption key={currency} value={currency}>
                  {currency}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
        </div>
        <div className="wise-summary-grid distribution-summary">
          <SummaryTile label="Payable" value={formatUsdCurrencyTotal(payableTotal, dashboard.fxRates)} detail={nativeCurrencyBreakdown(payableTotal)} />
          <SummaryTile label="Paid" value={formatUsdCurrencyTotal(paidTotal, dashboard.fxRates)} detail={nativeCurrencyBreakdown(paidTotal)} />
          <SummaryTile label="Remaining" value={formatUsdCurrencyTotal(remainingTotal, dashboard.fxRates)} detail={nativeCurrencyBreakdown(remainingTotal)} />
          <SummaryTile label="Adjustments" value={String(distribution.adjustments.length)} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-header compact">
          <h2>Calculation bridge</h2>
          <span className="total-pill">{selectedLedger ? monthLabel(selectedLedger.month) : "—"}</span>
        </div>
        <div className="bridge">
          <BridgeRow label="Revenue" value={selectedLedger?.revenue} currency={selectedCurrency} good />
          <BridgeRow label="General costs" value={selectedLedger ? -selectedLedger.generalCosts : null} currency={selectedCurrency} danger />
          <BridgeRow label="Net profit after general costs" value={selectedLedger?.netProfitAfterGeneralCosts} currency={selectedCurrency} />
          <BridgeRow label="Ishan 25% share" value={selectedLedger ? -selectedLedger.ishanProfitShare : null} currency={selectedCurrency} danger />
          <BridgeRow label="Fixed salaries" value={selectedLedger ? -selectedLedger.salaryDeductions : null} currency={selectedCurrency} danger />
          <BridgeRow label="Profit available for distribution" value={selectedLedger?.profitAvailableForDistribution} currency={selectedCurrency} good />
        </div>
      </section>

      <section className="panel">
        <div className="panel-header compact">
          <h2>Currency balance</h2>
          <span className="total-pill">{selectedCurrency}</span>
        </div>
        <div className="bridge">
          <BridgeRow label="Total payable" value={currencySummary?.totalPayable} currency={selectedCurrency} />
          <BridgeRow label="Total paid" value={currencySummary?.totalPaid} currency={selectedCurrency} good />
          <BridgeRow label="Remaining" value={currencySummary?.remaining} currency={selectedCurrency} />
          <BridgeRow label="Distribution pool" value={selectedLedger?.distributionPool} currency={selectedCurrency} />
        </div>
      </section>

      <section className="panel wide-panel">
        <div className="panel-header compact">
          <h2>Accumulated partner balances</h2>
          <span className="total-pill">{sortedBalanceRows.length} rows</span>
        </div>
        <div className="table-wrap">
          <table className="data-table distribution-table">
            <thead>
              <tr>
                <th>Partner</th>
                <th>Profit share</th>
                <th>Salary</th>
                <th>Distribution</th>
                <th>Payable</th>
                <th>Paid</th>
                <th>Remaining</th>
              </tr>
            </thead>
            <tbody>
              {sortedBalanceRows.length > 0 ? (
                sortedBalanceRows.map((row) => (
                  <tr key={`${row.partnerId}-${row.currency}`}>
                    <td>
                      <strong>{row.partnerName}</strong>
                      <small>{row.entityName ?? row.currency}</small>
                    </td>
                    <td className="amount">{money(row.profitSharePayable, row.currency)}</td>
                    <td className="amount">{money(row.salaryPayable, row.currency)}</td>
                    <td className="amount">{money(row.distributionPayable, row.currency)}</td>
                    <td className="amount">{money(row.totalPayable, row.currency)}</td>
                    <td className="amount good-text">{money(row.totalPaid, row.currency)}</td>
                    <td className={`amount ${row.remaining <= 0 ? "good-text" : ""}`}>{money(row.remaining, row.currency)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7}>No distribution balances yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel wide-panel">
        <div className="panel-header compact">
          <h2>Selected month payables</h2>
          <span className="total-pill">{selectedLedger ? `${selectedLedger.month} ${selectedLedger.currency}` : "—"}</span>
        </div>
        <div className="table-wrap">
          <table className="data-table distribution-table">
            <thead>
              <tr>
                <th>Partner</th>
                <th>Profit share</th>
                <th>Salary</th>
                <th>Distribution</th>
                <th>Paid</th>
                <th>Remaining</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {selectedPartners.length > 0 ? (
                selectedPartners.map((row) => {
                  const profitShareAdjustment = selectedLedger
                    ? distributionAdjustmentFor(distribution.adjustments, selectedLedger.month, selectedLedger.currency, row.partnerId, "profit-share")
                    : undefined;
                  const salaryAdjustment = selectedLedger
                    ? distributionAdjustmentFor(distribution.adjustments, selectedLedger.month, selectedLedger.currency, row.partnerId, "salary")
                    : undefined;
                  const distributionAdjustment = selectedLedger
                    ? distributionAdjustmentFor(distribution.adjustments, selectedLedger.month, selectedLedger.currency, row.partnerId, "distribution")
                    : undefined;
                  return (
                    <tr key={`${selectedLedger?.id}-${row.partnerId}`}>
                      <td>
                        <strong>{row.partnerName}</strong>
                        <small>{row.entityName ?? row.currency}</small>
                      </td>
                      <td className="amount">
                        <DistributionAmountButton
                          value={row.profitSharePayable}
                          currency={row.currency}
                          disabled={!bucketCanAdjust(row, "profit-share")}
                          adjusted={Boolean(profitShareAdjustment)}
                          title={`Adjust ${profitDistributionBucketLabels["profit-share"]} for ${row.partnerName}`}
                          onClick={() => openAdjustment(row, "profit-share")}
                        />
                      </td>
                      <td className="amount">
                        <DistributionAmountButton
                          value={row.salaryPayable}
                          currency={row.currency}
                          disabled={!bucketCanAdjust(row, "salary")}
                          adjusted={Boolean(salaryAdjustment)}
                          title={`Adjust ${profitDistributionBucketLabels.salary} for ${row.partnerName}`}
                          onClick={() => openAdjustment(row, "salary")}
                        />
                      </td>
                      <td className="amount">
                        <DistributionAmountButton
                          value={row.distributionPayable}
                          currency={row.currency}
                          disabled={!bucketCanAdjust(row, "distribution")}
                          adjusted={Boolean(distributionAdjustment)}
                          title={`Adjust ${profitDistributionBucketLabels.distribution} for ${row.partnerName}`}
                          onClick={() => openAdjustment(row, "distribution")}
                        />
                      </td>
                      <td className="amount">
                        <strong className="good-text">{money(row.totalPaid, row.currency)}</strong>
                        <small>
                          Salary {money(row.salaryPaid, row.currency)} · Dist. {money(row.profitSharePaid + row.distributionPaid, row.currency)}
                        </small>
                      </td>
                      <td className={`amount ${row.remaining <= 0 ? "good-text" : ""}`}>{money(row.remaining, row.currency)}</td>
                      <td>
                        <div className="status-chip-list">
                          {row.hasAdjustment && <span className="status-pill warning">Adjusted</span>}
                          {row.hasDeferred && <span className="status-pill">Deferred</span>}
                          {!row.hasAdjustment && !row.hasDeferred && <span className="status-pill good">Calculated</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7}>No selected month ledger</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {editingAdjustment && (
        <DistributionAdjustmentModal
          target={editingAdjustment}
          onClose={() => setEditingAdjustment(null)}
          onSubmit={async (payload) => {
            await onSaveAdjustment(payload);
            setEditingAdjustment(null);
          }}
        />
      )}
    </div>
  );
}

function DistributionAdjustmentModal({
  target,
  onClose,
  onSubmit
}: {
  target: DistributionAdjustmentTarget;
  onClose: () => void;
  onSubmit: (payload: SaveProfitDistributionAdjustmentPayload) => Promise<void>;
}) {
  const isSalary = target.bucket === "salary";
  const [overrideAmount, setOverrideAmount] = useState(
    target.adjustment?.overrideAmount === undefined ? "" : String(target.adjustment.overrideAmount)
  );
  const [waived, setWaived] = useState(Boolean(target.adjustment?.waived));
  const [deferred, setDeferred] = useState(Boolean(target.adjustment?.deferred));
  const [note, setNote] = useState(target.adjustment?.note ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveAdjustment(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        month: target.month,
        currency: target.currency,
        partnerId: target.partnerId,
        bucket: target.bucket,
        waived: isSalary ? waived : false,
        deferred: isSalary ? false : deferred,
        overrideAmount: overrideAmount.trim() ? Number(overrideAmount) : null,
        note
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Distribution adjustment could not be saved");
    } finally {
      setSubmitting(false);
    }
  }

  async function clearAdjustment() {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        month: target.month,
        currency: target.currency,
        partnerId: target.partnerId,
        bucket: target.bucket,
        waived: false,
        deferred: false,
        overrideAmount: null,
        note: ""
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Distribution adjustment could not be cleared");
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div className="modal-backdrop" role="presentation">
      <form className="modal" onSubmit={saveAdjustment}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Distribution adjustment</p>
            <h2>{profitDistributionBucketLabels[target.bucket]} for {target.partnerName}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="transaction-summary">
          <span>{monthLabel(target.month)} · {target.currency}</span>
          <strong>{money(target.currentAmount, target.currency)}</strong>
          <small>Current payable</small>
        </div>
        {error && <div className="inline-error">{error}</div>}
        <div className="form-grid">
          <label>
            Override amount
            <input
              type="number"
              min="0"
              step="0.01"
              value={overrideAmount}
              onChange={(event) => setOverrideAmount(event.target.value)}
              placeholder={money(target.currentAmount, target.currency)}
            />
          </label>
          <label className="check-row modal-check-row distribution-check-row">
            <input
              type="checkbox"
              checked={isSalary ? waived : deferred}
              onChange={(event) => (isSalary ? setWaived(event.target.checked) : setDeferred(event.target.checked))}
            />
            {isSalary ? "Salary waived" : "Payment deferred"}
          </label>
        </div>
        <label>
          Note
          <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} />
        </label>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="secondary-button" onClick={() => void clearAdjustment()} disabled={submitting || !target.adjustment}>
            <RefreshCw size={16} />
            Clear
          </button>
          <button type="submit" className="primary-button" disabled={submitting}>
            {submitting ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
            Save
          </button>
        </div>
      </form>
    </div>,
    document.body
  );
}

type ConnectedBankViewProps = Omit<
  BankReconciliationViewProps,
  "isImportingWise" | "onImportWiseStatements" | "rangeControls" | "source" | "tableFooter" | "wide"
>;

function BankDateRangeControls({
  dateRange,
  isLoading,
  onLoad,
  windowDays
}: {
  dateRange: BankTransactionDateRange;
  isLoading: boolean;
  onLoad: (dateRange: BankTransactionDateRange) => Promise<void>;
  windowDays: number;
}) {
  return (
    <div className="bank-date-controls">
      <BankPeriodPicker
        dateRange={dateRange}
        isLoading={isLoading}
        onLoad={onLoad}
        windowDays={windowDays}
      />
      <InfoPopover label="automatic bank updates">
        Revolut and Slash refresh automatically. Slash account and card metadata is verified on import, and any unchecked history is repaired in the background.
      </InfoPopover>
    </div>
  );
}

function RevolutView({
  dashboard,
  rows,
  dateRange,
  isLoadingDateRange,
  onLoadDateRange,
  ...reconciliationProps
}: ConnectedBankViewProps & {
  dateRange: RevolutTransactionDateRange;
  isLoadingDateRange: boolean;
  onLoadDateRange: (dateRange: RevolutTransactionDateRange) => Promise<void>;
}) {
  const rangeControls = (
    <BankDateRangeControls
      dateRange={dateRange}
      isLoading={isLoadingDateRange}
      onLoad={onLoadDateRange}
      windowDays={revolutDefaultActivityWindowDays}
    />
  );
  return (
    <BankReconciliationView
      {...reconciliationProps}
      dashboard={dashboard}
      rows={rows}
      source="revolut"
      wide
      rangeControls={rangeControls}
    />
  );
}

function SlashView({
  dashboard,
  rows,
  dateRange,
  isLoadingDateRange,
  onLoadDateRange,
  ...reconciliationProps
}: ConnectedBankViewProps & {
  dateRange: SlashTransactionDateRange;
  isLoadingDateRange: boolean;
  onLoadDateRange: (dateRange: SlashTransactionDateRange) => Promise<void>;
}) {
  const rangeControls = (
    <BankDateRangeControls
      dateRange={dateRange}
      isLoading={isLoadingDateRange}
      onLoad={onLoadDateRange}
      windowDays={slashDefaultActivityWindowDays}
    />
  );
  return (
    <BankReconciliationView
      {...reconciliationProps}
      dashboard={dashboard}
      rows={rows}
      source="slash"
      wide
      rangeControls={rangeControls}
    />
  );
}

function AmexView({
  dashboard,
  rows,
  dateRange,
  isLoadingDateRange,
  onLoadDateRange,
  ...reconciliationProps
}: ConnectedBankViewProps & {
  dateRange: BankTransactionDateRange;
  isLoadingDateRange: boolean;
  onLoadDateRange: (dateRange: BankTransactionDateRange) => Promise<void>;
}) {
  const rangeControls = (
    <BankDateRangeControls
      dateRange={dateRange}
      isLoading={isLoadingDateRange}
      onLoad={onLoadDateRange}
      windowDays={revolutDefaultActivityWindowDays}
    />
  );
  return (
    <BankReconciliationView
      {...reconciliationProps}
      dashboard={dashboard}
      rows={rows}
      source="amex"
      wide
      rangeControls={rangeControls}
    />
  );
}

function ProvidersView({
  providers,
  revenuePartners,
  taxes,
  teamsById,
  onAdd,
  onEditProvider,
  onEditRevenuePartner,
  onAddRevenuePartner,
  onDeleteProvider,
  onDeleteRevenuePartner
}: {
  providers: Provider[];
  revenuePartners: RevenuePartner[];
  taxes: MeritTax[];
  teamsById: Map<string, Team>;
  onAdd: () => void;
  onEditProvider: (provider: Provider) => void;
  onEditRevenuePartner: (partner: RevenuePartner) => void;
  onAddRevenuePartner: (provider: Provider) => void;
  onDeleteProvider: (provider: Provider) => void;
  onDeleteRevenuePartner: (partner: RevenuePartner) => void;
}) {
  const [scope, setScope] = useUrlState<"all" | ProviderType>("companyType", "all", {
    allowedValues: ["all", "client", "supplier"]
  });
  const [query, setQuery] = useUrlState("companyQuery", "");
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleProviders = providers.filter((provider) => {
    if (scope !== "all" && provider.type !== scope) return false;
    if (!normalizedQuery) return true;

    const linkedRevenuePartners = revenuePartners.filter((partner) => partner.providerId === provider.id);
    return [
      provider.name,
      providerTypeLabel(provider.type),
      provider.email,
      provider.address,
      provider.defaultCurrency,
      provider.taxId,
      provider.meritDetails?.registrationNumber,
      provider.meritDetails?.contactName,
      provider.meritDetails?.phone,
      provider.meritDetails?.bankAccount,
      ...provider.tags,
      ...provider.aliases,
      ...linkedRevenuePartners.flatMap((partner) => [partner.name, teamsById.get(partner.teamId ?? "")?.name])
    ]
      .filter((value): value is string => Boolean(value))
      .join(" ")
      .toLocaleLowerCase()
      .includes(normalizedQuery);
  });
  const clientCount = providers.filter((provider) => provider.type === "client").length;
  const supplierCount = providers.filter((provider) => provider.type === "supplier").length;
  const taxesById = new Map(taxes.map((tax) => [tax.id, tax]));

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Business directory</p>
          <h2>Clients, suppliers, tags, and known bank names</h2>
        </div>
        <Button className="secondary-button" onClick={onAdd}>
          <Plus size={16} />
          Add company
        </Button>
      </div>
      <div className="directory-toolbar">
        <div className="segmented-control" aria-label="Directory filter">
          {[
            { id: "all", label: "All" },
            { id: "client", label: `Clients ${clientCount}` },
            { id: "supplier", label: `Suppliers ${supplierCount}` }
          ].map((item) => (
            <Button
              key={item.id}
              className={scope === item.id ? "active" : ""}
              onClick={() => setScope(item.id as "all" | ProviderType)}
            >
              {item.label}
            </Button>
          ))}
        </div>
        <div className="search-box directory-search" role="search">
          <Search size={16} aria-hidden="true" />
          <input
            aria-label="Search companies"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search companies"
            type="search"
            value={query}
          />
          {query && (
            <Button aria-label="Clear company search" className="directory-search-clear" onClick={() => setQuery("")} type="button">
              <X size={14} />
            </Button>
          )}
        </div>
      </div>
      <div className="provider-grid">
        {visibleProviders.map((provider) => (
          <article className="provider-card" key={provider.id}>
            <div className="provider-card-head">
              <div className="provider-avatar">
                <Building2 size={18} />
              </div>
              <div>
                <strong>{provider.name}</strong>
                <span>{providerTypeLabel(provider.type)}</span>
              </div>
              <div className="provider-card-actions">
                <Button className="icon-button" aria-label={`Edit ${provider.name}`} title="Edit company" onClick={() => onEditProvider(provider)}>
                  <Pencil size={15} />
                </Button>
                {provider.source !== "merit" && (
                  <Button
                    className="icon-button destructive-icon-button"
                    aria-label={`Delete ${provider.name}`}
                    title="Delete company"
                    onClick={() => onDeleteProvider(provider)}
                  >
                    <Trash2 size={15} />
                  </Button>
                )}
              </div>
            </div>
            <div className="tag-list">
              {provider.tags.length > 0 ? provider.tags.map((tag) => <span key={tag}>{tag}</span>) : <span>No tags</span>}
            </div>
            <div className="provider-detail-list">
              {provider.source === "merit" && <span className="provider-sync-label">Synced from Merit</span>}
              {provider.email && <span>{provider.email}</span>}
              {provider.address && <span>{provider.address}</span>}
              {provider.meritDetails?.registrationNumber && <span>Registration: {provider.meritDetails.registrationNumber}</span>}
              {provider.taxId && <span>VAT / tax ID: {provider.taxId}</span>}
              {provider.defaultMeritTaxId && (
                <span>
                  Invoice tax: {taxesById.get(provider.defaultMeritTaxId)?.name ?? provider.defaultMeritTaxId}
                  {taxesById.has(provider.defaultMeritTaxId) ? ` · ${taxesById.get(provider.defaultMeritTaxId)!.taxPct}%` : ""}
                  {provider.defaultMeritTaxSource === "merit-history" ? ` · learned from ${provider.defaultMeritTaxSampleSize ?? 0} invoices` : ""}
                </span>
              )}
              {provider.defaultCurrency && <span>{provider.defaultCurrency}{provider.paymentTermsDays !== undefined ? ` · ${provider.paymentTermsDays}-day terms` : ""}</span>}
              {provider.meritDetails?.contactName && <span>Contact: {provider.meritDetails.contactName}</span>}
              {provider.meritDetails?.phone && <span>{provider.meritDetails.phone}</span>}
              {provider.meritDetails?.bankAccount && <span>Bank: {provider.meritDetails.bankAccount}</span>}
            </div>
            <div className="alias-list">
              {provider.aliases.filter((alias) => alias.trim().toLowerCase() !== provider.name.trim().toLowerCase()).length > 0 ? (
                provider.aliases
                  .filter((alias) => alias.trim().toLowerCase() !== provider.name.trim().toLowerCase())
                  .slice(0, 6)
                  .map((alias) => <span key={alias}>{alias}</span>)
              ) : (
                <span className="muted-chip">No known bank aliases</span>
              )}
            </div>
            {provider.type === "client" && (
              <div className="company-revenue-rules">
                <div className="company-rule-heading">
                  <span>Revenue rules</span>
                  <strong>{revenuePartners.filter((partner) => partner.providerId === provider.id).length}</strong>
                </div>
                {revenuePartners.filter((partner) => partner.providerId === provider.id).length > 0 ? (
                  revenuePartners.filter((partner) => partner.providerId === provider.id).map((partner) => (
                    <div className="company-rule-entry" key={partner.id}>
                      <button type="button" className="company-rule-row" onClick={() => onEditRevenuePartner(partner)}>
                        <span>
                          <strong>{partner.name}</strong>
                          <small>{partner.source === "quinstreet" ? `QuinStreet QMP · ${partner.categoryValue}` : "TUNE"} · {partner.teamId ? teamsById.get(partner.teamId)?.name ?? "Unknown owner" : "Company-level"} · {partner.billingCadence} · {partner.billingTimezone}</small>
                        </span>
                        <span className={`status-pill ${partner.autoDraft ? "good" : ""}`}>{partner.autoDraft ? "Auto-draft" : "Manual draft"}</span>
                      </button>
                      <Button className="icon-button destructive-icon-button company-rule-delete" type="button" aria-label={`Delete revenue rule ${partner.name}`} title="Delete revenue rule" onClick={() => onDeleteRevenuePartner(partner)}>
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  ))
                ) : (
                  <span className="muted-chip">No revenue pull rule linked</span>
                )}
                <Button className="company-add-rule-button" type="button" onClick={() => onAddRevenuePartner(provider)}>
                  <Plus size={14} /> Add revenue rule
                </Button>
              </div>
            )}
          </article>
        ))}
        {visibleProviders.length === 0 && (
          <div className="empty-state">
            {normalizedQuery ? `No companies match “${query.trim()}”` : "No companies in this filter"}
          </div>
        )}
      </div>
    </section>
  );
}

function DeleteCompanyDialog({
  target,
  onClose,
  onConfirm
}: {
  target: DirectoryDeleteTarget;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = target.kind === "provider" ? target.provider.name : target.partner.name;
  const relationship = target.kind === "provider" ? providerTypeLabel(target.provider.type).toLowerCase() : "revenue rule";

  async function handleConfirm(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : target.kind === "provider" ? "Company could not be deleted" : "Revenue rule could not be deleted");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="modal confirmation-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-company-title"
        onSubmit={handleConfirm}
      >
        <div className="confirmation-icon" aria-hidden="true">
          <Trash2 size={20} />
        </div>
        <div>
          <p className="eyebrow">Delete {relationship}</p>
          <h2 id="delete-company-title">Delete {name}?</h2>
        </div>
        <p className="confirmation-copy">
          {target.kind === "provider"
            ? "This removes the company and its revenue rules, stopping future pulls. References are cleared from matched transactions, invoices, and revenue history, but the financial records stay in place."
            : "This removes the revenue rule and stops future syncs. Existing revenue runs and invoice history stay in place."}
        </p>
        {error && <div className="inline-error">{error}</div>}
        <div className="modal-actions">
          <Button type="button" className="secondary-button" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" className="destructive-button" disabled={submitting}>
            {submitting ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
            {target.kind === "provider" ? "Delete company" : "Delete rule"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function SettingsView({
  dashboard,
  onCreateTeam,
  onCreateCategory,
  onUpdateCategory,
  onDeleteCategory,
  onSaveAiSettings,
  onRunAiPrompt
}: {
  dashboard: DashboardSnapshot;
  onCreateTeam: (payload: CreateTeamPayload) => Promise<void>;
  onCreateCategory: (payload: CreateTransactionCategoryPayload) => Promise<void>;
  onUpdateCategory: (
    category: TransactionCategory,
    payload: UpdateTransactionCategoryDefinitionPayload
  ) => Promise<void>;
  onDeleteCategory: (category: TransactionCategory) => Promise<void>;
  onSaveAiSettings: (payload: SaveAiSettingsPayload) => Promise<void>;
  onRunAiPrompt: (payload: AiPromptPayload) => Promise<AiPromptResult>;
}) {
  const missing = dashboard.integrationStatus.flatMap((item) => item.needs.map((need) => ({ source: item.label, need })));
  const meritIntegration = dashboard.integrationStatus.find((integration) => integration.id === "merit");
  const [selectedModel, setSelectedModel] = useState(dashboard.aiSettings.model);
  const [zdrModels, setZdrModels] = useState<OpenRouterZdrModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);
  const [modelError, setModelError] = useState<string | null>(null);
  const [teamName, setTeamName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [aiResult, setAiResult] = useState<AiPromptResult | null>(null);
  const [busy, setBusy] = useState<"team" | "save" | "prompt" | null>(null);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [categoryEditor, setCategoryEditor] = useState<TransactionCategory | "new" | null>(null);
  const [categoryDeleteTarget, setCategoryDeleteTarget] = useState<TransactionCategory | null>(null);

  useEffect(() => {
    setSelectedModel(dashboard.aiSettings.model);
  }, [dashboard.aiSettings.model]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadZdrModels() {
      setModelsLoading(true);
      setModelError(null);
      try {
        const response = await fetch(`${apiBase}/ai/models`, { signal: controller.signal });
        if (!response.ok) {
          throw new Error(await apiErrorMessage(response, "Zero Data Retention models could not be loaded"));
        }
        setZdrModels((await response.json()) as OpenRouterZdrModel[]);
      } catch (error) {
        if (controller.signal.aborted) return;
        setModelError(error instanceof Error ? error.message : "Zero Data Retention models could not be loaded");
      } finally {
        if (!controller.signal.aborted) setModelsLoading(false);
      }
    }
    void loadZdrModels();
    return () => controller.abort();
  }, []);

  const categoryUsage = useMemo(() => {
    const usage = new Map<string, number>();
    const add = (name: string) => usage.set(name, (usage.get(name) ?? 0) + 1);
    for (const rule of dashboard.transactionCategoryRules) add(rule.category);
    for (const partner of dashboard.revenuePartners) {
      if (partner.revenueCategory) add(partner.revenueCategory);
    }
    return usage;
  }, [dashboard.revenuePartners, dashboard.transactionCategoryRules]);

  const modelOptions = useMemo(
    () => zdrModels.map((model) => ({ label: `${model.name} · ${model.id}`, value: model.id })),
    [zdrModels]
  );
  const selectedModelIsZdr = zdrModels.some((model) => model.id === selectedModel);

  async function addTeam(event: FormEvent) {
    event.preventDefault();
    setBusy("team");
    setTeamError(null);
    try {
      await onCreateTeam({ name: teamName });
      setTeamName("");
    } catch (err) {
      setTeamError(err instanceof Error ? err.message : "Owner could not be created");
    } finally {
      setBusy(null);
    }
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    setBusy("save");
    setAiError(null);
    try {
      await onSaveAiSettings({ model: selectedModel });
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "AI settings could not be saved");
    } finally {
      setBusy(null);
    }
  }

  async function runPrompt(event: FormEvent) {
    event.preventDefault();
    setBusy("prompt");
    setAiError(null);
    setAiResult(null);
    try {
      setAiResult(
        await onRunAiPrompt({
          prompt,
          systemPrompt: "You are the finance dashboard AI assistant. Be concise and operational."
        })
      );
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "AI prompt failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="settings-stack">
      <section className="panel category-management-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Accounting setup</p>
            <h2>Categories</h2>
          </div>
          <div className="row-actions">
            <span className="total-pill">{dashboard.transactionCategories.length} categories</span>
            <Button className="primary-button" type="button" onClick={() => setCategoryEditor("new")}>
              <Plus size={16} />
              Add category
            </Button>
          </div>
        </div>
        <p className="section-intro">
          Categories are available anywhere transactions or revenue rules are classified. Built-in names and types stay locked because reporting logic depends on them.
        </p>
        <div className="category-management-list" role="list">
          {dashboard.transactionCategories.map((category) => {
            const usageCount = categoryUsage.get(category.name) ?? 0;
            const deleteDisabled = category.system || usageCount > 0;
            const deleteTitle = category.system
              ? "Built-in categories cannot be deleted"
              : usageCount > 0
                ? `Reassign ${usageCount} ${usageCount === 1 ? "reference" : "references"} before deleting`
                : `Delete ${category.name}`;
            return (
              <article className="category-management-row" key={category.id} role="listitem">
                <span className="category-color-swatch" style={{ backgroundColor: category.color }} aria-hidden="true" />
                <div className="category-management-name">
                  <strong>{category.name}</strong>
                  <span>{category.system ? "Built-in" : "Custom"}</span>
                </div>
                <span className={`category-direction-pill ${category.direction}`}>
                  {category.direction === "in" ? "Money in" : category.direction === "out" ? "Money out" : "Money in & out"}
                </span>
                <span className="category-usage">{usageCount} {usageCount === 1 ? "reference" : "references"}</span>
                <div className="row-actions">
                  <Button
                    className="icon-button"
                    type="button"
                    aria-label={`Edit ${category.name}`}
                    title={`Edit ${category.name}`}
                    onClick={() => setCategoryEditor(category)}
                  >
                    <Pencil size={15} />
                  </Button>
                  <Button
                    className="icon-button destructive-icon-button"
                    type="button"
                    aria-label={`Delete ${category.name}`}
                    title={deleteTitle}
                    disabled={deleteDisabled}
                    onClick={() => setCategoryDeleteTarget(category)}
                  >
                    <Trash2 size={15} />
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Operating setup</p>
            <h2>Owners</h2>
          </div>
          <span className="total-pill">{dashboard.teams.length} owners</span>
        </div>
        <form className="settings-form" onSubmit={addTeam}>
          <div className="form-grid">
            <label>
              Owner name
              <Input value={teamName} onChange={(event) => setTeamName(event.target.value)} />
            </label>
          </div>
          {teamError && <div className="inline-error">{teamError}</div>}
          <div className="modal-actions">
            <Button className="primary-button" type="submit" disabled={busy === "team" || !teamName.trim()}>
              {busy === "team" ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
              Add owner
            </Button>
          </div>
        </form>
        <div className="settings-chip-list">
          {dashboard.teams.map((team) => (
            <span key={team.id}>{team.name}</span>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">AI settings</p>
            <h2>OpenRouter model for website and backend tasks</h2>
          </div>
          <span className={`status-pill ${dashboard.aiSettings.apiKeyConfigured ? "good" : "warning"}`}>
            {dashboard.aiSettings.apiKeyConfigured ? "Runtime secret configured" : "Runtime secret missing"}
          </span>
        </div>
        <form className="settings-form" onSubmit={saveSettings}>
          <div className="docs-note">
            <strong>OpenRouter Zero Data Retention</strong>
            <span>Only models from OpenRouter’s current ZDR catalog are listed, and every AI request is restricted to ZDR endpoints.</span>
            <span>Credentials remain server-side in the OPENROUTER_API_KEY runtime secret.</span>
          </div>
          <div className="form-grid ai-model-grid">
            <label>
              OpenRouter model
              <SearchableSelect
                value={selectedModelIsZdr ? selectedModel : ""}
                options={modelOptions}
                onValueChange={setSelectedModel}
                placeholder={modelsLoading ? "Loading OpenRouter ZDR models…" : "Search OpenRouter ZDR models"}
                emptyMessage="No OpenRouter ZDR models found"
                ariaLabel="OpenRouter Zero Data Retention model"
                clearable={false}
                disabled={modelsLoading || Boolean(modelError)}
              />
            </label>
          </div>
          {!modelsLoading && !modelError && selectedModel && !selectedModelIsZdr && (
            <div className="inline-error">The saved model is not currently in OpenRouter’s ZDR catalog. Choose another model.</div>
          )}
          {modelError && <div className="inline-error">{modelError}</div>}
          {aiError && <div className="inline-error">{aiError}</div>}
          <div className="modal-actions">
            <Button className="primary-button" type="submit" disabled={busy === "save" || !selectedModelIsZdr}>
              {busy === "save" ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
              Save AI settings
            </Button>
          </div>
        </form>
        <form className="settings-form ai-prompt-form" onSubmit={runPrompt}>
          <label>
            Prompt
            <Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={3} />
          </label>
          <div className="modal-actions">
            <Button className="secondary-button" type="submit" disabled={busy === "prompt" || !dashboard.aiSettings.apiKeyConfigured}>
              {busy === "prompt" ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
              Run prompt
            </Button>
          </div>
          {aiResult && (
            <div className="prompt-result">
              <div>
                <KeyRound size={15} />
                <span>{aiResult.model}</span>
              </div>
              <p>{aiResult.output}</p>
            </div>
          )}
        </form>
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">API readiness</p>
            <h2>Live integrations and credentials needed</h2>
          </div>
          <span className="total-pill">{missing.length} missing</span>
        </div>

        <div className="integration-grid">
          {dashboard.integrationStatus.map((integration) => (
            <article className="integration-card" key={integration.id}>
              <div className="integration-head">
                <strong>{integration.label}</strong>
                <span className={`status-pill ${integration.mode === "live" ? "good" : integration.mode === "partial" ? "warning" : ""}`}>
                  {integration.mode}
                </span>
              </div>
              <p className={integration.issue ? "integration-issue" : undefined}>{integration.message}</p>
              <div className="need-list">
                {integration.needs.length > 0 ? (
                  integration.needs.map((need) => <code key={need}>{need}</code>)
                ) : integration.issue ? (
                  <code className="warning-code">statement access</code>
                ) : (
                  <code>configured</code>
                )}
              </div>
            </article>
          ))}
        </div>

        <div className="docs-note">
          <strong>Integration shape</strong>
          <span>
            Banks groups Wise, Revolut, Slash, and Amex account activity. Partner revenue pulls from TUNE or QuinStreet QMP without writing to Merit. Only the
            separately confirmed “Send to Merit” action creates an invoice. That action is currently{" "}
            {meritIntegration?.writeEnabled
              ? "enabled and requires both a Merit tax selection and explicit confirmation"
              : "disabled by the deployment safety switch"}.
            Marking paid here never marks paid in Merit.
          </span>
        </div>
      </section>

      {categoryEditor && (
        <TransactionCategoryDialog
          category={categoryEditor === "new" ? undefined : categoryEditor}
          onClose={() => setCategoryEditor(null)}
          onSubmit={async (payload) => {
            if (categoryEditor === "new") await onCreateCategory(payload);
            else await onUpdateCategory(categoryEditor, payload);
            setCategoryEditor(null);
          }}
        />
      )}
      {categoryDeleteTarget && (
        <DeleteTransactionCategoryDialog
          category={categoryDeleteTarget}
          onClose={() => setCategoryDeleteTarget(null)}
          onDelete={async () => {
            await onDeleteCategory(categoryDeleteTarget);
            setCategoryDeleteTarget(null);
          }}
        />
      )}
    </div>
  );
}

function TransactionCategoryDialog({
  category,
  onClose,
  onSubmit
}: {
  category?: TransactionCategory;
  onClose: () => void;
  onSubmit: (payload: CreateTransactionCategoryPayload) => Promise<void>;
}) {
  const [name, setName] = useState(category?.name ?? "");
  const [direction, setDirection] = useState<TransactionCategory["direction"]>(category?.direction ?? "out");
  const [color, setColor] = useState(category?.color ?? "#2563eb");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const colorIsValid = /^#[0-9a-f]{6}$/i.test(color);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ name, direction, color });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Category could not be saved");
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="modal category-editor-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="category-editor-title"
        onSubmit={handleSubmit}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">{category ? "Edit category" : "New category"}</p>
            <h2 id="category-editor-title">{category ? category.name : "Add transaction category"}</h2>
          </div>
          <Button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </Button>
        </div>
        {category?.system && (
          <div className="docs-note">
            <strong>Built-in reporting category</strong>
            <span>The name and transaction type are locked. You can still change its display color.</span>
          </div>
        )}
        {error && <div className="inline-error">{error}</div>}
        <label>
          Name
          <Input
            value={name}
            disabled={category?.system}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Client entertainment"
            autoFocus={!category?.system}
          />
        </label>
        <label>
          Transaction type
          <NativeSelect
            value={direction}
            disabled={category?.system}
            onValueChange={(value) => setDirection(value as TransactionCategory["direction"])}
          >
            <NativeSelectOption value="in">Money in</NativeSelectOption>
            <NativeSelectOption value="out">Money out</NativeSelectOption>
            <NativeSelectOption value="both">Money in & out</NativeSelectOption>
          </NativeSelect>
        </label>
        <label>
          Color
          <div className="category-color-field">
            <input
              type="color"
              value={colorIsValid ? color : "#2563eb"}
              aria-label="Choose category color"
              onChange={(event) => setColor(event.target.value)}
            />
            <Input
              value={color}
              aria-invalid={!colorIsValid}
              onChange={(event) => setColor(event.target.value)}
              placeholder="#2563eb"
            />
          </div>
        </label>
        <div className="modal-actions">
          <Button type="button" className="secondary-button" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            className="primary-button"
            disabled={submitting || !name.trim() || !colorIsValid}
          >
            {submitting ? <Loader2 className="spin" size={16} /> : category ? <Save size={16} /> : <Plus size={16} />}
            {category ? "Save category" : "Add category"}
          </Button>
        </div>
      </form>
    </div>
  );
}

function DeleteTransactionCategoryDialog({
  category,
  onClose,
  onDelete
}: {
  category: TransactionCategory;
  onClose: () => void;
  onDelete: () => Promise<void>;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    setSubmitting(true);
    setError(null);
    try {
      await onDelete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Category could not be deleted");
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="delete-category-title">
        <div className="confirmation-icon" aria-hidden="true">
          <Trash2 size={20} />
        </div>
        <div>
          <p className="eyebrow">Delete category</p>
          <h2 id="delete-category-title">Delete {category.name}?</h2>
        </div>
        <p className="confirmation-copy">
          This removes the category from transaction and revenue selectors. This action cannot be undone.
        </p>
        {error && <div className="inline-error">{error}</div>}
        <div className="modal-actions">
          <Button type="button" className="secondary-button" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" className="destructive-button" onClick={() => void handleDelete()} disabled={submitting}>
            {submitting ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
            Delete category
          </Button>
        </div>
      </div>
    </div>
  );
}

function InvoicePaymentMatchDialog({
  transaction,
  dashboard,
  onClose,
  onSubmit
}: {
  transaction: Transaction;
  dashboard: DashboardSnapshot;
  onClose: () => void;
  onSubmit: (invoiceId?: string) => Promise<void>;
}) {
  const [invoiceId, setInvoiceId] = useState(transaction.matchedInvoiceId ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const providersById = new Map(dashboard.providers.map((provider) => [provider.id, provider]));
  const candidates = dashboard.invoices
    .filter((invoice) =>
      invoice.documentType === "sales_invoice"
      && invoice.status !== "draft"
      && invoice.currency.toUpperCase() === transaction.currency.toUpperCase()
      && (invoice.status === "open" || invoice.id === transaction.matchedInvoiceId)
    )
    .sort((left, right) => right.issueDate.localeCompare(left.issueDate));
  const options = candidates.map((invoice) => {
    const allocated = dashboard.paymentAllocations
      .filter((allocation) => allocation.invoiceId === invoice.id && allocation.transactionId !== transaction.id)
      .reduce((total, allocation) => total + allocation.amount, 0);
    const outstanding = Math.max(0, invoice.amount - allocated);
    const company = invoice.providerId ? providersById.get(invoice.providerId)?.name : invoice.customerName;
    return {
      value: invoice.id,
      label: `${invoice.invoiceNumber} · ${company ?? invoice.customerName} · ${money(outstanding, invoice.currency)}`
    };
  });

  async function save(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(invoiceId || undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Invoice match could not be saved");
      setSubmitting(false);
    }
  }

  return createPortal(
    <div className="modal-backdrop" role="presentation">
      <form className="modal payment-modal" role="dialog" aria-modal="true" aria-labelledby="invoice-payment-match-title" onSubmit={save}>
        <div className="modal-header"><div><p className="eyebrow">Bank payment match</p><h2 id="invoice-payment-match-title">Attach an invoice</h2></div><Button type="button" className="icon-button" onClick={onClose} aria-label="Close"><X size={18} /></Button></div>
        <div className="transaction-summary"><span>{dateLabel(transaction.date)} · {transaction.accountName}</span><strong>{money(Math.abs(transaction.amount), transaction.currency)}</strong><small>{transaction.counterparty || transaction.description}</small></div>
        {transaction.invoiceMatchSource && <div className="income-callout"><Info size={16} /><span>Current decision: <strong>{transaction.invoiceMatchSource === "ai" ? "AI match" : transaction.invoiceMatchSource === "exact" ? "Exact automatic match" : transaction.invoiceMatchSource === "tolerance" ? "Fee-tolerant automatic match" : transaction.matchedInvoiceId ? "Manual match" : "Manually unmatched"}</strong>{transaction.invoiceMatchReason ? ` · ${transaction.invoiceMatchReason}` : ""}</span></div>}
        {error && <div className="inline-error">{error}</div>}
        <label>Invoice<SearchableSelect value={invoiceId} options={options} onValueChange={setInvoiceId} placeholder="Search invoice number or company" emptyMessage="No open invoices in this currency" ariaLabel="Invoice payment match" /></label>
        <div className="merit-unchanged-banner"><CircleAlert size={18} /><div><strong>Dashboard allocation only</strong><span>Saving replaces this transaction’s automatic match. Clearing the invoice keeps it manually unmatched. Merit is never changed.</span></div></div>
        <div className="modal-actions"><Button type="button" className="secondary-button" onClick={onClose} disabled={submitting}>Cancel</Button><Button type="submit" className="primary-button" disabled={submitting}>{submitting ? <Loader2 className="spin" size={16} /> : invoiceId ? <Link2 size={16} /> : <X size={16} />}{invoiceId ? "Save invoice match" : "Keep unmatched"}</Button></div>
      </form>
    </div>,
    document.body
  );
}

function InvoiceModal({
  transaction,
  provider,
  providers,
  onClose,
  onSubmit
}: {
  transaction: Transaction;
  provider?: Provider;
  providers: Provider[];
  onClose: () => void;
  onSubmit: (payload: CreateInvoicePayload) => Promise<void>;
}) {
  const providerOptions = providers.filter((item) => item.type === "client");
  const selectedProvider = provider?.type === "client" ? provider : undefined;
  const [providerId, setProviderId] = useState(selectedProvider?.id || "");
  const [customerName, setCustomerName] = useState(selectedProvider?.legalName || selectedProvider?.name || bankInvoiceName(transaction));
  const [amount, setAmount] = useState(String(Math.abs(transaction.amount)));
  const [dueDate, setDueDate] = useState(providerDueDate(selectedProvider));
  const [description, setDescription] = useState(transaction.description);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        transactionId: transaction.id,
        providerId: providerId || undefined,
        documentType: "sales_invoice",
        customerName,
        amount: Number(amount),
        currency: transaction.currency,
        dueDate,
        description
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create invoice");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="modal" onSubmit={handleSubmit}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Finance document</p>
            <h2>Create exceptional sales invoice draft</h2>
          </div>
          <Button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </Button>
        </div>
        <div className="transaction-summary">
          <span>{transaction.counterparty}</span>
          <strong>{money(transaction.amount, transaction.currency)}</strong>
          <small>{transaction.rawName}</small>
        </div>
        {error && <div className="inline-error">{error}</div>}
        <label>
          Company
          <NativeSelect
            value={providerId}
            onValueChange={(value) => {
              const nextProviderId = value;
              const nextProvider = providerOptions.find((item) => item.id === nextProviderId);
              setProviderId(nextProviderId);
              if (nextProvider) {
                setCustomerName(nextProvider.legalName || nextProvider.name);
                setDueDate(providerDueDate(nextProvider));
              }
            }}
          >
            <NativeSelectOption value="">No client selected</NativeSelectOption>
            {providerOptions.map((item) => (
              <NativeSelectOption key={item.id} value={item.id}>
                {item.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <label>
          Customer name
          <Input value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
        </label>
        <div className="form-grid">
          <label>
            Amount
            <Input type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </label>
          <label>
            Due date
            <Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </label>
        </div>
        <label>
          Description
          <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
        </label>
        <div className="modal-actions">
          <Button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="primary-button" disabled={submitting}>
            {submitting ? <Loader2 className="spin" size={16} /> : <FilePlus2 size={16} />}
            Create draft
          </Button>
        </div>
      </form>
    </div>
  );
}

function ProviderModal({
  provider,
  taxes,
  onClose,
  onSubmit
}: {
  provider?: Provider;
  taxes: MeritTax[];
  onClose: () => void;
  onSubmit: (payload: UpdateProviderPayload) => Promise<void>;
}) {
  const [name, setName] = useState(provider?.name ?? "");
  const [type, setType] = useState<ProviderType>(provider?.type ?? "supplier");
  const [tags, setTags] = useState(provider?.tags.join(", ") ?? "");
  const [aliases, setAliases] = useState(provider?.aliases.join(", ") ?? "");
  const [defaultAccount, setDefaultAccount] = useState(provider?.defaultAccount ?? "");
  const [legalName, setLegalName] = useState(provider?.legalName ?? "");
  const [email, setEmail] = useState(provider?.email ?? "");
  const [country, setCountry] = useState(provider?.country ?? "");
  const [address, setAddress] = useState(provider?.address ?? "");
  const [taxId, setTaxId] = useState(provider?.taxId ?? "");
  const [defaultCurrency, setDefaultCurrency] = useState(provider?.defaultCurrency ?? "");
  const [paymentTermsDays, setPaymentTermsDays] = useState(
    provider?.paymentTermsDays === undefined ? "" : String(provider.paymentTermsDays)
  );
  const [meritCustomerId, setMeritCustomerId] = useState(provider?.meritCustomerId ?? "");
  const [meritSupplierId, setMeritSupplierId] = useState(provider?.meritSupplierId ?? "");
  const [defaultMeritTaxId, setDefaultMeritTaxId] = useState(provider?.defaultMeritTaxId ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        name,
        type,
        tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        aliases: aliases.split(",").map((alias) => alias.trim()).filter(Boolean),
        defaultAccount: defaultAccount.trim() || undefined,
        legalName: legalName.trim() || undefined,
        email: email.trim() || undefined,
        country: country.trim() || undefined,
        address: address.trim() || undefined,
        taxId: taxId.trim() || undefined,
        defaultCurrency: defaultCurrency.trim() || undefined,
        paymentTermsDays: paymentTermsDays.trim() ? Number(paymentTermsDays) : undefined,
        meritCustomerId: meritCustomerId.trim() || undefined,
        meritSupplierId: meritSupplierId.trim() || undefined,
        defaultMeritTaxId: defaultMeritTaxId || undefined
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Provider could not be saved");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form
        className="modal provider-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="provider-modal-title"
        onSubmit={handleSubmit}
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">Directory setup</p>
            <h2 id="provider-modal-title">{provider ? "Edit company" : "Add company"}</h2>
          </div>
          <Button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </Button>
        </div>
        <div className="provider-modal-body">
          {error && <div className="inline-error">{error}</div>}
          <section className="form-section" aria-labelledby="company-details-heading">
            <div className="form-section-heading">
              <h3 id="company-details-heading">Company details</h3>
              <p>Identity and contact information used on finance records.</p>
            </div>
            <label>
              Name
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Position2, Facebook Direct, client name" />
            </label>
            <div className="form-grid">
              <label>
                Relationship
                <NativeSelect value={type} onValueChange={(value) => setType(value as ProviderType)}>
                  <NativeSelectOption value="client">Client</NativeSelectOption>
                  <NativeSelectOption value="supplier">Supplier</NativeSelectOption>
                </NativeSelect>
              </label>
              <label>
                Company tags
                <Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Ad platform, Subscription, Revenue" />
              </label>
            </div>
            <div className="form-grid">
              <label>
                Legal name
                <Input value={legalName} onChange={(event) => setLegalName(event.target.value)} />
              </label>
              <label>
                Email
                <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
              </label>
            </div>
            <div className="form-grid">
              <label>
                Country
                <Input value={country} onChange={(event) => setCountry(event.target.value)} />
              </label>
              <label>
                Tax ID
                <Input value={taxId} onChange={(event) => setTaxId(event.target.value)} />
              </label>
            </div>
            <label>
              Address
              <Textarea value={address} onChange={(event) => setAddress(event.target.value)} rows={2} />
            </label>
          </section>

          <section className="form-section" aria-labelledby="billing-details-heading">
            <div className="form-section-heading">
              <h3 id="billing-details-heading">Billing defaults</h3>
              <p>Optional defaults for invoices, bills, and Merit records.</p>
            </div>
            <div className="form-grid">
              <label>
                Default currency
                <Input value={defaultCurrency} onChange={(event) => setDefaultCurrency(event.target.value.toUpperCase())} placeholder="USD" />
              </label>
              <label>
                Payment terms days
                <Input type="number" min="0" step="1" value={paymentTermsDays} onChange={(event) => setPaymentTermsDays(event.target.value)} />
              </label>
            </div>
            <div className="form-grid">
              <label>
                Merit customer ID
                <Input value={meritCustomerId} onChange={(event) => setMeritCustomerId(event.target.value)} />
              </label>
              <label>
                Merit supplier ID
                <Input value={meritSupplierId} onChange={(event) => setMeritSupplierId(event.target.value)} />
              </label>
            </div>
            <label>
              Default Merit invoice tax
              <NativeSelect value={defaultMeritTaxId} onValueChange={setDefaultMeritTaxId}>
                <NativeSelectOption value="">No default</NativeSelectOption>
                {taxes.map((tax) => (
                  <NativeSelectOption key={tax.id} value={tax.id}>
                    {tax.name} · {tax.taxPct}%
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              {provider?.defaultMeritTaxSource === "merit-history" && provider.defaultMeritTaxSampleSize !== undefined && (
                <span className="field-hint">Learned from {provider.defaultMeritTaxSampleSize} recent Merit invoices. You can override it here.</span>
              )}
            </label>
            <label>
              Default account
              <Input value={defaultAccount} onChange={(event) => setDefaultAccount(event.target.value)} placeholder="Optional payout or spend account" />
            </label>
          </section>

          <section className="form-section" aria-labelledby="matching-details-heading">
            <div className="form-section-heading">
              <h3 id="matching-details-heading">Bank matching</h3>
              <p>Add names that appear on statements so future transactions match automatically.</p>
            </div>
            <label>
              Aliases
              <Textarea
                value={aliases}
                onChange={(event) => setAliases(event.target.value)}
                rows={3}
                placeholder="Comma-separated bank names, card merchant names, abbreviations"
              />
            </label>
          </section>
        </div>
        <div className="modal-actions provider-modal-footer">
          <Button type="button" className="secondary-button" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" className="primary-button" disabled={submitting || !name.trim()}>
            {submitting ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
            Save company
          </Button>
        </div>
      </form>
    </div>
  );
}

function RevenuePartnerModal({
  partner,
  initialProviderId,
  providers,
  teams,
  taxes,
  categories,
  onClose,
  onSubmit
}: {
  partner?: RevenuePartner;
  initialProviderId?: string;
  providers: Provider[];
  teams: Team[];
  taxes: MeritTax[];
  categories: TransactionCategory[];
  onClose: () => void;
  onSubmit: (payload: UpdateRevenuePartnerPayload) => Promise<void>;
}) {
  const initialProvider = providers.find((provider) => provider.id === (partner?.providerId ?? initialProviderId));
  const tunePartner = partner?.source === "tune" ? partner : undefined;
  const quinStreetPartner = partner?.source === "quinstreet" ? partner : undefined;
  const [name, setName] = useState(partner?.name ?? initialProvider?.name ?? "");
  const [source, setSource] = useState<RevenuePartner["source"]>(partner?.source ?? "tune");
  const [providerId, setProviderId] = useState(partner?.providerId ?? initialProviderId ?? "");
  const [teamId, setTeamId] = useState(partner?.teamId ?? "");
  const [revenueCategory, setRevenueCategory] = useState(partner?.revenueCategory ?? "Partner network revenue");
  const [affiliateId, setAffiliateId] = useState(tunePartner?.affiliateId ?? "");
  const [externalId, setExternalId] = useState(tunePartner?.externalId ?? "");
  const [publisherName, setPublisherName] = useState(quinStreetPartner?.publisherName ?? "");
  const [reportKeyEnv, setReportKeyEnv] = useState(quinStreetPartner?.reportKeyEnv ?? "QUINSTREET_QMP_REPORT_KEY");
  const [clientIdEnv, setClientIdEnv] = useState(quinStreetPartner?.clientIdEnv ?? "QUINSTREET_QMP_CLIENT_ID");
  const [clientSecretEnv, setClientSecretEnv] = useState(quinStreetPartner?.clientSecretEnv ?? "QUINSTREET_QMP_CLIENT_SECRET");
  const [revenueField, setRevenueField] = useState(quinStreetPartner?.revenueField ?? "total_earn");
  const [categoryField, setCategoryField] = useState(quinStreetPartner?.categoryField ?? "category");
  const [categoryValue, setCategoryValue] = useState(quinStreetPartner?.categoryValue ?? "");
  const [currency, setCurrency] = useState(partner?.currency ?? initialProvider?.defaultCurrency ?? "USD");
  const [timezone, setTimezone] = useState(partner?.timezone ?? "UTC");
  const [networkTimezone, setNetworkTimezone] = useState(tunePartner?.networkTimezone ?? "UTC");
  const [networkIdEnv, setNetworkIdEnv] = useState(tunePartner?.networkIdEnv ?? "");
  const [apiKeyEnv, setApiKeyEnv] = useState(tunePartner?.apiKeyEnv ?? "");
  const [apiBaseUrlEnv, setApiBaseUrlEnv] = useState(partner?.apiBaseUrlEnv ?? "");
  const [meritCustomerName, setMeritCustomerName] = useState(partner?.meritCustomerName ?? initialProvider?.legalName ?? initialProvider?.name ?? "");
  const [invoiceDueDays, setInvoiceDueDays] = useState(String(partner?.invoiceDueDays ?? initialProvider?.paymentTermsDays ?? 30));
  const [billingCadence, setBillingCadence] = useState(partner?.billingCadence ?? "weekly");
  const [billingTimezone, setBillingTimezone] = useState(partner?.billingTimezone ?? "Asia/Beirut");
  const [autoDraft, setAutoDraft] = useState(partner?.autoDraft ?? true);
  const [defaultMeritTaxId, setDefaultMeritTaxId] = useState(partner?.defaultMeritTaxId ?? "");
  const [defaultMeritItemCode, setDefaultMeritItemCode] = useState(partner?.defaultMeritItemCode ?? "");
  const [enabled, setEnabled] = useState(partner?.enabled ?? true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const common = {
        name,
        providerId,
        teamId: teamId || undefined,
        revenueCategory,
        currency,
        timezone,
        apiBaseUrlEnv: apiBaseUrlEnv.trim() || undefined,
        meritCustomerName: providers.find((provider) => provider.id === providerId)?.legalName
          ?? providers.find((provider) => provider.id === providerId)?.name,
        invoiceDueDays: Number(invoiceDueDays),
        billingCadence,
        billingTimezone,
        autoDraft,
        defaultMeritTaxId: defaultMeritTaxId || undefined,
        defaultMeritItemCode: defaultMeritItemCode.trim() || undefined,
        enabled
      };
      const payload: UpdateRevenuePartnerPayload = source === "tune"
        ? {
            ...common,
            source: "tune",
            affiliateId,
            externalId: externalId.trim() || undefined,
            networkTimezone,
            networkIdEnv,
            apiKeyEnv
          }
        : {
            ...common,
            source: "quinstreet",
            publisherName,
            reportKeyEnv,
            clientIdEnv,
            clientSecretEnv,
            revenueField,
            categoryField,
            categoryValue
          };
      await onSubmit(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Revenue partner could not be saved");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="modal wide-modal" role="dialog" aria-modal="true" aria-labelledby="revenue-rule-modal-title" onSubmit={handleSubmit}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Company revenue rule</p>
            <h2 id="revenue-rule-modal-title">{partner ? `Edit ${partner.name}` : `Add rule for ${initialProvider?.name ?? "client"}`}</h2>
          </div>
          <Button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </Button>
        </div>
        {error && <div className="inline-error">{error}</div>}
        <div className="form-grid">
          <label>
            Name
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            Source
            <NativeSelect value={source} onValueChange={(value) => setSource(value as RevenuePartner["source"])}>
              <NativeSelectOption value="tune">TUNE / HasOffers</NativeSelectOption>
              <NativeSelectOption value="quinstreet">QuinStreet QMP</NativeSelectOption>
            </NativeSelect>
          </label>
        </div>
        <div className="form-grid">
          <label>
            Company
            <NativeSelect
              value={providerId}
              onValueChange={(value) => {
                const nextProviderId = value;
                const nextProvider = providers.find((provider) => provider.id === nextProviderId);
                setProviderId(nextProviderId);
                if (nextProvider) {
                  setMeritCustomerName(nextProvider.legalName ?? nextProvider.name);
                  setCurrency(nextProvider.defaultCurrency ?? "USD");
                  setInvoiceDueDays(String(nextProvider.paymentTermsDays ?? 30));
                  if (!partner) setName(nextProvider.name);
                }
              }}
            >
              <NativeSelectOption value="">Choose a client</NativeSelectOption>
              {providers
                .filter((provider) => provider.type === "client")
                .map((provider) => (
                  <NativeSelectOption key={provider.id} value={provider.id}>
                    {provider.name}
                  </NativeSelectOption>
                ))}
            </NativeSelect>
          </label>
          <label>
            Owner
            <NativeSelect value={teamId} onValueChange={setTeamId}>
              <NativeSelectOption value="">No owner</NativeSelectOption>
              {teams.map((team) => (
                <NativeSelectOption key={team.id} value={team.id}>
                  {team.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
        </div>
        <label>
          Money in category
          <NativeSelect value={revenueCategory} onValueChange={setRevenueCategory}>
            {transactionCategoryOptionsForDirection("in", categories).map((category) => (
              <NativeSelectOption key={category} value={category}>
                {category}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <div className="form-grid">
          <label>
            Currency
            <Input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
          </label>
          <label>
            Timezone
            <NativeSelect value={timezone} onValueChange={setTimezone}>
              {timezoneOptions.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
        </div>
        {source === "tune" ? (
          <>
            <div className="form-grid">
              <label>
                Affiliate ID {teamId ? "" : "(optional)"}
                <Input value={affiliateId} onChange={(event) => setAffiliateId(event.target.value)} placeholder={teamId ? "Required for an owner-specific stream" : "Blank pulls the full company network"} />
              </label>
              <label>
                External ID
                <Input value={externalId} onChange={(event) => setExternalId(event.target.value)} />
              </label>
            </div>
            <div className="form-grid">
              <label>
                Network timezone
                <NativeSelect value={networkTimezone} onValueChange={setNetworkTimezone}>
                  {timezoneOptions.map((option) => (
                    <NativeSelectOption key={option.value} value={option.value}>{option.label}</NativeSelectOption>
                  ))}
                </NativeSelect>
              </label>
              <label>
                API base URL env
                <Input value={apiBaseUrlEnv} onChange={(event) => setApiBaseUrlEnv(event.target.value)} />
              </label>
            </div>
            <div className="form-grid">
              <label>
                Network ID env
                <Input value={networkIdEnv} onChange={(event) => setNetworkIdEnv(event.target.value)} />
              </label>
              <label>
                API key env
                <Input value={apiKeyEnv} onChange={(event) => setApiKeyEnv(event.target.value)} />
              </label>
            </div>
          </>
        ) : (
          <>
            <div className="form-grid">
              <label>
                Publisher name
                <Input value={publisherName} onChange={(event) => setPublisherName(event.target.value)} />
              </label>
              <label>
                Revenue column
                <Input value={revenueField} onChange={(event) => setRevenueField(event.target.value)} placeholder="total_earn" />
              </label>
            </div>
            <div className="form-grid">
              <label>
                Category column
                <Input value={categoryField} onChange={(event) => setCategoryField(event.target.value)} placeholder="category" />
              </label>
              <label>
                Category value
                <Input value={categoryValue} onChange={(event) => setCategoryValue(event.target.value)} placeholder="Auto Insurance" />
              </label>
            </div>
            <div className="form-grid">
              <label>
                Saved report key env
                <Input value={reportKeyEnv} onChange={(event) => setReportKeyEnv(event.target.value)} placeholder="QUINSTREET_QMP_REPORT_KEY" />
              </label>
              <label>
                Client ID env
                <Input value={clientIdEnv} onChange={(event) => setClientIdEnv(event.target.value)} />
              </label>
            </div>
            <div className="form-grid">
              <label>
                Client secret env
                <Input value={clientSecretEnv} onChange={(event) => setClientSecretEnv(event.target.value)} />
              </label>
              <label>
                API base URL env (optional)
                <Input value={apiBaseUrlEnv} onChange={(event) => setApiBaseUrlEnv(event.target.value)} />
              </label>
            </div>
          </>
        )}
        <div className="form-grid">
          <label>
            Merit customer
            <Input value={meritCustomerName} readOnly aria-readonly="true" />
          </label>
          <label>
            Invoice due days
            <Input type="number" min="0" step="1" value={invoiceDueDays} onChange={(event) => setInvoiceDueDays(event.target.value)} />
          </label>
        </div>
        <div className="revenue-rule-section">
          <div className="form-section-heading">
            <h3>Invoice creation rule</h3>
            <p>Controls when this revenue becomes a draft and the defaults used when it is sent to Merit.</p>
          </div>
          <div className="form-grid">
            <label>
              Billing cadence
              <NativeSelect value={billingCadence} onValueChange={(value) => setBillingCadence(value as "weekly" | "monthly")}>
                <NativeSelectOption value="weekly">Weekly · prior Monday–Sunday</NativeSelectOption>
                <NativeSelectOption value="monthly">Monthly · calendar month</NativeSelectOption>
              </NativeSelect>
            </label>
            <label>
              Billing timezone
              <NativeSelect value={billingTimezone} onValueChange={setBillingTimezone}>
                {timezoneOptions.map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>{option.label}</NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          </div>
          <div className="form-grid">
            <label>
              Default Merit tax
              <NativeSelect value={defaultMeritTaxId} onValueChange={setDefaultMeritTaxId}>
                <NativeSelectOption value="">Choose before sending</NativeSelectOption>
                {taxes.map((tax) => (
                  <NativeSelectOption key={tax.id} value={tax.id}>{tax.name} · {tax.taxPct}%</NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            <label>
              Default Merit item
              <Input value={defaultMeritItemCode} onChange={(event) => setDefaultMeritItemCode(event.target.value)} placeholder="Item code or description" />
            </label>
          </div>
          <label className="check-row modal-check-row">
            <Checkbox checked={autoDraft} onCheckedChange={(checked) => setAutoDraft(checked === true)} />
            Automatically prepare a dashboard draft when this billing period closes
          </label>
        </div>
        <label className="check-row modal-check-row">
          <Checkbox checked={enabled} onCheckedChange={(checked) => setEnabled(checked === true)} />
          Enabled
        </label>
        <div className="modal-actions">
          <Button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            className="primary-button"
            disabled={
              submitting ||
              !providerId ||
              !name.trim() ||
              (source === "tune" && Boolean(teamId) && !affiliateId.trim()) ||
              !revenueCategory.trim() ||
              !currency.trim() ||
              !timezone ||
              (source === "tune" && (!networkTimezone || !networkIdEnv.trim() || !apiKeyEnv.trim())) ||
              (source === "quinstreet" && (!publisherName.trim() || !reportKeyEnv.trim() || !clientIdEnv.trim() || !clientSecretEnv.trim() || !revenueField.trim() || !categoryField.trim() || !categoryValue.trim())) ||
              !Number.isFinite(Number(invoiceDueDays))
            }
          >
            {submitting ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
            {partner ? "Save rule" : "Add rule"}
          </Button>
        </div>
      </form>
    </div>
  );
}

export default App;
