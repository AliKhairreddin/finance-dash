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

The address book supports company-specific records and shared contacts under
All companies. Shared contacts appear in each company workspace. Only managers
with access to all six companies can change shared contacts. Invoice names,
VAT numbers, usual descriptions and explicit name aliases are saved with the
address. Invoice forms automatically fill matching saved details and remain
editable. User edits survive later saved-profile loading. Changing the company
clears the previous company’s details before applying the new match. Contacts
with a Needs checking note are excluded from automatic filling until corrected.
AI description suggestions remain available when no saved description exists.
The editable invoice tax rate starts at 21%. Original imported details and source
references remain in the contact's notes. Missing VAT and address details stay
blank.

Settings → Invoice examples stores examples by the company issuing the invoice,
including suppliers selected from the address book. Use an upright, text-based,
one-page PDF up to 5 MB. AI maps replacement areas from the original text positions. This extraction request
uses the same model with reasoning disabled to avoid long reasoning timeouts
(the deployed DeepSeek v4 Flash supports `reasoning.effort: none`).
The PDF renderer preserves the original page as a raster background, removes old
values from that raster itself, and writes the new details into the mapped areas. Logos, rules, headings
and artwork retain their original positions. Replacement text uses matching
sans/serif fonts, not the original embedded typeface. Preview and approve the
layout before use; inspect it for any remaining old values. Overlapping areas,
out-of-page coordinates and overflowing replacement text are rejected. Large
selections that do not fit must be split; notes/due dates require mapped areas.

Without an example, each issuer receives a saved design with white paper, dark
text and restrained accents. Our verified logos/colors are documented in
`public/invoice-brands/SOURCES.md`; other companies receive a consistent typographic
design. Supplier aliases use their saved canonical company name, so the design is
shared across buyer workspaces. Approved examples take priority, within the user's
company permissions. Each invoice snapshots its design so later changes do not
alter it.

Select 1–200 transactions from one company, one currency, one direction and one
other company (saved aliases count as the same company), then Create AI invoice.
Saved addresses/VAT are applied automatically. Leave the invoice number blank to
assign an atomic per-workspace/year sequence such as INCH-2026-000001. Numbers are
reserved before AI starts and retained across retries. Manual numbers remain
editable and cannot collide. The default date is the selected transaction date;
for several dates, use the latest selected date. It remains editable. The saved
OpenRouter model writes descriptions with ZDR, deny data collection, and no
fallbacks. AI cannot change IDs, amounts, currency or tax. Exact decimal
calculations round tax per line in the currency's smallest unit.

Drafts are saved before AI generation, protected by a lease and request ID, and
can be retried after failure. Review/edit the draft and preview its PDF before
saving the final invoice. Final PDFs are stored and immutable; changed source
transactions block finalization. Discarded drafts retain history and release the
unused invoice number. Created invoices shows the latest 100 records. Transactions show AI generated and a PDF link as soon as a draft is ready, with
an additional Draft label until finalized. The same link serves the saved PDF
after finalization. This display state does not mark a transaction checked, done,
paid, or posted to Exact. Discarding a draft restores an earlier valid invoice
link if one exists. Editing the source transaction clears the current link;
invoices and source snapshots remain in history. Our-company names and other
companies have different chip styles; outgoing rows show Address missing below
the recipient when no usable saved address exists. Nothing is sent by email or
added to reconciliation evidence automatically.
Expected invoice errors use Convex's structured error data in production. A used
invoice number points users to Created invoices or a different number; the
existing invoice and saved company details remain unchanged.
Templates, source snapshots, drafts, model/cost metadata and PDFs remain in Convex
under existing company access controls. Uploading a replacement example does not
change existing invoices.

The service-token-protected POST `/api/internal/statements/verify-invoice` runs a
fixed synthetic AI/PDF check, creates no financial records and returns a sample
PDF. It verifies the saved model/ZDR and multi-page PDF rendering after deployment.

