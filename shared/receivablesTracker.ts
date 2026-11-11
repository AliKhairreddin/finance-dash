import { invoiceOutstanding, invoicePaymentIdentityMatched } from "./income";
import { transactionBusinessCategory } from "./categories";
import { isCurrentBankTransactionId, isLegacySurrogateBankTransactionId } from "./providerIdentity";
import { historicalWiseTransferKey } from "./historicalPaymentMatch";
import type { Invoice, PaymentAllocation, Provider, Transaction } from "./types";

export type TrackerKind = "invoice" | "earnings" | "manual" | "tariq" | "monthly";
export interface TrackerItem {
  key: string; payer: string; providerId?: string; entity?: string; currency: string; amount: number;
  kind: TrackerKind; period?: string; category?: string; stream?: string; invoiceId?: string; reference?: string; accountId?: string;
  expectedDate?: string; dateBasis?: string; dateConfidence?: string; dateOverride?: boolean; week: string;
  rejectedTransactions?: string[]; payerSent: boolean; review?: string; checkedDate?: string; sent: boolean; archived: boolean;
  createdAt: string; updatedAt: string; revision: number;
}
export interface TrackerReceipt {
  key: string; itemKey: string; transactionId?: string; amount: number; currency: string; bankAmount: number;
  bankCurrency: string; paidAt: string; bank: string; account: string; reference?: string; evidence: string;
  actor: string; state: "active" | "reversed" | "transferred"; createdAt: string; reversedAt?: string; reversalReason?: string;
}
export interface TrackerRule { payer: string; kind: "weekly" | "monthly" | "hint"; slots: number[]; label: string; approved: boolean; stream?: string }
export interface TrackerReportRow {
  key: string; week: string; section: TrackerKind; payer: string; amount: number; currency?: string; displayedCurrency?: string;
  reference?: string; period?: string; source?: string; category?: string; expected?: string; paid: boolean; line?: string;
  providerId?: string; entity?: string; accountId?: string; invoiceId?: string; stream?: string; confidence: string; raw: string; issue?: string;
}
export const trackerViews = ["This week", "Overdue", "Merit invoices", "ACP + HCP", "To invoice", "Tariq follow-ups", "Needs review", "Received"] as const;
export type TrackerView = typeof trackerViews[number];
export const trackerTimeZone = "Asia/Beirut";
export function trackerClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: trackerTimeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const p = (type: string) => parts.find(v => v.type === type)?.value;
  return { date: `${p("year")}-${p("month")}-${p("day")}`, time: `${p("hour")}:${p("minute")}` };
}
export function validTrackerDate(value: string) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }
export function trackerShift(value: string, days: number) { const d = new Date(`${value}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
export function trackerWeek(value: string) { return trackerShift(value, -((new Date(`${value}T12:00:00Z`).getUTCDay() + 6) % 7)); }
export const trackerCents = (amount: number) => Math.round(amount * 100);
export const trackerMoney = (amount: number) => trackerCents(amount) / 100;
export const trackerIdentity = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(?:incorporated|limited|llc|ltd|inc|bv|ou)$/g, "");
const aliases: Record<string, string> = { mediaalpha: "quotelab", smartfinancial: "smartfinancial", sfishan: "smartfinancial", sfolm: "smartfinancial", leadpierolm: "leadpier", madrivomakar: "madrivo", suitedconnectorsuco: "suco", suitedconnector: "suco", thewisdomcompanies: "wisdom", allwebleads: "awl", llamacycloppsglobal: "cyclopps", cycloppsglobal: "cyclopps" };
export const trackerPayer = (value: string) => aliases[trackerIdentity(value)] ?? trackerIdentity(value);
export function trackerProvider(name: string, providers: Provider[]) {
  const matches = providers.filter(p => p.type === "client" && [p.name, p.legalName ?? "", ...p.aliases].some(n => trackerPayer(n) === trackerPayer(name)));
  return matches.length === 1 ? matches[0] : undefined;
}
export const defaultTrackerRules: TrackerRule[] = [
  { payer: "BuyGoods", kind: "weekly", slots: [0, 1, 4], label: "Monday / Tuesday / Friday", approved: true },
  ...[["LeadPier", 1], ["Kissterra", 3], ["Madrivo", 3], ["SuCo", 4], ["EverQuote", 1], ["Wisdom", 1]].map(([payer, day]) => ({ payer: String(payer), kind: "weekly" as const, slots: [Number(day)], label: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"][Number(day)], approved: true })),
  { payer: "QuoteLab", kind: "monthly", slots: [2], label: "2nd of month", approved: true },
  { payer: "SmartFinancial", kind: "monthly", slots: [3], label: "3rd of month", approved: true },
  { payer: "ClickBank", kind: "weekly", slots: [1, 3], label: "Tuesday or Thursday", approved: true },
  ...[["ExchangeFlo", "29th–1st"], ["All Web Leads", "28th–3rd"], ["Cyclopps", "Around the 3rd"], ["QuinStreet", "Observed 16th–18th"], ["Tinera", "22nd–1st; limited history"], ["Avanto Media", "Observed 14th / 16th / 28th"], ["Unlimited Net", "Observed 10th"], ["Cartpanda", "Observed 7th"]].map(([payer, label]) => ({ payer, kind: "hint" as const, slots: [], label, approved: false }))
];
export function resolveTrackerDate(input: { week: string; payer: string; explicit?: string; cycleMonth?: string; slot?: number; stream?: string; forecast?: { date: string; basis: string }; existing?: Pick<TrackerItem, "expectedDate" | "dateBasis" | "dateConfidence"> }, rules = defaultTrackerRules) {
  if (input.existing?.expectedDate) return { expectedDate: input.existing.expectedDate, dateBasis: input.existing.dateBasis, dateConfidence: input.existing.dateConfidence };
  if (input.explicit) {
    if (!validTrackerDate(input.explicit)) throw new Error("Expected date must be a valid calendar date");
    return { expectedDate: input.explicit, dateBasis: "Report / manual date", dateConfidence: "confirmed" };
  }
  const rule = rules.find(r => trackerPayer(r.payer) === trackerPayer(input.payer) && r.stream === input.stream) ?? rules.find(r => trackerPayer(r.payer) === trackerPayer(input.payer) && !r.stream);
  const slot = input.slot ?? (rule?.slots.length === 1 ? rule.slots[0] : undefined);
  if (rule?.approved && slot !== undefined && rule.slots.includes(slot)) {
    if (rule.kind === "weekly") return { expectedDate: trackerShift(input.week, slot), dateBasis: `Operating calendar: ${rule.label}`, dateConfidence: "approved schedule" };
    if (rule.kind === "monthly" && input.cycleMonth && /^\d{4}-\d{2}$/.test(input.cycleMonth)) {
      const date = `${input.cycleMonth}-${String(slot).padStart(2, "0")}`;
      if (validTrackerDate(date)) return { expectedDate: date, dateBasis: `Operating calendar: ${rule.label}`, dateConfidence: "approved schedule" };
    }
  }
  if (input.forecast && validTrackerDate(input.forecast.date)) return { expectedDate: input.forecast.date, dateBasis: input.forecast.basis, dateConfidence: "estimate" };
  return {};
}
export function trackerAmounts(item: TrackerItem, receipts: TrackerReceipt[], invoices: Invoice[], payments: PaymentAllocation[]) {
  const invoice = item.invoiceId ? invoices.find(i => i.id === item.invoiceId) : undefined;
  const received = invoice ? trackerMoney(payments.filter(p => p.invoiceId === invoice.id).reduce((sum, p) => sum + p.amount, 0)) : trackerMoney(receipts.filter(a => a.itemKey === item.key && a.state === "active").reduce((s, a) => s + a.amount, 0));
  const amount = invoice?.amount ?? item.amount;
  const outstanding = invoice ? (invoice.status === "paid" ? 0 : invoiceOutstanding(invoice, payments)) : Math.max(0, trackerMoney(amount - received));
  return { amount, received, outstanding, currency: invoice?.currency ?? item.currency,
    status: outstanding <= 0 && amount > 0 ? "Received" : received > 0 ? "Partially received" : item.payerSent ? "Paid by payer / awaiting receipt" : "Open" };
}
export function trackerTiming(item: Pick<TrackerItem, "expectedDate">, outstanding: number, date = trackerClock().date) {
  if (!outstanding) return "Received";
  if (!item.expectedDate) return "Confirm date";
  if (date >= trackerShift(item.expectedDate, 2)) return "Overdue";
  if (date === trackerShift(item.expectedDate, 1)) return "Grace day";
  return date === item.expectedDate ? "Due today" : "Expected";
}
export function trackerInView(item: TrackerItem, amounts: ReturnType<typeof trackerAmounts>, view: TrackerView, date = trackerClock().date) {
  if (item.archived) return false;
  if (item.kind === "monthly") return view === "To invoice" && !item.sent;
  if (view === "Received") return amounts.status === "Received";
  if (view === "To invoice") return (item.kind === "tariq" && amounts.status === "Received" && !item.invoiceId);
  if (view === "Tariq follow-ups") return item.kind === "tariq" && amounts.outstanding > 0;
  if (view === "Needs review") return Boolean(item.review || (!item.expectedDate && amounts.outstanding > 0));
  if (view === "Merit invoices") return Boolean(item.invoiceId) && amounts.outstanding > 0;
  if (view === "ACP + HCP") return item.kind === "earnings" && amounts.outstanding > 0;
  if (view === "Overdue") return trackerTiming(item, amounts.outstanding, date) === "Overdue";
  return amounts.outstanding > 0 && Boolean(item.expectedDate && item.expectedDate >= trackerWeek(date) && item.expectedDate <= trackerShift(trackerWeek(date), 6));
}
export function sameTrackerReceipt(a?: string, b?: string) { return Boolean(a && b && (a === b || (historicalWiseTransferKey(a) && historicalWiseTransferKey(a) === historicalWiseTransferKey(b)))); }
export function trackerBankEligible(t: Transaction) {
  return (t.source === "wise" || t.source === "revolut" || t.source === "slash" || t.source === "mercury" || t.source === "flex" || t.source === "amex") && t.direction === "in" && ["posted", "settled"].includes(t.status) && t.amount > 0.01
    && isCurrentBankTransactionId(t.source, t.id) && !isLegacySurrogateBankTransactionId(t.source, t.id)
    && ["Media buying direct", "Affiliate team revenue", "Partner network revenue"].includes(transactionBusinessCategory(t.category))
    && !/\b(refund|reversal|chargeback|test payment|internal transfer|capital contribution|card settlement)\b/i.test(`${t.category} ${t.reference ?? ""} ${t.description}`);
}
export function trackerMatchReason(item: TrackerItem, t: Transaction, provider: Provider | undefined, remaining: number): string | undefined {
  if (item.rejectedTransactions?.some(id => sameTrackerReceipt(id, t.id))) return "Administrator rejected this candidate";
  if (!trackerBankEligible(t)) return "Receipt is not a completed external business credit";
  if (t.currency !== item.currency) return "Currency differs";
  const entity = t.wiseEntity ?? t.mercuryEntity ?? t.slashEntity;
  if (!item.entity || (entity && entity !== item.entity) || (!entity && (!item.accountId || t.accountId !== item.accountId))) return "Confirm receiving entity / account";
  if (item.accountId && t.accountId !== item.accountId) return "Different receiving account";
  if (!provider || !invoicePaymentIdentityMatched({ ...t, description: t.reference ?? "" }, { providerId: provider.id, customerName: provider.name, invoiceNumber: item.reference ?? "" } as Invoice, provider, false)) return "Payer identity or reference needs review";
  if (!item.expectedDate || t.date.slice(0, 10) < trackerShift(item.expectedDate, -14) || t.date.slice(0, 10) > trackerShift(item.expectedDate, 60)) return "Receipt falls outside the expected window";
  if (trackerCents(t.amount) !== trackerCents(remaining)) return "Amount differs; review partial, fee, FX or combined receipt";
  return undefined;
}

/** Small RFC4180 parser; quoted newlines and commas remain part of a field. */
export function trackerCsv(text: string): string[][] {
  if (text.length > 500_000) throw new Error("Report exceeds 500 KB");
  const rows: string[][] = []; let row: string[] = [], value = "", quoted = false;
  for (let n = 0; n < text.length; n++) {
    const c = text[n];
    if (c === '"') { if (quoted && text[n + 1] === '"') { value += '"'; n++; } else quoted = !quoted; }
    else if (!quoted && (c === "," || c === "\n")) { row.push(value.replace(/\r$/, "")); value = ""; if (c === "\n") { if (row.some(Boolean)) rows.push(row); row = []; } }
    else value += c;
  }
  if (quoted) throw new Error("Report has an unfinished quoted field");
  row.push(value.replace(/\r$/, "")); if (row.some(Boolean)) rows.push(row);
  if (rows.length > 501) throw new Error("Use at most 500 report rows");
  return rows;
}
export function trackerSourceKey(row: TrackerReportRow) {
  return [row.section, trackerPayer(row.payer), row.entity ?? "", row.period ?? "", row.source ?? "", row.category ?? "", row.stream ?? "", row.reference ?? "", row.line ?? ""].join("|");
}
export function parseTrackerCsv(text: string, week: string): TrackerReportRow[] {
  const [headers, ...rows] = trackerCsv(text.replace(/^\uFEFF/, ""));
  if (!headers || !headers.includes("payer") || !headers.includes("amount")) throw new Error("CSV needs payer and amount columns");
  return rows.map((cells, index) => {
    const r = Object.fromEntries(headers.map((h, i) => [h.trim().toLowerCase(), cells[i]?.trim() ?? ""]));
    const kind = ["invoice", "earnings", "manual", "tariq", "monthly"].includes(r.section) ? r.section as TrackerKind : "manual";
    const result: TrackerReportRow = { key: String(index + 1), week: r.week || week, section: kind, payer: r.payer, amount: Number(r.amount.replace(/,/g, "")), paid: /^(1|true|paid|settled)$/i.test(r.paid), confidence: "source text", raw: JSON.stringify(r) };
    const fields = { currency: r.currency, displayedCurrency: r.displayed_currency, reference: r.reference, period: r.period, source: r.source, category: r.category, expected: r.expected, line: r.line, entity: r.entity, providerId: r.provider_id, accountId: r.account_id, invoiceId: r.invoice_id, stream: r.stream };
    Object.assign(result, Object.fromEntries(Object.entries(fields).filter(([, value]) => value)));
    if (!/^(0|1|true|false|paid|settled|open|unpaid)$/i.test(r.paid)) result.issue = "Confirm paid/open marker";
    if (!r.amount || !Number.isFinite(result.amount) || result.amount < 0) result.issue = "Confirm amount";
    if (!validTrackerDate(result.week) || trackerWeek(result.week) !== result.week) result.issue = "Select the reporting Monday";
    return result;
  });
}
export function trackerGroupKey(row: TrackerReportRow) {
  if (row.section === "monthly") return `monthly:${trackerPayer(row.payer)}:${row.payer}:${row.period ?? row.week.slice(0, 7)}`;
  if (row.invoiceId) return `invoice:${row.invoiceId}`;
  if (row.section === "invoice") return `unresolved:${trackerSourceKey(row)}`;
  return [row.section, row.providerId ?? trackerPayer(row.payer), row.entity ?? "", row.currency ?? "", row.period ?? "", row.category ?? "", row.stream ?? "", row.expected ?? ""].join(":");
}
