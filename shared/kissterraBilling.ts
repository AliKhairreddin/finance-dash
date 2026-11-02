import { buildRevenueDraft, isClosedBillingPeriod, revenueInvoiceId } from "./income";
import { nextMeritInvoiceNumber } from "./invoiceNumbers";
import { meritInvoiceLineDescription } from "./merit";
import type { Invoice, MeritTax, Provider, RevenueAccrual, RevenuePartner, RevenueRun, UpdateInvoicePayload } from "./types";

export const kissterraBillingGroup = "revenue-kissterra-weekly";
type Period = { periodStart: string; periodEnd: string };
type BillingState = { invoices: Invoice[]; providers: Provider[]; revenueRuns: RevenueRun[]; revenueAccruals: RevenueAccrual[] };
const cents = (amount: number) => Math.round(amount * 100);

export function isKissterraPartner(partner: RevenuePartner): boolean {
  return partner.source === "tune" && partner.networkIdEnv === "KISSTERRA_TUNE_NETWORK_ID";
}

export function kissterraBillingPartners(partners: RevenuePartner[], manual = false): RevenuePartner[] {
  return partners.filter(p => isKissterraPartner(p) && p.enabled && (manual || p.autoDraft)).map(p => manual ? { ...p, autoDraft: true } : p);
}

export function existingKissterraInvoices(state: Pick<BillingState, "invoices" | "revenueRuns">, partners: RevenuePartner[], period: Period): Invoice[] {
  const ids = new Set(partners.map(p => p.id));
  const runIds = new Set(state.revenueRuns.filter(r => ids.has(r.partnerId) && r.periodStart === period.periodStart && r.periodEnd === period.periodEnd).map(r => r.id));
  return state.invoices.filter(i =>
    (i.periodStart === period.periodStart && i.periodEnd === period.periodEnd &&
      (i.billingRuleId === kissterraBillingGroup || ids.has(i.billingRuleId ?? "") || i.revenueLines?.some(l => ids.has(l.billingRuleId)))) ||
    i.revenueRunIds.some(id => runIds.has(id))
  );
}

/** All members must succeed for this period before any invoice is created. */
export function draftKissterraWeek(state: BillingState, partners: RevenuePartner[], runs: RevenueRun[], period: Period, now = new Date()): Invoice | undefined {
  const existing = existingKissterraInvoices(state, partners, period);
  if (existing.length > 1) throw new Error("This Kissterra week already has multiple invoices; review the existing invoices before drafting");
  if (existing[0]) return existing[0];
  if (!partners.length) throw new Error("No Kissterra accounts are enabled for weekly billing");
  const first = partners[0];
  const provider = state.providers.find(p => p.id === first.providerId);
  if (!provider) throw new Error("Kissterra customer no longer exists");
  const taxId = first.defaultMeritTaxId ?? provider.defaultMeritTaxId;
  const matched = partners.map(partner => {
    if (!isKissterraPartner(partner) || !partner.enabled || !partner.autoDraft || partner.billingCadence !== "weekly" ||
      partner.providerId !== first.providerId || partner.currency !== first.currency || partner.billingTimezone !== first.billingTimezone ||
      (partner.defaultMeritTaxId ?? provider.defaultMeritTaxId) !== taxId) {
      throw new Error("Kissterra accounts must share a weekly schedule, customer, currency, and tax rate");
    }
    const candidates = runs.filter(r => r.partnerId === partner.id && r.periodStart === period.periodStart && r.periodEnd === period.periodEnd);
    const run = candidates[0];
    if (candidates.length !== 1 || !run || !["pulled", "drafted", "invoiced"].includes(run.status) || !Number.isFinite(run.revenue) ||
      run.currency !== partner.currency || run.providerId !== partner.providerId || !isClosedBillingPeriod(partner, run, now)) {
      throw new Error(`Kissterra invoice waits for a complete successful weekly report: ${partner.name}`);
    }
    return { partner, run };
  });
  if (matched.some(({ run }) => run.draftDeletedAt)) return undefined;
  const positive = matched.filter(({ run }) => cents(run.revenue) > 0);
  if (!positive.length) return undefined;
  const lines = positive.map(({ partner, run }) => {
    const label = /^Kissterra — (.+) \(Account ID: (\d+)\)$/.exec(partner.name);
    if (!label || (partner.source === "tune" && partner.affiliateId && partner.affiliateId !== label[2])) {
      throw new Error(`Kissterra account name and ID must be verified before billing: ${partner.name}`);
    }
    return { accountId: label[2], accountName: label[1], billingRuleId: partner.id, revenueRunId: run.id,
      description: `${partner.name} — ${run.revenueCategory || "Partner network revenue"}`, amount: cents(run.revenue) / 100,
      ...(partner.defaultMeritItemCode ? { itemCode: partner.defaultMeritItemCode } : {}) };
  }).sort((a, b) => Number(a.accountId) - Number(b.accountId));
  const draft = buildRevenueDraft(positive[0].partner, positive[0].run, provider, nextMeritInvoiceNumber(state.invoices, now.toISOString().slice(0, 10)), now);
  const invoice: Invoice = { ...draft, id: revenueInvoiceId(kissterraBillingGroup, period.periodStart, period.periodEnd),
    billingRuleId: kissterraBillingGroup, amount: lines.reduce((sum, line) => sum + cents(line.amount), 0) / 100,
    description: `Kissterra weekly revenue for ${period.periodStart} to ${period.periodEnd}: ${lines.map(l => `${l.accountName} (Account ID: ${l.accountId})`).join("; ")}`,
    revenueLines: lines, revenueRunIds: lines.map(l => l.revenueRunId) };
  validateRevenueInvoiceLines(invoice);
  state.invoices = [invoice, ...state.invoices];
  const billed = new Set(invoice.revenueRunIds);
  state.revenueRuns = state.revenueRuns.map(run => {
    if (!billed.has(run.id)) return run;
    const { draftDeletedAt: _deletedAt, error: _error, ...verified } = run;
    return { ...verified, status: "drafted", invoiceId: invoice.id };
  });
  const partnerIds = new Set(partners.map(p => p.id));
  state.revenueAccruals = state.revenueAccruals.filter(a => !(partnerIds.has(a.partnerId) && a.periodStart === period.periodStart && a.periodEnd === period.periodEnd));
  return invoice;
}

