# Wagner media spend

Media Spend has Cognitive (existing LemonMax data) and Wagner (Inchops) team views.
Wagner uses the dashboard's existing session and media-spend role checks. It is
read-only analytics and does not modify bank, funding, or accounting records.

Set `WAGNER_API_KEY` as a Cloudflare Worker secret. Local development uses the same
variable in `.env.local`. Never put the key in browser variables or source control.

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
- Refresh in the interface respects these rules; it does not bypass storage.

`wagnerSpendCache` reserves each source request transactionally. Responses are
validated before being saved, split into bounded `wagnerSpendCacheChunks`, and
replaced atomically. Failed pulls retain prior saved data and release the lease;
stale data is not silently returned as current. An interrupted lease expires after
60 seconds. The tables are additive and require no migration of existing data.

Use `npm run check` and the standard `npm run deploy` production workflow.
