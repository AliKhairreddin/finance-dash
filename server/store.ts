import crypto from "node:crypto";
import type {
  AiPromptPayload,
  AiPromptResult,
  AssignTransactionTeamPayload,
  AutoCategorizeTransactionsPayload,
  AutoCategorizeTransactionsResult,
  CreateInvoicePayload,
  CreateProviderPayload,
  DashboardSnapshot,
  ImportWiseStatementPayload,
  ImportWiseStatementResult,
  ImportWiseStatementSummary,
  Invoice,
  MatchTransactionPayload,
  Provider,
  RevenuePartner,
  RevenueRun,
  SaveAiSettingsPayload,
  StoredAiSettings,
  SyncRevenuePayload,
  Team,
  Transaction,
  TransactionCategoryRule,
  UpdateProviderPayload,
  UpdateTransactionCategoryPayload,
  UpdateRevenuePartnerPayload,
  WiseStatementImport
} from "../shared/types";
import { defaultAiSettings, publicAiSettings, runOpenRouterPrompt, runOpenRouterTransactionCategorization } from "../shared/ai";
import { calculateInvoiceDueDate, calculateRevenueMetrics, resolveRevenuePeriod } from "../shared/revenue";
import { calculateMetrics } from "./calculations";
import {
  createMeritInvoice,
  fetchMeritInvoices,
  fetchRevolutActivity,
  fetchSlashActivity,
  fetchTuneRevenue,
  fetchWiseActivity,
  getIntegrationStatus,
  summarizeWiseStatementIssues,
  wiseStatementIssue
} from "./integrations";
import {
  enrichTransactions,
  learnAliases,
  learnCategoryAliases,
  mergeProviderDirectory,
  mergeTeamDirectory,
  semanticCategorizeTransaction,
  semanticMatchThreshold,
  transactionAliasCandidates
} from "./matching";
import { loadPersistedState, savePersistedState } from "./persistence";

let providers: Provider[] = [];
let invoices: Invoice[] = [];
let teams: Team[] = [];
let transactionCategoryRules: TransactionCategoryRule[] = [];
let revenuePartners: RevenuePartner[] = [];
let revenueRuns: RevenueRun[] = [];
let aiSettings: StoredAiSettings = { ...defaultAiSettings };
let transactionTeamAssignments: Array<{ transactionId: string; teamId: string; updatedAt: string }> = [];
let transactions: Transaction[] = [];
let wiseStatementTransactions: Transaction[] = [];
let wiseStatementImports: WiseStatementImport[] = [];
let accounts: DashboardSnapshot["accounts"] = [];
let lastSync = new Date().toISOString();
let wiseSyncIssue: string | undefined;

function mergeById<T extends { id: string }>(initial: T[], incoming?: T[]): T[] {
  const map = new Map(initial.map((item) => [item.id, item]));
  for (const item of incoming ?? []) {
    map.set(item.id, item);
  }
  return [...map.values()];
}

function normalizedTransactionText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function wiseStatementTransactionKey(transaction: Transaction): string {
  const sourceId = transaction.id.match(/^wise-(?:csv|pdf)-[^-]+-(.+)$/)?.[1];
  if (sourceId) return `${transaction.currency}:${sourceId}`;

  return [
    transaction.date,
    transaction.currency,
    transaction.direction,
    transaction.amount.toFixed(2),
    normalizedTransactionText(transaction.counterparty),
    normalizedTransactionText(transaction.description)
  ].join("|");
}

function mergeWiseStatementTransactions(initial: Transaction[], incoming: Transaction[]): Transaction[] {
  const map = new Map<string, Transaction>();
  for (const transaction of [...initial, ...incoming]) {
    map.set(wiseStatementTransactionKey(transaction), transaction);
  }
  return [...map.values()];
}

