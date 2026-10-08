import {
  mediaSpendDates,
  mediaSpendMaximumSyncDays,
  mediaSpendPullDateInIndia,
  mediaSpendYesterdayInIndia,
  type MediaSpendApiResponse
} from "./mediaSpend";

/** Coverage belongs to the displayed period; import health belongs to the source. */
export function mediaSpendPeriodStatus(data: MediaSpendApiResponse) {
  const days = mediaSpendDates(data.fromDate, data.toDate).length;
  const savedDays = days - data.missingDates.length;
  return {
    complete: data.missingDates.length === 0,
    days,
    savedDays,
    label: `${savedDays}/${days} days saved`,
    tone: data.missingDates.length ? "warning" : "saved"
  } as const;
}

export function mediaSpendReimportAvailability(
  data: MediaSpendApiResponse,
  now: number
): { fromDate: string; toDate: string; disabledReason: string | null } {
  const yesterday = mediaSpendYesterdayInIndia(now);
  const toDate = data.toDate < yesterday ? data.toDate : yesterday;
  let disabledReason: string | null = null;
  if (!data.configured) disabledReason = "LemonMax imports are not configured.";
  else if (data.sync.status === "running") disabledReason = "A LemonMax import is already running.";
  else if (data.sync.lastAttemptAt && mediaSpendPullDateInIndia(Date.parse(data.sync.lastAttemptAt)) === mediaSpendPullDateInIndia(now)) {
    disabledReason = "Today's import has already been attempted (India time). The next automatic import is tomorrow at 2:00 PM India time.";
  } else if (data.fromDate > toDate) disabledReason = "Only completed days can be imported.";
  else if (mediaSpendDates(data.fromDate, toDate).length > mediaSpendMaximumSyncDays) {
    disabledReason = `Select at most ${mediaSpendMaximumSyncDays} completed days to re-import.`;
  }
  return { fromDate: data.fromDate, toDate, disabledReason };
}
