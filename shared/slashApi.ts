import type { AccountBalance, SlashAccountSubtype, Transaction } from "./types";
import {
  decodeBankSyncCheckpoint,
  encodeBankSyncCheckpoint,
  type BankSyncCheckpoint
} from "./bankSyncCheckpoint";
import { fetchBankProvider, readBoundedResponseText } from "./boundedHttp";
import { bankProviderTransactionId } from "./providerIdentity";

export const slashDefaultActivityWindowDays = 45;
const slashActivityWindowMs = 1000 * 60 * 60 * 24 * slashDefaultActivityWindowDays;
const maxSlashPages = 100;
const maximumSlashPageItems = 500;
const maximumSlashAccounts = 200;
const maximumSlashAccountPages = 10;
const maximumSlashAccountBalanceRows = 200;
const maximumSlashBalancesPerAccount = 10;
// Two provider IDs are hex-encoded into one ledger ID, which is capped at 2,048 characters.
const maximumSlashProviderIdLength = 500;
const maximumSlashTextLength = 1_024;
const maximumSlashCursorLength = 512;
const slashBalanceFetchConcurrency = 8;
export const slashDefaultSyncPageBudget = 5;
export const slashMaximumSyncPageBudget = 10;

type SlashAccountType = "debit" | "charge_card";
type SlashBalanceType = "cash" | "credit" | "debit";
type SlashTransactionStatus = "pending" | "posted" | "failed";

interface SlashMoney {
  amountCents: number;
}

interface SlashBalance {
  accountId: string;
  type: SlashBalanceType;
  available: SlashMoney;
  posted: SlashMoney;
  timestamp: string;
}

interface SlashAccount {
  id: string;
  name: string;
  status: "open" | "closed";
  type: SlashAccountType;
  balances: SlashBalanceType[];
}

interface SlashTransaction {
  id: string;
  date: string;
  description: string;
  amountCents: number;
  accountId: string;
  accountSubtype: SlashAccountSubtype;
  status: SlashTransactionStatus;
  cashbackInfo?: {
    amountCents: number;
    rate: number;
  };
  merchantData?: {
    description?: string;
    categoryCode?: string;
  };
}

interface SlashPage<T> {
  items: T[];
  metadata: {
    nextCursor?: string;
  };
}

export interface SlashActivityResult {
  accounts: AccountBalance[];
  transactions: Transaction[];
}

export interface SlashTransactionDateRange {
  fromDate: string;
  toDate: string;
}

interface SlashActivityOptions {
  baseUrl: string;
  apiKey: string;
  legalEntityId: string;
  dateRange?: SlashTransactionDateRange;
  fetcher?: typeof fetch;
  now?: number;
  onTransactionPage?: (transactions: Transaction[]) => void | Promise<void>;
  collectTransactions?: boolean;
}

export interface SlashActivityBatchOptions {
  baseUrl: string;
  apiKey: string;
  legalEntityId: string;
  dateRange?: SlashTransactionDateRange;
  checkpoint?: BankSyncCheckpoint;
  pageBudget?: number;
  fetcher?: typeof fetch;
  now?: number;
  onAccountsDiscovered?: (accounts: AccountBalance[]) => void | Promise<void>;
  onTransactionPage?: (transactions: Transaction[]) => void | Promise<void>;
  collectTransactions?: boolean;
}

export interface SlashActivityBatchResult extends SlashActivityResult {
  nextCheckpoint: BankSyncCheckpoint | null;
  complete: boolean;
  pagesFetched: number;
  providerTransactionsRead: number;
}

interface SlashTransactionOptions {
  baseUrl: string;
  apiKey: string;
  legalEntityId: string;
  transactionId: string;
  fetcher?: typeof fetch;
}

