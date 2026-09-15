import type { SlashCard, SlashTransaction, SlashVirtualAccountBalance } from "../shared/slashApi";

export const slashCashbackTargetRate = 0.023;
const dayMs = 86_400_000;
const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Beirut", year: "numeric", month: "2-digit", day: "2-digit"
});

function localDate(timestamp: number): string {
  return dateFormatter.format(timestamp);
}

function dayStart(date: string): number {
  const utcMidnight = Date.parse(`${date}T00:00:00Z`);
  let low = utcMidnight - dayMs;
  let high = utcMidnight + dayMs;
  // Find the first instant of the local date, including skipped/repeated midnight at DST.
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (localDate(middle) < date) low = middle + 1;
    else high = middle;
  }
  return low;
}

export function slashCashbackReportPeriod(asOf: number): { date: string; fromTime: number; toTime: number } {
  if (!Number.isFinite(asOf)) throw new Error("Invalid Slash cashback report date");
  const today = localDate(asOf);
  const date = new Date(Date.parse(`${today}T12:00:00Z`) - dayMs).toISOString().slice(0, 10);
  return { date, fromTime: dayStart(date), toTime: dayStart(today) };
}

interface CardCashback {
  card: SlashCard;
  accounts: Set<string>;
  purchases: number;
  spendCents: number;
  knownSpendCents: number;
  cashbackCents: number;
  expectedCents: number;
  shortfallCents: number;
  belowTarget: number;
  missingCount: number;
  missingSpendCents: number;
  missingExpectedCents: number;
}

const usd = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const cleanName = (name: string) => name.replace(/\s+/gu, " ").trim().slice(0, 100);

export function buildTelegramSlashCashbackReport(input: {
  transactions: readonly SlashTransaction[];
  cards: readonly SlashCard[];
  accounts: readonly SlashVirtualAccountBalance[];
  asOf: number;
}): string {
  const period = slashCashbackReportPeriod(input.asOf);
  const cards = new Map(input.cards.map((card) => [card.id, card]));
  const accounts = new Map(input.accounts.map((account) => [account.id, account]));
  const groups = new Map<string, CardCashback>();
  const seen = new Set<string>();
  for (const tx of input.transactions) {
    if (tx.status !== "posted" || !tx.cardId || tx.amountCents >= 0) continue;
    const time = Date.parse(tx.date);
    if (!Number.isFinite(time) || !Number.isSafeInteger(tx.amountCents)) throw new Error("Invalid Slash purchase");
    if (time < period.fromTime || time >= period.toTime) continue;
    const key = JSON.stringify([tx.accountId, tx.id]);
    if (seen.has(key)) continue;
    seen.add(key);
    const card = cards.get(tx.cardId);
    if (!card || !/^\d{4}$/u.test(card.last4)) throw new Error("Slash card details are incomplete");
    const cardKey = JSON.stringify([tx.accountId, tx.cardId]);
    const group = groups.get(cardKey) ?? {
      card, accounts: new Set<string>(), purchases: 0, spendCents: 0, knownSpendCents: 0,
      cashbackCents: 0, expectedCents: 0, shortfallCents: 0, belowTarget: 0,
      missingCount: 0, missingSpendCents: 0, missingExpectedCents: 0
    };
    const account = tx.virtualAccountId ? accounts.get(tx.virtualAccountId) : undefined;
    group.accounts.add(account ? cleanName(account.name) : `Virtual account unavailable (${cleanName(tx.accountId)})`);
    const spend = -tx.amountCents;
    // Integer arithmetic expresses 2.3% without binary floating-point threshold drift.
    if (!Number.isSafeInteger(spend * 23)) throw new Error("Slash purchase exceeds the cashback calculation limit");
    const expected = Math.round(spend * 23 / 1000);
    group.purchases += 1;
    group.spendCents += spend;
    if (!tx.cashbackInfo) {
      group.missingCount += 1;
      group.missingSpendCents += spend;
      group.missingExpectedCents += expected;
    } else {
      const { amountCents, rate } = tx.cashbackInfo;
      if (!Number.isSafeInteger(amountCents) || amountCents < 0 || !Number.isFinite(rate) || rate < 0) {
        throw new Error("Invalid Slash cashback data");
      }
      group.knownSpendCents += spend;
      group.cashbackCents += amountCents;
      group.expectedCents += expected;
      // Accept per-purchase cent rounding, but still flag an explicitly lower provider rate.
      if (rate < slashCashbackTargetRate - 1e-10 || amountCents < Math.floor(spend * 23 / 1000)) {
        group.belowTarget += 1;
        group.shortfallCents += Math.max(0, expected - amountCents);
      }
    }
    for (const amount of [group.spendCents, group.knownSpendCents, group.cashbackCents, group.expectedCents,
      group.shortfallCents, group.missingSpendCents, group.missingExpectedCents]) {
      if (!Number.isSafeInteger(amount)) throw new Error("Slash cashback totals exceed the calculation limit");
    }
    groups.set(cardKey, group);
  }
  const flagged = [...groups.values()].filter((row) => row.belowTarget > 0 || row.missingCount > 0)
    .sort((a, b) => b.shortfallCents - a.shortfallCents || b.missingSpendCents - a.missingSpendCents || a.card.id.localeCompare(b.card.id));
  const lines = ["💳 Daily Slash cashback report", `${period.date} · Beirut · Target 2.3%`, ""];
  if (groups.size === 0) return [...lines, "No posted Slash card purchases for this date."].join("\n");
  if (flagged.length === 0) return [...lines, `✅ All ${groups.size} cards with posted purchases met the 2.3% target (allowing cent rounding).`].join("\n");
  const totalShortfall = flagged.reduce((sum, row) => sum + row.shortfallCents, 0);
  if (!Number.isSafeInteger(totalShortfall)) throw new Error("Slash cashback shortfall exceeds the calculation limit");
  lines.push(`${flagged.length} of ${groups.size} cards need review`,
    `${flagged.filter((row) => row.belowTarget > 0).length} below target · ${flagged.filter((row) => row.missingCount > 0).length} with missing cashback data`,
    `Reported cashback shortfall: ${usd(totalShortfall)}`, "");
  for (const row of flagged) {
    lines.push(`${row.card.name ? `${cleanName(row.card.name)} · ` : ""}Card ••${row.card.last4}`);
    // Keep each line bounded so a large report can be split without dropping cards.
    for (const account of [...row.accounts].sort()) lines.push(`Account: ${account}`);
    lines.push(`Posted spend: ${usd(row.spendCents)} · ${row.purchases} purchases`);
    if (row.knownSpendCents > 0) {
      const rate = (row.cashbackCents / row.knownSpendCents * 100).toFixed(2);
      lines.push(`Cashback: ${usd(row.cashbackCents)} on ${usd(row.knownSpendCents)} · ${rate}%`,
        `Expected at 2.3%: ${usd(row.expectedCents)}`);
    }
    if (row.belowTarget > 0) lines.push(`Below target: ${row.belowTarget} purchases · Shortfall ${usd(row.shortfallCents)}`);
    if (row.missingCount > 0) lines.push(`⚠️ Cashback not reported: ${row.missingCount} purchases / ${usd(row.missingSpendCents)} · Target ${usd(row.missingExpectedCents)}`);
    lines.push("");
  }
  lines.push("Posted purchases only; pending charges, refunds and transfers excluded.",
    "Missing cashback is unconfirmed and excluded from the shortfall. Higher rewards do not offset purchases below target.");
  return lines.join("\n");
}
