import type { AccountBalance, Transaction } from "./types";
import {
  decodeBankSyncCheckpoint,
  encodeBankSyncCheckpoint,
  type BankSyncCheckpoint
} from "./bankSyncCheckpoint";
import {
  bankProviderOAuthFetchPolicy,
  fetchBankProvider,
  readBoundedResponseJson
} from "./boundedHttp";
import { bankProviderTransactionId } from "./providerIdentity";

const revolutBaseUrlByEnvironment = {
  production: "https://b2b.revolut.com/api/1.0",
  sandbox: "https://sandbox-b2b.revolut.com/api/1.0"
} as const;

const revolutConsentUrlByEnvironment = {
  production: "https://business.revolut.com/app-confirm",
  sandbox: "https://sandbox-business.revolut.com/app-confirm"
} as const;

const revolutClientAssertionType = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
const revolutAudience = "https://revolut.com";
export const revolutDefaultActivityWindowDays = 45;
const revolutActivityWindowMs = 1000 * 60 * 60 * 24 * revolutDefaultActivityWindowDays;
const revolutTransactionPageSize = 1000;
const maxRevolutTransactionPages = 100;
const maximumRevolutAccounts = 1_000;
const maximumRevolutTransactionLegs = 100;
// Three provider IDs are hex-encoded into one ledger ID, which is capped at 2,048 characters.
const maximumRevolutProviderIdLength = 300;
const maximumRevolutTextLength = 1_024;
export const revolutSyncTransactionPageSize = 200;
export const revolutDefaultSyncPageBudget = 5;
export const revolutMaximumSyncPageBudget = 10;
const revolutTransactionStates = [
  "created",
  "pending",
  "completed",
  "declined",
  "failed",
  "reverted"
] as const;

type RevolutEnvironment = keyof typeof revolutBaseUrlByEnvironment;

interface RevolutCredentials {
  environment?: string;
  clientId?: string;
  issuer?: string;
  privateKeyPem?: string;
}

interface RevolutActivityOptions extends RevolutCredentials {
  refreshToken?: string;
  dateRange?: RevolutTransactionDateRange;
  fetcher?: typeof fetch;
  now?: number;
  onTransactionPage?: (transactions: Transaction[]) => void | Promise<void>;
  collectTransactions?: boolean;
}

export interface RevolutActivityBatchOptions {
  environment?: string;
  clientId: string;
  issuer: string;
  privateKeyPem: string;
  refreshToken: string;
  dateRange?: RevolutTransactionDateRange;
  checkpoint?: BankSyncCheckpoint;
  pageBudget?: number;
  fetcher?: typeof fetch;
  now?: number;
  onAccountsDiscovered?: (accounts: AccountBalance[]) => void | Promise<void>;
  onTransactionPage?: (transactions: Transaction[]) => void | Promise<void>;
  collectTransactions?: boolean;
}

export interface RevolutActivityBatchResult {
  accounts: AccountBalance[];
  transactions: Transaction[];
  nextCheckpoint: BankSyncCheckpoint | null;
  complete: boolean;
  pagesFetched: number;
  providerTransactionsRead: number;
}

export interface RevolutTransactionDateRange {
  fromDate: string;
  toDate: string;
}

interface RevolutAuthorizationOptions extends RevolutCredentials {
  authorizationCode: string;
  fetcher?: typeof fetch;
  now?: number;
}

interface RevolutClientAssertionOptions {
  clientId: string;
  issuer: string;
  privateKeyPem: string;
  now?: number;
  cryptoProvider?: Pick<Crypto, "subtle">;
}

interface RevolutTokenResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
}

interface RevolutAccount {
  id: string;
  name?: string;
  balance: number;
  currency: string;
  state: string;
  updated_at: string;
  created_at: string;
}

interface RevolutTransaction {
  id: string;
  type: string;
  request_id?: string;
  state: string;
  created_at: string;
  completed_at?: string;
  reference?: string;
  merchant?: { name?: string; category_code?: string };
  card?: { first_name?: string; last_name?: string; card_number?: string };
  legs: Array<{
    leg_id: string;
    amount: number;
    currency: string;
    account_id: string;
    description?: string;
    counterparty?: { description?: string; account_type?: string };
  }>;
}

interface RevolutPageBoundary {
  transactionIds: readonly string[];
  createdAt: string;
}

