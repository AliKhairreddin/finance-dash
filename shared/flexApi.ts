import type { AccountBalance, Transaction } from "./types";
import { bankProviderTransactionId } from "./providerIdentity";
import { assertBankAccountInput, assertBankTransactionInput } from "./bankRecordValidation";
import { decodeBankSyncCheckpoint, encodeBankSyncCheckpoint } from "./bankSyncCheckpoint";
import { fetchBankProvider, readBoundedResponseJson } from "./boundedHttp";

export const flexApiVersion = "2026-09-21";
export const flexRefreshMs = 5 * 60_000;
type Row = Record<string, unknown>;
type Range = { fromDate: string; toDate: string };
type Cursor = { phase: "date" | "modified"; next?: string; modifiedAfter?: string; modifiedBefore: string };
export class FlexRateLimitError extends Error {
  constructor(readonly retryAt: number) { super("Flex rate limit reached; synchronization is paused until " + new Date(retryAt).toISOString()); }
}
export interface FlexOptions {
  apiKey: string;
  organizationId: string;
  fetcher?: typeof fetch;
  now?: number;
  /** Delay injectable for deterministic tests. Requests are serialized below the provider limit. */
  wait?: (ms: number) => Promise<void>;
}
function record(value: unknown, field: string): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Flex returned invalid ${field}`);
  return value as Row;
}
function text(value: unknown, field: string, limit = 1024): string {
  if (typeof value !== "string" || !value.trim() || value.length > limit) throw new Error(`Flex returned invalid ${field}`);
  return value.trim();
}
function optionalText(value: unknown, field: string, limit = 1024): string | undefined {
  return value === null || value === undefined || value === "" ? undefined : text(value, field, limit);
}
export function flexId(value: unknown, field = "ID"): string {
  const result = text(value, field, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result)) throw new Error(`Flex returned invalid ${field}`);
  return result;
}
function timestamp(value: unknown, field: string): string {
  const result = text(value, field, 40);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(result) || !Number.isFinite(Date.parse(result))) throw new Error(`Flex returned invalid ${field}`);
  return new Date(result).toISOString();
}
function money(value: unknown, expectedCurrency?: string): { amount: number; currency: string } {
  const row = record(value, "money");
  const currency = row.currency === undefined ? "USD" : text(row.currency, "currency", 3);
  if (!/^[A-Z]{3}$/.test(currency) || (expectedCurrency && currency !== expectedCurrency)
    || !Number.isSafeInteger(row.amount) || !Number.isInteger(row.scale) || Number(row.scale) < 0 || Number(row.scale) > 8) {
    throw new Error("Flex returned invalid or inconsistent money");
  }
  return { amount: Number(row.amount) / 10 ** Number(row.scale), currency };
}
function balance(value: unknown, currency: string): { amount: number; asOf: string } {
  const row = record(value, "balance");
  if (row.unavailable !== undefined || row.amount === undefined) throw new Error("Flex balance is unavailable; saved balances were preserved");
  return { amount: money(row.amount, currency).amount, asOf: timestamp(row.asOf, "balance timestamp") };
}
function reader(options: FlexOptions) {
  let lastRequestAt = 0;
  return async (path: "accounts" | "universal-transactions", params: URLSearchParams): Promise<Row> => {
    if (!options.apiKey.trim()) throw new Error("FLEX_API_KEY is not configured");
    const delay = Math.max(0, 600 - (Date.now() - lastRequestAt));
    if (delay) await (options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms))))(delay);
    lastRequestAt = Date.now();
    const response = await fetchBankProvider(options.fetcher ?? fetch, `https://api.flex.one/${path}?${params}`, {
      headers: { Authorization: `Bearer ${options.apiKey.trim()}`, Accept: "application/json", "flex-version": flexApiVersion }, redirect: "manual"
    }, { provider: "Flex", maxAttempts: 1 });
    if (response.status === 429) {
      const header = response.headers.get("Retry-After");
      const seconds = header && /^\d+$/.test(header) ? Number(header) : 60;
      await response.body?.cancel();
      throw new FlexRateLimitError(Date.now() + Math.max(60, Number.isFinite(seconds) ? seconds : 60) * 1000);
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Flex API request failed (${response.status})`); }
    if (response.headers.get("flex-version") !== flexApiVersion) { await response.body?.cancel(); throw new Error("Flex API contract version was not confirmed"); }
    return record(await readBoundedResponseJson(response, "Flex"), path);
  };
}
function page(payload: Row, seen: Set<string>, sortBy: string): { rows: Row[]; next?: string } {
  if (!Array.isArray(payload.data) || payload.data.length > 100) throw new Error("Flex returned an invalid data page");
  const meta = record(payload.metadata, "pagination");
  if (meta.pageSize !== 100 || meta.sort !== "asc" || meta.sortBy !== sortBy || typeof meta.hasMore !== "boolean") throw new Error("Flex returned inconsistent pagination");
  const next = optionalText(meta.nextToken, "cursor", 4096);
  if (meta.hasMore !== Boolean(next) || (next && (seen.has(next) || !payload.data.length))) throw new Error("Flex pagination did not advance");
  if (next) seen.add(next);
  return { rows: payload.data.map(row => record(row, "record")), next };
}
async function accounts(options: FlexOptions, get: ReturnType<typeof reader>) {
  const organizationId = flexId(options.organizationId, "configured organization ID");
  const result: AccountBalance[] = [];
  const openings: string[] = [];
  const seen = new Set<string>();
  const ids = new Set<string>();
  let next: string | undefined;
  for (let index = 0; index < 10; index++) {
    const params = new URLSearchParams({ organizationIds: organizationId, pageSize: "100", sort: "asc", sortBy: "createdAt" });
    if (next) params.set("nextToken", next);
    const response = page(await get("accounts", params), seen, "createdAt");
    for (const row of response.rows) {
      const id = flexId(row.id, "account ID");
      if (row.organizationId !== organizationId || ids.has(id)) throw new Error("Flex returned a duplicate or unexpected organization's account");
      ids.add(id);
      if (row.type !== "banking" && row.type !== "rewardCard") throw new Error("Flex returned an unsupported account type");
      if (!["active", "inactive", "closed", "pending"].includes(String(row.status))) throw new Error("Flex returned an unsupported account status");
      const currency = text(row.currency, "account currency", 3);
      const balances = record(row.balances, "balances");
      const available = balance(balances.available, currency);
      const owed = row.type === "rewardCard" ? balance(balances.owed, currency) : undefined;
      const account: AccountBalance = {
        id: `flex-${id}`, name: `Mojo Labs LLC · ${text(row.name, "account name", 400)}${owed ? " (owed)" : ""}`,
        source: "flex", currency, balance: owed ? -owed.amount : available.amount,
        updatedAt: owed && owed.asOf < available.asOf ? owed.asOf : available.asOf, status: "live",
        flex: { type: row.type, available: available.amount, availableAsOf: available.asOf, status: String(row.status) }
      };
      assertBankAccountInput(account);
      result.push(account);
      if (result.length > 200) throw new Error("Flex account directory exceeded its safety limit");
      openings.push(timestamp(row.createdAt, "account creation date").slice(0, 10));
    }
    next = response.next;
    if (!next) {
      if (!result.length) throw new Error("Flex returned no accounts; saved data was preserved");
      return { accounts: result, openedOn: openings.sort()[0] };
    }
  }
  throw new Error("Flex account pagination exceeded its safety limit");
}
export async function fetchFlexAccounts(options: FlexOptions) { return accounts(options, reader(options)); }

const pending = new Set(["acknowledged", "authorized", "clearing", "disputed", "hold", "initiated", "manual-review", "pending", "pending-return", "refund-pending", "return-contested", "return-dishonored", "scheduled", "submitted"]);
const voided = new Set(["canceled", "declined", "expired", "failed", "refund-unsuccessful", "rejected", "returned"]);
export function normalizeFlexTransaction(row: Row, directory: Map<string, AccountBalance>, organizationId: string): Transaction[] {
  const id = flexId(row.id, "transaction ID");
  if (row.organizationId !== organizationId) throw new Error("Flex transaction belongs to another organization");
  const type = text(row.type, "transaction type");
  if (!["adjustment", "card-purchase", "fee", "interest", "repayment", "transfer"].includes(type)) throw new Error("Flex returned an unsupported transaction type");
  const state = text(row.status, "transaction status");
  const status = state === "settled" || state === "refund-cleared" ? "posted" : pending.has(state) ? "pending" : voided.has(state) ? "voided" : undefined;
  if (!status) throw new Error("Flex returned an unsupported transaction status");
  if (!["in", "out", "internal"].includes(String(row.direction))) throw new Error("Flex returned an unsupported transaction direction");
  const attributes = record(row.attributes, "transaction attributes");
  const occurredAt = timestamp(row.date, "transaction date");
  const createdAt = timestamp(row.createdAt, "transaction creation timestamp");
  const modifiedAt = timestamp(row.lastModifiedAt, "transaction modification timestamp");
  const sides = (["source", "destination"] as const).flatMap(side => {
    const value = row[`${side}FinancialAccount`];
    if (!value) return [];
    const account = record(value, "transaction account");
    const accountId = flexId(account.id, "transaction account ID");
    flexId(account.organizationId, "transaction account organization");
    if (!["banking", "rewardCard", "other"].includes(String(account.type))) throw new Error("Flex transaction account type is unsupported");
    if (account.organizationId !== organizationId) return [];
    const owned = directory.get(`flex-${accountId}`);
    if (!owned) {
      if (account.type !== "other") throw new Error("Flex transaction refers to an undiscovered owned account");
      // The API includes collateral/loan account identities on transactions but
      // does not expose their balances. Retain their activity without inventing a balance.
      return [{ side, account: { id: `flex-${accountId}`, name: `Mojo Labs LLC · ${optionalText(account.nickname, "account nickname", 400) ?? "Other Flex account"}`, currency: undefined as string | undefined }, providerAccountId: accountId }];
    }
    if (account.organizationId !== organizationId || account.type !== owned.flex?.type) throw new Error("Flex transaction account identity is inconsistent");
    return [{ side, account: owned, providerAccountId: accountId }];
  });
  if (!sides.length || new Set(sides.map(s => s.account.id)).size !== sides.length) throw new Error("Flex transaction has no unambiguous owned account");
  // A card purchase can carry both a collateral and loan account. It is one
  // merchant expense, even when Flex calls its structural direction "internal".
  const ledgerSides = type === "card-purchase" ? [sides.find(side => side.side === "source") ?? sides[0]] : sides;
  const internal = type !== "card-purchase" && sides.length === 2;
  const refund = type === "card-purchase" && state.startsWith("refund-");
  return ledgerSides.map(({ side, account, providerAccountId }) => {
    const amount = money(row[`${side}Amount`], account.currency);
    if (amount.amount < 0 || money(row.amount).amount < 0) throw new Error("Flex transaction magnitude must be nonnegative");
    const opposite = row[side === "source" ? "destination" : "source"];
    const merchant = attributes.merchant ? record(attributes.merchant, "merchant") : undefined;
    const counterparty = optionalText(merchant?.name, "merchant name") ?? (opposite ? optionalText(record(opposite, "counterparty").name, "counterparty name") : undefined) ?? type;
    const direction = type === "card-purchase" ? refund ? "in" : "out" : side === "source" ? "out" : "in";
    const tx: Transaction = {
      id: bankProviderTransactionId("flex", [providerAccountId, id]), source: "flex", accountId: account.id, accountName: account.name,
      date: occurredAt.slice(0, 10), description: optionalText(row.description, "description") ?? counterparty,
      ...(optionalText(row.memo, "memo") ? { reference: String(row.memo) } : {}),
      rawName: counterparty, counterparty, amount: amount.amount, currency: amount.currency, direction, status,
      category: internal ? "Internal transfer" : refund ? "Refunds and chargebacks" : "Flex",
      ...(internal || refund ? { categorySource: "rule", categoryConfidence: 1, categoryReason: internal ? "Movement between verified Flex accounts" : "Flex card refund status", classificationComplete: true } : status === "voided" ? { classificationComplete: true } : {}),
      ...(attributes.cardId ? { cardId: flexId(attributes.cardId, "card ID") } : {}),
      ...(attributes.cardLastFour ? { cardLastFour: text(attributes.cardLastFour, "card last four", 4) } : {}),
      ...(attributes.personName ? { cardHolderName: text(attributes.personName, "cardholder name", 512) } : {}),
      cardMetadataVersion: 1,
      flex: { id, type, status: state, occurredAt, createdAt, modifiedAt,
        ...(attributes.declineReason ? { declineReason: text(attributes.declineReason, "decline reason", 128) } : {}) }
    };
    assertBankTransactionInput(tx);
    return tx;
  });
}

export interface FlexActivityOptions extends FlexOptions {
  dateRange?: Range;
  modifiedAfter?: string;
  checkpoint?: string;
  pageBudget?: number;
  onAccountsDiscovered?: (accounts: AccountBalance[]) => Promise<void>;
  onTransactionPage?: (transactions: Transaction[]) => Promise<void>;
}
export async function fetchFlexActivityBatch(options: FlexActivityOptions) {
  const budget = options.pageBudget ?? 5;
  if (!Number.isInteger(budget) || budget < 1 || budget > 10) throw new Error("Flex page budget must be between 1 and 10");
  const get = reader(options);
  const discovered = await accounts(options, get);
  const now = new Date(options.now ?? Date.now()).toISOString();
  const checkpoint = options.checkpoint ? decodeBankSyncCheckpoint(options.checkpoint, "flex") : undefined;
  const from = checkpoint?.windowStart ?? `${options.dateRange?.fromDate ?? discovered.openedOn}T00:00:00.000Z`;
  const through = checkpoint?.windowEnd ?? new Date(Date.parse(`${options.dateRange?.toDate ?? now.slice(0, 10)}T00:00:00.000Z`) + 86_400_000).toISOString();
  if (!Number.isFinite(Date.parse(from)) || Date.parse(from) >= Date.parse(through)) throw new Error("Flex date range is invalid");
  let cursor: Cursor = checkpoint ? JSON.parse(checkpoint.cursor) : { phase: "date", modifiedAfter: options.modifiedAfter, modifiedBefore: now };
  if (!["date", "modified"].includes(cursor.phase)) throw new Error("Invalid Flex checkpoint phase");
  timestamp(cursor.modifiedBefore, "checkpoint end");
  if (cursor.modifiedAfter) timestamp(cursor.modifiedAfter, "checkpoint start");
  if (cursor.phase === "modified" && !cursor.modifiedAfter) throw new Error("Invalid Flex correction checkpoint");
  const directory = new Map(discovered.accounts.map(account => [account.id, account]));
  await options.onAccountsDiscovered?.(discovered.accounts);
  const seen = new Set(cursor.next ? [cursor.next] : []);
  const transactions = new Map<string, Transaction>();
  let complete = false;
  let pagesFetched = 0;
  let providerTransactionsRead = 0;
  while (pagesFetched < budget) {
    const sortBy = cursor.phase === "date" ? "date" : "lastModifiedAt";
    const params = new URLSearchParams({ organizationIds: options.organizationId, pageSize: "100", sort: "asc", sortBy });
    if (cursor.phase === "date") { params.set("dateAfter", from); params.set("dateBefore", new Date(Date.parse(through) - 1).toISOString()); }
    else { params.set("lastModifiedAfter", cursor.modifiedAfter!); params.set("lastModifiedBefore", cursor.modifiedBefore); }
    if (cursor.next) params.set("nextToken", cursor.next);
    const response = page(await get("universal-transactions", params), seen, sortBy);
    for (const row of response.rows) {
      const at = timestamp(row[cursor.phase === "date" ? "date" : "lastModifiedAt"], "filtered transaction timestamp");
      if (cursor.phase === "date" ? at < from || at >= through : at < cursor.modifiedAfter! || at > cursor.modifiedBefore) {
        throw new Error("Flex returned a transaction outside the requested coverage");
      }
    }
    const normalized = response.rows.flatMap(row => normalizeFlexTransaction(row, directory, options.organizationId));
    if (new Set(normalized.map(row => row.id)).size !== normalized.length) throw new Error("Flex returned duplicate transaction IDs in a page");
    await options.onTransactionPage?.(normalized);
    for (const row of normalized) transactions.set(row.id, row);
    providerTransactionsRead += response.rows.length;
    pagesFetched++;
    if (response.next) cursor = { ...cursor, next: response.next };
    else if (cursor.phase === "date" && cursor.modifiedAfter) { cursor = { ...cursor, phase: "modified", next: undefined }; seen.clear(); }
    else { complete = true; break; }
  }
  return { accounts: discovered.accounts, transactions: [...transactions.values()], complete, pagesFetched, providerTransactionsRead,
    modifiedThrough: cursor.modifiedBefore, dateRange: { fromDate: from.slice(0, 10), toDate: new Date(Date.parse(through) - 1).toISOString().slice(0, 10) },
    nextCheckpoint: complete ? null : encodeBankSyncCheckpoint({ provider: "flex", windowStart: from, windowEnd: through, cursor: JSON.stringify(cursor) }) };
}
