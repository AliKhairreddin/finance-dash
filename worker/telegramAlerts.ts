import type { AccountBalance } from "../shared/types";
import {
  normalizeFinanceUsername,
  parseTelegramAuthUsers,
  sendTelegramMessage
} from "./telegram";

export type SlashCashBalanceBand = "below" | "healthy";

export interface SlashCashBalanceObservation {
  balance: number;
  threshold: number;
  currency: "USD";
  observedAt: string;
  sourceUpdatedAt: string;
  accounts: Array<{ name: string; balance: number }>;
}

export interface SlashCashBalanceNotification extends SlashCashBalanceObservation {
  id: string;
  band: SlashCashBalanceBand;
  kind: "low-balance" | "recovered";
}

export interface SlashCashBalanceAlertState {
  currentBand: SlashCashBalanceBand;
  lastDeliveredBand: SlashCashBalanceBand | null;
  lastObservation: SlashCashBalanceObservation;
  pendingNotification?: SlashCashBalanceNotification;
}

const maximumAlertAccounts = 10;

function validateObservation(observation: SlashCashBalanceObservation): void {
  if (
    !Number.isFinite(observation.balance)
    || !Number.isFinite(observation.threshold)
    || observation.threshold <= 0
    || observation.currency !== "USD"
    || !Number.isFinite(Date.parse(observation.observedAt))
    || !Number.isFinite(Date.parse(observation.sourceUpdatedAt))
    || observation.accounts.length === 0
    || observation.accounts.some((account) => (
      !account.name.trim()
      || !Number.isFinite(account.balance)
    ))
  ) {
    throw new Error("Slash cash balance observation was invalid");
  }
}

export function slashCashAlertThreshold(value: string | undefined): number {
  const threshold = Number(value);
  if (!Number.isFinite(threshold) || threshold <= 0) {
    throw new Error("SLASH_CASH_ALERT_THRESHOLD_USD must be a positive number");
  }
  return threshold;
}

export function slashCashBalanceObservation(
  accounts: readonly AccountBalance[],
  threshold: number,
  observedAt: string
): SlashCashBalanceObservation | null {
  const cashAccounts = accounts
    .filter((account) => account.source === "slash" && account.slashAccountSubtype === "cash")
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  if (cashAccounts.length === 0) return null;
  if (cashAccounts.some((account) => account.currency.toUpperCase() !== "USD")) {
    throw new Error("Slash cash alert requires USD account balances");
  }

  const observation: SlashCashBalanceObservation = {
    balance: Number(cashAccounts.reduce((total, account) => total + account.balance, 0).toFixed(2)),
    threshold,
    currency: "USD",
    observedAt,
    sourceUpdatedAt: cashAccounts.reduce(
      (latest, account) => account.updatedAt > latest ? account.updatedAt : latest,
      cashAccounts[0].updatedAt
    ),
    accounts: cashAccounts.map((account) => ({
      name: account.name.trim().slice(0, 128),
      balance: Number(account.balance.toFixed(2))
    }))
  };
  validateObservation(observation);
  return observation;
}

export function prepareSlashCashBalanceAlertTransition(
  state: SlashCashBalanceAlertState | undefined,
  observation: SlashCashBalanceObservation,
  notificationId: string
): { state: SlashCashBalanceAlertState; notification: SlashCashBalanceNotification | null } {
  validateObservation(observation);
  if (!notificationId.trim() || notificationId.length > 128) {
    throw new Error("Slash cash balance notification ID was invalid");
  }
  const band: SlashCashBalanceBand = observation.balance < observation.threshold ? "below" : "healthy";
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

  const nextState: SlashCashBalanceAlertState = {
    currentBand: band,
    lastDeliveredBand,
    lastObservation: observation,
    ...(pendingNotification ? { pendingNotification } : {})
  };
  return { state: nextState, notification: pendingNotification ?? null };
}

export function confirmSlashCashBalanceAlertTransition(
  state: SlashCashBalanceAlertState | undefined,
  notificationId: string
): SlashCashBalanceAlertState | undefined {
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

export function buildSlashCashBalanceAlertMessage(notification: SlashCashBalanceNotification): string {
  validateObservation(notification);
  const heading = notification.kind === "low-balance"
    ? "⚠️ Slash cash is below the alert threshold."
    : "✅ Slash cash has recovered above the alert threshold.";
  const visibleAccounts = notification.accounts.slice(0, maximumAlertAccounts);
  const accountLines = visibleAccounts.map((account) => `• ${account.name}: ${usd(account.balance)}`);
  if (notification.accounts.length > visibleAccounts.length) {
    accountLines.push(`• +${notification.accounts.length - visibleAccounts.length} more cash accounts`);
  }
  return [
    heading,
    "",
    `Available: ${usd(notification.balance)}`,
    `Threshold: ${usd(notification.threshold)}`,
    ...accountLines,
    `Slash updated: ${notification.sourceUpdatedAt}`
  ].join("\n");
}

export async function sendSlashCashBalanceAlert(
  env: Pick<WorkerEnv, "TELEGRAM_AUTH_USERS_JSON" | "TELEGRAM_BOT_TOKEN">,
  recipientUsername: string,
  notification: SlashCashBalanceNotification
): Promise<void> {
  const users = parseTelegramAuthUsers(env.TELEGRAM_AUTH_USERS_JSON);
  const recipient = users?.find(
    (user) => user.normalizedUsername === normalizeFinanceUsername(recipientUsername)
  );
  if (!recipient) throw new Error("Slash cash alert recipient is not an authorized Telegram user");
  await sendTelegramMessage(
    env,
    recipient.chatId,
    buildSlashCashBalanceAlertMessage(notification),
    true
  );
}