interface RevolutPaginationCursor {
  to: string;
  boundary: RevolutPageBoundary;
}

function revolutRecord(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Revolut API response is missing ${field}`);
  }
  return value as Record<string, unknown>;
}

function revolutRequiredString(
  value: unknown,
  field: string,
  maximumLength = maximumRevolutTextLength
): string {
  if (typeof value !== "string") throw new Error(`Revolut API response is missing ${field}`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`Revolut API response is missing ${field}`);
  if (normalized.length > maximumLength) {
    throw new Error(`Revolut API response ${field} exceeds ${maximumLength} characters`);
  }
  return normalized;
}

function revolutOptionalString(
  value: unknown,
  field: string,
  maximumLength = maximumRevolutTextLength
): string | undefined {
  if (value === undefined || value === null) return undefined;
  return revolutRequiredString(value, field, maximumLength);
}

function revolutFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1_000_000_000_000_000) {
    throw new Error(`Revolut API response ${field} must be a finite number within the supported range`);
  }
  return value;
}

function revolutCurrency(value: unknown, field: string): string {
  const currency = revolutRequiredString(value, field, 8);
  if (!/^[A-Z0-9]{3,8}$/.test(currency)) {
    throw new Error(`Revolut API response ${field} is not a supported currency code`);
  }
  return currency;
}

function revolutIsoTimestamp(value: unknown, field: string): string {
  const timestamp = revolutRequiredString(value, field, 64);
  const date = timestamp.slice(0, 10);
  const dateMs = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? Date.parse(`${date}T00:00:00.000Z`)
    : Number.NaN;
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(timestamp)
    || !Number.isFinite(Date.parse(timestamp))
    || !Number.isFinite(dateMs)
    || new Date(dateMs).toISOString().slice(0, 10) !== date
  ) {
    throw new Error(`Revolut API response ${field} is not a valid ISO timestamp`);
  }
  return timestamp;
}

function parseRevolutAccount(value: unknown): RevolutAccount {
  const account = revolutRecord(value, "account");
  return {
    id: revolutRequiredString(account.id, "account.id", maximumRevolutProviderIdLength),
    name: revolutOptionalString(account.name, "account.name", 512),
    balance: revolutFiniteNumber(account.balance, "account.balance"),
    currency: revolutCurrency(account.currency, "account.currency"),
    state: revolutRequiredString(account.state, "account.state", 64),
    updated_at: revolutIsoTimestamp(account.updated_at, "account.updated_at"),
    created_at: revolutIsoTimestamp(account.created_at, "account.created_at")
  };
}

function parseRevolutAccounts(value: unknown): RevolutAccount[] {
  if (!Array.isArray(value)) throw new Error("Revolut API response is missing accounts");
  if (value.length > maximumRevolutAccounts) {
    throw new Error(`Revolut API returned more than ${maximumRevolutAccounts} accounts`);
  }
  const accounts = value.map(parseRevolutAccount);
  if (new Set(accounts.map((account) => account.id)).size !== accounts.length) {
    throw new Error("Revolut API returned duplicate account IDs");
  }
  return accounts;
}

function parseRevolutTransaction(value: unknown): RevolutTransaction {
  const transaction = revolutRecord(value, "transaction");
  const id = revolutRequiredString(
    transaction.id,
    "transaction.id",
    maximumRevolutProviderIdLength
  );
  const state = revolutRequiredString(transaction.state, "transaction.state", 64).toLowerCase();
  if (!(revolutTransactionStates as readonly string[]).includes(state)) {
    throw new Error(`Revolut transaction ${id} has unsupported state ${state}`);
  }
  if (!Array.isArray(transaction.legs) || transaction.legs.length === 0) {
    throw new Error(`Revolut transaction ${id} is missing legs`);
  }
  if (transaction.legs.length > maximumRevolutTransactionLegs) {
    throw new Error(`Revolut transaction ${id} exceeds ${maximumRevolutTransactionLegs} legs`);
  }
  const merchant = transaction.merchant === undefined
    ? undefined
    : revolutRecord(transaction.merchant, `transaction ${id}.merchant`);
  const card = transaction.card === undefined
    ? undefined
    : revolutRecord(transaction.card, `transaction ${id}.card`);
  const legs = transaction.legs.map((rawLeg, index) => {
    const leg = revolutRecord(rawLeg, `transaction ${id}.legs[${index}]`);
    if (typeof leg.leg_id !== "string" || !leg.leg_id.trim()) {
      throw new Error(`Revolut transaction ${id} is missing a stable leg ID`);
    }
    if (typeof leg.account_id !== "string" || !leg.account_id.trim()) {
      throw new Error(`Revolut transaction ${id} is missing a stable account ID`);
    }
    const counterparty = leg.counterparty === undefined
      ? undefined
      : revolutRecord(leg.counterparty, `transaction ${id}.legs[${index}].counterparty`);
    return {
      leg_id: revolutRequiredString(
        leg.leg_id,
        `transaction ${id}.legs[${index}].leg_id`,
        maximumRevolutProviderIdLength
      ),
      amount: revolutFiniteNumber(leg.amount, `transaction ${id}.legs[${index}].amount`),
      currency: revolutCurrency(leg.currency, `transaction ${id}.legs[${index}].currency`),
      account_id: revolutRequiredString(
        leg.account_id,
        `transaction ${id}.legs[${index}].account_id`,
        maximumRevolutProviderIdLength
      ),
      description: revolutOptionalString(
        leg.description,
        `transaction ${id}.legs[${index}].description`
      ),
      ...(counterparty
        ? {
            counterparty: {
              description: revolutOptionalString(
                counterparty.description,
                `transaction ${id}.legs[${index}].counterparty.description`
              ),
              account_type: revolutOptionalString(
                counterparty.account_type,
                `transaction ${id}.legs[${index}].counterparty.account_type`,
                128
              )
            }
          }
        : {})
    };
  });
  return {
    id,
    type: revolutRequiredString(transaction.type, `transaction ${id}.type`, 128),
    request_id: revolutOptionalString(
      transaction.request_id,
      `transaction ${id}.request_id`,
      maximumRevolutProviderIdLength
    ),
    state,
    created_at: revolutIsoTimestamp(transaction.created_at, `transaction ${id}.created_at`),
    completed_at: transaction.completed_at === undefined
      ? undefined
      : revolutIsoTimestamp(transaction.completed_at, `transaction ${id}.completed_at`),
    reference: revolutOptionalString(transaction.reference, `transaction ${id}.reference`),
    ...(merchant
      ? {
          merchant: {
            name: revolutOptionalString(merchant.name, `transaction ${id}.merchant.name`),
            category_code: revolutOptionalString(
              merchant.category_code,
              `transaction ${id}.merchant.category_code`,
              64
            )
          }
        }
      : {}),
    ...(card
      ? {
          card: {
            first_name: revolutOptionalString(card.first_name, `transaction ${id}.card.first_name`, 256),
            last_name: revolutOptionalString(card.last_name, `transaction ${id}.card.last_name`, 256),
            card_number: revolutOptionalString(card.card_number, `transaction ${id}.card.card_number`, 64)
          }
        }
      : {}),
    legs
  };
}

function parseRevolutTransactions(value: unknown): RevolutTransaction[] {
  if (!Array.isArray(value)) throw new Error("Revolut API response is missing transactions");
  if (value.length > revolutTransactionPageSize) {
    throw new Error(`Revolut API returned more than ${revolutTransactionPageSize} transactions`);
  }
  return value.map(parseRevolutTransaction);
}

function appendRevolutTransactionStates(params: URLSearchParams): void {
  for (const state of revolutTransactionStates) params.append("state", state);
}

function revolutEnvironment(value?: string): RevolutEnvironment {
  return value === "sandbox" ? "sandbox" : "production";
}

function revolutBaseUrl(environment?: string): string {
  return revolutBaseUrlByEnvironment[revolutEnvironment(environment)];
}

function requiredCredential(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`Revolut ${name} is required`);
  return normalized;
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

export function parseRevolutTransactionDateRange(
  fromDate?: string | null,
  toDate?: string | null
): RevolutTransactionDateRange | undefined {
  const normalizedFromDate = fromDate?.trim();
  const normalizedToDate = toDate?.trim();
  if (!normalizedFromDate && !normalizedToDate) return undefined;
  if (!normalizedFromDate || !normalizedToDate) {
    throw new Error("Revolut transaction loading requires both a from date and a to date");
  }
  const range = {
    fromDate: requiredIsoDate(normalizedFromDate, "Revolut from date"),
    toDate: requiredIsoDate(normalizedToDate, "Revolut to date")
  };
  if (range.fromDate > range.toDate) {
    throw new Error("Revolut from date must be on or before the to date");
  }
  return range;
}

function revolutDateRange(
  dateRange: RevolutTransactionDateRange | undefined,
  now: number
): { from: string; to: string } {
  if (!dateRange) {
    return {
      from: new Date(now - revolutActivityWindowMs).toISOString(),
      to: new Date(now).toISOString()
    };
  }
  const parsed = parseRevolutTransactionDateRange(dateRange.fromDate, dateRange.toDate);
  if (!parsed) throw new Error("Revolut date range is required");
  return {
    from: `${parsed.fromDate}T00:00:00.000Z`,
    to: `${parsed.toDate}T23:59:59.999Z`
  };
}

function revolutSyncPageBudget(value = revolutDefaultSyncPageBudget): number {
  if (!Number.isInteger(value) || value < 1 || value > revolutMaximumSyncPageBudget) {
    throw new Error(
      `Revolut sync page budget must be an integer from 1 to ${revolutMaximumSyncPageBudget}`
    );
  }
  return value;
}

function revolutCursorTimestamp(value: string): string {
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)
    || !Number.isFinite(Date.parse(value))
  ) {
    throw new Error("Revolut transaction pagination returned an invalid created_at cursor");
  }
  return value;
}

function encodeRevolutPaginationCursor(boundary: RevolutPageBoundary): string {
  return JSON.stringify({
    v: 1,
    to: revolutCursorTimestamp(boundary.createdAt),
    boundaryTransactionIds: boundary.transactionIds
  });
}

function decodeRevolutPaginationCursor(value: string): RevolutPaginationCursor {
  let decoded: unknown;
  try {
    decoded = JSON.parse(value) as unknown;
  } catch {
    throw new Error("Revolut sync checkpoint cursor is invalid");
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) {
    throw new Error("Revolut sync checkpoint cursor is invalid");
  }
  const record = decoded as Record<string, unknown>;
  const boundaryTransactionIds = record.boundaryTransactionIds;
  if (
    record.v !== 1
    || typeof record.to !== "string"
    || !Array.isArray(boundaryTransactionIds)
    || boundaryTransactionIds.length < 1
    || boundaryTransactionIds.length > revolutSyncTransactionPageSize
    || boundaryTransactionIds.some((id) =>
      typeof id !== "string" || !id.trim() || id.length > 1_024
    )
    || new Set(boundaryTransactionIds).size !== boundaryTransactionIds.length
  ) {
    throw new Error("Revolut sync checkpoint cursor is invalid");
  }
  const to = revolutCursorTimestamp(record.to);
  return {
    to,
    boundary: { transactionIds: boundaryTransactionIds as string[], createdAt: to }
  };
}

function nextRevolutPageBoundary(
  rows: readonly RevolutTransaction[],
  currentTo: string
): RevolutPageBoundary {
  const lastRow = rows.at(-1);
  const createdAt = revolutCursorTimestamp(lastRow?.created_at ?? "");
  if (Date.parse(createdAt) >= Date.parse(currentTo)) {
    throw new Error("Revolut transaction pagination did not advance to an older created_at cursor");
  }
  return {
    transactionIds: rows
      .filter((row) => row.created_at === createdAt)
      .map((row) => row.id),
    createdAt
  };
}

function normalizeRevolutTransactionPage(
  rows: readonly RevolutTransaction[],
  currentTo: string,
  previousBoundary: RevolutPageBoundary | undefined,
  seenProviderTransactionIds: Set<string>,
  accountById: ReadonlyMap<string, RevolutAccount>
): Transaction[] {
  const boundaryTransactionIds = new Set(previousBoundary?.transactionIds ?? []);
  const consumedBoundaryTransactionIds = new Set<string>();
  return rows.flatMap((row) => {
    if (!seenProviderTransactionIds.has(row.id)) {
      seenProviderTransactionIds.add(row.id);
      return normalizeRevolutTransaction(row, accountById);
    }

    const isInclusiveBoundaryRepeat = previousBoundary?.createdAt === row.created_at
      && row.created_at === currentTo
      && boundaryTransactionIds.has(row.id)
      && !consumedBoundaryTransactionIds.has(row.id);
    if (isInclusiveBoundaryRepeat) {
      consumedBoundaryTransactionIds.add(row.id);
      return [];
    }

    throw new Error(`Revolut API repeated transaction ${row.id} outside the inclusive cursor boundary`);
  });
}

function normalizedIssuer(value: string): string {
  const issuer = requiredCredential(value, "issuer");
  if (issuer.includes("://") || issuer.includes("/") || !/^[a-z0-9.-]+(?::\d+)?$/i.test(issuer)) {
    throw new Error("Revolut issuer must be the OAuth redirect domain without https:// or a path");
  }
  return issuer;
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlJson(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function pkcs8Bytes(privateKeyPem: string): ArrayBuffer {
  const normalized = privateKeyPem.trim();
  if (/-----BEGIN RSA PRIVATE KEY-----/.test(normalized)) {
    throw new Error(
      "Revolut private key must use PKCS#8 (BEGIN PRIVATE KEY), not PKCS#1 (BEGIN RSA PRIVATE KEY)"
    );
  }
  const match = normalized.match(/-----BEGIN PRIVATE KEY-----([\s\S]+)-----END PRIVATE KEY-----/);
  if (!match) {
    throw new Error("Revolut private key must be a complete PKCS#8 PEM");
  }
  const binary = atob(match[1].replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

export async function createRevolutClientAssertion({
  clientId,
  issuer,
  privateKeyPem,
  now = Date.now(),
  cryptoProvider = globalThis.crypto
}: RevolutClientAssertionOptions): Promise<string> {
  const normalizedClientId = requiredCredential(clientId, "client ID");
  const normalizedPrivateKey = requiredCredential(privateKeyPem, "private key");
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const payload = base64UrlJson({
    iss: normalizedIssuer(issuer),
    sub: normalizedClientId,
    aud: revolutAudience,
    exp: Math.floor(now / 1000) + 300
  });
  const signingInput = `${header}.${payload}`;
  const key = await cryptoProvider.subtle.importKey(
    "pkcs8",
    pkcs8Bytes(normalizedPrivateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await cryptoProvider.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}

export function revolutReadConsentUrl({
  environment,
  clientId,
  redirectUri
}: {
  environment?: string;
  clientId: string;
  redirectUri: string;
}): string {
  const url = new URL(revolutConsentUrlByEnvironment[revolutEnvironment(environment)]);
  url.searchParams.set("client_id", requiredCredential(clientId, "client ID"));
  url.searchParams.set("redirect_uri", requiredCredential(redirectUri, "redirect URI"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "READ");
  return url.toString();
}

async function boundedErrorText(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (text.length < 4096) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return text.replace(/\s+/g, " ").trim().slice(0, 500);
}

async function fetchRevolutJson<T>(fetcher: typeof fetch, url: string, init: RequestInit): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const response = await fetchBankProvider(fetcher, url, init, {
    provider: "Revolut",
    ...(method === "GET" || method === "HEAD" ? {} : bankProviderOAuthFetchPolicy)
  });
  if (!response.ok) {
    const detail = await boundedErrorText(response);
    throw new Error(
      `Revolut API request failed (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
    );
  }
  return readBoundedResponseJson<T>(response, "Revolut");
}

