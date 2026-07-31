import type { AccountBalance, Transaction, WiseEntity } from "./types";
import { requireWiseEntityFromAccountName } from "./wiseEntities";
import { wiseTransactionId } from "./wiseTransactionIdentity";
import {
  decodeBankSyncCheckpoint,
  encodeBankSyncCheckpoint,
  type BankSyncCheckpoint
} from "./bankSyncCheckpoint";
import { fetchBankProvider, readBoundedResponseText } from "./boundedHttp";

const wiseDefaultActivityWindowDays = 45;
const wiseActivityWindowMs = 1000 * 60 * 60 * 24 * wiseDefaultActivityWindowDays;
const wiseStatementIntervalMs = 1000 * 60 * 60 * 24;
const maximumWiseCheckpointBalances = 100;
const maximumWiseProfiles = 1_000;
const maximumWiseBalancesPerProfile = 1_000;
const maximumWiseStatementTransactions = 10_000;
const maximumWiseProviderIdLength = 512;
const maximumWiseTextLength = 1_024;
export const wiseDefaultSyncPageBudget = 5;
export const wiseMaximumSyncPageBudget = 10;

export interface WiseActivityResult {
  accounts: AccountBalance[];
  transactions: Transaction[];
  statementIssues: string[];
  balanceIssue?: string;
}

interface WiseBusinessProfile {
  id: number;
  type: "BUSINESS";
  businessName: string;
}

interface WisePersonalProfile {
  id: number;
  type: "PERSONAL";
}

type WiseProfile = WiseBusinessProfile | WisePersonalProfile;

interface WiseBalance {
  id: number;
  currency: string;
  amount: { value: number; currency: string };
  modificationTime: string;
  visible?: boolean;
}

interface WiseStatementActivity {
  id?: string | number;
  referenceNumber?: string;
  date: string;
  type: string;
  details?: {
    description?: string;
    senderName?: string;
    recipientName?: string;
    referenceNumber?: string;
  };
  amount: { value: number; currency: string };
}

interface WiseBalanceApiOptions {
  baseUrl: string;
  token: string;
  profileIds: ReadonlySet<number>;
  fetcher?: typeof fetch;
}

export interface WiseTransactionDateRange {
  fromDate: string;
  toDate: string;
}

export interface WiseActivityBatchOptions {
  baseUrl: string;
  token: string;
  profileIds: ReadonlySet<number>;
  dateRange?: WiseTransactionDateRange;
  checkpoint?: BankSyncCheckpoint;
  pageBudget?: number;
  fetcher?: typeof fetch;
  now?: number;
  onAccountsDiscovered?: (accounts: AccountBalance[]) => void | Promise<void>;
  onTransactionPage?: (transactions: Transaction[]) => void | Promise<void>;
  collectTransactions?: boolean;
}

export interface WiseActivityBatchResult extends WiseActivityResult {
  nextCheckpoint: BankSyncCheckpoint | null;
  complete: boolean;
  pagesFetched: number;
  providerTransactionsRead: number;
}

interface ProfileBalance {
  profile: WiseBusinessProfile;
  profileName: string;
  wiseEntity: WiseEntity;
  balance: WiseBalance;
}

interface WiseCheckpointCursor {
  balanceKeys: string[];
  balanceIndex: number;
  intervalStart: string;
}

function wiseRecord(value: unknown, field: string, statement = false): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      statement
        ? `Wise statement transaction ${field} is invalid`
        : `Wise API response is missing ${field}`
    );
  }
  return value as Record<string, unknown>;
}

