import {
  ArrowDownRight,
  ArrowUpRight,
  BadgeDollarSign,
  Banknote,
  Building2,
  Check,
  CircleAlert,
  CircleDollarSign,
  FilePlus2,
  Filter,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Tags,
  WalletCards,
  X
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  CreateInvoicePayload,
  CreateProviderPayload,
  DashboardSnapshot,
  Provider,
  ProviderType,
  Transaction
} from "../shared/types";

const apiBase = import.meta.env.VITE_API_BASE || "/api";
const months = ["June", "May", "April", "March"];

function money(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2
  }).format(value);
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
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(value));
}

function providerLabel(provider?: Provider): string {
  return provider ? provider.name : "Unmatched";
}

function sourceLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function App() {
  const [dashboard, setDashboard] = useState<DashboardSnapshot | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "transactions" | "providers" | "integrations">("overview");
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [matchFilter, setMatchFilter] = useState("needs-review");
  const [selectedProviders, setSelectedProviders] = useState<Record<string, string>>({});
  const [invoiceTransaction, setInvoiceTransaction] = useState<Transaction | null>(null);
  const [providerModalOpen, setProviderModalOpen] = useState(false);

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

  const filteredTransactions = useMemo(() => {
    const rows = dashboard?.transactions ?? [];
    const query = searchTerm.trim().toLowerCase();
    return rows.filter((transaction) => {
      const matchesSource = sourceFilter === "all" || transaction.source === sourceFilter;
      const provider = transaction.matchedProviderId ? providersById.get(transaction.matchedProviderId) : undefined;
      const matchesQuery =
        !query ||
        [transaction.counterparty, transaction.description, transaction.rawName, provider?.name ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(query);
      const needsReview = !transaction.matchedProviderId || (transaction.confidence ?? 0) < 0.86;
      const matchesStatus =
        matchFilter === "all" ||
        (matchFilter === "needs-review" && needsReview) ||
        (matchFilter === "matched" && !needsReview);
      return matchesSource && matchesQuery && matchesStatus;
    });
  }, [dashboard?.transactions, matchFilter, providersById, searchTerm, sourceFilter]);

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
      setNotice("Sync complete. Live credentials will replace seeded rows when env vars are set.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setIsSyncing(false);
    }
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
    setNotice("Invoice created. It is a QuickBooks draft simulation until QuickBooks credentials are configured.");
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

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Finance operations</p>
          <h1>Cash flow and open balance control</h1>
          <div className="meta-row">
            <span>Sheet seed: {dateLabel(dashboard.asOf)}</span>
            <span>Last sync: {dateLabel(dashboard.lastSync)}</span>
          </div>
        </div>
        <div className="topbar-actions">
          <button className="secondary-button" onClick={() => setProviderModalOpen(true)}>
            <Plus size={16} />
            Provider
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

      <section className="metric-grid" aria-label="Finance summary">
        <MetricCard icon={<Banknote />} label="Cash in accounts" value={money(dashboard.metrics.totalCash)} detail="Wise, Slash, Revolut, crypto" />
        <MetricCard icon={<BadgeDollarSign />} label="Receivables" value={money(dashboard.metrics.totalReceivables)} detail="Open invoices, VAT, tax" />
        <MetricCard icon={<WalletCards />} label="Open balance" value={money(dashboard.metrics.totalOpenBalance)} detail="Customer and provider balances" />
        <MetricCard icon={<ArrowDownRight />} label="Payables" value={money(dashboard.metrics.totalPayables)} detail="Unpaid platform/provider spend" danger />
        <MetricCard icon={<CircleDollarSign />} label="Profit" value={money(dashboard.metrics.profit)} detail={`${dashboard.metrics.profitGrowth.toFixed(2)}% vs last week`} good />
        <MetricCard icon={<ShieldCheck />} label="Total assets" value={money(dashboard.metrics.totalAssets)} detail={`${money(dashboard.metrics.investments)} investments`} />
      </section>

      <nav className="tabbar" aria-label="Dashboard views">
        <button className={activeTab === "overview" ? "active" : ""} onClick={() => setActiveTab("overview")}>
          <SlidersHorizontal size={16} />
          Overview
        </button>
        <button className={activeTab === "transactions" ? "active" : ""} onClick={() => setActiveTab("transactions")}>
          <Link2 size={16} />
          Reconcile
        </button>
        <button className={activeTab === "providers" ? "active" : ""} onClick={() => setActiveTab("providers")}>
          <Tags size={16} />
          Providers
        </button>
        <button className={activeTab === "integrations" ? "active" : ""} onClick={() => setActiveTab("integrations")}>
          <Sparkles size={16} />
          APIs
        </button>
      </nav>

      {activeTab === "overview" && (
        <Overview dashboard={dashboard} providersById={providersById} onOpenInvoice={setInvoiceTransaction} onQuickMatch={matchTransaction} />
      )}

      {activeTab === "transactions" && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Reconciliation queue</p>
              <h2>Bank activity that needs a provider, invoice, or rule</h2>
            </div>
            <div className="filters">
              <label className="search-box">
                <Search size={15} />
                <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Search transactions" />
              </label>
              <label>
                <Filter size={15} />
                <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
                  <option value="all">All sources</option>
                  <option value="wise">Wise</option>
                  <option value="slash">Slash</option>
                  <option value="quickbooks">QuickBooks</option>
                </select>
              </label>
              <label>
                <select value={matchFilter} onChange={(event) => setMatchFilter(event.target.value)}>
                  <option value="needs-review">Needs review</option>
                  <option value="matched">Matched</option>
                  <option value="all">All rows</option>
                </select>
              </label>
            </div>
          </div>
          <TransactionTable
            rows={filteredTransactions}
            providers={dashboard.providers}
            providersById={providersById}
            selectedProviders={selectedProviders}
            setSelectedProviders={setSelectedProviders}
            onMatch={matchTransaction}
            onOpenInvoice={setInvoiceTransaction}
          />
        </section>
      )}

      {activeTab === "providers" && (
        <ProvidersView providers={dashboard.providers} onAdd={() => setProviderModalOpen(true)} />
      )}

      {activeTab === "integrations" && (
        <IntegrationsView dashboard={dashboard} />
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
          onClose={() => setProviderModalOpen(false)}
          onSubmit={async (payload) => {
            await submitProvider(payload);
            setProviderModalOpen(false);
            setNotice("Provider saved. Add aliases anytime by matching transactions to it.");
          }}
        />
      )}
    </main>
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

  return (
    <div className="overview-grid">
      <section className="panel">
        <div className="panel-header compact">
          <h2>Cash in accounts</h2>
          <span className="total-pill">{money(dashboard.metrics.totalCash)}</span>
        </div>
        <SimpleMoneyTable
          rows={dashboard.accounts.map((item) => ({
            id: item.id,
            name: item.name,
            amount: item.balance,
            currency: item.currency,
            source: sourceLabel(item.source)
          }))}
        />
      </section>

      <section className="panel">
        <div className="panel-header compact">
          <h2>Receivables</h2>
          <span className="total-pill">{money(dashboard.metrics.totalReceivables)}</span>
        </div>
        <SimpleMoneyTable
          rows={dashboard.receivables.map((item) => ({
            id: item.id,
            name: item.name,
            amount: item.balance,
            currency: item.currency,
            source: sourceLabel(item.source)
          }))}
        />
      </section>

      <section className="panel tall">
        <div className="panel-header compact">
          <h2>Open balance</h2>
          <span className="total-pill">{money(dashboard.metrics.totalOpenBalance)}</span>
        </div>
        <SimpleMoneyTable
          rows={dashboard.openBalances.map((item) => ({
            id: item.id,
            name: item.name,
            amount: item.balance,
            currency: item.currency,
            source: sourceLabel(item.source)
          }))}
          dense
        />
      </section>

      <section className="panel wide">
        <div className="panel-header compact">
          <h2>Payables by supplier and month</h2>
          <span className="total-pill danger">{money(dashboard.metrics.totalPayables)}</span>
        </div>
        <div className="table-wrap">
          <table className="data-table payables-table">
            <thead>
              <tr>
                <th>Supplier / platform</th>
                <th>Balance</th>
                {months.map((month) => (
                  <th key={month}>{month}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dashboard.payables.map((payable) => (
                <tr key={payable.id}>
                  <td>
                    <strong>{payable.supplier}</strong>
                    <small>{payable.category}</small>
                  </td>
                  <td className="amount danger-text">{money(payable.balance, payable.currency)}</td>
                  {months.map((month) => (
                    <td className="amount" key={month}>
                      {payable.monthBuckets[month] ? money(payable.monthBuckets[month], payable.currency) : "-"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="amount">{money(dashboard.metrics.totalPayables)}</td>
                {months.map((month) => (
                  <td className="amount" key={month}>
                    {dashboard.metrics.monthTotals[month] ? money(dashboard.metrics.monthTotals[month]) : "-"}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header compact">
          <h2>Assets bridge</h2>
          <span className="total-pill good">{money(dashboard.metrics.totalAssets)}</span>
        </div>
        <div className="bridge">
          <BridgeRow label="Cash + receivables + open balance" value={dashboard.metrics.totalFloat} />
          <BridgeRow label="Spend without payment" value={-dashboard.metrics.totalPayables} danger />
          <BridgeRow label="Profit" value={dashboard.metrics.profit} good />
          <BridgeRow label="Investments" value={dashboard.metrics.investments} />
          <BridgeRow label="Cashback redeemed from Slash" value={dashboard.metrics.cashbackRedeemed} />
          <BridgeRow label="Crypto difference from last week" value={dashboard.metrics.cryptoDifference} />
        </div>
      </section>

      <section className="panel">
        <div className="panel-header compact">
          <h2>Growth checks</h2>
          <span className="total-pill">{dashboard.metrics.cashGrowth.toFixed(2)}%</span>
        </div>
        <div className="growth-list">
          <GrowthItem label="Cash growth vs last week" value={dashboard.metrics.cashGrowth} />
          <GrowthItem label="Spend growth vs last week" value={dashboard.metrics.spendGrowth} danger />
          <GrowthItem label="Profit growth vs last week" value={dashboard.metrics.profitGrowth} />
        </div>
      </section>

      <section className="panel wide">
        <div className="panel-header compact">
          <h2>Needs review</h2>
          <span className="total-pill">{reviewRows.length} rows</span>
        </div>
        <div className="review-list">
          {reviewRows.map((transaction) => {
            const provider = transaction.matchedProviderId ? providersById.get(transaction.matchedProviderId) : undefined;
            return (
              <article className="review-row" key={transaction.id}>
                <div className={`direction-badge ${transaction.direction}`}>
                  {transaction.direction === "in" ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
                </div>
                <div>
                  <strong>{transaction.counterparty}</strong>
                  <span>{transaction.description}</span>
                </div>
                <div className="review-amount">{money(transaction.amount, transaction.currency)}</div>
                <div className="match-chip">{providerLabel(provider)}</div>
                <button className="icon-text-button" onClick={() => provider && onQuickMatch(transaction, provider.id)} disabled={!provider}>
                  <Link2 size={15} />
                  Match
                </button>
                <button className="icon-text-button" onClick={() => onOpenInvoice(transaction)}>
                  <FilePlus2 size={15} />
                  Invoice
                </button>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function SimpleMoneyTable({
  rows,
  dense
}: {
  rows: Array<{ id: string; name: string; amount: number; currency: string; source: string }>;
  dense?: boolean;
}) {
  return (
    <div className={`money-list ${dense ? "dense" : ""}`}>
      <div className="money-row money-head">
        <span>Account</span>
        <span>Source</span>
        <span>Balance</span>
      </div>
      {rows.map((row) => (
        <div className="money-row" key={row.id}>
          <span className="money-name" title={row.name}>
            {row.name}
          </span>
          <span className={`source-pill ${row.source.toLowerCase()}`}>{row.source}</span>
          <span className={`money-amount ${row.amount < 0 ? "danger-text" : ""}`}>
            {money(row.amount, row.currency)}
          </span>
        </div>
      ))}
    </div>
  );
}

function BridgeRow({ label, value, danger, good }: { label: string; value: number; danger?: boolean; good?: boolean }) {
  return (
    <div className="bridge-row">
      <span>{label}</span>
      <strong className={danger ? "danger-text" : good ? "good-text" : ""}>{money(value)}</strong>
    </div>
  );
}

function GrowthItem({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="growth-item">
      <span>{label}</span>
      <strong className={danger ? "danger-text" : "good-text"}>{value.toFixed(2)}%</strong>
    </div>
  );
}

function TransactionTable({
  rows,
  providers,
  providersById,
  selectedProviders,
  setSelectedProviders,
  onMatch,
  onOpenInvoice
}: {
  rows: Transaction[];
  providers: Provider[];
  providersById: Map<string, Provider>;
  selectedProviders: Record<string, string>;
  setSelectedProviders: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onMatch: (transaction: Transaction, providerId?: string) => void;
  onOpenInvoice: (transaction: Transaction) => void;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table transactions-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Source</th>
            <th>Counterparty</th>
            <th>Direction</th>
            <th>Amount</th>
            <th>Suggested provider</th>
            <th>Invoice</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((transaction) => {
            const provider = transaction.matchedProviderId ? providersById.get(transaction.matchedProviderId) : undefined;
            const selected = selectedProviders[transaction.id] || transaction.matchedProviderId || "";
            const confidence = transaction.confidence ?? 0;
            return (
              <tr key={transaction.id}>
                <td>{dateLabel(transaction.date)}</td>
                <td>
                  <span className={`source-pill ${transaction.source}`}>{sourceLabel(transaction.source)}</span>
                </td>
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
          })}
        </tbody>
      </table>
    </div>
  );
}

function ProvidersView({ providers, onAdd }: { providers: Provider[]; onAdd: () => void }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Alias memory</p>
          <h2>Companies, suppliers, platforms, and known bank names</h2>
        </div>
        <button className="secondary-button" onClick={onAdd}>
          <Plus size={16} />
          Add provider
        </button>
      </div>
      <div className="provider-grid">
        {providers.map((provider) => (
          <article className="provider-card" key={provider.id}>
            <div className="provider-card-head">
              <div className="provider-avatar">
                <Building2 size={18} />
              </div>
              <div>
                <strong>{provider.name}</strong>
                <span>{provider.type} · {provider.category}</span>
              </div>
            </div>
            <div className="alias-list">
              {[provider.name, ...provider.aliases].slice(0, 7).map((alias) => (
                <span key={alias}>{alias}</span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function IntegrationsView({ dashboard }: { dashboard: DashboardSnapshot }) {
  const missing = dashboard.integrationStatus.flatMap((item) => item.needs.map((need) => ({ source: item.label, need })));

  return (
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
          Wise pulls balance statements and can receive balance webhooks. Slash pulls accounts, virtual accounts, card activity,
          and transactions. QuickBooks creates invoices and should be the ledger of record for invoices, customers, payments, and linked
          transactions. Merit is left as an optional generic connector until the exact product/API is confirmed.
        </span>
      </div>
    </section>
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
  const [customerName, setCustomerName] = useState(provider?.name || transaction.counterparty);
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
            <p className="eyebrow">QuickBooks invoice</p>
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
          Provider
          <select
            value={providerId}
            onChange={(event) => {
              const selected = providers.find((item) => item.id === event.target.value);
              setProviderId(event.target.value);
              if (selected) setCustomerName(selected.name);
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
          Customer name
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
  onClose,
  onSubmit
}: {
  onClose: () => void;
  onSubmit: (payload: CreateProviderPayload) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<ProviderType>("supplier");
  const [category, setCategory] = useState("Provider");
  const [aliases, setAliases] = useState("");
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
        aliases: aliases.split(",").map((alias) => alias.trim()).filter(Boolean)
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
            <p className="eyebrow">Provider setup</p>
            <h2>Add company or platform</h2>
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
              <option value="supplier">Supplier</option>
              <option value="customer">Customer</option>
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

export default App;
