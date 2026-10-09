import { Popover } from "@base-ui/react/popover";
import { useRef } from "react";
import { CircleAlert, Database, Info, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { calendarDateRangeLabel } from "@/components/ui/calendar-period-picker";
import type { MediaSpendApiResponse } from "../../../shared/mediaSpend";
import { mediaSpendPeriodStatus, mediaSpendReimportAvailability } from "../../../shared/mediaSpendStatus";

const dateTime = (value: string) => new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short"
}).format(new Date(value));
const date = (value: string) => new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", year: "numeric"
}).format(new Date(`${value}T00:00:00`));

export function MediaSpendSyncSummary({ data, isLoading }: {
  data: MediaSpendApiResponse | null;
  isLoading: boolean;
}) {
  return <p className="media-spend-sync-summary" role="status" aria-label="Cognitive data freshness">
    {data ? <>
      <span>Last successful pull: {data.sync.lastSuccessAt
        ? <time dateTime={data.sync.lastSuccessAt}>{dateTime(data.sync.lastSuccessAt)}</time>
        : <strong>No successful pull yet</strong>}</span>
      <span>Data through: {data.sync.coveredThrough
        ? <time dateTime={data.sync.coveredThrough}>{date(data.sync.coveredThrough)}</time>
        : <strong>No saved coverage</strong>}</span>
    </> : <span>{isLoading ? "Loading pull status…" : "Pull status unavailable"}</span>}
  </p>;
}

export function MediaSpendDataStatus({ data, isLoading, isSyncing, onReimport }: {
  data: MediaSpendApiResponse | null;
  isLoading: boolean;
  isSyncing: boolean;
  onReimport: () => void;
}) {
  const popupRef = useRef<HTMLDivElement>(null);
  if (!data) return <div className="media-spend-data-state" role="status">
    {isLoading ? <><Loader2 className="spin" size={14} /> Loading saved data</> : <><CircleAlert size={14} /> Data unavailable</>}
  </div>;

  const period = mediaSpendPeriodStatus(data);
  const availability = mediaSpendReimportAvailability(data, Date.now());
  const updating = isSyncing || data.sync.status === "running";
  const updateIssue = !updating && (data.sync.status === "failed" || !data.configured);

  return <div className="media-spend-data-state">
    <span className={`media-spend-period-status ${period.tone}`} role="status">
      <Database aria-hidden="true" size={13} />{period.label}
    </span>
    {updating && <span className="media-spend-update-status" role="status"><Loader2 aria-hidden="true" className="spin" size={13} />Importing</span>}
    {updateIssue && <span className="media-spend-update-status warning"><CircleAlert aria-hidden="true" size={13} />{data.configured ? "Update incomplete" : "Imports unavailable"}</span>}
    <Popover.Root>
      <Popover.Trigger aria-label="Media spend data details" className="media-spend-data-info">
        <Info aria-hidden="true" size={15} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner className="toolbar-popover-positioner" sideOffset={8} align="start">
          <Popover.Popup ref={popupRef} initialFocus={popupRef} className="media-spend-data-popover">
            <Popover.Title className="toolbar-popover-title">LemonMax data</Popover.Title>
            <Popover.Description className="media-spend-data-description">
              The dashboard reads saved daily spend. Opening or reloading this page does not request data from LemonMax.
            </Popover.Description>
            <dl className="media-spend-data-facts">
              <div><dt>Selected period</dt><dd>{calendarDateRangeLabel(data)}</dd></div>
              <div><dt>Days saved</dt><dd>{period.savedDays} of {period.days}</dd></div>
              {data.sync.lastSuccessAt && <div><dt>Last complete import</dt><dd>{dateTime(data.sync.lastSuccessAt)}</dd></div>}
              {data.sync.coveredFrom && data.sync.coveredThrough && <div><dt>Saved history</dt><dd>{calendarDateRangeLabel({ fromDate: data.sync.coveredFrom, toDate: data.sync.coveredThrough })}</dd></div>}
            </dl>
            {data.missingDates.length > 0 && <div className="media-spend-data-issue">
              <strong>Missing from this period</strong>
              <p>{data.missingDates.map(date).join(", ")}. Totals exclude these days.</p>
            </div>}
            {updateIssue && <div className="media-spend-data-issue">
              <strong>{data.configured ? "Latest import did not complete" : "LemonMax imports are not configured"}</strong>
              {data.sync.lastAttemptAt && <p>{dateTime(data.sync.lastAttemptAt)}{data.sync.requestedFrom && data.sync.requestedTo ? ` · ${calendarDateRangeLabel({ fromDate: data.sync.requestedFrom, toDate: data.sync.requestedTo })}` : ""}</p>}
              {data.sync.lastError && <p>{data.sync.lastError}</p>}
              <p>{period.complete ? "All days in your selected period are saved. A failed update does not remove them." : "Previously saved spend is preserved."}</p>
            </div>}
            <div className="media-spend-data-schedule">
              <strong>Automatic import · daily at 2:00 PM India time</strong>
              <p>Rechecks the latest 14 days for corrections and catches up missing history in batches. Older dates stay saved until deliberately re-imported.</p>
            </div>
            <details className="media-spend-data-reimport">
              <summary>Re-import selected dates</summary>
              <p>For missing data or historical corrections. Imports every account and platform for the selected completed days. Uses the single daily import allowance and may replace today's scheduled update.</p>
              <Button className="secondary-button" disabled={isLoading || updating || availability.disabledReason !== null} onClick={onReimport} type="button" aria-describedby="media-spend-reimport-reason">
                {updating ? <Loader2 aria-hidden="true" className="spin" size={14} /> : <RefreshCw aria-hidden="true" size={14} />}
                {updating ? "Importing…" : "Import from LemonMax"}
              </Button>
              <p id="media-spend-reimport-reason">{availability.disabledReason ?? `Dates: ${calendarDateRangeLabel(availability)}.`}</p>
            </details>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  </div>;
}