function wiseRequiredString(
  value: unknown,
  field: string,
  maximumLength = maximumWiseTextLength,
  statement = false
): string {
  const prefix = statement ? "Wise statement transaction" : "Wise API response";
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${prefix} ${field} is missing or invalid`);
  }
  const normalized = value.trim();
  if (normalized.length > maximumLength) {
    throw new Error(`${prefix} ${field} exceeds ${maximumLength} characters`);
  }
  return normalized;
}

function wiseOptionalString(
  value: unknown,
  field: string,
  maximumLength = maximumWiseTextLength,
  statement = false
): string | undefined {
  if (value === undefined || value === null) return undefined;
  return wiseRequiredString(value, field, maximumLength, statement);
}

function wiseFiniteNumber(value: unknown, field: string, statement = false): number {
  const prefix = statement ? "Wise statement transaction" : "Wise API response";
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1_000_000_000_000_000) {
    throw new Error(`${prefix} ${field} must be a finite number within the supported range`);
  }
  return value;
}

function wiseCurrency(value: unknown, field: string, statement = false): string {
  const prefix = statement ? "Wise statement transaction" : "Wise API response";
  const currency = wiseRequiredString(value, field, 8, statement);
  if (!/^[A-Z0-9]{3,8}$/.test(currency)) {
    throw new Error(`${prefix} ${field} is not a supported currency code`);
  }
  return currency;
}

function wiseIsoDate(value: unknown, field: string, statement = false): string {
  const prefix = statement ? "Wise statement transaction" : "Wise API response";
  const timestamp = wiseRequiredString(value, field, 64, statement);
  const date = timestamp.slice(0, 10);
  const dateMs = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? Date.parse(`${date}T00:00:00.000Z`)
    : Number.NaN;
  const isIso = /^\d{4}-\d{2}-\d{2}$/.test(timestamp)
    || /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(timestamp);
  if (
    !isIso
    || !Number.isFinite(Date.parse(timestamp))
    || !Number.isFinite(dateMs)
    || new Date(dateMs).toISOString().slice(0, 10) !== date
  ) {
    throw new Error(`${prefix} ${field} is not a valid ISO date`);
  }
  return timestamp;
}

function positiveWiseId(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Wise API response ${field} must be a positive integer`);
  }
  return value;
}

function parseWiseProfiles(value: unknown): WiseProfile[] {
  if (!Array.isArray(value)) throw new Error("Wise API response is missing profiles");
  if (value.length > maximumWiseProfiles) {
    throw new Error(`Wise API returned more than ${maximumWiseProfiles} profiles`);
  }
  const profiles = value.map((rawProfile): WiseProfile => {
    const profile = wiseRecord(rawProfile, "profile");
    const id = positiveWiseId(profile.id, "profile.id");
    const type = wiseRequiredString(profile.type, `profile ${id}.type`, 32);
    if (type === "PERSONAL") return { id, type };
    if (type !== "BUSINESS") {
      throw new Error(`Wise API response profile ${id}.type is unsupported`);
    }
    return {
      id,
      type,
      businessName: wiseRequiredString(profile.businessName, `profile ${id}.businessName`, 512)
    };
  });
  if (new Set(profiles.map((profile) => profile.id)).size !== profiles.length) {
    throw new Error("Wise API returned duplicate profile IDs");
  }
  return profiles;
}

function parseWiseBalances(value: unknown, profileId: number): WiseBalance[] {
  if (!Array.isArray(value)) throw new Error(`Wise API response is missing balances for profile ${profileId}`);
  if (value.length > maximumWiseBalancesPerProfile) {
    throw new Error(
      `Wise API returned more than ${maximumWiseBalancesPerProfile} balances for profile ${profileId}`
    );
  }
  const balances = value.map((rawBalance): WiseBalance => {
    const balance = wiseRecord(rawBalance, `balance for profile ${profileId}`);
    const id = positiveWiseId(balance.id, `profile ${profileId} balance.id`);
    const currency = wiseCurrency(balance.currency, `balance ${id}.currency`);
    const amount = wiseRecord(balance.amount, `balance ${id}.amount`);
    const amountCurrency = wiseCurrency(amount.currency, `balance ${id}.amount.currency`);
    if (amountCurrency !== currency) {
      throw new Error(`Wise API response balance ${id} amount currency does not match its balance currency`);
    }
    if (balance.visible !== undefined && typeof balance.visible !== "boolean") {
      throw new Error(`Wise API response balance ${id}.visible must be a boolean`);
    }
    return {
      id,
      currency,
      amount: {
        value: wiseFiniteNumber(amount.value, `balance ${id}.amount.value`),
        currency: amountCurrency
      },
      modificationTime: wiseIsoDate(balance.modificationTime, `balance ${id}.modificationTime`),
      ...(balance.visible === undefined ? {} : { visible: balance.visible })
    };
  });
  if (new Set(balances.map((balance) => balance.id)).size !== balances.length) {
    throw new Error(`Wise API returned duplicate balance IDs for profile ${profileId}`);
  }
  return balances;
}

