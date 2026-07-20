import crypto from "node:crypto";
import type {
  AiPromptPayload,
  AiPromptResult,
  AssignTransactionTeamPayload,
  AssignWiseCardHolderTeamPayload,
  AutomationRun,
  AutoCategorizeTransactionsPayload,
  AutoCategorizeTransactionsResult,
  CreateHoldingPayload,
  CreateInvoicePayload,
  CreateProviderPayload,
  CreateRevenuePartnerPayload,
  CreateTeamPayload,
  DashboardSnapshot,
  FxRate,
  Holding,
  ImportWiseStatementPayload,
  ImportWiseStatementResult,
  ImportWiseStatementSummary,
  Invoice,
  MeritTax,
  MatchTransactionPayload,
  PaymentAllocation,
  PersistedAiSettings,
  ProfitDistributionAdjustment,
  Provider,
  RecordInvoicePaymentPayload,
  RevenueAccrual,
  RevenuePartner,
  RevenueRun,
  SaveProfitDistributionAdjustmentPayload,
  SaveAiSettingsPayload,
  SendInvoicesPayload,
  SendInvoicesResult,
  StoredAiSettings,
  SyncRevenuePayload,
  Team,
  Transaction,
  TransactionCategoryRule,
  TransactionTeamAssignment,
  UpdateHoldingPayload,
  UpdateInvoicePayload,
  UpdateProviderPayload,
  UpdateTransactionCategoryPayload,
  UpdateRevenuePartnerPayload,
  WiseCardHolderTeamAssignment,
  WiseStatementImport
} from "../shared/types";
import { defaultAiSettings, publicAiSettings, runOpenRouterPrompt, runOpenRouterTransactionCategorization } from "../shared/ai";
import { canonicalTeamId, canonicalTeamName } from "../shared/business";
import {
  isReviewOnlyTransactionCategory,
  isTransactionCategoryForDirection,
  transactionBusinessCategory
} from "../shared/categories";
import { deleteProviderReferences } from "../shared/providerDeletion";
import { calculateRevenueMetrics, mergeRevenuePartnerDirectory, resolveRevenuePeriod } from "../shared/revenue";
import {
  applyPaymentState,
  buildRevenueDraft,
  calculateApproximateUsdTotals,
  calculateInvoicePredictions,
  currentMonthAccrualPeriod,
  currentWeekAccrualPeriod,
  incomeAutomationTimezone,
  invoiceOutstanding,
  isClosedBillingPeriod,
  isLiquidAccountBalance,
  isLebanonIncomeAutomationTime,
  mergeFxRates,
  previousCalendarMonth,
  previousCompletedWeek,
  pruneSupersededAccrualRun,
  reconcileExactInvoicePayments,
  revenueInvoiceId
} from "../shared/income";
import {
  calculateProfitDistribution,
  profitDistributionAdjustmentFromPayload,
  shouldKeepProfitDistributionAdjustment
} from "../shared/distribution";
import { calculateMetrics } from "./calculations";
import {
  assertMeritWriteConfiguration,
  createMeritInvoice,
  deliverMeritInvoice,
  fetchAmexActivity,
  fetchMeritInvoices,
  fetchMeritTaxes,
  fetchRevolutActivity,
  fetchSlashActivity,
  fetchTuneRevenue,
  fetchWiseActivity,
  fetchCoinbaseUsdRates,
  getIntegrationStatus,
  meritConnectionIssue,
  summarizeWiseStatementIssues,
  wiseStatementIssue
} from "./integrations";
import {
  enrichTransactions,
  learnAliases,
  learnCategoryAliases,
  mergeWiseCardHolderTeamAssignments,
  mergeProviderDirectory,
  mergeTeamDirectory,
  normalizeCardHolderName,
  normalizeName,
  providerMatchesTransactionDirection,
  providerTypeForTransactionDirection,
  semanticCategorizeTransaction,
  semanticMatchThreshold,
  transactionAliasCandidates,
  uniqueProviderTags
} from "./matching";
import { loadPersistedState, savePersistedState } from "./persistence";

let providers: Provider[] = [];
let invoices: Invoice[] = [];
let paymentAllocations: PaymentAllocation[] = [];
let holdings: Holding[] = [];
let fxRates: FxRate[] = [];
let fxTrackedAssets: string[] = [];
let automationRuns: AutomationRun[] = [];
let meritTaxes: MeritTax[] = [];
let teams: Team[] = [];
let transactionCategoryRules: TransactionCategoryRule[] = [];
let revenuePartners: RevenuePartner[] = [];
let revenueRuns: RevenueRun[] = [];
let revenueAccruals: RevenueAccrual[] = [];
let aiSettings: PersistedAiSettings = { ...defaultAiSettings };
let transactionTeamAssignments: Array<{ transactionId: string; teamId: string; updatedAt: string }> = [];
let wiseCardHolderTeamAssignments: WiseCardHolderTeamAssignment[] = [];
let transactions: Transaction[] = [];
let wiseStatementTransactions: Transaction[] = [];
let wiseStatementImports: WiseStatementImport[] = [];
let profitDistributionAdjustments: ProfitDistributionAdjustment[] = [];
let accounts: DashboardSnapshot["accounts"] = [];
let lastSync = new Date().toISOString();
let wiseSyncIssue: string | undefined;
let meritSyncIssue: string | undefined;
let bankSyncIssues: Partial<Record<"revolut" | "slash" | "amex", string>> = {};

function runtimeAiSettings(): StoredAiSettings {
  return {
    ...aiSettings,
    openRouterApiKey: process.env.OPENROUTER_API_KEY?.trim() || undefined
  };
}

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

function mergeMeritInvoiceState(remoteInvoices: Invoice[]): void {
  const localByExternalId = new Map(
    invoices.filter((invoice) => invoice.externalId).map((invoice) => [invoice.externalId!, invoice])
  );
  const remoteOnly: Invoice[] = [];
  for (const remote of remoteInvoices) {
    const local = remote.externalId ? localByExternalId.get(remote.externalId) : undefined;
    if (!local) {
      remoteOnly.push(remote);
      continue;
    }
    const merged: Invoice = {
      ...local,
      meritStatus: remote.meritStatus,
      updatedAt: new Date().toISOString()
    };
    invoices = invoices.map((invoice) => (invoice.id === local.id ? merged : invoice));
  }
  const existingIds = new Set(invoices.map((invoice) => invoice.id));
  invoices = applyPaymentState(
    [...remoteOnly.filter((invoice) => !existingIds.has(invoice.id)), ...invoices],
    paymentAllocations
  );
}

function normalizedTeamAssignments(rows?: TransactionTeamAssignment[]): TransactionTeamAssignment[] {
  return (rows ?? []).map((assignment) => ({
    ...assignment,
    teamId: canonicalTeamId(assignment.teamId)
  }));
}

export async function initializeStore(): Promise<void> {
  const persisted = await loadPersistedState();
  providers = mergeProviderDirectory(persisted.providers ?? []);
  paymentAllocations = persisted.paymentAllocations ?? [];
  invoices = applyPaymentState(persisted.invoices ?? [], paymentAllocations);
  holdings = persisted.holdings ?? [];
  fxRates = persisted.fxRates ?? [];
  fxTrackedAssets = persisted.fxTrackedAssets ?? [];
  automationRuns = persisted.automationRuns ?? [];
  teams = mergeTeamDirectory(persisted.teams ?? []);
  transactionCategoryRules = persisted.transactionCategoryRules ?? [];
  revenuePartners = mergeRevenuePartnerDirectory(persisted.revenuePartners ?? []);
  revenueRuns = persisted.revenueRuns ?? [];
  revenueAccruals = persisted.revenueAccruals ?? [];
  aiSettings = persisted.aiSettings ?? { ...defaultAiSettings };
  transactionTeamAssignments = normalizedTeamAssignments(persisted.transactionTeamAssignments);
  wiseCardHolderTeamAssignments = mergeWiseCardHolderTeamAssignments(persisted.wiseCardHolderTeamAssignments ?? []);
  transactions = persisted.transactions ?? [];
  wiseStatementTransactions = persisted.wiseStatementTransactions ?? [];
  wiseStatementImports = persisted.wiseStatementImports ?? [];
  profitDistributionAdjustments = persisted.profitDistributionAdjustments ?? [];
}