async function clientAssertion(credentials: RevolutCredentials, now: number): Promise<string> {
  return createRevolutClientAssertion({
    clientId: requiredCredential(credentials.clientId, "client ID"),
    issuer: requiredCredential(credentials.issuer, "issuer"),
    privateKeyPem: requiredCredential(credentials.privateKeyPem, "private key"),
    now
  });
}

export async function exchangeRevolutAuthorizationCode({
  environment,
  clientId,
  issuer,
  privateKeyPem,
  authorizationCode,
  fetcher = fetch,
  now = Date.now()
}: RevolutAuthorizationOptions): Promise<{ accessToken: string; refreshToken: string }> {
  const assertion = await clientAssertion({ clientId, issuer, privateKeyPem }, now);
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: requiredCredential(authorizationCode, "authorization code"),
    client_assertion_type: revolutClientAssertionType,
    client_assertion: assertion
  });
  const response = await fetchRevolutJson<RevolutTokenResponse>(
    fetcher,
    `${revolutBaseUrl(environment)}/auth/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    }
  );
  if (!response.access_token || !response.refresh_token) {
    throw new Error("Revolut authorization response did not include access_token and refresh_token");
  }
  return { accessToken: response.access_token, refreshToken: response.refresh_token };
}

async function fetchRevolutAccessToken(
  credentials: RevolutCredentials & { refreshToken: string; fetcher: typeof fetch; now: number }
): Promise<string> {
  const assertion = await clientAssertion(credentials, credentials.now);
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: requiredCredential(credentials.refreshToken, "refresh token"),
    client_assertion_type: revolutClientAssertionType,
    client_assertion: assertion
  });
  const response = await fetchRevolutJson<RevolutTokenResponse>(
    credentials.fetcher,
    `${revolutBaseUrl(credentials.environment)}/auth/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    }
  );
  if (!response.access_token) {
    throw new Error("Revolut token response did not include access_token");
  }
  return response.access_token;
}

