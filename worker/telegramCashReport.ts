import { slashReportDateIfDue } from "./telegramSlashReport";
import type { AccountBalance, FxRate } from "../shared/types";
import type { SlashVirtualAccountBalance } from "../shared/slashApi";
import { normalizeFinanceUsername, parseTelegramAuthUsers } from "./telegram";
import { parseTelegramCommandUsers } from "./telegramCommandCatalog";

export const cashReportTimezone = "Asia/Beirut";
export const cashReportDeliveryStateKey = "cash-report-delivery";
const maximumMessageLength = 3_800;
const staleBalanceMs = 15 * 60_000;
const cashCurrencies = new Set(Intl.supportedValuesOf("currency"));

export type CashReportAccount = AccountBalance & { syncedAt: string };

export function isCashReportAccount(account: CashReportAccount): boolean {
  return (account.source === "wise" || account.source === "revolut")
    && account.status === "live" && cashCurrencies.has(account.currency.toUpperCase());
}

export function isCashReportCryptoAccount(account: CashReportAccount): boolean {
  return account.source === "revolut" && account.status === "live"
    && !cashCurrencies.has(account.currency.toUpperCase());
}

export function cashReportDateIfDue(timestamp: number): string | null {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: cashReportTimezone,
    year: "numeric", month: "2-digit", day: "2-digit", weekday: "short",
    hour: "2-digit", hourCycle: "h23"
  }).formatToParts(timestamp);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)!.value;
  if (value("weekday") !== "Mon" || Number(value("hour")) < 7) return null;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function timestampLabel(timestamp: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: cashReportTimezone, day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).format(new Date(timestamp));
}

function amountLabel(value: number, currency: string, fractionDigits = 2): string {
  return `${currency} ${value.toLocaleString("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  })}`;
}

