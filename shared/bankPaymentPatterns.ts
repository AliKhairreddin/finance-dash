import { shiftFinanceOperatingDate } from "./operatingDate";
import type { BankPaymentPattern } from "./types";

const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return Math.round(sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2);
};

/** A receipt-cycle estimate, never a contractual term or an inferred invoice match. */
export function estimateBankPaymentPattern(receiptDates: string[], asOfDate: string): BankPaymentPattern | undefined {
  const dates = [...new Set(receiptDates)].filter(date => date <= asOfDate).sort().slice(-11);
  if (dates.length < 3) return undefined;
  const gaps = dates.slice(1).map((date, index) => days(dates[index], date));
  const center = median(gaps);
  // Missing cycles and extra split receipts must not dictate the typical interval.
  const supported = gaps.filter(gap => gap >= Math.max(1, center / 2) && gap <= center * 1.5);
  if (supported.length < 2 || supported.length / gaps.length < 0.5) return undefined;
  const intervalDays = median(supported), anchorDate = dates.at(-1)!;
  const expectedDate = shiftFinanceOperatingDate(anchorDate, intervalDays);
  // A rough planning window, not a statistical confidence interval or a promised date.
  const slack = Math.max(2, Math.ceil(intervalDays * 0.1));
  const earliestDate = shiftFinanceOperatingDate(anchorDate, Math.max(1, Math.min(...supported) - slack));
  const latestDate = shiftFinanceOperatingDate(anchorDate, Math.max(...supported) + slack);
  const disrupted = gaps.some(gap => gap > intervalDays * 2);
  const stale = asOfDate > latestDate;
  return {
    intervalDays, anchorDate, expectedDate, earliestDate, latestDate,
    sampleSize: dates.length, matchingIntervals: supported.length, projectedCycles: 1, stale, disrupted,
    confidence: dates.length >= 5 && supported.length / gaps.length >= 0.8 && !disrupted && !stale ? "medium" : "low"
  };
}

/** Select the first cycle after issue; never advance an overdue estimate just because time passed. */
export function bankPatternForInvoice(pattern: BankPaymentPattern, issueDate: string): BankPaymentPattern {
  const projectedCycles = Math.max(1, Math.ceil(days(pattern.anchorDate, issueDate) / pattern.intervalDays));
  const offset = (projectedCycles - 1) * pattern.intervalDays;
  return { ...pattern, projectedCycles,
    expectedDate: shiftFinanceOperatingDate(pattern.expectedDate, offset),
    earliestDate: [issueDate, shiftFinanceOperatingDate(pattern.earliestDate, offset)].sort().at(-1)!,
    latestDate: shiftFinanceOperatingDate(pattern.latestDate, offset),
    confidence: projectedCycles > 1 ? "low" : pattern.confidence };
}