async function fetchRevolutTransactions({
  baseUrl,
  headers,
  fetcher,
  from,
  to,
  accountById,
  onTransactionPage,
  collectTransactions
}: {
  baseUrl: string;
  headers: HeadersInit;
  fetcher: typeof fetch;
  from: string;
  to: string;
  accountById: ReadonlyMap<string, RevolutAccount>;
  onTransactionPage?: (transactions: Transaction[]) => void | Promise<void>;
  collectTransactions: boolean;
}): Promise<Transaction[]> {
  const transactions: Transaction[] = [];
  const seenTransactionIds = new Set<string>();
  let pageTo = to;
  let previousBoundary: RevolutPageBoundary | undefined;

  for (let page = 0; page < maxRevolutTransactionPages; page += 1) {
    const params = new URLSearchParams({
      from,
      to: pageTo,
      count: String(revolutTransactionPageSize)
    });
    appendRevolutTransactionStates(params);
    const rows = parseRevolutTransactions(await fetchRevolutJson<unknown>(
      fetcher,
      `${baseUrl}/transactions?${params.toString()}`,
      { headers }
    ));
    const nextBoundary = rows.length === revolutTransactionPageSize
      ? nextRevolutPageBoundary(rows, pageTo)
      : undefined;
    const normalizedPage = normalizeRevolutTransactionPage(
      rows,
      pageTo,
      previousBoundary,
      seenTransactionIds,
      accountById
    );

    if (collectTransactions) transactions.push(...normalizedPage);
    if (normalizedPage.length > 0 && onTransactionPage) {
      await onTransactionPage(normalizedPage);
    }
    if (rows.length < revolutTransactionPageSize) return transactions;

    previousBoundary = nextBoundary;
    pageTo = nextBoundary!.createdAt;
  }

  throw new Error(`Revolut transaction pagination exceeded ${maxRevolutTransactionPages} pages`);
}

