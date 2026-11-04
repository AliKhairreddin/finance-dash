# Central sheet reconciliation

`scripts/import-central-sheet.ts` imports an explicitly reviewed provider/account plan into production. It never fetches an upstream reporting API. The Google Sheet remains unchanged.

The reviewed plan is a JSON array of `CentralSheetProvider` records from `shared/centralSheetImport.ts`. Keep source snapshots, reviewed plans, account IDs and financial amounts in ignored `.local/` files, not Git. Each provider has an exact supplier name, an explicit permission to create a missing supplier, source observations and account names/IDs. `providerBillingType` is appropriate only where source evidence establishes one method for all that provider's accounts. Conflicting or unspecified billing must remain absent.

Run a dry run before applying:

```sh
npx tsx scripts/import-central-sheet.ts .local/reviewed-central-sheet.json
npx tsx scripts/import-central-sheet.ts .local/reviewed-central-sheet.json --apply
```

The script pins `famous-oyster-878`, obtains its service credential without printing it, saves a dated backup, and reads existing assignments plus the bounded saved spend coverage. Its private account catalog is reused only while the saved sync version and coverage are unchanged. It reports ambiguous/missing names and ownership conflicts instead of guessing. New assignments refuse to overwrite a concurrent assignment. Existing classifications are filled only when historical ownership and nonempty billing choices agree.

For the November 2026 review, the user explicitly confirmed that payment methods have been unchanged since inception. Historical classification is authorized on that basis. Existing ownership and effective dates are preserved; newly resolved accounts start at the project's existing `2026-01-01` boundary. Only saved spend coverage can be recalculated; this does not establish spend coverage before August 2026.

Source balances, refund amounts and commission terms are stored as unverified references. No undated source amount becomes an opening balance, no blank becomes a reported zero, and source commission terms do not automatically reprice funding. A provider balance remains unavailable until its opening amount, end-of-day cutoff and funding fee treatment have been explicitly verified. Signed opening amounts are supported. The current funding calculator supports a percentage deducted from gross funding; mixed vertical rates, separately billed fees and subscriptions require reconciliation before verification.

After applying, the script rebuilds derived totals from saved Convex data, verifies imported assignments and unchanged existing opening values, funding and adjustments, then saves a dated result and unresolved-row report in `.local/`. The script is resumable: verified account assignments and provider records are reused. Resolve outstanding ownership, account IDs, billing conflicts and fee/date evidence deliberately before a later import.

Use the normal `npm run check`, commit/push `main`, and `npm run deploy` release workflow for code changes. Production deployments must retain the `famous-oyster-878` binding.
