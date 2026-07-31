import { isReviewOnlyTransactionCategory, transactionBusinessCategory } from "./categories";
import { isInternalTransferTransaction } from "./transactionPresentation";
import type {
  BankAnalyticsAggregate,
  BankAnalyticsCategoryBreakdown,
  BankAnalyticsMerchantBreakdown,
  BankAnalyticsProviderBreakdown,
  BankAnalyticsRelationship,
  BankAnalyticsRelationshipBreakdown,
  BankAnalyticsReviewSample,
  BankAnalyticsSnapshot,
  BankAnalyticsSourceBreakdown,
  BankAnalyticsTeamBreakdown,
  BankTransactionSource,
  CurrencyTotals,
  Provider,
  Team,
  Transaction
} from "./types";

export const bankAnalyticsLimits = Object.freeze({
  currencies: 64,
  categories: 256,
  teams: 512,
  providers: 2_000,
  unmatchedMerchantRows: 40,
  reviewSamples: 8,
  dimensionTextLength: 160,
  reviewReasonLength: 240,
  serializedStateBytes: 750_000
});

export type BankAnalyticsAggregateState = [
  transactionCount: number,
  moneyInTransactionCount: number,
  moneyOutTransactionCount: number,
  matchedTransactionCount: number,
  needsReviewCount: number,
  moneyIn: [string, number][],
  moneyOut: [string, number][],
  moneyInTransactionCounts: [string, number][],
  moneyOutTransactionCounts: [string, number][]
];

export interface BankAnalyticsAccumulatorState {
  version: 1;
  fromDate: string;
  toDate: string;
  configurationFingerprint: string;
  unmatchedMerchantRowLimit: number;
  reviewSampleLimit: number;
  transactionCount: number;
  internalTransferCount: number;
  needsReviewCount: number;
  evictedCandidateCount: number;
  summary: BankAnalyticsAggregateState;
  categories: [string, BankAnalyticsAggregateState][];
  teams: [string, BankAnalyticsAggregateState][];
  sources: [BankTransactionSource, BankAnalyticsAggregateState][];
  providers: [string, BankAnalyticsAggregateState][];
  relationships: [BankAnalyticsRelationship, BankAnalyticsAggregateState][];
  merchantCandidates: [
    merchantKey: string,
    merchantName: string,
    estimatedTransactionCount: number,
    estimateError: number,
    aggregate: BankAnalyticsAggregateState
  ][];
  merchantOther: BankAnalyticsAggregateState;
  reviewSamples: BankAnalyticsReviewSample[];
  activeTeams: string[];
  activeSources: BankTransactionSource[];
  knownCurrencies: string[];
}

export interface BankAnalyticsAccumulatorOptions {
  fromDate: string;
  toDate: string;
  providers: readonly Pick<Provider, "id" | "name" | "type">[];
  teams: readonly Pick<Team, "id" | "name">[];
  unmatchedMerchantRowLimit?: number;
  reviewSampleLimit?: number;
  state?: BankAnalyticsAccumulatorState;
}

export interface BankAnalyticsAccumulator {
  /** Pages must be duplicate-free and belong to the configured inclusive date range. */
  addPage(transactions: readonly Transaction[]): void;
  /** JSON-safe bounded checkpoint for a later Worker invocation. */
  serialize(): BankAnalyticsAccumulatorState;
  finish(generatedAt?: string): BankAnalyticsSnapshot;
}

type MutableAggregate = {
  transactionCount: number;
  moneyInTransactionCount: number;
  moneyOutTransactionCount: number;
  matchedTransactionCount: number;
  needsReviewCount: number;
  moneyIn: Map<string, number>;
  moneyOut: Map<string, number>;
  moneyInTransactionCounts: Map<string, number>;
  moneyOutTransactionCounts: Map<string, number>;
};

type MerchantCandidate = {
  merchantKey: string;
  merchantName: string;
  estimatedTransactionCount: number;
  estimateError: number;
  aggregate: MutableAggregate;
};

const bankSources = new Set<BankTransactionSource>(["wise", "revolut", "slash", "amex"]);
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

function assertIsoDate(value: string, label: string): string {
  if (!isoDatePattern.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) {
    throw new Error(`${label} must use YYYY-MM-DD`);
  }
  return value;
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string
): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return resolved;
}

function dimensionText(value: string, label: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) throw new Error(`${label} is required`);
  if (normalized.length > bankAnalyticsLimits.dimensionTextLength) {
    throw new Error(`${label} exceeds ${bankAnalyticsLimits.dimensionTextLength} characters`);
  }
  return normalized;
}

function compactText(value: string, maximum: number, fallback: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  return (normalized || fallback).slice(0, maximum);
}

