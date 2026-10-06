import type { TransactionPage } from "./types";
import { bankHistoryStartDate } from "./bankPeriods";

type DateRange = { fromDate: string; toDate: string };

export function claimAutomaticHistoryRequests(
  coverage: TransactionPage["coverage"],
  period: DateRange,
  attempted: Set<string>
) {
  return (coverage ?? []).flatMap((item) => {
    // Wise history comes from the daily Zoho feed. Opening or sorting the
    // ledger cannot fill older CSV gaps or advance the upstream feed date.
    const missingRanges = item.missingRanges.filter(range => range.toDate >= bankHistoryStartDate);
    if (item.source === "wise" || missingRanges.length === 0) return [];
    const key = `${item.source}:${period.fromDate}:${period.toDate}`;
    if (attempted.has(key)) return [];
    attempted.add(key);
    return [{
      source: item.source,
      fromDate: [bankHistoryStartDate, missingRanges.reduce((first, range) => range.fromDate < first ? range.fromDate : first, missingRanges[0].fromDate)].sort().at(-1)!,
      toDate: missingRanges.reduce((last, range) => range.toDate > last ? range.toDate : last, missingRanges[0].toDate)
    }];
  });
}

export async function waitForBankHistorySync(
  apiBase: string,
  jobKey: string,
  signal: AbortSignal,
  maximumWaitMs = 60_000
): Promise<"complete" | "pending"> {
  const deadline = AbortSignal.timeout(maximumWaitMs);
  const requestSignal = AbortSignal.any([signal, deadline]);
  try {
    while (true) {
      requestSignal.throwIfAborted();
      const response = await fetch(`${apiBase}/transactions/sync?${new URLSearchParams({ key: jobKey })}`, { signal: requestSignal });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.message || "Historical transaction sync failed");
      if (response.status !== 202) {
        if (body?.status !== "complete") throw new Error("Historical transaction sync returned an invalid status");
        return "complete";
      }
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(requestSignal.reason); };
        const timer = setTimeout(() => { requestSignal.removeEventListener("abort", abort); resolve(); }, 5_000);
        requestSignal.addEventListener("abort", abort, { once: true });
        if (requestSignal.aborted) abort();
      });
    }
  } catch (error) {
    if (deadline.aborted && !signal.aborted) return "pending";
    throw error;
  }
}
