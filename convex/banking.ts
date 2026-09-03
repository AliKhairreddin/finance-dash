import type { Doc } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { ConvexError, v, type Infer } from "convex/values";
import {
  profitDistributionContribution,
  profitDistributionContributionVersion,
  type ProfitDistributionContribution,
  type ProfitDistributionPaymentFact
} from "../shared/distribution";
import { assertBankActivityBatchBudget } from "../shared/bankRecordValidation";
import { aggregateAnalyticsCategoryCompanies } from "../shared/categoryCompanies";
import { transactionBusinessCategory } from "../shared/categories";
import { isSlashDailyCardPayment } from "../shared/transactionPresentation";
import {
  bankProviderTransactionId,
  isCurrentBankTransactionId,
  isLegacySurrogateBankTransactionId
} from "../shared/providerIdentity";
import {
  assertActiveBankSyncLease,
  assertBankConnectionBinding,
  assertBankLedgerReady,
  ensureBankConnectionBinding
} from "./bankLease";

type BankSource = "wise" | "revolut" | "slash" | "amex";

const allBankSources: BankSource[] = ["wise", "revolut", "slash", "amex"];
const bankSource = v.union(
  v.literal("wise"),
  v.literal("revolut"),
  v.literal("slash"),
  v.literal("amex")
);
const bankConnection = v.object({ source: bankSource, connectionKey: v.string() });
const transactionClassificationSource = v.union(v.literal("ai"), v.literal("rule"), v.literal("manual"));
const invoiceMatchSource = v.union(v.literal("exact"), v.literal("tolerance"), v.literal("ai"), v.literal("manual"));
const slashAccountSubtype = v.union(v.literal("cash"), v.literal("credit"));
const slashVirtualAccount = v.object({
  id: v.string(),
  name: v.string(),
  accountId: v.string(),
  accountType: v.union(v.literal("primary"), v.literal("default")),
  closedAt: v.optional(v.string())
});
const wiseEntity = v.union(v.literal("dn"), v.literal("lmd"));
const maximumActivityPageSize = 200;
const maximumActivityRowsRead = 250;
const maximumActivityBytesRead = 4 * 1024 * 1024;
const maximumBankAccountsPerSource = 200;
const maximumMerchantUpdateBatchSize = 200;
const maximumMaintenanceBatchSize = 200;
const maximumProfitFactPageSize = 200;
const maximumCoverageRangesPerConnection = 256;
const bankLedgerRevisionKey = "default";

type BankTransactionDoc = Doc<"bankTransactions">;
type ProfitFactDelta = {
  month: string;
  currency: string;
  transactionCount: number;
  revenue: number;
  generalCosts: number;
  payments: Map<string, ProfitDistributionPaymentFact>;
};

type InvoiceCandidateCursor = {
  version: 1;
  currency: string;
  date: string;
  id: string;
};

const transaction = v.object({
  id: v.string(),
  source: bankSource,
  wiseEntity: v.optional(wiseEntity),
  slashAccountSubtype: v.optional(slashAccountSubtype),
  slashVirtualAccountId: v.optional(v.string()),
  slashVirtualAccountName: v.optional(v.string()),
  slashVirtualAccountMetadataVersion: v.optional(v.number()),
  accountId: v.optional(v.string()),
  accountName: v.string(),
  date: v.string(),
  description: v.string(),
  rawName: v.string(),
  counterparty: v.string(),
  cardHolderName: v.optional(v.string()),
  cardId: v.optional(v.string()),
  cardLastFour: v.optional(v.string()),
  cardMetadataVersion: v.optional(v.number()),
  amount: v.number(),
  currency: v.string(),
  cashback: v.optional(v.object({
    amount: v.number(),
    rate: v.number()
  })),
  direction: v.union(v.literal("in"), v.literal("out")),
  status: v.union(
    v.literal("posted"),
    v.literal("pending"),
    v.literal("settled"),
    v.literal("voided")
  ),
  category: v.string(),
  merchantName: v.optional(v.string()),
  merchantKey: v.optional(v.string()),
  classificationComplete: v.optional(v.boolean()),
  categorySource: v.optional(transactionClassificationSource),
  categoryConfidence: v.optional(v.number()),
  categoryReason: v.optional(v.string()),
  matchedProviderId: v.optional(v.string()),
  companyMatchSource: v.optional(transactionClassificationSource),
  companyConfidence: v.optional(v.number()),
  companyMatchReason: v.optional(v.string()),
  matchedInvoiceId: v.optional(v.string()),
  invoiceMatchSource: v.optional(invoiceMatchSource),
  invoiceMatchConfidence: v.optional(v.number()),
  invoiceMatchReason: v.optional(v.string()),
  teamId: v.optional(v.string()),
  confidence: v.optional(v.number()),
  matchReason: v.optional(v.string())
});
const ingestTransaction = v.object({
  ...transaction.fields,
  providerLegacyId: v.optional(v.string())
});
const transactionEnrichmentUpdate = v.object({
  id: v.string(),
  category: v.string(),
  merchantName: v.optional(v.string()),
  merchantKey: v.optional(v.string()),
  classificationComplete: v.optional(v.boolean()),
  categorySource: v.optional(transactionClassificationSource),
  categoryConfidence: v.optional(v.number()),
  categoryReason: v.optional(v.string()),
  matchedProviderId: v.optional(v.string()),
  companyMatchSource: v.optional(transactionClassificationSource),
  companyConfidence: v.optional(v.number()),
  companyMatchReason: v.optional(v.string()),
  invoiceMatchSource: v.optional(invoiceMatchSource),
  invoiceMatchConfidence: v.optional(v.number()),
  invoiceMatchReason: v.optional(v.string()),
  confidence: v.optional(v.number()),
  matchReason: v.optional(v.string())
});

const profitDistributionPaymentFact = v.object({
  partnerId: v.union(
    v.literal("ishan"),
    v.literal("ben"),
    v.literal("sanjan"),
    v.literal("amin")
  ),
  bucket: v.union(
    v.literal("profit-share"),
    v.literal("salary"),
    v.literal("distribution")
  ),
  amount: v.number()
});

const profitDistributionFact = v.object({
  version: v.number(),
  month: v.string(),
  currency: v.string(),
  transactionCount: v.number(),
  revenue: v.number(),
  generalCosts: v.number(),
  payments: v.array(profitDistributionPaymentFact)
});

const account = v.object({
  id: v.string(),
  name: v.string(),
  source: bankSource,
  wiseEntity: v.optional(wiseEntity),
  slashAccountSubtype: v.optional(slashAccountSubtype),
  slashVirtualAccounts: v.optional(v.array(slashVirtualAccount)),
  balance: v.number(),
  currency: v.string(),
  updatedAt: v.string(),
  status: v.union(v.literal("live"), v.literal("seeded"), v.literal("manual"))
});

type ActivityBatchArgs = {
  source: BankSource;
  connectionKey: string;
  replaceAccounts: boolean;
  accounts: Array<Infer<typeof account>>;
  transactions: Array<Infer<typeof ingestTransaction>>;
  syncedAt: string;
};

const activityBatchResult = v.object({
  accounts: v.number(),
  transactions: v.number(),
  insertedTransactions: v.number(),
  updatedTransactions: v.number()
});

const syncState = v.object({
  source: bankSource,
  coveredRanges: v.array(v.object({ fromDate: v.string(), toDate: v.string() })),
  lastSyncedAt: v.string()
});
const syncHealth = v.object({
  source: bankSource,
  status: v.union(v.literal("running"), v.literal("healthy"), v.literal("failed")),
  lastAttemptAt: v.string(),
  lastSuccessAt: v.optional(v.string()),
  lastError: v.optional(v.string()),
  consecutiveFailures: v.number()
});

function requireServiceToken(serviceToken: string): void {
  const expected = process.env.CONVEX_SERVICE_TOKEN;
  if (!expected || serviceToken !== expected) throw new ConvexError({ code: "UNAUTHORIZED" });
}

function normalizeFactAmount(value: number): number {
  return Math.abs(value) < 1e-9 || Object.is(value, -0) ? 0 : value;
}

function profitFactKey(month: string, currency: string): string {
  return `${month}:${currency}`;
}

function profitPaymentKey(payment: Pick<ProfitDistributionPaymentFact, "partnerId" | "bucket">): string {
  return `${payment.partnerId}:${payment.bucket}`;
}

function addProfitFactContribution(
  deltas: Map<string, ProfitFactDelta>,
  contribution: ProfitDistributionContribution,
  multiplier: 1 | -1
): void {
  const key = profitFactKey(contribution.month, contribution.currency);
  const delta = deltas.get(key) ?? {
    month: contribution.month,
    currency: contribution.currency,
    transactionCount: 0,
    revenue: 0,
    generalCosts: 0,
    payments: new Map<string, ProfitDistributionPaymentFact>()
  };
  delta.transactionCount += contribution.transactionCount * multiplier;
  delta.revenue += contribution.revenue * multiplier;
  delta.generalCosts += contribution.generalCosts * multiplier;
  for (const payment of contribution.payments) {
    const paymentKey = profitPaymentKey(payment);
    const existing = delta.payments.get(paymentKey);
    delta.payments.set(paymentKey, {
      partnerId: payment.partnerId,
      bucket: payment.bucket,
      amount: (existing?.amount ?? 0) + payment.amount * multiplier
    });
  }
  deltas.set(key, delta);
}

function assertSupportedProfitContributionVersion(transaction: BankTransactionDoc): void {
  if (
    transaction.profitContributionVersion !== undefined
    && transaction.profitContributionVersion !== profitDistributionContributionVersion
  ) {
    throw new ConvexError({
      code: "PROFIT_FACT_VERSION_MISMATCH",
      transactionId: transaction.id,
      storedVersion: transaction.profitContributionVersion,
      currentVersion: profitDistributionContributionVersion
    });
  }
}

function addVersionedProfitFactChange(
  deltas: Map<string, ProfitFactDelta>,
  existing: BankTransactionDoc,
  next: BankTransactionDoc
): void {
  assertSupportedProfitContributionVersion(existing);
  if (existing.profitContributionVersion === undefined) return;
  if (existing.identityVersion === 2) {
    addProfitFactContribution(deltas, profitDistributionContribution(existing), -1);
  }
  if (next.identityVersion === 2) {
    addProfitFactContribution(deltas, profitDistributionContribution(next), 1);
  }
}

function addVersionedProfitFactDeletion(
  deltas: Map<string, ProfitFactDelta>,
  transaction: BankTransactionDoc
): void {
  assertSupportedProfitContributionVersion(transaction);
  if (transaction.profitContributionVersion === undefined) return;
  if (transaction.identityVersion === 2) {
    addProfitFactContribution(deltas, profitDistributionContribution(transaction), -1);
  }
}

function publicTransactionValue(value: object): Record<string, unknown> {
  const {
    _id: _id,
    _creationTime: _creationTime,
    syncedAt: _syncedAt,
    connectionKey: _connectionKey,
    cardMetadataVersion: _cardMetadataVersion,
    profitContributionVersion: _profitContributionVersion,
    identityVersion: _identityVersion,
    ...transactionValue
  } = value as Record<string, unknown>;
  return transactionValue;
}

function transactionVisibleChanged(existing: object, next: object): boolean {
  return JSON.stringify(publicTransactionValue(existing)) !== JSON.stringify(publicTransactionValue(next));
}

function assertCurrentTransactionIdentity(source: BankSource, id: string): void {
  if (!isCurrentBankTransactionId(source, id)) {
    throw new ConvexError({ code: "LEGACY_TRANSACTION_ID_REJECTED", source, transactionId: id });
  }
}

function transactionAliasKey(source: BankSource, connectionKey: string, alias: string): string {
  if (!alias || alias.length > 2_048) {
    throw new ConvexError({ code: "INVALID_TRANSACTION_ALIAS", source });
  }
  return `${source}:${connectionKey}:${alias}`;
}

