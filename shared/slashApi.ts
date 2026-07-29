import type { AccountBalance, Transaction } from "./types";

export const slashDefaultActivityWindowDays = 45;
const slashActivityWindowMs = 1000 * 60 * 60 * 24 * slashDefaultActivityWindowDays;

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
  status: SlashTransactionStatus;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Slash API response is missing ${field}`);
  return value;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Slash API response is missing ${field}`);
  }
  return value;
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Slash API response is missing ${field}`);
  }
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  return requiredString(value, field);
}

function parseSlashMoney(value: unknown, field: string): SlashMoney {
  const payload = requiredRecord(value, field);
  return { amountCents: requiredNumber(payload.amountCents, `${field}.amountCents`) };
}

function parseSlashBalance(value: unknown, index: number): SlashBalance {
  const field = `account.balances[${index}]`;
  const payload = requiredRecord(value, field);
  const type = requiredString(payload.type, `${field}.type`);
  if (type !== "cash" && type !== "credit" && type !== "debit") {
    throw new Error(`Slash API response has unsupported ${field}.type`);
  }
  return {
    accountId: requiredString(payload.accountId, `${field}.accountId`),
    type,
    available: parseSlashMoney(payload.available, `${field}.available`),
    posted: parseSlashMoney(payload.posted, `${field}.posted`),
    timestamp: requiredString(payload.timestamp, `${field}.timestamp`)
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
  return {
    id: requiredString(payload.id, "account.id"),
    name: requiredString(payload.name, "account.name"),
    status,
    type,
    balances: payload.balances.map((balance, index) => {
      const balanceType = requiredString(balance, `account.balances[${index}]`);
      if (balanceType !== "cash" && balanceType !== "credit" && balanceType !== "debit") {
        throw new Error(`Slash API response has unsupported account.balances[${index}]`);
      }
      return balanceType;
    })
  };
}

function parseSlashTransaction(value: unknown): SlashTransaction {
  const payload = requiredRecord(value, "transaction");
  const status = requiredString(payload.status, "transaction.status");
  if (status !== "pending" && status !== "posted" && status !== "failed") {
    throw new Error("Slash API response has unsupported transaction.status");
  }
  const merchantData = payload.merchantData === undefined
    ? undefined
    : requiredRecord(payload.merchantData, "transaction.merchantData");
  return {
    id: requiredString(payload.id, "transaction.id"),
    date: requiredString(payload.date, "transaction.date"),
    description: requiredString(payload.description, "transaction.description"),
    amountCents: requiredNumber(payload.amountCents, "transaction.amountCents"),
    accountId: requiredString(payload.accountId, "transaction.accountId"),
    status,
    ...(merchantData
      ? {
          merchantData: {
            description: optionalString(merchantData.description, "transaction.merchantData.description"),
            categoryCode: optionalString(merchantData.categoryCode, "transaction.merchantData.categoryCode")
          }
        }
      : {})
  };
}

function parseSlashPage<T>(value: unknown, parseItem: (item: unknown) => T): SlashPage<T> {
  const payload = requiredRecord(value, "page");
  if (!Array.isArray(payload.items)) throw new Error("Slash API response is missing page.items");
  const metadata = requiredRecord(payload.metadata, "page.metadata");
  return {
    items: payload.items.map(parseItem),
    metadata: {
      nextCursor: optionalString(metadata.nextCursor, "page.metadata.nextCursor")
    }
  };
}

async function fetchSlashPage<T>(
  fetcher: typeof fetch,
  url: URL,
  headers: HeadersInit,
  parseItem: (item: unknown) => T
): Promise<SlashPage<T>> {
  const response = await fetcher(url, { headers });
  const text = await response.text();
  if (!response.ok) {
    const requestId = response.headers.get("x-request-id");
    const requestSuffix = requestId ? ` [Slash request ${requestId}]` : "";
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 500)}${requestSuffix}`);
  }
  if (!text) throw new Error("Slash API returned an empty response");
  return parseSlashPage(JSON.parse(text) as unknown, parseItem);
}