function parseWiseStatementActivities(value: unknown): WiseStatementActivity[] {
  const statement = wiseRecord(value, "statement response");
  if (!Array.isArray(statement.transactions)) {
    throw new Error("Wise statement transaction list is missing or invalid");
  }
  if (statement.transactions.length > maximumWiseStatementTransactions) {
    throw new Error(
      `Wise statement transaction list exceeds ${maximumWiseStatementTransactions} records`
    );
  }
  return statement.transactions.map((rawActivity, index): WiseStatementActivity => {
    const activity = wiseRecord(rawActivity, `[${index}]`, true);
    const referenceNumber = stableWiseIdentifier(activity.referenceNumber, "referenceNumber");
    const providerId = stableWiseIdentifier(activity.id, "id");
    if (!referenceNumber && !providerId) {
      throw new Error("Wise statement transaction is missing a stable provider reference or ID");
    }
    const details = activity.details === undefined
      ? undefined
      : wiseRecord(activity.details, "details", true);
    const amount = wiseRecord(activity.amount, "amount", true);
    return {
      ...(providerId === undefined ? {} : { id: providerId }),
      ...(referenceNumber === undefined ? {} : { referenceNumber }),
      date: wiseIsoDate(activity.date, "date", true),
      type: wiseRequiredString(activity.type, "type", 128, true),
      ...(details
        ? {
            details: {
              description: wiseOptionalString(details.description, "details.description", 1_024, true),
              senderName: wiseOptionalString(details.senderName, "details.senderName", 512, true),
              recipientName: wiseOptionalString(details.recipientName, "details.recipientName", 512, true),
              referenceNumber: stableWiseIdentifier(details.referenceNumber, "details.referenceNumber")
            }
          }
        : {}),
      amount: {
        value: wiseFiniteNumber(amount.value, "amount.value", true),
        currency: wiseCurrency(amount.currency, "amount.currency", true)
      }
    };
  });
}