Release migration: run `statementInvoices:backfillTransactionInvoices` on production
with `{paginationOpts:{cursor:null,numItems:20}}`, following `continueCursor` until
`isDone`. It adds only invoice links/display metadata to existing draft/final
transactions, preserving financial revisions, amounts and existing PDF storage IDs.

## Receipt camera

`https://receipts.thatcanadian.dev` is a separate public, mobile camera app in the
same Worker. It never asks for dashboard sign-in or uses a dashboard session.
In Statements → Settings → Receipt camera, a manager creates a private phone
setup link. Add the camera website to the iPhone Home Screen, open that app,
then paste the link into its connection screen once. Safari and installed web
apps may have separate storage, so connect inside the installed app. Camera
permission remains controlled by iOS. No native app or App Store is needed.

The phone retains a random 256-bit upload-only key in local storage with no
timed expiry. Convex stores only its SHA-256 digest. One key per manager may be
active; Disconnect phone revokes every copy. A lost link can be replaced by
disconnecting and creating another. Clearing website data removes the phone's
connection. Keys cannot read documents, access financial APIs, or change bank
transactions. Each upload rechecks the manager's access. Atomic counters limit
each key to 5 attempts per minute and 120 per 24 hours. No key or setup URL is
written to logs. Setup secrets use URL fragments and are removed after import.

The camera opens automatically and uses the rear camera. One pending permission
request is shared by overlapping resume events. The same stream is reused for
retakes and subsequent receipts; its tracks are disabled during review and while
the page is hidden, so capture is paused. Leaving the page releases the stream.
iOS may end the stream or terminate the app, and a fresh launch can prompt again.
Home-screen camera permission persistence is a known WebKit issue; the website
cannot force iOS to remember permission. Safari's per-website Camera → Allow
setting applies to Safari, not reliably to the separate home-screen app.
See https://bugs.webkit.org/show_bug.cgi?id=327237.
Dedicated camera-and-receipt artwork supplies the favicon, Apple touch icon and
manifest icons. Versioned filenames avoid reusing the Finance icon's cache entry;
an already-installed iPhone icon may still require adding the app again.
The web scanner detects receipt boundaries in the live view. Tap Scan, check or
drag the four corners, then Use scan to crop and correct perspective. Capture is
manual; a detected outline does not automatically take a picture. If edges cannot
be detected, the editor explicitly asks the user to set the four corners. Detection
and correction use pinned, self-hosted OpenCV in a dedicated browser worker; no
images leave the phone for this processing. Its runtime may generate functions,
so only that worker asset receives a separate CSP allowing evaluation, with all
network access disabled. The page's script policy remains restricted to self.
Keep all corners visible on a contrasting surface. Curled paper and poor lighting
can still need a retake; this is perspective correction, not curved-page dewarping.
The camera supports centered 1×–3× digital zoom with a two-finger pinch or − / +
buttons. Tap the zoom number to reset. The preview, live edge detector and saved
capture use the same crop, without upscaling the saved image. This does not switch
lenses or add optical detail; moving the phone closer is preferable for small text.
1× is the widest available view. Touch/gesture handling is limited to the camera
surface, leaving browser accessibility zoom available elsewhere. The preview clips
the enlarged video within its fitted frame; the app also fits landscape screens.
The original is saved in IndexedDB before processing. The cropped JPEG and exact
one-page PDF are saved before review; the original remains available for Adjust
edges until sending or retaking. Send requires internet; unsuccessful/uncertain
delivery retains the draft and retries reuse identical bytes for deduplication.
Confirmed intake clears the local draft. There is no offline app-shell cache or
background upload; keep the app open until Send is confirmed. Existing durable
OCR, AI privacy controls, company assignment and human review apply. Sending does
not mark a receipt paid or create a bank transaction. No existing records are
migrated; the only schema addition is the device authorization table.

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

## Connected Gmail and Outlook mailboxes

Settings → Connected mailboxes supports individual, delegated OAuth connections.
Each Connect click opens the provider account chooser. It does not discover or
monitor other accounts in the organization. Accounts from different Google
Workspaces can be connected independently using an **External** Google app.
Only full Statements managers can connect, disconnect, or view mailbox status.
The connection dialog records approval to analyze document candidates with the
existing AI service and share imported documents under Statements access rules.