async function remapDashboardTransactionReferences(
  ctx: MutationCtx,
  changes: ReadonlyMap<string, string>
): Promise<void> {
  if (changes.size === 0) return;
  const state = await ctx.db
    .query("dashboardState")
    .withIndex("by_key", (q) => q.eq("key", "default"))
    .unique();
  if (!state) return;
  const remap = (transactionId: string | undefined) =>
    transactionId ? changes.get(transactionId) ?? transactionId : undefined;
  const previousTimestamp = Date.parse(state.updatedAt);
  const updatedAt = new Date(Math.max(Date.now(), previousTimestamp + 1)).toISOString();
  await ctx.db.patch(state._id, {
    invoices: state.invoices.map((invoice) => ({
      ...invoice,
      transactionId: remap(invoice.transactionId)
    })),
    expenses: state.expenses.map((expense) => ({
      ...expense,
      transactionId: remap(expense.transactionId)
    })),
    paymentAllocations: state.paymentAllocations.map((allocation) => ({
      ...allocation,
      transactionId: remap(allocation.transactionId)
    })),
    transactionTeamAssignments: state.transactionTeamAssignments?.map((assignment) => ({
      ...assignment,
      transactionId: remap(assignment.transactionId)!
    })),
    wiseStatementTransactions: state.wiseStatementTransactions?.map((transactionValue) => ({
      ...transactionValue,
      id: changes.get(transactionValue.id) ?? transactionValue.id
    })),
    profitDistributionCache: undefined,
    updatedAt
  });
}

async function applyProfitFactDeltas(
  ctx: MutationCtx,
  deltas: ReadonlyMap<string, ProfitFactDelta>
): Promise<void> {
  for (const [key, delta] of deltas) {
    if (
      delta.transactionCount === 0
      && normalizeFactAmount(delta.revenue) === 0
      && normalizeFactAmount(delta.generalCosts) === 0
      && [...delta.payments.values()].every((payment) => normalizeFactAmount(payment.amount) === 0)
    ) {
      continue;
    }
    const existing = await ctx.db
      .query("profitDistributionFacts")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (existing && existing.version !== profitDistributionContributionVersion) {
      throw new ConvexError({
        code: "PROFIT_FACT_VERSION_MISMATCH",
        key,
        storedVersion: existing.version,
        currentVersion: profitDistributionContributionVersion
      });
    }

    const transactionCount = (existing?.transactionCount ?? 0) + delta.transactionCount;
    if (transactionCount < 0 || (!existing && delta.transactionCount < 0)) {
      throw new ConvexError({ code: "PROFIT_FACT_INCONSISTENT", key });
    }

    const revenue = normalizeFactAmount((existing?.revenue ?? 0) + delta.revenue);
    const generalCosts = normalizeFactAmount((existing?.generalCosts ?? 0) + delta.generalCosts);
    const payments = new Map<string, ProfitDistributionPaymentFact>();
    for (const payment of existing?.payments ?? []) {
      payments.set(profitPaymentKey(payment), { ...payment });
    }
    for (const payment of delta.payments.values()) {
      const paymentKey = profitPaymentKey(payment);
      const current = payments.get(paymentKey);
      const amount = normalizeFactAmount((current?.amount ?? 0) + payment.amount);
      if (amount === 0) payments.delete(paymentKey);
      else payments.set(paymentKey, { ...payment, amount });
    }

    if (transactionCount === 0) {
      const paymentRemainder = [...payments.values()].reduce((total, payment) => total + Math.abs(payment.amount), 0);
      if (Math.abs(revenue) > 1e-7 || Math.abs(generalCosts) > 1e-7 || paymentRemainder > 1e-7) {
        throw new ConvexError({ code: "PROFIT_FACT_INCONSISTENT", key });
      }
      if (existing) await ctx.db.delete(existing._id);
      continue;
    }

    const updatedAt = new Date().toISOString();
    const next = {
      key,
      version: profitDistributionContributionVersion,
      month: delta.month,
      currency: delta.currency,
      transactionCount,
      revenue,
      generalCosts,
      payments: [...payments.values()].sort((left, right) =>
        profitPaymentKey(left).localeCompare(profitPaymentKey(right))
      ),
      updatedAt
    };
    if (existing) await ctx.db.patch(existing._id, next);
    else await ctx.db.insert("profitDistributionFacts", next);
  }
}

function analyticsMonthRevisionKey(month: string): string {
  return `month:${month}`;
}

function analyticsMonths(fromDate: string, toDate: string): string[] {
  const months: string[] = [];
  let cursor = new Date(`${fromDate.slice(0, 7)}-01T00:00:00.000Z`);
  const finalMonth = toDate.slice(0, 7);
  while (true) {
    const month = cursor.toISOString().slice(0, 7);
    months.push(month);
    if (month === finalMonth) return months;
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    if (months.length > 24) throw new ConvexError({ code: "ANALYTICS_PERIOD_TOO_LONG" });
  }
}

async function bumpLedgerRevision(ctx: MutationCtx, dates: Iterable<string>): Promise<void> {
  const existing = await ctx.db
    .query("bankLedgerRevision")
    .withIndex("by_key", (q) => q.eq("key", bankLedgerRevisionKey))
    .unique();
  const updatedAt = new Date().toISOString();
  const next = {
    key: bankLedgerRevisionKey,
    revision: (existing?.revision ?? 0) + 1,
    updatedAt
  };
  if (existing) await ctx.db.patch(existing._id, next);
  else await ctx.db.insert("bankLedgerRevision", next);

  const months = new Set<string>();
  for (const date of dates) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new ConvexError({ code: "INVALID_TRANSACTION_DATE" });
    }
    months.add(date.slice(0, 7));
  }
  for (const month of [...months].sort()) {
    const key = analyticsMonthRevisionKey(month);
    const stored = await ctx.db
      .query("bankLedgerRevision")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    const revision = {
      key,
      revision: (stored?.revision ?? 0) + 1,
      updatedAt
    };
    if (stored) await ctx.db.patch(stored._id, revision);
    else await ctx.db.insert("bankLedgerRevision", revision);
  }
}

function assertDateRange(fromDate: string, toDate: string): void {
  const today = new Date().toISOString().slice(0, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(fromDate)
    || !/^\d{4}-\d{2}-\d{2}$/.test(toDate)
    || fromDate > toDate
    || toDate > today
  ) {
    throw new ConvexError({ code: "INVALID_DATE_RANGE" });
  }
}

function isoDateShift(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function uncoveredRanges(
  coveredRanges: Array<{ fromDate: string; toDate: string }>,
  requested: { fromDate: string; toDate: string }
): Array<{ fromDate: string; toDate: string }> {
  let missing = [{ ...requested }];
  for (const covered of coveredRanges) {
    missing = missing.flatMap((range) => {
      if (covered.toDate < range.fromDate || covered.fromDate > range.toDate) return [range];
      const parts: Array<{ fromDate: string; toDate: string }> = [];
      if (covered.fromDate > range.fromDate) {
        parts.push({ fromDate: range.fromDate, toDate: isoDateShift(covered.fromDate, -1) });
      }
      if (covered.toDate < range.toDate) {
        parts.push({ fromDate: isoDateShift(covered.toDate, 1), toDate: range.toDate });
      }
      return parts;
    });
  }
  return missing;
}

function invoiceCandidateCursor(value: string | null | undefined, currency: string): InvoiceCandidateCursor | null {
  if (value === null || value === undefined) return null;
  if (value.length > 4096) throw new ConvexError({ code: "INVALID_CURSOR" });
  try {
    const parsed = JSON.parse(value) as Partial<InvoiceCandidateCursor>;
    if (
      parsed.version !== 1
      || parsed.currency !== currency
      || typeof parsed.date !== "string"
      || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.date)
      || typeof parsed.id !== "string"
      || !parsed.id
    ) {
      throw new Error("invalid cursor");
    }
    return {
      version: 1,
      currency,
      date: parsed.date,
      id: parsed.id
    };
  } catch {
    throw new ConvexError({ code: "INVALID_CURSOR" });
  }
}

function encodeInvoiceCandidateCursor(currency: string, date: string, id: string): string {
  return JSON.stringify({ version: 1, currency, date, id } satisfies InvoiceCandidateCursor);
}

export const getLedgerRevision = query({
  args: { serviceToken: v.string() },
  returns: v.object({
    revision: v.number(),
    updatedAt: v.union(v.string(), v.null())
  }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const revision = await ctx.db
      .query("bankLedgerRevision")
      .withIndex("by_key", (q) => q.eq("key", bankLedgerRevisionKey))
      .unique();
    return revision
      ? { revision: revision.revision, updatedAt: revision.updatedAt }
      : { revision: 0, updatedAt: null };
  }
});

export const getAnalyticsPeriodRevision = query({
  args: {
    serviceToken: v.string(),
    fromDate: v.string(),
    toDate: v.string()
  },
  returns: v.array(v.object({
    month: v.string(),
    revision: v.number()
  })),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    assertDateRange(args.fromDate, args.toDate);
    return Promise.all(analyticsMonths(args.fromDate, args.toDate).map(async (month) => {
      const stored = await ctx.db
        .query("bankLedgerRevision")
        .withIndex("by_key", (q) => q.eq("key", analyticsMonthRevisionKey(month)))
        .unique();
      return { month, revision: stored?.revision ?? 0 };
    }));
  }
});

export const getProfitFactsBackfillStatus = query({
  args: { serviceToken: v.string() },
  returns: v.object({
    version: v.number(),
    isComplete: v.boolean()
  }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const remaining = await ctx.db
      .query("bankTransactions")
      .withIndex("by_profit_contribution_version", (q) => q.eq("profitContributionVersion", undefined))
      .take(1);
    return {
      version: profitDistributionContributionVersion,
      isComplete: remaining.length === 0
    };
  }
});

export const getProfitFactsPage = query({
  args: {
    serviceToken: v.string(),
    paginationOpts: paginationOptsValidator
  },
  returns: paginationResultValidator(profitDistributionFact),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const requestedItems = Number.isFinite(args.paginationOpts.numItems)
      ? Math.trunc(args.paginationOpts.numItems)
      : maximumProfitFactPageSize;
    const paginationOpts = {
      numItems: Math.max(1, Math.min(maximumProfitFactPageSize, requestedItems)),
      cursor: args.paginationOpts.cursor,
      maximumRowsRead: maximumProfitFactPageSize,
      maximumBytesRead: maximumActivityBytesRead
    };
    const result = await ctx.db
      .query("profitDistributionFacts")
      .withIndex("by_month_currency")
      .order("asc")
      .paginate(paginationOpts);
    return {
      ...result,
      page: result.page.map(({
        _creationTime: _creationTime,
        _id: _id,
        key: _key,
        updatedAt: _updatedAt,
        ...fact
      }) => fact)
    };
  }
});

export const getActivityPage = query({
  args: {
    serviceToken: v.string(),
    source: v.optional(bankSource),
    direction: v.optional(v.union(v.literal("in"), v.literal("out"))),
    fromDate: v.string(),
    toDate: v.string(),
    order: v.union(v.literal("asc"), v.literal("desc")),
    paginationOpts: paginationOptsValidator
  },
  returns: paginationResultValidator(transaction),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    assertDateRange(args.fromDate, args.toDate);

    const requestedItems = Number.isFinite(args.paginationOpts.numItems)
      ? Math.trunc(args.paginationOpts.numItems)
      : maximumActivityPageSize;
    const requestedRowsRead = args.paginationOpts.maximumRowsRead;
    const requestedBytesRead = args.paginationOpts.maximumBytesRead;
    const paginationOpts = {
      numItems: Math.max(1, Math.min(maximumActivityPageSize, requestedItems)),
      cursor: args.paginationOpts.cursor,
      maximumRowsRead: Number.isFinite(requestedRowsRead)
        ? Math.max(1, Math.min(maximumActivityRowsRead, Math.trunc(requestedRowsRead!)))
        : maximumActivityRowsRead,
      maximumBytesRead: Number.isFinite(requestedBytesRead)
        ? Math.max(1, Math.min(maximumActivityBytesRead, Math.trunc(requestedBytesRead!)))
        : maximumActivityBytesRead
    };

    const source = args.source;
    const direction = args.direction;
    const bindings = await ctx.db.query("bankConnectionBindings").take(allBankSources.length + 1);
    if (bindings.length > allBankSources.length) {
      throw new ConvexError({ code: "BANK_CONNECTION_BINDING_LIMIT_EXCEEDED" });
    }
    const sourceConnectionKey = source === undefined
      ? undefined
      : bindings.find((binding) => binding.source === source)?.connectionKey
        ?? "__no_active_bank_connection__";
    const activityQuery = source === undefined && direction === undefined
      ? ctx.db
        .query("bankTransactions")
        .withIndex("by_date_id", (q) =>
          q.gte("date", args.fromDate).lte("date", args.toDate)
        )
        .order(args.order)
      : source === undefined
        ? ctx.db
          .query("bankTransactions")
          .withIndex("by_direction_date_id", (q) =>
            q.eq("direction", direction!).gte("date", args.fromDate).lte("date", args.toDate)
          )
          .order(args.order)
        : direction === undefined
          ? ctx.db
            .query("bankTransactions")
            .withIndex("by_source_connection_date_id", (q) =>
              q.eq("source", source)
                .eq("connectionKey", sourceConnectionKey)
                .gte("date", args.fromDate)
                .lte("date", args.toDate)
            )
            .order(args.order)
          : ctx.db
            .query("bankTransactions")
            .withIndex("by_source_connection_direction_date_id", (q) =>
              q.eq("source", source)
                .eq("connectionKey", sourceConnectionKey)
                .eq("direction", direction)
                .gte("date", args.fromDate)
                .lte("date", args.toDate)
            )
            .order(args.order);
    const result = await activityQuery
      .filter((q) => {
        const activeConnections = bindings.map((binding) => q.and(
          q.eq(q.field("source"), binding.source),
          q.eq(q.field("connectionKey"), binding.connectionKey)
        ));
        return q.and(
          q.eq(q.field("identityVersion"), 2),
          source !== undefined
            ? q.eq(q.field("connectionKey"), sourceConnectionKey)
            : activeConnections.length === 0
              ? q.eq(q.field("connectionKey"), "__no_active_bank_connection__")
              : q.or(...activeConnections)
        );
      })
      .paginate(paginationOpts);

    return {
      ...result,
      page: result.page.map(({
        _creationTime: _creationTime,
        _id: _id,
        syncedAt: _syncedAt,
        connectionKey: _connectionKey,
        profitContributionVersion: _profitContributionVersion,
        identityVersion: _identityVersion,
        ...item
      }) => item)
    };
  }
});