function revolutStatus(state: string): Transaction["status"] {
  const normalizedState = state.trim().toLowerCase();
  if (normalizedState === "created" || normalizedState === "pending") return "pending";
  if (normalizedState === "declined" || normalizedState === "failed" || normalizedState === "reverted") {
    return "voided";
  }
  if (normalizedState === "completed") return "posted";
  throw new Error(`Revolut transaction has unsupported state ${normalizedState}`);
}

function revolutCounterparty(activity: RevolutTransaction, leg: RevolutTransaction["legs"][number]): string {
  const cardholder = [activity.card?.first_name, activity.card?.last_name].filter(Boolean).join(" ").trim();
  return (
    activity.merchant?.name ||
    leg.counterparty?.description ||
    leg.description ||
    activity.reference ||
    cardholder ||
    activity.request_id ||
    activity.type ||
    "Revolut transaction"
  );
}

function normalizeRevolutTransaction(
  activity: RevolutTransaction,
  accountById: ReadonlyMap<string, RevolutAccount>
): Transaction[] {
  if (!activity.id?.trim()) throw new Error("Revolut transaction is missing its provider ID");
  if (!Array.isArray(activity.legs)) throw new Error(`Revolut transaction ${activity.id} is missing legs`);
  return activity.legs.map((leg, index) => {
    const legId = leg.leg_id?.trim();
    if (!legId) throw new Error(`Revolut transaction ${activity.id} is missing a stable leg ID`);
    const accountId = leg.account_id?.trim();
    if (!accountId) throw new Error(`Revolut transaction ${activity.id} is missing a stable account ID`);
    const account = accountById.get(accountId);
    if (!account) {
      throw new Error(`Revolut transaction ${activity.id} references unknown account ${accountId}`);
    }
    const counterparty = revolutCounterparty(activity, leg);
    const status = revolutStatus(activity.state);
    return {
      id: bankProviderTransactionId("revolut", [activity.id, legId, accountId]),
      providerLegacyId: `revolut-${activity.id}-${legId}-${index}`,
      source: "revolut",
      accountId: `revolut-${accountId}`,
      accountName: account.name || `Revolut ${account.currency}`,
      date: (activity.completed_at || activity.created_at).slice(0, 10),
      description: activity.reference || activity.type || counterparty,
      rawName: counterparty,
      counterparty,
      amount: Math.abs(leg.amount),
      currency: leg.currency,
      direction: leg.amount >= 0 ? "in" : "out",
      status,
      category: "Revolut",
      ...(status === "voided" ? { classificationComplete: true } : {})
    };
  });
}

