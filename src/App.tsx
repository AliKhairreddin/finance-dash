import {
  ArrowDownRight,
  ArrowUpRight,
  BadgeDollarSign,
  Banknote,
  BarChart3,
  Building2,
  Check,
  CircleAlert,
  CircleDollarSign,
  FilePlus2,
  Filter,
  KeyRound,
  Link2,
  Loader2,
  Moon,
  Pencil,
  PieChart,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Tags,
  Trash2,
  Upload,
  WalletCards,
  X
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type {
  AiPromptPayload,
  AiPromptResult,
  AutoCategorizeTransactionsResult,
  CreateInvoicePayload,
  CreateProviderPayload,
  CreateTeamPayload,
  CurrencyTotals,
  DashboardSnapshot,
  ImportWiseStatementPayload,
  ImportWiseStatementResult,
  InvoiceDocumentType,
  Provider,
  ProviderType,
  RevenuePartner,
  RevenuePeriodPreset,
  SaveAiSettingsPayload,
  SyncRevenuePayload,
  Team,
  Transaction,
  UpdateProviderPayload,
  UpdateRevenuePartnerPayload
} from "../shared/types";
import { isReviewOnlyTransactionCategory, transactionBusinessCategory, transactionCategoryOptions } from "../shared/categories";
import { hasCurrencyTotals, sumCurrencyTotals } from "../shared/currencyTotals";
import { parseWiseStatementCsv } from "../shared/wiseStatements";

const apiBase = import.meta.env.VITE_API_BASE || "/api";
type ActiveTab = "overview" | "banking" | "categories" | "revenue" | "invoices" | "providers" | "settings";
type BankTab = "wise" | "revolut" | "slash";
type ThemeMode = "light" | "dark";
type SortDirection = "asc" | "desc";
type TransactionSortKey = "match" | "date" | "period" | "amount" | "category" | "counterparty";
type TransactionDescriptionToast = {
  title: string;
  description: string;
  left: number;
  top: number;
};
type DirectoryDeleteTarget =
  | { kind: "provider"; provider: Provider }
  | { kind: "revenue-partner"; partner: RevenuePartner };
const themeStorageKey = "finance-dash-theme";

const pageHeaderContent: Record<ActiveTab, { eyebrow: string; title: string }> = {
  overview: { eyebrow: "Finance operations", title: "Cash flow and open balance control" },
  banking: { eyebrow: "Banking", title: "Reconcile account activity" },
  categories: { eyebrow: "Categorization", title: "Review spend and revenue labels" },
  revenue: { eyebrow: "Revenue", title: "Pull, review, and invoice partner revenue" },
  invoices: { eyebrow: "Invoices", title: "Approval and payment control" },
  providers: { eyebrow: "Business directory", title: "Clients and suppliers" },
  settings: { eyebrow: "Configuration", title: "Teams, integrations, and AI" }
};

const openRouterModelOptions = [
  { label: "OpenRouter auto", value: "openrouter/auto" },
  { label: "Latest OpenAI flagship", value: "~openai/gpt-latest" },
  { label: "Claude Sonnet", value: "anthropic/claude-sonnet-4.5" },
  { label: "Gemini Pro", value: "google/gemini-2.5-pro" },
  { label: "Custom slug", value: "custom" }
];

const timezoneOptions = [
  { label: "GMT zero", value: "UTC" },
  { label: "Eastern Time", value: "America/New_York" },
  { label: "London", value: "Europe/London" },
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

function formatCurrencyTotals(totals: CurrencyTotals): string {
  const values = Object.entries(totals).sort(([left], [right]) => left.localeCompare(right));
  return values.length > 0 ? values.map(([currency, total]) => money(total, currency)).join(" · ") : "—";
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

function providerTagLabel(provider?: Provider): string {
  return provider?.tags.length ? provider.tags.join(" · ") : "No tags";
}

function providerTypeForTransaction(transaction: Pick<Transaction, "direction">): ProviderType {
  return transaction.direction === "in" ? "client" : "supplier";
}

function providerTypeForDocument(documentType: InvoiceDocumentType): ProviderType {
  return documentType === "sales_invoice" ? "client" : "supplier";
}

function companyTagOptions(providers: Provider[]): string[] {
  return [...new Set(providers.flatMap((provider) => provider.tags))].sort((left, right) => left.localeCompare(right));
}

function providerHasTag(provider: Provider | undefined, tag: string): boolean {
  return tag === "all" || Boolean(provider?.tags.some((item) => item === tag));
}

function effectiveCategory(transaction: Transaction): string {
  return transactionBusinessCategory(transaction.category);
}

function categoryNeedsReview(transaction: Transaction): boolean {
  return isReviewOnlyTransactionCategory(transaction.category);
}

function transactionNeedsCompanyReview(transaction: Transaction): boolean {
  return transaction.direction === "in" && (!transaction.matchedProviderId || (transaction.confidence ?? 0) < 0.86);
}

function transactionNeedsReview(transaction: Transaction): boolean {
  return categoryNeedsReview(transaction) || transactionNeedsCompanyReview(transaction);
}

function transactionCompanyStatus(transaction: Transaction): "Matched" | "Needs company match" | "Unmatched" {
  if (transaction.matchedProviderId) return "Matched";
  return transaction.direction === "in" ? "Needs company match" : "Unmatched";
}

function companyRollupStatus(transactions: Transaction[]): string {
  const needsCompany = transactions.some((transaction) => transactionCompanyStatus(transaction) === "Needs company match");
  const hasUnmatched = transactions.some((transaction) => transactionCompanyStatus(transaction) === "Unmatched");
  const needsCategory = transactions.some(categoryNeedsReview);

  if (needsCompany && needsCategory) return "Needs company and category";
  if (needsCompany) return "Needs company match";
  if (hasUnmatched && needsCategory) return "Unmatched, needs category";
  if (needsCategory) return "Needs category review";
  if (hasUnmatched) return "Unmatched";
  return "Matched";
}

function companyRollupStatusClass(status: string): "good" | "warning" | "" {
  if (status === "Matched") return "good";
  if (status.startsWith("Needs") || status.includes("needs")) return "warning";
  return "";
}

function transactionCategoryChoices(currentCategory: string): string[] {
  const current = transactionBusinessCategory(currentCategory);
  return transactionCategoryOptions.includes(current as (typeof transactionCategoryOptions)[number])
    ? [...transactionCategoryOptions]
    : [current, ...transactionCategoryOptions];
}

function formatTransactionGroups(rows: Transaction[]): string {
  return groupedTransactionMoney(rows) || "—";
}

function bankInvoiceName(transaction: Transaction): string {
  return transaction.counterparty || transaction.rawName;
}

function sourceLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function groupedTransactionMoney(rows: Transaction[], direction?: Transaction["direction"]): string {
  const visibleRows = direction ? rows.filter((row) => row.direction === direction) : rows;
  return formatCurrencyTotals(sumCurrencyTotals(visibleRows, (row) => row.amount));
}

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
  "#a1a1aa"
];

type CategoryPieSegment = {
  category: string;
  amount: number;
  count: number;
  color: string;
};

type CategoryPieGroup = {
  currency: string;
  total: number;
  segments: CategoryPieSegment[];
};

function categoryChartColor(category: string): string {
  let hash = 0;
  for (let index = 0; index < category.length; index += 1) {
    hash = (hash * 31 + category.charCodeAt(index)) % categoryChartPalette.length;
  }
  return categoryChartPalette[Math.abs(hash) % categoryChartPalette.length];
}

function categoryPieGroups(rows: Transaction[], direction: Transaction["direction"]): CategoryPieGroup[] {
  const totals = new Map<string, Map<string, { amount: number; count: number }>>();

  for (const transaction of rows) {
    if (transaction.direction !== direction) continue;
    const category = effectiveCategory(transaction);
    const currencyTotals = totals.get(transaction.currency) ?? new Map<string, { amount: number; count: number }>();
    const current = currencyTotals.get(category) ?? { amount: 0, count: 0 };
    currencyTotals.set(category, {
      amount: current.amount + transaction.amount,
      count: current.count + 1
    });
    totals.set(transaction.currency, currencyTotals);
  }

  return [...totals.entries()]
    .map(([currency, categoryTotals]) => {
      const sortedTotals = [...categoryTotals.entries()].sort(
        ([leftCategory, left], [rightCategory, right]) => right.amount - left.amount || leftCategory.localeCompare(rightCategory)
      );
      const segments = sortedTotals.map(([category, value]) => ({
        category,
        amount: value.amount,
        count: value.count,
        color: categoryChartColor(category)
      }));
      return {
        currency,
        total: segments.reduce((sum, segment) => sum + segment.amount, 0),
        segments
      };
    })
    .filter((group) => group.total > 0)
    .sort((left, right) => right.total - left.total || left.currency.localeCompare(right.currency));
}

function formatShare(amount: number, total: number): string {
  if (total <= 0) return "0%";
  const share = (amount / total) * 100;
  return share < 1 ? "<1%" : `${share.toFixed(0)}%`;
}

function transactionPeriod(transaction: Transaction): string {
  return transaction.date.slice(0, 7);
}

function compareTransactions(left: Transaction, right: Transaction, sortKey: TransactionSortKey): number {
  if (sortKey === "match") {
    return (left.confidence ?? 0) - (right.confidence ?? 0) || left.date.localeCompare(right.date);
  }

  if (sortKey === "date") {
    return left.date.localeCompare(right.date) || left.counterparty.localeCompare(right.counterparty);
  }

  if (sortKey === "period") {
    return transactionPeriod(left).localeCompare(transactionPeriod(right)) || left.date.localeCompare(right.date);
  }

  if (sortKey === "amount") {
    return left.amount - right.amount || left.date.localeCompare(right.date);
  }

  if (sortKey === "category") {
    return effectiveCategory(left).localeCompare(effectiveCategory(right)) || left.date.localeCompare(right.date);
  }

  return left.counterparty.localeCompare(right.counterparty) || left.date.localeCompare(right.date);
}

function sortTransactions(rows: Transaction[], sortKey: TransactionSortKey, direction: SortDirection): Transaction[] {
  return [...rows].sort((left, right) => {
    const result = compareTransactions(left, right, sortKey);
    return direction === "asc" ? result : -result;
  });
}

function detailToastPosition(event: React.MouseEvent<HTMLElement>): { left: number; top: number } {
  const viewportPadding = 16;
  const offset = 18;
  const toastWidth = Math.min(420, window.innerWidth - viewportPadding * 2);
  const toastMaxHeight = Math.min(260, window.innerHeight - viewportPadding * 2);
  const left =
    event.clientX + offset + toastWidth <= window.innerWidth - viewportPadding
      ? event.clientX + offset
      : Math.max(viewportPadding, event.clientX - toastWidth - offset);
  const top =
    event.clientY + offset + toastMaxHeight <= window.innerHeight - viewportPadding
      ? event.clientY + offset
      : Math.max(viewportPadding, event.clientY - toastMaxHeight - offset);

  return { left, top };
}

function App() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    return window.localStorage.getItem(themeStorageKey) === "dark" ? "dark" : "light";
  });
  const [dashboard, setDashboard] = useState<DashboardSnapshot | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("overview");
  const [bankTab, setBankTab] = useState<BankTab>("wise");
  const [wiseDirection, setWiseDirection] = useState<"in" | "out">("in");
  const [teamFilter, setTeamFilter] = useState("all");
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isImportingWise, setIsImportingWise] = useState(false);
  const [isCategorizing, setIsCategorizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [matchFilter, setMatchFilter] = useState("needs-review");
  const [transactionSortKey, setTransactionSortKey] = useState<TransactionSortKey>("date");
  const [transactionSortDirection, setTransactionSortDirection] = useState<SortDirection>("desc");
  const [invoiceTransaction, setInvoiceTransaction] = useState<Transaction | null>(null);
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [editingRevenuePartner, setEditingRevenuePartner] = useState<RevenuePartner | null>(null);
  const [directoryDeleteTarget, setDirectoryDeleteTarget] = useState<DirectoryDeleteTarget | null>(null);

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

  async function retryDashboard() {
    setIsLoading(true);
    try {
      await loadDashboard();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load dashboard");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadDashboard()
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not load dashboard"))
      .finally(() => setIsLoading(false));
  }, []);

  const providersById = useMemo(() => {
    const map = new Map<string, Provider>();
    for (const provider of dashboard?.providers ?? []) map.set(provider.id, provider);
    return map;
  }, [dashboard?.providers]);

  const teamsById = useMemo(() => {
    const map = new Map<string, Team>();
    for (const team of dashboard?.teams ?? []) map.set(team.id, team);
    return map;
  }, [dashboard?.teams]);

  const filteredTransactions = useMemo(() => {
    const rows = dashboard?.transactions ?? [];
    const query = searchTerm.trim().toLowerCase();
    const matchingRows = rows.filter((transaction) => {
      const provider = transaction.matchedProviderId ? providersById.get(transaction.matchedProviderId) : undefined;
      const team = transaction.teamId ? teamsById.get(transaction.teamId) : undefined;
      const matchesQuery =
        !query ||
        [transaction.counterparty, transaction.description, transaction.rawName, provider?.name ?? "", team?.name ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(query);
      const matchesStatus =
        matchFilter === "all" ||
        (matchFilter === "needs-review" && transactionNeedsReview(transaction)) ||
        (matchFilter === "matched" && !transactionNeedsReview(transaction));
      return matchesQuery && matchesStatus;
    });
    return sortTransactions(matchingRows, transactionSortKey, transactionSortDirection);
  }, [dashboard?.transactions, matchFilter, providersById, searchTerm, teamsById, transactionSortDirection, transactionSortKey]);

  const wiseTransactions = useMemo(
    () =>
      filteredTransactions.filter((transaction) => {
        const matchesDirection = transaction.source === "wise" && transaction.direction === wiseDirection;
        const matchesTeam =
          teamFilter === "all" ||
          (teamFilter === "unassigned" && !transaction.teamId) ||
          transaction.teamId === teamFilter;
        return matchesDirection && matchesTeam;
      }),
    [filteredTransactions, teamFilter, wiseDirection]
  );

  const wiseTeamSummary = useMemo(() => {
    const volume = sumCurrencyTotals(wiseTransactions, (transaction) => transaction.amount);
    const matched = wiseTransactions.filter((transaction) => transaction.matchedProviderId).length;
    const unassigned = wiseTransactions.filter((transaction) => !transaction.teamId).length;
    return { volume, count: wiseTransactions.length, matched, unassigned };
  }, [wiseTransactions]);

  const slashTransactions = useMemo(
    () => filteredTransactions.filter((transaction) => transaction.source === "slash"),
    [filteredTransactions]
  );

  const revolutTransactions = useMemo(
    () => filteredTransactions.filter((transaction) => transaction.source === "revolut"),
    [filteredTransactions]
  );

  async function syncNow() {
    setIsSyncing(true);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch(`${apiBase}/sync`, { method: "POST" });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.message || "Sync failed");
      }
      setDashboard((await response.json()) as DashboardSnapshot);
      setNotice("Sync complete. Connected integrations refreshed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setIsSyncing(false);
    }
  }

  async function importWiseStatements(files: FileList | null) {
    if (!files?.length) return;
    setIsImportingWise(true);
    setNotice(null);
    setError(null);
    try {
      let nextDashboard: DashboardSnapshot | null = dashboard;
      let importedFiles = 0;
      let processedTransactions = 0;
      let newTransactions = 0;
      let duplicateTransactions = 0;
      for (const file of Array.from(files)) {
        const text = await file.text();
        const parsedStatements = parseWiseStatementCsv(text, file.name);
        for (const parsed of parsedStatements) {
          const payload: ImportWiseStatementPayload = {
            ...parsed.metadata,
            transactions: parsed.transactions
          };
          const response = await fetch(`${apiBase}/wise/import-statement`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
          });
          if (!response.ok) {
            const body = await response.json();
            throw new Error(body.message || `${file.name} could not be imported`);
          }
          const result = (await response.json()) as ImportWiseStatementResult;
          nextDashboard = result.dashboard;
          processedTransactions += result.summary.processedTransactions;
          newTransactions += result.summary.newTransactions;
          duplicateTransactions += result.summary.duplicateTransactions;
        }
        importedFiles += 1;
      }
      if (nextDashboard) setDashboard(nextDashboard);
      setNotice(
        `Processed ${importedFiles} Wise statement CSV${importedFiles === 1 ? "" : "s"}: ${processedTransactions} transaction${
          processedTransactions === 1 ? "" : "s"
        }, ${newTransactions} new, ${duplicateTransactions} duplicate${duplicateTransactions === 1 ? "" : "s"}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wise statement import failed");
    } finally {
      setIsImportingWise(false);
    }
  }

  async function syncRevenue(payload: SyncRevenuePayload) {
    setNotice(null);
    setError(null);
    const response = await fetch(`${apiBase}/revenue/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const body = await response.json();
      throw new Error(body.message || "Revenue sync failed");
    }
    setDashboard((await response.json()) as DashboardSnapshot);
    setNotice(payload.createInvoices ? "Revenue pulled. Merit invoice creation was attempted for positive live revenue." : "Revenue pulled.");
  }

  async function matchTransaction(transaction: Transaction, providerId?: string) {
    const selectedProviderId = providerId || transaction.matchedProviderId;
    if (!selectedProviderId) {
      setError("Choose a company before saving the match.");
      return;
    }
    setError(null);
    const response = await fetch(`${apiBase}/matches`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        transactionId: transaction.id,
        providerId: selectedProviderId,
        invoiceId: transaction.matchedInvoiceId,
        rememberAlias: true
      })
    });
    if (!response.ok) {
      const body = await response.json();
      setError(body.message || "Match failed");
      return;
    }
    await loadDashboard();
    setNotice(`Saved company alias for ${transaction.counterparty}. Future rows will auto-match.`);
  }

  async function updateTransactionCategory(transaction: Transaction, category: string) {
    setError(null);
    const response = await fetch(`${apiBase}/transactions/${transaction.id}/category`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, rememberAlias: true })
    });
    if (!response.ok) {
      const body = await response.json();
      setError(body.message || "Category update failed");
      return;
    }
    await loadDashboard();
    setNotice(`Saved ${category} for ${transaction.counterparty}. Future similar rows can auto-categorize.`);
  }

  async function assignTransactionTeam(transaction: Transaction, teamId?: string) {
    setError(null);
    const response = await fetch(`${apiBase}/transactions/${transaction.id}/team`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamId: teamId || null })
    });
    if (!response.ok) {
      const body = await response.json();
      setError(body.message || "Team assignment failed");
      return;
    }
    await loadDashboard();
    setNotice(teamId ? `Assigned ${transaction.counterparty} to ${teamsById.get(teamId)?.name ?? "team"}.` : "Transaction team cleared.");
  }

  async function createTeam(payload: CreateTeamPayload) {
    const response = await fetch(`${apiBase}/teams`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const body = await response.json();
      throw new Error(body.message || "Team could not be created");
    }
    await loadDashboard();
    setNotice(`${payload.name.trim()} team added.`);
  }

  async function submitProvider(payload: CreateProviderPayload) {
    const response = await fetch(`${apiBase}/providers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const body = await response.json();
      throw new Error(body.message || "Provider could not be created");
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
      const body = await response.json();
      throw new Error(body.message || "Provider could not be saved");
    }
    await loadDashboard();
  }

  async function removeProvider(provider: Provider) {
    const response = await fetch(`${apiBase}/providers/${provider.id}`, { method: "DELETE" });
    if (!response.ok) {
      const body = await response.json();
      throw new Error(body.message || "Company could not be deleted");
    }
    await loadDashboard();
    setNotice(`${provider.name} deleted. Existing financial records were kept and company matches were cleared.`);
  }

  async function saveRevenuePartner(partnerId: string, payload: UpdateRevenuePartnerPayload) {
    const response = await fetch(`${apiBase}/revenue-partners/${partnerId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const body = await response.json();
      throw new Error(body.message || "Revenue partner could not be saved");
    }
    await loadDashboard();
  }

  async function removeRevenuePartner(partner: RevenuePartner) {
    const response = await fetch(`${apiBase}/revenue-partners/${partner.id}`, { method: "DELETE" });
    if (!response.ok) {
      const body = await response.json();
      throw new Error(body.message || "Revenue client could not be deleted");
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
      const body = await response.json();
      throw new Error(body.message || "AI settings could not be saved");
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
      const body = await response.json();
      throw new Error(body.message || "AI prompt failed");
    }
    return (await response.json()) as AiPromptResult;
  }

  async function autoCategorizeTransactions(transactionIds?: string[]) {
    setIsCategorizing(true);
    setNotice(null);
    setError(null);
    try {
      const response = await fetch(`${apiBase}/transactions/auto-categorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transactionIds, useAi: true })
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.message || "Auto-categorization failed");
      }
      const result = (await response.json()) as AutoCategorizeTransactionsResult;
      setDashboard(result.dashboard);
      setNotice(
        `Reviewed ${result.reviewed} row${result.reviewed === 1 ? "" : "s"}: ${result.semanticMatches} semantic, ${result.aiMatches} AI, ${result.categorizedOnly} category-only.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Auto-categorization failed");
    } finally {
      setIsCategorizing(false);
    }
  }

  async function submitInvoice(payload: CreateInvoicePayload) {
    const response = await fetch(`${apiBase}/invoices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const body = await response.json();
      throw new Error(body.message || "Document draft could not be created");
    }
    await loadDashboard();
    setNotice(payload.documentType === "sales_invoice" ? "Sales invoice draft created." : "Supplier bill draft recorded.");
  }

  async function updateInvoiceApproval(invoiceId: string, approvalStatus: "approved" | "denied") {
    const response = await fetch(`${apiBase}/invoices/${invoiceId}/approval`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approvalStatus })
    });
    if (!response.ok) {
      const body = await response.json();
      throw new Error(body.message || "Invoice approval could not be saved");
    }
    await loadDashboard();
    setNotice(`Invoice ${approvalStatus}.`);
  }

  async function markInvoicePaidLocally(invoiceId: string) {
    const response = await fetch(`${apiBase}/invoices/${invoiceId}/local-paid`, { method: "POST" });
    if (!response.ok) {
      const body = await response.json();
      throw new Error(body.message || "Invoice could not be marked paid locally");
    }
    await loadDashboard();
    setNotice("Marked paid in this dashboard only. Merit is unchanged for the accountant.");
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

  const hasCash = dashboard.accounts.length > 0;
  const hasReceivables = dashboard.receivables.length > 0;
  const hasOpenBalances = dashboard.openBalances.length > 0;
  const hasPayables = dashboard.payables.length > 0;
  const hasInvestments = dashboard.investments.length > 0;
  const hasProfit = hasCurrencyTotals(dashboard.metrics.profit);
  const profitTone = currencyTotalsTone(dashboard.metrics.profit);
  const wiseStatus = dashboard.integrationStatus.find((integration) => integration.id === "wise");
  const pageHeader = pageHeaderContent[activeTab];

  return (
    <main className="app-shell">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      <div className="main-column">
        <header className="topbar">
          <div>
            <p className="eyebrow">{pageHeader.eyebrow}</p>
            <h1>{pageHeader.title}</h1>
            <div className="meta-row">
              <span>Data as of: {maybeDate(dashboard.asOf)}</span>
              <span>Last sync: {maybeDate(dashboard.lastSync)}</span>
            </div>
          </div>
          <div className="topbar-actions">
            <ThemeToggle themeMode={themeMode} onToggle={toggleThemeMode} />
            <Button
              className="secondary-button"
              onClick={() => {
                setEditingProvider(null);
                setProviderModalOpen(true);
              }}
            >
              <Plus size={16} />
              Company
            </Button>
            <Button className="primary-button" onClick={syncNow} disabled={isSyncing}>
              {isSyncing ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
              Sync
            </Button>
          </div>
        </header>

        {(error || notice) && (
          <div className={error ? "toast error" : "toast"} role={error ? "alert" : "status"} aria-live={error ? "assertive" : "polite"}>
            {error ? <CircleAlert size={16} /> : <Check size={16} />}
            <span>{error || notice}</span>
            <Button aria-label="Dismiss" onClick={() => (error ? setError(null) : setNotice(null))}>
              <X size={14} />
            </Button>
          </div>
        )}

      {activeTab === "overview" && (
        <>
          <section className="metric-grid" aria-label="Finance summary">
            <MetricCard
              icon={<Banknote />}
              label="Cash in accounts"
              value={formatCurrencyTotals(dashboard.metrics.totalCash)}
              detail={hasCash ? "Connected bank and card accounts" : "No live account data"}
            />
            <MetricCard
              icon={<BadgeDollarSign />}
              label="Receivables"
              value={formatCurrencyTotals(dashboard.metrics.totalReceivables)}
              detail={hasReceivables ? "Live invoice and tax rows" : "No live receivables"}
            />
            <MetricCard
              icon={<WalletCards />}
              label="Open balance"
              value={formatCurrencyTotals(dashboard.metrics.totalOpenBalance)}
              detail={hasOpenBalances ? "Customer and provider balances" : "No live open balances"}
            />
            <MetricCard
              icon={<ArrowDownRight />}
              label="Payables"
              value={formatCurrencyTotals(dashboard.metrics.totalPayables)}
              detail={hasPayables ? "Unpaid platform/provider spend" : "No live payables"}
              danger
            />
            <MetricCard
              icon={<CircleDollarSign />}
              label="Profit"
              value={formatCurrencyTotals(dashboard.metrics.profit)}
              detail={hasProfit ? "Calculated from live operating rows" : "Waiting for operating rows"}
              good={profitTone === "good"}
              danger={profitTone === "danger"}
            />
            <MetricCard
              icon={<ShieldCheck />}
              label="Total assets"
              value={formatCurrencyTotals(dashboard.metrics.totalAssets)}
              detail={hasInvestments ? `${formatCurrencyTotals(dashboard.metrics.investments)} investments` : "No live investments"}
            />
          </section>
          <Overview dashboard={dashboard} providersById={providersById} onOpenInvoice={setInvoiceTransaction} onQuickMatch={matchTransaction} />
        </>
      )}

      {activeTab === "banking" && (
        <BankingView
          activeBankTab={bankTab}
          dashboard={dashboard}
          isCategorizing={isCategorizing}
          isImportingWise={isImportingWise}
          matchFilter={matchFilter}
          providersById={providersById}
          revolutTransactions={revolutTransactions}
          searchTerm={searchTerm}
          slashTransactions={slashTransactions}
          teamFilter={teamFilter}
          teamsById={teamsById}
          transactionSortDirection={transactionSortDirection}
          transactionSortKey={transactionSortKey}
          wiseDirection={wiseDirection}
          wiseStatusIssue={wiseStatus?.issue}
          wiseTeamSummary={wiseTeamSummary}
          wiseTransactions={wiseTransactions}
          onActiveBankTabChange={setBankTab}
          onAssignTeam={assignTransactionTeam}
          onAutoCategorize={autoCategorizeTransactions}
          onImportWiseStatements={importWiseStatements}
          onMatch={matchTransaction}
          onOpenInvoice={setInvoiceTransaction}
          onSearchTermChange={setSearchTerm}
          onSetMatchFilter={setMatchFilter}
          onSetTeamFilter={setTeamFilter}
          onSetTransactionSortDirection={setTransactionSortDirection}
          onSetTransactionSortKey={setTransactionSortKey}
          onSetWiseDirection={setWiseDirection}
          onUpdateCategory={updateTransactionCategory}
        />
      )}

      {activeTab === "categories" && (
        <CategorizationView
          dashboard={dashboard}
          providersById={providersById}
          isCategorizing={isCategorizing}
          onAutoCategorize={() => void autoCategorizeTransactions()}
        />
      )}

      {activeTab === "revenue" && (
        <RevenueView dashboard={dashboard} onSyncRevenue={syncRevenue} />
      )}

      {activeTab === "invoices" && (
        <InvoicesView
          dashboard={dashboard}
          providersById={providersById}
          onApprove={updateInvoiceApproval}
          onMarkPaid={markInvoicePaidLocally}
        />
      )}

      {activeTab === "providers" && (
        <ProvidersView
          providers={dashboard.providers}
          revenuePartners={dashboard.revenuePartners}
          onAdd={() => {
            setEditingProvider(null);
            setProviderModalOpen(true);
          }}
          onEditProvider={(provider) => {
            setEditingProvider(provider);
            setProviderModalOpen(true);
          }}
          onEditRevenuePartner={setEditingRevenuePartner}
          onDeleteProvider={(provider) => setDirectoryDeleteTarget({ kind: "provider", provider })}
          onDeleteRevenuePartner={(partner) => setDirectoryDeleteTarget({ kind: "revenue-partner", partner })}
        />
      )}

      {activeTab === "settings" && (
        <SettingsView dashboard={dashboard} onCreateTeam={createTeam} onSaveAiSettings={saveAiSettings} onRunAiPrompt={runAiPrompt} />
      )}

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

      {providerModalOpen && (
        <ProviderModal
          provider={editingProvider ?? undefined}
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
      {editingRevenuePartner && (
        <RevenuePartnerModal
          partner={editingRevenuePartner}
          onClose={() => setEditingRevenuePartner(null)}
          onSubmit={async (payload) => {
            await saveRevenuePartner(editingRevenuePartner.id, payload);
            setEditingRevenuePartner(null);
            setNotice("Revenue partner saved.");
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

function Sidebar({
  activeTab,
  setActiveTab
}: {
  activeTab: ActiveTab;
  setActiveTab: React.Dispatch<React.SetStateAction<ActiveTab>>;
}) {
  const items: Array<{ id: ActiveTab; label: string; icon: React.ReactNode }> = [
    { id: "overview", label: "Overview", icon: <SlidersHorizontal size={17} /> },
    { id: "banking", label: "Banking", icon: <Banknote size={17} /> },
    { id: "categories", label: "Categories", icon: <PieChart size={17} /> },
    { id: "revenue", label: "Revenue", icon: <BarChart3 size={17} /> },
    { id: "invoices", label: "Invoices", icon: <FilePlus2 size={17} /> },
    { id: "providers", label: "Companies", icon: <Tags size={17} /> },
    { id: "settings", label: "Settings", icon: <Settings size={17} /> }
  ];

  return (
    <aside className="sidebar" aria-label="Finance dashboard navigation">
      <div className="sidebar-brand">
        <Banknote size={19} />
        <strong>Finance</strong>
      </div>
      <nav className="sidebar-nav">
        {items.map((item) => (
          <Button
            key={item.id}
            className={activeTab === item.id ? "active" : ""}
            onClick={() => setActiveTab(item.id)}
            aria-current={activeTab === item.id ? "page" : undefined}
            title={item.label}
          >
            {item.icon}
            <span>{item.label}</span>
          </Button>
        ))}
      </nav>
    </aside>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  danger,
  good
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  danger?: boolean;
  good?: boolean;
}) {
  return (
    <article className={`metric-card ${danger ? "danger" : ""} ${good ? "good" : ""}`}>
      <div className="metric-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}

function BankingView({
  activeBankTab,
  dashboard,
  isCategorizing,
  isImportingWise,
  matchFilter,
  providersById,
  revolutTransactions,
  searchTerm,
  slashTransactions,
  teamFilter,
  teamsById,
  transactionSortDirection,
  transactionSortKey,
  wiseDirection,
  wiseStatusIssue,
  wiseTeamSummary,
  wiseTransactions,
  onActiveBankTabChange,
  onAssignTeam,
  onAutoCategorize,
  onImportWiseStatements,
  onMatch,
  onOpenInvoice,
  onSearchTermChange,
  onSetMatchFilter,
  onSetTeamFilter,
  onSetTransactionSortDirection,
  onSetTransactionSortKey,
  onSetWiseDirection,
  onUpdateCategory
}: {
  activeBankTab: BankTab;
  dashboard: DashboardSnapshot;
  isCategorizing: boolean;
  isImportingWise: boolean;
  matchFilter: string;
  providersById: Map<string, Provider>;
  revolutTransactions: Transaction[];
  searchTerm: string;
  slashTransactions: Transaction[];
  teamFilter: string;
  teamsById: Map<string, Team>;
  transactionSortDirection: SortDirection;
  transactionSortKey: TransactionSortKey;
  wiseDirection: "in" | "out";
  wiseStatusIssue?: string;
  wiseTeamSummary: { volume: CurrencyTotals; count: number; matched: number; unassigned: number };
  wiseTransactions: Transaction[];
  onActiveBankTabChange: React.Dispatch<React.SetStateAction<BankTab>>;
  onAssignTeam: (transaction: Transaction, teamId?: string) => Promise<void>;
  onAutoCategorize: (transactionIds?: string[]) => Promise<void>;
  onImportWiseStatements: (files: FileList | null) => Promise<void>;
  onMatch: (transaction: Transaction, providerId?: string) => Promise<void>;
  onOpenInvoice: (transaction: Transaction) => void;
  onSearchTermChange: React.Dispatch<React.SetStateAction<string>>;
  onSetMatchFilter: React.Dispatch<React.SetStateAction<string>>;
  onSetTeamFilter: React.Dispatch<React.SetStateAction<string>>;
  onSetTransactionSortDirection: React.Dispatch<React.SetStateAction<SortDirection>>;
  onSetTransactionSortKey: React.Dispatch<React.SetStateAction<TransactionSortKey>>;
  onSetWiseDirection: React.Dispatch<React.SetStateAction<"in" | "out">>;
  onUpdateCategory: (transaction: Transaction, category: string) => Promise<void>;
}) {
  return (
    <Tabs
      className="banking-page"
      value={activeBankTab}
      onValueChange={(value) => onActiveBankTabChange(value as BankTab)}
    >
      <div className="banking-page-header">
        <div>
          <p className="eyebrow">Banking</p>
          <h2>Bank accounts, cards, and reconciliation</h2>
        </div>
        <TabsList className="banking-tabs-list">
          <TabsTrigger value="wise">
            <Link2 size={15} />
            Wise
            <span>{wiseTeamSummary.count}</span>
          </TabsTrigger>
          <TabsTrigger value="revolut">
            <Banknote size={15} />
            Revolut
            <span>{revolutTransactions.length}</span>
          </TabsTrigger>
          <TabsTrigger value="slash">
            <WalletCards size={15} />
            Slash
            <span>{slashTransactions.length}</span>
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="wise">
        <WiseBankingTab
          dashboard={dashboard}
          isCategorizing={isCategorizing}
          isImportingWise={isImportingWise}
          matchFilter={matchFilter}
          providersById={providersById}
          searchTerm={searchTerm}
          teamFilter={teamFilter}
          teamsById={teamsById}
          transactionSortDirection={transactionSortDirection}
          transactionSortKey={transactionSortKey}
          wiseDirection={wiseDirection}
          wiseStatusIssue={wiseStatusIssue}
          wiseTeamSummary={wiseTeamSummary}
          wiseTransactions={wiseTransactions}
          onAssignTeam={onAssignTeam}
          onAutoCategorize={onAutoCategorize}
          onImportWiseStatements={onImportWiseStatements}
          onMatch={onMatch}
          onOpenInvoice={onOpenInvoice}
          onSearchTermChange={onSearchTermChange}
          onSetMatchFilter={onSetMatchFilter}
          onSetTeamFilter={onSetTeamFilter}
          onSetTransactionSortDirection={onSetTransactionSortDirection}
          onSetTransactionSortKey={onSetTransactionSortKey}
          onSetWiseDirection={onSetWiseDirection}
          onUpdateCategory={onUpdateCategory}
        />
      </TabsContent>
      <TabsContent value="revolut">
        <RevolutView dashboard={dashboard} rows={revolutTransactions} />
      </TabsContent>
      <TabsContent value="slash">
        <SlashView dashboard={dashboard} rows={slashTransactions} />
      </TabsContent>
    </Tabs>
  );
}

function WiseBankingTab({
  dashboard,
  isCategorizing,
  isImportingWise,
  matchFilter,
  providersById,
  searchTerm,
  teamFilter,
  teamsById,
  transactionSortDirection,
  transactionSortKey,
  wiseDirection,
  wiseStatusIssue,
  wiseTeamSummary,
  wiseTransactions,
  onAssignTeam,
  onAutoCategorize,
  onImportWiseStatements,
  onMatch,
  onOpenInvoice,
  onSearchTermChange,
  onSetMatchFilter,
  onSetTeamFilter,
  onSetTransactionSortDirection,
  onSetTransactionSortKey,
  onSetWiseDirection,
  onUpdateCategory
}: {
  dashboard: DashboardSnapshot;
  isCategorizing: boolean;
  isImportingWise: boolean;
  matchFilter: string;
  providersById: Map<string, Provider>;
  searchTerm: string;
  teamFilter: string;
  teamsById: Map<string, Team>;
  transactionSortDirection: SortDirection;
  transactionSortKey: TransactionSortKey;
  wiseDirection: "in" | "out";
  wiseStatusIssue?: string;
  wiseTeamSummary: { volume: CurrencyTotals; count: number; matched: number; unassigned: number };
  wiseTransactions: Transaction[];
  onAssignTeam: (transaction: Transaction, teamId?: string) => Promise<void>;
  onAutoCategorize: (transactionIds?: string[]) => Promise<void>;
  onImportWiseStatements: (files: FileList | null) => Promise<void>;
  onMatch: (transaction: Transaction, providerId?: string) => Promise<void>;
  onOpenInvoice: (transaction: Transaction) => void;
  onSearchTermChange: React.Dispatch<React.SetStateAction<string>>;
  onSetMatchFilter: React.Dispatch<React.SetStateAction<string>>;
  onSetTeamFilter: React.Dispatch<React.SetStateAction<string>>;
  onSetTransactionSortDirection: React.Dispatch<React.SetStateAction<SortDirection>>;
  onSetTransactionSortKey: React.Dispatch<React.SetStateAction<TransactionSortKey>>;
  onSetWiseDirection: React.Dispatch<React.SetStateAction<"in" | "out">>;
  onUpdateCategory: (transaction: Transaction, category: string) => Promise<void>;
}) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Wise reconciliation</p>
          <h2>Match incoming payments and outgoing spend</h2>
        </div>
        <div className="filters">
          <div className="segmented-control" aria-label="Wise transaction direction">
            <Button className={wiseDirection === "in" ? "active" : ""} onClick={() => onSetWiseDirection("in")}>
              <ArrowUpRight size={15} />
              In
            </Button>
            <Button className={wiseDirection === "out" ? "active" : ""} onClick={() => onSetWiseDirection("out")}>
              <ArrowDownRight size={15} />
              Out
            </Button>
          </div>
          <label className="search-box">
            <Search size={15} />
            <Input value={searchTerm} onChange={(event) => onSearchTermChange(event.target.value)} placeholder="Search transactions" />
          </label>
          <label>
            <Filter size={15} />
            <NativeSelect value={matchFilter} onChange={(event) => onSetMatchFilter(event.target.value)}>
              <NativeSelectOption value="needs-review">Needs review</NativeSelectOption>
              <NativeSelectOption value="matched">Matched</NativeSelectOption>
              <NativeSelectOption value="all">All rows</NativeSelectOption>
            </NativeSelect>
          </label>
          <label>
            <SlidersHorizontal size={15} />
            <NativeSelect value={transactionSortKey} onChange={(event) => onSetTransactionSortKey(event.target.value as TransactionSortKey)}>
              <NativeSelectOption value="match">% match</NativeSelectOption>
              <NativeSelectOption value="date">Date</NativeSelectOption>
              <NativeSelectOption value="period">Period</NativeSelectOption>
              <NativeSelectOption value="amount">Amount</NativeSelectOption>
              <NativeSelectOption value="category">Category</NativeSelectOption>
              <NativeSelectOption value="counterparty">Counterparty</NativeSelectOption>
            </NativeSelect>
          </label>
          <label>
            Order
            <NativeSelect value={transactionSortDirection} onChange={(event) => onSetTransactionSortDirection(event.target.value as SortDirection)}>
              <NativeSelectOption value="desc">Descending</NativeSelectOption>
              <NativeSelectOption value="asc">Ascending</NativeSelectOption>
            </NativeSelect>
          </label>
          <label>
            Team
            <NativeSelect value={teamFilter} onChange={(event) => onSetTeamFilter(event.target.value)}>
              <NativeSelectOption value="all">All teams</NativeSelectOption>
              <NativeSelectOption value="unassigned">Unassigned</NativeSelectOption>
              {dashboard.teams.map((team) => (
                <NativeSelectOption key={team.id} value={team.id}>
                  {team.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <Button
            className="secondary-button"
            onClick={() => void onAutoCategorize(wiseTransactions.map((transaction) => transaction.id))}
            disabled={isCategorizing || wiseTransactions.length === 0}
          >
            {isCategorizing ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
            Auto
          </Button>
          <label className={`secondary-button file-button ${isImportingWise ? "busy" : ""}`}>
            {isImportingWise ? <Loader2 className="spin" size={16} /> : <Upload size={16} />}
            CSV
            <Input
              type="file"
              accept=".csv,text/csv"
              multiple
              disabled={isImportingWise}
              onChange={(event) => {
                void onImportWiseStatements(event.target.files);
                event.target.value = "";
              }}
            />
          </label>
        </div>
      </div>
      <div className="wise-summary-grid">
        <SummaryTile label="Visible volume" value={formatCurrencyTotals(wiseTeamSummary.volume)} />
        <SummaryTile label="Transactions" value={String(wiseTeamSummary.count)} />
        <SummaryTile label="Matched rows" value={String(wiseTeamSummary.matched)} />
        <SummaryTile label="No team" value={String(wiseTeamSummary.unassigned)} />
      </div>
      {wiseStatusIssue && (
        <div className="integration-alert">
          <CircleAlert size={16} />
          <span>{wiseStatusIssue}</span>
        </div>
      )}
      <TransactionTable
        rows={wiseTransactions}
        teams={dashboard.teams}
        providers={dashboard.providers}
        teamsById={teamsById}
        providersById={providersById}
        onMatch={onMatch}
        onAssignTeam={onAssignTeam}
        onUpdateCategory={onUpdateCategory}
        onOpenInvoice={onOpenInvoice}
      />
    </section>
  );
}

function Overview({
  dashboard,
  providersById,
  onOpenInvoice,
  onQuickMatch
}: {
  dashboard: DashboardSnapshot;
  providersById: Map<string, Provider>;
  onOpenInvoice: (transaction: Transaction) => void;
  onQuickMatch: (transaction: Transaction, providerId?: string) => void;
}) {
  const reviewRows = dashboard.transactions.filter((transaction) => !transaction.matchedProviderId || (transaction.confidence ?? 0) < 0.86).slice(0, 5);
  const payableMonths = Array.from(new Set(dashboard.payables.flatMap((payable) => Object.keys(payable.monthBuckets))));
  const hasCash = dashboard.accounts.length > 0;
  const hasReceivables = dashboard.receivables.length > 0;
  const hasOpenBalances = dashboard.openBalances.length > 0;
  const hasPayables = dashboard.payables.length > 0;
  const hasInvestments = dashboard.investments.length > 0;
  const hasCompleteFloat = hasCash && hasReceivables && hasOpenBalances;
  const profitTone = currencyTotalsTone(dashboard.metrics.profit);
  const assetsTone = currencyTotalsTone(dashboard.metrics.totalAssets);

  return (
    <div className="overview-grid">
      <section className="panel">
        <div className="panel-header compact">
          <h2>Cash in accounts</h2>
          <span className="total-pill">{formatCurrencyTotals(dashboard.metrics.totalCash)}</span>
        </div>
        <SimpleMoneyTable
          nameLabel="Account"
          rows={dashboard.accounts.map((item) => ({
            id: item.id,
            name: item.name,
            amount: item.balance,
            currency: item.currency,
            source: sourceLabel(item.source)
          }))}
          emptyLabel="No live account data"
        />
      </section>

      <section className="panel">
        <div className="panel-header compact">
          <h2>Receivables</h2>
          <span className="total-pill">{formatCurrencyTotals(dashboard.metrics.totalReceivables)}</span>
        </div>
        <SimpleMoneyTable
          nameLabel="Name"
          rows={dashboard.receivables.map((item) => ({
            id: item.id,
            name: item.name,
            amount: item.balance,
            currency: item.currency,
            source: sourceLabel(item.source)
          }))}
          emptyLabel="No live receivables"
        />
      </section>

      <section className="panel tall">
        <div className="panel-header compact">
          <h2>Open balance</h2>
          <span className="total-pill">{formatCurrencyTotals(dashboard.metrics.totalOpenBalance)}</span>
        </div>
        <SimpleMoneyTable
          nameLabel="Name"
          rows={dashboard.openBalances.map((item) => ({
            id: item.id,
            name: item.name,
            amount: item.balance,
            currency: item.currency,
            source: sourceLabel(item.source)
          }))}
          emptyLabel="No live open balances"
          dense
        />
      </section>

      <section className="panel wide">
        <div className="panel-header compact">
          <h2>Payables by supplier and month</h2>
          <span className="total-pill danger">{formatCurrencyTotals(dashboard.metrics.totalPayables)}</span>
        </div>
        <div className="table-wrap">
          <table className="data-table payables-table">
            <thead>
              <tr>
                <th>Supplier / platform</th>
                <th>Balance</th>
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
                  <td colSpan={2 + payableMonths.length}>No live payables</td>
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

      <section className="panel">
        <div className="panel-header compact">
          <h2>Assets bridge</h2>
          <span className={`total-pill ${assetsTone}`}>{formatCurrencyTotals(dashboard.metrics.totalAssets)}</span>
        </div>
        <div className="bridge">
          <BridgeRow label="Cash" value={dashboard.metrics.totalCash} />
          <BridgeRow label="Receivables" value={dashboard.metrics.totalReceivables} />
          <BridgeRow label="Open balance" value={dashboard.metrics.totalOpenBalance} />
          <BridgeRow label="Cash + receivables + open balance" value={hasCompleteFloat ? dashboard.metrics.totalFloat : {}} />
          <BridgeRow label="Spend without payment" value={hasPayables ? negateCurrencyTotals(dashboard.metrics.totalPayables) : {}} danger />
          <BridgeRow
            label="Profit"
            value={dashboard.metrics.profit}
            good={profitTone === "good"}
            danger={profitTone === "danger"}
          />
          <BridgeRow label="Investments" value={dashboard.metrics.investments} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-header compact">
          <h2>Growth checks</h2>
          <span className="total-pill">—</span>
        </div>
        <div className="growth-list">
          <GrowthItem label="Cash growth vs last week" />
          <GrowthItem label="Spend growth vs last week" danger />
          <GrowthItem label="Profit growth vs last week" />
        </div>
      </section>

      <section className="panel wide">
        <div className="panel-header compact">
          <h2>Needs review</h2>
          <span className="total-pill">{reviewRows.length} rows</span>
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
                    <strong>{transaction.counterparty}</strong>
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
            <div className="empty-state">No live transactions needing review</div>
          )}
        </div>
      </section>
    </div>
  );
}

function CategorizationView({
  dashboard,
  providersById,
  isCategorizing,
  onAutoCategorize
}: {
  dashboard: DashboardSnapshot;
  providersById: Map<string, Provider>;
  isCategorizing: boolean;
  onAutoCategorize: () => void;
}) {
  const [tagFilter, setTagFilter] = useState("all");
  const tagOptions = useMemo(() => companyTagOptions(dashboard.providers), [dashboard.providers]);

  useEffect(() => {
    if (tagFilter !== "all" && !tagOptions.includes(tagFilter)) {
      setTagFilter("all");
    }
  }, [tagFilter, tagOptions]);

  const rows = dashboard.transactions.filter((transaction) => {
    const provider = transaction.matchedProviderId ? providersById.get(transaction.matchedProviderId) : undefined;
    return providerHasTag(provider, tagFilter);
  });
  const needsReview = rows.filter(transactionNeedsReview);

  const categoryRows = [...rows.reduce((map, transaction) => {
    const category = effectiveCategory(transaction);
    map.set(category, [...(map.get(category) ?? []), transaction]);
    return map;
  }, new Map<string, Transaction[]>())]
    .map(([category, transactions]) => ({
      category,
      transactions,
      matched: transactions.filter((transaction) => transaction.matchedProviderId).length,
      companies: [
        ...new Set(
          transactions
            .map((transaction) => (transaction.matchedProviderId ? providersById.get(transaction.matchedProviderId)?.name : undefined))
            .filter(Boolean)
        )
      ] as string[]
    }))
    .sort((left, right) => right.transactions.length - left.transactions.length || left.category.localeCompare(right.category));

  const spendPieGroups = categoryPieGroups(rows, "out");
  const revenuePieGroups = categoryPieGroups(rows, "in");

  const relationshipRows = [...rows.reduce((map, transaction) => {
    const provider = transaction.matchedProviderId ? providersById.get(transaction.matchedProviderId) : undefined;
    const label = provider ? providerTypeLabel(provider.type) : "Unknown";
    map.set(label, [...(map.get(label) ?? []), transaction]);
    return map;
  }, new Map<string, Transaction[]>())].sort(([left], [right]) => left.localeCompare(right));

  const companyRows = [...rows.reduce((map, transaction) => {
    const provider = transaction.matchedProviderId ? providersById.get(transaction.matchedProviderId) : undefined;
    const category = effectiveCategory(transaction);
    const key = provider?.id ?? `unmatched-${category}`;
    const existing = map.get(key) ?? {
      id: key,
      name: provider?.name ?? "Unmatched counterparty",
      relationship: provider ? providerTypeLabel(provider.type) : "Unknown",
      category,
      transactions: [] as Transaction[]
    };
    existing.transactions.push(transaction);
    map.set(key, existing);
    return map;
  }, new Map<string, { id: string; name: string; relationship: string; category: string; transactions: Transaction[] }>())]
    .map(([, value]) => ({
      ...value,
      status: companyRollupStatus(value.transactions)
    }))
    .sort((left, right) => right.transactions.length - left.transactions.length || left.name.localeCompare(right.name));

  return (
    <div className="categorization-layout">
      <section className="panel wide-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Categorization</p>
            <h2>Money in, money out, clients, suppliers, tags, and review load</h2>
          </div>
          <div className="filters">
            <label>
              <Tags size={15} />
              <NativeSelect value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}>
                <NativeSelectOption value="all">All tags</NativeSelectOption>
                {tagOptions.map((tag) => (
                  <NativeSelectOption key={tag} value={tag}>
                    {tag}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            <Button className="secondary-button" onClick={onAutoCategorize} disabled={isCategorizing || dashboard.transactions.length === 0}>
              {isCategorizing ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
              Auto
            </Button>
          </div>
        </div>
        <div className="wise-summary-grid categorization-summary">
          <SummaryTile label="Money in" value={groupedTransactionMoney(rows, "in")} />
          <SummaryTile label="Money out" value={groupedTransactionMoney(rows, "out")} />
          <SummaryTile label="Categories" value={String(categoryRows.length)} />
          <SummaryTile label="Needs review" value={String(needsReview.length)} />
        </div>
      </section>

      <CategoryPiePanel title="Spend pie" tone="danger" groups={spendPieGroups} emptyLabel="No spend transactions yet" />
      <CategoryPiePanel title="Revenue pie" tone="good" groups={revenuePieGroups} emptyLabel="No revenue transactions yet" />

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
                <th>Companies</th>
              </tr>
            </thead>
            <tbody>
              {categoryRows.length > 0 ? (
                categoryRows.map((row) => (
                  <tr key={row.category}>
                    <td>
                      <strong>{row.category}</strong>
                    </td>
                    <td>{row.transactions.length}</td>
                    <td>{row.matched}</td>
                    <td className="amount good-text">{formatTransactionGroups(row.transactions.filter((transaction) => transaction.direction === "in"))}</td>
                    <td className="amount danger-text">{formatTransactionGroups(row.transactions.filter((transaction) => transaction.direction === "out"))}</td>
                    <td className="company-list-cell">{row.companies.slice(0, 5).join(" · ") || "Unmatched"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6}>No categorized transactions yet</td>
                </tr>
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
          {relationshipRows.map(([relationship, transactions]) => (
            <div className="bridge-row" key={relationship}>
              <span>{relationship}</span>
              <strong>{transactions.length}</strong>
              <small>In {groupedTransactionMoney(transactions, "in")} · Out {groupedTransactionMoney(transactions, "out")}</small>
            </div>
          ))}
          {relationshipRows.length === 0 && <div className="money-empty">No company relationships yet</div>}
        </div>
      </section>

      <section className="panel">
        <div className="panel-header compact">
          <h2>Needs review</h2>
          <span className="total-pill warning">{needsReview.length} rows</span>
        </div>
        <div className="review-list compact-review-list">
          {needsReview.slice(0, 8).map((transaction) => (
            <article className="review-row" key={transaction.id}>
              <div className={`direction-badge ${transaction.direction}`}>
                {transaction.direction === "in" ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
              </div>
              <div>
                <strong>{transaction.counterparty}</strong>
                <span>{effectiveCategory(transaction)} · {transaction.matchReason ?? "Needs review"}</span>
              </div>
              <div className="review-amount">{money(transaction.amount, transaction.currency)}</div>
            </article>
          ))}
          {needsReview.length === 0 && <div className="empty-state">No transaction rows need review</div>}
        </div>
      </section>

      <section className="panel wide-panel">
        <div className="panel-header compact">
          <h2>Company rollup</h2>
          <span className="total-pill">{companyRows.length} rows</span>
        </div>
        <div className="table-wrap">
          <table className="data-table rollup-table">
            <thead>
              <tr>
                <th>Company</th>
                <th title="Business relationship to your company">Relationship</th>
                <th>Transaction category</th>
                <th>Match status</th>
                <th>Transactions</th>
                <th>Money in</th>
                <th>Money out</th>
              </tr>
            </thead>
            <tbody>
              {companyRows.length > 0 ? (
                companyRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.name}</strong>
                    </td>
                    <td>{row.relationship}</td>
                    <td>{row.category}</td>
                    <td>
                      <span className={`status-pill ${companyRollupStatusClass(row.status)}`}>{row.status}</span>
                    </td>
                    <td>{row.transactions.length}</td>
                    <td className="amount good-text">{groupedTransactionMoney(row.transactions, "in")}</td>
                    <td className="amount danger-text">{groupedTransactionMoney(row.transactions, "out")}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7}>No company rollup yet</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function CategoryPiePanel({
  title,
  tone,
  groups,
  emptyLabel
}: {
  title: string;
  tone: "good" | "danger";
  groups: CategoryPieGroup[];
  emptyLabel: string;
}) {
  const totalLabel = groups.length > 0 ? groups.map((group) => money(group.total, group.currency)).join(" · ") : "—";

  return (
    <section className={`panel category-chart-panel ${tone}`}>
      <div className="panel-header compact">
        <h2>{title}</h2>
        <span className={`total-pill ${tone}`}>{totalLabel}</span>
      </div>
      <div className="category-chart-body">
        {groups.length > 0 ? (
          groups.map((group) => <CategoryPieGroupView group={group} key={group.currency} />)
        ) : (
          <div className="money-empty">{emptyLabel}</div>
        )}
      </div>
    </section>
  );
}

function CategoryPieGroupView({ group }: { group: CategoryPieGroup }) {
  return (
    <div className="category-pie-group">
      <div className="category-pie-visual">
        <CategoryPieSvg group={group} />
        <div className="pie-center">
          <span>{group.currency}</span>
          <strong>{compactMoney(group.total, group.currency)}</strong>
        </div>
      </div>
      <div className="category-legend" aria-label={`${group.currency} category share`}>
        {group.segments.map((segment) => (
          <div className="category-legend-row" key={segment.category}>
            <span className="legend-swatch" style={{ backgroundColor: segment.color }} />
            <span className="legend-name" title={segment.category}>{segment.category}</span>
            <strong>{money(segment.amount, group.currency)}</strong>
            <small>{formatShare(segment.amount, group.total)}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function CategoryPieSvg({ group }: { group: CategoryPieGroup }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <svg className="category-pie-svg" viewBox="0 0 120 120" role="img" aria-label={`${group.currency} categories`}>
      <circle className="pie-track" cx="60" cy="60" r={radius} />
      {group.segments.map((segment) => {
        const dash = group.total > 0 ? (segment.amount / group.total) * circumference : 0;
        const strokeDasharray = group.segments.length === 1 ? `${circumference} 0` : `${dash} ${circumference - dash}`;
        const strokeDashoffset = -offset;
        offset += dash;
        return (
          <circle
            className="pie-segment"
            cx="60"
            cy="60"
            r={radius}
            key={segment.category}
            stroke={segment.color}
            strokeDasharray={strokeDasharray}
            strokeDashoffset={strokeDashoffset}
          >
            <title>
              {segment.category}: {money(segment.amount, group.currency)} ({formatShare(segment.amount, group.total)})
            </title>
          </circle>
        );
      })}
    </svg>
  );
}

function SimpleMoneyTable({
  rows,
  dense,
  emptyLabel = "No live rows",
  nameLabel = "Account"
}: {
  rows: Array<{ id: string; name: string; amount: number; currency: string; source: string }>;
  dense?: boolean;
  emptyLabel?: string;
  nameLabel?: string;
}) {
  return (
    <div className={`money-list ${dense ? "dense" : ""}`}>
      <div className="money-row money-head">
        <span>{nameLabel}</span>
        <span>Source</span>
        <span>Balance</span>
      </div>
      {rows.length > 0 ? (
        rows.map((row) => (
          <div className="money-row" key={row.id}>
            <span className="money-name" title={row.name}>
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

function BridgeRow({ label, value, danger, good }: { label: string; value: CurrencyTotals; danger?: boolean; good?: boolean }) {
  return (
    <div className="bridge-row">
      <span>{label}</span>
      <strong className={danger ? "danger-text" : good ? "good-text" : ""}>{formatCurrencyTotals(value)}</strong>
    </div>
  );
}

function GrowthItem({ label, value, danger }: { label: string; value?: number | null; danger?: boolean }) {
  return (
    <div className="growth-item">
      <span>{label}</span>
      <strong className={typeof value === "number" ? (danger ? "danger-text" : "good-text") : ""}>
        {typeof value === "number" ? `${value.toFixed(2)}%` : "—"}
      </strong>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="summary-tile">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TransactionTable({
  rows,
  teams,
  providers,
  teamsById,
  providersById,
  onMatch,
  onAssignTeam,
  onUpdateCategory,
  onOpenInvoice
}: {
  rows: Transaction[];
  teams: Team[];
  providers: Provider[];
  teamsById: Map<string, Team>;
  providersById: Map<string, Provider>;
  onMatch: (transaction: Transaction, providerId?: string) => void;
  onAssignTeam: (transaction: Transaction, teamId?: string) => void;
  onUpdateCategory: (transaction: Transaction, category: string) => void;
  onOpenInvoice: (transaction: Transaction) => void;
}) {
  const [descriptionToast, setDescriptionToast] = useState<TransactionDescriptionToast | null>(null);

  function showDetailToast(title: string, detail: string, event: React.MouseEvent<HTMLElement>) {
    const description = detail.trim();
    if (!description) {
      setDescriptionToast(null);
      return;
    }

    setDescriptionToast({
      title,
      description,
      ...detailToastPosition(event)
    });
  }

  function showDescriptionToast(transaction: Transaction, event: React.MouseEvent<HTMLElement>) {
    showDetailToast(transaction.counterparty, transaction.description, event);
  }

  return (
    <div className="table-wrap">
      {descriptionToast && (
        <div
          className="transaction-description-toast"
          role="status"
          style={{ left: descriptionToast.left, top: descriptionToast.top }}
        >
          <strong>{descriptionToast.title}</strong>
          <span>{descriptionToast.description}</span>
        </div>
      )}
      <table className="data-table activity-table transaction-table">
        <colgroup>
          <col className="transaction-date-col" />
          <col className="transaction-counterparty-col" />
          <col className="transaction-direction-col" />
          <col className="transaction-amount-col" />
          <col className="transaction-team-col" />
          <col className="transaction-category-col" />
          <col className="transaction-company-col" />
          <col className="transaction-document-col" />
          <col className="transaction-actions-col" />
        </colgroup>
        <thead>
          <tr>
            <th>Date</th>
            <th>Counterparty</th>
            <th>Direction</th>
            <th>Amount</th>
            <th>Team</th>
            <th>Category</th>
            <th>Company</th>
            <th>Document</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? (
            rows.map((transaction) => {
              const expectedProviderType = providerTypeForTransaction(transaction);
              const matchedProvider = transaction.matchedProviderId ? providersById.get(transaction.matchedProviderId) : undefined;
              const provider = matchedProvider?.type === expectedProviderType ? matchedProvider : undefined;
              const confidence = transaction.confidence ?? 0;
              const displayCategory = effectiveCategory(transaction);
              const categoryDetail = `${(confidence * 100).toFixed(0)}% · ${transaction.matchReason ?? "Needs review"}`;
              const documentTitle = transaction.direction === "in" ? "Create sales invoice draft" : "Record supplier bill draft";
              const categoryActionTitle = "Save category and remember alias";
              const providerOptions = providers.filter((item) => item.type === expectedProviderType);
              const companyPlaceholder = transaction.direction === "in" ? "Needs client" : "Optional supplier";
              const companyActionTitle = provider
                ? "Save suggested company match"
                : transaction.direction === "in"
                  ? "No suggested company to save"
                  : "Company match is optional for money out";
              return (
                <tr key={transaction.id}>
                  <td>{dateLabel(transaction.date)}</td>
                  <td
                    className="counterparty-cell"
                    onMouseEnter={(event) => showDescriptionToast(transaction, event)}
                    onMouseMove={(event) => showDescriptionToast(transaction, event)}
                    onMouseLeave={() => setDescriptionToast(null)}
                  >
                    <strong>{transaction.counterparty}</strong>
                    <small>{transaction.description}</small>
                  </td>
                  <td>
                    <span className={`direction-label ${transaction.direction}`}>
                      {transaction.direction === "in" ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                      {transaction.direction === "in" ? "In" : "Out"}
                    </span>
                  </td>
                  <td className="amount">{money(transaction.amount, transaction.currency)}</td>
                  <td>
                    <div className="team-select">
                      <NativeSelect value={transaction.teamId ?? ""} onChange={(event) => onAssignTeam(transaction, event.target.value || undefined)}>
                        <NativeSelectOption value="">No team</NativeSelectOption>
                        {teams.map((team) => (
                          <NativeSelectOption key={team.id} value={team.id}>
                            {team.name}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                      <small>{transaction.teamId ? teamsById.get(transaction.teamId)?.name ?? "Unknown team" : "Optional"}</small>
                    </div>
                  </td>
                  <td>
                    <div className="category-select">
                      <div className="category-control-row">
                        <NativeSelect
                          value={displayCategory}
                          onChange={(event) => onUpdateCategory(transaction, event.target.value)}
                        >
                          {transactionCategoryChoices(displayCategory).map((category) => (
                            <NativeSelectOption key={category} value={category}>
                              {category}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                        <Button
                          className="icon-button"
                          title={categoryActionTitle}
                          aria-label={categoryActionTitle}
                          onClick={() => onUpdateCategory(transaction, displayCategory)}
                        >
                          <Save size={15} />
                        </Button>
                      </div>
                      <small
                        className={confidence >= 0.86 ? "good-text" : confidence > 0 ? "warning-text" : ""}
                        onMouseEnter={(event) => showDetailToast(displayCategory, categoryDetail, event)}
                        onMouseMove={(event) => showDetailToast(displayCategory, categoryDetail, event)}
                        onMouseLeave={() => setDescriptionToast(null)}
                      >
                        {categoryDetail}
                      </small>
                    </div>
                  </td>
                  <td>
                    <div className="company-match">
                      <NativeSelect
                        className="company-select"
                        size="sm"
                        value={provider?.id ?? ""}
                        onChange={(event) => {
                          if (!event.target.value) return;
                          onMatch(transaction, event.target.value);
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
                      {provider && <small>{providerTagLabel(provider)}</small>}
                    </div>
                  </td>
                  <td>
                    {transaction.matchedInvoiceId ? (
                      <span className="status-pill good">Linked</span>
                    ) : (
                      <span className="status-pill">None</span>
                    )}
                  </td>
                  <td>
                    <div className="row-actions">
                      {provider ? (
                        <Button
                          className="icon-button"
                          title={companyActionTitle}
                          aria-label={companyActionTitle}
                          onClick={() => onMatch(transaction, provider.id)}
                        >
                          <ShieldCheck size={16} />
                        </Button>
                      ) : (
                        <span className="action-placeholder" title={companyActionTitle}>
                          —
                        </span>
                      )}
                      <Button className="icon-button" title={documentTitle} onClick={() => onOpenInvoice(transaction)}>
                        <FilePlus2 size={16} />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td colSpan={9}>No live transactions</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function RevenueView({
  dashboard,
  onSyncRevenue
}: {
  dashboard: DashboardSnapshot;
  onSyncRevenue: (payload: SyncRevenuePayload) => Promise<void>;
}) {
  const [periodPreset, setPeriodPreset] = useState<RevenuePeriodPreset>("last-week");
  const [partnerId, setPartnerId] = useState("all");
  const [timezone, setTimezone] = useState(dashboard.revenuePartners[0]?.timezone ?? "UTC");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [createInvoices, setCreateInvoices] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visibleRuns = dashboard.revenueRuns.filter((run) => partnerId === "all" || run.partnerId === partnerId);
  const latestRun = visibleRuns[0];
  const totalRevenue = sumCurrencyTotals(
    visibleRuns.filter((run) => run.status !== "failed" && run.status !== "skipped"),
    (run) => run.revenue
  );
  const invoicedRevenue = sumCurrencyTotals(
    visibleRuns.filter((run) => run.status === "invoiced"),
    (run) => run.revenue
  );
  const pendingRevenue = sumCurrencyTotals(
    visibleRuns.filter((run) => run.status === "pulled"),
    (run) => run.revenue
  );
  const revenuePartnersById = useMemo(() => {
    const map = new Map<string, RevenuePartner>();
    for (const partner of dashboard.revenuePartners) map.set(partner.id, partner);
    return map;
  }, [dashboard.revenuePartners]);
  const visiblePartners = dashboard.revenuePartners.filter((partner) => partnerId === "all" || partner.id === partnerId);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSyncRevenue({
        partnerId: partnerId === "all" ? undefined : partnerId,
        periodPreset,
        periodStart: periodPreset === "custom" ? periodStart : undefined,
        periodEnd: periodPreset === "custom" ? periodEnd : undefined,
        timezone,
        createInvoices
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Revenue sync failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Partner revenue</p>
          <h2>Revenue pulls and Merit invoices</h2>
        </div>
        <span className="total-pill">{dashboard.revenuePartners.length} partners</span>
      </div>

      <form className="revenue-controls" onSubmit={handleSubmit}>
        <label>
          Partner
          <NativeSelect value={partnerId} onChange={(event) => setPartnerId(event.target.value)}>
            <NativeSelectOption value="all">All partners</NativeSelectOption>
            {dashboard.revenuePartners.map((partner) => (
              <NativeSelectOption key={partner.id} value={partner.id}>
                {partner.name}
                {partner.affiliateId ? ` · ${partner.affiliateId}` : ""}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <label>
          Period
          <NativeSelect value={periodPreset} onChange={(event) => setPeriodPreset(event.target.value as RevenuePeriodPreset)}>
            <NativeSelectOption value="last-week">Last week</NativeSelectOption>
            <NativeSelectOption value="last-7-days">Last 7 days</NativeSelectOption>
            <NativeSelectOption value="this-month">This month</NativeSelectOption>
            <NativeSelectOption value="custom">Custom</NativeSelectOption>
          </NativeSelect>
        </label>
        <label className="timezone-field">
          Timezone
          <NativeSelect value={timezone} onChange={(event) => setTimezone(event.target.value)}>
            {timezoneOptions.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        {periodPreset === "custom" && (
          <>
            <label>
              Start
              <Input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} />
            </label>
            <label>
              End
              <Input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} />
            </label>
          </>
        )}
        <label className="check-row">
          <Checkbox checked={createInvoices} onCheckedChange={(checked) => setCreateInvoices(checked === true)} />
          Merit invoice
        </label>
        <Button className="primary-button" type="submit" disabled={busy}>
          {busy ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
          Pull
        </Button>
      </form>

      <div className="revenue-partner-strip">
        {visiblePartners.map((partner) => (
          <div className="revenue-partner-chip" key={partner.id}>
            <strong>{partner.name}</strong>
            <span>Affiliate ID {partner.affiliateId || "Not set"}</span>
          </div>
        ))}
      </div>

      {error && <div className="inline-error revenue-error">{error}</div>}

      <div className="wise-summary-grid revenue-summary">
        <SummaryTile label="Revenue" value={formatCurrencyTotals(totalRevenue)} />
        <SummaryTile label="Invoiced" value={formatCurrencyTotals(invoicedRevenue)} />
        <SummaryTile label="Pending" value={formatCurrencyTotals(pendingRevenue)} />
        <SummaryTile label="Last run" value={latestRun ? dateLabel(latestRun.createdAt) : "None"} />
      </div>

      <div className="table-wrap">
        <table className="data-table revenue-table">
          <thead>
            <tr>
              <th>Partner</th>
              <th>Period</th>
              <th>Timezone</th>
              <th>Revenue</th>
              <th>Conversions</th>
              <th>Status</th>
              <th>Invoice</th>
            </tr>
          </thead>
          <tbody>
            {visibleRuns.length > 0 ? (
              visibleRuns.map((run) => (
                <tr key={`${run.id}-${run.createdAt}`}>
                  <td>
                    <strong>{run.partnerName}</strong>
                    <small>TUNE · Affiliate ID {revenuePartnersById.get(run.partnerId)?.affiliateId || "Not set"}</small>
                  </td>
                  <td>
                    {dateLabel(run.periodStart)} - {dateLabel(run.periodEnd)}
                  </td>
                  <td>{run.timezone}</td>
                  <td className="amount">{run.status === "failed" ? "—" : money(run.revenue, run.currency)}</td>
                  <td>{run.status === "failed" ? "—" : run.conversions ?? 0}</td>
                  <td>
                    <span
                      className={`status-pill ${
                        run.status === "invoiced"
                          ? "good"
                          : run.status === "invoicing" || run.status === "failed" || run.status === "skipped"
                            ? "warning"
                            : ""
                      }`}
                    >
                      {run.status}
                    </span>
                    {run.error && <small>{run.error}</small>}
                  </td>
                  <td>{run.invoiceId ? run.externalInvoiceId ?? run.invoiceId : "None"}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7}>No revenue runs yet</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function RevolutView({ dashboard, rows }: { dashboard: DashboardSnapshot; rows: Transaction[] }) {
  const revolutAccounts = dashboard.accounts.filter((account) => account.source === "revolut");

  return (
    <div className="split-view">
      <section className="panel">
        <div className="panel-header compact">
          <h2>Revolut balances</h2>
          <span className="total-pill">{revolutAccounts.length > 0 ? `${revolutAccounts.length} accounts` : "—"}</span>
        </div>
        <SimpleMoneyTable
          rows={revolutAccounts.map((account) => ({
            id: account.id,
            name: account.name,
            amount: account.balance,
            currency: account.currency,
            source: sourceLabel(account.source)
          }))}
        />
      </section>

      <section className="panel">
        <div className="panel-header compact">
          <h2>Revolut movement</h2>
          <span className="total-pill">{rows.length} rows</span>
        </div>
        <div className="bridge">
          <div className="bridge-row">
            <span>Money in</span>
            <strong className="good-text">{groupedTransactionMoney(rows, "in")}</strong>
          </div>
          <div className="bridge-row">
            <span>Money out</span>
            <strong className="danger-text">{groupedTransactionMoney(rows, "out")}</strong>
          </div>
        </div>
      </section>

      <section className="panel wide-panel">
        <div className="panel-header compact">
          <h2>Revolut activity</h2>
          <span className="total-pill">{rows.length} rows</span>
        </div>
        <BasicTransactionsTable rows={rows} />
      </section>
    </div>
  );
}

function SlashView({ dashboard, rows }: { dashboard: DashboardSnapshot; rows: Transaction[] }) {
  const slashAccounts = dashboard.accounts.filter((account) => account.source === "slash");
  const cashbackRows = rows.filter((row) => row.category.toLowerCase().includes("cashback"));
  const cashback = sumCurrencyTotals(cashbackRows, (row) => row.amount);
  const balance = sumCurrencyTotals(slashAccounts, (account) => account.balance);

  return (
    <div className="split-view">
      <section className="panel">
        <div className="panel-header compact">
          <h2>Slash balances</h2>
          <span className="total-pill">{formatCurrencyTotals(balance)}</span>
        </div>
        <SimpleMoneyTable
          rows={slashAccounts.map((account) => ({
            id: account.id,
            name: account.name,
            amount: account.balance,
            currency: account.currency,
            source: sourceLabel(account.source)
          }))}
        />
      </section>

      <section className="panel">
        <div className="panel-header compact">
          <h2>Slash cashback</h2>
          <span className="total-pill good">{formatCurrencyTotals(cashback)}</span>
        </div>
        <div className="bridge">
          <div className="bridge-row">
            <span>Slash transactions shown</span>
            <strong>{rows.length}</strong>
          </div>
        </div>
      </section>

      <section className="panel wide-panel">
        <div className="panel-header compact">
          <h2>Slash card activity</h2>
          <span className="total-pill">{rows.length} rows</span>
        </div>
        <BasicTransactionsTable rows={rows} />
      </section>
    </div>
  );
}

function BasicTransactionsTable({ rows }: { rows: Transaction[] }) {
  return (
    <div className="table-wrap">
      <table className="data-table activity-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Counterparty</th>
            <th>Direction</th>
            <th>Category</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? (
            rows.map((transaction) => (
              <tr key={transaction.id}>
                <td>{dateLabel(transaction.date)}</td>
                <td className="counterparty-cell">
                  <strong>{transaction.counterparty}</strong>
                  <small>{transaction.description}</small>
                </td>
                <td>
                  <span className={`direction-label ${transaction.direction}`}>
                    {transaction.direction === "in" ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                    {transaction.direction === "in" ? "In" : "Out"}
                  </span>
                </td>
                <td>{transaction.category}</td>
                <td className="amount">{money(transaction.amount, transaction.currency)}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={5}>No live transactions</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function InvoicesView({
  dashboard,
  providersById,
  onApprove,
  onMarkPaid
}: {
  dashboard: DashboardSnapshot;
  providersById: Map<string, Provider>;
  onApprove: (invoiceId: string, approvalStatus: "approved" | "denied") => Promise<void>;
  onMarkPaid: (invoiceId: string) => Promise<void>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);

  async function runAction(invoiceId: string, action: () => Promise<void>) {
    setBusyId(invoiceId);
    try {
      await action();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Finance documents</p>
          <h2>Match, create, approve, deny, and locally mark paid</h2>
        </div>
        <span className="total-pill">{dashboard.invoices.length} invoices</span>
      </div>
      <div className="table-wrap">
        <table className="data-table invoice-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Document</th>
              <th>Amount</th>
              <th>Company</th>
              <th>Merit status</th>
              <th>Dashboard status</th>
              <th>Linked transaction</th>
              <th>Actions</th>
            </tr>
        </thead>
        <tbody>
            {dashboard.invoices.length > 0 ? (
              dashboard.invoices.map((invoice) => {
              const provider = invoice.providerId ? providersById.get(invoice.providerId) : undefined;
              return (
                <tr key={invoice.id}>
                  <td className="counterparty-cell">
                    <strong>{invoice.customerName}</strong>
                    <small>{invoice.description}</small>
                  </td>
                  <td>{invoice.documentType === "supplier_bill" ? "Supplier bill" : "Sales invoice"}</td>
                  <td className="amount">{money(invoice.amount, invoice.currency)}</td>
                  <td>{providerLabel(provider)}</td>
                  <td>
                    <span className={`status-pill ${invoice.meritPaid ? "good" : ""}`}>
                      {invoice.meritPaid ? "Paid in Merit" : invoice.source === "merit" ? "Open in Merit" : "Local draft"}
                    </span>
                  </td>
                  <td>
                    <span className={`status-pill ${invoice.approvalStatus === "approved" ? "good" : invoice.approvalStatus === "denied" ? "warning" : ""}`}>
                      {invoice.paidLocally ? "Paid locally" : invoice.approvalStatus ?? "pending"}
                    </span>
                  </td>
                  <td>{invoice.transactionId ? invoice.transactionId : "Not linked"}</td>
                  <td>
                    <div className="row-actions">
                      <Button
                        className="icon-button"
                        title="Approve invoice match"
                        disabled={busyId === invoice.id}
                        onClick={() => runAction(invoice.id, () => onApprove(invoice.id, "approved"))}
                      >
                        <Check size={16} />
                      </Button>
                      <Button
                        className="icon-button"
                        title="Deny invoice match"
                        disabled={busyId === invoice.id}
                        onClick={() => runAction(invoice.id, () => onApprove(invoice.id, "denied"))}
                      >
                        <X size={16} />
                      </Button>
                      <Button
                        className="icon-text-button"
                        disabled={busyId === invoice.id || invoice.paidLocally}
                        onClick={() => runAction(invoice.id, () => onMarkPaid(invoice.id))}
                      >
                        <Check size={15} />
                        Paid here
                      </Button>
                    </div>
                  </td>
                </tr>
              );
              })
            ) : (
              <tr>
                <td colSpan={8}>No live invoices</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ProvidersView({
  providers,
  revenuePartners,
  onAdd,
  onEditProvider,
  onEditRevenuePartner,
  onDeleteProvider,
  onDeleteRevenuePartner
}: {
  providers: Provider[];
  revenuePartners: RevenuePartner[];
  onAdd: () => void;
  onEditProvider: (provider: Provider) => void;
  onEditRevenuePartner: (partner: RevenuePartner) => void;
  onDeleteProvider: (provider: Provider) => void;
  onDeleteRevenuePartner: (partner: RevenuePartner) => void;
}) {
  const [scope, setScope] = useState<"all" | ProviderType>("all");
  const visibleProviders = providers.filter((provider) => {
    if (scope === "all") return true;
    return provider.type === scope;
  });
  const showRevenuePartners = scope === "all" || scope === "client";
  const clientCount = providers.filter((provider) => provider.type === "client").length + revenuePartners.length;
  const supplierCount = providers.filter((provider) => provider.type === "supplier").length;

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
                <Button
                  className="icon-button destructive-icon-button"
                  aria-label={`Delete ${provider.name}`}
                  title="Delete company"
                  onClick={() => onDeleteProvider(provider)}
                >
                  <Trash2 size={15} />
                </Button>
              </div>
            </div>
            <div className="tag-list">
              {provider.tags.length > 0 ? provider.tags.map((tag) => <span key={tag}>{tag}</span>) : <span>No tags</span>}
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
          </article>
        ))}
        {showRevenuePartners &&
          revenuePartners.map((partner) => (
            <article className="provider-card revenue-partner-card" key={partner.id}>
              <div className="provider-card-head">
                <div className="provider-avatar">
                  <BarChart3 size={18} />
                </div>
                <div>
                  <strong>{partner.name}</strong>
                  <span>Client · TUNE revenue</span>
                </div>
                <div className="provider-card-actions">
                  <Button
                    className="icon-button"
                    aria-label={`Edit revenue client ${partner.name} (${partner.networkIdEnv})`}
                    title="Edit revenue partner"
                    onClick={() => onEditRevenuePartner(partner)}
                  >
                    <Pencil size={15} />
                  </Button>
                  <Button
                    className="icon-button destructive-icon-button"
                    aria-label={`Delete revenue client ${partner.name} (${partner.networkIdEnv})`}
                    title="Delete revenue client"
                    onClick={() => onDeleteRevenuePartner(partner)}
                  >
                    <Trash2 size={15} />
                  </Button>
                </div>
              </div>
              <div className="tag-list">
                <span>Revenue</span>
                <span>TUNE</span>
              </div>
              <div className="alias-list">
                <span>Affiliate ID {partner.affiliateId || "Not set"}</span>
                <span>{partner.currency}</span>
                <span>{partner.timezone}</span>
                <span>{partner.enabled ? "Enabled" : "Disabled"}</span>
                <span>{partner.networkIdEnv}</span>
              </div>
            </article>
          ))}
        {visibleProviders.length === 0 && (!showRevenuePartners || revenuePartners.length === 0) && <div className="empty-state">No companies in this filter</div>}
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
  const relationship = target.kind === "provider" ? providerTypeLabel(target.provider.type).toLowerCase() : "revenue client";

  async function handleConfirm(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Company could not be deleted");
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
            ? "This removes the company from the directory and clears it from matched transactions and invoices. Financial records stay in place."
            : "This removes the TUNE revenue client and stops future syncs. Existing revenue runs and invoice history stay in place."}
        </p>
        {error && <div className="inline-error">{error}</div>}
        <div className="modal-actions">
          <Button type="button" className="secondary-button" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" className="destructive-button" disabled={submitting}>
            {submitting ? <Loader2 className="spin" size={16} /> : <Trash2 size={16} />}
            Delete company
          </Button>
        </div>
      </form>
    </div>
  );
}

function SettingsView({
  dashboard,
  onCreateTeam,
  onSaveAiSettings,
  onRunAiPrompt
}: {
  dashboard: DashboardSnapshot;
  onCreateTeam: (payload: CreateTeamPayload) => Promise<void>;
  onSaveAiSettings: (payload: SaveAiSettingsPayload) => Promise<void>;
  onRunAiPrompt: (payload: AiPromptPayload) => Promise<AiPromptResult>;
}) {
  const missing = dashboard.integrationStatus.flatMap((item) => item.needs.map((need) => ({ source: item.label, need })));
  const initialModelIsPreset = openRouterModelOptions.some((option) => option.value === dashboard.aiSettings.model);
  const [modelChoice, setModelChoice] = useState(initialModelIsPreset ? dashboard.aiSettings.model : "custom");
  const [customModel, setCustomModel] = useState(initialModelIsPreset ? "" : dashboard.aiSettings.model);
  const [teamName, setTeamName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [aiResult, setAiResult] = useState<AiPromptResult | null>(null);
  const [busy, setBusy] = useState<"team" | "save" | "prompt" | null>(null);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    const isPreset = openRouterModelOptions.some((option) => option.value === dashboard.aiSettings.model);
    setModelChoice(isPreset ? dashboard.aiSettings.model : "custom");
    setCustomModel(isPreset ? "" : dashboard.aiSettings.model);
  }, [dashboard.aiSettings.model]);

  const selectedModel = modelChoice === "custom" ? customModel : modelChoice;

  async function addTeam(event: FormEvent) {
    event.preventDefault();
    setBusy("team");
    setTeamError(null);
    try {
      await onCreateTeam({ name: teamName });
      setTeamName("");
    } catch (err) {
      setTeamError(err instanceof Error ? err.message : "Team could not be created");
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
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Operating setup</p>
            <h2>Teams</h2>
          </div>
          <span className="total-pill">{dashboard.teams.length} teams</span>
        </div>
        <form className="settings-form" onSubmit={addTeam}>
          <div className="form-grid">
            <label>
              Team name
              <Input value={teamName} onChange={(event) => setTeamName(event.target.value)} />
            </label>
          </div>
          {teamError && <div className="inline-error">{teamError}</div>}
          <div className="modal-actions">
            <Button className="primary-button" type="submit" disabled={busy === "team" || !teamName.trim()}>
              {busy === "team" ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
              Add team
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
            <strong>Secret storage</strong>
            <span>OpenRouter credentials are managed as an OPENROUTER_API_KEY runtime secret and are never stored in dashboard data.</span>
          </div>
          <div className="form-grid">
            <label>
              Model
              <NativeSelect value={modelChoice} onChange={(event) => setModelChoice(event.target.value)}>
                {openRouterModelOptions.map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
            <label>
              Model slug
              <Input
                value={selectedModel}
                onChange={(event) => {
                  setModelChoice("custom");
                  setCustomModel(event.target.value);
                }}
              />
            </label>
          </div>
          {aiError && <div className="inline-error">{aiError}</div>}
          <div className="modal-actions">
            <Button className="primary-button" type="submit" disabled={busy === "save"}>
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
            Wise and Revolut pull balances plus transaction activity for reconciliation. Partner revenue pulls from TUNE and creates Merit invoices.
            Slash has its own card/cashback page. Marking paid here never marks paid in Merit.
          </span>
        </div>
      </section>
    </div>
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
  const documentType = transaction.direction === "in" ? "sales_invoice" : "supplier_bill";
  const documentTitle = documentType === "sales_invoice" ? "Create sales invoice draft" : "Record supplier bill draft";
  const expectedProviderType = providerTypeForDocument(documentType);
  const providerOptions = providers.filter((item) => item.type === expectedProviderType);
  const selectedProvider = provider?.type === expectedProviderType ? provider : undefined;
  const [providerId, setProviderId] = useState(selectedProvider?.id || "");
  const [customerName, setCustomerName] = useState(selectedProvider?.legalName || selectedProvider?.name || bankInvoiceName(transaction));
  const [amount, setAmount] = useState(String(Math.abs(transaction.amount)));
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
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
        documentType,
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
            <h2>{documentTitle}</h2>
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
            onChange={(event) => {
              const nextProviderId = event.target.value;
              const nextProvider = providerOptions.find((item) => item.id === nextProviderId);
              setProviderId(nextProviderId);
              if (nextProvider) setCustomerName(nextProvider.legalName || nextProvider.name);
            }}
          >
            <NativeSelectOption value="">No {expectedProviderType} selected</NativeSelectOption>
            {providerOptions.map((item) => (
              <NativeSelectOption key={item.id} value={item.id}>
                {item.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <label>
          {documentType === "sales_invoice" ? "Customer name" : "Supplier name"}
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
  onClose,
  onSubmit
}: {
  provider?: Provider;
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
        meritSupplierId: meritSupplierId.trim() || undefined
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
                <NativeSelect value={type} onChange={(event) => setType(event.target.value as ProviderType)}>
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
  onClose,
  onSubmit
}: {
  partner: RevenuePartner;
  onClose: () => void;
  onSubmit: (payload: UpdateRevenuePartnerPayload) => Promise<void>;
}) {
  const [name, setName] = useState(partner.name);
  const [affiliateId, setAffiliateId] = useState(partner.affiliateId);
  const [externalId, setExternalId] = useState(partner.externalId ?? "");
  const [currency, setCurrency] = useState(partner.currency);
  const [timezone, setTimezone] = useState(partner.timezone);
  const [networkTimezone, setNetworkTimezone] = useState(partner.networkTimezone);
  const [networkIdEnv, setNetworkIdEnv] = useState(partner.networkIdEnv);
  const [apiKeyEnv, setApiKeyEnv] = useState(partner.apiKeyEnv);
  const [apiBaseUrlEnv, setApiBaseUrlEnv] = useState(partner.apiBaseUrlEnv ?? "");
  const [meritCustomerName, setMeritCustomerName] = useState(partner.meritCustomerName ?? "");
  const [invoiceDueDays, setInvoiceDueDays] = useState(String(partner.invoiceDueDays));
  const [enabled, setEnabled] = useState(partner.enabled);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        name,
        affiliateId,
        externalId: externalId.trim() || undefined,
        currency,
        timezone,
        networkTimezone,
        networkIdEnv,
        apiKeyEnv,
        apiBaseUrlEnv: apiBaseUrlEnv.trim() || undefined,
        meritCustomerName: meritCustomerName.trim() || undefined,
        invoiceDueDays: Number(invoiceDueDays),
        enabled
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Revenue partner could not be saved");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="modal wide-modal" onSubmit={handleSubmit}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Revenue partner</p>
            <h2>Edit {partner.name}</h2>
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
            Affiliate ID
            <Input value={affiliateId} onChange={(event) => setAffiliateId(event.target.value)} />
          </label>
        </div>
        <div className="form-grid">
          <label>
            External ID
            <Input value={externalId} onChange={(event) => setExternalId(event.target.value)} />
          </label>
          <label>
            Currency
            <Input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
          </label>
        </div>
        <div className="form-grid">
          <label>
            Timezone
            <NativeSelect value={timezone} onChange={(event) => setTimezone(event.target.value)}>
              {timezoneOptions.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </label>
          <label>
            Network timezone
            <NativeSelect value={networkTimezone} onChange={(event) => setNetworkTimezone(event.target.value)}>
              {timezoneOptions.map((option) => (
                <NativeSelectOption key={option.value} value={option.value}>
                  {option.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
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
        <label>
          API base URL env
          <Input value={apiBaseUrlEnv} onChange={(event) => setApiBaseUrlEnv(event.target.value)} />
        </label>
        <div className="form-grid">
          <label>
            Merit customer
            <Input value={meritCustomerName} onChange={(event) => setMeritCustomerName(event.target.value)} />
          </label>
          <label>
            Invoice due days
            <Input type="number" min="0" step="1" value={invoiceDueDays} onChange={(event) => setInvoiceDueDays(event.target.value)} />
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
          <Button type="submit" className="primary-button" disabled={submitting}>
            {submitting ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
            Save
          </Button>
        </div>
      </form>
    </div>
  );
}

export default App;