export const getActivityCoverage = query({
  args: {
    serviceToken: v.string(),
    connections: v.array(bankConnection),
    source: v.optional(bankSource),
    fromDate: v.string(),
    toDate: v.string()
  },
  returns: v.array(v.object({
    source: bankSource,
    missingRanges: v.array(v.object({ fromDate: v.string(), toDate: v.string() }))
  })),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    assertDateRange(args.fromDate, args.toDate);
    const connections = args.source
      ? args.connections.filter((connection) => connection.source === args.source)
      : args.connections;
    if (
      args.connections.length > allBankSources.length
      || new Set(args.connections.map((connection) => connection.source)).size !== args.connections.length
      || args.connections.some((connection) => !/^[0-9a-f]{64}$/.test(connection.connectionKey))
    ) {
      throw new ConvexError({ code: "INVALID_BANK_CONNECTION_DIRECTORY" });
    }
    return Promise.all(connections.map(async (connection) => {
      const state = await ctx.db
        .query("bankSyncState")
        .withIndex("by_source_connection", (q) =>
          q.eq("source", connection.source).eq("connectionKey", connection.connectionKey)
        )
        .unique();
      return {
        source: connection.source,
        missingRanges: uncoveredRanges(state?.coveredRanges ?? [], {
          fromDate: args.fromDate,
          toDate: args.toDate
        })
      };
    }));
  }
});

export const getAnalyticsCategoryCompaniesPage = query({
  args: {
    serviceToken: v.string(),
    fromDate: v.string(),
    toDate: v.string(),
    direction: v.union(v.literal("in"), v.literal("out")),
    currency: v.string(),
    category: v.string(),
    paginationOpts: paginationOptsValidator
  },
  returns: v.object({
    companies: v.array(v.object({
      companyKey: v.string(),
      providerId: v.optional(v.string()),
      merchantName: v.string(),
      amount: v.number(),
      transactionCount: v.number()
    })),
    continueCursor: v.string(),
    isDone: v.boolean()
  }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    assertDateRange(args.fromDate, args.toDate);
    const category = transactionBusinessCategory(args.category);
    const currency = args.currency.trim().toUpperCase();
    if (
      !args.category.trim()
      || category.length > 160
      || !/^[A-Z0-9]{2,12}$/.test(currency)
    ) {
      throw new ConvexError({ code: "INVALID_ANALYTICS_CATEGORY_SELECTION" });
    }
    const requestedItems = Math.trunc(args.paginationOpts.numItems);
    const paginationOpts = {
      cursor: args.paginationOpts.cursor,
      numItems: Math.max(1, Math.min(maximumActivityPageSize, requestedItems)),
      maximumRowsRead: maximumActivityRowsRead,
      maximumBytesRead: maximumActivityBytesRead
    };
    const bindings = await ctx.db.query("bankConnectionBindings").take(allBankSources.length + 1);
    if (bindings.length > allBankSources.length) {
      throw new ConvexError({ code: "BANK_CONNECTION_BINDING_LIMIT_EXCEEDED" });
    }
    const query = category === "Uncategorized"
      ? ctx.db
        .query("bankTransactions")
        .withIndex("by_direction_currency_date_id", (q) =>
          q.eq("direction", args.direction)
            .eq("currency", currency)
            .gte("date", args.fromDate)
            .lte("date", args.toDate)
        )
      : ctx.db
        .query("bankTransactions")
        .withIndex("by_category_direction_currency_date_id", (q) =>
          q.eq("category", category)
            .eq("direction", args.direction)
            .eq("currency", currency)
            .gte("date", args.fromDate)
            .lte("date", args.toDate)
        );
    const page = await query
      .filter((q) => {
        const activeConnections = bindings.map((binding) => q.and(
          q.eq(q.field("source"), binding.source),
          q.eq(q.field("connectionKey"), binding.connectionKey)
        ));
        return q.and(
          q.eq(q.field("identityVersion"), 2),
          activeConnections.length === 0
            ? q.eq(q.field("connectionKey"), "__no_active_bank_connection__")
            : q.or(...activeConnections)
        );
      })
      .paginate(paginationOpts);
    return {
      companies: aggregateAnalyticsCategoryCompanies(page.page, {
        fromDate: args.fromDate,
        toDate: args.toDate,
        direction: args.direction,
        currency,
        category
      }),
      continueCursor: page.continueCursor,
      isDone: page.isDone
    };
  }
});

export const getInvoicePaymentCandidates = query({
  args: {
    serviceToken: v.string(),
    currency: v.string(),
    limit: v.number(),
    cursor: v.union(v.string(), v.null())
  },
  returns: v.object({
    transactions: v.array(transaction),
    hasMore: v.boolean(),
    continueCursor: v.union(v.string(), v.null())
  }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const currency = args.currency.trim().toUpperCase();
    if (!currency) throw new ConvexError({ code: "INVALID_CURRENCY" });
    const requestedLimit = Number.isFinite(args.limit)
      ? Math.trunc(args.limit)
      : maximumActivityPageSize;
    const limit = Math.max(1, Math.min(maximumActivityPageSize, requestedLimit));
    const cursor = invoiceCandidateCursor(args.cursor, currency);
    const takeLimit = limit + 1;
    const statuses = ["posted", "settled"] as const;
    const bindings = await ctx.db.query("bankConnectionBindings").take(allBankSources.length + 1);
    if (bindings.length > allBankSources.length) {
      throw new ConvexError({ code: "BANK_CONNECTION_BINDING_LIMIT_EXCEEDED" });
    }
    const candidates = (
      await Promise.all(bindings.flatMap((binding) => statuses.flatMap((status) => {
        if (!cursor) {
          return [ctx.db
            .query("bankTransactions")
            .withIndex("by_source_connection_direction_currency_status_date_id", (q) =>
              q.eq("source", binding.source)
                .eq("connectionKey", binding.connectionKey)
                .eq("direction", "in")
                .eq("currency", currency)
                .eq("status", status)
            )
            .filter((q) => q.eq(q.field("identityVersion"), 2))
            .order("desc")
            .take(takeLimit)];
        }
        return [
          ctx.db
            .query("bankTransactions")
            .withIndex("by_source_connection_direction_currency_status_date_id", (q) =>
              q.eq("source", binding.source)
                .eq("connectionKey", binding.connectionKey)
                .eq("direction", "in")
                .eq("currency", currency)
                .eq("status", status)
                .eq("date", cursor.date)
                .lt("id", cursor.id)
            )
            .filter((q) => q.eq(q.field("identityVersion"), 2))
            .order("desc")
            .take(takeLimit),
          ctx.db
            .query("bankTransactions")
            .withIndex("by_source_connection_direction_currency_status_date_id", (q) =>
              q.eq("source", binding.source)
                .eq("connectionKey", binding.connectionKey)
                .eq("direction", "in")
                .eq("currency", currency)
                .eq("status", status)
                .lt("date", cursor.date)
            )
            .filter((q) => q.eq(q.field("identityVersion"), 2))
            .order("desc")
            .take(takeLimit)
        ];
      })))
    )
      .flat()
      .sort((left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id));
    const hasMore = candidates.length > limit;
    const page = candidates.slice(0, limit);
    const transactions = page.map(({
        _creationTime: _creationTime,
        _id: _id,
        syncedAt: _syncedAt,
        profitContributionVersion: _profitContributionVersion,
        identityVersion: _identityVersion,
        connectionKey: _connectionKey,
        ...item
      }) => item);
    const last = page.at(-1);
    return {
      transactions,
      hasMore,
      continueCursor: hasMore && last
        ? encodeInvoiceCandidateCursor(currency, last.date, last.id)
        : null
    };
  }
});

export const getActivityMetadata = query({
  args: {
    serviceToken: v.string(),
    connections: v.array(bankConnection)
  },
  returns: v.object({
    accounts: v.array(account),
    syncStates: v.array(syncState),
    syncHealth: v.array(syncHealth)
  }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const sources = [...new Set(args.connections.map((item) => item.source))];
    if (
      args.connections.length > allBankSources.length
      || sources.length !== args.connections.length
      || args.connections.some((item) => !/^[0-9a-f]{64}$/.test(item.connectionKey))
    ) {
      throw new ConvexError({ code: "INVALID_BANK_CONNECTION_DIRECTORY" });
    }
    const connectionKeyBySource = new Map(
      args.connections.map((item) => [item.source, item.connectionKey])
    );
    const activityBySource = await Promise.all(
      sources.map(async (source) => {
        const [accounts, state, health] = await Promise.all([
          ctx.db
            .query("bankAccounts")
            .withIndex("by_source_connection", (q) =>
              q.eq("source", source).eq("connectionKey", connectionKeyBySource.get(source)!)
            )
            .take(maximumBankAccountsPerSource),
          ctx.db
            .query("bankSyncState")
            .withIndex("by_source_connection", (q) =>
              q.eq("source", source).eq("connectionKey", connectionKeyBySource.get(source)!)
            )
            .unique()
          ,
          ctx.db
            .query("bankSyncHealth")
            .withIndex("by_source_connection", (q) =>
              q.eq("source", source).eq("connectionKey", connectionKeyBySource.get(source)!)
            )
            .unique()
        ]);
        return { accounts, state, health };
      })
    );

    return {
      accounts: activityBySource.flatMap(({ accounts }) => accounts.map(({
        _creationTime: _creationTime,
        _id: _id,
        syncedAt: _syncedAt,
        connectionKey: _connectionKey,
        ...item
      }) => item)),
      syncStates: activityBySource.flatMap(({ state }) => state
        ? [{
            source: state.source,
            coveredRanges: state.coveredRanges,
            lastSyncedAt: state.lastSyncedAt
          }]
        : [])
      ,
      syncHealth: activityBySource.flatMap(({ health }) => health
        ? [{
            source: health.source,
            status: health.status,
            lastAttemptAt: health.lastAttemptAt,
            ...(health.lastSuccessAt ? { lastSuccessAt: health.lastSuccessAt } : {}),
            ...(health.lastError ? { lastError: health.lastError } : {}),
            consecutiveFailures: health.consecutiveFailures
          }]
        : [])
    };
  }
});

export const getSyncState = query({
  args: { serviceToken: v.string(), source: bankSource, connectionKey: v.string() },
  returns: v.union(v.null(), syncState),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const state = await ctx.db
      .query("bankSyncState")
      .withIndex("by_source_connection", (q) =>
        q.eq("source", args.source).eq("connectionKey", args.connectionKey)
      )
      .unique();
    return state
      ? {
          source: state.source,
          coveredRanges: state.coveredRanges,
          lastSyncedAt: state.lastSyncedAt
        }
      : null;
  }
});