async function fetchBoundedRevolutTransactions({
  baseUrl,
  headers,
  fetcher,
  windowStart,
  windowEnd,
  cursorTo,
  cursorBoundary,
  accountById,
  pageBudget,
  onTransactionPage,
  collectTransactions
}: {
  baseUrl: string;
  headers: HeadersInit;
  fetcher: typeof fetch;
  windowStart: string;
  windowEnd: string;
  cursorTo: string;
  cursorBoundary?: RevolutPageBoundary;
  accountById: ReadonlyMap<string, RevolutAccount>;
  pageBudget: number;
  onTransactionPage?: (transactions: Transaction[]) => void | Promise<void>;
  collectTransactions: boolean;
}): Promise<Omit<RevolutActivityBatchResult, "accounts">> {
  const transactions: Transaction[] = [];
  const seenProviderTransactionIds = new Set<string>();
  let currentTo = cursorTo;
  let previousBoundary = cursorBoundary;
  if (previousBoundary) {
    for (const transactionId of previousBoundary.transactionIds) {
      seenProviderTransactionIds.add(transactionId);
    }
  }
  let pagesFetched = 0;
  let providerTransactionsRead = 0;

  for (let pageNumber = 0; pageNumber < pageBudget; pageNumber += 1) {
    const params = new URLSearchParams({
      from: windowStart,
      to: currentTo,
      count: String(revolutSyncTransactionPageSize)
    });
    appendRevolutTransactionStates(params);
    const rows = parseRevolutTransactions(await fetchRevolutJson<unknown>(
      fetcher,
      `${baseUrl}/transactions?${params.toString()}`,
      { headers }
    ));
    pagesFetched += 1;
    providerTransactionsRead += rows.length;
    if (rows.length > revolutSyncTransactionPageSize) {
      throw new Error("Revolut API returned more transactions than the requested page size");
    }
    const nextBoundary = rows.length === revolutSyncTransactionPageSize
      ? nextRevolutPageBoundary(rows, currentTo)
      : undefined;
    const normalizedPage = normalizeRevolutTransactionPage(
      rows,
      currentTo,
      previousBoundary,
      seenProviderTransactionIds,
      accountById
    );

    if (collectTransactions) transactions.push(...normalizedPage);
    if (normalizedPage.length > 0 && onTransactionPage) {
      await onTransactionPage(normalizedPage);
    }
    if (rows.length < revolutSyncTransactionPageSize) {
      return {
        transactions,
        nextCheckpoint: null,
        complete: true,
        pagesFetched,
        providerTransactionsRead
      };
    }

    previousBoundary = nextBoundary;
    currentTo = nextBoundary!.createdAt;
  }

  return {
    transactions,
    nextCheckpoint: encodeBankSyncCheckpoint({
      provider: "revolut",
      windowStart,
      windowEnd,
      cursor: encodeRevolutPaginationCursor(previousBoundary!)
    }),
    complete: false,
    pagesFetched,
    providerTransactionsRead
  };
}

