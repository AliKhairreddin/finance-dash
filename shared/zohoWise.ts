import type { ImportWiseStatementPayload, Transaction, WiseEntity } from "./types";
import { wiseTransactionId } from "./wiseTransactionIdentity";
import { fetchBankProvider, readBoundedResponseText, bankProviderOAuthFetchPolicy } from "./boundedHttp";

export const zohoWiseStartDate = "2026-09-04";
// The Aug 31 CSV was generated at 04:35 UTC, before these six rows posted.
// Verified against all existing CSV identities and adjacent-day movements.
export const zohoWiseHistoricalRepairIds = new Set([
  "1364064000000064495", "1364064000000064496", "1364064000000064497",
  "1364064000000064498", "1364064000000064499", "1364064000000064500"
]);
// TRANSFER-2350596140 is already in LMD's Sep 3 CSV as a net EUR 91,297.61
// receipt. Zoho dates its EUR 91,300 receipt + EUR 2.39 fee Sep 4. Retain the
// existing CSV row and explicitly exclude both feed components at the cutover.
const zohoWiseCsvCoveredStatementIds = new Set(["1365687000000063093", "1365687000000063094"]);
export interface ZohoWiseAccount {
  organizationId: string;
  zohoAccountId: string;
  profileId: string;
  balanceId: string;
  currency: string;
  entity: WiseEntity;
}

// Explicit identity mapping: currency alone cannot distinguish Wise jars/accounts.
export const zohoWiseAccounts: readonly ZohoWiseAccount[] = [
  ...[
    ["1364064000000063133", "114115192", "USD"],
    ["1364064000000063139", "113640546", "EUR"],
    ["1364064000000063145", "132345158", "INR"],
    ["1364064000000063151", "139227848", "USD"],
    ["1364064000000063157", "115453713", "GBP"],
    ["1364064000000063163", "141960677", "THB"]
  ].map(([zohoAccountId, balanceId, currency]) => ({
    organizationId: "20119414037", zohoAccountId, profileId: "65909506", balanceId, currency, entity: "dn" as const
  })),
  ...[
    ["1365687000000061134", "37067485", "EUR"],
    ["1365687000000061140", "37067652", "USD"],
    ["1365687000000061146", "141892838", "EUR"],
    ["1365687000000061152", "66408859", "USD"],
    ["1365687000000061158", "169323704", "EUR"],
    ["1365687000000061164", "93497547", "GBP"],
    ["1365687000000061170", "68091709", "USD"],
    ["1365687000000061176", "169323562", "USD"]
  ].map(([zohoAccountId, balanceId, currency]) => ({
    organizationId: "20119414066", zohoAccountId, profileId: "31035977", balanceId, currency, entity: "lmd" as const
  }))
];

