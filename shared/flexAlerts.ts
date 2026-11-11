import type { AccountBalance, Transaction } from "./types";

export interface FlexAlertObservation {
  key: string; eventKey: string; at: string; active: boolean; always: boolean;
  message: string; recoveryMessage?: string; recipients: string[];
}
const clean = (value: string) => value.replace(/\s+/g, " ").trim().slice(0, 400);
const money = (amount: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
const time = (value: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Beirut", dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) + " · Beirut";
export function flexCardObservations(transactions: Transaction[], activatedAt: string, recipients: string[], now = Date.now()): FlexAlertObservation[] {
  return transactions.filter(tx => tx.flex?.type === "card-purchase" && tx.cardId && tx.direction === "out")
    .sort((a, b) => a.flex!.occurredAt.localeCompare(b.flex!.occurredAt)).flatMap(tx => {
      const details = tx.flex!;
      const at = Date.parse(details.occurredAt);
      if (at < Date.parse(activatedAt) || at < now - 24 * 3600_000 || at > now + 60_000) return [];
      const declined = details.status === "declined";
      if (!declined && !["authorized", "settled", "pending", "clearing"].includes(details.status)) return [];
      const body = [`Mojo Labs LLC · ${tx.cardLastFour ? `Card ••${tx.cardLastFour}` : "Card " + tx.cardId}`,
        ...(tx.cardHolderName ? [clean(tx.cardHolderName)] : []), time(details.occurredAt), clean(tx.counterparty),
        `${declined ? "Attempted" : "Approved"}: ${money(tx.amount, tx.currency)}${declined ? " (not charged)" : ""}`,
        ...(declined ? [`Reason: ${clean(details.declineReason ?? "Not supplied by Flex").replaceAll("_", " ")}`] : []),
        `Transaction: ${details.id}`, "https://finance.thatcanadian.dev/?page=banks&bankView=flex"].join("\n");
      return [{ key: `card:${tx.cardId}`, eventKey: `${declined ? "decline" : "recovery"}:${details.id}`,
        at: details.occurredAt, active: declined, always: true, recipients,
        message: `🚫 Flex card declined\n${body}`, recoveryMessage: `✅ Flex card payment approved again\n${body}` }];
    });
}
export function flexBalanceObservations(accounts: AccountBalance[], threshold: number, recipients: string[], now = Date.now()): FlexAlertObservation[] {
  if (!Number.isFinite(threshold) || threshold < 0) throw new Error("Invalid Flex alert threshold");
  return accounts.flatMap(account => {
    const details = account.flex;
    if (!details || details.status !== "active" || account.currency !== "USD") return [];
    const at = Date.parse(details.availableAsOf);
    if (!Number.isFinite(at) || now - at > 30 * 60_000 || at > now + 60_000) return [];
    const label = details.type === "rewardCard" ? "Available credit" : "Available balance";
    const body = `${clean(account.name)}\n${label}: ${money(details.available, "USD")}\nThreshold: ${money(threshold, "USD")}\n${time(details.availableAsOf)}\nhttps://finance.thatcanadian.dev/?page=banks&bankView=flex`;
    return [{ key: `balance:${account.id}`, eventKey: `balance:${account.id}:${details.availableAsOf}:${threshold}:${details.available < threshold}`,
      at: details.availableAsOf, active: details.available < threshold, always: false, recipients,
      message: `⚠️ Flex ${details.type === "rewardCard" ? "credit" : "balance"} below threshold\n${body}`,
      recoveryMessage: `✅ Flex ${details.type === "rewardCard" ? "credit" : "balance"} recovered\n${body}` }];
  });
}
