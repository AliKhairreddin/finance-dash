import crypto from "node:crypto";
import type {
  AccountBalance,
  FxRate,
  IntegrationStatus,
  Invoice,
  MeritTax,
  Provider,
  RevenuePartner,
  RevenueRun,
  Transaction
} from "../shared/types";
import {
  normalizeAmexAccount,
  normalizeAmexTransactions,
  parseAmexAccountConfigs
} from "../shared/amexApi";
import {
  bankProviderOAuthFetchPolicy,
  fetchBankProvider,
  readBoundedResponseText
} from "../shared/boundedHttp";
import {
  meritInvoiceCopyDetails,
  meritInvoiceLineDescription,
  meritInvoicePeriods,
  meritProviderId,
  meritProvidersFromResponse
} from "../shared/merit";
import { decodeMeritInvoicePdf } from "../shared/invoiceFiles";
import { calculateTuneHourOffset } from "../shared/revenue";
import type { RevenuePeriod } from "../shared/revenue";
import {
  fetchRevolutActivity as fetchRevolutApiActivity,
  type RevolutTransactionDateRange
} from "../shared/revolutApi";
import {
  fetchSlashActivityForLegalEntity,
  type SlashTransactionDateRange
} from "../shared/slashApi";
import {
  fetchWiseBalancesForAccessibleBusinesses,
  parseWiseProfileIds,
  type WiseActivityResult
} from "../shared/wiseApi";

export { summarizeWiseStatementIssues, wiseSyncIssue } from "../shared/wiseApi";

const meritApiBaseUrl = process.env.MERIT_API_BASE_URL || "https://aktiva.merit.ee/api";
const meritGetInvoicesPath = process.env.MERIT_GET_INVOICES_PATH || "/v1/getinvoices";
const meritCreateInvoicePath = process.env.MERIT_CREATE_INVOICE_PATH || "/v2/sendinvoice";
const meritDeliverInvoicePath = process.env.MERIT_DELIVER_INVOICE_PATH || "/v2/sendinvoicebyemail";
const coinbaseSpotPricesUrl = process.env.COINBASE_SPOT_PRICES_URL || "https://api.coinbase.com/v2/prices";
const amexApiBaseUrl = process.env.AMEX_API_BASE_URL;
const amexTokenUrl = process.env.AMEX_TOKEN_URL;
const amexAccountPathTemplate = process.env.AMEX_ACCOUNT_PATH_TEMPLATE;
const amexTransactionsPathTemplate = process.env.AMEX_TRANSACTIONS_PATH_TEMPLATE;
const wiseBaseUrl =
  process.env.WISE_ENVIRONMENT === "sandbox"
    ? "https://api.wise-sandbox.com"
    : "https://api.wise.com";

function meritWritesEnabled(): boolean {
  return process.env.MERIT_WRITES_ENABLED === "true";
}