export interface ZohoCredentials {
  ZOHO_CLIENT_ID: string;
  ZOHO_CLIENT_SECRET: string;
  ZOHO_REFRESH_TOKEN: string;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Zoho returned invalid ${label}`);
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, maximum = 1024): string {
  if (typeof value !== "string" || value.length > maximum) throw new Error(`Zoho returned invalid ${label}`);
  return value.trim();
}
function date(value: unknown): string {
  const result = text(value, "date", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString().slice(0, 10) !== result) {
    throw new Error("Zoho returned an invalid calendar date");
  }
  return result;
}

export function zohoWiseTransaction(value: unknown, mapping: ZohoWiseAccount): Transaction {
  const row = object(value, "statement");
  if (row.account_id !== mapping.zohoAccountId) throw new Error("Zoho statement belongs to another account");
  if (row.is_feed !== true) throw new Error("Zoho statement is not an automatic bank feed; reconcile manually added Zoho rows before syncing");
  const statementId = text(row.statement_id, "statement ID", 100);
  if (!/^\d+$/.test(statementId)) throw new Error("Zoho statement ID is missing or invalid");
  if (typeof row.amount !== "number" || !Number.isFinite(row.amount) || row.amount < 0) throw new Error("Zoho statement amount is invalid");
  if (row.debit_or_credit !== "debit" && row.debit_or_credit !== "credit") throw new Error("Zoho statement direction is invalid");
  const description = text(row.description, "description");
  const reference = text(row.reference_number, "reference");
  const fee = /^Wise Charges for:/i.test(description);
  const payee = text(row.payee, "payee");
  const merchant = description.match(/^Card transaction of .+? issued by (.+)$/i)?.[1]?.replace(/ \(fee:[^)]*\)$/, "");
  const counterparty = fee ? "Wise" : merchant || payee || description.match(/^(?:Received money from|Sent money to) (.+?)(?: with reference | \(fee:|$)/i)?.[1] || description;
  const fullDescription = reference && !description.includes(reference) ? `${description} — ${reference}` : description;
  if (!counterparty || !fullDescription || fullDescription.length > 1024) throw new Error("Zoho statement description is missing or too long");
  return {
    id: wiseTransactionId(mapping.balanceId, `zoho:${mapping.organizationId}:${statementId}`),
    source: "wise", wiseEntity: mapping.entity,
    accountId: `wise-${mapping.profileId}-${mapping.balanceId}`,
    accountName: mapping.entity === "dn" ? "Digital Nudge OÜ" : "LOVEMEDO B.V.",
    date: date(row.date), description: fullDescription, rawName: counterparty, counterparty,
    amount: row.amount, currency: mapping.currency,
    // Zoho's bank statement debits are deposits, credits are withdrawals.
    direction: row.debit_or_credit === "debit" ? "in" : "out",
    status: row.is_excluded_by_system === true || row.status === "deleted" || row.status === "excluded" ? "voided" : "posted",
    category: fee && row.debit_or_credit === "credit" ? "Bank fees" : "Uncategorized"
  };
}

export function rejectZohoWiseCsvOverlap(payload: ImportWiseStatementPayload): void {
  if (payload.periodEnd >= zohoWiseStartDate && (payload.wiseEntity === "dn" || payload.wiseEntity === "lmd")) {
    throw new Error(`Wise transactions from ${zohoWiseStartDate} are synced through Zoho. CSV imports cannot overlap this period.`);
  }
  if (payload.wiseEntity === "dn" && payload.periodStart <= "2026-08-31" && payload.periodEnd >= "2026-08-31") {
    throw new Error("The August 31 Digital Nudge gap was repaired through Zoho. CSV imports cannot overlap this repair.");
  }
}

export async function fetchZohoWiseActivity(credentials: ZohoCredentials, options: {
  accounts?: readonly ZohoWiseAccount[];
  now?: number;
  fetcher?: typeof fetch;
} = {}): Promise<{ transactions: Transaction[]; accountIds: string[]; throughDate: string; pagesFetched: number }> {
  const mappings = options.accounts ?? zohoWiseAccounts;
  if (!mappings.length) throw new Error("No Zoho Wise accounts are configured");
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now();
  let throughDate = new Date(now - 86400_000).toISOString().slice(0, 10);
  let pagesFetched = 0;
  async function request(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
    const response = await fetchBankProvider(fetcher, url, init ?? {}, {
      provider: "Zoho", ...(init?.method === "POST" ? bankProviderOAuthFetchPolicy : {})
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Zoho request failed (HTTP ${response.status}); check connection consent and API access`); }
    let parsed: unknown;
    try { parsed = JSON.parse(await readBoundedResponseText(response, "Zoho")); }
    catch { throw new Error("Zoho returned an invalid response"); }
    const result = object(parsed, "response");
    // Never surface OAuth payloads or provider messages containing credentials.
    if (result.error || (result.code !== undefined && result.code !== 0)) throw new Error("Zoho API rejected the request; check connection consent and API access");
    return result;
  }
  const token = await request("https://accounts.zoho.eu/oauth/v2/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: credentials.ZOHO_CLIENT_ID,
      client_secret: credentials.ZOHO_CLIENT_SECRET, refresh_token: credentials.ZOHO_REFRESH_TOKEN })
  });
  const accessToken = text(token.access_token, "access token", 4096);
  if (!accessToken || token.api_domain !== "https://www.zohoapis.eu") throw new Error("Zoho OAuth must authorize the EU data center");
  const headers = { Authorization: `Zoho-oauthtoken ${accessToken}` };
  const transactions: Transaction[] = [];
  const ids = new Set<string>();
  for (const org of new Set(mappings.map((mapping) => mapping.organizationId))) {
    const orgMappings = mappings.filter((mapping) => mapping.organizationId === org);
    const base = "https://www.zohoapis.eu/books/v3";
    const listing = await request(`${base}/bankaccounts?organization_id=${org}&per_page=200`, { headers });
    if (!Array.isArray(listing.bankaccounts) || object(listing.page_context, "account pagination").has_more_page !== false) throw new Error("Zoho account list is incomplete");
    const banks = listing.bankaccounts.map((bank) => object(bank, "bank account"));
    for (const bank of banks.filter((bank) => bank.account_type === "bank" && bank.is_active)) {
      if (!orgMappings.some((mapping) => mapping.zohoAccountId === bank.account_id)) throw new Error(`Zoho organization ${org} has an unmapped bank account; map it before syncing`);
    }
    for (const mapping of orgMappings) {
      const bank = banks.find((bank) => bank.account_id === mapping.zohoAccountId);
      if (!bank || bank.is_active !== true || bank.currency_code !== mapping.currency) throw new Error(`Zoho account ${mapping.zohoAccountId} is unavailable or its currency changed`);
      const consent = object(bank.consent_info, "bank consent");
      if (consent.is_consent_expired === true || bank.mfa_required === true) throw new Error(`Reconnect Wise in Zoho organization ${org}: bank authorization needs renewal`);
      if (bank.refresh_status !== "completed") throw new Error(`Wise feed refresh in Zoho organization ${org} is not complete yet`);
      const refreshed = date(bank.feeds_last_refresh_date);
      if (now - Date.parse(refreshed) > 72 * 3600_000) throw new Error(`Wise feed in Zoho organization ${org} has not refreshed since ${refreshed}`);
      // A refresh partway through a day cannot establish full-day coverage.
      const covered = new Date(Date.parse(refreshed) - 86400_000).toISOString().slice(0, 10);
      if (covered < throughDate) throughDate = covered;
      for (let page = 1; ; page += 1) {
        if (page > 100) throw new Error("Zoho statement pagination exceeded the safety limit");
        const data = await request(`${base}/bankaccounts/${mapping.zohoAccountId}/statements?organization_id=${org}&page=${page}&per_page=200`, { headers });
        pagesFetched += 1;
        if (!Array.isArray(data.bankstatements)) throw new Error("Zoho bank statements are missing");
        const context = object(data.page_context, "statement pagination");
        if (context.page !== page || typeof context.has_more_page !== "boolean") throw new Error("Zoho statement pagination is invalid");
        for (const raw of data.bankstatements) {
          const transaction = zohoWiseTransaction(raw, mapping);
          if (ids.has(transaction.id)) throw new Error("Zoho repeated a statement across pages; retry the complete sync");
          ids.add(transaction.id);
          if (mapping.organizationId === "20119414066" && zohoWiseCsvCoveredStatementIds.has(String(object(raw, "statement").statement_id))) continue;
          const repair = mapping.organizationId === "20119414037" && mapping.balanceId === "114115192"
            && transaction.date === "2026-08-31" && zohoWiseHistoricalRepairIds.has(String(object(raw, "statement").statement_id));
          if ((transaction.date >= zohoWiseStartDate || repair) && transaction.date <= new Date(now).toISOString().slice(0, 10)) transactions.push(transaction);
        }
        if (!context.has_more_page) break;
        if (!data.bankstatements.length) throw new Error("Zoho pagination returned an empty continuation page");
      }
    }
  }
  return { transactions, throughDate, pagesFetched, accountIds: mappings.map((mapping) => `wise-${mapping.profileId}-${mapping.balanceId}`) };
}