export async function fetchRevolutActivityBatch({
  environment,
  clientId,
  issuer,
  privateKeyPem,
  refreshToken,
  dateRange,
  checkpoint,
  pageBudget,
  fetcher = fetch,
  now = Date.now(),
  onAccountsDiscovered,
  onTransactionPage,
  collectTransactions = true
}: RevolutActivityBatchOptions): Promise<RevolutActivityBatchResult> {
  if (checkpoint && dateRange) {
    throw new Error("Revolut sync accepts either a date range or a checkpoint, not both");
  }
  const budget = revolutSyncPageBudget(pageBudget);
  const decodedCheckpoint = checkpoint
    ? decodeBankSyncCheckpoint(checkpoint, "revolut")
    : undefined;
  const interval = decodedCheckpoint
    ? { from: decodedCheckpoint.windowStart, to: decodedCheckpoint.windowEnd }
    : revolutDateRange(dateRange, now);
  const paginationCursor = decodedCheckpoint
    ? decodeRevolutPaginationCursor(decodedCheckpoint.cursor)
    : undefined;
  const cursorTo = paginationCursor?.to ?? interval.to;
  if (
    Date.parse(cursorTo) < Date.parse(interval.from)
    || Date.parse(cursorTo) > Date.parse(interval.to)
  ) {
    throw new Error("Revolut sync checkpoint cursor is outside its transaction window");
  }

  const accessToken = await fetchRevolutAccessToken({
    environment,
    clientId: requiredCredential(clientId, "client ID"),
    issuer: requiredCredential(issuer, "issuer"),
    privateKeyPem: requiredCredential(privateKeyPem, "private key"),
    refreshToken: requiredCredential(refreshToken, "refresh token"),
    fetcher,
    now
  });
  const baseUrl = revolutBaseUrl(environment);
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json"
  };
  const revolutAccounts = parseRevolutAccounts(await fetchRevolutJson<unknown>(
    fetcher,
    `${baseUrl}/accounts`,
    { headers }
  ));
  const accountById = new Map(revolutAccounts.map((account) => [account.id, account]));
  const accounts: AccountBalance[] = revolutAccounts.map((account) => ({
    id: `revolut-${account.id}`,
    name: account.name || `Revolut ${account.currency}`,
    source: "revolut",
    balance: account.balance,
    currency: account.currency,
    updatedAt: account.updated_at || account.created_at,
    status: "live"
  }));
  if (onAccountsDiscovered) await onAccountsDiscovered(accounts);
  const result = await fetchBoundedRevolutTransactions({
    baseUrl,
    headers,
    fetcher,
    windowStart: interval.from,
    windowEnd: interval.to,
    cursorTo,
    cursorBoundary: paginationCursor?.boundary,
    accountById,
    pageBudget: budget,
    onTransactionPage,
    collectTransactions
  });
  return { accounts, ...result };
}