function normalizedMerchantKey(transaction: Transaction, merchantName: string): string {
  const supplied = transaction.merchantKey?.trim();
  const normalized = (supplied || merchantName)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, bankAnalyticsLimits.dimensionTextLength);
  return normalized || compactText(transaction.id, bankAnalyticsLimits.dimensionTextLength, "unknown-merchant");
}

function transactionCompany(transaction: Transaction): string {
  return compactText(
    transaction.merchantName
      || transaction.counterparty
      || transaction.rawName
      || transaction.description,
    bankAnalyticsLimits.dimensionTextLength,
    "Unknown merchant"
  );
}

function emptyMutableAggregate(): MutableAggregate {
  return {
    transactionCount: 0,
    moneyInTransactionCount: 0,
    moneyOutTransactionCount: 0,
    matchedTransactionCount: 0,
    needsReviewCount: 0,
    moneyIn: new Map(),
    moneyOut: new Map(),
    moneyInTransactionCounts: new Map(),
    moneyOutTransactionCounts: new Map()
  };
}

function incrementMoney(totals: Map<string, number>, currency: string, amount: number): void {
  totals.set(currency, (totals.get(currency) ?? 0) + amount);
}

function addTransaction(aggregate: MutableAggregate, transaction: Transaction, needsReview: boolean): void {
  aggregate.transactionCount += 1;
  if (transaction.direction === "in") aggregate.moneyInTransactionCount += 1;
  else aggregate.moneyOutTransactionCount += 1;
  if (transaction.matchedProviderId) aggregate.matchedTransactionCount += 1;
  if (needsReview) aggregate.needsReviewCount += 1;
  incrementMoney(
    transaction.direction === "in" ? aggregate.moneyIn : aggregate.moneyOut,
    transaction.currency,
    transaction.amount
  );
  incrementMoney(
    transaction.direction === "in" ? aggregate.moneyInTransactionCounts : aggregate.moneyOutTransactionCounts,
    transaction.currency,
    1
  );
}

function mergeAggregate(target: MutableAggregate, source: MutableAggregate): void {
  target.transactionCount += source.transactionCount;
  target.moneyInTransactionCount += source.moneyInTransactionCount;
  target.moneyOutTransactionCount += source.moneyOutTransactionCount;
  target.matchedTransactionCount += source.matchedTransactionCount;
  target.needsReviewCount += source.needsReviewCount;
  for (const [currency, amount] of source.moneyIn) incrementMoney(target.moneyIn, currency, amount);
  for (const [currency, amount] of source.moneyOut) incrementMoney(target.moneyOut, currency, amount);
  for (const [currency, count] of source.moneyInTransactionCounts) {
    incrementMoney(target.moneyInTransactionCounts, currency, count);
  }
  for (const [currency, count] of source.moneyOutTransactionCounts) {
    incrementMoney(target.moneyOutTransactionCounts, currency, count);
  }
}

function currencyTotals(totals: Map<string, number>): CurrencyTotals {
  return Object.fromEntries([...totals].sort(([left], [right]) => left.localeCompare(right)));
}

function finalizeAggregate(aggregate: MutableAggregate): BankAnalyticsAggregate {
  return {
    transactionCount: aggregate.transactionCount,
    moneyInTransactionCount: aggregate.moneyInTransactionCount,
    moneyOutTransactionCount: aggregate.moneyOutTransactionCount,
    matchedTransactionCount: aggregate.matchedTransactionCount,
    needsReviewCount: aggregate.needsReviewCount,
    moneyIn: currencyTotals(aggregate.moneyIn),
    moneyOut: currencyTotals(aggregate.moneyOut),
    moneyInTransactionCounts: currencyTotals(aggregate.moneyInTransactionCounts),
    moneyOutTransactionCounts: currencyTotals(aggregate.moneyOutTransactionCounts)
  };
}

