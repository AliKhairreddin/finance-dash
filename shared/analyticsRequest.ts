import type { BankAnalyticsSnapshot, BankTransactionSource } from "./types";

export interface AnalyticsCoverage {
  source: BankTransactionSource;
  missingRanges: Array<{ fromDate: string; toDate: string }>;
}
export type AnalyticsResponse = BankAnalyticsSnapshot & { coverage: AnalyticsCoverage[] };

export async function fetchAnalyticsRange(
  apiBase: string,
  range: { fromDate: string; toDate: string },
  signal: AbortSignal,
  onBuilding?: () => void,
  maximumWaitMs = 45_000
): Promise<AnalyticsResponse> {
  const deadline = AbortSignal.timeout(maximumWaitMs);
  const requestSignal = AbortSignal.any([signal, deadline]);
  try {
    while (true) {
      const response = await fetch(`${apiBase}/analytics?${new URLSearchParams(range)}`, { signal: requestSignal });
      if (response.status !== 202) {
        const body = await response.json();
        if (!response.ok) throw new Error(body?.message || "Analytics snapshot could not be loaded");
        if (body.version !== 3 || body.fromDate !== range.fromDate || body.toDate !== range.toDate || !Array.isArray(body.coverage)) {
          throw new Error("Analytics returned an invalid period snapshot");
        }
        return body as AnalyticsResponse;
      }
      const body = await response.json();
      if (body?.status !== "building") throw new Error("Analytics returned an invalid build status");
      onBuilding?.();
      const retry = response.headers.get("Retry-After");
      const seconds = retry === null ? 1 : Number(retry);
      const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retry!) - Date.now();
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(requestSignal.reason); };
        const timer = setTimeout(() => { requestSignal.removeEventListener("abort", abort); resolve(); }, Math.max(100, Math.min(5000, Number.isFinite(delay) ? delay : 1000)));
        requestSignal.addEventListener("abort", abort, { once: true });
        if (requestSignal.aborted) abort();
      });
    }
  } catch (error) {
    if (deadline.aborted && !signal.aborted) throw new Error("Period totals are taking longer than expected. Retry to continue the calculation.");
    throw error;
  }
}
