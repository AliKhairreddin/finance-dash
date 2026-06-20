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
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Tags,
  WalletCards,
  X
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  AiPromptPayload,
  AiPromptResult,
  CreateInvoicePayload,
  CreateProviderPayload,
  DashboardSnapshot,
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

const apiBase = import.meta.env.VITE_API_BASE || "/api";
type ActiveTab = "overview" | "wise" | "revenue" | "slash" | "invoices" | "providers" | "settings";

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

function maybeMoney(hasValue: boolean, value: number, currency = "USD"): string {
  return hasValue ? money(value, currency) : "—";
}

function maybeDate(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateLabel(value);
}

function compactMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
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
  return provider ? provider.name : "Unmatched";
}

function providerTypeLabel(type: ProviderType): string {
  const labels: Record<ProviderType, string> = {
    partner: "Partner",
    provider: "Provider",
    platform: "Platform",
    internal: "Internal"
  };
  return labels[type];
}

function bankInvoiceName(transaction: Transaction): string {
  return transaction.counterparty || transaction.rawName;
}

function sourceLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function App() {
  const [dashboard, setDashboard] = useState<DashboardSnapshot | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("overview");
  const [wiseDirection, setWiseDirection] = useState<"in" | "out">("in");
  const [teamFilter, setTeamFilter] = useState("all");
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [matchFilter, setMatchFilter] = useState("needs-review");
  const [selectedProviders, setSelectedProviders] = useState<Record<string, string>>({});
  const [invoiceTransaction, setInvoiceTransaction] = useState<Transaction | null>(null);
  const [providerModalOpen, setProviderModalOpen] = useState(false);
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [editingRevenuePartner, setEditingRevenuePartner] = useState<RevenuePartner | null>(null);

  async function loadDashboard() {
    setError(null);
    const response = await fetch(`${apiBase}/dashboard`);
    if (!response.ok) throw new Error("Could not load dashboard data");
    setDashboard((await response.json()) as DashboardSnapshot);
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
    return rows.filter((transaction) => {
      const provider = transaction.matchedProviderId ? providersById.get(transaction.matchedProviderId) : undefined;
      const team = transaction.teamId ? teamsById.get(transaction.teamId) : undefined;
      const matchesQuery =
        !query ||
        [transaction.counterparty, transaction.description, transaction.rawName, provider?.name ?? "", team?.name ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(query);
      const needsReview = !transaction.matchedProviderId || (transaction.confidence ?? 0) < 0.86;
      const matchesStatus =
        matchFilter === "all" ||
        (matchFilter === "needs-review" && needsReview) ||
        (matchFilter === "matched" && !needsReview);
      return matchesQuery && matchesStatus;
    });
  }, [dashboard?.transactions, matchFilter, providersById, searchTerm, teamsById]);

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
    const total = wiseTransactions.reduce((sum, transaction) => sum + transaction.amount, 0);
    const matched = wiseTransactions.filter((transaction) => transaction.matchedProviderId).length;
    const unassigned = wiseTransactions.filter((transaction) => !transaction.teamId).length;
    return { total, count: wiseTransactions.length, matched, unassigned };
  }, [wiseTransactions]);

  const slashTransactions = useMemo(
    () => filteredTransactions.filter((transaction) => transaction.source === "slash"),
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
    const selectedProviderId = providerId || selectedProviders[transaction.id] || transaction.matchedProviderId;
    if (!selectedProviderId) {
      setError("Choose a provider before saving the match.");
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
    setNotice(`Saved alias for ${transaction.counterparty}. Future rows will auto-match.`);
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

  async function submitInvoice(payload: CreateInvoicePayload) {
    const response = await fetch(`${apiBase}/invoices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const body = await response.json();
      throw new Error(body.message || "Invoice could not be created");
    }
    await loadDashboard();
    setNotice("Invoice created in Merit. Paid status remains dashboard-only here.");
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
      <main className="loading-screen">
        <Loader2 className="spin" size={28} />
        <span>Loading finance dashboard</span>
      </main>
    );
  }

  if (!dashboard) {
    return (
      <main className="loading-screen">
        <CircleAlert size={28} />
        <span>{error || "Dashboard could not load"}</span>
      </main>
    );
  }

  const hasCash = dashboard.accounts.length > 0;
  const hasReceivables = dashboard.receivables.length > 0;
  const hasOpenBalances = dashboard.openBalances.length > 0;
  const hasPayables = dashboard.payables.length > 0;
  const hasInvestments = dashboard.investments.length > 0;
  const hasProfit = hasReceivables || hasOpenBalances || hasPayables;
  const hasTotalAssets = hasProfit || hasInvestments;

  return (
    <main className="app-shell">
      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />
      <div className="main-column">
        <header className="topbar">
          <div>
            <p className="eyebrow">Finance operations</p>
            <h1>Cash flow and open balance control</h1>
            <div className="meta-row">
              <span>Data as of: {maybeDate(dashboard.asOf)}</span>
              <span>Last sync: {maybeDate(dashboard.lastSync)}</span>
            </div>
          </div>
          <div className="topbar-actions">
            <button
              className="secondary-button"
              onClick={() => {
                setEditingProvider(null);
                setProviderModalOpen(true);
              }}
            >
              <Plus size={16} />
              Company
            </button>
            <button className="primary-button" onClick={syncNow} disabled={isSyncing}>
              {isSyncing ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
              Sync
            </button>
          </div>
        </header>

        {(error || notice) && (
          <div className={error ? "toast error" : "toast"}>
            {error ? <CircleAlert size={16} /> : <Check size={16} />}
            <span>{error || notice}</span>
            <button aria-label="Dismiss" onClick={() => (error ? setError(null) : setNotice(null))}>
              <X size={14} />
            </button>
          </div>
        )}

      {activeTab === "overview" && (
        <section className="metric-grid" aria-label="Finance summary">
          <MetricCard
            icon={<Banknote />}
            label="Cash in accounts"
            value={maybeMoney(hasCash, dashboard.metrics.totalCash ?? 0)}
            detail={hasCash ? "Connected bank and card accounts" : "No live account data"}
          />
          <MetricCard
            icon={<BadgeDollarSign />}
            label="Receivables"
            value={maybeMoney(hasReceivables, dashboard.metrics.totalReceivables ?? 0)}
            detail={hasReceivables ? "Live invoice and tax rows" : "No live receivables"}
          />
          <MetricCard
            icon={<WalletCards />}
            label="Open balance"
            value={maybeMoney(hasOpenBalances, dashboard.metrics.totalOpenBalance ?? 0)}
            detail={hasOpenBalances ? "Customer and provider balances" : "No live open balances"}
          />
          <MetricCard
            icon={<ArrowDownRight />}
            label="Payables"
            value={maybeMoney(hasPayables, dashboard.metrics.totalPayables ?? 0)}
            detail={hasPayables ? "Unpaid platform/provider spend" : "No live payables"}
            danger
          />
          <MetricCard
            icon={<CircleDollarSign />}
            label="Profit"
            value={maybeMoney(hasProfit, dashboard.metrics.profit ?? 0)}
            detail={hasProfit ? "Calculated from live operating rows" : "Waiting for operating rows"}
            good
          />
          <MetricCard
            icon={<ShieldCheck />}
            label="Total assets"
            value={maybeMoney(hasTotalAssets, dashboard.metrics.totalAssets ?? 0)}
            detail={hasInvestments ? `${money(dashboard.metrics.investments ?? 0)} investments` : "No live investments"}
          />
        </section>
      )}

      {activeTab === "wise" && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Wise reconciliation</p>
              <h2>Match incoming payments and outgoing spend</h2>
            </div>
            <div className="filters">
              <div className="segmented-control" aria-label="Wise transaction direction">
                <button className={wiseDirection === "in" ? "active" : ""} onClick={() => setWiseDirection("in")}>
                  <ArrowUpRight size={15} />
                  In
                </button>
                <button className={wiseDirection === "out" ? "active" : ""} onClick={() => setWiseDirection("out")}>
                  <ArrowDownRight size={15} />
                  Out
                </button>
              </div>
              <label className="search-box">
                <Search size={15} />
                <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search transactions" />
              </label>
              <label>
                <Filter size={15} />
                <select value={matchFilter} onChange={(event) => setMatchFilter(event.target.value)}>
                  <option value="needs-review">Needs review</option>
                  <option value="matched">Matched</option>
                  <option value="all">All rows</option>
                </select>
              </label>
              <label>
                Team
                <select value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}>
                  <option value="all">All teams</option>
                  <option value="unassigned">Unassigned</option>
                  {dashboard.teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <div className="wise-summary-grid">
            <SummaryTile label="Visible volume" value={maybeMoney(wiseTransactions.length > 0, wiseTeamSummary.total)} />
            <SummaryTile label="Transactions" value={String(wiseTeamSummary.count)} />
            <SummaryTile label="Matched rows" value={String(wiseTeamSummary.matched)} />
            <SummaryTile label="No team" value={String(wiseTeamSummary.unassigned)} />
          </div>
          <TransactionTable
            rows={wiseTransactions}
            teams={dashboard.teams}
            teamsById={teamsById}
            providers={dashboard.providers}
            providersById={providersById}
            selectedProviders={selectedProviders}
            setSelectedProviders={setSelectedProviders}
            onMatch={matchTransaction}
            onAssignTeam={assignTransactionTeam}
            onOpenInvoice={setInvoiceTransaction}
          />
        </section>
      )}

      {activeTab === "revenue" && (
        <RevenueView dashboard={dashboard} onSyncRevenue={syncRevenue} />
      )}

      {activeTab === "slash" && (
        <SlashView dashboard={dashboard} rows={slashTransactions} />
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
        />
      )}

      {activeTab === "settings" && (
        <SettingsView dashboard={dashboard} onSaveAiSettings={saveAiSettings} onRunAiPrompt={runAiPrompt} />
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
      </div>
    </main>
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
    { id: "wise", label: "Wise", icon: <Link2 size={17} /> },
    { id: "revenue", label: "Revenue", icon: <BarChart3 size={17} /> },
    { id: "slash", label: "Slash", icon: <WalletCards size={17} /> },
    { id: "invoices", label: "Invoices", icon: <FilePlus2 size={17} /> },
    { id: "providers", label: "Partners", icon: <Tags size={17} /> },
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
          <button key={item.id} className={activeTab === item.id ? "active" : ""} onClick={() => setActiveTab(item.id)}>
            {item.icon}
            <span>{item.label}</span>
          </button>
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

function SimpleMoneyTable({
  rows,
  dense,
  emptyLabel = "No live rows"
}: {
  rows: Array<{ id: string; name: string; amount: number; currency: string; source: string }>;
  dense?: boolean;
  emptyLabel?: string;
}) {
  return (
    <div className={`money-list ${dense ? "dense" : ""}`}>
      <div className="money-row money-head">
        <span>Account</span>
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
  teamsById,
  providers,
  providersById,
  selectedProviders,
  setSelectedProviders,
  onMatch,
  onAssignTeam,
  onOpenInvoice
}: {
  rows: Transaction[];
  teams: Team[];
  teamsById: Map<string, Team>;
  providers: Provider[];
  providersById: Map<string, Provider>;
  selectedProviders: Record<string, string>;
  setSelectedProviders: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onMatch: (transaction: Transaction, providerId?: string) => void;
  onAssignTeam: (transaction: Transaction, teamId?: string) => void;
  onOpenInvoice: (transaction: Transaction) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table activity-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Counterparty</th>
            <th>Direction</th>
            <th>Amount</th>
            <th>Team</th>
            <th>Suggested provider</th>
            <th>Invoice</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? (
            rows.map((transaction) => {
              const provider = transaction.matchedProviderId ? providersById.get(transaction.matchedProviderId) : undefined;
              const selected = selectedProviders[transaction.id] || transaction.matchedProviderId || "";
              const confidence = transaction.confidence ?? 0;
              return (
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
                  <td className="amount">{money(transaction.amount, transaction.currency)}</td>
                  <td>
                    <div className="team-select">
                      <select value={transaction.teamId ?? ""} onChange={(event) => onAssignTeam(transaction, event.target.value || undefined)}>
                        <option value="">No team</option>
                        {teams.map((team) => (
                          <option key={team.id} value={team.id}>
                            {team.name}
                          </option>
                        ))}
                      </select>
                      <small>{transaction.teamId ? teamsById.get(transaction.teamId)?.name ?? "Unknown team" : "Optional"}</small>
                    </div>
                  </td>
                  <td>
                    <div className="provider-select">
                      <select
                        value={selected}
                        onChange={(event) =>
                          setSelectedProviders((current) => ({ ...current, [transaction.id]: event.target.value }))
                        }
                      >
                        <option value="">Choose provider</option>
                        {providers.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))}
                      </select>
                      <small className={confidence >= 0.86 ? "good-text" : confidence > 0 ? "warning-text" : ""}>
                        {providerLabel(provider)} · {(confidence * 100).toFixed(0)}%
                      </small>
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
                      <button className="icon-button" title="Save match and remember alias" onClick={() => onMatch(transaction, selected)}>
                        <Link2 size={16} />
                      </button>
                      <button className="icon-button" title="Create invoice" onClick={() => onOpenInvoice(transaction)}>
                        <FilePlus2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })
          ) : (
            <tr>
              <td colSpan={8}>No live transactions</td>
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
  const hasPulledRevenue = visibleRuns.some((run) => run.status === "pulled" || run.status === "invoiced");
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
          <select value={partnerId} onChange={(event) => setPartnerId(event.target.value)}>
            <option value="all">All partners</option>
            {dashboard.revenuePartners.map((partner) => (
              <option key={partner.id} value={partner.id}>
                {partner.name}
                {partner.affiliateId ? ` · ${partner.affiliateId}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Period
          <select value={periodPreset} onChange={(event) => setPeriodPreset(event.target.value as RevenuePeriodPreset)}>
            <option value="last-week">Last week</option>
            <option value="last-7-days">Last 7 days</option>
            <option value="this-month">This month</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label className="timezone-field">
          Timezone
          <select value={timezone} onChange={(event) => setTimezone(event.target.value)}>
            {timezoneOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {periodPreset === "custom" && (
          <>
            <label>
              Start
              <input type="date" value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} />
            </label>
            <label>
              End
              <input type="date" value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} />
            </label>
          </>
        )}
        <label className="check-row">
          <input type="checkbox" checked={createInvoices} onChange={(event) => setCreateInvoices(event.target.checked)} />
          Merit invoice
        </label>
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}
          Pull
        </button>
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
        <SummaryTile label="Revenue" value={maybeMoney(hasPulledRevenue, dashboard.revenueMetrics.totalRevenue ?? 0)} />
        <SummaryTile label="Invoiced" value={maybeMoney(dashboard.revenueMetrics.invoicedRevenue !== null, dashboard.revenueMetrics.invoicedRevenue ?? 0)} />
        <SummaryTile label="Pending" value={maybeMoney(dashboard.revenueMetrics.pendingRevenue !== null, dashboard.revenueMetrics.pendingRevenue ?? 0)} />
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
                    <span className={`status-pill ${run.status === "invoiced" ? "good" : run.status === "failed" || run.status === "skipped" ? "warning" : ""}`}>
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

function SlashView({ dashboard, rows }: { dashboard: DashboardSnapshot; rows: Transaction[] }) {
  const slashAccounts = dashboard.accounts.filter((account) => account.source === "slash");
  const cashbackRows = rows.filter((row) => row.category.toLowerCase().includes("cashback"));
  const cashback = cashbackRows.reduce((total, row) => total + row.amount, 0);
  const balance = slashAccounts.reduce((total, account) => total + account.balance, 0);

  return (
    <div className="split-view">
      <section className="panel">
        <div className="panel-header compact">
          <h2>Slash balances</h2>
          <span className="total-pill">{maybeMoney(slashAccounts.length > 0, balance)}</span>
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
          <span className="total-pill good">{maybeMoney(cashbackRows.length > 0, cashback)}</span>
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
          <p className="eyebrow">Merit invoices</p>
          <h2>Match, create, approve, deny, and locally mark paid</h2>
        </div>
        <span className="total-pill">{dashboard.invoices.length} invoices</span>
      </div>
      <div className="table-wrap">
        <table className="data-table invoice-table">
          <thead>
            <tr>
              <th>Customer</th>
              <th>Amount</th>
              <th>Provider</th>
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
                      <button
                        className="icon-button"
                        title="Approve invoice match"
                        disabled={busyId === invoice.id}
                        onClick={() => runAction(invoice.id, () => onApprove(invoice.id, "approved"))}
                      >
                        <Check size={16} />
                      </button>
                      <button
                        className="icon-button"
                        title="Deny invoice match"
                        disabled={busyId === invoice.id}
                        onClick={() => runAction(invoice.id, () => onApprove(invoice.id, "denied"))}
                      >
                        <X size={16} />
                      </button>
                      <button
                        className="icon-text-button"
                        disabled={busyId === invoice.id || invoice.paidLocally}
                        onClick={() => runAction(invoice.id, () => onMarkPaid(invoice.id))}
                      >
                        <Check size={15} />
                        Paid here
                      </button>
                    </div>
                  </td>
                </tr>
              );
              })
            ) : (
              <tr>
                <td colSpan={7}>No live invoices</td>
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
  onEditRevenuePartner
}: {
  providers: Provider[];
  revenuePartners: RevenuePartner[];
  onAdd: () => void;
  onEditProvider: (provider: Provider) => void;
  onEditRevenuePartner: (partner: RevenuePartner) => void;
}) {
  const [scope, setScope] = useState<"all" | ProviderType | "revenue">("all");
  const visibleProviders = providers.filter((provider) => {
    if (scope === "all") return true;
    if (scope === "revenue") return false;
    return provider.type === scope;
  });
  const showRevenuePartners = scope === "all" || scope === "revenue";
  const partnerCount = providers.filter((provider) => provider.type === "partner").length;
  const providerCount = providers.filter((provider) => provider.type === "provider").length;

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Business directory</p>
          <h2>Partners, providers, platforms, and known bank names</h2>
        </div>
        <button className="secondary-button" onClick={onAdd}>
          <Plus size={16} />
          Add company
        </button>
      </div>
      <div className="directory-toolbar">
        <div className="segmented-control" aria-label="Directory filter">
          {[
            { id: "all", label: "All" },
            { id: "partner", label: `Partners ${partnerCount}` },
            { id: "provider", label: `Providers ${providerCount}` },
            { id: "platform", label: "Platforms" },
            { id: "revenue", label: "Revenue" }
          ].map((item) => (
            <button
              key={item.id}
              className={scope === item.id ? "active" : ""}
              onClick={() => setScope(item.id as "all" | ProviderType | "revenue")}
            >
              {item.label}
            </button>
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
                <span>{providerTypeLabel(provider.type)} · {provider.category}</span>
              </div>
              <button className="icon-button" title="Edit company" onClick={() => onEditProvider(provider)}>
                <Pencil size={15} />
              </button>
            </div>
            <div className="alias-list">
              {[provider.name, ...provider.aliases].slice(0, 7).map((alias) => (
                <span key={alias}>{alias}</span>
              ))}
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
                  <span>TUNE · Affiliate ID {partner.affiliateId || "Not set"}</span>
                </div>
                <button className="icon-button" title="Edit revenue partner" onClick={() => onEditRevenuePartner(partner)}>
                  <Pencil size={15} />
                </button>
              </div>
              <div className="alias-list">
                <span>{partner.currency}</span>
                <span>{partner.timezone}</span>
                <span>{partner.enabled ? "Enabled" : "Disabled"}</span>
                <span>{partner.networkIdEnv}</span>
              </div>
            </article>
          ))}
        {visibleProviders.length === 0 && !showRevenuePartners && <div className="empty-state">No companies in this filter</div>}
      </div>
    </section>
  );
}