export const getSlashMetadataRepairRange = query({
  args: { serviceToken: v.string(), connectionKey: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      fromDate: v.string(),
      toDate: v.string()
    })
  ),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    if (!/^[0-9a-f]{64}$/.test(args.connectionKey)) {
      throw new ConvexError({ code: "INVALID_BANK_CONNECTION_KEY" });
    }
    await assertBankLedgerReady(ctx);
    await assertBankConnectionBinding(ctx, "slash", args.connectionKey);
    const unverifiedCardQuery = () => ctx.db
      .query("bankTransactions")
      .withIndex("by_source_connection_card_metadata_version_date_id", (q) =>
        q.eq("source", "slash")
          .eq("connectionKey", args.connectionKey)
          .eq("cardMetadataVersion", undefined)
      );
    const unverifiedVirtualAccountQuery = () => ctx.db
      .query("bankTransactions")
      .withIndex("by_source_connection_slash_virtual_version_date_id", (q) =>
        q.eq("source", "slash")
          .eq("connectionKey", args.connectionKey)
          .eq("slashVirtualAccountMetadataVersion", undefined)
      );
    const [firstCard, lastCard, firstVirtualAccount, lastVirtualAccount] = await Promise.all([
      unverifiedCardQuery().order("asc").first(),
      unverifiedCardQuery().order("desc").first(),
      unverifiedVirtualAccountQuery().order("asc").first(),
      unverifiedVirtualAccountQuery().order("desc").first()
    ]);
    const datedRows = [firstCard, lastCard, firstVirtualAccount, lastVirtualAccount]
      .filter((row): row is BankTransactionDoc => row !== null);
    if (datedRows.length === 0) return null;
    return {
      fromDate: datedRows.reduce((earliest, row) => row.date < earliest ? row.date : earliest, datedRows[0].date),
      toDate: datedRows.reduce((latest, row) => row.date > latest ? row.date : latest, datedRows[0].date)
    };
  }
});

export const getPendingReconciliationDates = mutation({
  args: { serviceToken: v.string(), connections: v.array(bankConnection) },
  returns: v.array(v.object({ source: bankSource, dates: v.array(v.string()) })),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const sources = [...new Set(args.connections.map((connection) => connection.source))];
    if (
      args.connections.length > allBankSources.length
      || sources.length !== args.connections.length
      || args.connections.some((connection) => !/^[0-9a-f]{64}$/.test(connection.connectionKey))
    ) {
      throw new ConvexError({ code: "INVALID_BANK_CONNECTION_DIRECTORY" });
    }
    return Promise.all(sources.map(async (source) => {
      const connectionKey = args.connections.find((connection) => connection.source === source)!.connectionKey;
      await assertBankConnectionBinding(ctx, source, connectionKey);
      const cursorKey = `${source}:${connectionKey}`;
      const storedCursor = await ctx.db
        .query("bankReconciliationCursors")
        .withIndex("by_key", (q) => q.eq("key", cursorKey))
        .unique();
      const page = await ctx.db
        .query("bankTransactions")
        .withIndex("by_source_connection_status_date_id", (q) =>
          q.eq("source", source).eq("connectionKey", connectionKey).eq("status", "pending")
        )
        .filter((q) => q.eq(q.field("identityVersion"), 2))
        .order("asc")
        .paginate({
          numItems: 200,
          cursor: storedCursor?.cursor ?? null,
          maximumRowsRead: maximumActivityRowsRead,
          maximumBytesRead: maximumActivityBytesRead
        });
      const updatedAt = new Date().toISOString();
      const nextCursor = page.isDone ? undefined : page.continueCursor;
      const next = {
        key: cursorKey,
        source,
        connectionKey,
        cursor: nextCursor,
        updatedAt
      };
      if (storedCursor) await ctx.db.patch(storedCursor._id, next);
      else await ctx.db.insert("bankReconciliationCursors", next);
      return { source, dates: [...new Set(page.page.map((row) => row.date))].slice(0, 20) };
    }));
  }
});

export const getTransaction = query({
  args: { serviceToken: v.string(), id: v.string() },
  returns: v.union(v.null(), transaction),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const item = await ctx.db
      .query("bankTransactions")
      .withIndex("by_transaction_id", (q) => q.eq("id", args.id))
      .unique();
    if (!item || item.identityVersion !== 2 || !item.connectionKey) return null;
    const binding = await ctx.db
      .query("bankConnectionBindings")
      .withIndex("by_source_connection", (q) =>
        q.eq("source", item.source).eq("connectionKey", item.connectionKey!)
      )
      .unique();
    if (!binding) return null;
    const {
      _creationTime: _creationTime,
      _id: _id,
      syncedAt: _syncedAt,
      connectionKey: _connectionKey,
      profitContributionVersion: _profitContributionVersion,
      identityVersion: _identityVersion,
      ...result
    } = item;
    return result;
  }
});

async function applyActivityBatch(
  ctx: MutationCtx,
  args: ActivityBatchArgs
): Promise<{
  accounts: number;
  transactions: number;
  insertedTransactions: number;
  updatedTransactions: number;
}> {
  if (!/^[0-9a-f]{64}$/.test(args.connectionKey)) {
    throw new ConvexError({ code: "INVALID_BANK_CONNECTION_KEY" });
  }
  await ensureBankConnectionBinding(ctx, args.source, args.connectionKey);
  if (
    args.accounts.length > maximumBankAccountsPerSource
    || args.transactions.length > maximumMaintenanceBatchSize
  ) {
    throw new ConvexError({ code: "BATCH_TOO_LARGE" });
  }
  if (
    args.accounts.some((item) => item.source !== args.source)
    || args.transactions.some((item) => item.source !== args.source)
  ) {
    throw new ConvexError({ code: "SOURCE_MISMATCH" });
  }
  if (new Set(args.transactions.map((item) => item.id)).size !== args.transactions.length) {
    throw new ConvexError({ code: "DUPLICATE_TRANSACTION_ID" });
  }
  try {
    assertBankActivityBatchBudget(args.accounts, args.transactions);
  } catch (error) {
    throw new ConvexError({
      code: "INVALID_BANK_ACTIVITY_BATCH",
      message: error instanceof Error ? error.message : String(error)
    });
  }

  if (args.replaceAccounts) {
    const freshAccountIds = new Set(args.accounts.map((item) => item.id));
    const storedAccounts = await ctx.db
      .query("bankAccounts")
      .withIndex("by_source_connection", (q) =>
        q.eq("source", args.source).eq("connectionKey", args.connectionKey)
      )
      .take(maximumBankAccountsPerSource + 1);
    if (storedAccounts.length > maximumBankAccountsPerSource) {
      throw new ConvexError({ code: "ACCOUNT_LIMIT_EXCEEDED" });
    }
    for (const stored of storedAccounts) {
      if (!freshAccountIds.has(stored.id)) await ctx.db.delete(stored._id);
    }
  }

  for (const fresh of args.accounts) {
    const existing = await ctx.db
      .query("bankAccounts")
      .withIndex("by_account_id", (q) => q.eq("id", fresh.id))
      .unique();
    if (existing && existing.connectionKey !== args.connectionKey) {
      throw new ConvexError({ code: "BANK_ACCOUNT_CONNECTION_CONFLICT", accountId: fresh.id });
    }
    if (existing) {
      await ctx.db.patch(existing._id, { ...fresh, connectionKey: args.connectionKey, syncedAt: args.syncedAt });
    } else {
      await ctx.db.insert("bankAccounts", { ...fresh, connectionKey: args.connectionKey, syncedAt: args.syncedAt });
    }
  }

  let insertedTransactions = 0;
  let updatedTransactions = 0;
  const analyticsChangedDates = new Set<string>();
  const identityChanges = new Map<string, string>();
  const factDeltas = new Map<string, ProfitFactDelta>();
  for (const ingest of args.transactions) {
    const { providerLegacyId, ...fresh } = ingest;
    assertCurrentTransactionIdentity(args.source, fresh.id);
    let existing = await ctx.db
      .query("bankTransactions")
      .withIndex("by_transaction_id", (q) => q.eq("id", fresh.id))
      .unique();
    if (existing && existing.connectionKey !== args.connectionKey) {
      throw new ConvexError({
        code: "TRANSACTION_CONNECTION_CONFLICT",
        transactionId: fresh.id,
        storedConnectionKey: existing.connectionKey ?? null
      });
    }
    let storedAlias = null;
    let legacyExisting: BankTransactionDoc | null = null;
    if (providerLegacyId) {
      const aliasKey = transactionAliasKey(args.source, args.connectionKey, providerLegacyId);
      storedAlias = await ctx.db
        .query("bankTransactionAliases")
        .withIndex("by_key", (q) => q.eq("key", aliasKey))
        .unique();
    }
    if (storedAlias && providerLegacyId) {
      const expectedSurrogateId = bankProviderTransactionId(args.source, ["legacy", providerLegacyId]);
      if (storedAlias.transactionId === expectedSurrogateId) {
        legacyExisting = await ctx.db
          .query("bankTransactions")
          .withIndex("by_transaction_id", (q) => q.eq("id", expectedSurrogateId))
          .unique();
        if (!legacyExisting) {
          throw new ConvexError({
            code: "ORPHANED_TRANSACTION_ALIAS",
            source: args.source,
            alias: providerLegacyId
          });
        }
        if (!existing) existing = legacyExisting;
      } else if (!existing) {
        throw new ConvexError({
          code: "AMBIGUOUS_TRANSACTION_ALIAS",
          source: args.source,
          alias: providerLegacyId,
          storedTransactionId: storedAlias.transactionId,
          incomingTransactionId: fresh.id
        });
      }
    }

    if (existing && existing.connectionKey !== args.connectionKey) {
      throw new ConvexError({
        code: "TRANSACTION_CONNECTION_CONFLICT",
        transactionId: existing.id,
        storedConnectionKey: existing.connectionKey ?? null
      });
    }
    if (legacyExisting && legacyExisting.connectionKey !== args.connectionKey) {
      throw new ConvexError({
        code: "TRANSACTION_CONNECTION_CONFLICT",
        transactionId: legacyExisting.id,
        storedConnectionKey: legacyExisting.connectionKey ?? null
      });
    }

    if (existing) {
      if (existing.source !== fresh.source) {
        throw new ConvexError({
          code: "TRANSACTION_ID_SOURCE_CONFLICT",
          transactionId: fresh.id,
          storedSource: existing.source,
          incomingSource: fresh.source
        });
      }
      if (existing.id !== fresh.id) identityChanges.set(existing.id, fresh.id);
      const coalescedLegacy = legacyExisting && legacyExisting._id !== existing._id
        ? legacyExisting
        : null;
      if (
        coalescedLegacy?.teamId
        && existing.teamId
        && coalescedLegacy.teamId !== existing.teamId
      ) {
        throw new ConvexError({
          code: "TRANSACTION_MANUAL_DATA_CONFLICT",
          transactionId: fresh.id,
          field: "teamId"
        });
      }
      if (
        coalescedLegacy?.matchedInvoiceId
        && existing.matchedInvoiceId
        && coalescedLegacy.matchedInvoiceId !== existing.matchedInvoiceId
      ) {
        throw new ConvexError({
          code: "TRANSACTION_MANUAL_DATA_CONFLICT",
          transactionId: fresh.id,
          field: "matchedInvoiceId"
        });
      }
      const categoryOwner = coalescedLegacy?.categorySource === "manual"
        ? coalescedLegacy
        : existing.categorySource === "manual"
          ? existing
          : coalescedLegacy ?? existing;
      const update = {
        ...fresh,
        category: categoryOwner.category,
        merchantName: coalescedLegacy?.merchantName ?? existing.merchantName ?? fresh.merchantName,
        merchantKey: coalescedLegacy?.merchantKey ?? existing.merchantKey ?? fresh.merchantKey,
        classificationComplete: fresh.status === "voided"
          ? true
          : coalescedLegacy?.classificationComplete
            ?? existing.classificationComplete
            ?? fresh.classificationComplete,
        categorySource: categoryOwner.categorySource ?? fresh.categorySource,
        categoryConfidence: categoryOwner.categoryConfidence ?? fresh.categoryConfidence,
        categoryReason: categoryOwner.categoryReason ?? fresh.categoryReason,
        matchedProviderId: coalescedLegacy?.matchedProviderId ?? existing.matchedProviderId ?? fresh.matchedProviderId,
        companyMatchSource: coalescedLegacy?.companyMatchSource ?? existing.companyMatchSource ?? fresh.companyMatchSource,
        companyConfidence: coalescedLegacy?.companyConfidence ?? existing.companyConfidence ?? fresh.companyConfidence,
        companyMatchReason: coalescedLegacy?.companyMatchReason ?? existing.companyMatchReason ?? fresh.companyMatchReason,
        matchedInvoiceId: coalescedLegacy?.matchedInvoiceId ?? existing.matchedInvoiceId ?? fresh.matchedInvoiceId,
        teamId: coalescedLegacy?.teamId ?? existing.teamId ?? fresh.teamId,
        confidence: coalescedLegacy?.confidence ?? existing.confidence ?? fresh.confidence,
        matchReason: coalescedLegacy?.matchReason ?? existing.matchReason ?? fresh.matchReason,
        connectionKey: args.connectionKey,
        syncedAt: args.syncedAt,
        identityVersion: 2
      };
      const next = { ...existing, ...update };
      addVersionedProfitFactChange(factDeltas, existing, next);
      if (coalescedLegacy) {
        addVersionedProfitFactDeletion(factDeltas, coalescedLegacy);
        identityChanges.set(coalescedLegacy.id, fresh.id);
      }
      if (transactionVisibleChanged(existing, next)) {
        analyticsChangedDates.add(existing.date);
        analyticsChangedDates.add(next.date);
      }
      if (coalescedLegacy) analyticsChangedDates.add(coalescedLegacy.date);
      await ctx.db.patch(existing._id, update);
      const aliasSourceIds = new Set<string>();
      if (existing.id !== fresh.id) aliasSourceIds.add(existing.id);
      if (coalescedLegacy) aliasSourceIds.add(coalescedLegacy.id);
      for (const aliasSourceId of aliasSourceIds) {
        const aliases = await ctx.db
          .query("bankTransactionAliases")
          .withIndex("by_transaction_id", (q) => q.eq("transactionId", aliasSourceId))
          .take(101);
        if (aliases.length > 100) {
          throw new ConvexError({ code: "TRANSACTION_ALIAS_LIMIT_EXCEEDED", transactionId: aliasSourceId });
        }
        for (const alias of aliases) {
          await ctx.db.patch(alias._id, { transactionId: fresh.id, updatedAt: args.syncedAt });
        }
      }
      if (coalescedLegacy) await ctx.db.delete(coalescedLegacy._id);
      updatedTransactions += 1;
    } else {
      const insert = fresh.status === "voided"
        ? { ...fresh, classificationComplete: true }
        : fresh;
      addProfitFactContribution(factDeltas, profitDistributionContribution(insert), 1);
      await ctx.db.insert("bankTransactions", {
        ...insert,
        connectionKey: args.connectionKey,
        syncedAt: args.syncedAt,
        profitContributionVersion: profitDistributionContributionVersion,
        identityVersion: 2
      });
      analyticsChangedDates.add(insert.date);
      insertedTransactions += 1;
    }
  }
  await applyProfitFactDeltas(ctx, factDeltas);
  await remapDashboardTransactionReferences(ctx, identityChanges);
  if (analyticsChangedDates.size > 0) await bumpLedgerRevision(ctx, analyticsChangedDates);
  return {
    accounts: args.accounts.length,
    transactions: args.transactions.length,
    insertedTransactions,
    updatedTransactions
  };
}