export function buildTelegramCashReport(input: {
  accounts: readonly CashReportAccount[];
  slashAccounts: readonly SlashVirtualAccountBalance[];
  rates: readonly FxRate[];
  asOf: string;
}): string {
  // Slash virtual accounts partition its funds. Never add its parent cash/credit rows again.
  const bankAccounts = input.accounts.filter(isCashReportAccount);
  const cryptoAccounts = input.accounts.filter((account) => isCashReportCryptoAccount(account) && account.balance !== 0);
  const slashAccounts = input.slashAccounts.filter((account) => !account.closedAt);
  if (new Set(slashAccounts.map((account) => account.id)).size !== slashAccounts.length) {
    throw new Error("Slash returned duplicate virtual accounts; cash report could not be totaled");
  }
  const rates = new Map(input.rates.filter((rate) =>
    !rate.stale && Number.isFinite(rate.rateUsd) && rate.rateUsd > 0
  ).map((rate) => [rate.asset.toUpperCase(), rate]));
  const totals = new Map<string, number>();
  const cryptoBalances = new Map<string, number>();
  const groups = new Map(["Wise LMD", "Wise DN", "Revolut", "Slash"].map((name) => [name, new Map<string, number>()]));
  const syncTimes = new Map<string, string>();
  const recordSyncTime = (label: string, syncedAt: string) => {
    if (!Number.isFinite(Date.parse(syncedAt))) throw new Error(`${label} balance timestamp is unavailable`);
    const previous = syncTimes.get(label);
    if (!previous || syncedAt < previous) syncTimes.set(label, syncedAt);
  };
  const add = (group: string, currency: string, balance: number) => {
    if (!Number.isFinite(balance)) throw new Error("Invalid bank balance");
    const asset = currency.toUpperCase();
    const balances = groups.get(group) ?? new Map<string, number>();
    balances.set(asset, (balances.get(asset) ?? 0) + balance);
    groups.set(group, balances);
    totals.set(asset, (totals.get(asset) ?? 0) + balance);
  };
  for (const account of bankAccounts) {
    const bank = account.source === "wise" ? "Wise" : "Revolut";
    recordSyncTime(bank, account.syncedAt);
    if (account.source === "wise" && account.wiseEntity !== "dn" && account.wiseEntity !== "lmd") {
      throw new Error("Wise balance company is unavailable; cash report could not be grouped");
    }
    const group = account.source === "wise" ? account.wiseEntity === "dn" ? "Wise DN" : "Wise LMD" : "Revolut";
    add(group, account.currency, account.balance);
  }
  for (const account of slashAccounts) add("Slash", account.currency, account.balance);
  for (const account of cryptoAccounts) {
    if (!Number.isFinite(account.balance)) throw new Error("Invalid crypto balance");
    recordSyncTime("Crypto", account.syncedAt);
    const asset = account.currency.toUpperCase();
    cryptoBalances.set(asset, (cryptoBalances.get(asset) ?? 0) + account.balance);
  }
  const missing = [...totals].filter(([asset, balance]) => balance !== 0 && asset !== "USD" && !rates.has(asset))
    .map(([asset]) => asset).sort();
  const totalUsd = [...totals].reduce((total, [asset, balance]) =>
    total + balance * (asset === "USD" ? 1 : rates.get(asset)?.rateUsd ?? 0), 0
  );
  const lines = [
    "🏦 Bank balances",
    `${timestampLabel(input.asOf)} · Beirut`,
    "",
    missing.length === 0 ? `Bank total ≈ ${amountLabel(totalUsd, "USD")}` : "Bank USD total unavailable — missing exchange rates",
    ""
  ];
  for (const [group, balances] of groups) {
    if (balances.size === 0) continue;
    lines.push(group);
    const hasBalance = [...balances.values()].some((balance) => balance !== 0);
    for (const [asset, balance] of [...balances].sort(([a], [b]) => a.localeCompare(b))) {
      if (balance === 0 && hasBalance) continue;
      lines.push(`• ${amountLabel(balance, asset)}`);
    }
    lines.push("");
  }
  lines.push("Bank totals by currency");
  for (const [asset, balance] of [...totals].sort(([a], [b]) => a.localeCompare(b))) {
    if (balance === 0) continue;
    lines.push(`• ${amountLabel(balance, asset)}`);
  }
  if (cryptoBalances.size > 0) {
    lines.push("", "Crypto (separate)");
    for (const [asset, balance] of [...cryptoBalances].sort(([a], [b]) => a.localeCompare(b))) {
      const quote = rates.get(asset);
      lines.push(`• ${amountLabel(balance, asset, 8)}${quote
        ? ` ≈ ${amountLabel(balance * quote.rateUsd, "USD")}` : " · USD value unavailable"}`);
    }
  }
  lines.push("", "Balances checked (Beirut)");
  for (const [bank, checkedAt] of syncTimes) {
    const stale = Date.parse(input.asOf) - Date.parse(checkedAt) > staleBalanceMs;
    lines.push(`${bank}: ${timestampLabel(checkedAt)}${stale ? " ⚠️ stale" : ""}`);
  }
  lines.push(`Slash: ${timestampLabel(input.asOf)}`);
  if (missing.length > 0) lines.push(`⚠️ No current USD quote: ${missing.join(", ")}. Native balances shown.`);
  const usedQuotes = [...totals].filter(([asset, balance]) => asset !== "USD" && balance !== 0)
    .flatMap(([asset]) => rates.has(asset) ? [rates.get(asset)!] : []);
  if (usedQuotes.length > 0) {
    const oldestQuote = usedQuotes.map((rate) => rate.asOf).sort()[0];
    lines.push(`FX: ${timestampLabel(oldestQuote)} · Coinbase`);
  }
  const cryptoQuotes = [...cryptoBalances.keys()].flatMap((asset) => rates.has(asset) ? [rates.get(asset)!] : []);
  if (cryptoQuotes.length > 0) {
    lines.push(`Crypto quotes: ${timestampLabel(cryptoQuotes.map((rate) => rate.asOf).sort()[0])} · Coinbase`);
  }
  return lines.join("\n");
}

export function splitCashReport(message: string): string[] {
  const parts: string[] = [];
  let part = "";
  for (const line of message.split("\n")) {
    if (line.length > maximumMessageLength) throw new Error("Cash report line exceeds Telegram's message limit");
    if (part && part.length + line.length + 1 > maximumMessageLength) {
      parts.push(part.trimEnd());
      part = "";
    }
    part += `${part ? "\n" : ""}${line}`;
  }
  if (part.trim()) parts.push(part.trimEnd());
  return parts.length > 1 ? parts.map((text, index) => `🏦 ${index + 1}/${parts.length}\n${text}`) : parts;
}

export type CashReportKind = "weekly-cash" | "daily-slash" | "daily-slash-cashback" | "daily-slash-rejected-cards";
type CashReportRecipientEnv = Pick<WorkerEnv, "TELEGRAM_AUTH_USERS_JSON" | "TELEGRAM_CASH_REPORT_RECIPIENTS" | "TELEGRAM_SLASH_REPORT_RECIPIENTS" | "TELEGRAM_SLASH_CASHBACK_REPORT_RECIPIENTS" | "TELEGRAM_SLASH_REJECTED_CARDS_REPORT_RECIPIENTS">;

