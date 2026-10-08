# RedTrack revenue

The administrator-only RedTrack page reports tracked revenue by conversion date, in the verified account currency USD and timezone America/New_York. It never imports spend, creates invoices, or changes the bank ledger. `REDTRACK_API_KEY` is a server-only Convex environment variable on production `famous-oyster-878`.

Each requested day is saved in Convex with offer source, offer, traffic channel, campaign, revenue and conversion counts. Filters and grouping run over these saved dimensions; overlapping date windows reuse saved days. Storage covers requested dates, not all account history. Empty days are explicitly saved. The page shows the oldest source-sync timestamp in the selected range.

Freshness is checked on access: today 15 minutes; previous three days one hour; other dates within 30 days one day. Older days receive a final check after leaving that window and are then retained. The ordinary refresh button observes these intervals. **Sync from RedTrack** explicitly resynchronizes the selected dates for later corrections. No scheduled full-history pulls are performed.

Syncs hold a single account-wide lease. Every source request reserves a slot at least 3.2 seconds after the last slot (below the Regular API's 20 requests/minute). HTTP 429 stores the provider's Retry-After deadline, or a 60-second cooldown when absent. Concurrent pulls and explicit sync use the same controls. The UI reports failures; incomplete or failed pulls never replace a saved snapshot.

The integration pages through the bare `/report` response and checks all four revenue/conversion metrics against an independent daily report before atomically replacing each interval's saved days. `total=true` is intentionally unused: live verification found that later pages can have empty `items` despite nonzero page totals. Requested fields exclude costs. Reports are limited to 93 days, 8,000 detail rows, and a bounded payload; larger results require a shorter period.

Primary conversions use RedTrack's `revenue` and `conversions` fields. All conversion types use `total_revenue` and `total_conversions`; these can include multiple events for one sale. Revenue is retained at source precision and displayed to cents.

Advertiser dashboard links are saved separately per stable offer-source ID. RedTrack does not expose a dedicated dashboard-link field; landing/offer tracking URLs are not inferred as reporting portals. Links require HTTPS without embedded credentials and open with `noopener noreferrer`. Link edits have no effect on RedTrack itself.

Only new RedTrack tables are introduced. There is no migration or database cutover. Release through `npm run deploy`, which selects production, validates the bank ledger, and deploys Cloudflare. Verify a real report, then repeat it and confirm `syncedDates` is empty and the source-sync timestamp is unchanged.

Sources: [API reference](https://api.redtrack.io/docs/index.html), [API limits](https://help.redtrack.io/pt-br/knowledgebase/api-regular-e-premium-2/).