function requiredIsoDate(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${field} must use YYYY-MM-DD`);
  }
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new Error(`${field} is not a valid date`);
  }
  return value;
}

export function parseSlashTransactionDateRange(
  fromDate?: string | null,
  toDate?: string | null
): SlashTransactionDateRange | undefined {
  const normalizedFromDate = fromDate?.trim();
  const normalizedToDate = toDate?.trim();
  if (!normalizedFromDate && !normalizedToDate) return undefined;
  if (!normalizedFromDate || !normalizedToDate) {
    throw new Error("Slash transaction loading requires both a from date and a to date");
  }
  const range = {
    fromDate: requiredIsoDate(normalizedFromDate, "Slash from date"),
    toDate: requiredIsoDate(normalizedToDate, "Slash to date")
  };
  if (range.fromDate > range.toDate) {
    throw new Error("Slash from date must be on or before the to date");
  }
  return range;
}

function slashSyncPageBudget(value = slashDefaultSyncPageBudget): number {
  if (!Number.isInteger(value) || value < 1 || value > slashMaximumSyncPageBudget) {
    throw new Error(`Slash sync page budget must be an integer from 1 to ${slashMaximumSyncPageBudget}`);
  }
  return value;
}

function slashTransactionWindow(
  dateRange: SlashTransactionDateRange | undefined,
  now: number
): { windowStart: string; windowEnd: string } {
  const validated = dateRange
    ? parseSlashTransactionDateRange(dateRange.fromDate, dateRange.toDate)
    : undefined;
  return validated
    ? {
        windowStart: `${validated.fromDate}T00:00:00.000Z`,
        windowEnd: `${validated.toDate}T23:59:59.999Z`
      }
    : {
        windowStart: new Date(now - slashActivityWindowMs).toISOString(),
        windowEnd: new Date(now).toISOString()
      };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Slash API response is missing ${field}`);
  return value;
}

function requiredString(
  value: unknown,
  field: string,
  maximumLength = maximumSlashTextLength
): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Slash API response is missing ${field}`);
  }
  const normalized = value.trim();
  if (normalized.length > maximumLength) {
    throw new Error(`Slash API response ${field} exceeds ${maximumLength} characters`);
  }
  return normalized;
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Slash API response is missing ${field}`);
  }
  if (Math.abs(value) > 1_000_000_000_000_000) {
    throw new Error(`Slash API response ${field} exceeds the supported numeric range`);
  }
  return value;
}

function requiredCents(value: unknown, field: string): number {
  const amount = requiredNumber(value, field);
  if (!Number.isSafeInteger(amount)) {
    throw new Error(`Slash API response ${field} must be a safe integer number of cents`);
  }
  return amount;
}

function requiredIsoTimestamp(value: unknown, field: string): string {
  const timestamp = requiredString(value, field, 64);
  const date = timestamp.slice(0, 10);
  const dateMs = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? Date.parse(`${date}T00:00:00.000Z`)
    : Number.NaN;
  if (
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp)
    || !Number.isFinite(Date.parse(timestamp))
    || !Number.isFinite(dateMs)
    || new Date(dateMs).toISOString().slice(0, 10) !== date
  ) {
    throw new Error(`Slash API response ${field} is not a valid ISO timestamp`);
  }
  return timestamp;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredString(value, field);
}

function parseSlashMoney(value: unknown, field: string): SlashMoney {
  const payload = requiredRecord(value, field);
  return { amountCents: requiredCents(payload.amountCents, `${field}.amountCents`) };
}

function parseSlashBalance(value: unknown, index: number): SlashBalance {
  const field = `account.balances[${index}]`;
  const payload = requiredRecord(value, field);
  const type = requiredString(payload.type, `${field}.type`);
  if (type !== "cash" && type !== "credit" && type !== "debit") {
    throw new Error(`Slash API response has unsupported ${field}.type`);
  }
  return {
    accountId: requiredString(payload.accountId, `${field}.accountId`, maximumSlashProviderIdLength),
    type,
    available: parseSlashMoney(payload.available, `${field}.available`),
    posted: parseSlashMoney(payload.posted, `${field}.posted`),
    timestamp: requiredIsoTimestamp(payload.timestamp, `${field}.timestamp`)
  };
}