const reportSettings = {
  "weekly-cash": { recipients: "TELEGRAM_CASH_REPORT_RECIPIENTS", statePrefix: "telegram-cash-report", dateIfDue: cashReportDateIfDue },
  "daily-slash": { recipients: "TELEGRAM_SLASH_REPORT_RECIPIENTS", statePrefix: "telegram-slash-report", dateIfDue: slashReportDateIfDue },
  "daily-slash-cashback": { recipients: "TELEGRAM_SLASH_CASHBACK_REPORT_RECIPIENTS", statePrefix: "telegram-slash-cashback-report", dateIfDue: slashReportDateIfDue },
  "daily-slash-rejected-cards": { recipients: "TELEGRAM_SLASH_REJECTED_CARDS_REPORT_RECIPIENTS", statePrefix: "telegram-slash-rejected-cards-report", dateIfDue: slashReportDateIfDue }
} as const;

function cashReportSettings(kind: CashReportKind) {
  if (!Object.hasOwn(reportSettings, kind)) throw new Error("Invalid cash report kind");
  return reportSettings[kind];
}

function cashReportRecipientNames(env: CashReportRecipientEnv, kind: CashReportKind): string[] {
  const field = cashReportSettings(kind).recipients;
  return parseTelegramCommandUsers(env[field], field);
}

export function cashReportRecipient(env: CashReportRecipientEnv, name: string, kind: CashReportKind) {
  const names = cashReportRecipientNames(env, kind);
  const normalized = normalizeFinanceUsername(name);
  const users = parseTelegramAuthUsers(env.TELEGRAM_AUTH_USERS_JSON);
  const user = users?.find((candidate) => candidate.normalizedUsername === normalized);
  if (!user || !names.some((candidate) => normalizeFinanceUsername(candidate) === normalized)) {
    throw new Error(`${kind === "weekly-cash" ? "Cash" : "Slash"} report access is not authorized for ${name}`);
  }
  return user;
}

export interface CashReportDeliveryState {
  date: string;
  parts: string[];
  nextPart: number;
}

export function cashReportDelivered(state: CashReportDeliveryState | undefined, date: string): boolean {
  return Boolean(state && (state.date > date || (state.date === date && state.nextPart === state.parts.length)));
}

// Called inside the recipient Durable Object's serialized operation, including the sends.
export async function deliverCashReportParts(
  storage: Pick<DurableObjectStorage, "get" | "put">,
  date: string,
  message: string,
  send: (part: string) => Promise<void>
): Promise<boolean> {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || !message.trim()) throw new Error("Invalid cash report delivery");
  let state = await storage.get<CashReportDeliveryState>(cashReportDeliveryStateKey);
  if (cashReportDelivered(state, date)) return false;
  if (!state || state.date !== date) {
    state = { date, parts: splitCashReport(message), nextPart: 0 };
    await storage.put(cashReportDeliveryStateKey, state);
  }
  while (state.nextPart < state.parts.length) {
    await send(state.parts[state.nextPart]);
    state = { ...state, nextPart: state.nextPart + 1 };
    await storage.put(cashReportDeliveryStateKey, state);
  }
  return true;
}

export async function sendTelegramCashReportIfDue(
  env: CashReportRecipientEnv & Pick<WorkerEnv, "TELEGRAM_OTP_STATE">,
  scheduledTime: number,
  buildReport: () => Promise<string>,
  kind: CashReportKind = "weekly-cash"
): Promise<number> {
  const settings = cashReportSettings(kind);
  const date = settings.dateIfDue(scheduledTime);
  if (!date) return 0;
  const names = cashReportRecipientNames(env, kind);
  let report: Promise<string> | undefined;
  const results = await Promise.allSettled(names.map(async (name) => {
    const recipient = cashReportRecipient(env, name, kind);
    const state = env.TELEGRAM_OTP_STATE.getByName(`${settings.statePrefix}:${recipient.normalizedUsername}`);
    if (await state.isCashReportDelivered(date)) return false;
    report ??= buildReport();
    const sent = await state.deliverCashReport(date, recipient.username, await report, kind);
    if (sent) console.log(JSON.stringify({ event: "telegram_cash_report_sent", recipient: recipient.username, date, kind }));
    return sent;
  }));
  const failures = results.flatMap((result, index) => {
    if (result.status === "fulfilled") return [];
    console.error(JSON.stringify({
      event: "telegram_cash_report_recipient_failed", recipient: names[index], date, kind,
      error: result.reason instanceof Error ? result.reason.message : "Cash report failed"
    }));
    return [result.reason];
  });
  if (failures.length > 0) throw new AggregateError(failures, "Cash report delivery failed; unfinished recipients will retry");
  return results.filter((result) => result.status === "fulfilled" && result.value).length;
}
