import type { SlashVirtualAccountBalance } from "../shared/slashApi";
import {
  normalizeFinanceUsername,
  parseTelegramAuthUsers,
  sendTelegramMessage
} from "./telegram";

export type SlashVirtualAccountBalanceBand = "below" | "healthy";

export interface SlashVirtualAccountBalanceObservation {
  accountId: string;
  accountName: string;
  balance: number;
  threshold: number;
  currency: "USD";
  observedAt: string;
}

export interface SlashVirtualAccountBalanceNotification extends SlashVirtualAccountBalanceObservation {
  id: string;
  band: SlashVirtualAccountBalanceBand;
  kind: "low-balance" | "recovered";
}

export interface SlashVirtualAccountBalanceAlertState {
  currentBand: SlashVirtualAccountBalanceBand;
  lastDeliveredBand: SlashVirtualAccountBalanceBand | null;
  lastObservation: SlashVirtualAccountBalanceObservation;
  pendingNotification?: SlashVirtualAccountBalanceNotification;
}

export interface TelegramSlashAlertRule {
  accountName: string;
  threshold: number;
  paused: boolean;
}

export interface TelegramAlertSettings {
  rules: TelegramSlashAlertRule[];
  digestTimeUtc: string | null;
  updatedAt: string;
}

export interface TelegramAlertDeliveryRecord {
  id: string;
  kind: SlashVirtualAccountBalanceNotification["kind"];
  accountName: string;
  balance: number;
  threshold: number;
  currency: "USD";
  recipient: string;
  deliveredAt: string;
}

const maximumAlertAccounts = 10;
const maximumAlertRecipients = 10;
export const maximumTelegramAlertHistory = 100;