export const upsertActivityBatch = mutation({
  args: {
    serviceToken: v.string(),
    source: bankSource,
    connectionKey: v.string(),
    replaceAccounts: v.boolean(),
    accounts: v.array(account),
    transactions: v.array(ingestTransaction),
    syncedAt: v.string()
  },
  returns: activityBatchResult,
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    await assertBankLedgerReady(ctx);
    return applyActivityBatch(ctx, args);
  }
});

export const upsertSyncedActivityBatch = mutation({
  args: {
    serviceToken: v.string(),
    source: bankSource,
    replaceAccounts: v.boolean(),
    accounts: v.array(account),
    transactions: v.array(ingestTransaction),
    syncedAt: v.string(),
    connectionKey: v.string(),
    leaseToken: v.string(),
    leaseFence: v.number()
  },
  returns: activityBatchResult,
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    await assertBankLedgerReady(ctx);
    await assertActiveBankSyncLease(ctx, args.source, args);
    return applyActivityBatch(ctx, args);
  }
});

export const saveTransactionUpdates = mutation({
  args: {
    serviceToken: v.string(),
    transactions: v.array(transactionEnrichmentUpdate)
  },
  returns: v.object({ updated: v.number() }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    if (args.transactions.length > maximumMaintenanceBatchSize) {
      throw new ConvexError({ code: "BATCH_TOO_LARGE" });
    }
    if (new Set(args.transactions.map((item) => item.id)).size !== args.transactions.length) {
      throw new ConvexError({ code: "DUPLICATE_TRANSACTION_ID" });
    }
    let updated = 0;
    const analyticsChangedDates = new Set<string>();
    const factDeltas = new Map<string, ProfitFactDelta>();
    for (const item of args.transactions) {
      const existing = await ctx.db
        .query("bankTransactions")
        .withIndex("by_transaction_id", (q) => q.eq("id", item.id))
        .unique();
      if (!existing) continue;
      const update = {
        category: item.category,
        merchantName: item.merchantName,
        merchantKey: item.merchantKey,
        classificationComplete: existing.status === "voided" ? true : item.classificationComplete,
        categorySource: item.categorySource,
        categoryConfidence: item.categoryConfidence,
        categoryReason: item.categoryReason,
        matchedProviderId: item.matchedProviderId,
        companyMatchSource: item.companyMatchSource,
        companyConfidence: item.companyConfidence,
        companyMatchReason: item.companyMatchReason,
        invoiceMatchSource: item.invoiceMatchSource,
        invoiceMatchConfidence: item.invoiceMatchConfidence,
        invoiceMatchReason: item.invoiceMatchReason,
        confidence: item.confidence,
        matchReason: item.matchReason
      };
      const next = { ...existing, ...update };
      addVersionedProfitFactChange(factDeltas, existing, next);
      if (transactionVisibleChanged(existing, next)) analyticsChangedDates.add(existing.date);
      await ctx.db.patch(existing._id, update);
      updated += 1;
    }
    await applyProfitFactDeltas(ctx, factDeltas);
    if (analyticsChangedDates.size > 0) await bumpLedgerRevision(ctx, analyticsChangedDates);
    return { updated };
  }
});

export const applyTeamAssignmentsBatch = mutation({
  args: {
    serviceToken: v.string(),
    assignments: v.array(v.object({
      transactionId: v.string(),
      teamId: v.union(v.string(), v.null())
    }))
  },
  returns: v.object({ updated: v.number() }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    if (args.assignments.length > maximumMaintenanceBatchSize) {
      throw new ConvexError({ code: "BATCH_TOO_LARGE" });
    }
    if (new Set(args.assignments.map((item) => item.transactionId)).size !== args.assignments.length) {
      throw new ConvexError({ code: "DUPLICATE_TRANSACTION_ID" });
    }
    let updated = 0;
    const analyticsChangedDates = new Set<string>();
    for (const assignment of args.assignments) {
      const existing = await ctx.db
        .query("bankTransactions")
        .withIndex("by_transaction_id", (q) => q.eq("id", assignment.transactionId))
        .unique();
      if (!existing) continue;
      const teamId = assignment.teamId ?? undefined;
      if (existing.teamId !== teamId) analyticsChangedDates.add(existing.date);
      await ctx.db.patch(existing._id, { teamId });
      updated += 1;
    }
    if (analyticsChangedDates.size > 0) await bumpLedgerRevision(ctx, analyticsChangedDates);
    return { updated };
  }
});

export const applyMatchedInvoiceAssignmentsBatch = mutation({
  args: {
    serviceToken: v.string(),
    assignments: v.array(v.object({
      transactionId: v.string(),
      matchedInvoiceId: v.union(v.string(), v.null()),
      invoiceMatchSource: v.optional(invoiceMatchSource),
      invoiceMatchConfidence: v.optional(v.number()),
      invoiceMatchReason: v.optional(v.string())
    }))
  },
  returns: v.object({ updated: v.number() }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    if (args.assignments.length > maximumMaintenanceBatchSize) {
      throw new ConvexError({ code: "BATCH_TOO_LARGE" });
    }
    if (new Set(args.assignments.map((item) => item.transactionId)).size !== args.assignments.length) {
      throw new ConvexError({ code: "DUPLICATE_TRANSACTION_ID" });
    }
    let updated = 0;
    const analyticsChangedDates = new Set<string>();
    for (const assignment of args.assignments) {
      const existing = await ctx.db
        .query("bankTransactions")
        .withIndex("by_transaction_id", (q) => q.eq("id", assignment.transactionId))
        .unique();
      if (!existing) continue;
      const matchedInvoiceId = assignment.matchedInvoiceId ?? undefined;
      if (existing.matchedInvoiceId !== matchedInvoiceId) analyticsChangedDates.add(existing.date);
      await ctx.db.patch(existing._id, {
        matchedInvoiceId,
        invoiceMatchSource: assignment.invoiceMatchSource,
        invoiceMatchConfidence: assignment.invoiceMatchConfidence,
        invoiceMatchReason: assignment.invoiceMatchReason
      });
      updated += 1;
    }
    if (analyticsChangedDates.size > 0) await bumpLedgerRevision(ctx, analyticsChangedDates);
    return { updated };
  }
});

export const backfillProfitFactsBatch = mutation({
  args: {
    serviceToken: v.string(),
    limit: v.optional(v.number())
  },
  returns: v.object({
    processed: v.number(),
    hasMore: v.boolean(),
    version: v.number()
  }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const requestedLimit = args.limit === undefined || !Number.isFinite(args.limit)
      ? maximumMaintenanceBatchSize
      : Math.trunc(args.limit);
    const limit = Math.max(1, Math.min(maximumMaintenanceBatchSize, requestedLimit));
    const rows = await ctx.db
      .query("bankTransactions")
      .withIndex("by_profit_contribution_version", (q) => q.eq("profitContributionVersion", undefined))
      .take(limit + 1);
    const page = rows.slice(0, limit);
    const factDeltas = new Map<string, ProfitFactDelta>();
    for (const row of page) {
      if (row.identityVersion === 2) {
        addProfitFactContribution(factDeltas, profitDistributionContribution(row), 1);
      }
    }
    await applyProfitFactDeltas(ctx, factDeltas);
    for (const row of page) {
      await ctx.db.patch(row._id, {
        profitContributionVersion: profitDistributionContributionVersion
      });
    }
    return {
      processed: page.length,
      hasMore: rows.length > limit,
      version: profitDistributionContributionVersion
    };
  }
});

