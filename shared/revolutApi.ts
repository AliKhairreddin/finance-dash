import type { AccountBalance, Transaction } from "./types";

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
    leg_id?: string;
    amount: number;
    currency: string;
    account_id: string;
    description?: string;
    counterparty?: { description?: string; account_type?: string };
  }>;
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
  const response = await fetcher(url, init);
  if (!response.ok) {
    const detail = await boundedErrorText(response);
    throw new Error(
      `Revolut API request failed (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
    );
  }
  return (await response.json()) as T;
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
  to
}: {
  baseUrl: string;
  headers: HeadersInit;
  fetcher: typeof fetch;
  from: string;
  to: string;
}): Promise<RevolutTransaction[]> {
  const transactions = new Map<string, RevolutTransaction>();
  let pageTo = to;

  for (let page = 0; page < maxRevolutTransactionPages; page += 1) {
    const params = new URLSearchParams({
      from,
      to: pageTo,
      count: String(revolutTransactionPageSize)
    });
    params.append("state", "created");
    params.append("state", "pending");
    params.append("state", "completed");
    const rows = await fetchRevolutJson<RevolutTransaction[]>(
      fetcher,
      `${baseUrl}/transactions?${params.toString()}`,
      { headers }
    );
    for (const row of rows) transactions.set(row.id, row);
    if (rows.length < revolutTransactionPageSize) return [...transactions.values()];

    const nextTo = rows.at(-1)?.created_at;
    if (!nextTo || nextTo === pageTo) {
      throw new Error("Revolut transaction pagination did not provide a new created_at cursor");
    }
    pageTo = nextTo;
  }

  throw new Error(`Revolut transaction pagination exceeded ${maxRevolutTransactionPages} pages`);
}

function revolutStatus(state: string | undefined): Transaction["status"] {
  return state === "created" || state === "pending" ? "pending" : "posted";
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

export async function fetchRevolutActivity({
  environment,
  clientId,
  issuer,
  privateKeyPem,
  refreshToken,
  dateRange,
  fetcher = fetch,
  now = Date.now()
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
  const [revolutAccounts, revolutTransactions] = await Promise.all([
    fetchRevolutJson<RevolutAccount[]>(fetcher, `${baseUrl}/accounts`, { headers }),
    fetchRevolutTransactions({
      baseUrl,
      headers,
      fetcher,
      from: interval.from,
      to: interval.to
    })
  ]);

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

  const transactions: Transaction[] = [];
  for (const activity of revolutTransactions) {
    for (const [index, leg] of activity.legs.entries()) {
      const account = accountById.get(leg.account_id);
      const counterparty = revolutCounterparty(activity, leg);
      transactions.push({
        id: `revolut-${activity.id}-${leg.leg_id ?? "leg"}-${index}`,
        source: "revolut",
        accountName: account?.name || `Revolut ${leg.currency}`,
        date: (activity.completed_at || activity.created_at || new Date(now).toISOString()).slice(0, 10),
        description: activity.reference || activity.type || counterparty,
        rawName: counterparty,
        counterparty,
        amount: Math.abs(leg.amount),
        currency: leg.currency,
        direction: leg.amount >= 0 ? "in" : "out",
        status: revolutStatus(activity.state),
        category: "Revolut"
      });
    }
  }

  return { accounts, transactions };
}
