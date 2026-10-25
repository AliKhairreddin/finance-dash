# Statement Dashboard

The Statement Dashboard runs in the existing Cloudflare Worker at
`https://statements.thatcanadian.dev`, using the existing production Convex
deployment `famous-oyster-878`. It starts with an empty statement ledger. Existing
Finance Dashboard records and the reference application are not migrated or changed.

## Access and data

Ali, Ali M, and Alaa use their existing Telegram sign-in. Sessions are bound to
each hostname. The statements host does not serve the Finance Dashboard API.
Every statement API call derives its actor from the authenticated session; Convex
also verifies the service token, membership, and company access. Original files
are downloaded through authenticated Worker routes, without exposing storage URLs.

The six companies are AMG Holding, Artec, Inch Engineering, Digital Nudge, Inch
Digital, and MZS Bouw. Mix Transactions queries the same canonical records.
Initial card mappings are 5196, 4440, and 6805 respectively for the first three
companies. Cards are text, can be scoped by source/account, and are editable in
Settings. LMD/LOVEMEDO and card mapping 1003 are excluded from this module.

Money is stored as decimal minor-unit strings and calculated with BigInt. Totals
remain separated by currency. No exchange rate or payment settlement is inferred.
Pending → Reconciled requires reviewed, fully allocated supporting evidence;
Completed requires Reconciled. Reopening and unlinking preserve an audit trail.
Invoice allocations cannot exceed the reviewed invoice amount or cross currencies.

## Intake and review

Manual entry and CSV/PDF imports share the same transaction model. CSV files
support column mapping and explicit row correction. Dates use YYYY-MM-DD and
amounts use decimal points, with negative amounts indicating outgoing money.
Imports are staged before confirmation, retain their originals and errors, and
resume in atomic batches. File hashes and provider/account transaction identities
deduplicate reliable repeats; weaker similarities remain visible for review.

Forward PDFs to `statements@finance.thatcanadian.dev`. The raw email and original
PDFs are saved with sender, subject, and message provenance. **Every forwarded
PDF initially requires an authorized member to choose Approve processing.**
Saved sender addresses label recognized senders; they do not bypass this check.
Untrusted email Authentication-Results headers are not sufficient to establish
sender identity. Uploaded PDFs can start processing immediately.

PDF.js extracts text. Scanned pages use self-hosted Tesseract English/Dutch OCR
inside the existing Cloudflare Browser binding. The OCR runtime does not use a
third-party CDN or OCR vendor. Extracted text is sent to the exact OpenRouter model
saved in Finance Dashboard settings (initially `deepseek/deepseek-v4-flash`) with
`zdr: true`, `data_collection: deny`, and `allow_fallbacks: false` on every request.
There is no alternate-model or relaxed-privacy fallback. Originals, extracted
results, audit data, and provider-reported generation cost are retained in Convex;
ZDR applies to model-provider processing, not to the application's records.

Invoices and receipts never create bank transactions. Bank statements create
reviewable import previews only. Card assignment requires a literal payment-card
context and original-page evidence. Conflicting evidence stays unresolved. AI
output and OCR are suggestions and require review before financial confirmation.

## Bounds and operations

- CSV: 5 MB, 1,000 rows per import. PDF: 15 MB, 40 pages, 240,000 text characters.
- Email: 25 MB with at most 10 PDF attachments, each at most 15 MB.
- Transaction queries cover up to 2,000 records within the selected date range;
  incomplete coverage is visibly flagged. Narrow dates to review older periods.
- Document/import history uses cursor pagination. Refresh reads saved Convex data;
  it does not re-run AI or call external bank APIs.
- Failed processing preserves originals. Processing leases prevent concurrent
  attempts; retries honor provider Retry-After and have a bounded attempt count.
- The address book stores postal addresses and optional contact details. There is
  no automatic outbound email, reminder sending, bank connection, or fabricated
  invoice generation in this release.

`npm run check` validates the project. `npm run deploy` builds, deploys Convex to
production, verifies the existing bank ledger, deploys Cloudflare, configures the
email rule, seeds the module idempotently, and verifies the hostname/login/model.
`npm run statements:configure` rechecks that setup without replacing existing
routing rules. The new custom domain receives Cloudflare-managed DNS and HTTPS.

The service-token-protected POST `/api/internal/statements/verify-extraction`
checks deployed PDF extraction and the saved model with a fixed synthetic invoice.
It creates no financial records. Never log the service token or provider key.
The application intentionally retains statement originals; do not purge storage
or alter production datasets as part of a normal release or rollback. Roll back
application code through the normal production release workflow and retain the
additive statement tables for recovery.