function summarizeWiseStatementImport(existing: Transaction[], incoming: Transaction[]): ImportWiseStatementSummary {
  const existingKeys = new Set(existing.map((transaction) => wiseStatementTransactionKey(transaction)));
  const incomingKeys = new Set<string>();
  let newTransactions = 0;
  let duplicateTransactions = 0;

  for (const transaction of incoming) {
    const key = wiseStatementTransactionKey(transaction);
    if (existingKeys.has(key) || incomingKeys.has(key)) {
      duplicateTransactions += 1;
    } else {
      newTransactions += 1;
      incomingKeys.add(key);
    }
  }

  return {
    processedTransactions: incoming.length,
    newTransactions,
    duplicateTransactions
  };
}

function realInvoices(rows?: Invoice[]): Invoice[] {
  return (rows ?? []).filter(
    (invoice) => invoice.source !== "mock" && !invoice.id.startsWith("mock-invoice-") && invoice.externalId !== "seed-open-invoices"
  );
}

function realRevenueRuns(rows?: RevenueRun[]): RevenueRun[] {
  return (rows ?? []).filter((run) => run.status !== "mock");
}

export async function initializeStore(): Promise<void> {
  const persisted = await loadPersistedState();
  providers = mergeProviderDirectory(persisted.providers ?? []);
  invoices = realInvoices(persisted.invoices);
  teams = mergeTeamDirectory(persisted.teams ?? []);
  transactionCategoryRules = persisted.transactionCategoryRules ?? [];
  revenuePartners = persisted.revenuePartners ?? [];
  revenueRuns = realRevenueRuns(persisted.revenueRuns);
  aiSettings = persisted.aiSettings ?? { ...defaultAiSettings };
  transactionTeamAssignments = persisted.transactionTeamAssignments ?? [];
  wiseStatementTransactions = persisted.wiseStatementTransactions ?? [];
  wiseStatementImports = persisted.wiseStatementImports ?? [];
}

async function persist(): Promise<void> {
  await savePersistedState({
    providers,
    invoices,
    teams,
    transactionCategoryRules,
    revenuePartners,
    transactionTeamAssignments,
    wiseStatementTransactions,
    wiseStatementImports,
    revenueRuns,
    aiSettings
  });
}

function bankAliasNames(transaction: Transaction): string[] {
  return transactionAliasCandidates(transaction);
}

function cleanOptional(value?: string): string | undefined {
  return value?.trim() || undefined;
}