export const getBankLedgerCutoverStatus = query({
  args: { serviceToken: v.string() },
  returns: v.object({
    legacyFieldsPresent: v.boolean(),
    legacyTransactions: v.number(),
    legacyTeamAssignments: v.number(),
    unversionedTransactions: v.number(),
    unversionedIdentities: v.number(),
    unscopedTransactionAccounts: v.number(),
    unresolvedLegacyIdentitySources: v.array(bankSource),
    completedIdentityMigrations: v.number(),
    prerequisitesReady: v.boolean(),
    ready: v.boolean()
  }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const [
      state,
      unversioned,
      unversionedIdentity,
      unscopedTransactionAccounts,
      unboundTransactions,
      unboundAccounts,
      sourceStates,
      cutover
    ] = await Promise.all([
      ctx.db
        .query("dashboardState")
        .withIndex("by_key", (q) => q.eq("key", "default"))
        .unique(),
      ctx.db
        .query("bankTransactions")
        .withIndex("by_profit_contribution_version", (q) =>
          q.eq("profitContributionVersion", undefined)
        )
        .take(1),
      ctx.db
        .query("bankTransactions")
        .withIndex("by_identity_version", (q) => q.eq("identityVersion", undefined))
        .take(1),
      ctx.db
        .query("bankTransactions")
        .withIndex("by_transaction_account_id", (q) => q.eq("accountId", undefined))
        .take(1),
      ctx.db
        .query("bankTransactions")
        .withIndex("by_connection_key", (q) => q.eq("connectionKey", undefined))
        .take(1),
      ctx.db
        .query("bankAccounts")
        .withIndex("by_connection_key", (q) => q.eq("connectionKey", undefined))
        .take(1),
      Promise.all(allBankSources.map(async (source) => {
        const [migration, binding, transaction, account, unresolvedLegacyIdentity] = await Promise.all([
          ctx.db
            .query("bankIdentityMigrations")
            .withIndex("by_source", (q) => q.eq("source", source))
            .unique(),
          ctx.db
            .query("bankConnectionBindings")
            .withIndex("by_source", (q) => q.eq("source", source))
            .unique(),
          ctx.db
            .query("bankTransactions")
            .withIndex("by_source", (q) => q.eq("source", source))
            .first(),
          ctx.db
            .query("bankAccounts")
            .withIndex("by_source", (q) => q.eq("source", source))
            .first(),
          ctx.db
            .query("bankTransactions")
            .withIndex("by_source_identity_version", (q) =>
              q.eq("source", source).eq("identityVersion", 1)
            )
            .first()
        ]);
        if (!binding) {
          return {
            source,
            migration,
            binding,
            transaction,
            account,
            unresolvedLegacyIdentity,
            hasConnectionMismatch: false
          };
        }
        const [transactionsBefore, transactionsAfter, accountsBefore, accountsAfter] = await Promise.all([
          ctx.db
            .query("bankTransactions")
            .withIndex("by_source_connection", (q) =>
              q.eq("source", source).lt("connectionKey", binding.connectionKey)
            )
            .take(1),
          ctx.db
            .query("bankTransactions")
            .withIndex("by_source_connection", (q) =>
              q.eq("source", source).gt("connectionKey", binding.connectionKey)
            )
            .take(1),
          ctx.db
            .query("bankAccounts")
            .withIndex("by_source_connection", (q) =>
              q.eq("source", source).lt("connectionKey", binding.connectionKey)
            )
            .take(1),
          ctx.db
            .query("bankAccounts")
            .withIndex("by_source_connection", (q) =>
              q.eq("source", source).gt("connectionKey", binding.connectionKey)
            )
            .take(1)
        ]);
        return {
          source,
          migration,
          binding,
          transaction,
          account,
          unresolvedLegacyIdentity,
          hasConnectionMismatch: [
            ...transactionsBefore,
            ...transactionsAfter,
            ...accountsBefore,
            ...accountsAfter
          ].length > 0
        };
      })),
      ctx.db
        .query("bankLedgerCutover")
        .withIndex("by_key", (q) => q.eq("key", bankLedgerRevisionKey))
        .unique()
    ]);
    const legacyFieldsPresent = Boolean(
      state
      && (
        state.wiseStatementTransactions !== undefined
        || state.transactionTeamAssignments !== undefined
      )
    );
    const legacyTransactions = state?.wiseStatementTransactions?.length ?? 0;
    const legacyTeamAssignments = state?.transactionTeamAssignments?.length ?? 0;
    const unversionedTransactions = unversioned.length;
    const unversionedIdentities = unversionedIdentity.length;
    const unscopedTransactionAccountCount = unscopedTransactionAccounts.length;
    const completedIdentityMigrations = sourceStates.filter(
      ({ migration }) => migration?.version === 2
    ).length;
    const unresolvedLegacyIdentitySources = sourceStates
      .filter(({ unresolvedLegacyIdentity }) => Boolean(unresolvedLegacyIdentity))
      .map(({ source }) => source);
    const relevantSourcesReady = sourceStates.every(({
      migration,
      binding,
      transaction,
      account,
      hasConnectionMismatch
    }) => {
      const hasStoredData = Boolean(transaction || account);
      if (!hasStoredData && !binding) return true;
      return Boolean(binding && migration?.version === 2 && !hasConnectionMismatch);
    });
    const prerequisitesReady =
      !legacyFieldsPresent
      && unversionedTransactions === 0
      && unversionedIdentities === 0
      && unscopedTransactionAccountCount === 0
      && unresolvedLegacyIdentitySources.length === 0
      && unboundTransactions.length === 0
      && unboundAccounts.length === 0
      && relevantSourcesReady;
    return {
      legacyFieldsPresent,
      legacyTransactions,
      legacyTeamAssignments,
      unversionedTransactions,
      unversionedIdentities,
      unscopedTransactionAccounts: unscopedTransactionAccountCount,
      unresolvedLegacyIdentitySources,
      completedIdentityMigrations,
      prerequisitesReady,
      ready: cutover?.status === "ready" && prerequisitesReady
    };
  }
});

export const markLegacyBankIdentityBatch = mutation({
  args: {
    serviceToken: v.string(),
    source: bankSource,
    connectionKey: v.string(),
    cursor: v.union(v.string(), v.null()),
    limit: v.optional(v.number())
  },
  returns: v.object({
    processed: v.number(),
    marked: v.number(),
    rekeyed: v.number(),
    isDone: v.boolean(),
    continueCursor: v.union(v.string(), v.null())
  }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    if (!/^[0-9a-f]{64}$/.test(args.connectionKey)) {
      throw new ConvexError({ code: "INVALID_BANK_CONNECTION_KEY" });
    }
    const limit = Math.max(
      1,
      Math.min(maximumMaintenanceBatchSize, Math.trunc(args.limit ?? maximumMaintenanceBatchSize))
    );
    const sourceAccounts = await ctx.db
      .query("bankAccounts")
      .withIndex("by_source", (q) => q.eq("source", args.source))
      .take(maximumBankAccountsPerSource + 1);
    if (sourceAccounts.length > maximumBankAccountsPerSource) {
      throw new ConvexError({ code: "ACCOUNT_LIMIT_EXCEEDED" });
    }
    const result = await ctx.db
      .query("bankTransactions")
      .withIndex("by_source", (q) => q.eq("source", args.source))
      .paginate({
        numItems: limit,
        cursor: args.cursor,
        maximumRowsRead: limit,
        maximumBytesRead: maximumActivityBytesRead
      });
    let marked = 0;
    let rekeyed = 0;
    const identityChanges = new Map<string, string>();
    const factDeltas = new Map<string, ProfitFactDelta>();
    for (const row of result.page) {
      const currentNamespace = isCurrentBankTransactionId(args.source, row.id);
      const migrationSurrogate = isLegacySurrogateBankTransactionId(args.source, row.id);
      const matchingAccounts = sourceAccounts.filter((accountRow) =>
        accountRow.name === row.accountName
        && accountRow.currency === row.currency
        && accountRow.slashAccountSubtype === row.slashAccountSubtype
      );
      const accountId = row.accountId
        ?? (matchingAccounts.length === 1
          ? matchingAccounts[0].id
          : bankProviderTransactionId(args.source, ["legacy-account", row.id]));
      if (row.connectionKey && row.connectionKey !== args.connectionKey) {
        throw new ConvexError({
          code: "MIGRATION_CONNECTION_CONFLICT",
          source: args.source,
          transactionId: row.id
        });
      }
      if (
        currentNamespace
        && migrationSurrogate
        && row.identityVersion === 1
      ) {
        if (row.connectionKey !== args.connectionKey || row.accountId !== accountId) {
          await ctx.db.patch(row._id, { connectionKey: args.connectionKey, accountId });
          marked += 1;
        }
        continue;
      }
      if (
        row.identityVersion === 2
        && currentNamespace
        && row.connectionKey === args.connectionKey
        && row.accountId === accountId
      ) continue;
      if (currentNamespace) {
        await ctx.db.patch(row._id, {
          identityVersion: 2,
          connectionKey: args.connectionKey,
          accountId
        });
        marked += 1;
        continue;
      }
      const targetId = bankProviderTransactionId(args.source, ["legacy", row.id]);
      const target = await ctx.db
        .query("bankTransactions")
        .withIndex("by_transaction_id", (q) => q.eq("id", targetId))
        .unique();
      if (target && target._id !== row._id) {
        throw new ConvexError({
          code: "LEGACY_IDENTITY_TARGET_CONFLICT",
          source: args.source,
          transactionId: row.id,
          targetId
        });
      }
      const key = transactionAliasKey(args.source, args.connectionKey, row.id);
      const alias = await ctx.db
        .query("bankTransactionAliases")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique();
      if (alias && alias.transactionId !== targetId) {
        throw new ConvexError({
          code: "TRANSACTION_ALIAS_CONFLICT",
          source: args.source,
          alias: row.id
        });
      }
      if (row.identityVersion === 2) addVersionedProfitFactDeletion(factDeltas, row);
      await ctx.db.patch(row._id, {
        id: targetId,
        identityVersion: 1,
        connectionKey: args.connectionKey,
        accountId
      });
      if (!alias) {
        await ctx.db.insert("bankTransactionAliases", {
          key,
          source: args.source,
          connectionKey: args.connectionKey,
          alias: row.id,
          transactionId: targetId,
          updatedAt: new Date().toISOString()
        });
      }
      identityChanges.set(row.id, targetId);
      marked += 1;
      rekeyed += 1;
    }
    await applyProfitFactDeltas(ctx, factDeltas);
    await remapDashboardTransactionReferences(ctx, identityChanges);
    if (identityChanges.size > 0) {
      await bumpLedgerRevision(ctx, result.page.map((row) => row.date));
    }
    if (result.isDone) {
      for (const accountRow of sourceAccounts) {
        if (accountRow.connectionKey && accountRow.connectionKey !== args.connectionKey) {
          throw new ConvexError({
            code: "MIGRATION_CONNECTION_CONFLICT",
            source: args.source,
            accountId: accountRow.id
          });
        }
        await ctx.db.patch(accountRow._id, { connectionKey: args.connectionKey });
      }
      const binding = await ctx.db
        .query("bankConnectionBindings")
        .withIndex("by_source", (q) => q.eq("source", args.source))
        .unique();
      if (binding && binding.connectionKey !== args.connectionKey) {
        throw new ConvexError({ code: "MIGRATION_CONNECTION_CONFLICT", source: args.source });
      }
      if (!binding) {
        await ctx.db.insert("bankConnectionBindings", {
          source: args.source,
          connectionKey: args.connectionKey,
          boundAt: new Date().toISOString()
        });
      }
      const completedAt = new Date().toISOString();
      const existingMigration = await ctx.db
        .query("bankIdentityMigrations")
        .withIndex("by_source", (q) => q.eq("source", args.source))
        .unique();
      if (existingMigration) {
        await ctx.db.patch(existingMigration._id, { version: 2, completedAt });
      } else {
        await ctx.db.insert("bankIdentityMigrations", {
          source: args.source,
          version: 2,
          completedAt
        });
      }
    }
    return {
      processed: result.page.length,
      marked,
      rekeyed,
      isDone: result.isDone,
      continueCursor: result.isDone ? null : result.continueCursor
    };
  }
});

/**
 * Explicit operator disposition for historical rows whose original provider
 * ID cannot be recovered. Their injective migration surrogate becomes the
 * permanent ledger identity; the retained alias still permits later exact-ID
 * coalescing when a connector can prove the old identifier.
 */
export const acceptLegacyBankIdentityBatch = mutation({
  args: {
    serviceToken: v.string(),
    source: bankSource,
    connectionKey: v.string(),
    disposition: v.literal("accept-surrogate-identities"),
    limit: v.optional(v.number())
  },
  returns: v.object({
    accepted: v.number(),
    hasMore: v.boolean(),
    earliestDate: v.union(v.string(), v.null()),
    latestDate: v.union(v.string(), v.null())
  }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    if (!/^[0-9a-f]{64}$/.test(args.connectionKey)) {
      throw new ConvexError({ code: "INVALID_BANK_CONNECTION_KEY" });
    }
    await assertBankConnectionBinding(ctx, args.source, args.connectionKey);
    const requestedLimit = args.limit === undefined || !Number.isFinite(args.limit)
      ? maximumMaintenanceBatchSize
      : Math.trunc(args.limit);
    const limit = Math.max(1, Math.min(maximumMaintenanceBatchSize, requestedLimit));
    const rows = await ctx.db
      .query("bankTransactions")
      .withIndex("by_source_connection_identity_version", (q) =>
        q.eq("source", args.source)
          .eq("connectionKey", args.connectionKey)
          .eq("identityVersion", 1)
      )
      .take(limit + 1);
    const page = rows.slice(0, limit);
    const factDeltas = new Map<string, ProfitFactDelta>();
    for (const row of page) {
      if (!isLegacySurrogateBankTransactionId(args.source, row.id)) {
        throw new ConvexError({
          code: "INVALID_LEGACY_IDENTITY_DISPOSITION",
          source: args.source,
          transactionId: row.id
        });
      }
      const aliases = await ctx.db
        .query("bankTransactionAliases")
        .withIndex("by_transaction_id", (q) => q.eq("transactionId", row.id))
        .take(101);
      if (
        aliases.length === 0
        || aliases.length > 100
        || aliases.some((alias) =>
          alias.source !== args.source || alias.connectionKey !== args.connectionKey
        )
      ) {
        throw new ConvexError({
          code: "INVALID_LEGACY_IDENTITY_ALIASES",
          source: args.source,
          transactionId: row.id,
          aliases: aliases.length
        });
      }
      if (row.profitContributionVersion !== undefined) {
        assertSupportedProfitContributionVersion(row);
        addProfitFactContribution(factDeltas, profitDistributionContribution(row), 1);
      }
      await ctx.db.patch(row._id, { identityVersion: 2 });
    }
    await applyProfitFactDeltas(ctx, factDeltas);
    if (page.length > 0) {
      await bumpLedgerRevision(ctx, page.map((row) => row.date));
      const dates = page.map((row) => row.date).sort();
      const key = `${args.source}:${args.connectionKey}`;
      const existingDisposition = await ctx.db
        .query("bankIdentityDispositions")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique();
      const next = {
        key,
        source: args.source,
        connectionKey: args.connectionKey,
        disposition: args.disposition,
        acceptedCount: (existingDisposition?.acceptedCount ?? 0) + page.length,
        earliestDate: existingDisposition
          ? [existingDisposition.earliestDate, dates[0]].sort()[0]
          : dates[0],
        latestDate: existingDisposition
          ? [existingDisposition.latestDate, dates.at(-1)!].sort().at(-1)!
          : dates.at(-1)!,
        updatedAt: new Date().toISOString()
      };
      if (existingDisposition) await ctx.db.patch(existingDisposition._id, next);
      else await ctx.db.insert("bankIdentityDispositions", next);
    }
    const dates = page.map((row) => row.date).sort();
    return {
      accepted: page.length,
      hasMore: rows.length > limit,
      earliestDate: dates[0] ?? null,
      latestDate: dates.at(-1) ?? null
    };
  }
});

