import type { AccountBalance, Transaction } from "./types";
import { bankProviderTransactionId } from "./providerIdentity";
import { assertBankAccountInput, assertBankTransactionInput } from "./bankRecordValidation";
import { decodeBankSyncCheckpoint, encodeBankSyncCheckpoint, type BankSyncCheckpoint } from "./bankSyncCheckpoint";
import { fetchBankProvider, readBoundedResponseJson } from "./boundedHttp";

const apiBase = "https://api.mercury.com/api/v1";
const pageSize = 200;
const dayMs = 86_400_000;
type DateRange = { fromDate: string; toDate: string };
type RecordValue = Record<string, unknown>;
type Cursor = { phase: "created" | "posted"; after?: string };

export interface MercuryActivityOptions {
  apiToken: string;
  dateRange?: DateRange;
  checkpoint?: BankSyncCheckpoint;
  pageBudget?: number;
  fetcher?: typeof fetch;
  now?: number;
  collectTransactions?: boolean;
  onAccountsDiscovered?: (accounts: AccountBalance[]) => void | Promise<void>;
  onTransactionPage?: (transactions: Transaction[]) => void | Promise<void>;
}

function record(value: unknown, field: string): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Mercury returned invalid ${field}`);
  return value as RecordValue;
}
function text(value: unknown, field: string, max = 1_024): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`Mercury returned invalid ${field}`);
  return value.trim();
}
function optionalText(value: unknown, field: string): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  return text(value, field);
}
function id(value: unknown, field: string): string {
  const result = text(value, field, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result)) throw new Error(`Mercury returned invalid ${field}`);
  return result;
}
function amount(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1e15) throw new Error(`Mercury returned invalid ${field}`);
  return value;
}
function timestamp(value: unknown, field: string): string {
  const result = text(value, field, 64);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(result) || !Number.isFinite(Date.parse(result))) throw new Error(`Mercury returned invalid ${field}`);
  return new Date(result).toISOString();
}
function rows(payload: RecordValue, key: string): RecordValue[] {
  const items = payload[key];
  if (!Array.isArray(items) || items.length > pageSize) throw new Error(`Mercury returned invalid ${key} page`);
  return items.map(item => record(item, key));
}
function nextPage(payload: RecordValue, seen: Set<string>): string | undefined {
  const next = record(payload.page, "pagination").nextPage;
  if (next === undefined || next === null) return undefined;
  const cursor = id(next, "next page cursor");
  if (seen.has(cursor)) throw new Error("Mercury pagination did not advance");
  seen.add(cursor);
  return cursor;
}
async function get(options: MercuryActivityOptions, path: string, params: URLSearchParams): Promise<RecordValue> {
  if (!options.apiToken?.trim()) throw new Error("MERCURY_API_TOKEN is not configured");
  const response = await fetchBankProvider(options.fetcher ?? fetch, `${apiBase}/${path}?${params}`, {
    headers: { Authorization: `Bearer ${options.apiToken.trim()}`, Accept: "application/json" }, redirect: "manual"
  }, { provider: "Mercury" });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Mercury API request failed (${response.status})`); }
  return record(await readBoundedResponseJson(response, "Mercury"), path);
}

async function accounts(options: MercuryActivityOptions): Promise<{ balances: AccountBalance[]; openedOn: string }> {
  const result: AccountBalance[] = [];
  const openingDates: string[] = [];
  const seen = new Set<string>();
  const accountIds = new Set<string>();
  let after: string | undefined;
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({ limit: String(pageSize), order: "asc" });
    if (after) params.set("start_after", after);
    const payload = await get(options, "accounts", params);
    for (const row of rows(payload, "accounts")) {
      if (row.type !== "mercury") continue;
      const providerId = id(row.id, "account ID");
      if (accountIds.has(providerId)) throw new Error("Mercury returned duplicate accounts");
      accountIds.add(providerId);
      if (!["checking", "savings"].includes(text(row.kind, "account kind"))) throw new Error("Mercury returned an unsupported account kind; cash balances were not updated");
      const account: AccountBalance = {
        id: `mercury-${providerId}`, name: text(row.name, "account name", 512), source: "mercury",
        balance: amount(row.currentBalance, "current balance"), currency: "USD",
        updatedAt: new Date(options.now ?? Date.now()).toISOString(), status: "live"
      };
      assertBankAccountInput(account);
      result.push(account);
      openingDates.push(timestamp(row.createdAt, "account opening date").slice(0, 10));
    }
    after = nextPage(payload, seen);
    if (!after) {
      if (!result.length) throw new Error("Mercury returned no owned cash accounts");
      return { balances: result, openedOn: openingDates.sort()[0] };
    }
  }
  throw new Error("Mercury account pagination exceeded its safety limit");
}