function parseSlashAccount(value: unknown): SlashAccount {
  const payload = requiredRecord(value, "account");
  const status = requiredString(payload.status, "account.status");
  const type = requiredString(payload.type, "account.type");
  if (status !== "open" && status !== "closed") {
    throw new Error("Slash API response has unsupported account.status");
  }
  if (type !== "debit" && type !== "charge_card") {
    throw new Error("Slash API response has unsupported account.type");
  }
  if (!Array.isArray(payload.balances)) {
    throw new Error("Slash API response is missing account.balances");
  }
  if (payload.balances.length === 0 || payload.balances.length > 3) {
    throw new Error("Slash API response account.balances has an invalid size");
  }
  const balances = payload.balances.map((balance, index) => {
    const balanceType = requiredString(balance, `account.balances[${index}]`, 16);
    if (balanceType !== "cash" && balanceType !== "credit" && balanceType !== "debit") {
      throw new Error(`Slash API response has unsupported account.balances[${index}]`);
    }
    return balanceType;
  });
  if (new Set(balances).size !== balances.length) {
    throw new Error("Slash API response account.balances contains duplicate balance types");
  }
  return {
    id: requiredString(payload.id, "account.id", maximumSlashProviderIdLength),
    name: requiredString(payload.name, "account.name", 512),
    status,
    type,
    balances
  };
}

function parseSlashTransaction(value: unknown): SlashTransaction {
  const payload = requiredRecord(value, "transaction");
  const status = requiredString(payload.status, "transaction.status");
  if (status !== "pending" && status !== "posted" && status !== "failed") {
    throw new Error("Slash API response has unsupported transaction.status");
  }
  const accountSubtype = requiredString(payload.accountSubtype, "transaction.accountSubtype");
  if (accountSubtype !== "cash" && accountSubtype !== "credit") {
    throw new Error("Slash API response has unsupported transaction.accountSubtype");
  }
  const merchantData = payload.merchantData === undefined
    ? undefined
    : requiredRecord(payload.merchantData, "transaction.merchantData");
  const cashbackInfo = payload.cashbackInfo === undefined
    ? undefined
    : requiredRecord(payload.cashbackInfo, "transaction.cashbackInfo");
  return {
    id: requiredString(payload.id, "transaction.id", maximumSlashProviderIdLength),
    date: requiredIsoTimestamp(payload.date, "transaction.date"),
    description: requiredString(payload.description, "transaction.description"),
    amountCents: requiredCents(payload.amountCents, "transaction.amountCents"),
    accountId: requiredString(payload.accountId, "transaction.accountId", maximumSlashProviderIdLength),
    accountSubtype,
    status,
    ...(cashbackInfo
      ? {
          cashbackInfo: {
            amountCents: requiredCents(cashbackInfo.amountCents, "transaction.cashbackInfo.amountCents"),
            rate: requiredNumber(cashbackInfo.rate, "transaction.cashbackInfo.rate")
          }
        }
      : {}),
    ...(merchantData
      ? {
          merchantData: {
            description: optionalString(merchantData.description, "transaction.merchantData.description"),
            categoryCode: merchantData.categoryCode === undefined || merchantData.categoryCode === null
              ? undefined
              : requiredString(merchantData.categoryCode, "transaction.merchantData.categoryCode", 64)
          }
        }
      : {})
  };
}

function parseSlashPage<T>(value: unknown, parseItem: (item: unknown) => T): SlashPage<T> {
  const payload = requiredRecord(value, "page");
  if (!Array.isArray(payload.items)) throw new Error("Slash API response is missing page.items");
  if (payload.items.length > maximumSlashPageItems) {
    throw new Error(`Slash API page exceeded ${maximumSlashPageItems} items`);
  }
  const metadata = requiredRecord(payload.metadata, "page.metadata");
  return {
    items: payload.items.map(parseItem),
    metadata: {
      nextCursor: metadata.nextCursor === undefined || metadata.nextCursor === null
        ? undefined
        : requiredString(metadata.nextCursor, "page.metadata.nextCursor", maximumSlashCursorLength)
    }
  };
}

