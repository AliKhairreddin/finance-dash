# Cognitive spend from LemonMax

The unfiltered `/api/v1/account-spend/summary` response supplies daily account spend across platforms. The import includes zero-spend rows when the source returns them. Each row now includes `Agency ID` (a nonnegative integer or null) and `Agency Name` (a display string or null). Display names normalize whitespace, including source tabs and line breaks, to spaces. Missing fields, malformed values, duplicate rows, incomplete account/row counts, mismatched date ranges, and unreconciled spend totals reject the response before saved data is replaced.

Agency IDs and names are saved with the account's daily spend in production Convex. Account groups display the agency from their latest date in the selected period; daily details retain the dated agency. Agency sorting is preserved in the URL, and search and CSV export include both fields. A missing source agency is displayed as a dash. Source agencies are distinct from the dashboard's financial funding assignments and billing classifications; importing an agency does not infer or overwrite those assignments.

The **LemonMax method** column shows the account payment type supplied in `Payment Method.Type`, including Credit Card, Credit Line and Ad Credits Only. **Not reported** means the source returned a null method or type. **Not imported** identifies a saved row that has not received the new field. An account with different values in the selected period shows **Mixed**. Its daily view shows the individual values. The method filter applies to account-days before spend is grouped. Both tables support sorting, search and CSV export.

Only the reported type is stored. The existing billing choices and funding assignments continue to control provider balances. A source report can omit previously saved zero-spend accounts. Re-imports retain those rows with their original metadata and sync timestamps. The stored row count includes this inventory, while the import count reflects the rows returned by LemonMax.

The Worker imports once daily at 10:00 UTC, refreshing the last fourteen published days and catching up missing coverage in contiguous batches. Ordinary page loads read saved Convex data. Older corrections and metadata changes require deliberate reconciliation or the existing bounded re-import control. A shared Convex lease prevents overlapping imports, and failed source responses preserve saved data. Provider rate limits fail the import instead of triggering immediate repeat pulls.

## Historical reconciliation

Run the production-only command after deploying the schema and functions:

```sh
npm run media-spend:reconcile -- --from 2026-08-01 --to 2026-10-20 --credentials-file .local/lemonmax-credentials.json --backup-dir .local/lemonmax-reconciliation-2026-10-21
```

The private JSON credentials file contains `authToken` and `bearerToken`; never commit it or put its contents in command arguments. The command explicitly selects `famous-oyster-878` and retrieves that deployment's service token. It backs up existing account-day rows before writing, makes one unfiltered source request per batch of up to fourteen days, reconciles rows using the Worker's validation and lease, rebuilds derived funding totals, and verifies saved daily counts and totals. Matching account-day keys retain their Convex document IDs.

Backups and completion checkpoints must live under git-ignored `.local/`. Retry a failed run with the same options to resume without refetching completed batches. Use a fresh backup directory for a new reconciliation. Retain private backups only as long as needed to verify the release, then remove them and the temporary credentials file.
