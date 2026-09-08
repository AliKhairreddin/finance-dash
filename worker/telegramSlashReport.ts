import type { SlashTransaction, SlashVirtualAccountBalance } from "../shared/slashApi";

export function slashReportDateIfDue(timestamp: number): string | null {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Beirut", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23"
  }).formatToParts(timestamp);
  const part = (key: Intl.DateTimeFormatPartTypes) => parts.find(p => p.type === key)!.value;
  return Number(part("hour")) >= 17 ? `${part("year")}-${part("month")}-${part("day")}` : null;
}

const usd = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);

export function buildTelegramSlashReport(input: {
  accounts: SlashVirtualAccountBalance[];
  transactions: SlashTransaction[];
  asOf: number;
  reserveUsd: number;
}): string {
  if (!Number.isFinite(input.reserveUsd) || input.reserveUsd < 0) throw new Error("Slash daily reserve must be a nonnegative USD amount");
  const accounts = input.accounts.filter(account => !account.closedAt);
  if (!accounts.length || new Set(accounts.map(a => a.id)).size !== accounts.length || accounts.some(a => !Number.isFinite(a.balance))) {
    throw new Error("Slash balances are incomplete; funding recommendation is unavailable");
  }
  const seen = new Set<string>();
  const spend = new Map<string, { posted: number; pending: number; refunds: number }>();
  for (const tx of input.transactions) {
    const id = `${tx.accountId}:${tx.id}`;
    const time = Date.parse(tx.date);
    if (seen.has(id) || time <= input.asOf - 86_400_000 || time > input.asOf || tx.status === "failed" || !tx.cardId) continue;
    seen.add(id);
    if (!Number.isFinite(time) || !Number.isSafeInteger(tx.amountCents)) throw new Error("Slash returned invalid card activity");
    const key = tx.virtualAccountId ?? "unassigned";
    const totals = spend.get(key) ?? { posted: 0, pending: 0, refunds: 0 };
    if (tx.amountCents < 0) totals[tx.status === "pending" ? "pending" : "posted"] += -tx.amountCents / 100;
    else if (tx.status === "posted") totals.refunds += tx.amountCents / 100;
    spend.set(key, totals);
  }
  const totals = [...spend.values()].reduce((sum, row) => ({ posted: sum.posted + row.posted, pending: sum.pending + row.pending, refunds: sum.refunds + row.refunds }), { posted: 0, pending: 0, refunds: 0 });
  const balance = accounts.reduce((sum, a) => sum + a.balance, 0);
  const label = (time: number) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Beirut", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(time);
  const unknownSpend = [...spend].filter(([id]) => !accounts.some(a => a.id === id)).reduce((sum, [, row]) => sum + row.posted + row.pending, 0);
  const lines = ["💳 Daily Slash funding report", `${label(input.asOf - 86_400_000)} – ${label(input.asOf)} · Beirut`, "",
    `Last 24h card spend: ${usd(totals.posted)}`, `Pending card spend: ${usd(totals.pending)}`, `Posted card refunds: ${usd(totals.refunds)}`,
    `Available in Slash: ${usd(balance)}`, ""];
  let totalTopUp = 0;
  for (const account of accounts.sort((a, b) => a.name.localeCompare(b.name))) {
    const activity = spend.get(account.id);
    // Available balances already reflect pending authorizations. Use gross recent
    // activity as tomorrow's budget, without deducting volatile refunds from it.
    const dailySpend = (activity?.posted ?? 0) + (activity?.pending ?? 0);
    const topUp = Math.max(0, dailySpend + input.reserveUsd - account.balance);
    totalTopUp += topUp;
    lines.push(`${account.name.replace(/\s+/g, " ").slice(0, 100)}`, `• Available ${usd(account.balance)} · 24h spend ${usd(dailySpend)}`, `• Suggested transfer ${usd(topUp)}`, "");
  }
  lines.push(unknownSpend > 0 ? "⚠️ Total recommendation unavailable: card spend has no open virtual-account match." : `Suggested total transfer: ${usd(totalTopUp)}`);
  if (unknownSpend > 0) lines.push(`Unassigned / closed-account card spend: ${usd(unknownSpend)}`);
  lines.push(`Planning rule: cover one more day at the last 24h gross card-spend rate, plus ${usd(input.reserveUsd)} reserve per open account.`, "Cash transfers and card repayments are excluded from spend. No payment or transfer is made.");
  return lines.join("\n");
}