export const finalizeBankLedgerCutover = mutation({
  args: {
    serviceToken: v.string(),
    connections: v.array(bankConnection)
  },
  returns: v.object({ ready: v.boolean(), completedAt: v.string() }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    if (
      args.connections.length > allBankSources.length
      || new Set(args.connections.map(({ source }) => source)).size !== args.connections.length
      || args.connections.some(({ connectionKey }) => !/^[0-9a-f]{64}$/.test(connectionKey))
    ) {
      throw new ConvexError({ code: "INVALID_BANK_CONNECTION_DIRECTORY" });
    }
    const connectionKeyBySource = new Map(
      args.connections.map(({ source, connectionKey }) => [source, connectionKey])
    );
    const [
      state,
      unversioned,
      unversionedIdentity,
      unresolvedLegacyIdentity,
      unscopedTransactionAccounts,
      unboundTransactions,
      unboundAccounts,
      sourceStates
    ] = await Promise.all([
      ctx.db
        .query("dashboardState")
        .withIndex("by_key", (q) => q.eq("key", bankLedgerRevisionKey))
        .unique(),
      ctx.db
        .query("bankTransactions")
        .withIndex("by_profit_contribution_version", (q) =>
          q.eq("profitContributionVersion", undefined)
        )
        .take(1),
      ctx.db
        .query("bankTransactions")
        .withIndex("by_identity_version", (q) => q.eq("identityVersion", undefined))
        .take(1),
      ctx.db
        .query("bankTransactions")
        .withIndex("by_identity_version", (q) => q.eq("identityVersion", 1))
        .take(1),
      ctx.db
        .query("bankTransactions")
        .withIndex("by_transaction_account_id", (q) => q.eq("accountId", undefined))
        .take(1),
      ctx.db
        .query("bankTransactions")
        .withIndex("by_connection_key", (q) => q.eq("connectionKey", undefined))
        .take(1),
      ctx.db
        .query("bankAccounts")
        .withIndex("by_connection_key", (q) => q.eq("connectionKey", undefined))
        .take(1),
      Promise.all(allBankSources.map(async (source) => {
        const [migration, binding, transaction, account] = await Promise.all([
          ctx.db
            .query("bankIdentityMigrations")
            .withIndex("by_source", (q) => q.eq("source", source))
            .unique(),
          ctx.db
            .query("bankConnectionBindings")
            .withIndex("by_source", (q) => q.eq("source", source))
            .unique(),
          ctx.db
            .query("bankTransactions")
            .withIndex("by_source", (q) => q.eq("source", source))
            .first(),
          ctx.db
            .query("bankAccounts")
            .withIndex("by_source", (q) => q.eq("source", source))
            .first()
        ]);
        if (!binding) return { source, migration, binding, transaction, account, hasConnectionMismatch: false };
        const [transactionsBefore, transactionsAfter, accountsBefore, accountsAfter] = await Promise.all([
          ctx.db
            .query("bankTransactions")
            .withIndex("by_source_connection", (q) =>
              q.eq("source", source).lt("connectionKey", binding.connectionKey)
            )
            .take(1),
          ctx.db
            .query("bankTransactions")
            .withIndex("by_source_connection", (q) =>
              q.eq("source", source).gt("connectionKey", binding.connectionKey)
            )
            .take(1),
          ctx.db
            .query("bankAccounts")
            .withIndex("by_source_connection", (q) =>
              q.eq("source", source).lt("connectionKey", binding.connectionKey)
            )
            .take(1),
          ctx.db
            .query("bankAccounts")
            .withIndex("by_source_connection", (q) =>
              q.eq("source", source).gt("connectionKey", binding.connectionKey)
            )
            .take(1)
        ]);
        return {
          source,
          migration,
          binding,
          transaction,
          account,
          hasConnectionMismatch: [
            ...transactionsBefore,
            ...transactionsAfter,
            ...accountsBefore,
            ...accountsAfter
          ].length > 0
        };
      }))
    ]);
    const legacyFieldsPresent = Boolean(
      state
      && (
        state.wiseStatementTransactions !== undefined
        || state.transactionTeamAssignments !== undefined
      )
    );
    if (
      legacyFieldsPresent
      || unversioned.length > 0
      || unversionedIdentity.length > 0
      || unresolvedLegacyIdentity.length > 0
      || unscopedTransactionAccounts.length > 0
      || unboundTransactions.length > 0
      || unboundAccounts.length > 0
    ) {
      throw new ConvexError({
        code: "BANK_LEDGER_CUTOVER_INCOMPLETE",
        legacyFieldsPresent,
        unversionedTransactions: unversioned.length,
        unversionedIdentities: unversionedIdentity.length,
        unresolvedLegacyIdentities: unresolvedLegacyIdentity.length,
        unscopedTransactionAccounts: unscopedTransactionAccounts.length,
        unboundTransactions: unboundTransactions.length,
        unboundAccounts: unboundAccounts.length,
        completedIdentityMigrations: sourceStates.filter(
          ({ migration }) => migration?.version === 2
        ).length
      });
    }

    for (const { source, migration, binding, transaction, account, hasConnectionMismatch } of sourceStates) {
      const suppliedConnectionKey = connectionKeyBySource.get(source);
      if (
        Boolean(binding) !== Boolean(suppliedConnectionKey)
        || (binding && suppliedConnectionKey !== binding.connectionKey)
      ) {
        throw new ConvexError({ code: "BANK_CONNECTION_DIRECTORY_MISMATCH", source });
      }
      const hasStoredData = Boolean(transaction || account);
      if (
        (hasStoredData && !binding)
        || (binding && migration?.version !== 2)
        || hasConnectionMismatch
      ) {
        throw new ConvexError({
          code: "BANK_LEDGER_CUTOVER_INCOMPLETE",
          source,
          missingBinding: hasStoredData && !binding,
          identityMigrationIncomplete: Boolean(binding && migration?.version !== 2),
          connectionMismatch: hasConnectionMismatch
        });
      }
    }

    for (const source of allBankSources) {
      const [legacyCheckpoint, legacySyncState, legacyLease] = await Promise.all([
        ctx.db
          .query("bankSyncCheckpoints")
          .withIndex("by_source_connection", (q) =>
            q.eq("source", source).eq("connectionKey", undefined)
          )
          .unique(),
        ctx.db
          .query("bankSyncState")
          .withIndex("by_source_connection", (q) =>
            q.eq("source", source).eq("connectionKey", undefined)
          )
          .unique(),
        ctx.db
          .query("workerLeases")
          .withIndex("by_key", (q) => q.eq("key", `bank-sync:${source}`))
          .unique()
      ]);
      if (legacyCheckpoint) await ctx.db.delete(legacyCheckpoint._id);
      if (legacySyncState) await ctx.db.delete(legacySyncState._id);
      if (legacyLease) await ctx.db.delete(legacyLease._id);
    }

    const completedAt = new Date().toISOString();
    const cutover = await ctx.db
      .query("bankLedgerCutover")
      .withIndex("by_key", (q) => q.eq("key", bankLedgerRevisionKey))
      .unique();
    if (cutover) await ctx.db.patch(cutover._id, { status: "ready", completedAt });
    else {
      await ctx.db.insert("bankLedgerCutover", {
        key: bankLedgerRevisionKey,
        status: "ready",
        completedAt
      });
    }
    return { ready: true, completedAt };
  }
});

export const getClassificationBacklog = query({
  args: {
    serviceToken: v.string(),
    limit: v.number()
  },
  returns: v.object({
    transactions: v.array(transaction),
    hasMore: v.boolean()
  }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const limit = Math.max(1, Math.min(500, Math.trunc(args.limit)));
    const bindings = await ctx.db.query("bankConnectionBindings").take(allBankSources.length + 1);
    if (bindings.length > allBankSources.length) {
      throw new ConvexError({ code: "BANK_CONNECTION_BINDING_LIMIT_EXCEEDED" });
    }
    const orderedBindings = [...bindings].sort((left, right) => (
      allBankSources.indexOf(left.source) - allBankSources.indexOf(right.source)
    ));
    const incompleteStates = [undefined, false] as const;
    const rowsByConnection = await Promise.all(orderedBindings.map(async (binding) => (
      (await Promise.all(incompleteStates.map((classificationComplete) => ctx.db
        .query("bankTransactions")
        .withIndex("by_source_connection_classification_complete", (q) =>
          q.eq("source", binding.source)
            .eq("connectionKey", binding.connectionKey)
            .eq("classificationComplete", classificationComplete)
        )
        .filter((q) => q.eq(q.field("identityVersion"), 2))
        .order("asc")
        .take(limit + 1))))
        .flat()
        .sort((left, right) => left._creationTime - right._creationTime)
        .slice(0, limit + 1)
    )));
    const rows: BankTransactionDoc[] = [];
    for (let rowIndex = 0; rows.length < limit; rowIndex += 1) {
      let foundRow = false;
      for (const connectionRows of rowsByConnection) {
        const row = connectionRows[rowIndex];
        if (!row) continue;
        foundRow = true;
        rows.push(row);
        if (rows.length === limit) break;
      }
      if (!foundRow) break;
    }
    const fetchedRowCount = rowsByConnection.reduce((total, connectionRows) => total + connectionRows.length, 0);
    return {
      transactions: rows.map(({
        _creationTime: _creationTime,
        _id: _id,
        syncedAt: _syncedAt,
        connectionKey: _connectionKey,
        profitContributionVersion: _profitContributionVersion,
        identityVersion: _identityVersion,
        ...item
      }) => item),
      hasMore: fetchedRowCount > rows.length
    };
  }
});

export const claimClassificationBackfill = mutation({
  args: {
    serviceToken: v.string(),
    token: v.string(),
    leaseMs: v.number()
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const key = "transaction-classification-backfill";
    const now = Date.now();
    const lease = await ctx.db
      .query("workerLeases")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (lease && lease.expiresAt > now) return false;
    const next = {
      key,
      token: args.token,
      expiresAt: now + Math.max(60_000, Math.min(15 * 60_000, Math.trunc(args.leaseMs)))
    };
    if (lease) await ctx.db.patch(lease._id, next);
    else await ctx.db.insert("workerLeases", next);
    return true;
  }
});

export const releaseClassificationBackfill = mutation({
  args: {
    serviceToken: v.string(),
    token: v.string()
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const lease = await ctx.db
      .query("workerLeases")
      .withIndex("by_key", (q) => q.eq("key", "transaction-classification-backfill"))
      .unique();
    if (!lease || lease.token !== args.token) return false;
    await ctx.db.delete(lease._id);
    return true;
  }
});

export const applyMerchantCategory = mutation({
  args: {
    serviceToken: v.string(),
    merchantKey: v.string(),
    merchantName: v.string(),
    direction: v.union(v.literal("in"), v.literal("out")),
    category: v.string(),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number())
  },
  returns: v.object({
    updated: v.number(),
    hasMore: v.boolean(),
    continueCursor: v.union(v.string(), v.null())
  }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const requestedLimit = args.limit === undefined || !Number.isFinite(args.limit)
      ? maximumMerchantUpdateBatchSize
      : Math.trunc(args.limit);
    const limit = Math.max(1, Math.min(maximumMerchantUpdateBatchSize, requestedLimit));
    const result = await ctx.db
      .query("bankTransactions")
      .withIndex("by_merchant_direction", (q) =>
        q.eq("merchantKey", args.merchantKey).eq("direction", args.direction)
      )
      .paginate({
        numItems: limit,
        cursor: args.cursor ?? null,
        maximumRowsRead: limit,
        maximumBytesRead: maximumActivityBytesRead
      });
    const factDeltas = new Map<string, ProfitFactDelta>();
    const analyticsChangedDates = new Set<string>();
    for (const row of result.page) {
      const update = {
        category: args.category,
        categorySource: "manual" as const,
        categoryConfidence: 1,
        categoryReason: `Manual rule for ${args.merchantName}`
      };
      const next = { ...row, ...update };
      addVersionedProfitFactChange(factDeltas, row, next);
      if (transactionVisibleChanged(row, next)) analyticsChangedDates.add(row.date);
      await ctx.db.patch(row._id, update);
    }
    await applyProfitFactDeltas(ctx, factDeltas);
    if (analyticsChangedDates.size > 0) await bumpLedgerRevision(ctx, analyticsChangedDates);
    return {
      updated: result.page.length,
      hasMore: !result.isDone,
      continueCursor: result.isDone ? null : result.continueCursor
    };
  }
});