function normalizedAccountName(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function validateObservation(observation: SlashVirtualAccountBalanceObservation): void {
  if (
    !observation.accountId.trim()
    || observation.accountId.length > 500
    || !observation.accountName.trim()
    || observation.accountName.length > 512
    || !Number.isFinite(observation.balance)
    || !Number.isFinite(observation.threshold)
    || observation.threshold <= 0
    || observation.currency !== "USD"
    || !Number.isFinite(Date.parse(observation.observedAt))
  ) {
    throw new Error("Slash virtual account balance observation was invalid");
  }
}

export function slashVirtualAccountAlertThreshold(value: string | undefined): number {
  const threshold = Number(value);
  if (!Number.isFinite(threshold) || threshold <= 0) {
    throw new Error("SLASH_VIRTUAL_ACCOUNT_ALERT_THRESHOLD_USD must be a positive number");
  }
  return threshold;
}

function parseUniqueCsv(
  value: string | undefined,
  field: string,
  maximumEntries: number
): string[] {
  const entries = value?.split(",").map((entry) => entry.trim()).filter(Boolean) ?? [];
  if (entries.length === 0 || entries.length > maximumEntries) {
    throw new Error(`${field} must contain 1-${maximumEntries} values`);
  }
  if (entries.some((entry) => entry.length > 512)) {
    throw new Error(`${field} contains an overlong value`);
  }
  const normalizedEntries = entries.map(normalizedAccountName);
  if (new Set(normalizedEntries).size !== normalizedEntries.length) {
    throw new Error(`${field} contains duplicate values`);
  }
  return entries;
}

export function slashVirtualAccountAlertNames(value: string | undefined): string[] {
  return parseUniqueCsv(value, "SLASH_VIRTUAL_ACCOUNT_ALERT_NAMES", maximumAlertAccounts);
}

export function slashVirtualAccountAlertRecipients(value: string | undefined): string[] {
  return parseUniqueCsv(value, "SLASH_VIRTUAL_ACCOUNT_ALERT_RECIPIENTS", maximumAlertRecipients);
}

function validateTelegramAlertRule(rule: TelegramSlashAlertRule): TelegramSlashAlertRule {
  const accountName = rule.accountName.trim().replace(/\s+/gu, " ");
  if (
    !accountName
    || accountName.length > 512
    || !Number.isFinite(rule.threshold)
    || rule.threshold <= 0
    || rule.threshold > 1_000_000_000
    || typeof rule.paused !== "boolean"
  ) {
    throw new Error("Telegram Slash alert rule was invalid");
  }
  return { accountName, threshold: Number(rule.threshold.toFixed(2)), paused: rule.paused };
}

export function defaultTelegramAlertSettings(
  accountNames: readonly string[],
  threshold: number,
  now: string
): TelegramAlertSettings {
  if (!Number.isFinite(Date.parse(now))) throw new Error("Telegram alert settings timestamp was invalid");
  const rules = accountNames.map((accountName) => validateTelegramAlertRule({
    accountName,
    threshold,
    paused: false
  }));
  if (rules.length > maximumAlertAccounts) throw new Error("Telegram alert settings have too many rules");
  if (new Set(rules.map((rule) => normalizedAccountName(rule.accountName))).size !== rules.length) {
    throw new Error("Telegram alert settings contain duplicate rules");
  }
  return { rules, digestTimeUtc: null, updatedAt: now };
}

export function validateTelegramAlertSettings(settings: TelegramAlertSettings): TelegramAlertSettings {
  if (
    !settings
    || !Array.isArray(settings.rules)
    || settings.rules.length > maximumAlertAccounts
    || (settings.digestTimeUtc !== null && !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(settings.digestTimeUtc))
    || !Number.isFinite(Date.parse(settings.updatedAt))
  ) {
    throw new Error("Telegram alert settings were invalid");
  }
  const rules = settings.rules.map(validateTelegramAlertRule);
  if (new Set(rules.map((rule) => normalizedAccountName(rule.accountName))).size !== rules.length) {
    throw new Error("Telegram alert settings contain duplicate rules");
  }
  return { rules, digestTimeUtc: settings.digestTimeUtc, updatedAt: settings.updatedAt };
}

export function upsertTelegramAlertRule(
  settings: TelegramAlertSettings,
  accountName: string,
  threshold: number,
  now: string
): TelegramAlertSettings {
  const current = validateTelegramAlertSettings(settings);
  const rule = validateTelegramAlertRule({ accountName, threshold, paused: false });
  const key = normalizedAccountName(rule.accountName);
  const existingIndex = current.rules.findIndex((item) => normalizedAccountName(item.accountName) === key);
  const rules = existingIndex < 0
    ? [...current.rules, rule]
    : current.rules.map((item, index) => index === existingIndex ? { ...rule, paused: item.paused } : item);
  if (rules.length > maximumAlertAccounts) throw new Error("Telegram alert settings have too many rules");
  return validateTelegramAlertSettings({ ...current, rules, updatedAt: now });
}

export function removeTelegramAlertRule(
  settings: TelegramAlertSettings,
  accountName: string,
  now: string
): TelegramAlertSettings {
  const current = validateTelegramAlertSettings(settings);
  const key = normalizedAccountName(accountName);
  const rules = current.rules.filter((item) => normalizedAccountName(item.accountName) !== key);
  if (rules.length === current.rules.length) throw new Error(`No alert rule exists for ${accountName.trim()}`);
  return validateTelegramAlertSettings({ ...current, rules, updatedAt: now });
}

export function pauseTelegramAlertRules(
  settings: TelegramAlertSettings,
  accountName: string,
  paused: boolean,
  now: string
): TelegramAlertSettings {
  const current = validateTelegramAlertSettings(settings);
  const key = normalizedAccountName(accountName);
  const all = key === "all";
  if (!all && !current.rules.some((item) => normalizedAccountName(item.accountName) === key)) {
    throw new Error(`No alert rule exists for ${accountName.trim()}`);
  }
  const rules = current.rules.map((item) =>
    all || normalizedAccountName(item.accountName) === key ? { ...item, paused } : item
  );
  return validateTelegramAlertSettings({ ...current, rules, updatedAt: now });
}

export function setTelegramDigestTime(
  settings: TelegramAlertSettings,
  digestTimeUtc: string | null,
  now: string
): TelegramAlertSettings {
  return validateTelegramAlertSettings({
    ...validateTelegramAlertSettings(settings),
    digestTimeUtc,
    updatedAt: now
  });
}

export function appendTelegramAlertHistory(
  history: readonly TelegramAlertDeliveryRecord[] | undefined,
  record: TelegramAlertDeliveryRecord
): TelegramAlertDeliveryRecord[] {
  if (
    !record.id.trim()
    || record.id.length > 128
    || !record.accountName.trim()
    || record.accountName.length > 512
    || !Number.isFinite(record.balance)
    || !Number.isFinite(record.threshold)
    || record.currency !== "USD"
    || !record.recipient.trim()
    || record.recipient.length > 64
    || !Number.isFinite(Date.parse(record.deliveredAt))
    || (record.kind !== "low-balance" && record.kind !== "recovered")
  ) {
    throw new Error("Telegram alert history record was invalid");
  }
  return [record, ...(history ?? []).filter((item) => item.id !== record.id)].slice(0, maximumTelegramAlertHistory);
}

export function slashVirtualAccountBalanceObservations(
  accounts: readonly SlashVirtualAccountBalance[],
  alertNames: readonly string[],
  threshold: number,
  observedAt: string
): SlashVirtualAccountBalanceObservation[] {
  const accountsByName = new Map<string, SlashVirtualAccountBalance>();
  for (const account of accounts) {
    if (account.closedAt) continue;
    const key = normalizedAccountName(account.name);
    if (accountsByName.has(key)) {
      throw new Error(`Slash returned multiple open virtual accounts named ${account.name}`);
    }
    accountsByName.set(key, account);
  }

  const observations = alertNames.map((name) => {
    const account = accountsByName.get(normalizedAccountName(name));
    if (!account) throw new Error(`Slash virtual account ${name} is unavailable for alerting`);
    const observation: SlashVirtualAccountBalanceObservation = {
      accountId: account.id,
      accountName: account.name,
      balance: Number(account.balance.toFixed(2)),
      threshold,
      currency: account.currency,
      observedAt
    };
    validateObservation(observation);
    return observation;
  });

  if (new Set(observations.map((observation) => observation.accountId)).size !== observations.length) {
    throw new Error("Slash virtual account alert names resolved to duplicate accounts");
  }
  return observations;
}

export function prepareSlashVirtualAccountBalanceAlertTransition(
  state: SlashVirtualAccountBalanceAlertState | undefined,
  observation: SlashVirtualAccountBalanceObservation,
  notificationId: string
): {
  state: SlashVirtualAccountBalanceAlertState;
  notification: SlashVirtualAccountBalanceNotification | null;
} {
  validateObservation(observation);
  if (!notificationId.trim() || notificationId.length > 128) {
    throw new Error("Slash virtual account balance notification ID was invalid");
  }
  if (state && state.lastObservation.accountId !== observation.accountId) {
    throw new Error("Slash virtual account alert state belongs to another account");
  }

  const band: SlashVirtualAccountBalanceBand = observation.balance < observation.threshold ? "below" : "healthy";
  const lastDeliveredBand = state?.lastDeliveredBand ?? (band === "healthy" ? "healthy" : null);
  let pendingNotification = state?.pendingNotification;

  if (pendingNotification?.band !== band) pendingNotification = undefined;
  if (lastDeliveredBand === band) pendingNotification = undefined;
  if (lastDeliveredBand !== band) {
    pendingNotification = {
      ...observation,
      id: pendingNotification?.id ?? notificationId,
      band,
      kind: band === "below" ? "low-balance" : "recovered"
    };
  }

  const nextState: SlashVirtualAccountBalanceAlertState = {
    currentBand: band,
    lastDeliveredBand,
    lastObservation: observation,
    ...(pendingNotification ? { pendingNotification } : {})
  };
  return { state: nextState, notification: pendingNotification ?? null };
}

export function confirmSlashVirtualAccountBalanceAlertTransition(
  state: SlashVirtualAccountBalanceAlertState | undefined,
  notificationId: string
): SlashVirtualAccountBalanceAlertState | undefined {
  if (!state?.pendingNotification || state.pendingNotification.id !== notificationId) return state;
  const { pendingNotification: _pendingNotification, ...nextState } = state;
  return { ...nextState, lastDeliveredBand: state.pendingNotification.band };
}

function usd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

export function buildSlashVirtualAccountBalanceAlertMessage(
  notification: SlashVirtualAccountBalanceNotification
): string {
  validateObservation(notification);
  const heading = notification.kind === "low-balance"
    ? "⚠️ Slash virtual account is below the alert threshold."
    : "✅ Slash virtual account has recovered to the alert threshold.";
  return [
    heading,
    "",
    `Account: ${notification.accountName}`,
    `Balance: ${usd(notification.balance)}`,
    `Threshold: ${usd(notification.threshold)}`,
    `Checked: ${notification.observedAt}`
  ].join("\n");
}

export async function sendSlashVirtualAccountBalanceAlert(
  env: Pick<WorkerEnv, "TELEGRAM_AUTH_USERS_JSON" | "TELEGRAM_BOT_TOKEN">,
  recipientUsername: string,
  notification: SlashVirtualAccountBalanceNotification
): Promise<void> {
  const users = parseTelegramAuthUsers(env.TELEGRAM_AUTH_USERS_JSON);
  const recipient = users?.find(
    (user) => user.normalizedUsername === normalizeFinanceUsername(recipientUsername)
  );
  if (!recipient) {
    throw new Error(`Slash virtual account alert recipient ${recipientUsername} is not an authorized Telegram user`);
  }
  await sendTelegramMessage(
    env,
    recipient.chatId,
    buildSlashVirtualAccountBalanceAlertMessage(notification),
    true
  );
}