async function persist(): Promise<void> {
  await savePersistedState({
    providers,
    invoices,
    paymentAllocations,
    holdings,
    fxRates,
    fxTrackedAssets,
    automationRuns,
    teams,
    transactionCategoryRules,
    revenuePartners,
    transactionTeamAssignments,
    wiseCardHolderTeamAssignments,
    transactions,
    wiseStatementTransactions,
    wiseStatementImports,
    profitDistributionAdjustments,
    revenueRuns,
    revenueAccruals,
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

function providerType(payload: CreateProviderPayload | UpdateProviderPayload): Provider["type"] {
  if (payload.type !== "client" && payload.type !== "supplier") {
    throw new Error("Company relationship must be client or supplier");
  }
  return payload.type;
}

function providerTypeForInvoiceDocument(documentType: CreateInvoicePayload["documentType"]): Provider["type"] {
  return documentType === "sales_invoice" ? "client" : "supplier";
}

function providerTags(payload: CreateProviderPayload | UpdateProviderPayload): string[] {
  return uniqueProviderTags(Array.isArray(payload.tags) ? payload.tags : []);
}

function applyTeamAssignments(rows: Transaction[]): Transaction[] {
  const teamByTransaction = new Map(transactionTeamAssignments.map((assignment) => [assignment.transactionId, assignment.teamId]));
  const teamByCardHolder = new Map(
    wiseCardHolderTeamAssignments.map((assignment) => [normalizeCardHolderName(assignment.cardHolderName), assignment.teamId])
  );
  return rows.map((transaction) => {
    const teamId =
      teamByTransaction.get(transaction.id) ??
      (transaction.cardHolderName ? teamByCardHolder.get(normalizeCardHolderName(transaction.cardHolderName)) : undefined) ??
      transaction.teamId;
    return teamId ? { ...transaction, teamId } : transaction;
  });
}

function getMatchedTransactions(): Transaction[] {
  const invoiceByTransaction = new Map(invoices.filter((invoice) => invoice.transactionId).map((invoice) => [invoice.transactionId!, invoice]));
  const allocationsByTransaction = new Map<string, PaymentAllocation[]>();
  for (const allocation of paymentAllocations) {
    if (!allocation.transactionId) continue;
    allocationsByTransaction.set(allocation.transactionId, [
      ...(allocationsByTransaction.get(allocation.transactionId) ?? []),
      allocation
    ]);
  }
  const withInvoiceMatches = mergeById(wiseStatementTransactions, transactions).map((transaction) => {
    const linkedAllocations = allocationsByTransaction.get(transaction.id) ?? [];
    const allocatedInvoice =
      linkedAllocations.length === 1
        ? invoices.find((invoice) => invoice.id === linkedAllocations[0].invoiceId)
        : undefined;
    const invoice = allocatedInvoice ?? invoiceByTransaction.get(transaction.id);
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

function reconcileStoredPayments(now = new Date()): number {
  const result = reconcileExactInvoicePayments({
    invoices: applyPaymentState(invoices, paymentAllocations),
    transactions: getKnownTransactions(),
    allocations: paymentAllocations,
    providers,
    now
  });
  const transactionById = new Map(result.transactions.map((transaction) => [transaction.id, transaction]));
  wiseStatementTransactions = wiseStatementTransactions.map(
    (transaction) => transactionById.get(transaction.id) ?? transaction
  );
  transactions = transactions.map((transaction) => transactionById.get(transaction.id) ?? transaction);
  invoices = result.invoices;
  paymentAllocations = result.allocations;
  return result.matched;
}

function transactionCategoryNeedsReview(transaction: Transaction): boolean {
  return isReviewOnlyTransactionCategory(transaction.category);
}

function transactionNeedsCategorization(transaction: Transaction): boolean {
  const needsIncomingCompany = transaction.direction === "in" && !transaction.matchedProviderId;
  const hasLowIncomingCompanyConfidence =
    transaction.direction === "in" && Boolean(transaction.matchedProviderId) && (transaction.confidence ?? 0) < semanticMatchThreshold;
  return transactionCategoryNeedsReview(transaction) || needsIncomingCompany || hasLowIncomingCompanyConfidence;
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
  const matchedProvider = provider && providerMatchesTransactionDirection(transaction, provider) ? provider : undefined;
  return {
    ...transaction,
    matchedProviderId: matchedProvider?.id ?? transaction.matchedProviderId,
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
  const activeAiSettings = runtimeAiSettings();
  const shouldUseAi = payload.useAi !== false && Boolean(activeAiSettings.openRouterApiKey);
  const remaining = getKnownTransactions().filter((transaction) => {
    if (targetIds && !targetIds.has(transaction.id)) return false;
    return transactionNeedsCategorization(transaction);
  });

  if (shouldUseAi && remaining.length > 0) {
    const aiResults = await runOpenRouterTransactionCategorization(activeAiSettings, remaining, providers, process.env.PUBLIC_APP_URL);
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
  const matchedTransactions = getMatchedTransactions();
  const paymentAwareInvoices = applyPaymentState(invoices, paymentAllocations);
  const approximateUsdTotals = calculateApproximateUsdTotals(accounts, holdings, fxRates);
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
    revenueAccruals,
    revenueMetrics: calculateRevenueMetrics(revenuePartners, revenueRuns),
    aiSettings: publicAiSettings(runtimeAiSettings()),
    transactions: matchedTransactions,
    invoices: paymentAwareInvoices,
    paymentAllocations,
    invoicePredictions: calculateInvoicePredictions(paymentAwareInvoices, paymentAllocations),
    holdings,
    fxRates,
    approximateUsdTotals,
    automationRuns,
    meritTaxes,
    transactionCategoryRules,
    wiseCardHolderTeamAssignments,
    wiseStatementImports,
    integrationStatus: getIntegrationStatus(
      wiseSyncIssue,
      revenuePartners,
      meritSyncIssue,
      bankSyncIssues,
      fxRates,
      approximateUsdTotals.excludedAssets,
      approximateUsdTotals.staleAssets
    ),
    metrics,
    profitDistribution: calculateProfitDistribution(matchedTransactions, profitDistributionAdjustments),
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
      category: transactionBusinessCategory(transaction.category || "Wise"),
      ...(transaction.cardHolderName ? { cardHolderName: transaction.cardHolderName.trim() } : {})
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
  await autoCategorizeTransactions({
    transactionIds: importedTransactions.map((transaction) => transaction.id),
    useAi: true
  });
  reconcileStoredPayments();
  await persist();
  return {
    dashboard: getSnapshot(),
    summary
  };
}

export async function assignTransactionTeam(payload: AssignTransactionTeamPayload): Promise<Transaction> {
  const transaction = findKnownTransaction(payload.transactionId);
  const teamId = payload.teamId ? canonicalTeamId(payload.teamId) : undefined;
  if (!transaction) {
    throw new Error("Transaction not found");
  }
  if (teamId && !teams.some((team) => team.id === teamId)) {
    throw new Error("Team not found");
  }

  transactionTeamAssignments = transactionTeamAssignments.filter((assignment) => assignment.transactionId !== payload.transactionId);
  if (teamId) {
    transactionTeamAssignments = [
      { transactionId: payload.transactionId, teamId, updatedAt: new Date().toISOString() },
      ...transactionTeamAssignments
    ];
  }

  await persist();
  return getMatchedTransactions().find((item) => item.id === payload.transactionId)!;
}

export async function assignWiseCardHolderTeam(payload: AssignWiseCardHolderTeamPayload): Promise<DashboardSnapshot> {
  const cardHolderName = payload.cardHolderName.trim().replace(/\s+/g, " ");
  const teamId = canonicalTeamId(payload.teamId);
  if (!cardHolderName) {
    throw new Error("Card holder name is required");
  }
  if (!teams.some((team) => team.id === teamId)) {
    throw new Error("Team not found");
  }

  wiseCardHolderTeamAssignments = mergeWiseCardHolderTeamAssignments([
    ...wiseCardHolderTeamAssignments.filter(
      (assignment) => normalizeCardHolderName(assignment.cardHolderName) !== normalizeCardHolderName(cardHolderName)
    ),
    { cardHolderName, teamId, updatedAt: new Date().toISOString() }
  ]);

  await persist();
  return getSnapshot();
}

export async function createTeam(payload: CreateTeamPayload): Promise<Team> {
  const name = canonicalTeamName(payload.name.trim());
  if (!name) {
    throw new Error("Team name is required");
  }
  if (teams.some((team) => normalizeName(team.name) === normalizeName(name))) {
    throw new Error("Team already exists");
  }

  const team: Team = {
    id: `team-${crypto.randomUUID()}`,
    name,
    createdAt: new Date().toISOString()
  };
  teams = mergeTeamDirectory([...teams, team]);
  await persist();
  return team;
}

export async function createProvider(payload: CreateProviderPayload): Promise<Provider> {
  const provider: Provider = {
    id: `provider-${crypto.randomUUID()}`,
    name: payload.name.trim(),
    type: providerType(payload),
    tags: providerTags(payload),
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
      type: providerType(payload),
      tags: providerTags(payload),
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

export async function deleteProvider(providerId: string): Promise<Provider> {
  const deletion = deleteProviderReferences(
    {
      providers,
      invoices,
      revenuePartners,
      revenueRuns,
      transactions,
      wiseStatementTransactions
    },
    providerId
  );
  if (!deletion) throw new Error("Company not found");

  providers = deletion.providers;
  invoices = deletion.invoices;
  revenuePartners = deletion.revenuePartners;
  revenueRuns = deletion.revenueRuns;
  transactions = deletion.transactions;
  wiseStatementTransactions = deletion.wiseStatementTransactions;
  await persist();
  return deletion.deletedProvider;
}

function normalizedTimezone(value: string, field: string): string {
  const timezone = value?.trim();
  if (!timezone) throw new Error(`${field} is required`);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date(0));
  } catch {
    throw new Error(`${field} is invalid`);
  }
  return timezone;
}

function normalizedEnvironmentName(value: string | undefined, field: string, required: boolean): string | undefined {
  const name = value?.trim();
  if (!name) {
    if (required) throw new Error(`${field} is required`);
    return undefined;
  }
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(`${field} must be an uppercase environment variable name`);
  return name;
}

function revenuePartnerFields(
  payload: CreateRevenuePartnerPayload | UpdateRevenuePartnerPayload
): Omit<RevenuePartner, "id" | "source" | "createdAt"> {
  const name = payload.name?.trim();
  if (!name) throw new Error("Revenue rule name is required");
  const affiliateId = payload.affiliateId?.trim();
  if (!affiliateId) throw new Error("Affiliate ID is required");
  const company = providers.find((provider) => provider.id === payload.providerId);
  if (!company || company.type !== "client") throw new Error("Revenue rule company must be a client");
  if (payload.teamId && !teams.some((team) => team.id === payload.teamId)) {
    throw new Error("Revenue rule team not found");
  }
  if (payload.billingCadence !== "weekly" && payload.billingCadence !== "monthly") {
    throw new Error("Billing cadence must be weekly or monthly");
  }
  if (!Number.isInteger(payload.invoiceDueDays) || payload.invoiceDueDays < 0) {
    throw new Error("Invoice due days must be a non-negative whole number");
  }
  if (typeof payload.autoDraft !== "boolean" || typeof payload.enabled !== "boolean") {
    throw new Error("autoDraft and enabled must be boolean values");
  }
  if (!payload.currency?.trim()) throw new Error("Revenue currency is required");
  const revenueCategory = transactionBusinessCategory(payload.revenueCategory);
  if (!isTransactionCategoryForDirection(revenueCategory, "in")) {
    throw new Error(`Category "${revenueCategory}" is not valid for money in`);
  }

  return {
    name,
    providerId: company.id,
    teamId: cleanOptional(payload.teamId),
    revenueCategory,
    affiliateId,
    externalId: cleanOptional(payload.externalId),
    currency: normalizedCurrency(payload.currency),
    timezone: normalizedTimezone(payload.timezone, "Revenue timezone"),
    networkTimezone: normalizedTimezone(payload.networkTimezone, "Network timezone"),
    networkIdEnv: normalizedEnvironmentName(payload.networkIdEnv, "Network ID environment name", true)!,
    apiKeyEnv: normalizedEnvironmentName(payload.apiKeyEnv, "API key environment name", true)!,
    apiBaseUrlEnv: normalizedEnvironmentName(payload.apiBaseUrlEnv, "API base URL environment name", false),
    meritCustomerName: cleanOptional(payload.meritCustomerName),
    invoiceDueDays: payload.invoiceDueDays,
    billingCadence: payload.billingCadence,
    billingTimezone: normalizedTimezone(payload.billingTimezone, "Billing timezone"),
    autoDraft: payload.autoDraft,
    defaultMeritTaxId: cleanOptional(payload.defaultMeritTaxId),
    defaultMeritItemCode: cleanOptional(payload.defaultMeritItemCode),
    enabled: payload.enabled
  };
}

export async function createRevenuePartner(payload: CreateRevenuePartnerPayload): Promise<RevenuePartner> {
  const partner: RevenuePartner = {
    id: `revenue-partner-${crypto.randomUUID()}`,
    ...revenuePartnerFields(payload),
    source: "tune",
    createdAt: new Date().toISOString()
  };
  revenuePartners = [partner, ...revenuePartners];
  await persist();
  return partner;
}

export async function updateRevenuePartner(partnerId: string, payload: UpdateRevenuePartnerPayload): Promise<RevenuePartner> {
  const fields = revenuePartnerFields(payload);
  let updated: RevenuePartner | undefined;
  revenuePartners = revenuePartners.map((partner) => {
    if (partner.id !== partnerId) return partner;
    updated = { ...partner, ...fields };
    return updated;
  });
  if (!updated) throw new Error("Revenue partner not found");
  revenuePartners = mergeRevenuePartnerDirectory(revenuePartners);
  await persist();
  return updated;
}

export async function deleteRevenuePartner(partnerId: string): Promise<RevenuePartner> {
  const deleted = revenuePartners.find((partner) => partner.id === partnerId);
  if (!deleted) throw new Error("Revenue partner not found");
  revenuePartners = revenuePartners.filter((partner) => partner.id !== partnerId);
  await persist();
  return deleted;
}

export async function saveAiSettings(payload: SaveAiSettingsPayload): Promise<DashboardSnapshot> {
  const model = payload.model.trim();
  if (!model) throw new Error("OpenRouter model is required");

  aiSettings = {
    provider: "openrouter",
    model,
    updatedAt: new Date().toISOString()
  };
  await persist();
  return getSnapshot();
}

export async function runAiPrompt(payload: AiPromptPayload): Promise<AiPromptResult> {
  return runOpenRouterPrompt(runtimeAiSettings(), payload, process.env.PUBLIC_APP_URL);
}

export async function matchTransaction(payload: MatchTransactionPayload): Promise<Transaction> {
  const provider = providers.find((item) => item.id === payload.providerId);
  const transaction = findKnownTransaction(payload.transactionId);
  if (!provider || !transaction) {
    throw new Error("Company or transaction not found");
  }
  if (!providerMatchesTransactionDirection(transaction, provider)) {
    throw new Error(`Money-${transaction.direction} transactions can only be matched to ${providerTypeForTransactionDirection(transaction.direction)}s`);
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

  const category = transactionBusinessCategory(payload.category);
  if (!isTransactionCategoryForDirection(category, transaction.direction)) {
    throw new Error(`Category "${category}" is not valid for money ${transaction.direction === "in" ? "in" : "out"}`);
  }
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

export async function saveProfitDistributionAdjustment(
  payload: SaveProfitDistributionAdjustmentPayload
): Promise<DashboardSnapshot> {
  const adjustment = profitDistributionAdjustmentFromPayload(payload, new Date().toISOString());
  profitDistributionAdjustments = profitDistributionAdjustments.filter((item) => item.id !== adjustment.id);
  if (shouldKeepProfitDistributionAdjustment(adjustment)) {
    profitDistributionAdjustments = [adjustment, ...profitDistributionAdjustments];
  }
  await persist();
  return getSnapshot();
}

function normalizedCurrency(value: string): string {
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(currency)) throw new Error("Currency or asset code is invalid");
  return currency;
}

function normalizedDate(value: string, field: string): string {
  const date = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))) {
    throw new Error(`${field} must be a valid YYYY-MM-DD date`);
  }
  return date;
}

function validateInvoiceCompany(providerId: string | undefined, documentType: Invoice["documentType"]): Provider | undefined {
  const provider = providerId ? providers.find((item) => item.id === providerId) : undefined;
  if (providerId && !provider) throw new Error("Company not found");
  if (provider && provider.type !== providerTypeForInvoiceDocument(documentType)) {
    const requiredType = providerTypeForInvoiceDocument(documentType);
    throw new Error(`${documentType === "sales_invoice" ? "Sales invoice" : "Supplier bill"} requires a ${requiredType}`);
  }
  return provider;
}

function validateInvoiceAmount(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Invoice amount must be positive");
  return Number(amount.toFixed(2));
}

export async function createInvoice(payload: CreateInvoicePayload): Promise<Invoice> {
  const selectedProvider = validateInvoiceCompany(payload.providerId, payload.documentType);
  const amount = validateInvoiceAmount(payload.amount);
  const issueDate = normalizedDate(payload.issueDate ?? new Date().toISOString().slice(0, 10), "Issue date");
  const dueDate = normalizedDate(payload.dueDate, "Due date");
  if (dueDate < issueDate) throw new Error("Due date cannot be before issue date");
  if (!payload.customerName.trim()) throw new Error("Customer name is required");
  if (!payload.description.trim()) throw new Error("Invoice description is required");
  const createdAt = new Date().toISOString();
  const id = `local-${payload.documentType}-${crypto.randomUUID()}`;

  const invoice: Invoice = {
    id,
    providerId: payload.providerId,
    documentType: payload.documentType,
    origin: "manual",
    customerName: payload.customerName.trim(),
    amount,
    currency: normalizedCurrency(payload.currency),
    status: "draft",
    meritDeliveryStatus: "not-sent",
    invoiceNumber: `FD-${issueDate.replaceAll("-", "")}-${id.slice(-8).toUpperCase()}`,
    issueDate,
    dueDate,
    source: "manual",
    description: payload.description.trim(),
    transactionId: payload.transactionId,
    revenueRunIds: [],
    periodStart: payload.periodStart ? normalizedDate(payload.periodStart, "Period start") : undefined,
    periodEnd: payload.periodEnd ? normalizedDate(payload.periodEnd, "Period end") : undefined,
    taxId: cleanOptional(payload.taxId),
    createdAt,
    updatedAt: createdAt
  };
  if (Boolean(invoice.periodStart) !== Boolean(invoice.periodEnd)) {
    throw new Error("Revenue period start and end must be provided together");
  }
  if (invoice.periodStart && invoice.periodEnd && invoice.periodEnd < invoice.periodStart) {
    throw new Error("Revenue period end cannot be before its start");
  }

  if (payload.transactionId && selectedProvider) {
    const sourceTransaction = findKnownTransaction(payload.transactionId);
    if (sourceTransaction) {
      providers = providers.map((provider) =>
        provider.id === selectedProvider.id ? learnAliases(provider, bankAliasNames(sourceTransaction)) : provider
      );
      const provider = providers.find((item) => item.id === selectedProvider.id);
      if (provider) {
        updateStoredTransaction({
          ...sourceTransaction,
          matchedProviderId: selectedProvider.id,
          matchedInvoiceId: invoice.id,
          confidence: 1,
          matchReason: payload.documentType === "sales_invoice" ? "Sales invoice draft created" : "Supplier bill draft created"
        });
      }
    }
  }
  invoices = [invoice, ...invoices];
  await persist();
  return invoice;
}

export async function updateInvoice(invoiceId: string, payload: UpdateInvoicePayload): Promise<Invoice> {
  const existing = invoices.find((invoice) => invoice.id === invoiceId);
  if (!existing) throw new Error("Invoice not found");
  if (existing.status !== "draft" || existing.externalId) {
    throw new Error("Only local draft invoices can be edited");
  }
  validateInvoiceCompany(payload.providerId, existing.documentType);
  const issueDate = normalizedDate(payload.issueDate, "Issue date");
  const dueDate = normalizedDate(payload.dueDate, "Due date");
  if (dueDate < issueDate) throw new Error("Due date cannot be before issue date");
  if (!payload.customerName.trim()) throw new Error("Customer name is required");
  if (!payload.description.trim()) throw new Error("Invoice description is required");
  const periodStart = payload.periodStart ? normalizedDate(payload.periodStart, "Period start") : undefined;
  const periodEnd = payload.periodEnd ? normalizedDate(payload.periodEnd, "Period end") : undefined;
  if (Boolean(periodStart) !== Boolean(periodEnd)) {
    throw new Error("Revenue period start and end must be provided together");
  }
  if (periodStart && periodEnd && periodEnd < periodStart) {
    throw new Error("Revenue period end cannot be before its start");
  }

  const updated: Invoice = {
    ...existing,
    providerId: payload.providerId,
    customerName: payload.customerName.trim(),
    amount: validateInvoiceAmount(payload.amount),
    currency: normalizedCurrency(payload.currency),
    issueDate,
    dueDate,
    description: payload.description.trim(),
    taxId: cleanOptional(payload.taxId),
    periodStart,
    periodEnd,
    sendError: undefined,
    meritCreationReservedAt: undefined,
    updatedAt: new Date().toISOString()
  };
  invoices = invoices.map((invoice) => (invoice.id === invoiceId ? updated : invoice));
  await persist();
  return updated;
}

function validPaymentSource(source: string): source is PaymentAllocation["source"] {
  return ["wise", "revolut", "slash", "amex", "cash", "kraken", "trust", "other"].includes(source);
}

export async function recordInvoicePayment(
  invoiceId: string,
  payload: RecordInvoicePaymentPayload
): Promise<DashboardSnapshot> {
  const invoice = invoices.find((item) => item.id === invoiceId);
  if (!invoice) throw new Error("Invoice not found");
  if (invoice.status === "draft") throw new Error("A draft invoice cannot receive payments");
  const outstanding = invoiceOutstanding(invoice, paymentAllocations);
  const amount = validateInvoiceAmount(payload.amount);
  if (amount - outstanding > 0.01) throw new Error("Payment allocation exceeds the invoice outstanding amount");
  if (!validPaymentSource(payload.source)) throw new Error("Payment source is invalid");
  const transaction = payload.transactionId ? findKnownTransaction(payload.transactionId) : undefined;
  if (payload.transactionId && !transaction) throw new Error("Payment transaction not found");
  if (transaction) {
    if (transaction.direction !== "in" || (transaction.status !== "posted" && transaction.status !== "settled")) {
      throw new Error("Only posted incoming transactions can be allocated to an invoice");
    }
    if (transaction.currency.toUpperCase() !== invoice.currency.toUpperCase()) {
      throw new Error("Payment transaction currency does not match the invoice");
    }
    if (transaction.source !== payload.source) {
      throw new Error("Payment source must match the linked transaction source");
    }
    if (
      paymentAllocations.some(
        (allocation) => allocation.transactionId === transaction.id && allocation.invoiceId === invoice.id
      )
    ) {
      throw new Error("This transaction is already allocated to the invoice");
    }
    const allocatedTransactionAmount = paymentAllocations
      .filter((allocation) => allocation.transactionId === transaction.id)
      .reduce((total, allocation) => total + allocation.amount, 0);
    if (allocatedTransactionAmount + amount - transaction.amount > 0.01) {
      throw new Error("Payment allocation exceeds the linked transaction amount");
    }
  }
  const paidAt = transaction?.date ?? normalizedDate(payload.paidAt, "Paid date");

  const createdAt = new Date().toISOString();
  paymentAllocations = [
    {
      id: `payment-${crypto.randomUUID()}`,
      invoiceId: invoice.id,
      transactionId: transaction?.id,
      amount,
      currency: invoice.currency,
      source: payload.source,
      accountName: cleanOptional(payload.accountName) ?? transaction?.accountName,
      reference: cleanOptional(payload.reference) ?? transaction?.description,
      note: cleanOptional(payload.note),
      mode: "manual",
      paidAt,
      createdAt
    },
    ...paymentAllocations
  ];
  invoices = applyPaymentState(invoices, paymentAllocations).map((item) =>
    item.id === invoice.id ? { ...item, updatedAt: createdAt } : item
  );

  if (transaction) {
    const linkedInvoiceIds = new Set(
      paymentAllocations
        .filter((allocation) => allocation.transactionId === transaction.id)
        .map((allocation) => allocation.invoiceId)
    );
    const { matchedInvoiceId: _matchedInvoiceId, ...withoutInvoiceMatch } = transaction;
    updateStoredTransaction({
      ...withoutInvoiceMatch,
      ...(linkedInvoiceIds.size === 1 ? { matchedInvoiceId: invoice.id } : {}),
      matchedProviderId: invoice.providerId ?? transaction.matchedProviderId,
      confidence: 1,
      matchReason: "Confirmed invoice payment allocation"
    });
    if (invoice.providerId) {
      providers = providers.map((provider) =>
        provider.id === invoice.providerId ? learnAliases(provider, bankAliasNames(transaction)) : provider
      );
    }
  }
  await persist();
  return getSnapshot();
}

function holdingFromPayload(id: string, payload: CreateHoldingPayload | UpdateHoldingPayload): Holding {
  const name = payload.name.trim();
  if (!name) throw new Error("Holding name is required");
  if (payload.kind !== "cash" && payload.kind !== "exchange" && payload.kind !== "wallet") {
    throw new Error("Holding kind is invalid");
  }
  if (payload.assetType !== "fiat" && payload.assetType !== "crypto") {
    throw new Error("Holding asset type is invalid");
  }
  if (!Number.isFinite(payload.balance) || payload.balance < 0) {
    throw new Error("Holding balance cannot be negative");
  }
  return {
    id,
    name,
    kind: payload.kind,
    assetType: payload.assetType,
    asset: normalizedCurrency(payload.asset),
    balance: payload.balance,
    notes: cleanOptional(payload.notes),
    updatedAt: new Date().toISOString()
  };
}

export async function createHolding(payload: CreateHoldingPayload): Promise<DashboardSnapshot> {
  holdings = [holdingFromPayload(`holding-${crypto.randomUUID()}`, payload), ...holdings];
  await updateCurrentFxRates();
  await persist();
  return getSnapshot();
}

export async function updateHolding(holdingId: string, payload: UpdateHoldingPayload): Promise<DashboardSnapshot> {
  if (!holdings.some((holding) => holding.id === holdingId)) throw new Error("Holding not found");
  const updated = holdingFromPayload(holdingId, payload);
  holdings = holdings.map((holding) => (holding.id === holdingId ? updated : holding));
  await updateCurrentFxRates();
  await persist();
  return getSnapshot();
}

export async function deleteHolding(holdingId: string): Promise<DashboardSnapshot> {
  if (!holdings.some((holding) => holding.id === holdingId)) throw new Error("Holding not found");
  holdings = holdings.filter((holding) => holding.id !== holdingId);
  await persist();
  return getSnapshot();
}

async function updateCurrentFxRates(): Promise<void> {
  const trackedAssets = new Set([
    ...fxTrackedAssets,
    ...fxRates.map((rate) => rate.asset),
    ...accounts.filter(isLiquidAccountBalance).map((account) => account.currency),
    ...holdings.map((holding) => holding.asset)
  ]);
  const checkedAt = new Date().toISOString();
  fxTrackedAssets = [...trackedAssets].map((asset) => asset.trim().toUpperCase()).filter(Boolean).sort();
  let refreshedRates: FxRate[] = [];
  try {
    refreshedRates = await fetchCoinbaseUsdRates(trackedAssets);
  } catch {
    // A conversion feed outage must not block bank/invoice sync; retained rates are visibly marked stale.
  }
  fxRates = mergeFxRates(fxRates, refreshedRates, trackedAssets, checkedAt);
}

export async function refreshFxRates(): Promise<DashboardSnapshot> {
  await updateCurrentFxRates();
  await persist();
  return getSnapshot();
}

function mergeRevenueRun(run: RevenueRun): void {
  const protectedExisting = revenueRuns.find(
    (item) =>
      item.id === run.id &&
      (item.status === "drafted" || item.status === "invoicing" || item.status === "invoiced")
  );
  if (protectedExisting) return;
  revenueRuns = [run, ...revenueRuns.filter((item) => item.id !== run.id)].slice(0, 250);
}

function updateRevenueAccrual(
  partner: RevenuePartner,
  run: RevenueRun,
  periodEnd: string,
  accruedThrough: string,
  invoiceId?: string
): boolean {
  const updatedAt = new Date().toISOString();
  const id = `revenue-accrual-${partner.id}-${run.periodStart}-${periodEnd}`;
  const previousAccrual = revenueAccruals.find((item) => item.id === id);
  if (
    previousAccrual &&
    !invoiceId &&
    (previousAccrual.invoiceId || previousAccrual.accruedThrough > accruedThrough)
  ) {
    return false;
  }
  const accrual: RevenueAccrual = {
    id,
    partnerId: partner.id,
    providerId: run.providerId ?? partner.providerId,
    partnerName: partner.name,
    billingCadence: partner.billingCadence,
    periodStart: run.periodStart,
    periodEnd,
    accruedThrough,
    amount: run.revenue,
    currency: run.currency,
    status: invoiceId ? "drafted" : "accruing",
    revenueRunId: run.id,
    invoiceId,
    updatedAt
  };
  revenueRuns = pruneSupersededAccrualRun(revenueRuns, previousAccrual, run.id);
  revenueAccruals = [accrual, ...revenueAccruals.filter((item) => item.id !== id)];
  return true;
}

function openAccrualPeriodEnd(
  partner: RevenuePartner,
  run: RevenueRun,
  now = new Date()
): string | undefined {
  if (run.status !== "pulled") {
    return undefined;
  }
  if (partner.billingCadence === "weekly") {
    const currentWeek = currentWeekAccrualPeriod(now, partner.billingTimezone);
    return run.periodStart === currentWeek.periodStart &&
      run.periodEnd >= run.periodStart &&
      run.periodEnd <= currentWeek.accruedThrough
      ? currentWeek.periodEnd
      : undefined;
  }
  if (!/^\d{4}-\d{2}-01$/.test(run.periodStart)) return undefined;
  const currentMonth = resolveRevenuePeriod({
    periodPreset: "this-month",
    timezone: run.timezone || partner.timezone,
    now
  });
  if (
    run.periodStart !== currentMonth.periodStart ||
    run.periodEnd < run.periodStart ||
    run.periodEnd > currentMonth.periodEnd
  ) {
    return undefined;
  }
  const [year, month] = run.periodStart.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function removeClosedRevenueAccrual(partner: RevenuePartner, run: RevenueRun): void {
  const id = `revenue-accrual-${partner.id}-${run.periodStart}-${run.periodEnd}`;
  const previousAccrual = revenueAccruals.find((item) => item.id === id);
  revenueRuns = pruneSupersededAccrualRun(revenueRuns, previousAccrual, run.id);
  revenueAccruals = revenueAccruals.filter((item) => item.id !== id);
}

function draftRevenueRunInternal(run: RevenueRun, partner: RevenuePartner, automatic: boolean, now = new Date()): Invoice {
  const invoiceId = revenueInvoiceId(partner.id, run.periodStart, run.periodEnd);
  const existing = invoices.find((invoice) => invoice.id === invoiceId);
  if (existing) {
    removeClosedRevenueAccrual(partner, run);
    return existing;
  }
  if (run.status !== "pulled" || run.revenue <= 0) {
    throw new Error("Only a positive, pulled revenue run can be drafted");
  }
  if (automatic && !partner.autoDraft) throw new Error(`Automatic drafting is disabled for ${partner.name}`);

  const draft = buildRevenueDraft(automatic ? partner : { ...partner, autoDraft: true }, run, now);
  invoices = [draft, ...invoices];
  const { error: _error, ...withoutError } = run;
  const draftedRun: RevenueRun = { ...withoutError, status: "drafted", invoiceId: draft.id };
  revenueRuns = [draftedRun, ...revenueRuns.filter((item) => item.id !== run.id)].slice(0, 250);
  if (partner.billingCadence === "monthly") {
    updateRevenueAccrual(partner, draftedRun, run.periodEnd, run.periodEnd, draft.id);
  } else {
    removeClosedRevenueAccrual(partner, draftedRun);
  }
  return draft;
}

export async function draftRevenueRun(runId: string): Promise<Invoice> {
  const run = revenueRuns.find((item) => item.id === runId);
  if (!run) throw new Error("Revenue run not found");
  const partner = revenuePartners.find((item) => item.id === run.partnerId);
  if (!partner) throw new Error("Revenue partner not found");
  const invoice = draftRevenueRunInternal(run, partner, false);
  await persist();
  return invoice;
}

async function fetchAutomationRevenue(
  partner: RevenuePartner,
  period: { periodStart: string; periodEnd: string },
  timezone: string
): Promise<RevenueRun> {
  const run: RevenueRun = {
    ...(await fetchTuneRevenue(partner, { ...period, timezone, preset: "custom" })),
    ...(partner.teamId
      ? { teamName: teams.find((team) => team.id === partner.teamId)?.name ?? partner.teamId }
      : {})
  };
  mergeRevenueRun(run);
  return revenueRuns.find((item) => item.id === run.id) ?? run;
}

function failedAutomationRevenueRun(
  partner: RevenuePartner,
  period: { periodStart: string; periodEnd: string },
  timezone: string,
  error: unknown
): void {
  const baseId = `revenue-${partner.id}-${period.periodStart}-${period.periodEnd}`;
  const existing = revenueRuns.find((run) => run.id === baseId);
  mergeRevenueRun({
    id: existing && existing.status !== "failed" ? `${baseId}-failed-${Date.now()}` : baseId,
    partnerId: partner.id,
    partnerName: partner.name,
    providerId: partner.providerId,
    ...(partner.teamId
      ? {
          teamId: partner.teamId,
          teamName: teams.find((team) => team.id === partner.teamId)?.name ?? partner.teamId
        }
      : {}),
    revenueCategory: partner.revenueCategory,
    source: "tune",
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    timezone,
    revenue: 0,
    currency: partner.currency,
    status: "failed",
    error: error instanceof Error ? error.message : "Revenue automation failed",
    createdAt: new Date().toISOString()
  });
}

export async function runIncomeAutomation(now = new Date(), force = false): Promise<DashboardSnapshot> {
  if (!force && !isLebanonIncomeAutomationTime(now)) {
    throw new Error("Income automation only runs Monday at 09:00 Asia/Beirut");
  }
  const weeklyPeriod = previousCompletedWeek(now, incomeAutomationTimezone);
  const automationId = `weekly-income-${weeklyPeriod.periodStart}-${weeklyPeriod.periodEnd}`;
  if (automationRuns.some((run) => run.id === automationId && run.status === "completed")) return getSnapshot();

  const startedAt = new Date().toISOString();
  const running: AutomationRun = {
    id: automationId,
    type: "weekly-income",
    ...weeklyPeriod,
    timezone: incomeAutomationTimezone,
    status: "running",
    startedAt
  };
  automationRuns = [running, ...automationRuns.filter((run) => run.id !== automationId)].slice(0, 100);
  await persist();

  const errors: string[] = [];
  for (const partner of revenuePartners.filter((item) => item.enabled)) {
    const timezone = partner.billingTimezone;
    if (partner.billingCadence === "weekly") {
      const period = (previousCompletedWeek as (date: Date, timezone: string) => ReturnType<typeof previousCompletedWeek>)(
        now,
        timezone
      );
      try {
        const run = await fetchAutomationRevenue(partner, period, timezone);
        removeClosedRevenueAccrual(partner, run);
        if (partner.autoDraft && run.status === "pulled" && run.revenue > 0) {
          draftRevenueRunInternal(run, partner, true, now);
        }
      } catch (error) {
        failedAutomationRevenueRun(partner, period, timezone, error);
        errors.push(`${partner.name}: ${error instanceof Error ? error.message : "weekly revenue failed"}`);
      }

      const accrualPeriod = currentWeekAccrualPeriod(now, timezone);
      try {
        const accrualRun = await fetchAutomationRevenue(
          partner,
          { periodStart: accrualPeriod.periodStart, periodEnd: accrualPeriod.accruedThrough },
          timezone
        );
        updateRevenueAccrual(partner, accrualRun, accrualPeriod.periodEnd, accrualPeriod.accruedThrough);
      } catch (error) {
        failedAutomationRevenueRun(
          partner,
          { periodStart: accrualPeriod.periodStart, periodEnd: accrualPeriod.accruedThrough },
          timezone,
          error
        );
        errors.push(`${partner.name}: ${error instanceof Error ? error.message : "weekly accrual failed"}`);
      }
      continue;
    }

    const closedPeriod = (
      previousCalendarMonth as (date: Date, timezone: string) => ReturnType<typeof previousCalendarMonth>
    )(now, timezone);
    const closedRunId = `revenue-${partner.id}-${closedPeriod.periodStart}-${closedPeriod.periodEnd}`;
    const closedInvoiceId = revenueInvoiceId(partner.id, closedPeriod.periodStart, closedPeriod.periodEnd);
    try {
      let closedRun = revenueRuns.find((run) => run.id === closedRunId);
      if ((!closedRun || closedRun.status === "failed") && !invoices.some((invoice) => invoice.id === closedInvoiceId)) {
        closedRun = await fetchAutomationRevenue(partner, closedPeriod, timezone);
      }
      if (closedRun && partner.autoDraft && closedRun.status === "pulled" && closedRun.revenue > 0) {
        draftRevenueRunInternal(closedRun, partner, true, now);
      }
    } catch (error) {
      failedAutomationRevenueRun(partner, closedPeriod, timezone, error);
      errors.push(`${partner.name}: ${error instanceof Error ? error.message : "monthly close failed"}`);
    }

    const accrualPeriod = (
      currentMonthAccrualPeriod as (date: Date, timezone: string) => ReturnType<typeof currentMonthAccrualPeriod>
    )(now, timezone);
    if (!accrualPeriod) continue;
    try {
      const accrualRun = await fetchAutomationRevenue(
        partner,
        { periodStart: accrualPeriod.periodStart, periodEnd: accrualPeriod.accruedThrough },
        timezone
      );
      updateRevenueAccrual(
        partner,
        accrualRun,
        accrualPeriod.periodEnd,
        accrualPeriod.accruedThrough
      );
    } catch (error) {
      failedAutomationRevenueRun(
        partner,
        { periodStart: accrualPeriod.periodStart, periodEnd: accrualPeriod.accruedThrough },
        timezone,
        error
      );
      errors.push(`${partner.name}: ${error instanceof Error ? error.message : "monthly accrual failed"}`);
    }
  }

  const completedAt = new Date().toISOString();
  const finished: AutomationRun = {
    ...running,
    status: errors.length > 0 ? "failed" : "completed",
    completedAt,
    ...(errors.length > 0 ? { error: errors.join("; ") } : {})
  };
  automationRuns = [
    finished,
    ...automationRuns.filter((run) => run.id !== automationId)
  ].slice(0, 100);
  lastSync = completedAt;
  await persist();
  return getSnapshot();
}

function replaceInvoice(updated: Invoice): void {
  invoices = invoices.map((invoice) => (invoice.id === updated.id ? updated : invoice));
}

function finalizeRevenueInvoiceState(invoice: Invoice): void {
  const runIds = new Set(invoice.revenueRunIds);
  revenueRuns = revenueRuns.map((run) => {
    if (!runIds.has(run.id)) return run;
    const { error: _error, ...withoutError } = run;
    return {
      ...withoutError,
      status: "invoiced",
      invoiceId: invoice.id,
      externalInvoiceId: invoice.externalId
    };
  });
  revenueAccruals = revenueAccruals.map((accrual) =>
    invoice.periodStart === accrual.periodStart &&
    invoice.periodEnd === accrual.periodEnd &&
    invoice.billingRuleId === accrual.partnerId
      ? { ...accrual, status: "drafted", invoiceId: invoice.id, updatedAt: invoice.updatedAt }
      : accrual
  );
}

export async function sendInvoices(payload: SendInvoicesPayload): Promise<SendInvoicesResult> {
  if (payload.confirmation !== "SEND_TO_MERIT") {
    throw new Error("Explicit SEND_TO_MERIT confirmation is required");
  }
  if (payload.mode !== "save" && payload.mode !== "deliver") throw new Error("Merit send mode is invalid");
  const invoiceIds = [...new Set(payload.invoiceIds)];
  if (invoiceIds.length === 0) throw new Error("Choose at least one invoice");
  assertMeritWriteConfiguration();

  const requiresTaxVerification = invoiceIds.some((invoiceId) => {
    const invoice = invoices.find((item) => item.id === invoiceId);
    return invoice?.status === "draft" && !invoice.externalId;
  });
  let taxById = new Map<string, MeritTax>();
  if (requiresTaxVerification) {
    meritTaxes = await fetchMeritTaxes();
    taxById = new Map(meritTaxes.map((tax) => [tax.id, tax]));
  }

  const outcomes: SendInvoicesResult["outcomes"] = [];
  for (const invoiceId of invoiceIds) {
    let invoice = invoices.find((item) => item.id === invoiceId);
    if (!invoice) {
      outcomes.push({ invoiceId, status: "failed", message: "Invoice not found" });
      continue;
    }
    if (invoice.documentType !== "sales_invoice") {
      outcomes.push({ invoiceId, status: "failed", message: "Only sales invoices can be sent to Merit" });
      continue;
    }
    if (invoice.status === "paid") {
      outcomes.push({ invoiceId, status: "failed", message: "Paid invoices cannot be sent again" });
      continue;
    }

    if (!invoice.externalId) {
      if (invoice.status !== "draft") {
        outcomes.push({ invoiceId, status: "failed", message: "Only draft invoices can be created in Merit" });
        continue;
      }
      if (invoice.meritCreationReservedAt || invoice.sendError) {
        outcomes.push({
          invoiceId,
          status: "failed",
          message: "Review Merit for a possible prior creation, then explicitly edit the draft before retrying"
        });
        continue;
      }
      const tax = invoice.taxId ? taxById.get(invoice.taxId) : undefined;
      if (!tax) {
        outcomes.push({ invoiceId, status: "failed", message: "Choose a current Merit tax rate" });
        continue;
      }
      const itemCode = revenuePartners.find((partner) => partner.id === invoice?.billingRuleId)?.defaultMeritItemCode;
      const invoiceProvider = invoice.providerId
        ? providers.find((provider) => provider.id === invoice?.providerId)
        : undefined;
      invoice = {
        ...invoice,
        meritCreationReservedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      replaceInvoice(invoice);
      await persist();
      try {
        const created = await createMeritInvoice(invoice, tax, { itemCode, provider: invoiceProvider });
        const updatedAt = new Date().toISOString();
        const { meritCreationReservedAt: _reservation, ...unreservedInvoice } = invoice;
        invoice = {
          ...unreservedInvoice,
          status: "open",
          source: "merit",
          externalId: created.externalId,
          invoiceNumber: created.invoiceNumber,
          meritStatus: "open",
          meritDeliveryStatus: "saved",
          sendError: undefined,
          updatedAt
        };
        replaceInvoice(invoice);
        finalizeRevenueInvoiceState(invoice);
        // Creation is persisted before any delivery attempt. A failed delivery
        // therefore retries delivery against this externalId without recreating.
        await persist();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Merit invoice creation failed";
        invoice = {
          ...invoice,
          sendError: `Merit creation outcome needs review: ${message}`,
          updatedAt: new Date().toISOString()
        };
        replaceInvoice(invoice);
        await persist();
        outcomes.push({ invoiceId, status: "failed", message });
        continue;
      }
    }

    if (payload.mode === "save") {
      outcomes.push({ invoiceId, status: "saved" });
      continue;
    }
    if (invoice.meritDeliveryStatus === "delivered") {
      outcomes.push({ invoiceId, status: "delivered" });
      continue;
    }

    try {
      await deliverMeritInvoice(invoice.externalId!);
      const updatedAt = new Date().toISOString();
      const { meritDeliveryError: _deliveryError, ...withoutDeliveryError } = invoice;
      invoice = {
        ...withoutDeliveryError,
        meritDeliveryStatus: "delivered",
        sentAt: invoice.sentAt ?? updatedAt,
        updatedAt
      };
      replaceInvoice(invoice);
      await persist();
      outcomes.push({ invoiceId, status: "delivered" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Merit delivery failed";
      invoice = {
        ...invoice,
        meritDeliveryStatus: "delivery-failed",
        meritDeliveryError: message,
        updatedAt: new Date().toISOString()
      };
      replaceInvoice(invoice);
      await persist();
      outcomes.push({ invoiceId, status: "failed", message });
    }
  }

  return { dashboard: getSnapshot(), outcomes };
}

export async function syncRevenue(payload: SyncRevenuePayload = {}): Promise<DashboardSnapshot> {
  const selectedPartners = revenuePartners.filter(
    (partner) =>
      partner.enabled &&
      (!payload.partnerId || partner.id === payload.partnerId) &&
      (!payload.teamId || partner.teamId === payload.teamId) &&
      (!payload.partnerLevelOnly || !partner.teamId)
  );
  if (selectedPartners.length === 0) {
    throw new Error("No revenue partner found for this sync");
  }

  const nextRuns: RevenueRun[] = [];
  for (const partner of selectedPartners) {
    const period = resolveRevenuePeriod({
      periodPreset: payload.periodPreset,
      periodStart: payload.periodStart,
      periodEnd: payload.periodEnd,
      timezone:
        payload.timezone ||
        (payload.periodPreset === "this-week" ? partner.billingTimezone : partner.timezone) ||
        process.env.REVENUE_TIMEZONE ||
        "UTC"
    });
    try {
      const run: RevenueRun = {
        ...(await fetchTuneRevenue(partner, period)),
        ...(partner.teamId ? { teamName: teams.find((team) => team.id === partner.teamId)?.name ?? partner.teamId } : {})
      };
      nextRuns.push(run);
    } catch (error) {
      nextRuns.push({
        id: `revenue-${partner.id}-${period.periodStart}-${period.periodEnd}-${Date.now()}`,
        partnerId: partner.id,
        partnerName: partner.name,
        providerId: partner.providerId,
        ...(partner.teamId
          ? {
              teamId: partner.teamId,
              teamName: teams.find((team) => team.id === partner.teamId)?.name ?? partner.teamId
            }
          : {}),
        revenueCategory: partner.revenueCategory,
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

  const protectedRunIds = new Set(
    revenueRuns
      .filter((run) => run.status === "drafted" || run.status === "invoicing" || run.status === "invoiced")
      .map((run) => run.id)
  );
  const safeNextRuns = nextRuns.filter((run) => !protectedRunIds.has(run.id));
  const partnerById = new Map(selectedPartners.map((partner) => [partner.id, partner]));
  const acceptedNextRuns: RevenueRun[] = [];
  for (const run of safeNextRuns) {
    const partner = partnerById.get(run.partnerId);
    if (!partner) {
      acceptedNextRuns.push(run);
      continue;
    }
    const accrualPeriodEnd = openAccrualPeriodEnd(partner, run);
    if (isClosedBillingPeriod(partner, run)) removeClosedRevenueAccrual(partner, run);
    if (!accrualPeriodEnd || updateRevenueAccrual(partner, run, accrualPeriodEnd, run.periodEnd)) {
      acceptedNextRuns.push(run);
    }
  }
  const nextRunIds = new Set(acceptedNextRuns.map((run) => run.id));
  revenueRuns = [...acceptedNextRuns, ...revenueRuns.filter((run) => !nextRunIds.has(run.id))].slice(0, 250);
  lastSync = new Date().toISOString();
  await persist();
  return getSnapshot();
}

export async function syncExternalActivity(): Promise<DashboardSnapshot> {
  const [wise, revolut, slash, amex, merit, liveMeritTaxes] = await Promise.allSettled([
    fetchWiseActivity(),
    fetchRevolutActivity(),
    fetchSlashActivity(),
    fetchAmexActivity(),
    fetchMeritInvoices(),
    fetchMeritTaxes()
  ]);
  const liveTransactions: Transaction[] = [];
  const bankIssue = (label: string, error: unknown): string => {
    const message = error instanceof Error ? error.message : String(error);
    return `${label} balance sync failed: ${message.slice(0, 240)}`;
  };
  bankSyncIssues = {
    ...(revolut.status === "rejected" ? { revolut: bankIssue("Revolut", revolut.reason) } : {}),
    ...(slash.status === "rejected" ? { slash: bankIssue("Slash", slash.reason) } : {}),
    ...(amex.status === "rejected" ? { amex: bankIssue("Amex", amex.reason) } : {})
  };

  if (wise.status === "fulfilled") {
    wiseSyncIssue = summarizeWiseStatementIssues(wise.value.statementIssues);
    if (wise.value.accounts.length > 0) {
      accounts = [...accounts.filter((account) => account.source !== "wise"), ...wise.value.accounts];
    }
    liveTransactions.push(...wise.value.transactions);
  } else {
    wiseSyncIssue = wiseStatementIssue(wise.reason);
  }
  if (revolut.status === "fulfilled") {
    if (revolut.value.accounts.length > 0) {
      accounts = [...accounts.filter((account) => account.source !== "revolut"), ...revolut.value.accounts];
    }
    liveTransactions.push(...revolut.value.transactions);
  }
  if (slash.status === "fulfilled") {
    if (slash.value.accounts.length > 0) {
      accounts = [...accounts.filter((account) => account.source !== "slash"), ...slash.value.accounts];
    }
    liveTransactions.push(...slash.value.transactions);
  }
  if (amex.status === "fulfilled") {
    if (amex.value.accounts.length > 0) {
      accounts = [...accounts.filter((account) => account.source !== "amex"), ...amex.value.accounts];
    }
    liveTransactions.push(...amex.value.transactions);
  }
  if (merit.status === "fulfilled" && merit.value.length > 0) {
    mergeMeritInvoiceState(merit.value);
  }
  if (liveMeritTaxes.status === "fulfilled") {
    meritTaxes = liveMeritTaxes.value;
  }
  meritSyncIssue =
    merit.status === "rejected"
      ? meritConnectionIssue(merit.reason)
      : liveMeritTaxes.status === "rejected"
        ? meritConnectionIssue(liveMeritTaxes.reason)
        : undefined;

  if (liveTransactions.length > 0) {
    const existingById = new Map(transactions.map((transaction) => [transaction.id, transaction]));
    const incomingIds = new Set(liveTransactions.map((transaction) => transaction.id));
    const mergedLiveTransactions = liveTransactions.map((transaction) => {
      const existing = existingById.get(transaction.id);
      if (!existing) return transaction;
      return {
        ...transaction,
        category: existing.category,
        ...(existing.matchedProviderId ? { matchedProviderId: existing.matchedProviderId } : {}),
        ...(existing.matchedInvoiceId ? { matchedInvoiceId: existing.matchedInvoiceId } : {}),
        ...(existing.teamId ? { teamId: existing.teamId } : {}),
        ...(existing.confidence !== undefined ? { confidence: existing.confidence } : {}),
        ...(existing.matchReason ? { matchReason: existing.matchReason } : {})
      };
    });
    transactions = [
      ...mergedLiveTransactions,
      ...transactions.filter((transaction) => !incomingIds.has(transaction.id))
    ];
  }

  reconcileStoredPayments();
  await updateCurrentFxRates();
  lastSync = new Date().toISOString();
  await persist();
  return getSnapshot();
}