export const repairGenericCardPaymentAliasBatch = mutation({
  args: {
    serviceToken: v.string(),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number())
  },
  returns: v.object({
    scanned: v.number(),
    repairedSlashPayments: v.number(),
    resetGenericAliasMatches: v.number(),
    hasMore: v.boolean(),
    continueCursor: v.union(v.string(), v.null())
  }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const requestedLimit = args.limit === undefined || !Number.isFinite(args.limit)
      ? maximumMaintenanceBatchSize
      : Math.trunc(args.limit);
    const limit = Math.max(1, Math.min(maximumMaintenanceBatchSize, requestedLimit));
    const result = await ctx.db.query("bankTransactions").order("asc").paginate({
      numItems: limit,
      cursor: args.cursor ?? null,
      maximumRowsRead: limit,
      maximumBytesRead: maximumActivityBytesRead
    });
    const factDeltas = new Map<string, ProfitFactDelta>();
    const analyticsChangedDates = new Set<string>();
    let repairedSlashPayments = 0;
    let resetGenericAliasMatches = 0;

    for (const row of result.page) {
      const slashDailyCardPayment = isSlashDailyCardPayment(row);
      const genericAliasMatch = row.categorySource === "rule"
        && row.categoryReason?.trim().toLowerCase() === "saved category alias: card payment";
      if (!slashDailyCardPayment && !genericAliasMatch) continue;

      const update = slashDailyCardPayment
        ? {
            category: "Internal transfer",
            merchantName: "Slash card payment",
            merchantKey: "slashcardpayment",
            classificationComplete: true,
            categorySource: "rule" as const,
            categoryConfidence: 1,
            categoryReason: "Slash daily card payment",
            matchedProviderId: undefined,
            companyMatchSource: undefined,
            companyConfidence: undefined,
            companyMatchReason: undefined,
            matchedInvoiceId: undefined,
            confidence: 1,
            matchReason: "Slash daily card payment"
          }
        : {
            category: "Uncategorized",
            classificationComplete: false,
            categorySource: undefined,
            categoryConfidence: undefined,
            categoryReason: undefined,
            confidence: undefined,
            matchReason: undefined
          };
      const next = { ...row, ...update };
      if (!transactionVisibleChanged(row, next)) continue;
      addVersionedProfitFactChange(factDeltas, row, next);
      analyticsChangedDates.add(row.date);
      await ctx.db.patch(row._id, update);
      if (slashDailyCardPayment) repairedSlashPayments += 1;
      else resetGenericAliasMatches += 1;
    }

    await applyProfitFactDeltas(ctx, factDeltas);
    if (analyticsChangedDates.size > 0) await bumpLedgerRevision(ctx, analyticsChangedDates);
    return {
      scanned: result.page.length,
      repairedSlashPayments,
      resetGenericAliasMatches,
      hasMore: !result.isDone,
      continueCursor: result.isDone ? null : result.continueCursor
    };
  }
});

export const applyMerchantCompany = mutation({
  args: {
    serviceToken: v.string(),
    merchantKey: v.string(),
    merchantName: v.string(),
    direction: v.union(v.literal("in"), v.literal("out")),
    providerId: v.string(),
    cursor: v.optional(v.union(v.string(), v.null())),
    limit: v.optional(v.number())
  },
  returns: v.object({
    updated: v.number(),
    hasMore: v.boolean(),
    continueCursor: v.union(v.string(), v.null())
  }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const requestedLimit = args.limit === undefined || !Number.isFinite(args.limit)
      ? maximumMerchantUpdateBatchSize
      : Math.trunc(args.limit);
    const limit = Math.max(1, Math.min(maximumMerchantUpdateBatchSize, requestedLimit));
    const result = await ctx.db
      .query("bankTransactions")
      .withIndex("by_merchant_direction", (q) =>
        q.eq("merchantKey", args.merchantKey).eq("direction", args.direction)
      )
      .paginate({
        numItems: limit,
        cursor: args.cursor ?? null,
        maximumRowsRead: limit,
        maximumBytesRead: maximumActivityBytesRead
      });
    const analyticsChangedDates = new Set<string>();
    for (const row of result.page) {
      const update = {
        matchedProviderId: args.providerId,
        companyMatchSource: "manual" as const,
        companyConfidence: 1,
        companyMatchReason: `Manual rule for ${args.merchantName}`,
        confidence: 1,
        matchReason: `Manual rule for ${args.merchantName}`
      };
      if (transactionVisibleChanged(row, { ...row, ...update })) analyticsChangedDates.add(row.date);
      await ctx.db.patch(row._id, update);
    }
    if (analyticsChangedDates.size > 0) await bumpLedgerRevision(ctx, analyticsChangedDates);
    return {
      updated: result.page.length,
      hasMore: !result.isDone,
      continueCursor: result.isDone ? null : result.continueCursor
    };
  }
});

export const clearProviderReferencesBatch = mutation({
  args: {
    serviceToken: v.string(),
    providerId: v.string(),
    limit: v.optional(v.number())
  },
  returns: v.object({ updated: v.number(), hasMore: v.boolean() }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const limit = Math.max(
      1,
      Math.min(maximumMaintenanceBatchSize, Math.trunc(args.limit ?? maximumMaintenanceBatchSize))
    );
    const rows = await ctx.db
      .query("bankTransactions")
      .withIndex("by_matched_provider", (q) => q.eq("matchedProviderId", args.providerId))
      .take(limit + 1);
    const page = rows.slice(0, limit);
    const analyticsChangedDates = new Set<string>();
    for (const row of page) {
      const update = {
        matchedProviderId: undefined,
        companyMatchSource: undefined,
        companyConfidence: undefined,
        companyMatchReason: undefined,
        confidence: undefined,
        matchReason: undefined
      };
      if (transactionVisibleChanged(row, { ...row, ...update })) analyticsChangedDates.add(row.date);
      await ctx.db.patch(row._id, update);
    }
    if (analyticsChangedDates.size > 0) await bumpLedgerRevision(ctx, analyticsChangedDates);
    return { updated: page.length, hasMore: rows.length > limit };
  }
});

export const renameCategoryBatch = mutation({
  args: {
    serviceToken: v.string(),
    fromCategory: v.string(),
    toCategory: v.string(),
    limit: v.optional(v.number())
  },
  returns: v.object({ updated: v.number(), hasMore: v.boolean() }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const limit = Math.max(
      1,
      Math.min(maximumMaintenanceBatchSize, Math.trunc(args.limit ?? maximumMaintenanceBatchSize))
    );
    const rows = await ctx.db
      .query("bankTransactions")
      .withIndex("by_category", (q) => q.eq("category", args.fromCategory))
      .take(limit + 1);
    const page = rows.slice(0, limit);
    const factDeltas = new Map<string, ProfitFactDelta>();
    const analyticsChangedDates = new Set<string>();
    for (const row of page) {
      const next = { ...row, category: args.toCategory };
      addVersionedProfitFactChange(factDeltas, row, next);
      if (transactionVisibleChanged(row, next)) analyticsChangedDates.add(row.date);
      await ctx.db.patch(row._id, { category: args.toCategory });
    }
    await applyProfitFactDeltas(ctx, factDeltas);
    if (analyticsChangedDates.size > 0) await bumpLedgerRevision(ctx, analyticsChangedDates);
    return { updated: page.length, hasMore: rows.length > limit };
  }
});

export const hasCategoryReference = query({
  args: { serviceToken: v.string(), category: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const rows = await ctx.db
      .query("bankTransactions")
      .withIndex("by_category", (q) => q.eq("category", args.category))
      .take(1);
    return rows.length > 0;
  }
});

export const deleteSourceBatch = mutation({
  args: {
    serviceToken: v.string(),
    source: bankSource,
    limit: v.optional(v.number())
  },
  returns: v.object({ deleted: v.number(), hasMore: v.boolean() }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    const limit = Math.max(
      1,
      Math.min(maximumMaintenanceBatchSize, Math.trunc(args.limit ?? maximumMaintenanceBatchSize))
    );
    const rows = await ctx.db
      .query("bankTransactions")
      .withIndex("by_source_date_id", (q) => q.eq("source", args.source))
      .take(limit + 1);
    const page = rows.slice(0, limit);
    const factDeltas = new Map<string, ProfitFactDelta>();
    for (const row of page) addVersionedProfitFactDeletion(factDeltas, row);
    await applyProfitFactDeltas(ctx, factDeltas);
    for (const row of page) {
      const aliases = await ctx.db
        .query("bankTransactionAliases")
        .withIndex("by_transaction_id", (q) => q.eq("transactionId", row.id))
        .take(101);
      if (aliases.length > 100) {
        throw new ConvexError({ code: "TRANSACTION_ALIAS_LIMIT_EXCEEDED", transactionId: row.id });
      }
      for (const alias of aliases) await ctx.db.delete(alias._id);
      await ctx.db.delete(row._id);
    }
    if (page.length > 0) await bumpLedgerRevision(ctx, page.map((row) => row.date));
    return { deleted: page.length, hasMore: rows.length > limit };
  }
});

export const completeSync = mutation({
  args: {
    serviceToken: v.string(),
    source: bankSource,
    fromDate: v.string(),
    toDate: v.string(),
    syncedAt: v.string(),
    accountIds: v.array(v.string()),
    connectionKey: v.string(),
    leaseToken: v.string(),
    leaseFence: v.number()
  },
  returns: v.object({
    source: bankSource,
    coveredRanges: v.array(v.object({ fromDate: v.string(), toDate: v.string() })),
    lastSyncedAt: v.string()
  }),
  handler: async (ctx, args) => {
    requireServiceToken(args.serviceToken);
    await assertBankLedgerReady(ctx);
    await assertActiveBankSyncLease(ctx, args.source, args);
    assertDateRange(args.fromDate, args.toDate);
    const accountIds = [...new Set(args.accountIds)].sort();
    if (
      accountIds.length > maximumBankAccountsPerSource
      || accountIds.some((accountId) => !accountId || accountId.length > 1_024)
    ) {
      throw new ConvexError({ code: "INVALID_SYNC_ACCOUNT_SET", source: args.source });
    }
    const existing = await ctx.db
      .query("bankSyncState")
      .withIndex("by_source_connection", (q) =>
        q.eq("source", args.source).eq("connectionKey", args.connectionKey)
      )
      .unique();
    const sameAccountSet = JSON.stringify(existing?.accountIds ?? []) === JSON.stringify(accountIds);
    const ranges = [
      ...(sameAccountSet ? existing?.coveredRanges ?? [] : []),
      { fromDate: args.fromDate, toDate: args.toDate }
    ].sort((left, right) => left.fromDate.localeCompare(right.fromDate));
    const coveredRanges: Array<{ fromDate: string; toDate: string }> = [];
    for (const range of ranges) {
      const previous = coveredRanges.at(-1);
      if (
        previous
        && range.fromDate <= new Date(
          Date.parse(`${previous.toDate}T00:00:00.000Z`) + 86_400_000
        ).toISOString().slice(0, 10)
      ) {
        if (range.toDate > previous.toDate) previous.toDate = range.toDate;
      } else {
        coveredRanges.push({ ...range });
      }
    }
    if (coveredRanges.length > maximumCoverageRangesPerConnection) {
      throw new ConvexError({
        code: "SYNC_COVERAGE_FRAGMENTATION_LIMIT",
        source: args.source,
        limit: maximumCoverageRangesPerConnection
      });
    }
    const next = {
      source: args.source,
      connectionKey: args.connectionKey,
      accountIds,
      coveredRanges,
      lastSyncedAt: args.syncedAt
    };
    if (existing) await ctx.db.patch(existing._id, next);
    else await ctx.db.insert("bankSyncState", next);
    return {
      source: next.source,
      coveredRanges: next.coveredRanges,
      lastSyncedAt: next.lastSyncedAt
    };
  }
});