function SettingsView({
  dashboard,
  onSaveAiSettings,
  onRunAiPrompt
}: {
  dashboard: DashboardSnapshot;
  onSaveAiSettings: (payload: SaveAiSettingsPayload) => Promise<void>;
  onRunAiPrompt: (payload: AiPromptPayload) => Promise<AiPromptResult>;
}) {
  const missing = dashboard.integrationStatus.flatMap((item) => item.needs.map((need) => ({ source: item.label, need })));
  const initialModelIsPreset = openRouterModelOptions.some((option) => option.value === dashboard.aiSettings.model);
  const [apiKey, setApiKey] = useState("");
  const [modelChoice, setModelChoice] = useState(initialModelIsPreset ? dashboard.aiSettings.model : "custom");
  const [customModel, setCustomModel] = useState(initialModelIsPreset ? "" : dashboard.aiSettings.model);
  const [prompt, setPrompt] = useState("");
  const [aiResult, setAiResult] = useState<AiPromptResult | null>(null);
  const [busy, setBusy] = useState<"save" | "prompt" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const isPreset = openRouterModelOptions.some((option) => option.value === dashboard.aiSettings.model);
    setModelChoice(isPreset ? dashboard.aiSettings.model : "custom");
    setCustomModel(isPreset ? "" : dashboard.aiSettings.model);
  }, [dashboard.aiSettings.model]);

  const selectedModel = modelChoice === "custom" ? customModel : modelChoice;

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    setBusy("save");
    setError(null);
    try {
      await onSaveAiSettings({
        model: selectedModel,
        openRouterApiKey: apiKey || undefined
      });
      setApiKey("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI settings could not be saved");
    } finally {
      setBusy(null);
    }
  }

  async function runPrompt(event: FormEvent) {
    event.preventDefault();
    setBusy("prompt");
    setError(null);
    setAiResult(null);
    try {
      setAiResult(
        await onRunAiPrompt({
          prompt,
          systemPrompt: "You are the finance dashboard AI assistant. Be concise and operational."
        })
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "AI prompt failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="settings-stack">
      <section className="panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">AI settings</p>
            <h2>OpenRouter model for website and backend tasks</h2>
          </div>
          <span className={`status-pill ${dashboard.aiSettings.apiKeyConfigured ? "good" : "warning"}`}>
            {dashboard.aiSettings.apiKeyConfigured ? `Key ${dashboard.aiSettings.apiKeyPreview}` : "No key"}
          </span>
        </div>
        <form className="settings-form" onSubmit={saveSettings}>
          <label>
            OpenRouter API key
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={dashboard.aiSettings.apiKeyConfigured ? "Leave blank to keep saved key" : "sk-or-v1..."}
              autoComplete="off"
            />
          </label>
          <div className="form-grid">
            <label>
              Model
              <select value={modelChoice} onChange={(event) => setModelChoice(event.target.value)}>
                {openRouterModelOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Model slug
              <input
                value={selectedModel}
                onChange={(event) => {
                  setModelChoice("custom");
                  setCustomModel(event.target.value);
                }}
              />
            </label>
          </div>
          {error && <div className="inline-error">{error}</div>}
          <div className="modal-actions">
            <button className="primary-button" type="submit" disabled={busy === "save"}>
              {busy === "save" ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
              Save AI settings
            </button>
          </div>
        </form>
        <form className="settings-form ai-prompt-form" onSubmit={runPrompt}>
          <label>
            Prompt
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={3} />
          </label>
          <div className="modal-actions">
            <button className="secondary-button" type="submit" disabled={busy === "prompt" || !dashboard.aiSettings.apiKeyConfigured}>
              {busy === "prompt" ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}
              Run prompt
            </button>
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
                <span className={`status-pill ${integration.configured ? "good" : integration.mode === "partial" ? "warning" : ""}`}>
                  {integration.mode}
                </span>
              </div>
              <p>{integration.message}</p>
              <div className="need-list">
                {integration.needs.length > 0 ? integration.needs.map((need) => <code key={need}>{need}</code>) : <code>configured</code>}
              </div>
            </article>
          ))}
        </div>

        <div className="docs-note">
          <strong>Integration shape</strong>
          <span>
            Wise pulls balances and statements for reconciliation. Partner revenue pulls from TUNE and creates Merit invoices. Slash has its own
            card/cashback page. Marking paid here never marks paid in Merit.
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
  const [providerId, setProviderId] = useState(provider?.id || "");
  const [customerName, setCustomerName] = useState(bankInvoiceName(transaction));
  const [amount, setAmount] = useState(String(transaction.amount));
  const [dueDate, setDueDate] = useState("2026-06-30");
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
            <p className="eyebrow">Merit invoice</p>
            <h2>Create invoice from transaction</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="transaction-summary">
          <span>{transaction.counterparty}</span>
          <strong>{money(transaction.amount, transaction.currency)}</strong>
          <small>{transaction.rawName}</small>
        </div>
        {error && <div className="inline-error">{error}</div>}
        <label>
          Internal match
          <select
            value={providerId}
            onChange={(event) => {
              setProviderId(event.target.value);
            }}
          >
            <option value="">No provider selected</option>
            {providers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Invoice name
          <input value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
        </label>
        <div className="form-grid">
          <label>
            Amount
            <input type="number" min="0" step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </label>
          <label>
            Due date
            <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
          </label>
        </div>
        <label>
          Description
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} />
        </label>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-button" disabled={submitting}>
            {submitting ? <Loader2 className="spin" size={16} /> : <FilePlus2 size={16} />}
            Create
          </button>
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
  const [type, setType] = useState<ProviderType>(provider?.type ?? "provider");
  const [category, setCategory] = useState(provider?.category ?? "Provider");
  const [aliases, setAliases] = useState(provider?.aliases.join(", ") ?? "");
  const [defaultAccount, setDefaultAccount] = useState(provider?.defaultAccount ?? "");
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
        category,
        aliases: aliases.split(",").map((alias) => alias.trim()).filter(Boolean),
        defaultAccount: defaultAccount.trim() || undefined
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Provider could not be saved");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="modal" onSubmit={handleSubmit}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Directory setup</p>
            <h2>{provider ? "Edit company" : "Add company or platform"}</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {error && <div className="inline-error">{error}</div>}
        <label>
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Position2, Facebook Direct, client name" />
        </label>
        <div className="form-grid">
          <label>
            Type
            <select value={type} onChange={(event) => setType(event.target.value as ProviderType)}>
              <option value="partner">Partner</option>
              <option value="provider">Provider</option>
              <option value="platform">Platform</option>
              <option value="internal">Internal</option>
            </select>
          </label>
          <label>
            Category
            <input value={category} onChange={(event) => setCategory(event.target.value)} />
          </label>
        </div>
        <label>
          Default account
          <input value={defaultAccount} onChange={(event) => setDefaultAccount(event.target.value)} placeholder="Optional payout or spend account" />
        </label>
        <label>
          Aliases
          <textarea
            value={aliases}
            onChange={(event) => setAliases(event.target.value)}
            rows={3}
            placeholder="Comma-separated bank names, card merchant names, abbreviations"
          />
        </label>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-button" disabled={submitting}>
            {submitting ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
            Save
          </button>
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
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        {error && <div className="inline-error">{error}</div>}
        <div className="form-grid">
          <label>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label>
            Affiliate ID
            <input value={affiliateId} onChange={(event) => setAffiliateId(event.target.value)} />
          </label>
        </div>
        <div className="form-grid">
          <label>
            External ID
            <input value={externalId} onChange={(event) => setExternalId(event.target.value)} />
          </label>
          <label>
            Currency
            <input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} />
          </label>
        </div>
        <div className="form-grid">
          <label>
            Timezone
            <select value={timezone} onChange={(event) => setTimezone(event.target.value)}>
              {timezoneOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Network timezone
            <select value={networkTimezone} onChange={(event) => setNetworkTimezone(event.target.value)}>
              {timezoneOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="form-grid">
          <label>
            Network ID env
            <input value={networkIdEnv} onChange={(event) => setNetworkIdEnv(event.target.value)} />
          </label>
          <label>
            API key env
            <input value={apiKeyEnv} onChange={(event) => setApiKeyEnv(event.target.value)} />
          </label>
        </div>
        <label>
          API base URL env
          <input value={apiBaseUrlEnv} onChange={(event) => setApiBaseUrlEnv(event.target.value)} />
        </label>
        <div className="form-grid">
          <label>
            Merit customer
            <input value={meritCustomerName} onChange={(event) => setMeritCustomerName(event.target.value)} />
          </label>
          <label>
            Invoice due days
            <input type="number" min="0" step="1" value={invoiceDueDays} onChange={(event) => setInvoiceDueDays(event.target.value)} />
          </label>
        </div>
        <label className="check-row modal-check-row">
          <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          Enabled
        </label>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary-button" disabled={submitting}>
            {submitting ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
            Save
          </button>
        </div>
      </form>
    </div>
  );
}

export default App;
