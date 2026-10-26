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
Digital, and MZS Bouw. All companies queries the same canonical records.
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
PDF initially requires an authorized member to choose Allow AI to read file.**
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
  no automatic outbound email, reminder sending, bank connection, or automatic invoice sending.

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

## Select all and plain language

The interface uses Company, Needs checking, Checked, Done, and Paid to / received
from. Select this page and Select all matching transactions are separate actions.
Selection persists across pages and clears when filters or sorting change. Full
selection requires complete coverage within the existing 2,000-record limit.
Bulk changes run in groups of 50; confirmed groups remain changed when a later
group fails. Unknown outcomes are never retried automatically. Trash is reversible.

## Create AI invoices

Settings → Invoice examples accepts one reusable example per company (PDF, up to
5 MB and 5 pages). AI reads its text and suggests company details and header/footer
cuts. The user previews and approves the layout. Only rasterized header/footer
strips enter the new PDF, so hidden text from the old invoice is not embedded.
The first page supplies branding; the new body uses a clear, paginated invoice
layout. This is not a pixel-for-pixel copy of every example's body.

Select 1–200 transactions from one company, one currency and one direction, then
Create AI invoice. Enter the customer, address, unique invoice number, dates,
explicit tax rate and whether selected amounts include tax. The same saved
OpenRouter model writes descriptions with ZDR, deny data collection, and no
fallbacks. AI cannot change IDs, amounts, currency or tax. Exact decimal
calculations round tax per line in the currency's smallest unit.

Drafts are saved before AI generation, protected by a lease and request ID, and
can be retried after failure. Review/edit the draft and preview its PDF before
saving the final invoice. Final PDFs are stored and immutable; changed source
transactions block finalization. Discarded drafts retain history and release the
unused invoice number. Created invoices shows the latest 100 records. This does
not send email, post to Exact, mark payments or add evidence links automatically.
Templates, source snapshots, drafts, model/cost metadata and PDFs remain in Convex
under existing company access controls. Uploading a replacement example does not
change existing invoices.

The service-token-protected POST `/api/internal/statements/verify-invoice` runs a
fixed synthetic AI/PDF check, creates no financial records and returns a sample
PDF. It verifies the saved model/ZDR and multi-page PDF rendering after deployment.

## Exact connection

The Exact page is implemented but requires the account owner's app registration
before live synchronization can start. Register Statements Dashboard with redirect
URI `https://statements.thatcanadian.dev/api/statements/exact/callback`.
Install `EXACT_CLIENT_ID`, `EXACT_CLIENT_SECRET`, and a random 32-byte hex
`EXACT_ENCRYPTION_KEY` in production Convex server environment variables. Never
put them in frontend variables or source control. Then use Connect Exact and
approve the intended companies. App permissions govern the final company list;
the current login lacks Manage apps and Manage subscription rights.

The dashboard discovers all companies available to the authorized app rather than
hard-coding AMG Holding. It saves customer/supplier accounts, customer invoices,
supplier bills, transactions, open amounts, documents/attachments and reference
lists. Reads use saved Convex data. Supported writes create/update contacts,
create invoices/bills, edit descriptions/references on open invoices/bills, and
create documents/upload attachments. These write paths are implemented and tested
with fixtures; they still need a live account smoke test after app setup. This
release does not process/send invoices, pay bills, match bank transactions, file
tax returns or run payroll through Exact.

Incremental sources and open amounts refresh hourly; reference lists daily.
Permission discovery is daily and cached reads block after 26 hours without a
successful discovery. Explicit updates have a 15-minute freshness minimum.
Check older records requests a full reconciliation, and snapshot sources reset
after company moves or extended inactivity. A global lease serializes API calls,
rotating refresh tokens are encrypted and saved before reuse, and rate-limit
headers control retries. Ambiguous financial writes are marked uncertain and
never automatically repeated. Completed snapshots survive failed/partial updates.
The Exact view is capped at 2,000 source rows including detail rows and tombstones;
partial coverage is shown and CSV export is disabled for incomplete/failed data.
File transfers are limited to 3 MB. Original statement data is not replaced by
Exact data; no database cutover is part of this release.
