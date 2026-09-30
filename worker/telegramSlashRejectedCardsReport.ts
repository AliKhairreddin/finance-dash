import type { SlashCard, SlashRejectedCardTransaction, SlashVirtualAccountBalance } from "../shared/slashApi";
import { slashPreviousDayReportPeriod } from "./telegramSlashDailyPeriod";

const usd = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const clean = (value: string, limit = 100) => value.replace(/\s+/gu, " ").trim().slice(0, limit);
const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Beirut", hour: "2-digit", minute: "2-digit", hourCycle: "h23"
});

interface RejectedCard {
  card: SlashCard;
  accounts: Set<string>;
  attempts: SlashRejectedCardTransaction[];
  attemptedCents: number;
}

export function buildTelegramSlashRejectedCardsReport(input: {
  transactions: readonly SlashRejectedCardTransaction[];
  cards: readonly SlashCard[];
  accounts: readonly SlashVirtualAccountBalance[];
  asOf: number;
}): string {
  const period = slashPreviousDayReportPeriod(input.asOf);
  const cards = new Map(input.cards.map((card) => [card.id, card]));
  const accounts = new Map(input.accounts.map((account) => [account.id, account]));
  const groups = new Map<string, RejectedCard>();
  const seen = new Set<string>();
  let attemptedCents = 0;
  for (const tx of input.transactions) {
    if (tx.detailedStatus !== "declined" || tx.amountCents > 0) continue;
    const time = Date.parse(tx.date);
    if (!Number.isFinite(time) || !Number.isSafeInteger(tx.amountCents)) throw new Error("Invalid Slash card rejection");
    if (time < period.fromTime || time >= period.toTime) continue;
    const key = JSON.stringify([tx.accountId, tx.id]);
    if (seen.has(key)) continue;
    seen.add(key);
    const card = cards.get(tx.cardId);
    if (!card || !/^\d{4}$/u.test(card.last4)) throw new Error("Slash card details are incomplete");
    const account = tx.virtualAccountId ? accounts.get(tx.virtualAccountId) : undefined;
    if (tx.virtualAccountId && !account) throw new Error("Slash virtual account details are incomplete");
    const cardKey = JSON.stringify([tx.accountId, tx.cardId]);
    const group = groups.get(cardKey) ?? { card, accounts: new Set<string>(), attempts: [], attemptedCents: 0 };
    group.accounts.add(account ? clean(account.name) : `Parent account ${clean(tx.accountId)}`);
    group.attempts.push(tx);
    group.attemptedCents += -tx.amountCents;
    attemptedCents += -tx.amountCents;
    if (!Number.isSafeInteger(group.attemptedCents) || !Number.isSafeInteger(attemptedCents)) {
      throw new Error("Slash rejected card totals exceed the calculation limit");
    }
    groups.set(cardKey, group);
  }
  const lines = ["🚫 Daily Slash rejected cards report", `${period.date} · Beirut`, ""];
  if (groups.size === 0) return [...lines, "✅ No rejected Slash card payments for this date."].join("\n");
  const rows = [...groups.values()].sort((a, b) => b.attempts.length - a.attempts.length
    || b.attemptedCents - a.attemptedCents || a.card.id.localeCompare(b.card.id));
  const count = rows.reduce((sum, row) => sum + row.attempts.length, 0);
  lines.push(`${count} rejected ${count === 1 ? "payment" : "payments"} across ${rows.length} ${rows.length === 1 ? "card" : "cards"}`,
    `Attempted amount: ${usd(attemptedCents)} (not charged)`, "");
  for (const row of rows) {
    lines.push(`${row.card.name ? `${clean(row.card.name)} · ` : ""}Card ••${row.card.last4}`);
    for (const account of [...row.accounts].sort()) lines.push(`Account: ${account}`);
    lines.push(`${row.attempts.length} rejected ${row.attempts.length === 1 ? "payment" : "payments"} · Attempted ${usd(row.attemptedCents)}`);
    for (const tx of row.attempts.sort((a, b) => Date.parse(a.date) - Date.parse(b.date) || a.id.localeCompare(b.id))) {
      const merchant = clean(tx.merchantData?.description ?? tx.description);
      lines.push(`• ${timeFormatter.format(Date.parse(tx.date))} · ${merchant} · ${usd(Math.abs(tx.amountCents))}`,
        `  Reason: ${tx.declineReason ? clean(tx.declineReason, 200) : "Not provided by Slash"}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
