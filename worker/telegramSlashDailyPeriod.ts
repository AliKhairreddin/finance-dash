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

export function slashPreviousDayReportPeriod(asOf: number): { date: string; fromTime: number; toTime: number } {
  if (!Number.isFinite(asOf)) throw new Error("Invalid Slash daily report date");
  const today = localDate(asOf);
  const date = new Date(Date.parse(`${today}T12:00:00Z`) - dayMs).toISOString().slice(0, 10);
  return { date, fromTime: dayStart(date), toTime: dayStart(today) };
}

