# Cognitive spend and LemonMax agencies

The unfiltered `/api/v1/account-spend/summary` response supplies daily spend for all platforms and accounts, including zero-spend accounts. Each row now includes `Agency ID` (a nonnegative integer or null) and `Agency Name` (a display string or null). Display names normalize whitespace, including source tabs and line breaks, to spaces. Missing fields, malformed values, duplicate rows, incomplete account/row counts, mismatched date ranges, and unreconciled spend totals reject the response before saved data is replaced.

Agency IDs and names are saved with the account's daily spend in production Convex. Account groups display the agency from their latest date in the selected period; daily details retain the dated agency. Agency sorting is preserved in the URL, and search and CSV export include both fields. A missing source agency is displayed as a dash. Source agencies are distinct from the dashboard's financial funding assignments and billing classifications; importing an agency does not infer or overwrite those assignments.

The Worker imports once daily at 10:00 UTC, refreshing the last fourteen published days and catching up missing coverage in contiguous batches. Ordinary page loads read saved Convex data. Older corrections and metadata changes require deliberate reconciliation or the existing bounded re-import control. A shared Convex lease prevents overlapping imports, and failed source responses preserve saved data. Provider rate limits fail the import instead of triggering immediate repeat pulls.

## Historical reconciliation

Run the production-only command after deploying the schema and functions:

```sh
npm run media-spend:reconcile -- --from 2026-08-01 --to 2026-10-20 --credentials-file .local/lemonmax-credentials.json --backup-dir .local/lemonmax-reconciliation-2026-10-21
```

The private JSON credentials file contains `authToken` and `bearerToken`; never commit it or put its contents in command arguments. The command explicitly selects `famous-oyster-878` and retrieves that deployment's service token. It backs up existing account-day rows before writing, makes one unfiltered source request per batch of up to fourteen days, reconciles rows using the Worker's validation and lease, rebuilds derived funding totals, and verifies saved daily counts and totals. Matching account-day keys retain their Convex document IDs.

Backups and completion checkpoints must live under git-ignored `.local/`. Retry a failed run with the same options to resume without refetching completed batches. Use a fresh backup directory for a new reconciliation. Retain private backups only as long as needed to verify the release, then remove them and the temporary credentials file.