async function fetchJson<T>(fetcher: typeof fetch, url: string, init: RequestInit): Promise<T> {
  const response = await fetchBankProvider(fetcher, url, init, { provider: "Wise" });
  const text = await readBoundedResponseText(response, "Wise");
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

function businessProfileName(profile: WiseBusinessProfile): string {
  const name = profile.businessName.trim();
  if (!name) throw new Error(`Wise business profile ${profile.id} did not include a company name`);
  return name;
}

function accountName(profileName: string, currency: string): string {
  return `${profileName} · Wise ${currency}`;
}

function requiredIsoDate(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${field} must use YYYY-MM-DD`);
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new Error(`${field} is not a valid date`);
  }
  return value;
}

export function parseWiseTransactionDateRange(
  fromDate?: string | null,
  toDate?: string | null
): WiseTransactionDateRange | undefined {
  const normalizedFromDate = fromDate?.trim();
  const normalizedToDate = toDate?.trim();
  if (!normalizedFromDate && !normalizedToDate) return undefined;
  if (!normalizedFromDate || !normalizedToDate) {
    throw new Error("Wise transaction loading requires both a from date and a to date");
  }
  const range = {
    fromDate: requiredIsoDate(normalizedFromDate, "Wise from date"),
    toDate: requiredIsoDate(normalizedToDate, "Wise to date")
  };
  if (range.fromDate > range.toDate) throw new Error("Wise from date must be on or before the to date");
  return range;
}

function wiseTransactionWindow(
  dateRange: WiseTransactionDateRange | undefined,
  now: number
): { windowStart: string; windowEnd: string } {
  const validated = dateRange
    ? parseWiseTransactionDateRange(dateRange.fromDate, dateRange.toDate)
    : undefined;
  return validated
    ? {
        windowStart: `${validated.fromDate}T00:00:00.000Z`,
        windowEnd: `${validated.toDate}T23:59:59.999Z`
      }
    : {
        windowStart: new Date(now - wiseActivityWindowMs).toISOString(),
        windowEnd: new Date(now).toISOString()
      };
}

function wiseSyncPageBudget(value = wiseDefaultSyncPageBudget): number {
  if (!Number.isInteger(value) || value < 1 || value > wiseMaximumSyncPageBudget) {
    throw new Error(`Wise sync page budget must be an integer from 1 to ${wiseMaximumSyncPageBudget}`);
  }
  return value;
}

function profileBalanceKey({ profile, balance }: ProfileBalance): string {
  return `${profile.id}:${balance.id}:${balance.currency}`;
}

function sortedProfileBalances(profileBalances: ProfileBalance[]): ProfileBalance[] {
  return [...profileBalances].sort(
    (left, right) =>
      left.profile.id - right.profile.id
      || left.balance.id - right.balance.id
      || left.balance.currency.localeCompare(right.balance.currency)
  );
}

function profileBalanceAccounts(profileBalances: ProfileBalance[]): AccountBalance[] {
  return profileBalances.map(({ profile, profileName, wiseEntity, balance }) => ({
    id: `wise-${profile.id}-${balance.id}`,
    name: accountName(profileName, balance.currency),
    source: "wise" as const,
    wiseEntity,
    balance: balance.amount.value,
    currency: balance.amount.currency,
    updatedAt: balance.modificationTime,
    status: "live" as const
  }));
}

async function fetchWiseProfileBalances(
  baseUrl: string,
  token: string,
  profileIds: ReadonlySet<number>,
  fetcher: typeof fetch
): Promise<ProfileBalance[]> {
  const headers = { Authorization: `Bearer ${token}` };
  const profiles = parseWiseProfiles(await fetchJson<unknown>(
    fetcher,
    `${baseUrl}/v2/profiles`,
    { headers }
  ));
  const businessProfiles = profiles.filter(
    (profile): profile is WiseBusinessProfile => profile.type === "BUSINESS" && profileIds.has(profile.id)
  );
  const missingProfileIds = [...profileIds].filter(
    (profileId) => !businessProfiles.some((profile) => profile.id === profileId)
  );
  if (missingProfileIds.length > 0) {
    throw new Error(`Wise API token cannot access configured business profile IDs: ${missingProfileIds.join(", ")}`);
  }
  const balancesByProfile = await Promise.all(
    businessProfiles.map(async (profile) => {
      const profileName = businessProfileName(profile);
      const wiseEntity = requireWiseEntityFromAccountName(profileName);
      const balances = parseWiseBalances(await fetchJson<unknown>(
        fetcher,
        `${baseUrl}/v4/profiles/${profile.id}/balances?types=STANDARD,SAVINGS`,
        { headers }
      ), profile.id);
      return balances
        .filter((balance) => balance.visible !== false)
        .map((balance) => ({ profile, profileName, wiseEntity, balance }));
    })
  );
  return sortedProfileBalances(balancesByProfile.flat());
}

function stableWiseIdentifier(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === "string" && value.trim() && value.length <= 512) return value.trim();
  throw new Error(`Wise statement transaction ${field} is invalid`);
}

export function wiseStatementTransactionReference(activity: unknown): string {
  if (!activity || typeof activity !== "object" || Array.isArray(activity)) {
    throw new Error("Wise statement transaction must be an object");
  }
  const record = activity as Record<string, unknown>;
  const referenceNumber = stableWiseIdentifier(record.referenceNumber, "referenceNumber");
  const providerId = stableWiseIdentifier(record.id, "id");
  const identifier = referenceNumber ?? providerId;
  if (!identifier) {
    throw new Error("Wise statement transaction is missing a stable provider reference or ID");
  }
  return identifier;
}

function normalizeWiseStatementTransactions(
  activities: WiseStatementActivity[],
  profileBalance: ProfileBalance
): Transaction[] {
  const { profile, profileName, wiseEntity, balance } = profileBalance;
  const seenTransactionIds = new Set<string>();
  return activities.map((activity): Transaction => {
    const value = activity.amount.value;
    if (activity.amount.currency !== balance.currency) {
      throw new Error(
        `Wise statement transaction amount.currency ${activity.amount.currency} does not match balance currency ${balance.currency}`
      );
    }
    const counterparty =
      activity.details?.senderName
      || activity.details?.recipientName
      || activity.details?.description
      || activity.type;
    const referenceNumber = stableWiseIdentifier(activity.referenceNumber, "referenceNumber");
    const providerId = stableWiseIdentifier(activity.id, "id");
    if (!referenceNumber && !providerId) {
      throw new Error("Wise statement transaction is missing a stable provider reference or ID");
    }
    const id = wiseTransactionId(balance.id, referenceNumber ?? providerId!);
    if (seenTransactionIds.has(id)) {
      throw new Error(`Wise statement repeated stable transaction identifier ${id}`);
    }
    seenTransactionIds.add(id);
    return {
      id,
      ...(stableWiseIdentifier(activity.details?.referenceNumber, "details.referenceNumber")
        ? {
            providerLegacyId: `wise-${profile.id}-${balance.id}-${
              stableWiseIdentifier(activity.details?.referenceNumber, "details.referenceNumber")
            }`
          }
        : {}),
      source: "wise",
      wiseEntity,
      accountId: `wise-${profile.id}-${balance.id}`,
      accountName: accountName(profileName, balance.currency),
      date: activity.date.slice(0, 10),
      description: activity.details?.description ?? activity.type,
      rawName: counterparty,
      counterparty,
      amount: Math.abs(value),
      currency: activity.amount.currency,
      direction: value >= 0 ? "in" : "out",
      status: "posted",
      category: activity.type
    };
  });
}

function encodeWiseCheckpointCursor(cursor: WiseCheckpointCursor): string {
  return JSON.stringify({
    v: 1,
    balanceKeys: cursor.balanceKeys,
    balanceIndex: cursor.balanceIndex,
    intervalStart: cursor.intervalStart
  });
}

function decodeWiseCheckpointCursor(
  value: string,
  windowStart: string,
  windowEnd: string
): WiseCheckpointCursor {
  let payload: unknown;
  try {
    payload = JSON.parse(value) as unknown;
  } catch {
    throw new Error("Wise sync checkpoint cursor is invalid");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Wise sync checkpoint cursor is invalid");
  }
  const record = payload as Record<string, unknown>;
  const intervalStart = typeof record.intervalStart === "string" ? record.intervalStart : "";
  const intervalStartMs = Date.parse(intervalStart);
  if (
    record.v !== 1
    || !Array.isArray(record.balanceKeys)
    || record.balanceKeys.length === 0
    || record.balanceKeys.length > maximumWiseCheckpointBalances
    || record.balanceKeys.some((key) => typeof key !== "string" || !key || key.length > 256)
    || new Set(record.balanceKeys).size !== record.balanceKeys.length
    || !Number.isInteger(record.balanceIndex)
    || (record.balanceIndex as number) < 0
    || (record.balanceIndex as number) >= record.balanceKeys.length
    || !Number.isFinite(intervalStartMs)
    || new Date(intervalStartMs).toISOString() !== intervalStart
    || intervalStartMs < Date.parse(windowStart)
    || intervalStartMs > Date.parse(windowEnd)
  ) {
    throw new Error("Wise sync checkpoint cursor is invalid");
  }
  return {
    balanceKeys: record.balanceKeys as string[],
    balanceIndex: record.balanceIndex as number,
    intervalStart
  };
}

function wiseCheckpoint(
  windowStart: string,
  windowEnd: string,
  cursor: WiseCheckpointCursor
): BankSyncCheckpoint {
  return encodeBankSyncCheckpoint({
    provider: "wise",
    windowStart,
    windowEnd,
    cursor: encodeWiseCheckpointCursor(cursor)
  });
}

export async function fetchWiseActivityBatch({
  baseUrl,
  token,
  profileIds,
  dateRange,
  checkpoint,
  pageBudget,
  fetcher = fetch,
  now = Date.now(),
  onAccountsDiscovered,
  onTransactionPage,
  collectTransactions = true
}: WiseActivityBatchOptions): Promise<WiseActivityBatchResult> {
  if (checkpoint && dateRange) {
    throw new Error("Wise sync accepts either a date range or a checkpoint, not both");
  }
  const budget = wiseSyncPageBudget(pageBudget);
  const decodedCheckpoint = checkpoint
    ? decodeBankSyncCheckpoint(checkpoint, "wise")
    : undefined;
  const window = decodedCheckpoint
    ? {
        windowStart: decodedCheckpoint.windowStart,
        windowEnd: decodedCheckpoint.windowEnd
      }
    : wiseTransactionWindow(dateRange, now);
  const profileBalances = await fetchWiseProfileBalances(baseUrl, token, profileIds, fetcher);
  const accounts = profileBalanceAccounts(profileBalances);
  if (onAccountsDiscovered) await onAccountsDiscovered(accounts);
  if (profileBalances.length === 0) {
    if (decodedCheckpoint) throw new Error("Wise sync checkpoint references balances that are no longer accessible");
    return {
      accounts,
      transactions: [],
      statementIssues: [],
      nextCheckpoint: null,
      complete: true,
      pagesFetched: 0,
      providerTransactionsRead: 0
    };
  }
  if (profileBalances.length > maximumWiseCheckpointBalances) {
    throw new Error(`Wise sync supports at most ${maximumWiseCheckpointBalances} visible balances per checkpoint`);
  }

  const currentBalanceByKey = new Map(profileBalances.map((item) => [profileBalanceKey(item), item]));
  const cursor = decodedCheckpoint
    ? decodeWiseCheckpointCursor(decodedCheckpoint.cursor, window.windowStart, window.windowEnd)
    : {
        balanceKeys: profileBalances.map(profileBalanceKey),
        balanceIndex: 0,
        intervalStart: window.windowStart
      };
  const missingBalanceKeys = cursor.balanceKeys.filter((key) => !currentBalanceByKey.has(key));
  if (missingBalanceKeys.length > 0) {
    throw new Error(`Wise sync checkpoint balance is no longer accessible: ${missingBalanceKeys[0]}`);
  }

  const headers = { Authorization: `Bearer ${token}` };
  const transactions: Transaction[] = [];
  let pagesFetched = 0;
  let providerTransactionsRead = 0;
  let balanceIndex = cursor.balanceIndex;
  let intervalStart = cursor.intervalStart;

  while (pagesFetched < budget && balanceIndex < cursor.balanceKeys.length) {
    const profileBalance = currentBalanceByKey.get(cursor.balanceKeys[balanceIndex])!;
    const intervalStartMs = Date.parse(intervalStart);
    const intervalEndMs = Math.min(intervalStartMs + wiseStatementIntervalMs - 1, Date.parse(window.windowEnd));
    const intervalEnd = new Date(intervalEndMs).toISOString();
    const { profile, balance } = profileBalance;
    const params = new URLSearchParams({
      currency: balance.currency,
      intervalStart,
      intervalEnd,
      type: "COMPACT",
      statementLocale: "en"
    });

    pagesFetched += 1;
    let statementPayload: unknown;
    try {
      statementPayload = await fetchJson<unknown>(
        fetcher,
        `${baseUrl}/v1/profiles/${profile.id}/balance-statements/${balance.id}/statement.json?${params}`,
        {
          headers: {
            ...headers,
            "X-External-Correlation-Id": crypto.randomUUID()
          }
        }
      );
    } catch (error) {
      const issue = wiseSyncIssue(error);
      console.warn(JSON.stringify({
        event: "wise_statement_fetch_failed",
        profileId: profile.id,
        balanceId: balance.id,
        intervalStart,
        intervalEnd,
        error: error instanceof Error ? error.message : "Unknown Wise statement error"
      }));
      return {
        accounts,
        transactions,
        statementIssues: [issue],
        nextCheckpoint: wiseCheckpoint(window.windowStart, window.windowEnd, {
          balanceKeys: cursor.balanceKeys,
          balanceIndex,
          intervalStart
        }),
        complete: false,
        pagesFetched,
        providerTransactionsRead
      };
    }

    const activities = parseWiseStatementActivities(statementPayload);
    providerTransactionsRead += activities.length;
    const normalizedPage = normalizeWiseStatementTransactions(activities, profileBalance);
    if (collectTransactions) transactions.push(...normalizedPage);
    if (normalizedPage.length > 0 && onTransactionPage) {
      await onTransactionPage(normalizedPage);
    }

    if (intervalEndMs >= Date.parse(window.windowEnd)) {
      balanceIndex += 1;
      intervalStart = window.windowStart;
    } else {
      intervalStart = new Date(intervalEndMs + 1).toISOString();
    }
  }

  const complete = balanceIndex >= cursor.balanceKeys.length;
  return {
    accounts,
    transactions,
    statementIssues: [],
    nextCheckpoint: complete
      ? null
      : wiseCheckpoint(window.windowStart, window.windowEnd, {
          balanceKeys: cursor.balanceKeys,
          balanceIndex,
          intervalStart
        }),
    complete,
    pagesFetched,
    providerTransactionsRead
  };
}

export function emptyWiseActivity(balanceIssue?: string): WiseActivityResult {
  return { accounts: [], transactions: [], statementIssues: [], balanceIssue };
}

export function parseWiseProfileIds(value: string | undefined): Set<number> {
  if (!value?.trim()) return new Set();
  const ids = value.split(",").map((item) => Number(item.trim()));
  if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw new Error("WISE_PROFILE_IDS must contain comma-separated positive integer profile IDs");
  }
  return new Set(ids);
}

export function wiseSyncIssue(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown Wise sync error";
  if (/^403\b/.test(message)) {
    return "Wise denied live statement API access for one or more business profiles. Upload Wise statement CSVs for those accounts instead.";
  }
  if (/^401\b/.test(message)) {
    return "Wise rejected the API token. Refresh the Wise token and update WISE_API_TOKEN.";
  }
  return `Wise sync failed: ${message.replace(/\s+/g, " ").slice(0, 240)}`;
}

export function summarizeWiseStatementIssues(issues: string[]): string | undefined {
  if (issues.length === 0) return undefined;
  const uniqueIssues = [...new Set(issues)];
  const suffix = issues.length > 1 ? ` ${issues.length} accessible balances were affected.` : "";
  return `${uniqueIssues[0]}${suffix}`;
}

export async function fetchWiseBalancesForAccessibleBusinesses({
  baseUrl,
  token,
  profileIds,
  fetcher = fetch
}: WiseBalanceApiOptions): Promise<WiseActivityResult> {
  const profileBalances = await fetchWiseProfileBalances(baseUrl, token, profileIds, fetcher);
  const accounts = profileBalanceAccounts(profileBalances);
  return {
    accounts,
    transactions: [],
    statementIssues: []
  };
}