async function fetchSlashResource<T>(
  fetcher: typeof fetch,
  url: URL,
  headers: HeadersInit,
  field: string,
  parse: (value: unknown) => T
): Promise<T> {
  const response = await fetcher(url, { headers });
  const text = await response.text();
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
  const response = await fetcher(url, { headers });
  const text = await response.text();
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
  return payload.balances.map(parseSlashBalance);
}

async function fetchAllSlashPages<T>(
  fetcher: typeof fetch,
  initialUrl: URL,
  headers: HeadersInit,
  parseItem: (item: unknown) => T,
  maxItems = Number.POSITIVE_INFINITY
): Promise<T[]> {
  const items: T[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  do {
    const url = new URL(initialUrl);
    if (cursor) url.searchParams.set("cursor", cursor);
    const page = await fetchSlashPage(fetcher, url, headers, parseItem);
    items.push(...page.items.slice(0, Math.max(0, maxItems - items.length)));
    if (items.length >= maxItems) break;
    cursor = page.metadata.nextCursor;
    if (cursor) {
      if (seenCursors.has(cursor)) throw new Error("Slash API returned a repeated pagination cursor");
      seenCursors.add(cursor);
    }
  } while (cursor);

  return items;
}

function accountBalance(account: SlashAccount, balances: SlashBalance[]): SlashBalance {
  const expectedType: SlashBalanceType = account.type === "debit" ? "debit" : "credit";
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
  return {
    id: `slash-${transaction.id}`,
    source: "slash",
    accountName,
    date: transaction.date.slice(0, 10),
    description: transaction.description,
    rawName: counterparty,
    counterparty,
    amount: Math.abs(signedAmount),
    currency: "USD",
    direction: signedAmount >= 0 ? "in" : "out",
    status: transaction.status === "pending" ? "pending" : "posted",
    category: "Slash"
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
  if (transaction.status === "failed") {
    throw new Error(`Slash transaction ${transaction.id} failed and is not available in dashboard activity`);
  }
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
  now = Date.now()
}: SlashActivityOptions): Promise<SlashActivityResult> {
  const headers = slashHeaders(apiKey, legalEntityId);
  const accountsUrl = new URL("/account", baseUrl);
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

  const [slashAccounts, slashTransactions] = await Promise.all([
    fetchAllSlashPages(fetcher, accountsUrl, headers, parseSlashAccount),
    fetchAllSlashPages(fetcher, transactionsUrl, headers, parseSlashTransaction)
  ]);
  const balancesByAccountId = new Map<string, SlashBalance[]>();
  for (const account of slashAccounts.filter((item) => item.status === "open")) {
    const balanceUrl = new URL(`/account/${encodeURIComponent(account.id)}/balance`, baseUrl);
    balancesByAccountId.set(account.id, await fetchSlashBalances(fetcher, balanceUrl, headers));
  }
  const accountNameById = new Map(slashAccounts.map((account) => [account.id, account.name]));

  const accounts: AccountBalance[] = slashAccounts
    .filter((account) => account.status === "open")
    .map((account) => {
      const balance = accountBalance(account, balancesByAccountId.get(account.id) ?? []);
      return {
        id: `slash-${account.id}`,
        name: account.name,
        source: "slash",
        balance: balance.available.amountCents / 100,
        currency: "USD",
        updatedAt: balance.timestamp,
        status: "live"
      };
    });

  const transactions: Transaction[] = slashTransactions
    .filter((item) => item.status !== "failed")
    .map((item) => {
      const accountName = accountNameById.get(item.accountId);
      if (!accountName) throw new Error(`Slash transaction ${item.id} references unknown account ${item.accountId}`);
      return normalizeSlashTransaction(item, accountName);
    });

  return { accounts, transactions };
}
