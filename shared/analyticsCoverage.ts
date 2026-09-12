import type { AnalyticsCoverage } from "./analyticsRequest";
import { financeOperatingDate, shiftFinanceOperatingDate } from "./operatingDate";

export function historicalCoverageGaps(
  coverage: AnalyticsCoverage[],
  now: Date | number = new Date()
): AnalyticsCoverage[] {
  const lastClosedDay = shiftFinanceOperatingDate(financeOperatingDate(now), -1);
  return coverage.flatMap((item) => {
    const missingRanges = item.missingRanges.flatMap((range) => {
      if (range.fromDate > lastClosedDay) return [];
      return [{ ...range, toDate: range.toDate > lastClosedDay ? lastClosedDay : range.toDate }];
    });
    return missingRanges.length > 0 ? [{ ...item, missingRanges }] : [];
  });
}