async function fetchSlashPage<T>(
  fetcher: typeof fetch,
  url: URL,
  headers: HeadersInit,
  parseItem: (item: unknown) => T
): Promise<SlashPage<T>> {
  const response = await fetchBankProvider(fetcher, url, { headers }, { provider: "Slash" });
  const text = await readBoundedResponseText(response, "Slash");
  if (!response.ok) {
    const requestId = response.headers.get("x-request-id");
    const requestSuffix = requestId ? ` [Slash request ${requestId}]` : "";
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 500)}${requestSuffix}`);
  }
  if (!text) throw new Error("Slash API returned an empty response");
  const page = parseSlashPage(JSON.parse(text) as unknown, parseItem);
  return page;
}

async function fetchSlashResource<T>(
  fetcher: typeof fetch,
  url: URL,
  headers: HeadersInit,
  field: string,
  parse: (value: unknown) => T
): Promise<T> {
  const response = await fetchBankProvider(fetcher, url, { headers }, { provider: "Slash" });
  const text = await readBoundedResponseText(response, "Slash");
  if (!response.ok) {
    const requestId = response.headers.get("x-request-id");
    const requestSuffix = requestId ? ` [Slash request ${requestId}]` : "";
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 500)}${requestSuffix}`);
  }
  if (!text) throw new Error(`Slash API returned an empty ${field} response`);
  return parse(JSON.parse(text) as unknown);
}

