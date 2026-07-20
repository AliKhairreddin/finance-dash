import type {
  AccountBalance,
  ApproximateUsdTotals,
  FxRate,
  Holding,
  Invoice,
  InvoicePaymentPrediction,
  PaymentAllocation,
  PaymentSource,
  Provider,
  RevenueAccrual,
  RevenuePartner,
  RevenueRun,
  Transaction
} from "./types";

const dayMs = 24 * 60 * 60 * 1000;
const weekdayByName: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
};

export const incomeAutomationTimezone = "Asia/Beirut" as const;

export interface DatePeriod {
  periodStart: string;
  periodEnd: string;
}

interface ZonedParts {
  date: string;
  year: number;
  month: number;
  day: number;
  weekday: number;
  hour: number;
  minute: number;
}

export function isLebanonIncomeAutomationTime(scheduledTime: number | Date): boolean {
  const date = scheduledTime instanceof Date ? scheduledTime : new Date(scheduledTime);
  const parts = zonedParts(date, incomeAutomationTimezone);
  return parts.weekday === 1 && parts.hour === 9 && parts.minute === 0;
}

export function previousCompletedWeek(now = new Date(), timezone: string = incomeAutomationTimezone): DatePeriod {
  const current = zonedParts(now, timezone);
  const daysSinceMonday = (current.weekday + 6) % 7;
  const thisMonday = addDays(current.date, -daysSinceMonday);
  return {
    periodStart: addDays(thisMonday, -7),
    periodEnd: addDays(thisMonday, -1)
  };
}

export function currentWeekAccrualPeriod(
  now = new Date(),
  timezone: string = incomeAutomationTimezone
): DatePeriod & { accruedThrough: string } {
  const current = zonedParts(now, timezone);
  const daysSinceMonday = (current.weekday + 6) % 7;
  const periodStart = addDays(current.date, -daysSinceMonday);
  return {
    periodStart,
    periodEnd: addDays(periodStart, 6),
    accruedThrough: current.date
  };
}

export function currentMonthAccrualPeriod(
  now = new Date(),
  timezone: string = incomeAutomationTimezone
): (DatePeriod & { accruedThrough: string }) | undefined {
  const current = zonedParts(now, timezone);
  const daysSinceMonday = (current.weekday + 6) % 7;
  const thisMonday = addDays(current.date, -daysSinceMonday);
  const accruedThrough = addDays(thisMonday, -1);
  const periodStart = `${current.year}-${pad2(current.month)}-01`;
  if (accruedThrough < periodStart) return undefined;
  return {
    periodStart,
    periodEnd: lastDayOfMonth(periodStart),
    accruedThrough
  };
}

export function previousCalendarMonth(now = new Date(), timezone: string = incomeAutomationTimezone): DatePeriod {
  const current = zonedParts(now, timezone);
  const currentMonthStart = `${current.year}-${pad2(current.month)}-01`;
  const periodEnd = addDays(currentMonthStart, -1);
  return {
    periodStart: `${periodEnd.slice(0, 7)}-01`,
    periodEnd
  };
}

export function isClosedBillingPeriod(partner: RevenuePartner, run: RevenueRun, now = new Date()): boolean {
  const today = zonedParts(now, partner.billingTimezone).date;
  if (run.periodEnd >= today) return false;
  if (partner.billingCadence === "weekly") {
    const start = new Date(`${run.periodStart}T00:00:00Z`);
    const end = new Date(`${run.periodEnd}T00:00:00Z`);
    return (
      Number.isFinite(start.getTime()) &&
      Number.isFinite(end.getTime()) &&
      start.getUTCDay() === 1 &&
      end.getUTCDay() === 0 &&
      end.getTime() - start.getTime() === 6 * dayMs
    );
  }
  return run.periodStart.endsWith("-01") && lastDayOfMonth(run.periodStart) === run.periodEnd;
}

export function revenueInvoiceId(partnerId: string, periodStart: string, periodEnd: string): string {
  return `invoice-revenue-${slug(partnerId)}-${periodStart}-${periodEnd}`;
}

export function revenueInvoiceNumber(partnerId: string, periodStart: string, periodEnd: string): string {
  return `FD-${slug(partnerId).toUpperCase().slice(-12)}-${periodStart.replaceAll("-", "")}-${periodEnd.replaceAll("-", "")}`;
}