export function assertMeritWriteConfiguration(): void {
  if (!meritWritesEnabled()) {
    throw new Error("Merit invoice sending is disabled by the deployment safety switch.");
  }

  const missing = ["MERIT_API_ID", "MERIT_API_KEY"].filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Merit invoice sending is missing ${missing.join(", ")}.`);
  }
}

async function fetchJson<T>(url: string, init: RequestInit, maximumBytes?: number): Promise<T> {
  const response = await fetch(url, init);
  const text = maximumBytes === undefined
    ? await response.text()
    : await readBoundedResponseText(response, "Merit", maximumBytes);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

async function fetchBankJson<T>(
  url: string,
  init: RequestInit,
  provider: string,
  oauth = false
): Promise<T> {
  const response = await fetchBankProvider(fetch, url, init, {
    provider,
    ...(oauth ? bankProviderOAuthFetchPolicy : {})
  });
  const text = await readBoundedResponseText(response, provider);
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

export function meritConnectionIssue(error: unknown): string {
  const message = error instanceof Error ? error.message : "Unknown Merit API error";
  if (/\b401\b/.test(message)) {
    return "Merit rejected API access (401). Confirm this company has Merit API access on its plan and that these credentials belong to it.";
  }
  if (/\b400\b/.test(message)) {
    return "Merit rejected the API credentials (400). Regenerate the API ID and key in Merit, then update both Worker secrets.";
  }
  return `Merit read failed: ${message.replace(/\s+/g, " ").slice(0, 180)}`;
}

function requiredRevenueEnvNames(revenuePartners: RevenuePartner[]): string[] {
  const names = new Set<string>();
  for (const partner of revenuePartners.filter((item) => item.enabled)) {
    names.add(partner.networkIdEnv);
    names.add(partner.apiKeyEnv);
  }
  return [...names].filter(Boolean).sort();
}

export function getIntegrationStatus(
  wiseBalanceIssue?: string,
  revenuePartners: RevenuePartner[] = [],
  meritIssue?: string,
  bankIssues: Partial<Record<"revolut" | "slash" | "amex", string>> = {},
  fxRates: FxRate[] = [],
  missingFxAssets: string[] = [],
  staleFxAssets: string[] = []
): IntegrationStatus[] {
  const wiseNeeds = ["WISE_API_TOKEN", "WISE_PROFILE_IDS"].filter((name) => !process.env[name]);
  const activeWiseIssue = wiseNeeds.length === 0 ? wiseBalanceIssue : undefined;

  const revolutNeeds = [
    "REVOLUT_CLIENT_ID",
    "REVOLUT_ISSUER",
    "REVOLUT_PRIVATE_KEY_PEM",
    "REVOLUT_REFRESH_TOKEN"
  ].filter((name) => !process.env[name]);
  const slashNeeds = ["SLASH_API_KEY", "SLASH_LEGAL_ENTITY_ID", "SLASH_BASE_URL"].filter((name) => !process.env[name]);
  const amexNeeds = [
    "AMEX_TOKEN_URL",
    "AMEX_API_BASE_URL",
    "AMEX_CLIENT_ID",
    "AMEX_CLIENT_SECRET",
    "AMEX_REFRESH_TOKEN",
    "AMEX_ACCOUNT_IDS",
    "AMEX_ACCOUNT_PATH_TEMPLATE",
    "AMEX_TRANSACTIONS_PATH_TEMPLATE",
    "AMEX_TRANSACTIONS_ITEMS_PATH",
    "AMEX_TRANSACTIONS_NEXT_CURSOR_PATH",
    "AMEX_TRANSACTIONS_CURSOR_PARAM",
    "AMEX_TRANSACTIONS_PAGE_SIZE_PARAM",
    "AMEX_TRANSACTIONS_PAGE_SIZE"
  ].filter((name) => !process.env[name]);
  const meritNeeds = ["MERIT_API_ID", "MERIT_API_KEY"].filter((name) => !process.env[name]);
  const meritWriteEnabled = meritWritesEnabled() && meritNeeds.length === 0;
  const revenueEnvNames = requiredRevenueEnvNames(revenuePartners);
  const tuneNeeds = revenueEnvNames.filter((name) => !process.env[name]);
  const enabledRevenuePartnerCount = revenuePartners.filter((partner) => partner.enabled).length;

  return [
    {
      id: "wise",
      label: "Wise",
      configured: wiseNeeds.length === 0,
      mode: wiseNeeds.length === 0 && !activeWiseIssue ? "live" : "partial",
      message:
        activeWiseIssue ??
        (wiseNeeds.length === 0
          ? "Balances sync automatically. Transactions and statements are imported manually from Wise CSVs."
          : "Wise rows stay empty until an API token and selected profile IDs are configured."),
      needs: wiseNeeds,
      issue: activeWiseIssue
    },
    {
      id: "revolut",
      label: "Revolut",
      configured: revolutNeeds.length === 0,
      mode: revolutNeeds.length === 0 && !bankIssues.revolut ? "live" : "partial",
      message:
        bankIssues.revolut ?? (revolutNeeds.length === 0
          ? "Transactions are saved in Convex and refreshed incrementally every 15 minutes or on Sync."
          : "Revolut rows stay empty until the client ID, issuer, certificate private key, and refresh token are configured."),
      needs: revolutNeeds,
      issue: bankIssues.revolut
    },
    {
      id: "slash",
      label: "Slash",
      configured: slashNeeds.length === 0,
      mode: slashNeeds.length === 0 && !bankIssues.slash ? "live" : "partial",
      message:
        bankIssues.slash ?? (slashNeeds.length === 0
          ? "Transactions are saved in Convex, refreshed incrementally every 15 minutes, and older dates are backfilled only when requested."
          : "Slash rows stay empty until the user-scoped API key, legal entity ID, and API base URL are configured."),
      needs: slashNeeds,
      issue: bankIssues.slash
    },
    {
      id: "amex",
      label: "Amex",
      configured: amexNeeds.length === 0,
      mode: amexNeeds.length === 0 && !bankIssues.amex ? "live" : "partial",
      message:
        bankIssues.amex ?? (amexNeeds.length === 0
          ? "Ready to mint an Amex access token and pull card balances plus transaction activity."
          : "Amex rows stay empty until OAuth credentials, account IDs, and approved API paths are configured."),
      needs: amexNeeds,
      issue: bankIssues.amex
    },
    {
      id: "merit",
      label: "Merit",
      configured: meritNeeds.length === 0,
      mode: meritNeeds.length === 0 && !meritIssue ? "live" : "partial",
      message:
        meritNeeds.length === 0
          ? meritIssue ??
            (meritWriteEnabled
              ? "Merit invoice reads are connected. Explicitly confirmed invoice sending is enabled."
              : "Merit invoice reads are connected. Invoice sending is disabled by the deployment safety switch.")
          : "Add the Merit API ID and API key to enable read-only invoice sync.",
      needs: meritNeeds,
      issue: meritNeeds.length === 0 ? meritIssue : undefined,
      writeEnabled: meritWriteEnabled
    },
    {
      id: "tune",
      label: "Partner revenue",
      configured: enabledRevenuePartnerCount > 0 && tuneNeeds.length === 0,
      mode: enabledRevenuePartnerCount > 0 && tuneNeeds.length === 0 ? "live" : "partial",
      message:
        enabledRevenuePartnerCount === 0
          ? "Enable at least one owner revenue stream before pulling TUNE/HasOffers revenue."
          : tuneNeeds.length === 0
            ? "Ready to pull owner-attributed partner revenue from TUNE/HasOffers. Invoice creation is a separate explicit action."
            : "Partner revenue stays empty until each enabled stream has its TUNE network ID and API key configured.",
      needs: tuneNeeds
    },
    {
      id: "coinbase",
      label: "Coinbase rates",
      configured: true,
      mode: missingFxAssets.length === 0 && staleFxAssets.length === 0 ? "live" : "partial",
      message:
        missingFxAssets.length > 0
          ? `USD totals exclude assets without a Coinbase quote: ${missingFxAssets.join(", ")}.`
          : staleFxAssets.length > 0
            ? `Using last-known approximate rates for: ${staleFxAssets.join(", ")}.`
            : fxRates.length > 0
              ? "Keyless approximate USD rates refresh hourly, with bank sync, and on demand."
              : "All liquid balances are already in USD, so no conversion quote is required.",
      needs: []
    }
  ];
}

export async function fetchWiseActivity(): Promise<WiseActivityResult> {
  const token = process.env.WISE_API_TOKEN;
  const profileIds = parseWiseProfileIds(process.env.WISE_PROFILE_IDS);
  if (!token || profileIds.size === 0) return { accounts: [], transactions: [], statementIssues: [] };
  return fetchWiseBalancesForAccessibleBusinesses({
    baseUrl: wiseBaseUrl,
    token,
    profileIds
  });
}

export async function fetchRevolutActivity(
  dateRange?: RevolutTransactionDateRange
): Promise<{ accounts: AccountBalance[]; transactions: Transaction[] }> {
  return fetchRevolutApiActivity({
    environment: process.env.REVOLUT_ENVIRONMENT,
    clientId: process.env.REVOLUT_CLIENT_ID,
    issuer: process.env.REVOLUT_ISSUER,
    privateKeyPem: process.env.REVOLUT_PRIVATE_KEY_PEM,
    refreshToken: process.env.REVOLUT_REFRESH_TOKEN,
    dateRange
  });
}

export async function fetchSlashActivity(
  dateRange?: SlashTransactionDateRange
): Promise<{ accounts: AccountBalance[]; transactions: Transaction[] }> {
  const apiKey = process.env.SLASH_API_KEY?.trim();
  const legalEntityId = process.env.SLASH_LEGAL_ENTITY_ID?.trim();
  const baseUrl = process.env.SLASH_BASE_URL?.trim();
  if (!apiKey || !legalEntityId || !baseUrl) return { accounts: [], transactions: [] };
  return fetchSlashActivityForLegalEntity({
    baseUrl,
    apiKey,
    legalEntityId,
    dateRange
  });
}

async function fetchAmexAccessToken(): Promise<string | undefined> {
  if (!amexTokenUrl || !process.env.AMEX_CLIENT_ID || !process.env.AMEX_CLIENT_SECRET || !process.env.AMEX_REFRESH_TOKEN) {
    return undefined;
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: process.env.AMEX_REFRESH_TOKEN,
    client_id: process.env.AMEX_CLIENT_ID,
    client_secret: process.env.AMEX_CLIENT_SECRET
  });

  const response = await fetchBankJson<{ access_token?: string }>(amexTokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body
  }, "Amex", true);

  if (
    typeof response.access_token !== "string"
    || !response.access_token.trim()
    || response.access_token !== response.access_token.trim()
    || response.access_token.length > 16_384
    || /[\u0000-\u0020\u007f-\u009f]/u.test(response.access_token)
  ) {
    throw new Error("Amex token response did not include access_token");
  }
  return response.access_token;
}

function amexEndpoint(template: string, accountId: string, query?: URLSearchParams): string {
  if (!amexApiBaseUrl) throw new Error("AMEX_API_BASE_URL is not configured");
  const path = template.replaceAll("{accountId}", encodeURIComponent(accountId));
  const separator = path.startsWith("/") ? "" : "/";
  const suffix = query ? `?${query.toString()}` : "";
  return `${amexApiBaseUrl.replace(/\/+$/, "")}${separator}${path}${suffix}`;
}

export async function fetchAmexActivity(): Promise<{ accounts: AccountBalance[]; transactions: Transaction[] }> {
  const accountConfigs = parseAmexAccountConfigs(process.env.AMEX_ACCOUNT_IDS);
  const accessToken = await fetchAmexAccessToken();
  if (!accessToken || !amexApiBaseUrl || !amexAccountPathTemplate || !amexTransactionsPathTemplate || accountConfigs.length === 0) {
    return { accounts: [], transactions: [] };
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json"
  };
  const intervalEnd = new Date().toISOString().slice(0, 10);
  const intervalStart = new Date(Date.now() - 1000 * 60 * 60 * 24 * 45).toISOString().slice(0, 10);
  const accountResults = await Promise.all(
    accountConfigs.map(async (config) => {
      const transactionParams = new URLSearchParams({ from: intervalStart, to: intervalEnd });
      const [account, transactions] = await Promise.all([
        fetchBankJson<unknown>(amexEndpoint(amexAccountPathTemplate, config.id), { headers }, "Amex"),
        fetchBankJson<unknown>(
          amexEndpoint(amexTransactionsPathTemplate, config.id, transactionParams),
          { headers },
          "Amex"
        )
      ]);
      return {
        account: normalizeAmexAccount(account, config),
        transactions: normalizeAmexTransactions(transactions, config)
      };
    })
  );

  return {
    accounts: accountResults.map((result) => result.account),
    transactions: accountResults.flatMap((result) => result.transactions)
  };
}

function meritTimestamp(): string {
  return new Date().toISOString().replace(/\D/g, "").slice(0, 14);
}

function meritDate(value: string): string {
  return value.replace(/\D/g, "").slice(0, 8);
}

function meritItemCode(tax: MeritTax): string {
  const prefix = (process.env.MERIT_DEFAULT_ITEM_CODE || "SERVICES").replace(/[^A-Za-z0-9]/g, "").slice(0, 8) || "SERVICES";
  const taxCode = tax.code.replace(/[^A-Za-z0-9]/g, "").slice(0, 11) || String(tax.taxPct).replace(/\D/g, "");
  return `${prefix}-${taxCode}`.slice(0, 20);
}

function configuredMeritItemCode(value: string | undefined, tax: MeritTax): string {
  const configured = value?.replace(/[^A-Za-z0-9-]/g, "").slice(0, 20);
  return configured || meritItemCode(tax);
}

function meritResponseDate(value: unknown, defaultDate: string): string {
  if (typeof value !== "string" && typeof value !== "number") return defaultDate;
  const raw = String(value).trim();
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  const dotNet = raw.match(/\/Date\((\d+)\)\//);
  if (dotNet) return new Date(Number(dotNet[1])).toISOString().slice(0, 10);
  const parsed = new Date(raw);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : defaultDate;
}

function meritUrl(path: string, body: string): string {
  const apiId = process.env.MERIT_API_ID;
  const apiKey = process.env.MERIT_API_KEY;
  if (!apiId || !apiKey) {
    throw new Error("Merit API credentials are not configured");
  }

  const timestamp = meritTimestamp();
  const signature = crypto
    .createHmac("sha256", Buffer.from(apiKey, "ascii"))
    .update(Buffer.from(`${apiId}${timestamp}${body}`, "utf8"))
    .digest("base64");
  const params = new URLSearchParams({ apiId, timestamp, signature });
  return `${meritApiBaseUrl}${path}?${params.toString()}`;
}

async function fetchMeritJson<T>(path: string, payload: unknown, maximumBytes?: number): Promise<T> {
  const body = JSON.stringify(payload);
  return fetchJson<T>(meritUrl(path, body), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body
  }, maximumBytes);
}

interface MeritInvoiceRecord {
  SIHId?: string;
  InvoiceNo?: string;
  CustomerId?: string;
  CustomerName?: string;
  DocumentDate?: string;
  DueDate?: string;
  CurrencyCode?: string;
  TotalSum?: number;
  TotalAmount?: number;
  Paid?: boolean;
}

interface MeritInvoiceDetails {
  Lines?: Array<{
    AmountExclVat?: number;
    Description?: string;
    TaxId?: string;
  }>;
}

export async function fetchMeritInvoices(persistedInvoices: Invoice[] = []): Promise<Invoice[]> {
  if (!process.env.MERIT_API_ID || !process.env.MERIT_API_KEY) return [];

  const responses = await Promise.all(
    meritInvoicePeriods(persistedInvoices).map((period) =>
      fetchMeritJson<MeritInvoiceRecord[]>(meritGetInvoicesPath, {
        PeriodStart: meritDate(period.periodStart),
        PeriodEnd: meritDate(period.periodEnd),
        UnPaid: false
      })
    )
  );

  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  const byExternalId = new Map<string, Invoice>();
  for (const invoice of responses.flat()) {
    const externalId = invoice.SIHId ?? invoice.InvoiceNo;
    if (!externalId) continue;
    const invoiceNumber = invoice.InvoiceNo ?? invoice.SIHId!;
    byExternalId.set(externalId, {
      id: `merit-${externalId}`,
      ...(invoice.CustomerId ? { providerId: meritProviderId("customer", invoice.CustomerId) } : {}),
      documentType: "sales_invoice",
      origin: "merit",
      customerName: invoice.CustomerName ?? "Merit invoice",
      amount: invoice.TotalSum ?? invoice.TotalAmount ?? 0,
      currency: (invoice.CurrencyCode ?? "USD").toUpperCase(),
      // Merit is authoritative only for the read-only meritStatus field. Local
      // allocations are the sole authority for the dashboard paid status.
      status: "open",
      meritStatus: invoice.Paid ? "paid" : "open",
      meritDeliveryStatus: "saved",
      invoiceNumber,
      issueDate: meritResponseDate(invoice.DocumentDate, today),
      dueDate: meritResponseDate(invoice.DueDate, today),
      source: "merit",
      externalId,
      description: `Merit invoice ${invoiceNumber}`,
      revenueRunIds: [],
      createdAt: now,
      updatedAt: now
    });
  }
  return [...byExternalId.values()];
}

export async function fetchMeritInvoiceCopyDetails(
  invoice: Invoice
): Promise<Pick<Invoice, "amount" | "description" | "periodStart" | "periodEnd" | "taxId">> {
  if (!invoice.externalId) throw new Error("Merit invoice ID is required to duplicate this invoice");
  return meritInvoiceCopyDetails(
    await fetchMeritJson<MeritInvoiceDetails>("/v2/getinvoice", {
      Id: invoice.externalId,
      AddAttachment: false
    })
  );
}

export async function fetchMeritInvoicePdf(externalId: string): Promise<Uint8Array<ArrayBuffer>> {
  if (!externalId.trim()) throw new Error("A Merit invoice ID is required to download its PDF");
  const response = await fetchMeritJson<{ FileContent?: unknown }>(
    "/v2/getsalesinvpdf",
    { Id: externalId, DelivNote: false },
    24 * 1024 * 1024
  );
  return decodeMeritInvoicePdf(response.FileContent);
}

export async function fetchMeritCustomers(): Promise<Provider[]> {
  if (!process.env.MERIT_API_ID || !process.env.MERIT_API_KEY) return [];
  return meritProvidersFromResponse(await fetchMeritJson<unknown>("/v1/getcustomers", { WithComments: true }), "customer");
}

export async function fetchMeritVendors(): Promise<Provider[]> {
  if (!process.env.MERIT_API_ID || !process.env.MERIT_API_KEY) return [];
  return meritProvidersFromResponse(await fetchMeritJson<unknown>("/v1/getvendors", { WithComments: true }), "vendor");
}

export async function fetchMeritTaxes(): Promise<MeritTax[]> {
  if (!process.env.MERIT_API_ID || !process.env.MERIT_API_KEY) return [];

  const response = await fetchMeritJson<
    Array<{
      Id?: string;
      Code?: string;
      Name?: string;
      NameEN?: string;
      TaxPct?: number;
    }>
  >("/v1/gettaxes", {});

  return response
    .filter((tax) => tax.Id && Number.isFinite(Number(tax.TaxPct)))
    .map((tax) => ({
      id: tax.Id!,
      code: tax.Code?.trim() || "VAT",
      name: tax.NameEN?.trim() || tax.Name?.trim() || tax.Code?.trim() || "Merit tax",
      taxPct: Number(tax.TaxPct)
    }))
    .sort((left, right) => left.taxPct - right.taxPct || left.name.localeCompare(right.name));
}

export interface MeritCreatedInvoice {
  externalId: string;
  invoiceNumber: string;
}

export interface MeritInvoiceOptions {
  itemCode?: string;
  provider?: Provider;
}

function meritCustomer(invoice: Invoice, provider?: Provider): Record<string, unknown> {
  const meritCustomerId = provider?.meritCustomerId?.trim();
  if (meritCustomerId) return { Id: meritCustomerId };

  const email = provider?.email?.trim();
  const address = provider?.address?.trim();
  const configuredCountry = provider?.country?.trim().toUpperCase();
  const countryCode = /^[A-Z]{2}$/.test(configuredCountry ?? "")
    ? configuredCountry
    : process.env.MERIT_DEFAULT_COUNTRY_CODE || "EE";
  return {
    Name: provider?.legalName?.trim() || invoice.customerName,
    NotTDCustomer: true,
    CountryCode: countryCode,
    ...(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { Email: email } : {}),
    ...(address ? { Address: address } : {})
  };
}

export async function createMeritInvoice(
  invoice: Invoice,
  tax: MeritTax,
  options: MeritInvoiceOptions = {}
): Promise<MeritCreatedInvoice> {
  assertMeritWriteConfiguration();
  const taxAmount = Number(((invoice.amount * tax.taxPct) / 100).toFixed(2));
  if (!new RegExp(`^${invoice.issueDate.slice(0, 4)}/\\d+$`).test(invoice.invoiceNumber)) {
    throw new Error(`Invoice number must follow the active Merit ${invoice.issueDate.slice(0, 4)}/sequence format`);
  }

  const response = await fetchMeritJson<{ Id?: string; InvoiceId?: string; SIHId?: string; InvoiceNo?: string }>(meritCreateInvoicePath, {
    Customer: meritCustomer(invoice, options.provider),
    AccountingDoc: 1,
    DocDate: meritDate(invoice.issueDate),
    DueDate: meritDate(invoice.dueDate),
    InvoiceNo: invoice.invoiceNumber,
    CurrencyCode: invoice.currency,
    InvoiceRow: [
      {
        Item: {
          Code: configuredMeritItemCode(options.itemCode, tax),
          Description: meritInvoiceLineDescription(invoice.description, invoice.periodStart, invoice.periodEnd),
          Type: 2
        },
        Quantity: 1,
        Price: invoice.amount,
        TaxId: tax.id
      }
    ],
    TaxAmount: [
      {
        TaxId: tax.id,
        Amount: taxAmount
      }
    ],
    TotalAmount: invoice.amount,
    Hcomment: "Created from finance dashboard. Paid status is managed locally and is not written back to Merit."
  });

  const externalId = response.InvoiceId ?? response.SIHId ?? response.Id;
  if (!externalId) {
    throw new Error("Merit accepted the invoice request without returning an invoice ID; review Merit before retrying.");
  }
  return {
    externalId,
    invoiceNumber: response.InvoiceNo ?? invoice.invoiceNumber
  };
}

export async function deliverMeritInvoice(externalId: string): Promise<void> {
  assertMeritWriteConfiguration();
  if (!externalId.trim()) throw new Error("A Merit invoice ID is required for delivery");
  await fetchMeritJson<unknown>(meritDeliverInvoicePath, {
    Id: externalId,
    DelivNote: false
  });
}

export async function fetchCoinbaseUsdRates(assets: Iterable<string>): Promise<FxRate[]> {
  const uniqueAssets = [...new Set(
    [...assets].map((asset) => asset.trim().toUpperCase()).filter((asset) => asset && asset !== "USD")
  )];
  if (uniqueAssets.length === 0) return [];

  const fetchedAt = new Date().toISOString();
  const baseUrl = coinbaseSpotPricesUrl.replace(/\/+$/, "");
  const results = await Promise.allSettled(uniqueAssets.map(async (asset): Promise<FxRate> => {
    const url = new URL(`${baseUrl}/${encodeURIComponent(asset)}-USD/spot`);
    const response = await fetchJson<{ data?: { amount?: string; base?: string; currency?: string } }>(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000)
    });
    const rateUsd = Number(response.data?.amount);
    if (response.data?.currency !== "USD" || !Number.isFinite(rateUsd) || rateUsd <= 0) {
      throw new Error(`Coinbase did not return a USD spot price for ${asset}`);
    }
    return {
      asset,
      rateUsd,
      provider: "coinbase",
      asOf: fetchedAt,
      checkedAt: fetchedAt,
      stale: false
    };
  }));
  const rates = results.flatMap((result): FxRate[] => result.status === "fulfilled" ? [result.value] : []);
  if (rates.length === 0) {
    const firstFailure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (firstFailure?.reason instanceof Error) throw firstFailure.reason;
    throw new Error("Coinbase did not return any requested USD rates");
  }
  return rates;
}

export async function fetchTuneRevenue(partner: RevenuePartner, period: RevenuePeriod): Promise<RevenueRun> {
  const networkId = process.env[partner.networkIdEnv];
  const apiKey = process.env[partner.apiKeyEnv];
  const now = new Date().toISOString();

  if (!networkId || !apiKey) {
    throw new Error(`Missing ${[partner.networkIdEnv, partner.apiKeyEnv].filter((name) => !process.env[name]).join(", ")}`);
  }

  const apiBaseUrl = process.env[partner.apiBaseUrlEnv ?? ""] || `https://${networkId}.api.hasoffers.com/Apiv3/json`;
  const hourOffset = calculateTuneHourOffset(period.timezone, partner.networkTimezone, period.periodStart);
  const params = new URLSearchParams({
    Target: "Affiliate_Report",
    Method: "getStats",
    api_key: apiKey,
    totals: "1",
    currency: partner.currency,
    data_start: period.periodStart,
    data_end: period.periodEnd,
    hour_offset: String(hourOffset)
  });
  params.append("fields[0]", "Stat.date");
  params.append("fields[1]", "Stat.payout");
  params.append("fields[2]", "Stat.conversions");
  params.append("fields[3]", "Stat.clicks");
  if (partner.affiliateId.trim()) {
    params.append("filters[Affiliate.id][conditional]", "EQUAL_TO");
    params.append("filters[Affiliate.id][values][0]", partner.affiliateId);
  }
  params.append("filters[Stat.date][conditional]", "BETWEEN");
  params.append("filters[Stat.date][values][0]", period.periodStart);
  params.append("filters[Stat.date][values][1]", period.periodEnd);

  const response = await fetchJson<{
    response?: {
      status?: number;
      data?: unknown;
      errorMessage?: string | null;
      errors?: unknown[];
    };
  }>(`${apiBaseUrl}?${params.toString()}`, {
    headers: {
      Accept: "application/json"
    }
  });

  if (response.response?.status === 0) {
    throw new Error(response.response.errorMessage || "TUNE revenue request failed");
  }

  const rows = normalizeTuneRows(response.response?.data);
  const totals = rows.reduce<{ revenue: number; clicks: number; conversions: number }>(
    (sum, row) => ({
      revenue: sum.revenue + tuneNumber(row, "payout"),
      clicks: sum.clicks + tuneNumber(row, "clicks"),
      conversions: sum.conversions + tuneNumber(row, "conversions")
    }),
    { revenue: 0, clicks: 0, conversions: 0 }
  );

  return {
    id: `revenue-${partner.id}-${period.periodStart}-${period.periodEnd}`,
    partnerId: partner.id,
    partnerName: partner.name,
    providerId: partner.providerId,
    ...(partner.teamId ? { teamId: partner.teamId } : {}),
    revenueCategory: partner.revenueCategory,
    source: "tune",
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    timezone: period.timezone,
    revenue: Number(totals.revenue.toFixed(2)),
    currency: partner.currency,
    clicks: totals.clicks,
    conversions: totals.conversions,
    status: "pulled",
    createdAt: now
  };
}

function normalizeTuneRows(data: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(data)) return data.filter(isRecord);
  if (isRecord(data)) {
    if (Array.isArray(data.data)) return data.data.filter(isRecord);
    if (Array.isArray(data.Data)) return data.Data.filter(isRecord);
  }
  return [];
}

function tuneNumber(row: Record<string, unknown>, field: "payout" | "clicks" | "conversions"): number {
  const stat = isRecord(row.Stat) ? row.Stat : {};
  const value = stat[field] ?? row[`Stat.${field}`] ?? row[field];
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