async function fetchSlashBalances(
  fetcher: typeof fetch,
  url: URL,
  headers: HeadersInit
): Promise<SlashBalance[]> {
  const response = await fetchBankProvider(fetcher, url, { headers }, { provider: "Slash" });
  const text = await readBoundedResponseText(response, "Slash");
  if (!response.ok) {
    const requestId = response.headers.get("x-request-id");
    const requestSuffix = requestId ? ` [Slash request ${requestId}]` : "";
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 500)}${requestSuffix}`);
  }
  if (!text) throw new Error("Slash API returned an empty response");
  const payload = requiredRecord(JSON.parse(text) as unknown, "balance response");
  if (!Array.isArray(payload.balances)) {
    throw new Error("Slash API response is missing balances");
  }
  if (payload.balances.length > maximumSlashBalancesPerAccount) {
    throw new Error(`Slash API response exceeded ${maximumSlashBalancesPerAccount} balances per account`);
  }
  const balances = payload.balances.map(parseSlashBalance);
  if (new Set(balances.map((balance) => balance.type)).size !== balances.length) {
    throw new Error("Slash API response contains duplicate balance types");
  }
  return balances;
}

async function fetchAllSlashPages<T>(
  fetcher: typeof fetch,
  initialUrl: URL,
  headers: HeadersInit,
  parseItem: (item: unknown) => T,
  maxItems = Number.POSITIVE_INFINITY,
  maximumPages = maxSlashPages
): Promise<T[]> {
  const items: T[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  for (let pageNumber = 0; pageNumber < maximumPages; pageNumber += 1) {
    const url = new URL(initialUrl);
    if (cursor) url.searchParams.set("cursor", cursor);
    const page = await fetchSlashPage(fetcher, url, headers, parseItem);
    const remainingCapacity = Math.max(0, maxItems - items.length);
    if (page.items.length > remainingCapacity) {
      throw new Error(`Slash API result exceeded ${maxItems} items`);
    }
    items.push(...page.items);
    if (items.length >= maxItems) {
      if (page.metadata.nextCursor) {
        throw new Error(`Slash API result exceeded ${maxItems} items`);
      }
      return items;
    }
    cursor = page.metadata.nextCursor;
    if (cursor) {
      if (seenCursors.has(cursor)) throw new Error("Slash API returned a repeated pagination cursor");
      seenCursors.add(cursor);
    }
    if (!cursor) return items;
  }

  throw new Error(`Slash API pagination exceeded ${maximumPages} pages`);
}

async function fetchSlashTransactionPages({
  fetcher,
  initialUrl,
  headers,
  accountNameById,
  onTransactionPage,
  collectTransactions
}: {
  fetcher: typeof fetch;
  initialUrl: URL;
  headers: HeadersInit;
  accountNameById: ReadonlyMap<string, string>;
  onTransactionPage?: (transactions: Transaction[]) => void | Promise<void>;
  collectTransactions: boolean;
}): Promise<Transaction[]> {
  const transactions: Transaction[] = [];
  const seenTransactionIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  for (let pageNumber = 0; pageNumber < maxSlashPages; pageNumber += 1) {
    const url = new URL(initialUrl);
    if (cursor) url.searchParams.set("cursor", cursor);
    const page = await fetchSlashPage(fetcher, url, headers, parseSlashTransaction);
    const normalizedPage = page.items.flatMap((item) => {
      if (seenTransactionIds.has(item.id)) return [];
      seenTransactionIds.add(item.id);
      const accountName = accountNameById.get(item.accountId);
      if (!accountName) {
        throw new Error(`Slash transaction ${item.id} references unknown account ${item.accountId}`);
      }
      return [normalizeSlashTransaction(item, accountName)];
    });

    if (collectTransactions) transactions.push(...normalizedPage);
    if (normalizedPage.length > 0 && onTransactionPage) {
      await onTransactionPage(normalizedPage);
    }

    cursor = page.metadata.nextCursor;
    if (!cursor) return transactions;
    if (seenCursors.has(cursor)) throw new Error("Slash API returned a repeated pagination cursor");
    seenCursors.add(cursor);
  }

  throw new Error(`Slash API pagination exceeded ${maxSlashPages} pages`);
}

function requiredAccountBalance(
  account: SlashAccount,
  balances: SlashBalance[],
  expectedType: SlashBalanceType
): SlashBalance {
  const balance = balances.find((item) => item.type === expectedType);
  if (!balance) {
    throw new Error(`Slash account ${account.id} is missing its ${expectedType} balance`);
  }
  return balance;
}

function slashHeaders(apiKey: string, legalEntityId: string): HeadersInit {
  return {
    Accept: "application/json",
    "User-Agent": "finance-dash/1.0 (+https://finance.thatcanadian.dev)",
    "X-API-Key": apiKey,
    "x-legal-entity": legalEntityId
  };
}

function normalizeSlashTransaction(transaction: SlashTransaction, accountName: string): Transaction {
  const signedAmount = transaction.amountCents / 100;
  const counterparty = transaction.merchantData?.description?.trim() || transaction.description;
  const accountLabel = `${accountName} ${transaction.accountSubtype === "cash" ? "Cash" : "Credit"}`;
  const status: Transaction["status"] = transaction.status === "pending"
    ? "pending"
    : transaction.status === "failed"
      ? "voided"
      : "posted";
  return {
    id: bankProviderTransactionId("slash", [transaction.accountId, transaction.id]),
    providerLegacyId: `slash-${transaction.id}`,
    source: "slash",
    slashAccountSubtype: transaction.accountSubtype,
    accountId: `slash-${transaction.accountId}-${transaction.accountSubtype}`,
    accountName: accountLabel,
    date: transaction.date.slice(0, 10),
    description: transaction.description,
    rawName: counterparty,
    counterparty,
    amount: Math.abs(signedAmount),
    currency: "USD",
    ...(transaction.cashbackInfo
      ? {
          cashback: {
            amount: transaction.cashbackInfo.amountCents / 100,
            rate: transaction.cashbackInfo.rate
          }
        }
      : {}),
    direction: signedAmount >= 0 ? "in" : "out",
    status,
    category: "Slash",
    ...(status === "voided" ? { classificationComplete: true } : {})
  };
}

async function fetchSlashAccountSnapshot(
  fetcher: typeof fetch,
  baseUrl: string,
  headers: HeadersInit
): Promise<{ accounts: AccountBalance[]; accountNameById: Map<string, string> }> {
  const slashAccounts = await fetchAllSlashPages(
    fetcher,
    new URL("/account", baseUrl),
    headers,
    parseSlashAccount,
    maximumSlashAccounts,
    maximumSlashAccountPages
  );
  const openAccounts = slashAccounts.filter((item) => item.status === "open");
  const accountBalanceRows = openAccounts.reduce(
    (total, account) => total + (account.type === "debit" ? 1 : 2),
    0
  );
  if (accountBalanceRows > maximumSlashAccountBalanceRows) {
    throw new Error(
      `Slash account snapshot exceeded ${maximumSlashAccountBalanceRows} balance rows`
    );
  }
  const balancesByGroupId = new Map<string, SlashBalance[]>();
  for (let index = 0; index < openAccounts.length; index += slashBalanceFetchConcurrency) {
    const batch = openAccounts.slice(index, index + slashBalanceFetchConcurrency);
    const balances = await Promise.all(batch.map(async (account) => {
      const balanceUrl = new URL(`/account/${encodeURIComponent(account.id)}/balance`, baseUrl);
      const accountBalances = await fetchSlashBalances(fetcher, balanceUrl, headers);
      return [account.id, accountBalances] as const;
    }));
    for (const [groupId, accountBalances] of balances) {
      balancesByGroupId.set(groupId, accountBalances);
    }
  }
  const accountNameById = new Map<string, string>();
  const groupIdByAccountId = new Map<string, string>();
  const accounts: AccountBalance[] = openAccounts
    .flatMap((account) => {
      const balances = balancesByGroupId.get(account.id) ?? [];
      for (const balance of balances) {
        const existingGroupId = groupIdByAccountId.get(balance.accountId);
        if (existingGroupId && existingGroupId !== account.id) {
          throw new Error(
            `Slash account ${balance.accountId} belongs to multiple account groups`
          );
        }
        groupIdByAccountId.set(balance.accountId, account.id);
        accountNameById.set(balance.accountId, account.name);
      }
      const accountBalances: Array<{ apiType: SlashBalanceType; subtype: SlashAccountSubtype; label: string }> =
        account.type === "debit"
          ? [{ apiType: "debit", subtype: "cash", label: "Cash" }]
          : [
              { apiType: "cash", subtype: "cash", label: "Cash" },
              { apiType: "credit", subtype: "credit", label: "Credit" }
            ];
      return accountBalances.map(({ apiType, subtype, label }) => {
        const balance = requiredAccountBalance(account, balances, apiType);
        return {
          id: `slash-${balance.accountId}-${subtype}`,
          name: `${account.name} ${label}`,
          source: "slash" as const,
          slashAccountSubtype: subtype,
          balance: balance.available.amountCents / 100,
          currency: "USD",
          updatedAt: balance.timestamp,
          status: "live" as const
        };
      });
    });
  return { accounts, accountNameById };
}

export async function fetchSlashActivityBatch({
  baseUrl,
  apiKey,
  legalEntityId,
  dateRange,
  checkpoint,
  pageBudget,
  fetcher = fetch,
  now = Date.now(),
  onAccountsDiscovered,
  onTransactionPage,
  collectTransactions = true
}: SlashActivityBatchOptions): Promise<SlashActivityBatchResult> {
  if (checkpoint && dateRange) {
    throw new Error("Slash sync accepts either a date range or a checkpoint, not both");
  }
  const budget = slashSyncPageBudget(pageBudget);
  const decodedCheckpoint = checkpoint
    ? decodeBankSyncCheckpoint(checkpoint, "slash")
    : undefined;
  const window = decodedCheckpoint
    ? {
        windowStart: decodedCheckpoint.windowStart,
        windowEnd: decodedCheckpoint.windowEnd
      }
    : slashTransactionWindow(dateRange, now);
  const headers = slashHeaders(apiKey, legalEntityId);
  const { accounts, accountNameById } = await fetchSlashAccountSnapshot(fetcher, baseUrl, headers);
  if (onAccountsDiscovered) await onAccountsDiscovered(accounts);
  const initialUrl = new URL("/transaction", baseUrl);
  initialUrl.searchParams.set("filter:from_date", String(Date.parse(window.windowStart)));
  initialUrl.searchParams.set("filter:to_date", String(Date.parse(window.windowEnd)));

  const transactions: Transaction[] = [];
  const seenTransactionIds = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor = decodedCheckpoint?.cursor;
  let pagesFetched = 0;
  let providerTransactionsRead = 0;

  for (let pageNumber = 0; pageNumber < budget; pageNumber += 1) {
    const url = new URL(initialUrl);
    if (cursor) url.searchParams.set("cursor", cursor);
    const page = await fetchSlashPage(fetcher, url, headers, parseSlashTransaction);
    pagesFetched += 1;
    providerTransactionsRead += page.items.length;
    const normalizedPage = page.items.flatMap((item) => {
      if (seenTransactionIds.has(item.id)) return [];
      seenTransactionIds.add(item.id);
      const accountName = accountNameById.get(item.accountId);
      if (!accountName) {
        throw new Error(`Slash transaction ${item.id} references unknown account ${item.accountId}`);
      }
      return [normalizeSlashTransaction(item, accountName)];
    });
    if (collectTransactions) transactions.push(...normalizedPage);
    if (normalizedPage.length > 0 && onTransactionPage) {
      await onTransactionPage(normalizedPage);
    }

    const nextCursor = page.metadata.nextCursor;
    if (!nextCursor) {
      return {
        accounts,
        transactions,
        nextCheckpoint: null,
        complete: true,
        pagesFetched,
        providerTransactionsRead
      };
    }
    if (nextCursor === cursor || seenCursors.has(nextCursor)) {
      throw new Error("Slash API returned a repeated pagination cursor");
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return {
    accounts,
    transactions,
    nextCheckpoint: encodeBankSyncCheckpoint({
      provider: "slash",
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
      cursor: cursor!
    }),
    complete: false,
    pagesFetched,
    providerTransactionsRead
  };
}

export async function fetchSlashTransactionForLegalEntity({
  baseUrl,
  apiKey,
  legalEntityId,
  transactionId,
  fetcher = fetch
}: SlashTransactionOptions): Promise<Transaction> {
  const headers = slashHeaders(apiKey, legalEntityId);
  const transaction = await fetchSlashResource(
    fetcher,
    new URL(`/transaction/${encodeURIComponent(transactionId)}`, baseUrl),
    headers,
    "transaction",
    parseSlashTransaction
  );
  const account = await fetchSlashResource(
    fetcher,
    new URL(`/account/${encodeURIComponent(transaction.accountId)}`, baseUrl),
    headers,
    "account",
    parseSlashAccount
  );
  return normalizeSlashTransaction(transaction, account.name);
}

export async function fetchSlashActivityForLegalEntity({
  baseUrl,
  apiKey,
  legalEntityId,
  dateRange,
  fetcher = fetch,
  now = Date.now(),
  onTransactionPage,
  collectTransactions = true
}: SlashActivityOptions): Promise<SlashActivityResult> {
  const headers = slashHeaders(apiKey, legalEntityId);
  const transactionsUrl = new URL("/transaction", baseUrl);
  const validatedDateRange = dateRange
    ? parseSlashTransactionDateRange(dateRange.fromDate, dateRange.toDate)
    : undefined;
  transactionsUrl.searchParams.set(
    "filter:from_date",
    String(validatedDateRange ? Date.parse(`${validatedDateRange.fromDate}T00:00:00.000Z`) : now - slashActivityWindowMs)
  );
  if (validatedDateRange) {
    transactionsUrl.searchParams.set(
      "filter:to_date",
      String(Date.parse(`${validatedDateRange.toDate}T23:59:59.999Z`))
    );
  }

  const { accounts, accountNameById } = await fetchSlashAccountSnapshot(fetcher, baseUrl, headers);

  const transactions = await fetchSlashTransactionPages({
    fetcher,
    initialUrl: transactionsUrl,
    headers,
    accountNameById,
    onTransactionPage,
    collectTransactions
  });

  return { accounts, transactions };
}
