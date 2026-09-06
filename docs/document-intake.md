# Financial documents

Forward PDF, PNG, JPEG, or WebP receipts and sales invoices to **receipts@finance.thatcanadian.dev**. Sender restrictions are empty: any address can forward documents. The finance subdomain has its own Cloudflare MX records; the apex domain retains its iCloud mail service.

The same intake is available through **Upload documents** on Documents, Expenses, and Invoices, and through private Telegram attachments from the existing mapped Ali and Ali M accounts. Files are limited to 10 MB each; email is limited to 25 MB and 15 supported attachments. Email-only receipts are saved as a clearly labeled PDF copy of their email text. Sending an original attachment preserves the original bytes.

## Processing and matching

1. Validate file type and size, store the original in Convex storage, and record a SHA-256 fingerprint. Duplicate files across channels share an archive entry.
2. Durably schedule extraction immediately. A dedicated multimodal OpenRouter model reads the document. A processing lease, bounded requests, three attempts, and a recovery job handle temporary failures.
3. Classify supplier documents as expenses and company-issued documents as sales invoices. Missing company, date, amount, currency, or low-confidence extraction remains in Needs review.
4. Match against indexed, currently connected bank transactions with the same gross amount, currency, direction, and company. Automatic matching requires supporting counterparty/reference evidence and a unique candidate. The date window is seven days before through 90 days after the document date. Different currency, split payment, and fee-adjusted matches are left for review.
5. Preserve accounting payment state. A matched invoice remains open, and a matched expense remains unpaid until explicitly confirmed through the existing payment controls.

Matching runs as part of extraction. Unmatched documents are checked again after five-minute bank syncs, with bounded batches. The document's status details expose the measured extraction duration. No fixed processing time is guaranteed; model and bank availability affect latency.

Originals are grouped under Digital Nudge or Love Me Do and their document month. Unknown-company documents appear under Unassigned. Staff can correct extracted metadata, retry failed processing, review matching bank candidates, and download originals. All document APIs and downloads require dashboard authentication. Telegram usernames and display names never grant access; the existing private chat-ID mapping is authoritative.

Merit originals are archived on download and in quarter-hour batches. Existing expense source files are indexed without copying their bytes. Invoice PDFs and expense receipts remain separate from generated missing-receipt declarations.

## Deployment and operations

- Worker: `finance-dash`, with an `email` handler and the recipient-specific Cloudflare routing rule.
- Convex variable: `DOCUMENT_PROCESSOR_URL=https://finance.thatcanadian.dev/api/internal/documents/process`.
- Worker secrets: existing `CONVEX_SERVICE_TOKEN`, `OPENROUTER_API_KEY`, and Telegram credentials.
- Worker variable: `DOCUMENT_AI_MODEL`, separate from the configured text assistant model.
- Telegram webhook: `/api/telegram/webhook`, authenticated using a token-derived secret. Each chat has its own durable queue, duplicate-update tracking, and recent conversational history. Action results are saved before reply delivery; an interrupted action with an uncertain result is not reexecuted.
- `/ask` and plain questions use current dashboard data and read-only lookup tools. They cannot record payments or execute action commands. Existing explicit commands retain their confirmation rules.
- Service-token-protected maintenance endpoints: `/api/internal/telegram` (webhook status or a read-only timed assistant check without changing conversation history) and `/api/internal/documents/archive-invoices` (up to eight invoice IDs per batch).

The overview displays approximate USD totals separately for each Wise company, Revolut, and other banks. Native balances and rate timestamps remain available through the information control; a missing currency quote suppresses a misleading complete estimate.