function aggregateState(aggregate: MutableAggregate): BankAnalyticsAggregateState {
  const entries = (totals: Map<string, number>): [string, number][] =>
    [...totals].sort(([left], [right]) => left.localeCompare(right));
  return [
    aggregate.transactionCount,
    aggregate.moneyInTransactionCount,
    aggregate.moneyOutTransactionCount,
    aggregate.matchedTransactionCount,
    aggregate.needsReviewCount,
    entries(aggregate.moneyIn),
    entries(aggregate.moneyOut),
    entries(aggregate.moneyInTransactionCounts),
    entries(aggregate.moneyOutTransactionCounts)
  ];
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer`);
  return value;
}

function restoreCurrencyEntries(
  entries: [string, number][],
  knownCurrencies: ReadonlySet<string>,
  label: string,
  counts: boolean
): Map<string, number> {
  if (!Array.isArray(entries) || entries.length > bankAnalyticsLimits.currencies) {
    throw new Error(`${label} exceeds the Analytics currency limit`);
  }
  const restored = new Map<string, number>();
  for (const entry of entries) {
    if (!Array.isArray(entry) || entry.length !== 2) throw new Error(`${label} contains an invalid currency entry`);
    const [currency, value] = entry;
    if (typeof currency !== "string" || !/^[A-Z0-9]{2,12}$/.test(currency) || !knownCurrencies.has(currency)) {
      throw new Error(`${label} contains an unknown currency`);
    }
    if (!Number.isFinite(value) || value < 0 || (counts && !Number.isSafeInteger(value))) {
      throw new Error(`${label} contains an invalid value`);
    }
    if (restored.has(currency)) throw new Error(`${label} contains a duplicate currency`);
    restored.set(currency, value);
  }
  return restored;
}

function restoreAggregateState(
  state: BankAnalyticsAggregateState,
  knownCurrencies: ReadonlySet<string>,
  label: string
): MutableAggregate {
  if (!Array.isArray(state) || state.length !== 9) throw new Error(`${label} has an invalid aggregate`);
  const transactionCount = nonNegativeInteger(state[0], `${label} transaction count`);
  const moneyInTransactionCount = nonNegativeInteger(state[1], `${label} money-in count`);
  const moneyOutTransactionCount = nonNegativeInteger(state[2], `${label} money-out count`);
  const matchedTransactionCount = nonNegativeInteger(state[3], `${label} matched count`);
  const needsReviewCount = nonNegativeInteger(state[4], `${label} review count`);
  if (moneyInTransactionCount + moneyOutTransactionCount !== transactionCount) {
    throw new Error(`${label} directional counts do not equal its transaction count`);
  }
  if (matchedTransactionCount > transactionCount || needsReviewCount > transactionCount) {
    throw new Error(`${label} contains an impossible count`);
  }
  const moneyIn = restoreCurrencyEntries(state[5], knownCurrencies, `${label} money in`, false);
  const moneyOut = restoreCurrencyEntries(state[6], knownCurrencies, `${label} money out`, false);
  const moneyInTransactionCounts = restoreCurrencyEntries(
    state[7],
    knownCurrencies,
    `${label} money-in counts`,
    true
  );
  const moneyOutTransactionCounts = restoreCurrencyEntries(
    state[8],
    knownCurrencies,
    `${label} money-out counts`,
    true
  );
  const inCount = [...moneyInTransactionCounts.values()].reduce((sum, value) => sum + value, 0);
  const outCount = [...moneyOutTransactionCounts.values()].reduce((sum, value) => sum + value, 0);
  if (inCount !== moneyInTransactionCount || outCount !== moneyOutTransactionCount) {
    throw new Error(`${label} currency counts do not equal its directional counts`);
  }
  return {
    transactionCount,
    moneyInTransactionCount,
    moneyOutTransactionCount,
    matchedTransactionCount,
    needsReviewCount,
    moneyIn,
    moneyOut,
    moneyInTransactionCounts,
    moneyOutTransactionCounts
  };
}

function serializedByteLength(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    throw new Error("Analytics accumulator state must be JSON serializable");
  }
}

function configurationFingerprint(
  fromDate: string,
  toDate: string,
  merchantRowLimit: number,
  reviewSampleLimit: number,
  providerDirectory: ReadonlyMap<string, Pick<Provider, "id" | "name" | "type">>,
  teamDirectory: ReadonlyMap<string, string>
): string {
  const input = JSON.stringify([
    fromDate,
    toDate,
    merchantRowLimit,
    reviewSampleLimit,
    [...providerDirectory.values()]
      .map((provider) => [provider.id, provider.name, provider.type])
      .sort(([left], [right]) => left.localeCompare(right)),
    [...teamDirectory]
      .sort(([left], [right]) => left.localeCompare(right))
  ]);
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function compareAggregateRows(
  left: { transactionCount: number },
  right: { transactionCount: number },
  leftLabel: string,
  rightLabel: string
): number {
  return right.transactionCount - left.transactionCount || leftLabel.localeCompare(rightLabel);
}

function addBoundedDimension<T>(map: Map<string, T>, key: string, maximum: number, label: string, create: () => T): T {
  const current = map.get(key);
  if (current) return current;
  if (map.size >= maximum) {
    throw new Error(`Analytics ${label} cardinality exceeds the hard limit of ${maximum}`);
  }
  const next = create();
  map.set(key, next);
  return next;
}

export function createBankAnalyticsAccumulator(options: BankAnalyticsAccumulatorOptions): BankAnalyticsAccumulator {
  const fromDate = assertIsoDate(options.fromDate, "Analytics fromDate");
  const toDate = assertIsoDate(options.toDate, "Analytics toDate");
  if (fromDate > toDate) throw new Error("Analytics fromDate must not be after toDate");

  const merchantRowLimit = boundedInteger(
    options.unmatchedMerchantRowLimit ?? options.state?.unmatchedMerchantRowLimit,
    bankAnalyticsLimits.unmatchedMerchantRows,
    1,
    bankAnalyticsLimits.unmatchedMerchantRows,
    "Analytics unmatched merchant row limit"
  );
  const reviewSampleLimit = boundedInteger(
    options.reviewSampleLimit ?? options.state?.reviewSampleLimit,
    bankAnalyticsLimits.reviewSamples,
    0,
    bankAnalyticsLimits.reviewSamples,
    "Analytics review sample limit"
  );
  if (options.providers.length > bankAnalyticsLimits.providers) {
    throw new Error(`Analytics provider directory exceeds the hard limit of ${bankAnalyticsLimits.providers}`);
  }
  if (options.teams.length > bankAnalyticsLimits.teams) {
    throw new Error(`Analytics team directory exceeds the hard limit of ${bankAnalyticsLimits.teams}`);
  }

  const providerDirectory = new Map<string, Pick<Provider, "id" | "name" | "type">>();
  for (const provider of options.providers) {
    const providerId = dimensionText(provider.id, "Provider ID");
    if (providerDirectory.has(providerId)) throw new Error(`Duplicate provider ID: ${providerId}`);
    providerDirectory.set(providerId, {
      id: providerId,
      name: dimensionText(provider.name, "Provider name"),
      type: provider.type
    });
  }

  const teamDirectory = new Map<string, string>();
  for (const team of options.teams) {
    const teamId = dimensionText(team.id, "Team ID");
    if (teamDirectory.has(teamId)) throw new Error(`Duplicate team ID: ${teamId}`);
    teamDirectory.set(teamId, dimensionText(team.name, "Team name"));
  }

  const expectedConfigurationFingerprint = configurationFingerprint(
    fromDate,
    toDate,
    merchantRowLimit,
    reviewSampleLimit,
    providerDirectory,
    teamDirectory
  );
  let summaryAggregate = emptyMutableAggregate();
  const categoryAggregates = new Map<string, MutableAggregate>();
  const teamAggregates = new Map<string, MutableAggregate>();
  const sourceAggregates = new Map<BankTransactionSource, MutableAggregate>();
  const providerAggregates = new Map<string, MutableAggregate>();
  const relationshipAggregates = new Map<BankAnalyticsRelationship, MutableAggregate>();
  const merchantCandidates = new Map<string, MerchantCandidate>();
  let merchantOther = emptyMutableAggregate();
  const reviewSamples: BankAnalyticsReviewSample[] = [];
  const activeTeams = new Set<string>();
  const activeSources = new Set<BankTransactionSource>();
  const knownCurrencies = new Set<string>();
  let transactionCount = 0;
  let internalTransferCount = 0;
  let needsReviewCount = 0;
  let evictedCandidateCount = 0;
  let finished = false;

  function restoreDimensionMap(
    rows: [string, BankAnalyticsAggregateState][],
    target: Map<string, MutableAggregate>,
    maximum: number,
    label: string,
    allowEmptyKey = false
  ): void {
    if (!Array.isArray(rows) || rows.length > maximum) {
      throw new Error(`Analytics ${label} state exceeds its hard cardinality limit`);
    }
    for (const row of rows) {
      if (!Array.isArray(row) || row.length !== 2 || typeof row[0] !== "string") {
        throw new Error(`Analytics ${label} state contains an invalid row`);
      }
      const key = allowEmptyKey && row[0] === "" ? "" : dimensionText(row[0], `Analytics ${label} key`);
      if (target.has(key)) throw new Error(`Analytics ${label} state contains a duplicate key`);
      target.set(key, restoreAggregateState(row[1], knownCurrencies, `Analytics ${label} ${key || "unassigned"}`));
    }
  }

  if (options.state) {
    const state = options.state;
    if (serializedByteLength(state) > bankAnalyticsLimits.serializedStateBytes) {
      throw new Error(`Analytics accumulator state exceeds ${bankAnalyticsLimits.serializedStateBytes} bytes`);
    }
    if (
      state.version !== 1
      || state.fromDate !== fromDate
      || state.toDate !== toDate
      || state.unmatchedMerchantRowLimit !== merchantRowLimit
      || state.reviewSampleLimit !== reviewSampleLimit
      || state.configurationFingerprint !== expectedConfigurationFingerprint
    ) {
      throw new Error("Analytics accumulator state does not match the requested configuration");
    }
    if (!Array.isArray(state.knownCurrencies) || state.knownCurrencies.length > bankAnalyticsLimits.currencies) {
      throw new Error("Analytics accumulator state exceeds the currency limit");
    }
    for (const currency of state.knownCurrencies) {
      if (typeof currency !== "string" || !/^[A-Z0-9]{2,12}$/.test(currency)) {
        throw new Error("Analytics accumulator state contains an invalid currency");
      }
      if (knownCurrencies.has(currency)) throw new Error("Analytics accumulator state contains a duplicate currency");
      knownCurrencies.add(currency);
    }

    summaryAggregate = restoreAggregateState(state.summary, knownCurrencies, "Analytics summary");
    restoreDimensionMap(
      state.categories,
      categoryAggregates,
      bankAnalyticsLimits.categories,
      "category"
    );
    restoreDimensionMap(state.teams, teamAggregates, bankAnalyticsLimits.teams, "team", true);
    restoreDimensionMap(state.providers, providerAggregates, bankAnalyticsLimits.providers, "provider");

    if (!Array.isArray(state.sources) || state.sources.length > bankSources.size) {
      throw new Error("Analytics source state exceeds its hard cardinality limit");
    }
    for (const row of state.sources) {
      if (!Array.isArray(row) || row.length !== 2 || !bankSources.has(row[0])) {
        throw new Error("Analytics source state contains an invalid row");
      }
      if (sourceAggregates.has(row[0])) throw new Error("Analytics source state contains a duplicate source");
      sourceAggregates.set(row[0], restoreAggregateState(row[1], knownCurrencies, `Analytics source ${row[0]}`));
    }

    if (!Array.isArray(state.relationships) || state.relationships.length > 3) {
      throw new Error("Analytics relationship state exceeds its hard cardinality limit");
    }
    for (const row of state.relationships) {
      if (
        !Array.isArray(row)
        || row.length !== 2
        || (row[0] !== "client" && row[0] !== "supplier" && row[0] !== "unknown")
      ) {
        throw new Error("Analytics relationship state contains an invalid row");
      }
      if (relationshipAggregates.has(row[0])) {
        throw new Error("Analytics relationship state contains a duplicate relationship");
      }
      relationshipAggregates.set(
        row[0],
        restoreAggregateState(row[1], knownCurrencies, `Analytics relationship ${row[0]}`)
      );
    }

    if (!Array.isArray(state.merchantCandidates) || state.merchantCandidates.length > merchantRowLimit) {
      throw new Error("Analytics merchant state exceeds its hard cardinality limit");
    }
    for (const row of state.merchantCandidates) {
      if (!Array.isArray(row) || row.length !== 5) throw new Error("Analytics merchant state contains an invalid row");
      const merchantKey = dimensionText(row[0], "Analytics merchant key");
      const merchantName = dimensionText(row[1], "Analytics merchant name");
      const estimatedTransactionCount = nonNegativeInteger(row[2], "Analytics merchant estimate");
      const estimateError = nonNegativeInteger(row[3], "Analytics merchant estimate error");
      const aggregate = restoreAggregateState(row[4], knownCurrencies, `Analytics merchant ${merchantKey}`);
      if (
        estimatedTransactionCount < aggregate.transactionCount
        || estimateError > estimatedTransactionCount
        || aggregate.matchedTransactionCount !== 0
      ) {
        throw new Error("Analytics merchant state contains an impossible estimate");
      }
      if (merchantCandidates.has(merchantKey)) throw new Error("Analytics merchant state contains a duplicate key");
      merchantCandidates.set(merchantKey, {
        merchantKey,
        merchantName,
        estimatedTransactionCount,
        estimateError,
        aggregate
      });
    }
    merchantOther = restoreAggregateState(state.merchantOther, knownCurrencies, "Analytics other merchants");
    if (merchantOther.matchedTransactionCount !== 0) {
      throw new Error("Analytics other-merchant state cannot contain matched transactions");
    }

    if (!Array.isArray(state.reviewSamples) || state.reviewSamples.length > reviewSampleLimit) {
      throw new Error("Analytics review sample state exceeds its hard cardinality limit");
    }
    for (const sample of state.reviewSamples) {
      if (
        !sample
        || typeof sample !== "object"
        || (sample.direction !== "in" && sample.direction !== "out")
        || !Number.isFinite(sample.amount)
        || sample.amount < 0
        || !knownCurrencies.has(sample.currency)
        || !isoDatePattern.test(sample.date)
        || sample.date < fromDate
        || sample.date > toDate
      ) {
        throw new Error("Analytics review sample state contains an invalid row");
      }
      const id = dimensionText(sample.id, "Analytics review sample ID");
      const company = dimensionText(sample.company, "Analytics review sample company");
      const category = dimensionText(sample.category, "Analytics review sample category");
      const reason = sample.reason.trim().replace(/\s+/g, " ");
      if (!reason || reason.length > bankAnalyticsLimits.reviewReasonLength) {
        throw new Error("Analytics review sample state contains an invalid reason");
      }
      reviewSamples.push({ ...sample, id, company, category, reason });
    }

    if (!Array.isArray(state.activeTeams) || state.activeTeams.length > bankAnalyticsLimits.teams) {
      throw new Error("Analytics active-team state exceeds its hard cardinality limit");
    }
    for (const rawTeamId of state.activeTeams) {
      const teamId = dimensionText(rawTeamId, "Analytics active team ID");
      if (activeTeams.has(teamId)) throw new Error("Analytics active-team state contains a duplicate ID");
      activeTeams.add(teamId);
    }
    if (!Array.isArray(state.activeSources) || state.activeSources.length > bankSources.size) {
      throw new Error("Analytics active-source state exceeds its hard cardinality limit");
    }
    for (const source of state.activeSources) {
      if (!bankSources.has(source) || activeSources.has(source)) {
        throw new Error("Analytics active-source state contains an invalid source");
      }
      activeSources.add(source);
    }

    transactionCount = nonNegativeInteger(state.transactionCount, "Analytics transaction count");
    internalTransferCount = nonNegativeInteger(state.internalTransferCount, "Analytics internal-transfer count");
    needsReviewCount = nonNegativeInteger(state.needsReviewCount, "Analytics review count");
    evictedCandidateCount = nonNegativeInteger(state.evictedCandidateCount, "Analytics merchant eviction count");
    if (
      transactionCount !== summaryAggregate.transactionCount + internalTransferCount
      || needsReviewCount < summaryAggregate.needsReviewCount
      || needsReviewCount > transactionCount
      || reviewSamples.length > needsReviewCount
      || (evictedCandidateCount === 0) !== (merchantOther.transactionCount === 0)
    ) {
      throw new Error("Analytics accumulator state contains inconsistent headline counts");
    }
    const sumTransactions = (values: Iterable<MutableAggregate>) =>
      [...values].reduce((sum, aggregate) => sum + aggregate.transactionCount, 0);
    if (
      sumTransactions(categoryAggregates.values()) !== summaryAggregate.transactionCount
      || sumTransactions(teamAggregates.values()) !== summaryAggregate.transactionCount
      || sumTransactions(sourceAggregates.values()) !== summaryAggregate.transactionCount
      || sumTransactions(relationshipAggregates.values()) !== summaryAggregate.transactionCount
      || sumTransactions(providerAggregates.values()) !== summaryAggregate.matchedTransactionCount
      || sumTransactions([...merchantCandidates.values()].map((candidate) => candidate.aggregate))
        + merchantOther.transactionCount
        !== summaryAggregate.transactionCount - summaryAggregate.matchedTransactionCount
    ) {
      throw new Error("Analytics accumulator state contains inconsistent dimension counts");
    }
  }

  function normalizedCurrency(value: string): string {
    const currency = value.trim().toUpperCase();
    if (!/^[A-Z0-9]{2,12}$/.test(currency)) throw new Error(`Invalid analytics currency: ${value}`);
    if (!knownCurrencies.has(currency)) {
      if (knownCurrencies.size >= bankAnalyticsLimits.currencies) {
        throw new Error(`Analytics currency cardinality exceeds the hard limit of ${bankAnalyticsLimits.currencies}`);
      }
      knownCurrencies.add(currency);
    }
    return currency;
  }

  function addMerchant(transaction: Transaction, needsReview: boolean): void {
    const merchantName = transactionCompany(transaction);
    const merchantKey = normalizedMerchantKey(transaction, merchantName);
    const existing = merchantCandidates.get(merchantKey);
    if (existing) {
      existing.estimatedTransactionCount += 1;
      addTransaction(existing.aggregate, transaction, needsReview);
      return;
    }

    if (merchantCandidates.size < merchantRowLimit) {
      const aggregate = emptyMutableAggregate();
      addTransaction(aggregate, transaction, needsReview);
      merchantCandidates.set(merchantKey, {
        merchantKey,
        merchantName,
        estimatedTransactionCount: 1,
        estimateError: 0,
        aggregate
      });
      return;
    }

    let smallest: MerchantCandidate | undefined;
    for (const candidate of merchantCandidates.values()) {
      if (
        !smallest
        || candidate.estimatedTransactionCount < smallest.estimatedTransactionCount
        || (
          candidate.estimatedTransactionCount === smallest.estimatedTransactionCount
          && candidate.merchantKey.localeCompare(smallest.merchantKey) > 0
        )
      ) {
        smallest = candidate;
      }
    }
    if (!smallest) throw new Error("Analytics merchant candidate set is unexpectedly empty");

    merchantCandidates.delete(smallest.merchantKey);
    mergeAggregate(merchantOther, smallest.aggregate);
    evictedCandidateCount += 1;
    const aggregate = emptyMutableAggregate();
    addTransaction(aggregate, transaction, needsReview);
    merchantCandidates.set(merchantKey, {
      merchantKey,
      merchantName,
      estimatedTransactionCount: smallest.estimatedTransactionCount + 1,
      estimateError: smallest.estimatedTransactionCount,
      aggregate
    });
  }

  function addPage(transactions: readonly Transaction[]): void {
    if (finished) throw new Error("Analytics accumulator has already been finalized");

    for (const original of transactions) {
      if (original.status === "voided" || original.status === "pending") continue;
      const transactionDate = original.date.slice(0, 10);
      if (!isoDatePattern.test(transactionDate) || transactionDate < fromDate || transactionDate > toDate) {
        throw new Error(`Transaction ${original.id} is outside the Analytics date range`);
      }
      if (!bankSources.has(original.source as BankTransactionSource)) {
        throw new Error(`Transaction ${original.id} has unsupported Analytics source ${original.source}`);
      }
      if (!Number.isFinite(original.amount) || original.amount < 0) {
        throw new Error(`Transaction ${original.id} has an invalid Analytics amount`);
      }
      dimensionText(original.id, "Transaction ID");
      const source = original.source as BankTransactionSource;
      const currency = normalizedCurrency(original.currency);
      const transaction = currency === original.currency ? original : { ...original, currency };
      const needsReview = isReviewOnlyTransactionCategory(transaction.category);

      transactionCount += 1;
      activeSources.add(source);
      if (needsReview) {
        needsReviewCount += 1;
        if (reviewSamples.length < reviewSampleLimit) {
          reviewSamples.push({
            id: transaction.id,
            date: transactionDate,
            direction: transaction.direction,
            amount: transaction.amount,
            currency,
            company: transactionCompany(transaction),
            category: transactionBusinessCategory(transaction.category),
            reason: compactText(
              transaction.categoryReason || "AI classification pending",
              bankAnalyticsLimits.reviewReasonLength,
              "AI classification pending"
            )
          });
        }
      }

      if (isInternalTransferTransaction(transaction)) {
        internalTransferCount += 1;
        continue;
      }

      addTransaction(summaryAggregate, transaction, needsReview);
      const category = dimensionText(transactionBusinessCategory(transaction.category), "Analytics category");
      addTransaction(
        addBoundedDimension(
          categoryAggregates,
          category,
          bankAnalyticsLimits.categories,
          "category",
          emptyMutableAggregate
        ),
        transaction,
        needsReview
      );

      const teamId = transaction.teamId ? dimensionText(transaction.teamId, "Team ID") : "";
      if (teamId) activeTeams.add(teamId);
      addTransaction(
        addBoundedDimension(
          teamAggregates,
          teamId,
          bankAnalyticsLimits.teams,
          "team",
          emptyMutableAggregate
        ),
        transaction,
        needsReview
      );

      const sourceAggregate = sourceAggregates.get(source) ?? emptyMutableAggregate();
      addTransaction(sourceAggregate, transaction, needsReview);
      sourceAggregates.set(source, sourceAggregate);

      const providerId = transaction.matchedProviderId
        ? dimensionText(transaction.matchedProviderId, "Provider ID")
        : "";
      const provider = providerId ? providerDirectory.get(providerId) : undefined;
      const relationship: BankAnalyticsRelationship = provider?.type ?? "unknown";
      const relationshipAggregate = relationshipAggregates.get(relationship) ?? emptyMutableAggregate();
      addTransaction(relationshipAggregate, transaction, needsReview);
      relationshipAggregates.set(relationship, relationshipAggregate);

      if (providerId) {
        addTransaction(
          addBoundedDimension(
            providerAggregates,
            providerId,
            bankAnalyticsLimits.providers,
            "provider",
            emptyMutableAggregate
          ),
          transaction,
          needsReview
        );
      } else {
        addMerchant(transaction, needsReview);
      }
    }
  }

  function serialize(): BankAnalyticsAccumulatorState {
    if (finished) throw new Error("Analytics accumulator has already been finalized");
    const aggregateRows = (rows: ReadonlyMap<string, MutableAggregate>): [string, BankAnalyticsAggregateState][] =>
      [...rows]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, aggregate]) => [key, aggregateState(aggregate)]);
    const state: BankAnalyticsAccumulatorState = {
      version: 1,
      fromDate,
      toDate,
      configurationFingerprint: expectedConfigurationFingerprint,
      unmatchedMerchantRowLimit: merchantRowLimit,
      reviewSampleLimit,
      transactionCount,
      internalTransferCount,
      needsReviewCount,
      evictedCandidateCount,
      summary: aggregateState(summaryAggregate),
      categories: aggregateRows(categoryAggregates),
      teams: aggregateRows(teamAggregates),
      sources: [...sourceAggregates]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([source, aggregate]) => [source, aggregateState(aggregate)]),
      providers: aggregateRows(providerAggregates),
      relationships: [...relationshipAggregates]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([relationship, aggregate]) => [relationship, aggregateState(aggregate)]),
      merchantCandidates: [...merchantCandidates.values()]
        .sort((left, right) => left.merchantKey.localeCompare(right.merchantKey))
        .map((candidate) => [
          candidate.merchantKey,
          candidate.merchantName,
          candidate.estimatedTransactionCount,
          candidate.estimateError,
          aggregateState(candidate.aggregate)
        ]),
      merchantOther: aggregateState(merchantOther),
      reviewSamples: reviewSamples.map((sample) => ({ ...sample })),
      activeTeams: [...activeTeams].sort((left, right) => left.localeCompare(right)),
      activeSources: [...activeSources].sort((left, right) => left.localeCompare(right)),
      knownCurrencies: [...knownCurrencies].sort((left, right) => left.localeCompare(right))
    };
    const byteLength = serializedByteLength(state);
    if (byteLength > bankAnalyticsLimits.serializedStateBytes) {
      throw new Error(
        `Analytics accumulator state is ${byteLength} bytes; the hard limit is ${bankAnalyticsLimits.serializedStateBytes}`
      );
    }
    return state;
  }

  function finish(generatedAt = new Date().toISOString()): BankAnalyticsSnapshot {
    if (finished) throw new Error("Analytics accumulator has already been finalized");
    if (generatedAt.length > 40 || Number.isNaN(Date.parse(generatedAt))) {
      throw new Error("Analytics generatedAt must be a bounded ISO timestamp");
    }
    finished = true;

    const categories: BankAnalyticsCategoryBreakdown[] = [...categoryAggregates].map(([category, aggregate]) => ({
      category,
      ...finalizeAggregate(aggregate)
    })).sort((left, right) => compareAggregateRows(left, right, left.category, right.category));

    const teams: BankAnalyticsTeamBreakdown[] = [...teamAggregates].map(([teamId, aggregate]) => ({
      teamId: teamId || null,
      teamName: teamId ? teamDirectory.get(teamId) ?? teamId : "Unassigned",
      ...finalizeAggregate(aggregate)
    })).sort((left, right) => compareAggregateRows(left, right, left.teamName, right.teamName));

    const sources: BankAnalyticsSourceBreakdown[] = [...sourceAggregates].map(([source, aggregate]) => ({
      source,
      ...finalizeAggregate(aggregate)
    })).sort((left, right) => left.source.localeCompare(right.source));

    const providers: BankAnalyticsProviderBreakdown[] = [...providerAggregates].map(([providerId, aggregate]): BankAnalyticsProviderBreakdown => {
      const provider = providerDirectory.get(providerId);
      return {
        providerId,
        providerName: provider?.name ?? providerId,
        relationship: provider?.type ?? "unknown",
        directoryMatch: Boolean(provider),
        ...finalizeAggregate(aggregate)
      };
    }).sort((left, right) => compareAggregateRows(left, right, left.providerName, right.providerName));

    const relationships: BankAnalyticsRelationshipBreakdown[] = [...relationshipAggregates].map(
      ([relationship, aggregate]) => ({ relationship, ...finalizeAggregate(aggregate) })
    ).sort((left, right) => left.relationship.localeCompare(right.relationship));

    const merchantRows: BankAnalyticsMerchantBreakdown[] = [...merchantCandidates.values()].map((candidate) => ({
      merchantKey: candidate.merchantKey,
      merchantName: candidate.merchantName,
      estimatedTransactionCount: candidate.estimatedTransactionCount,
      estimateError: candidate.estimateError,
      ...finalizeAggregate(candidate.aggregate)
    })).sort(
      (left, right) =>
        right.estimatedTransactionCount - left.estimatedTransactionCount
        || right.transactionCount - left.transactionCount
        || left.merchantName.localeCompare(right.merchantName)
    );

    return {
      version: 1,
      fromDate,
      toDate,
      generatedAt,
      summary: {
        transactionCount,
        externalTransactionCount: summaryAggregate.transactionCount,
        internalTransferCount,
        matchedTransactionCount: summaryAggregate.matchedTransactionCount,
        needsReviewCount,
        activeTeamCount: activeTeams.size,
        activeSourceCount: activeSources.size,
        moneyIn: currencyTotals(summaryAggregate.moneyIn),
        moneyOut: currencyTotals(summaryAggregate.moneyOut)
      },
      categories,
      teams,
      sources,
      providers,
      relationships,
      reviewSamples,
      unmatchedMerchants: {
        algorithm: "space-saving",
        rowLimit: merchantRowLimit,
        truncated: evictedCandidateCount > 0,
        evictedCandidateCount,
        rows: merchantRows,
        other: merchantOther.transactionCount > 0 ? finalizeAggregate(merchantOther) : null
      }
    };
  }

  return { addPage, serialize, finish };
}