export function normalizeMercuryTransaction(row: RecordValue, accountMap: Map<string, AccountBalance>): Transaction {
  const providerAccountId = id(row.accountId, "transaction account ID");
  const account = accountMap.get(`mercury-${providerAccountId}`);
  if (!account) throw new Error("Mercury transaction refers to an undiscovered account");
  const providerId = id(row.id, "transaction ID");
  const signedAmount = amount(row.amount, "transaction amount");
  const state = text(row.status, "transaction status");
  if (!["pending", "sent", "cancelled", "failed", "reversed", "blocked"].includes(state)) throw new Error("Mercury returned an unsupported transaction status");
  const status = state === "pending" ? "pending" : state === "sent" ? "posted" : "voided";
  const kind = text(row.kind, "transaction kind");
  const counterparty = text(row.counterpartyName, "counterparty");
  const description = optionalText(row.bankDescription, "bank description") ?? optionalText(row.externalMemo, "memo") ?? kind;
  const transfer = kind === "internalTransfer" || kind === "treasuryTransfer";
  const recipient = counterparty.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
  // These are the same owner-confirmed related companies used for Wise funding.
  const intercompany = ["digitalnudgeou", "lovemedobv"].includes(recipient)
    && ["outgoingPayment", "incomingTransfer", "externalTransfer", "other"].includes(kind);
  const movement = transfer ? "Internal transfer" : intercompany ? "Intercompany transfer" : undefined;
  const transaction: Transaction = {
    id: bankProviderTransactionId("mercury", [providerAccountId, providerId]), source: "mercury",
    accountId: account.id, accountName: account.name,
    date: timestamp(row.postedAt ?? row.createdAt, "transaction date").slice(0, 10),
    description, rawName: counterparty, counterparty,
    amount: Math.abs(signedAmount), currency: "USD", direction: signedAmount < 0 ? "out" : "in", status,
    category: movement ?? "Mercury",
    ...(movement ? { categorySource: "rule", categoryConfidence: 1,
      categoryReason: transfer ? "Mercury identifies a transfer between own accounts" : "Operational funding between owner-confirmed related companies",
      classificationComplete: true } : status === "voided" ? { classificationComplete: true } : {}),
    ...(row.cardId ? { cardId: id(row.cardId, "card ID") } : {})
  };
  assertBankTransactionInput(transaction);
  return transaction;
}

export async function fetchMercuryActivityBatch(options: MercuryActivityOptions) {
  const budget = options.pageBudget ?? 5;
  if (!Number.isInteger(budget) || budget < 1 || budget > 10) throw new Error("Mercury sync page budget must be between 1 and 10");
  const now = options.now ?? Date.now();
  const checkpoint = options.checkpoint ? decodeBankSyncCheckpoint(options.checkpoint, "mercury") : undefined;
  const discoveredAccounts = await accounts(options);
  const discovered = discoveredAccounts.balances;
  const range = options.dateRange ?? { fromDate: discoveredAccounts.openedOn, toDate: new Date(now).toISOString().slice(0, 10) };
  const start = checkpoint?.windowStart ?? `${range.fromDate}T00:00:00.000Z`;
  const end = checkpoint?.windowEnd ?? new Date(Date.parse(`${range.toDate}T00:00:00.000Z`) + dayMs).toISOString();
  if (!Number.isFinite(Date.parse(start)) || Date.parse(start) >= Date.parse(end)) throw new Error("Invalid Mercury date range");
  let cursor: Cursor = checkpoint ? JSON.parse(checkpoint.cursor) : { phase: "created" };
  if (!cursor || !["created", "posted"].includes(cursor.phase)) throw new Error("Invalid Mercury sync cursor");
  if (cursor.after) id(cursor.after, "sync cursor");
  await options.onAccountsDiscovered?.(discovered);
  const accountMap = new Map(discovered.map(account => [account.id, account]));
  const transactions = new Map<string, Transaction>();
  const seen = new Set(cursor.after ? [cursor.after] : []);
  let pagesFetched = 0;
  let providerTransactionsRead = 0;
  let complete = false;
  while (pagesFetched < budget) {
    // Creation time includes pending/voided activity; posted time also catches
    // settlements whose original creation predates the requested ledger period.
    const params = new URLSearchParams({ limit: String(pageSize), order: "asc" });
    params.set(cursor.phase === "created" ? "start" : "postedStart", start);
    params.set(cursor.phase === "created" ? "end" : "postedEnd", new Date(Date.parse(end) - 1).toISOString());
    if (cursor.after) params.set("start_after", cursor.after);
    const payload = await get(options, "transactions", params);
    const items = rows(payload, "transactions");
    const normalized = items.map(row => normalizeMercuryTransaction(row, accountMap))
      .filter(row => row.date >= start.slice(0, 10) && row.date < end.slice(0, 10));
    await options.onTransactionPage?.(normalized);
    if (options.collectTransactions !== false) for (const row of normalized) transactions.set(row.id, row);
    pagesFetched++;
    providerTransactionsRead += items.length;
    const after = nextPage(payload, seen);
    if (after) cursor = { ...cursor, after };
    else if (cursor.phase === "created") { cursor = { phase: "posted" }; seen.clear(); }
    else { complete = true; break; }
  }
  return {
    accounts: discovered, transactions: [...transactions.values()], complete, pagesFetched, providerTransactionsRead,
    dateRange: { fromDate: start.slice(0, 10), toDate: new Date(Date.parse(end) - dayMs).toISOString().slice(0, 10) },
    nextCheckpoint: complete ? null : encodeBankSyncCheckpoint({ provider: "mercury", windowStart: start, windowEnd: end, cursor: JSON.stringify(cursor) })
  };
}

export async function fetchMercuryActivity(options: MercuryActivityOptions) {
  const transactions = new Map<string, Transaction>();
  let checkpoint: string | undefined;
  for (let attempt = 0; attempt < 100; attempt++) {
    const result = await fetchMercuryActivityBatch({ ...options, checkpoint, collectTransactions: true });
    for (const row of result.transactions) transactions.set(row.id, row);
    if (result.complete) return { accounts: result.accounts, transactions: [...transactions.values()] };
    checkpoint = result.nextCheckpoint!;
  }
  throw new Error("Mercury transaction pagination exceeded its safety limit");
}
