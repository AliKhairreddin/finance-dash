# Wagner media spend

Media Spend has Cognitive (existing LemonMax data) and Wagner (Inchops) team views.
Wagner uses the dashboard's existing session and media-spend role checks. It is
read-only analytics and does not modify bank, funding, or accounting records.

Set `WAGNER_API_KEY` as a Cloudflare Worker secret. Local development uses the same
variable in `.env.local`. Never put the key in browser variables or source control.

The October 2026 Spend API adds `rt_campaign` / `rt_campaigns`. The Wagner view
supports this breakdown, a searchable campaign filter, daily drill-down, and CSV
export with campaign IDs. Campaign names and IDs are preserved; unmatched spend is
shown as **Unassigned** and filtered with `rt_campaign=none`. All displayed data
columns, including campaign IDs, sort in either direction with state in the URL.
The default reporting period ends yesterday; current-day spend remains pending.

## Saved data

The first request for a date range, breakdown, and filter combination retrieves
the source report and saves its complete response in production Convex. Further
requests reuse that saved report. A different combination imports its own report;
this does not pre-import the entire CRM history. Source totals remain exact, since
the source rounds detailed rows independently.

- Recent reports can be refreshed once per hour when requested.
- A report fetched after its end date is more than 14 days old is retained without
  automatic source requests, provided the source reports coverage through its end.
- Incomplete coverage and current/future periods remain refreshable.
- Filter dimensions are saved for 24 hours.
- The campaign-enabled dimensions contract has its own cache key. This refreshes
  the list once without invalidating any saved financial reports.
- Refresh in the interface respects these rules; it does not bypass storage.

`wagnerSpendCache` reserves each source request transactionally. Responses are
validated before being saved, split into bounded `wagnerSpendCacheChunks`, and
replaced atomically. Failed pulls retain prior saved data and release the lease;
stale data is not silently returned as current. An interrupted lease expires after
60 seconds. Provider failures pause new source requests for at least 60 seconds;
`Retry-After` seconds or HTTP dates can extend this delay. The cooldown is saved in
Convex and shared across report/filter combinations and dimensions. Valid saved
reports remain available during the cooldown. No automatic retry loop runs against
the source. `retryAfter` is an optional cache metadata field; existing reports and
bank records require no data migration.

## Reconcile historical corrections

An operator can mark one saved report for reconciliation using the internal Convex
mutation below. Get the exact `key` from that report's `wagnerSpendCache` record.
This requires deployment access and is not exposed to browser clients.

```bash
npx convex run --deployment famous-oyster-878 wagnerSpendCache:requestReconciliation '{"key":"wagner:v1:/api/finance/v1/spend?from=2026-09-01&to=2026-09-30&group_by=agency"}'
```

Then open that same period, breakdown and filters in the dashboard and click
Refresh. Reconciliation refuses reports saved less than one hour ago or currently
being synchronized. It preserves the existing snapshot, and the subsequent pull
still uses the shared provider cooldown, lease, validation and atomic replacement.
Repeat for other saved filter/breakdown combinations affected by a correction;
this is scoped report storage, not a complete local CRM dataset.

Use `npm run check` and the standard `npm run deploy` production workflow.