export function buildRevenueDraft(partner: RevenuePartner, run: RevenueRun, now = new Date()): Invoice {
  if (!partner.autoDraft) throw new Error(`Automatic drafting is disabled for ${partner.name}`);
  if (!isClosedBillingPeriod(partner, run, now)) throw new Error("Revenue run is not a closed billing period");
  if (run.revenue <= 0) throw new Error("Revenue draft amount must be positive");

  const createdAt = now.toISOString();
  const issueDate = createdAt.slice(0, 10);
  return {
    id: revenueInvoiceId(partner.id, run.periodStart, run.periodEnd),
    providerId: run.providerId ?? partner.providerId,
    documentType: "sales_invoice",
    origin: "revenue",
    customerName: partner.meritCustomerName || partner.name,
    amount: run.revenue,
    currency: run.currency.toUpperCase(),
    status: "draft",
    meritDeliveryStatus: "not-sent",
    invoiceNumber: revenueInvoiceNumber(partner.id, run.periodStart, run.periodEnd),
    issueDate,
    dueDate: addDays(issueDate, Math.max(0, partner.invoiceDueDays)),
    source: "tune",
    description: `${run.revenueCategory || "Revenue"} from ${run.partnerName} for ${run.periodStart} to ${run.periodEnd}`,
    billingRuleId: partner.id,
    revenueRunIds: [run.id],
    periodStart: run.periodStart,
    periodEnd: run.periodEnd,
    taxId: partner.defaultMeritTaxId,
    createdAt,
    updatedAt: createdAt
  };
}

export function invoiceAllocatedAmount(invoiceId: string, allocations: PaymentAllocation[]): number {
  return Number(
    allocations
      .filter((allocation) => allocation.invoiceId === invoiceId)
      .reduce((total, allocation) => total + allocation.amount, 0)
      .toFixed(2)
  );
}

export function invoiceOutstanding(invoice: Invoice, allocations: PaymentAllocation[]): number {
  return Math.max(0, Number((invoice.amount - invoiceAllocatedAmount(invoice.id, allocations)).toFixed(2)));
}

export function applyPaymentState(invoices: Invoice[], allocations: PaymentAllocation[]): Invoice[] {
  return invoices.map((invoice) => {
    if (invoice.status === "draft") return invoice;
    const invoiceAllocations = allocations.filter((allocation) => allocation.invoiceId === invoice.id);
    const outstanding = invoiceOutstanding(invoice, allocations);
    if (outstanding > 0) {
      const { paidAt: _paidAt, ...withoutPaidAt } = invoice;
      return { ...withoutPaidAt, status: "open" };
    }
    const paidAt = invoiceAllocations.reduce(
      (latest, allocation) => (allocation.paidAt > latest ? allocation.paidAt : latest),
      invoice.paidAt ?? ""
    );
    return { ...invoice, status: "paid", paidAt: paidAt || invoice.updatedAt };
  });
}

export function calculateInvoicePredictions(
  invoices: Invoice[],
  allocations: PaymentAllocation[]
): InvoicePaymentPrediction[] {
  const paymentHistory = invoices
    .filter((invoice) => invoice.status === "paid" && invoice.providerId && invoice.paidAt)
    .flatMap((invoice) => {
      const invoiceAllocations = allocations.filter((allocation) => allocation.invoiceId === invoice.id);
      if (invoiceAllocations.length === 0 || invoiceAllocations.some((allocation) => !allocation.transactionId)) return [];
      return [
        {
          providerId: invoice.providerId as string,
          currency: invoice.currency,
          paidAt: invoice.paidAt as string,
          delayDays: calendarDayDifference(invoice.issueDate, invoice.paidAt as string)
        }
      ];
    });

  return invoices
    .filter((invoice) => invoice.status === "open")
    .map((invoice) => {
      const history = paymentHistory
        .filter((payment) => payment.providerId === invoice.providerId && payment.currency === invoice.currency)
        .sort((left, right) => right.paidAt.localeCompare(left.paidAt))
        .slice(0, 5);
      if (history.length < 5) return { invoiceId: invoice.id, sampleSize: history.length };
      const delays = history.map((payment) => payment.delayDays).sort((left, right) => left - right);
      const medianDays = delays[2];
      return {
        invoiceId: invoice.id,
        sampleSize: 5,
        predictedDate: addDays(invoice.issueDate, medianDays),
        medianDays,
        earliestDays: delays[0],
        latestDays: delays[4]
      };
    });
}