export function validateRevenueInvoiceLines(invoice: Pick<Invoice, "revenueLines" | "amount" | "periodStart" | "periodEnd">): void {
  const lines = invoice.revenueLines;
  if (!lines) return;
  if (!lines.length || !invoice.periodStart || !invoice.periodEnd || !Number.isFinite(invoice.amount) ||
    lines.some(l => !/^\d+$/.test(l.accountId) || !l.accountName.trim() || !l.billingRuleId || !l.revenueRunId ||
      !l.description.includes(`Account ID: ${l.accountId}`) || !l.description.includes(l.accountName) || !Number.isFinite(l.amount) || l.amount <= 0) ||
    new Set(lines.map(l => l.accountId)).size !== lines.length ||
    lines.reduce((sum, line) => sum + cents(line.amount), 0) !== cents(invoice.amount)) {
    throw new Error("Kissterra invoice lines or total do not reconcile");
  }
}

export function validateRevenueInvoiceEdit(invoice: Invoice, update: UpdateInvoicePayload): void {
  if (!invoice.revenueLines) return;
  if (update.amount !== invoice.amount || update.currency !== invoice.currency || update.providerId !== invoice.providerId ||
    update.periodStart !== invoice.periodStart || update.periodEnd !== invoice.periodEnd || update.description !== invoice.description || update.meritCopy) {
    throw new Error("Account revenue lines, customer, currency, and service period are fixed by the verified weekly reports");
  }
  validateRevenueInvoiceLines(invoice);
}

/** The same account rows feed Merit, whose PDF renderer uses InvoiceRow. */
export function meritRevenueLinesRequest(invoice: Pick<Invoice, "revenueLines" | "amount" | "periodStart" | "periodEnd">, tax: MeritTax, itemCode: (code?: string) => string) {
  validateRevenueInvoiceLines(invoice);
  if (!invoice.revenueLines) throw new Error("Revenue invoice lines are missing");
  const rows = invoice.revenueLines.map(line => {
    const description = meritInvoiceLineDescription(line.description, invoice.periodStart, invoice.periodEnd);
    if (!description.includes(line.accountName) || !description.includes(`Account ID: ${line.accountId}`)) throw new Error("Account name and ID exceed Merit's line description limit");
    return { Item: { Code: itemCode(line.itemCode), Description: description, Type: 2 }, Quantity: 1, Price: line.amount, TaxId: tax.id };
  });
  return { InvoiceRow: rows, TaxAmount: [{ TaxId: tax.id, Amount: rows.reduce((sum, row) => sum + cents(row.Price * tax.taxPct / 100), 0) / 100 }], TotalAmount: invoice.amount };
}