export async function fetchRevolutActivity({
  environment,
  clientId,
  issuer,
  privateKeyPem,
  refreshToken,
  dateRange,
  fetcher = fetch,
  now = Date.now(),
  onTransactionPage,
  collectTransactions = true
}: RevolutActivityOptions): Promise<{ accounts: AccountBalance[]; transactions: Transaction[] }> {
  if (![clientId, issuer, privateKeyPem, refreshToken].every((value) => value?.trim())) {
    return { accounts: [], transactions: [] };
  }

  const accessToken = await fetchRevolutAccessToken({
    environment,
    clientId,
    issuer,
    privateKeyPem,
    refreshToken: refreshToken!,
    fetcher,
    now
  });
  const baseUrl = revolutBaseUrl(environment);
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json"
  };
  const interval = revolutDateRange(dateRange, now);
  const revolutAccounts = parseRevolutAccounts(await fetchRevolutJson<unknown>(
    fetcher,
    `${baseUrl}/accounts`,
    { headers }
  ));
  const accountById = new Map(revolutAccounts.map((account) => [account.id, account]));
  const accounts: AccountBalance[] = revolutAccounts.map((account) => ({
    id: `revolut-${account.id}`,
    name: account.name || `Revolut ${account.currency}`,
    source: "revolut",
    balance: account.balance,
    currency: account.currency,
    updatedAt: account.updated_at || account.created_at,
    status: "live"
  }));
  const transactions = await fetchRevolutTransactions({
    baseUrl,
    headers,
    fetcher,
    from: interval.from,
    to: interval.to,
    accountById,
    onTransactionPage,
    collectTransactions
  });

  return { accounts, transactions };
}