export function reconcileExactInvoicePayments({
  invoices,
  transactions,
  allocations,
  providers,
  now = new Date()
}: {
  invoices: Invoice[];
  transactions: Transaction[];
  allocations: PaymentAllocation[];
  providers: Provider[];
  now?: Date;
}): { invoices: Invoice[]; transactions: Transaction[]; allocations: PaymentAllocation[]; matched: number } {
  let nextInvoices = [...invoices];
  let nextAllocations = [...allocations];
  let matched = 0;
  const providerById = new Map(providers.map((provider) => [provider.id, provider]));
  const nextTransactions = transactions.map((transaction) => {
    if (
      transaction.direction !== "in" ||
      (transaction.status !== "posted" && transaction.status !== "settled") ||
      !isPaymentSource(transaction.source) ||
      nextAllocations.some((allocation) => allocation.transactionId === transaction.id)
    ) {
      return transaction;
    }

    const transactionText = normalizedText(
      [transaction.counterparty, transaction.rawName, transaction.description].join(" ")
    );
    const candidates = nextInvoices.filter((invoice) => {
      if (
        invoice.documentType !== "sales_invoice" ||
        invoice.status !== "open" ||
        invoice.currency.toUpperCase() !== transaction.currency.toUpperCase()
      ) return false;
      if (transaction.date < invoice.issueDate) return false;
      if (Math.abs(invoiceOutstanding(invoice, nextAllocations) - Math.abs(transaction.amount)) > 0.01) return false;
      const provider = invoice.providerId ? providerById.get(invoice.providerId) : undefined;
      const providerNames = [provider?.name, provider?.legalName, ...(provider?.aliases ?? []), invoice.customerName]
        .filter(Boolean)
        .map((value) => normalizedText(String(value)))
        .filter((value) => value.replaceAll(" ", "").length >= 3);
      const confirmedProviderMatched = Boolean(
        invoice.providerId &&
        invoice.providerId === transaction.matchedProviderId &&
        transaction.confidence === 1
      );
      const providerNameMatched = providerNames.some((value) => containsNormalizedPhrase(transactionText, value));
      const referenceMatched = [invoice.invoiceNumber, invoice.externalId]
        .filter(Boolean)
        .some((value) => containsNormalizedPhrase(transactionText, normalizedText(String(value))));
      return confirmedProviderMatched || providerNameMatched || referenceMatched;
    });
    if (candidates.length !== 1) return transaction;

    const invoice = candidates[0];
    const createdAt = now.toISOString();
    nextAllocations.push({
      id: `payment-${slug(transaction.id)}-${slug(invoice.id)}`,
      invoiceId: invoice.id,
      transactionId: transaction.id,
      amount: invoiceOutstanding(invoice, nextAllocations),
      currency: invoice.currency,
      source: transaction.source,
      accountName: transaction.accountName,
      reference: transaction.description,
      mode: "automatic",
      confidence: 1,
      matchReason: "Exact amount, currency, and company or invoice reference",
      paidAt: transaction.date,
      createdAt
    });
    nextInvoices = applyPaymentState(nextInvoices, nextAllocations).map((item) =>
      item.id === invoice.id ? { ...item, updatedAt: createdAt } : item
    );
    matched += 1;
    return {
      ...transaction,
      matchedInvoiceId: invoice.id,
      matchedProviderId: invoice.providerId ?? transaction.matchedProviderId,
      confidence: 1,
      matchReason: "Automatically matched to an exact open invoice"
    };
  });

  return { invoices: nextInvoices, transactions: nextTransactions, allocations: nextAllocations, matched };
}

export function pruneSupersededAccrualRun(
  runs: RevenueRun[],
  previousAccrual: RevenueAccrual | undefined,
  nextRunId: string
): RevenueRun[] {
  if (!previousAccrual || previousAccrual.revenueRunId === nextRunId) return runs;
  return runs.filter((run) => {
    if (run.id !== previousAccrual.revenueRunId) return true;
    return Boolean(run.invoiceId) || run.status === "drafted" || run.status === "invoicing" || run.status === "invoiced";
  });
}

