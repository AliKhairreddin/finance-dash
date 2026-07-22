import type { AccountBalance, Transaction } from "./types";

export interface WiseActivityResult {
  accounts: AccountBalance[];
  transactions: Transaction[];
  statementIssues: string[];
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
  amount?: { value?: number; currency?: string };
  modificationTime?: string;
  visible?: boolean;
}

interface WiseStatementActivity {
  date?: string;
  type?: string;
  details?: {
    description?: string;
    senderName?: string;
    recipientName?: string;
    referenceNumber?: string;
  };
  amount?: { value?: number; currency?: string };
}

interface WiseApiOptions {
  baseUrl: string;
  token: string;
  fetcher?: typeof fetch;
}

interface ProfileBalance {
  profile: WiseBusinessProfile;
  profileName: string;
  balance: WiseBalance;
}

async function fetchJson<T>(fetcher: typeof fetch, url: string, init: RequestInit): Promise<T> {
  const response = await fetcher(url, init);
  const text = await response.text();
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

export function emptyWiseActivity(statementIssues: string[] = []): WiseActivityResult {
  return { accounts: [], transactions: [], statementIssues };
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

export async function fetchWiseActivityForAccessibleBusinesses({
  baseUrl,
  token,
  fetcher = fetch
}: WiseApiOptions): Promise<WiseActivityResult> {
  const headers = { Authorization: `Bearer ${token}` };
  const profiles = await fetchJson<WiseProfile[]>(fetcher, `${baseUrl}/v2/profiles`, { headers });
  const businessProfiles = profiles.filter((profile): profile is WiseBusinessProfile => profile.type === "BUSINESS");

  const balancesByProfile = await Promise.all(
    businessProfiles.map(async (profile) => {
      const profileName = businessProfileName(profile);
      const balances = await fetchJson<WiseBalance[]>(
        fetcher,
        `${baseUrl}/v4/profiles/${profile.id}/balances?types=STANDARD,SAVINGS`,
        { headers }
      );
      return balances
        .filter((balance) => balance.visible !== false)
        .map((balance) => ({ profile, profileName, balance }));
    })
  );
  const profileBalances = balancesByProfile.flat();
  const now = new Date();
  const intervalEnd = now.toISOString();
  const intervalStart = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 45).toISOString();

  const accounts = profileBalances.map(({ profile, profileName, balance }) => ({
    id: `wise-${profile.id}-${balance.id}`,
    name: accountName(profileName, balance.currency),
    source: "wise" as const,
    balance: balance.amount?.value ?? 0,
    currency: balance.amount?.currency ?? balance.currency,
    updatedAt: balance.modificationTime ?? intervalEnd,
    status: "live" as const
  }));

  const statementResults = await Promise.all(
    profileBalances.map(async ({ profile, profileName, balance }) => {
      const params = new URLSearchParams({
        currency: balance.currency,
        intervalStart,
        intervalEnd,
        type: "COMPACT",
        statementLocale: "en"
      });

      try {
        const statement = await fetchJson<{ transactions?: WiseStatementActivity[] }>(
          fetcher,
          `${baseUrl}/v1/profiles/${profile.id}/balance-statements/${balance.id}/statement.json?${params}`,
          {
            headers: {
              ...headers,
              "X-External-Correlation-Id": crypto.randomUUID()
            }
          }
        );
        const transactions = (statement.transactions ?? []).map((activity, index): Transaction => {
          const value = activity.amount?.value ?? 0;
          const counterparty =
            activity.details?.senderName ||
            activity.details?.recipientName ||
            activity.details?.description ||
            "Wise activity";
          return {
            id: `wise-${profile.id}-${balance.id}-${activity.details?.referenceNumber ?? index}`,
            source: "wise",
            accountName: accountName(profileName, balance.currency),
            date: (activity.date ?? intervalEnd).slice(0, 10),
            description: activity.details?.description ?? activity.type ?? "Wise transaction",
            rawName: counterparty,
            counterparty,
            amount: Math.abs(value),
            currency: activity.amount?.currency ?? balance.currency,
            direction: value >= 0 ? "in" : "out",
            status: "posted",
            category: activity.type ?? "Wise"
          };
        });
        return { transactions };
      } catch (error) {
        console.warn(
          JSON.stringify({
            event: "wise_statement_fetch_failed",
            profileId: profile.id,
            balanceId: balance.id,
            error: error instanceof Error ? error.message : "Unknown Wise statement error"
          })
        );
        return { transactions: [] as Transaction[], issue: wiseSyncIssue(error) };
      }
    })
  );

  return {
    accounts,
    transactions: statementResults.flatMap((result) => result.transactions),
    statementIssues: statementResults.flatMap((result) => (result.issue ? [result.issue] : []))
  };
}
