import { transactionBusinessCategory } from "./categories";
import type {
  ProfitDistributionAdjustment,
  ProfitDistributionBucket,
  ProfitDistributionMonthLedger,
  ProfitDistributionPartnerId,
  ProfitDistributionPartnerLedger,
  ProfitDistributionSnapshot,
  SaveProfitDistributionAdjustmentPayload,
  Transaction
} from "./types";

type ProfitDistributionPartnerConfig = {
  id: ProfitDistributionPartnerId;
  name: string;
  entityName?: string;
  aliases: string[];
  monthlySalary: number;
  initialProfitShareRate: number;
  distributionRate: number;
};

const salaryCurrency = "EUR";
const partnerHalfRate = 0.5 / 3;
const partnerIds: ProfitDistributionPartnerId[] = ["ishan", "ben", "sanjan", "amin"];
const bucketIds: ProfitDistributionBucket[] = ["profit-share", "salary", "distribution"];

export const profitDistributionBucketLabels: Record<ProfitDistributionBucket, string> = {
  "profit-share": "Profit share",
  salary: "Salary",
  distribution: "Distribution"
};

export const profitDistributionPartners: ProfitDistributionPartnerConfig[] = [
  {
    id: "ishan",
    name: "Ishan",
    entityName: "Cognitive",
    aliases: ["ishan", "cognitive", "cognitive pixel", "cognitive pixels"],
    monthlySalary: 0,
    initialProfitShareRate: 0.25,
    distributionRate: 0.5
  },
  {
    id: "ben",
    name: "Ben",
    aliases: ["ben"],
    monthlySalary: 10000,
    initialProfitShareRate: 0,
    distributionRate: partnerHalfRate
  },
  {
    id: "sanjan",
    name: "Sanjan",
    aliases: ["sanjan", "sanjin"],
    monthlySalary: 10000,
    initialProfitShareRate: 0,
    distributionRate: partnerHalfRate
  },
  {
    id: "amin",
    name: "Amin",
    aliases: ["amin"],
    monthlySalary: 10000,
    initialProfitShareRate: 0,
    distributionRate: partnerHalfRate
  }
];

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function transactionMonth(transaction: Transaction): string {
  return transaction.date.slice(0, 7);
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

function transactionText(transaction: Transaction): string {
  return normalizedText([transaction.counterparty, transaction.rawName, transaction.description].join(" "));
}

function transactionContainsPartner(transaction: Transaction, partner: ProfitDistributionPartnerConfig): boolean {
  const text = transactionText(transaction);
  return partner.aliases.some((alias) => {
    const normalizedAlias = normalizedText(alias);
    return normalizedAlias && new RegExp(`(^| )${normalizedAlias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(text);
  });
}

function partnerForTransaction(transaction: Transaction): ProfitDistributionPartnerConfig | undefined {
  return profitDistributionPartners.find((partner) => transactionContainsPartner(transaction, partner));
}

function isOperatingRevenue(transaction: Transaction): boolean {
  if (transaction.direction !== "in") return false;
  const category = transactionBusinessCategory(transaction.category);
  return category !== "Capital movement" && category !== "Internal transfer";
}

function paymentBucketForTransaction(transaction: Transaction): {
  partnerId: ProfitDistributionPartnerId;
  bucket: ProfitDistributionBucket;
} | null {
  if (transaction.direction !== "out") return null;
  const category = transactionBusinessCategory(transaction.category);
  const partner = partnerForTransaction(transaction);
  if (!partner) return null;

  if (category === "Salary and payroll" && partner.monthlySalary > 0) {
    return { partnerId: partner.id, bucket: "salary" };
  }

  if (category === "Distribution" || category === "Partner payout") {
    const text = transactionText(transaction);
    const bucket = partner.id === "ishan" && (text.includes("profit share") || text.includes("25")) ? "profit-share" : "distribution";
    return { partnerId: partner.id, bucket };
  }

  return null;
}

function isGeneralCost(transaction: Transaction): boolean {
  if (transaction.direction !== "out") return false;
  const category = transactionBusinessCategory(transaction.category);
  if (category === "Capital movement" || category === "Internal transfer" || category === "Distribution") return false;
  return paymentBucketForTransaction(transaction) === null;
}

function adjustmentKey(
  month: string,
  currency: string,
  partnerId: ProfitDistributionPartnerId,
  bucket: ProfitDistributionBucket
): string {
  return `${month}:${currency}:${partnerId}:${bucket}`;
}

function ledgerKey(month: string, currency: string): string {
  return `${month}:${currency}`;
}

function paymentKey(
  month: string,
  currency: string,
  partnerId: ProfitDistributionPartnerId,
  bucket: ProfitDistributionBucket
): string {
  return adjustmentKey(month, currency, partnerId, bucket);
}

function emptyPartnerLedger(partner: ProfitDistributionPartnerConfig, currency: string): ProfitDistributionPartnerLedger {
  return {
    partnerId: partner.id,
    partnerName: partner.name,
    entityName: partner.entityName,
    currency,
    profitSharePayable: 0,
    salaryPayable: 0,
    distributionPayable: 0,
    totalPayable: 0,
    profitSharePaid: 0,
    salaryPaid: 0,
    distributionPaid: 0,
    totalPaid: 0,
    remaining: 0,
    hasAdjustment: false,
    hasDeferred: false
  };
}

function normalizeMonth(value: string): string {
  const month = value.trim();
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Distribution month must use YYYY-MM");
  return month;
}

function normalizeCurrency(value: string): string {
  const currency = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Distribution currency must be a three-letter code");
  return currency;
}

function isDistributionPartnerId(value: string): value is ProfitDistributionPartnerId {
  return partnerIds.includes(value as ProfitDistributionPartnerId);
}

function isDistributionBucket(value: string): value is ProfitDistributionBucket {
  return bucketIds.includes(value as ProfitDistributionBucket);
}

function adjustedAmount(baseAmount: number, adjustment?: ProfitDistributionAdjustment): number {
  if (adjustment?.waived) return 0;
  if (typeof adjustment?.overrideAmount === "number") return Math.max(0, adjustment.overrideAmount);
  return Math.max(0, baseAmount);
}

function buildAdjustmentMap(adjustments: ProfitDistributionAdjustment[]): Map<string, ProfitDistributionAdjustment> {
  return new Map(
    adjustments.map((adjustment) => [
      adjustmentKey(adjustment.month, adjustment.currency, adjustment.partnerId, adjustment.bucket),
      adjustment
    ])
  );
}

export function profitDistributionAdjustmentId(payload: {
  month: string;
  currency: string;
  partnerId: ProfitDistributionPartnerId;
  bucket: ProfitDistributionBucket;
}): string {
  return `distribution-adjustment-${payload.month}-${payload.currency}-${payload.partnerId}-${payload.bucket}`;
}

export function profitDistributionAdjustmentFromPayload(
  payload: SaveProfitDistributionAdjustmentPayload,
  updatedAt: string
): ProfitDistributionAdjustment {
  const partnerId = payload.partnerId;
  const bucket = payload.bucket;
  if (!isDistributionPartnerId(partnerId)) throw new Error("Unknown distribution partner");
  if (!isDistributionBucket(bucket)) throw new Error("Unknown distribution bucket");

  const month = normalizeMonth(payload.month);
  const currency = normalizeCurrency(payload.currency);
  const overrideAmount =
    payload.overrideAmount === null || payload.overrideAmount === undefined || !Number.isFinite(payload.overrideAmount)
      ? undefined
      : roundMoney(Math.max(0, payload.overrideAmount));

  return {
    id: profitDistributionAdjustmentId({ month, currency, partnerId, bucket }),
    month,
    currency,
    partnerId,
    bucket,
    waived: Boolean(payload.waived),
    deferred: Boolean(payload.deferred),
    ...(overrideAmount !== undefined ? { overrideAmount } : {}),
    ...(payload.note?.trim() ? { note: payload.note.trim() } : {}),
    updatedAt
  };
}

export function shouldKeepProfitDistributionAdjustment(adjustment: ProfitDistributionAdjustment): boolean {
  return (
    adjustment.waived ||
    adjustment.deferred ||
    typeof adjustment.overrideAmount === "number" ||
    Boolean(adjustment.note?.trim())
  );
}

export function calculateProfitDistribution(
  transactions: Transaction[],
  adjustments: ProfitDistributionAdjustment[]
): ProfitDistributionSnapshot {
  const adjustmentMap = buildAdjustmentMap(adjustments);
  const months = new Map<string, Set<string>>();
  const revenueTotals = new Map<string, number>();
  const costTotals = new Map<string, number>();
  const paymentTotals = new Map<string, number>();
  const currentMonth = new Date().toISOString().slice(0, 7);

  function includeMonthCurrency(month: string, currency: string) {
    const currencies = months.get(month) ?? new Set<string>();
    currencies.add(currency);
    currencies.add(salaryCurrency);
    months.set(month, currencies);
  }

  for (const transaction of transactions) {
    const month = transactionMonth(transaction);
    const currency = normalizeCurrency(transaction.currency);
    includeMonthCurrency(month, currency);
    const key = ledgerKey(month, currency);

    if (isOperatingRevenue(transaction)) {
      revenueTotals.set(key, (revenueTotals.get(key) ?? 0) + transaction.amount);
    }
    if (isGeneralCost(transaction)) {
      costTotals.set(key, (costTotals.get(key) ?? 0) + transaction.amount);
    }

    const payment = paymentBucketForTransaction(transaction);
    if (payment) {
      const paidKey = paymentKey(month, currency, payment.partnerId, payment.bucket);
      paymentTotals.set(paidKey, (paymentTotals.get(paidKey) ?? 0) + transaction.amount);
    }
  }

  for (const adjustment of adjustments) {
    includeMonthCurrency(adjustment.month, adjustment.currency);
  }

  if (months.size === 0) {
    includeMonthCurrency(currentMonth, salaryCurrency);
  }

  const monthLedgers: ProfitDistributionMonthLedger[] = [];
  for (const [month, currencySet] of months) {
    for (const currency of currencySet) {
      const key = ledgerKey(month, currency);
      const revenue = roundMoney(revenueTotals.get(key) ?? 0);
      const generalCosts = roundMoney(costTotals.get(key) ?? 0);
      const netProfitAfterGeneralCosts = roundMoney(revenue - generalCosts);
      const rawIshanProfitShare = netProfitAfterGeneralCosts > 0 ? netProfitAfterGeneralCosts * 0.25 : 0;
      const partnerRows = new Map<ProfitDistributionPartnerId, ProfitDistributionPartnerLedger>();

      for (const partner of profitDistributionPartners) {
        partnerRows.set(partner.id, emptyPartnerLedger(partner, currency));
      }

      const ishanProfitShareAdjustment = adjustmentMap.get(adjustmentKey(month, currency, "ishan", "profit-share"));
      const ishanProfitShare = roundMoney(adjustedAmount(rawIshanProfitShare, ishanProfitShareAdjustment));
      const ishanRow = partnerRows.get("ishan")!;
      ishanRow.profitSharePayable = ishanProfitShare;
      ishanRow.hasAdjustment = Boolean(ishanProfitShareAdjustment);
      ishanRow.hasDeferred = Boolean(ishanProfitShareAdjustment?.deferred);

      let salaryDeductions = 0;
      for (const partner of profitDistributionPartners.filter((item) => item.monthlySalary > 0)) {
        const salaryAdjustment = adjustmentMap.get(adjustmentKey(month, currency, partner.id, "salary"));
        const salary = currency === salaryCurrency ? adjustedAmount(partner.monthlySalary, salaryAdjustment) : 0;
        const row = partnerRows.get(partner.id)!;
        row.salaryPayable = roundMoney(salary);
        row.hasAdjustment ||= Boolean(salaryAdjustment);
        row.hasDeferred ||= Boolean(salaryAdjustment?.deferred);
        salaryDeductions += row.salaryPayable;
      }
      salaryDeductions = roundMoney(salaryDeductions);

      const profitAvailableForDistribution = roundMoney(netProfitAfterGeneralCosts - ishanProfitShare - salaryDeductions);
      const distributionPool = roundMoney(Math.max(0, profitAvailableForDistribution));

      for (const partner of profitDistributionPartners) {
        const distributionAdjustment = adjustmentMap.get(adjustmentKey(month, currency, partner.id, "distribution"));
        const distribution = adjustedAmount(distributionPool * partner.distributionRate, distributionAdjustment);
        const row = partnerRows.get(partner.id)!;
        row.distributionPayable = roundMoney(distribution);
        row.hasAdjustment ||= Boolean(distributionAdjustment);
        row.hasDeferred ||= Boolean(distributionAdjustment?.deferred);
      }

      const partners = profitDistributionPartners.map((partner) => {
        const row = partnerRows.get(partner.id)!;
        row.profitSharePaid = roundMoney(paymentTotals.get(paymentKey(month, currency, partner.id, "profit-share")) ?? 0);
        row.salaryPaid = roundMoney(paymentTotals.get(paymentKey(month, currency, partner.id, "salary")) ?? 0);
        row.distributionPaid = roundMoney(paymentTotals.get(paymentKey(month, currency, partner.id, "distribution")) ?? 0);
        row.totalPayable = roundMoney(row.profitSharePayable + row.salaryPayable + row.distributionPayable);
        row.totalPaid = roundMoney(row.profitSharePaid + row.salaryPaid + row.distributionPaid);
        row.remaining = roundMoney(row.totalPayable - row.totalPaid);
        return row;
      });

      monthLedgers.push({
        id: ledgerKey(month, currency),
        month,
        currency,
        revenue,
        generalCosts,
        netProfitAfterGeneralCosts,
        ishanProfitShare,
        salaryDeductions,
        profitAvailableForDistribution,
        distributionPool,
        partners
      });
    }
  }

  const sortedMonths = monthLedgers.sort(
    (left, right) => right.month.localeCompare(left.month) || left.currency.localeCompare(right.currency)
  );
  const partnerTotals = new Map<string, ProfitDistributionPartnerLedger>();
  const currencyTotals = new Map<string, { currency: string; totalPayable: number; totalPaid: number; remaining: number }>();

  for (const month of sortedMonths) {
    const currencyTotal = currencyTotals.get(month.currency) ?? {
      currency: month.currency,
      totalPayable: 0,
      totalPaid: 0,
      remaining: 0
    };

    for (const partnerRow of month.partners) {
      const key = `${partnerRow.partnerId}:${partnerRow.currency}`;
      const totalRow =
        partnerTotals.get(key) ??
        emptyPartnerLedger(
          profitDistributionPartners.find((partner) => partner.id === partnerRow.partnerId)!,
          partnerRow.currency
        );
      totalRow.profitSharePayable += partnerRow.profitSharePayable;
      totalRow.salaryPayable += partnerRow.salaryPayable;
      totalRow.distributionPayable += partnerRow.distributionPayable;
      totalRow.totalPayable += partnerRow.totalPayable;
      totalRow.profitSharePaid += partnerRow.profitSharePaid;
      totalRow.salaryPaid += partnerRow.salaryPaid;
      totalRow.distributionPaid += partnerRow.distributionPaid;
      totalRow.totalPaid += partnerRow.totalPaid;
      totalRow.remaining += partnerRow.remaining;
      totalRow.hasAdjustment ||= partnerRow.hasAdjustment;
      totalRow.hasDeferred ||= partnerRow.hasDeferred;
      partnerTotals.set(key, totalRow);

      currencyTotal.totalPayable += partnerRow.totalPayable;
      currencyTotal.totalPaid += partnerRow.totalPaid;
      currencyTotal.remaining += partnerRow.remaining;
    }
    currencyTotals.set(month.currency, currencyTotal);
  }

  return {
    partners: [...partnerTotals.values()]
      .map((partner) => ({
        ...partner,
        profitSharePayable: roundMoney(partner.profitSharePayable),
        salaryPayable: roundMoney(partner.salaryPayable),
        distributionPayable: roundMoney(partner.distributionPayable),
        totalPayable: roundMoney(partner.totalPayable),
        profitSharePaid: roundMoney(partner.profitSharePaid),
        salaryPaid: roundMoney(partner.salaryPaid),
        distributionPaid: roundMoney(partner.distributionPaid),
        totalPaid: roundMoney(partner.totalPaid),
        remaining: roundMoney(partner.remaining)
      }))
      .sort(
        (left, right) =>
          left.currency.localeCompare(right.currency) ||
          partnerIds.indexOf(left.partnerId) - partnerIds.indexOf(right.partnerId)
      ),
    months: sortedMonths,
    currencies: [...currencyTotals.values()]
      .map((summary) => ({
        currency: summary.currency,
        totalPayable: roundMoney(summary.totalPayable),
        totalPaid: roundMoney(summary.totalPaid),
        remaining: roundMoney(summary.remaining)
      }))
      .sort((left, right) => left.currency.localeCompare(right.currency)),
    adjustments: [...adjustments].sort(
      (left, right) =>
        right.month.localeCompare(left.month) ||
        left.currency.localeCompare(right.currency) ||
        partnerIds.indexOf(left.partnerId) - partnerIds.indexOf(right.partnerId) ||
        bucketIds.indexOf(left.bucket) - bucketIds.indexOf(right.bucket)
    )
  };
}