export function calculateApproximateUsdTotals(
  accounts: AccountBalance[],
  holdings: Holding[],
  rates: FxRate[]
): ApproximateUsdTotals {
  const rateByAsset = new Map(rates.map((rate) => [rate.asset.toUpperCase(), rate]));
  const excludedAssets = new Set<string>();
  const staleAssets = new Set<string>();
  const usedRates = new Map<string, FxRate>();
  let accountsUsd = 0;
  let holdingsUsd = 0;

  for (const account of accounts.filter(isLiquidAccountBalance)) {
    const asset = account.currency.toUpperCase();
    const quote = rateByAsset.get(asset);
    const rate = asset === "USD" ? 1 : quote?.rateUsd;
    if (rate === undefined) {
      excludedAssets.add(asset);
    } else {
      accountsUsd += account.balance * rate;
      if (quote) usedRates.set(asset, quote);
      if (quote?.stale) staleAssets.add(asset);
    }
  }
  for (const holding of holdings) {
    const asset = holding.asset.toUpperCase();
    const quote = rateByAsset.get(asset);
    const rate = asset === "USD" ? 1 : quote?.rateUsd;
    if (rate === undefined) {
      excludedAssets.add(asset);
    } else {
      holdingsUsd += holding.balance * rate;
      if (quote) usedRates.set(asset, quote);
      if (quote?.stale) staleAssets.add(asset);
    }
  }

  const asOf = [...usedRates.values()].reduce<string | undefined>(
    (oldest, rate) => (!oldest || rate.asOf < oldest ? rate.asOf : oldest),
    undefined
  );
  return {
    accountsUsd: roundMoney(accountsUsd),
    holdingsUsd: roundMoney(holdingsUsd),
    totalUsd: roundMoney(accountsUsd + holdingsUsd),
    excludedAssets: [...excludedAssets].sort(),
    staleAssets: [...staleAssets].sort(),
    asOf
  };
}

export function mergeFxRates(
  previousRates: FxRate[],
  refreshedRates: FxRate[],
  trackedAssets: Iterable<string>,
  checkedAt = new Date().toISOString()
): FxRate[] {
  const previousByAsset = new Map(previousRates.map((rate) => [rate.asset.toUpperCase(), rate]));
  const refreshedByAsset = new Map(refreshedRates.map((rate) => [rate.asset.toUpperCase(), rate]));
  const assets = [...new Set([...trackedAssets].map((asset) => asset.trim().toUpperCase()).filter((asset) => asset && asset !== "USD"))];

  return assets.flatMap((asset): FxRate[] => {
    const refreshed = refreshedByAsset.get(asset);
    if (refreshed) {
      return [{ ...refreshed, asset, checkedAt, stale: false }];
    }
    const previous = previousByAsset.get(asset);
    return previous ? [{ ...previous, asset, checkedAt, stale: true }] : [];
  });
}

export function isLiquidAccountBalance(account: AccountBalance): boolean {
  return account.source !== "amex";
}

function isPaymentSource(source: Transaction["source"]): source is Extract<PaymentSource, Transaction["source"]> {
  return source === "wise" || source === "revolut" || source === "slash" || source === "amex";
}

function calendarDayDifference(start: string, end: string): number {
  const startTime = Date.parse(`${start.slice(0, 10)}T00:00:00Z`);
  const endTime = Date.parse(`${end.slice(0, 10)}T00:00:00Z`);
  return Math.max(0, Math.round((endTime - startTime) / dayMs));
}

function lastDayOfMonth(date: string): string {
  const [year, month] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return value.toISOString().slice(0, 10);
}

function zonedParts(date: Date, timezone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  const year = Number(value("year"));
  const month = Number(value("month"));
  const day = Number(value("day"));
  return {
    date: `${year}-${pad2(month)}-${pad2(day)}`,
    year,
    month,
    day,
    weekday: weekdayByName[value("weekday")] ?? 0,
    hour: Number(value("hour")),
    minute: Number(value("minute"))
  };
}

function normalizedText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function containsNormalizedPhrase(text: string, phrase: string): boolean {
  if (!text || !phrase) return false;
  return ` ${text} `.includes(` ${phrase} `);
}

function slug(value: string): string {
  return normalizedText(value).replaceAll(" ", "-") || "record";
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}
