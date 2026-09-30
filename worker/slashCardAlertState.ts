import type { SlashCardAlertTransaction, SlashCard, SlashVirtualAccountBalance } from "../shared/slashApi";

export interface SlashCardPayment { id: string; at: string; amountCents: number; merchant: string; reason?: string }
export interface SlashCardAlertState {
  latestDecline?: SlashCardPayment;
  latestApproval?: SlashCardPayment;
  activeDecline: boolean;
  sequence: number;
}
export interface SlashCardNotification {
  kind: "declined" | "recovered";
  transaction: SlashCardAlertTransaction;
  previousDecline?: SlashCardPayment;
  laterApproval?: SlashCardPayment;
}

export function prepareSlashCardAlert(previous: SlashCardAlertState | undefined, tx: SlashCardAlertTransaction, declineSeen: boolean): {
  state: SlashCardAlertState; notification: SlashCardNotification | null;
} {
  const state = structuredClone(previous ?? { activeDecline: false, sequence: 0 });
  const time = Date.parse(tx.authorizedAt);
  if (!Number.isFinite(time) || !Number.isSafeInteger(tx.amountCents) || !tx.cardId) throw new Error("Invalid Slash card alert transaction");
  const payment: SlashCardPayment = { id: tx.id, at: tx.authorizedAt, amountCents: tx.amountCents,
    merchant: tx.merchantData?.description ?? tx.description, ...(tx.declineReason ? { reason: tx.declineReason } : {}) };
  if (tx.detailedStatus === "declined" && tx.amountCents <= 0) {
    if (declineSeen) return { state, notification: null };
    if (!state.latestDecline || time >= Date.parse(state.latestDecline.at)) {
      state.latestDecline = payment;
      state.activeDecline = !state.latestApproval || state.latestApproval.id === tx.id || time >= Date.parse(state.latestApproval.at);
    }
    const laterApproval = state.latestApproval && state.latestApproval.id !== tx.id && Date.parse(state.latestApproval.at) > time ? state.latestApproval : undefined;
    return { state, notification: { kind: "declined", transaction: tx, ...(laterApproval ? { laterApproval } : {}) } };
  }
  if (!["pending", "settled"].includes(tx.detailedStatus) || tx.status === "failed" || tx.amountCents >= 0
    || declineSeen || tx.id === state.latestDecline?.id) return { state, notification: null };
  if (!state.latestApproval || time > Date.parse(state.latestApproval.at)) state.latestApproval = payment;
  if (!state.activeDecline || !state.latestDecline || time <= Date.parse(state.latestDecline.at)) return { state, notification: null };
  state.activeDecline = false;
  return { state, notification: { kind: "recovered", transaction: tx, previousDecline: state.latestDecline } };
}

const clean = (value: string, limit = 150) => value.replace(/\s+/gu, " ").trim().slice(0, limit);
const money = (cents: number, currency = "USD") => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);
const time = (at: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Beirut", year: "numeric", month: "short",
  day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(Date.parse(at));

export function buildSlashCardAlert(notification: SlashCardNotification, labels: { card: SlashCard; account?: SlashVirtualAccountBalance }, appUrl: string): string {
  const { transaction: tx } = notification;
  if (labels.card.id !== tx.cardId || !/^\d{4}$/u.test(labels.card.last4)) throw new Error("Slash card alert details are incomplete");
  const lines = [notification.kind === "declined" ? "🚫 Slash card declined" : "✅ Slash card payment approved again",
    `${labels.card.name ? `${clean(labels.card.name)} · ` : ""}Card ••${labels.card.last4}`,
    `Time: ${time(tx.authorizedAt)} · Beirut`, `Merchant: ${clean(tx.merchantData?.description ?? tx.description)}`,
    `${notification.kind === "declined" ? "Attempted" : "Approved"}: ${money(Math.abs(tx.amountCents))}${notification.kind === "declined" ? " (not charged)" : ""}`];
  if (tx.originalCurrency && tx.originalCurrency.code !== "USD") lines.push(`Original amount: ${money(Math.abs(tx.originalCurrency.amountCents), tx.originalCurrency.code)}`);
  if (labels.account) lines.push(`Account: ${clean(labels.account.name)}`, `Available balance now: ${money(Math.round(labels.account.balance * 100))}`);
  else lines.push(`Parent account: ${clean(tx.accountId)}`);
  if (tx.merchantData?.categoryCode) lines.push(`Merchant category (MCC): ${clean(tx.merchantData.categoryCode, 64)}`);
  if (notification.kind === "declined") lines.push(`Reason: ${tx.declineReason ? clean(tx.declineReason, 400) : "Not provided by Slash"}`);
  else if (notification.previousDecline) lines.push("", `Previous decline: ${time(notification.previousDecline.at)} · ${clean(notification.previousDecline.merchant)}`,
    `Previous reason: ${notification.previousDecline.reason ? clean(notification.previousDecline.reason, 400) : "Not provided by Slash"}`,
    "A later payment was approved. This confirms that payment worked; other merchants or amounts may still decline.");
  if (notification.laterApproval) lines.push("", `A later payment was already approved: ${time(notification.laterApproval.at)} · ${clean(notification.laterApproval.merchant)} · ${money(Math.abs(notification.laterApproval.amountCents))}`);
  lines.push("", `Transaction: ${clean(tx.id, 500)}`, String(new URL("/?page=banks&bankView=slash", appUrl)));
  return lines.join("\n");
}