function cleanOptionalNumber(value?: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function companyDetails(payload: CreateProviderPayload | UpdateProviderPayload): Pick<
  Provider,
  | "defaultAccount"
  | "legalName"
  | "email"
  | "country"
  | "address"
  | "taxId"
  | "defaultCurrency"
  | "paymentTermsDays"
  | "meritCustomerId"
  | "meritSupplierId"
> {
  return {
    defaultAccount: cleanOptional(payload.defaultAccount),
    legalName: cleanOptional(payload.legalName),
    email: cleanOptional(payload.email),
    country: cleanOptional(payload.country),
    address: cleanOptional(payload.address),
    taxId: cleanOptional(payload.taxId),
    defaultCurrency: cleanOptional(payload.defaultCurrency),
    paymentTermsDays: cleanOptionalNumber(payload.paymentTermsDays),
    meritCustomerId: cleanOptional(payload.meritCustomerId),
    meritSupplierId: cleanOptional(payload.meritSupplierId)
  };
}

function applyTeamAssignments(rows: Transaction[]): Transaction[] {
  const teamByTransaction = new Map(transactionTeamAssignments.map((assignment) => [assignment.transactionId, assignment.teamId]));
  return rows.map((transaction) => {
    const teamId = teamByTransaction.get(transaction.id);
    return teamId ? { ...transaction, teamId } : transaction;
  });
}

function getMatchedTransactions(): Transaction[] {
  const invoiceByTransaction = new Map(invoices.filter((invoice) => invoice.transactionId).map((invoice) => [invoice.transactionId, invoice]));
  const withInvoiceMatches = mergeById(wiseStatementTransactions, transactions).map((transaction) => {
    const invoice = invoiceByTransaction.get(transaction.id);
    return invoice
      ? { ...transaction, matchedInvoiceId: invoice.id, matchedProviderId: invoice.providerId ?? transaction.matchedProviderId }
      : transaction;
  });
  return enrichTransactions(applyTeamAssignments(withInvoiceMatches), providers, transactionCategoryRules);
}

function getKnownTransactions(): Transaction[] {
  return mergeById(wiseStatementTransactions, transactions);
}

function findKnownTransaction(transactionId: string): Transaction | undefined {
  return getKnownTransactions().find((transaction) => transaction.id === transactionId);
}

function updateStoredTransaction(updated: Transaction): boolean {
  let stored = false;
  wiseStatementTransactions = wiseStatementTransactions.map((transaction) => {
    if (transaction.id !== updated.id) return transaction;
    stored = true;
    return { ...transaction, ...updated };
  });
  transactions = transactions.map((transaction) => {
    if (transaction.id !== updated.id) return transaction;
    stored = true;
    return { ...transaction, ...updated };
  });
  return stored;
}

function transactionNeedsCategorization(transaction: Transaction): boolean {
  return !transaction.matchedProviderId || (transaction.confidence ?? 0) < semanticMatchThreshold;
}

function applySemanticCategorization(transaction: Transaction): { transaction: Transaction; matched: boolean; categorizedOnly: boolean } {
  const categorized = semanticCategorizeTransaction(transaction, providers, transactionCategoryRules);
  return {
    transaction: categorized,
    matched: Boolean(categorized.matchedProviderId && categorized.matchedProviderId !== transaction.matchedProviderId),
    categorizedOnly: !categorized.matchedProviderId && categorized.category !== transaction.category
  };
}

function applyAiCategorization(
  transaction: Transaction,
  match: { providerId?: string; category?: string; confidence: number; reason: string }
): Transaction {
  const provider = match.providerId ? providers.find((item) => item.id === match.providerId) : undefined;
  return {
    ...transaction,
    matchedProviderId: provider?.id ?? transaction.matchedProviderId,
    category: match.category ?? transaction.category,
    confidence: match.confidence,
    matchReason: `AI: ${match.reason}`
  };
}

export async function autoCategorizeTransactions(
  payload: AutoCategorizeTransactionsPayload = {}
): Promise<AutoCategorizeTransactionsResult> {
  providers = mergeProviderDirectory(providers);
  const targetIds = payload.transactionIds?.length ? new Set(payload.transactionIds) : undefined;
  let semanticMatches = 0;
  let categorizedOnly = 0;
  let reviewed = 0;

  const categorizeRow = (transaction: Transaction): Transaction => {
    if (targetIds && !targetIds.has(transaction.id)) return transaction;
    if (!transactionNeedsCategorization(transaction)) return transaction;
    reviewed += 1;
    const result = applySemanticCategorization(transaction);
    if (result.matched) semanticMatches += 1;
    if (result.categorizedOnly) categorizedOnly += 1;
    return result.transaction;
  };

  wiseStatementTransactions = wiseStatementTransactions.map(categorizeRow);
  transactions = transactions.map(categorizeRow);

  let aiMatches = 0;
  const shouldUseAi = payload.useAi !== false && Boolean(aiSettings.openRouterApiKey?.trim());
  const remaining = getKnownTransactions().filter((transaction) => {
    if (targetIds && !targetIds.has(transaction.id)) return false;
    return transactionNeedsCategorization(transaction);
  });

  if (shouldUseAi && remaining.length > 0) {
    const aiResults = await runOpenRouterTransactionCategorization(aiSettings, remaining, providers, process.env.PUBLIC_APP_URL);
    for (const aiResult of aiResults) {
      if (aiResult.confidence < 0.72) continue;
      const transaction = findKnownTransaction(aiResult.transactionId);
      if (!transaction) continue;
      const updated = applyAiCategorization(transaction, aiResult);
      if (!updateStoredTransaction(updated)) continue;
      if (updated.matchedProviderId) {
        aiMatches += 1;
        const provider = providers.find((item) => item.id === updated.matchedProviderId);
        if (provider) {
          providers = providers.map((item) => (item.id === provider.id ? learnAliases(item, bankAliasNames(transaction)) : item));
        }
      } else {
        categorizedOnly += 1;
      }
    }
  }

  await persist();
  return {
    dashboard: getSnapshot(),
    semanticMatches,
    aiMatches,
    categorizedOnly,
    reviewed
  };
}

export function getSnapshot(): DashboardSnapshot {
  const metrics = calculateMetrics(accounts, [], [], [], []);
  return {
    asOf: new Date().toISOString(),
    accounts,
    receivables: [],
    openBalances: [],
    payables: [],
    investments: [],
    providers,
    teams,
    revenuePartners,
    revenueRuns,
    revenueMetrics: calculateRevenueMetrics(revenuePartners, revenueRuns),
    aiSettings: publicAiSettings(aiSettings),
    transactions: getMatchedTransactions(),
    invoices,
    transactionCategoryRules,
    wiseStatementImports,
    integrationStatus: getIntegrationStatus(wiseSyncIssue),
    metrics,
    lastSync
  };
}

function wiseImportId(payload: ImportWiseStatementPayload): string {
  return `wise-import-${payload.balanceId}-${payload.currency}-${payload.periodStart}-${payload.periodEnd}`;
}

function normalizeImportedWiseTransactions(payload: ImportWiseStatementPayload): Transaction[] {
  return payload.transactions
    .filter((transaction) => transaction.id && transaction.date && Number.isFinite(transaction.amount))
    .map((transaction) => ({
      id: transaction.id,
      source: "wise" as const,
      accountName: transaction.accountName || `Wise ${payload.currency}`,
      date: transaction.date,
      description: transaction.description || transaction.counterparty || "Wise statement transaction",
      rawName: transaction.rawName || transaction.counterparty || transaction.description || "Wise statement transaction",
      counterparty: transaction.counterparty || transaction.rawName || transaction.description || "Wise statement transaction",
      amount: Math.abs(transaction.amount),
      currency: payload.currency,
      direction: transaction.direction,
      status: "posted" as const,
      category: transaction.category || "Wise"
    }));
}

export async function importWiseStatement(payload: ImportWiseStatementPayload): Promise<ImportWiseStatementResult> {
  if (!payload.balanceId || !payload.currency || !payload.periodStart || !payload.periodEnd || !payload.fileName) {
    throw new Error("balanceId, currency, periodStart, periodEnd, and fileName are required");
  }

  const importedTransactions = normalizeImportedWiseTransactions(payload);
  const summary = summarizeWiseStatementImport(wiseStatementTransactions, importedTransactions);
  const importedAt = new Date().toISOString();
  const importRecord: WiseStatementImport = {
    id: wiseImportId(payload),
    balanceId: payload.balanceId,
    currency: payload.currency,
    periodStart: payload.periodStart,
    periodEnd: payload.periodEnd,
    fileName: payload.fileName,
    transactionCount: importedTransactions.length,
    importedAt
  };

  wiseStatementTransactions = mergeWiseStatementTransactions(wiseStatementTransactions, importedTransactions).sort((left, right) =>
    right.date.localeCompare(left.date)
  );
  wiseStatementImports = [importRecord, ...wiseStatementImports.filter((item) => item.id !== importRecord.id)].sort((left, right) =>
    right.importedAt.localeCompare(left.importedAt)
  );
  const categorization = await autoCategorizeTransactions({
    transactionIds: importedTransactions.map((transaction) => transaction.id),
    useAi: true
  });
  return {
    dashboard: categorization.dashboard,
    summary
  };
}

export async function assignTransactionTeam(payload: AssignTransactionTeamPayload): Promise<Transaction> {
  const transaction = findKnownTransaction(payload.transactionId);
  if (!transaction) {
    throw new Error("Transaction not found");
  }
  if (payload.teamId && !teams.some((team) => team.id === payload.teamId)) {
    throw new Error("Team not found");
  }

  transactionTeamAssignments = transactionTeamAssignments.filter((assignment) => assignment.transactionId !== payload.transactionId);
  if (payload.teamId) {
    transactionTeamAssignments = [
      { transactionId: payload.transactionId, teamId: payload.teamId, updatedAt: new Date().toISOString() },
      ...transactionTeamAssignments
    ];
  }

  await persist();
  return getMatchedTransactions().find((item) => item.id === payload.transactionId)!;
}

export async function createProvider(payload: CreateProviderPayload): Promise<Provider> {
  const provider: Provider = {
    id: `provider-${crypto.randomUUID()}`,
    name: payload.name.trim(),
    type: payload.type,
    category: payload.category.trim() || "Uncategorized",
    aliases: payload.aliases.map((alias) => alias.trim()).filter(Boolean),
    ...companyDetails(payload),
    source: "manual",
    createdAt: new Date().toISOString()
  };
  providers = mergeProviderDirectory([...providers, provider]);
  await persist();
  return provider;
}

export async function updateProvider(providerId: string, payload: UpdateProviderPayload): Promise<Provider> {
  let updated: Provider | undefined;
  providers = providers.map((provider) => {
    if (provider.id !== providerId) return provider;
    updated = {
      ...provider,
      name: payload.name.trim(),
      type: payload.type,
      category: payload.category.trim() || "Uncategorized",
      aliases: payload.aliases.map((alias) => alias.trim()).filter(Boolean),
      ...companyDetails(payload)
    };
    return updated;
  });
  if (!updated) throw new Error("Provider not found");
  providers = mergeProviderDirectory(providers);
  await persist();
  return updated;
}

export async function updateRevenuePartner(partnerId: string, payload: UpdateRevenuePartnerPayload): Promise<RevenuePartner> {
  let updated: RevenuePartner | undefined;
  revenuePartners = revenuePartners.map((partner) => {
    if (partner.id !== partnerId) return partner;
    updated = {
      ...partner,
      name: payload.name.trim(),
      affiliateId: payload.affiliateId.trim(),
      externalId: payload.externalId?.trim() || undefined,
      currency: payload.currency.trim() || "USD",
      timezone: payload.timezone,
      networkTimezone: payload.networkTimezone,
      networkIdEnv: payload.networkIdEnv.trim(),
      apiKeyEnv: payload.apiKeyEnv.trim(),
      apiBaseUrlEnv: payload.apiBaseUrlEnv?.trim() || undefined,
      meritCustomerName: payload.meritCustomerName?.trim() || undefined,
      invoiceDueDays: payload.invoiceDueDays,
      enabled: payload.enabled
    };
    return updated;
  });
  if (!updated) throw new Error("Revenue partner not found");
  await persist();
  return updated;
}

export async function saveAiSettings(payload: SaveAiSettingsPayload): Promise<DashboardSnapshot> {
  const model = payload.model.trim();
  if (!model) throw new Error("OpenRouter model is required");

  const nextKey = payload.clearApiKey ? undefined : payload.openRouterApiKey?.trim() || aiSettings.openRouterApiKey;
  aiSettings = {
    provider: "openrouter",
    model,
    openRouterApiKey: nextKey,
    updatedAt: new Date().toISOString()
  };
  await persist();
  return getSnapshot();
}

export async function runAiPrompt(payload: AiPromptPayload): Promise<AiPromptResult> {
  return runOpenRouterPrompt(aiSettings, payload, process.env.PUBLIC_APP_URL);
}

export async function matchTransaction(payload: MatchTransactionPayload): Promise<Transaction> {
  const provider = providers.find((item) => item.id === payload.providerId);
  const transaction = findKnownTransaction(payload.transactionId);
  if (!provider || !transaction) {
    throw new Error("Company or transaction not found");
  }

  const matchedTransaction: Transaction = {
    ...transaction,
    matchedProviderId: payload.providerId,
    matchedInvoiceId: payload.invoiceId,
    confidence: 1,
    matchReason: "Approved company match"
  };
  updateStoredTransaction(matchedTransaction);

  if (payload.rememberAlias) {
    providers = providers.map((item) => (item.id === payload.providerId ? learnAliases(item, bankAliasNames(transaction)) : item));
  }

  await persist();
  return enrichTransactions([matchedTransaction], providers, transactionCategoryRules)[0];
}

export async function updateTransactionCategory(payload: UpdateTransactionCategoryPayload): Promise<Transaction> {
  const transaction = findKnownTransaction(payload.transactionId);
  if (!transaction) {
    throw new Error("Transaction not found");
  }

  const category = payload.category.trim() || "Uncategorized";
  const updated: Transaction = {
    ...transaction,
    category,
    matchReason: "Manual category"
  };
  updateStoredTransaction(updated);

  if (payload.rememberAlias) {
    transactionCategoryRules = learnCategoryAliases(transactionCategoryRules, transaction, category);
  }

  await persist();
  return enrichTransactions([updated], providers, transactionCategoryRules)[0];
}

export async function createInvoice(payload: CreateInvoicePayload): Promise<Invoice> {
  const invoice: Invoice = {
    id: `local-${payload.documentType}-${crypto.randomUUID()}`,
    providerId: payload.providerId,
    documentType: payload.documentType,
    customerName: payload.customerName.trim(),
    amount: payload.amount,
    currency: payload.currency,
    status: "draft",
    approvalStatus: "pending",
    paidLocally: false,
    meritPaid: false,
    dueDate: payload.dueDate,
    source: "manual",
    description: payload.description.trim(),
    transactionId: payload.transactionId,
    createdAt: new Date().toISOString()
  };

  invoices = [invoice, ...invoices];
  if (payload.transactionId && payload.providerId) {
    const sourceTransaction = findKnownTransaction(payload.transactionId);
    if (sourceTransaction) {
      providers = providers.map((provider) =>
        provider.id === payload.providerId ? learnAliases(provider, bankAliasNames(sourceTransaction)) : provider
      );
      const provider = providers.find((item) => item.id === payload.providerId);
      if (provider) {
        updateStoredTransaction({
          ...sourceTransaction,
          matchedProviderId: payload.providerId,
          matchedInvoiceId: invoice.id,
          confidence: 1,
          matchReason: payload.documentType === "sales_invoice" ? "Sales invoice draft created" : "Supplier bill draft created"
        });
      }
    }
  }
  await persist();
  return invoice;
}

export async function syncRevenue(payload: SyncRevenuePayload = {}): Promise<DashboardSnapshot> {
  const selectedPartners = revenuePartners.filter((partner) => partner.enabled && (!payload.partnerId || partner.id === payload.partnerId));
  if (selectedPartners.length === 0) {
    throw new Error("No revenue partner found for this sync");
  }

  const nextRuns: RevenueRun[] = [];
  for (const partner of selectedPartners) {
    const period = resolveRevenuePeriod({
      periodPreset: payload.periodPreset,
      periodStart: payload.periodStart,
      periodEnd: payload.periodEnd,
      timezone: payload.timezone || partner.timezone || process.env.REVENUE_TIMEZONE || "UTC"
    });
    const existingInvoicedRun = revenueRuns.find(
      (run) =>
        run.partnerId === partner.id &&
        run.periodStart === period.periodStart &&
        run.periodEnd === period.periodEnd &&
        run.status === "invoiced"
    );

    try {
      let run = await fetchTuneRevenue(partner, period);
      if (payload.createInvoices && existingInvoicedRun) {
        run = {
          ...run,
          status: "skipped",
          invoiceId: existingInvoicedRun.invoiceId,
          externalInvoiceId: existingInvoicedRun.externalInvoiceId,
          error: "Invoice already exists for this partner and period"
        };
      } else if (payload.createInvoices && run.revenue > 0 && run.status === "pulled") {
        const invoice = await createMeritInvoice({
          documentType: "sales_invoice",
          customerName: partner.meritCustomerName || partner.name,
          amount: run.revenue,
          currency: run.currency,
          dueDate: calculateInvoiceDueDate(period.periodEnd, partner.invoiceDueDays),
          description: `${partner.name} revenue for ${period.periodStart} to ${period.periodEnd} (${period.timezone})`
        });

        if (invoice) {
          invoices = [invoice, ...invoices.filter((item) => item.id !== invoice.id)];
          run = {
            ...run,
            status: "invoiced",
            invoiceId: invoice.id,
            externalInvoiceId: invoice.externalId
          };
        } else {
          run = {
            ...run,
            status: "pulled",
            error: "Revenue pulled, but Merit invoice credentials are not configured"
          };
        }
      }
      nextRuns.push(run);
    } catch (error) {
      nextRuns.push({
        id: `revenue-${partner.id}-${period.periodStart}-${period.periodEnd}-${Date.now()}`,
        partnerId: partner.id,
        partnerName: partner.name,
        source: "tune",
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
        timezone: period.timezone,
        revenue: 0,
        currency: partner.currency,
        status: "failed",
        error: error instanceof Error ? error.message : "Revenue sync failed",
        createdAt: new Date().toISOString()
      });
    }
  }

  const nextRunIds = new Set(nextRuns.map((run) => run.id));
  revenueRuns = [...nextRuns, ...revenueRuns.filter((run) => !nextRunIds.has(run.id))].slice(0, 250);
  lastSync = new Date().toISOString();
  await persist();
  return getSnapshot();
}

export async function setInvoiceApproval(invoiceId: string, approvalStatus: "approved" | "denied"): Promise<Invoice> {
  let updated: Invoice | undefined;
  invoices = invoices.map((invoice) => {
    if (invoice.id !== invoiceId) return invoice;
    updated = { ...invoice, approvalStatus };
    return updated;
  });
  if (!updated) throw new Error("Invoice not found");
  await persist();
  return updated;
}

export async function markInvoicePaidLocally(invoiceId: string): Promise<Invoice> {
  let updated: Invoice | undefined;
  invoices = invoices.map((invoice) => {
    if (invoice.id !== invoiceId) return invoice;
    updated = { ...invoice, paidLocally: true, paidLocallyAt: new Date().toISOString() };
    return updated;
  });
  if (!updated) throw new Error("Invoice not found");
  await persist();
  return updated;
}

export async function syncExternalActivity(): Promise<DashboardSnapshot> {
  const [wise, revolut, slash, merit] = await Promise.allSettled([
    fetchWiseActivity(),
    fetchRevolutActivity(),
    fetchSlashActivity(),
    fetchMeritInvoices()
  ]);
  const liveTransactions: Transaction[] = [];
  const liveSources = new Set<Transaction["source"]>();

  if (wise.status === "fulfilled") {
    wiseSyncIssue = summarizeWiseStatementIssues(wise.value.statementIssues);
    if (wise.value.accounts.length > 0) {
      accounts = [...accounts.filter((account) => account.source !== "wise"), ...wise.value.accounts];
      liveSources.add("wise");
    }
    if (wise.value.transactions.length > 0) liveSources.add("wise");
    liveTransactions.push(...wise.value.transactions);
  } else {
    wiseSyncIssue = wiseStatementIssue(wise.reason);
  }
  if (revolut.status === "fulfilled") {
    if (revolut.value.accounts.length > 0) {
      accounts = [...accounts.filter((account) => account.source !== "revolut"), ...revolut.value.accounts];
      liveSources.add("revolut");
    }
    if (revolut.value.transactions.length > 0) liveSources.add("revolut");
    liveTransactions.push(...revolut.value.transactions);
  }
  if (slash.status === "fulfilled") {
    if (slash.value.accounts.length > 0) {
      accounts = [...accounts.filter((account) => account.source !== "slash"), ...slash.value.accounts];
      liveSources.add("slash");
    }
    if (slash.value.transactions.length > 0) liveSources.add("slash");
    liveTransactions.push(...slash.value.transactions);
  }
  if (merit.status === "fulfilled" && merit.value.length > 0) {
    invoices = realInvoices(mergeById(merit.value, invoices));
  }

  if (liveSources.size > 0) {
    const existingIds = new Set(transactions.map((transaction) => transaction.id));
    transactions = [
      ...liveTransactions.filter((transaction) => !existingIds.has(transaction.id)),
      ...transactions.filter((transaction) => !liveSources.has(transaction.source))
    ];
  }

  lastSync = new Date().toISOString();
  return getSnapshot();
}
