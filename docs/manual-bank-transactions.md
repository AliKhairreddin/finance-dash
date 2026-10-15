# Kraken and Trust ledgers

Ali and Ali M can send `/kraken Acme Ltd 1250` or `/trust Acme Ltd 500` to the
Telegram bot in their mapped private chats. Commands are case-insensitive and
also accept a leading backslash. The last token is a positive amount; the
preceding text is the company name. Commas must be valid thousands separators,
and amounts support up to eight decimal places.

Entries default to USDC and money out. The transaction date is the Telegram
message's original sent date in the application's Eastern operating timezone,
including delayed delivery. There is no default to the processing time when
Telegram has not supplied a timestamp.

Banks → Kraken and Banks → Trust serve these records from Convex. Administrators
and finance operators can add, edit, and delete entries directly in either tab.
The Add transaction form defaults to USDC, money out, and today in Eastern time;
company, amount, currency/asset code, direction, and date are editable. Delete
requires confirmation and removes the entry from the visible ledger while
retaining its fields, deletion author/time, and edit history for audit.
Every data column sorts across the full active ledger using an index and
paginated results; sort state is in the URL. These manual ledgers do not alter
holdings, cash balances, imported-bank analytics, or the All bank activity tab.

The unique Telegram chat/update identity makes retries idempotent, even after
dashboard edits. Updates require the displayed revision and preserve the old
and new fields in `manualBankTransactionEdits`; concurrent edits are rejected.
An edited Telegram message does not replace a transaction: use the dashboard.
Dashboard creation uses a stable request ID per form submission, so network
retries cannot duplicate entries. Deletes also require the displayed revision;
retries are safe, and neither Telegram nor dashboard retries can recreate a
deleted entry. No existing financial values are migrated or removed.

# Bank payment references

The shared transaction column, search, sorting, and CSV export use the saved
`reference` field. The normal synchronization paths retain Wise payment notes
(Zoho's `reference_number`, explicit Wise description notes, direct statement
`details.paymentReference`, and imported CSV Reference), Revolut `reference`,
Amex memo/reference, and Mercury `externalMemo`. Slash's current transaction
adapter has no separate supported payment-note field. Missing references display
a dash. Provider transaction identifiers are not used as payment notes.

No new per-page source API requests are made. Existing synchronization retains
the current freshness/lease/rate-limit behavior. Older references are populated
when their source periods are reconciled through the existing sync controls.
Explicit reference text already present in saved Wise descriptions can be
backfilled without upstream requests:

```sh
npx tsx scripts/backfill-wise-references.ts
npx tsx scripts/backfill-wise-references.ts --apply
```

This production-only enrichment previews by default, processes at most 200 rows
per batch, never changes amounts/dates/IDs/classifications, and skips rows that
already have a reference. It is safe to rerun after interruption.
