# Financial documents

Forward PDF, PNG, JPEG, or WebP receipts and sales invoices to **receipts@finance.thatcanadian.dev**. Sender restrictions are empty: any address can forward documents. The finance subdomain has its own Cloudflare MX records; the apex domain retains its iCloud mail service.

The same intake is available through **Upload documents** on Documents, Expenses, and Invoices, and through private Telegram attachments from the existing mapped Ali and Ali M accounts. Files are limited to 10 MB each and email is limited to 25 MB. All supported attachments in a message are saved before the email is accepted. Email-only receipts are saved as a clearly labeled PDF copy of their email text. Sending an original attachment preserves the original bytes.

## Processing and matching

1. Validate file type and size, store the original in Convex storage, and record a SHA-256 fingerprint. Duplicate files across channels share an archive entry.
2. Durably schedule extraction immediately. A dedicated multimodal OpenRouter model reads the document. A processing lease, bounded requests, three attempts, and a recovery job handle temporary failures.
3. Classify supplier documents as expenses and company-issued documents as sales invoices. Missing company, date, amount, currency, or low-confidence extraction remains in Needs review.
4. Match against indexed, currently connected bank transactions with the same gross amount, currency, direction, and company. Automatic matching requires supporting counterparty/reference evidence and a unique candidate. The date window is seven days before through 90 days after the document date. Review also suggests posted Amex charges in a different currency within seven days of the expense date when the merchant overlaps. These are suggestions only: the statement's billing amount does not prove the original invoice amount. Both amounts and the cardholder/card digits are shown, and an explicit currency-conversion confirmation is required. Split payments and same-currency fee adjustments remain unsupported.
5. Preserve accounting payment state. A matched invoice remains open, and a matched expense remains unpaid until explicitly confirmed through the existing payment controls.

Matching runs as part of extraction. Unmatched documents are checked again after five-minute bank syncs, with bounded batches. The document's status details expose the measured extraction duration. No fixed processing time is guaranteed; model and bank availability affect latency.

Originals are grouped under Digital Nudge or Love Me Do and their document month. Unknown-company documents appear under Unassigned. Bank suggestions are available during metadata review, even before the company is selected; saving still requires a company. Staff can correct extracted metadata and confirm a bank link in one save, retry failed processing, review matching bank candidates, and download originals. Confirmation rechecks the active connection, current transaction identity, posted status, company conflicts, and other document claims. All document APIs and downloads require dashboard authentication. Telegram usernames and display names never grant access; the existing private chat-ID mapping is authoritative.

Merit originals are archived on download and in quarter-hour batches. Existing expense source files are indexed without copying their bytes. Invoice PDFs and expense receipts remain separate from generated missing-receipt declarations.

## Duplicate recognition and Trash

The default **Grouped documents** view shows one purchase with expandable original files, usually led by its invoice. Accept either an invoice or receipt; when both arrive, preserve both. Arrival order and whether files arrive in one email or separate emails do not determine purchase identity.

Extraction stores the document type plus separate invoice, receipt, order and payment references. A receipt's printed invoice number connects it to the invoice even when its receipt number differs. Automatic grouping requires corroborated supplier, gross amount, currency and reference evidence, with no company or accounting conflicts. Invoice/receipt dates may differ by up to 120 days; copies of the same type require dates within seven days. Equal amounts or the same email never prove identity. Specific filenames and the primary document number also remain corroborating evidence for copies.

The backend saves a stable purchase ID on every related original. Processing and manual bank matching reuse one expense and update all active files in that purchase; neither operation changes its payment status. Recognized copies reuse the same expense even when an earlier source file is in Trash. Exact byte duplicates are caught at intake across all channels.

A possible supporting file stays in **Needs review** before it can create another expense. **Review related files** offers **Same purchase** and **Separate purchases**. These choices persist across rematches and subsequent copies. Same purchase preserves both originals and refuses conflicting amounts, currencies, companies, expenses or bank links. Existing conflicting accounting records must be reviewed separately; the system never deletes or silently consolidates those records.

**Check saved files** deliberately starts a durable, serial recheck of existing expense originals. It enriches references and purchase links only, preserves previously saved financial metadata, and cannot create new accounting entries. Successful reference checks are versioned and reused. Repeated starts are deduplicated; leases, watchdogs, three bounded attempts and provider Retry-After guidance govern failed requests. Progress and failures are visible in Documents; retrying skips successful checks. A new reading that disagrees with saved supplier, amount, currency, company or date is retained as a visible error without replacing good data. Company and reference corrections remain available through document review. Normal refresh only reads saved data.

Choose **All files** to select an individual original. Selecting a grouped row selects all its files for ZIP download or **Delete selected**. Deletion requires confirmation and moves the selected originals to **Trash**, where **Restore selected** returns them to the library. Trashing files preserves their IDs, storage, linked expenses, invoices, and bank transactions; it does not undo accounting entries. Trashed files are excluded from processing and rematching. Files currently processing must finish before deletion. Bulk mutations validate the entire batch before writing, with at most 200 files per batch.

Grouping uses saved purchase connections and corroborated metadata. Reference enrichment is additive and never removes source files. Folder counts represent rows in the chosen view; the toolbar also reports the number of original files.

## Deployment and operations

- Worker: `finance-dash`, with an `email` handler and the recipient-specific Cloudflare routing rule.
- Convex variable: `DOCUMENT_PROCESSOR_URL=https://finance.thatcanadian.dev/api/internal/documents/process`.
- Worker secrets: existing `CONVEX_SERVICE_TOKEN`, `OPENROUTER_API_KEY`, and Telegram credentials.
- Worker variable: `DOCUMENT_AI_MODEL`, separate from the configured text assistant model.
- Telegram webhook: `/api/telegram/webhook`, authenticated using a token-derived secret. Each chat has its own durable queue, duplicate-update tracking, and recent conversational history. Action results are saved before reply delivery; an interrupted action with an uncertain result is not reexecuted.
- `/ask` and plain questions use current dashboard data and read-only lookup tools. They cannot record payments or execute action commands. Existing explicit commands retain their confirmation rules.
- Service-token-protected maintenance endpoints: `/api/internal/telegram` (webhook status or a read-only timed assistant check without changing conversation history) and `/api/internal/documents/archive-invoices` (up to eight invoice IDs per batch).

The overview displays approximate USD totals separately for each Wise company, Revolut, and other banks. Native balances and rate timestamps remain available through the information control; a missing currency quote suppresses a misleading complete estimate.
