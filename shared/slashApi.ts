import type { AccountBalance, Transaction } from "./types";

const slashActivityWindowMs = 1000 * 60 * 60 * 24 * 45;

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
  balances: SlashBalance[];
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

interface SlashActivityOptions {
  baseUrl: string;
  apiKey: string;
  legalEntityId: string;
  fetcher?: typeof fetch;
  now?: number;
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
    balances: payload.balances.map(parseSlashBalance)
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

async function fetchAllSlashPages<T>(
  fetcher: typeof fetch,
  initialUrl: URL,
  headers: HeadersInit,
  parseItem: (item: unknown) => T
): Promise<T[]> {
  const items: T[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;

  do {
    const url = new URL(initialUrl);
    if (cursor) url.searchParams.set("cursor", cursor);
    const page = await fetchSlashPage(fetcher, url, headers, parseItem);
    items.push(...page.items);
    cursor = page.metadata.nextCursor;
    if (cursor) {
      if (seenCursors.has(cursor)) throw new Error("Slash API returned a repeated pagination cursor");
      seenCursors.add(cursor);
    }
  } while (cursor);

  return items;
}

function accountBalance(account: SlashAccount): SlashBalance {
  const expectedType: SlashBalanceType = account.type === "debit" ? "debit" : "cash";
  const balance = account.balances.find((item) => item.type === expectedType);
  if (!balance) {
    throw new Error(`Slash account ${account.id} is missing its ${expectedType} balance`);
  }
  return balance;
}

export async function fetchSlashActivityForLegalEntity({
  baseUrl,
  apiKey,
  legalEntityId,
  fetcher = fetch,
  now = Date.now()
}: SlashActivityOptions): Promise<SlashActivityResult> {
  const headers = {
    Accept: "application/json",
    "User-Agent": "finance-dash/1.0 (+https://finance.thatcanadian.dev)",
    "X-API-Key": apiKey,
    "x-legal-entity": legalEntityId
  };
  const accountsUrl = new URL("/account", baseUrl);
  const transactionsUrl = new URL("/transaction", baseUrl);
  transactionsUrl.searchParams.set("filter:from_date", String(now - slashActivityWindowMs));

  const [slashAccounts, slashTransactions] = await Promise.all([
    fetchAllSlashPages(fetcher, accountsUrl, headers, parseSlashAccount),
    fetchAllSlashPages(fetcher, transactionsUrl, headers, parseSlashTransaction)
  ]);
  const accountNameById = new Map(slashAccounts.map((account) => [account.id, account.name]));

  const accounts: AccountBalance[] = slashAccounts
    .filter((account) => account.status === "open")
    .map((account) => {
      const balance = accountBalance(account);
      return {
        id: `slash-${account.id}`,
        name: account.name,
        source: "slash",
        balance: balance.posted.amountCents / 100,
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
      const signedAmount = item.amountCents / 100;
      const counterparty = item.merchantData?.description?.trim() || item.description;
      return {
        id: `slash-${item.id}`,
        source: "slash",
        accountName,
        date: item.date.slice(0, 10),
        description: item.description,
        rawName: counterparty,
        counterparty,
        amount: Math.abs(signedAmount),
        currency: "USD",
        direction: signedAmount >= 0 ? "in" : "out",
        status: item.status === "pending" ? "pending" : "posted",
        category: item.merchantData?.categoryCode?.trim() || "Slash"
      };
    });

  return { accounts, transactions };
}