### One-time provider app setup

Configure these secrets **on Convex production `famous-oyster-878`**, not in the
browser or the Cloudflare public variables:

- `MAILBOX_ENCRYPTION_KEY`: 32 random bytes, hex encoded. Configured for this release.
  Preserve it; changing it makes stored credentials unreadable.
- `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`: Google OAuth Web application credentials.
  Enable the Gmail API, select an External audience for multiple Workspaces,
  request `https://www.googleapis.com/auth/gmail.readonly`, and register exactly
  `https://statements.thatcanadian.dev/api/statements/mailboxes/gmail/callback`.
- `OUTLOOK_CLIENT_ID`, `OUTLOOK_CLIENT_SECRET`: Microsoft Entra Web application
  credentials. Choose the intended organizational/personal account types. Request
  delegated `Mail.Read`, `User.Read`, and `offline_access`, and register exactly
  `https://statements.thatcanadian.dev/api/statements/mailboxes/outlook/callback`.

Store each secret through the Convex dashboard, or use
`npx convex env set NAME --deployment famous-oyster-878` with its secure stdin
prompt. Never put secrets in command arguments or commit them. No additional
Cloudflare secret is required. Status checks reflect configuration automatically.

Google External apps using restricted Gmail scopes may require verification and
an independent security assessment unless an exception applies. Publish the
required privacy policy and meet Google's Limited Use requirements, including
clear disclosure of AI processing. Testing mode is not a durable production
setup: Gmail refresh tokens generally expire after seven days in that mode.
Workspace or Microsoft tenant policies may require admin consent even though
access is granted per selected mailbox. The dashboard cannot bypass provider
policies. A successful synthetic test does not prove real provider consent.

### Import scope and scheduling

The selected date is inclusive at 00:00 UTC. Initial history is paginated in
10-message batches. Provider message IDs are durably checkpointed; original PDFs
are deduplicated by SHA-256 across mailboxes and upload sources. Body/image PDFs
use deterministic metadata for stable retry hashes. A cursor is committed only
after every message on the page is processed. Errors preserve all previous
records and coverage; rate limits honor Retry-After, with exponential backoff and
at most five failed attempts before an explicit retry or reconnect is required.

Connected mailboxes check new mail about every five minutes. Timestamp windows
include a one-hour overlap; daily reconciliation expands that overlap to seven
days. Already-processed message IDs avoid repeated body/attachment downloads.
Scan history deliberately searches an earlier range for missed or late-added
historical messages while reusing known records. This is a receipt-import index,
not a complete local mailbox replica. Reloads only read saved status.

Gmail scans all mail except Spam, Trash and Drafts. Outlook uses received messages
across mailbox folders (excluding drafts); this can include Deleted Items. Shared
mailboxes without their own sign-in and aliases are not separate OAuth accounts.
Only PDFs, candidate non-inline JPEG/PNG attachments, and receipt-like body text
are imported. PDFs are preserved; images/text are converted to PDF. No embedded
HTML is executed or remote attachment links fetched. Inline images, linked files,
other attachment types, and body text outside the renderer's character/size scope
need manual upload. Import issues remain visible. The existing document AI
classifies candidates; every financial field still requires review. Ordinary
email contents are not retained: only processed provider IDs and timestamps.
Candidate documents retain sender, subject, received time and a bounded context.

OAuth uses account selection, PKCE, one-time actor/provider-bound state and a
10-minute HttpOnly state cookie. The dashboard's Strict session cookie is
preserved through a same-origin callback form. Access and refresh tokens are
AES-GCM encrypted server-side. Refresh-token rotations are saved before further
provider calls. Per-mailbox leases fence concurrent scans and stale callbacks.
Disconnect clears credentials and stops future imports; previously imported
documents and the minimal deduplication index are retained. Changes are additive
new tables; existing financial data is not migrated or replaced.
