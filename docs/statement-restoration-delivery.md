# Statements restoration — local implementation delivery

Implementation date: 29 October 2026. Baseline: `6ae8496` on `main`.

This delivery is local development and isolated testing only. No push, production release, live migration, live record change, real email, or provider transaction was performed. The existing production release workflow is unchanged. Production activation requires separate authorization.

## Delivered behavior

| Area | Result |
| --- | --- |
| Navigation | Exactly AMG Holding, Artec, Inch Engineering, Digital Nudge, Inch Digital, MZS Bouw, Revolut LMD, Amex LMD and Mix Transactions. Unauthorized workspaces are disabled; queries enforce access independently. |
| Company/account model | Seven legal-company identities; Revolut LMD and Amex LMD belong to LoveMeDo B.V. and retain distinct financial-account contexts. Accounts carry provider, historical flag, verification, notes and separate policy scope. Additional configured accounts appear in forms and filters without creating top-level tabs. |
| Wise history | `wise-lmd` remains a historical account, accessible through authorized account filters. No historical source, transaction, card or document is reassigned automatically. Existing records without verified context remain unresolved. |
| Cards | Multiple explicit mappings per account, with source/account constraints. 5196, 4440 and 6805 remain the known company mappings. Card 1003 cannot be assigned. Conflicting mappings remain review issues; arbitrary four-digit text is not card evidence. |
| Mix workspace | One canonical transaction ledger with legal company, financial account, provider, card and provenance intact. Permissions apply before records and totals are returned. Totals remain separate by currency. |
| Filters and pagination | Search, legal company, account, service, card/unassigned card, dates, amount bounds, currency, direction, PDF, address, visibility, review/document/completion states, unresolved context and trash. 10/25/50/100 rows, counts, sorting and URL state. |
| Transaction actions | Generate, edit/review, attach, view/download, complete, Done/undo Done, forget/undo forget, hide/unhide, reopen, history, reminders and reversible trash. Secondary actions use a menu. Missing merchant addresses remain visible in the table. |
| Bulk work | Select visible/all matching, copy selected, export selected/matching, per-record generation/correction, completion, Done, requests, forget, hide, trash and restore. Results distinguish successful, failed and skipped records. Permission-disabled actions explain why. |
| Saved-data coverage | Worker queries scan saved Convex pages at one consistent timestamp; the former 2,000-row UI cutoff is removed. All-matching exports use one snapshot, up to 20,000 rows, with an explicit error instead of a partial export. A 2,101-record fixture verifies totals and last-page coverage. |
| Manual entry | Existing multirow entry retained, including duplicate-row, company/account, date, direction, amount/currency, merchant, description, reference, service, account, card, provider ID, fee, balance and notes. Named-account defaults and per-row mixed contexts are supported. |
| Imports | Multiple CSV/PDF files, individual previews, mapping, errors, original files, timestamps, history, correction snapshots and safe resumption. Reliable IDs are scoped by company/account/provider; date-and-amount similarity alone does not reject a transaction. History shows added, duplicates, skipped, rejected and unresolved counts. |
| Document library | Uploaded/generated, search, downloaded/not-downloaded, month and direction groups; visible/month/group selection, individual/batch/all-matching downloads, opening, cancellation and mark-not-downloaded. Issue, transaction and creation dates are distinct. Original files and historical versions remain stored. |
| Pending documents | Sender, subject, original attachment/email, received date, extraction/review state, routing failures, scope correction, suggested matches and explicit allocation/linking. An attachment never marks a transaction paid. |
| Completed workspace | Search, filters, month headings, linked evidence, reason, actor/time and permitted undo. Unknown historical completion reasons remain visibly unverified. |
| Address book | Structured contacts retained; search, missing-address filtering, company/account scope, pagination, authorized CSV export, PDF/image references, approved aliases and descriptions. Sourced research can be approved, edited or discarded. |
| Settings | Legal/sender/bank details, account notes, inbox keywords, policy references, explicit automation precedence, tax/date configuration, account registry, permissions, persistent document designs and in-app reminders. Existing Exact, mailbox and receipt-camera modules are retained. |
| Visual identity | Scoped Statements styling measured from the legacy public stylesheet: lavender/gray backgrounds, purple controls, rounded panels, Inter/IBM Plex Mono, status and direction colors. Company-first navigation and compact tables retain the new application's components. Finance and Receipt Camera styles were not edited. |

“Skipped” imports count processed rows that were not inserted; reliable duplicates are a subset, not additional missing rows. “Rejected” counts validation errors retained for correction. Unresolved rows are preserved rather than guessed. Imports with validation errors require correction before confirmation.

## Invoice defects corrected

- Business idempotency uses document type, legal issuer, financial account and selected transaction financial revisions. Different request IDs/users and overlapping selections cannot create a second active document. Request retries and PDF rendering have separate leases.
- Internal documents identify the legal company as preparer/issuer and the merchant as counterparty. They explicitly say they are supporting documents, not supplier-issued invoices. Supplier examples never authorize impersonation.
- Automatic 21% VAT is removed. Internal documents show **Tax not assessed**. Sales invoices require approved legal identity/address, an explicit tax policy/rate, and a date policy; no VAT number or universal rate is fabricated.
- Number allocation is atomic per legal issuer, document type and year. Both LMD accounts share the LoveMeDo sequence. Supporting documents and sales invoices use different namespaces. Operator configuration can increase a sequence but cannot rewind it.
- Generation saves a linked document and allocation evidence. It does not assert payment. Automatic completion runs only under a separately verified policy.
- Financial edits mark affected generated documents stale and preserve the PDF. Regeneration creates a new version, records the predecessor and supersedes the old version only after the replacement is saved. Cancellation releases allocation evidence without deleting files.
- Approved company details and designs permit one-click generation and saving. Missing facts open one compact correction form. Preview is optional; there is no mandatory preview/review checkbox.

### State definitions

| State | Meaning and reversal |
| --- | --- |
| Review | Pending, reviewed or unresolved transaction information. It is independent of visibility and follow-up. |
| Document | Missing/requested/available/stale/failed evidence, alongside immutable document versions and their own lifecycle. |
| Completed | The documentation obligation is resolved with reviewed full-amount allocations or an explicit manual review reason. Store actor, time and reason. It does not mean paid. |
| Done | Administrative closure of an already completed record. Undo Done preserves completion evidence; reopening completion clears Done as well. |
| Forgotten | Follow-up suspended with a reason. Undo Forget resumes follow-up; neither operation asserts completion. |
| Hidden | Visibility only. Hidden records remain accessible through authorized filters. |
| Trash | Reversible deletion state. Originals and audit history are retained. |

The old `status` property remains a projection used by existing readers; separate workflow fields carry the independent facts. Historical Done or completion timestamps are not invented during migration.

## Merchant intelligence and automation

Imports and manual entry enqueue exact normalized merchant identities asynchronously. Approved explicit aliases can match existing profiles; similar-looking names are not merged. Profiles are scoped by legal company/account and contain canonical identity, website, category, address/type/country, logo source, descriptions, source URLs, confidence, conflicts, verification and research timestamps.

Research uses the existing Cloudflare OpenRouter credential, the saved dashboard model, and an explicitly selected OpenRouter Exa web-search tool. See `statement-merchant-research.md` for activation and credential requirements. Returned sources must belong to retrieved evidence. Documents/search snippets are untrusted input. Company information remains a suggestion until approval; refreshes never replace approved overrides. Category descriptions are generic (hosting, insurance, domains, advertising, software, accounting and telecommunications) and do not invent products, periods, tax or purchase purpose. Logo research does not authorize its use.

The queue processes at most three research profiles per minute, uses leases, bounded retries and provider retry guidance, and schedules refreshed suggestions after 30 days. Missing credentials leave an explicit blocked state. Ordinary page loads use saved data. Automatic document requests have a separate durable queue with two jobs per minute, five-attempt limits and permission/policy/revision revalidation at execution. Terminal failures create in-app notifications. Rules remain disabled until precedence and the policy reference are explicitly verified.

## PDF design engine

Seven persistent styles are available: corporate, minimal, technology, insurance, professional services, retail and subscription. Approved category preferences select the initial style; saved choices are stable. Authorized administrators can change colors, select a template, upload a PNG/JPEG company logo (128 KB maximum), lock/unlock a design and preview it with synthetic data. Each saved design has a version and actor/time; uploaded logo bytes are retained inside the version. Unapproved branding is stripped from generated layouts.

The print renderer includes legal parties, the correct document title/number/date, currency, exact monetary totals, tax assessment, repeated table headers, page numbers and multi-page output. Approved designs are used for safe regeneration; historical PDFs are immutable.

## Database changes and migrations

New tables: `statementAccounts`, `statementPolicies`, `statementMerchants`, `statementAutomationJobs`, `statementNotifications`, `statementContactReferences`, `statementTemplateVersions`, `statementNumberSequences`.

Existing tables gain optional account/workflow/permission/version metadata and supporting indexes. In particular: transaction financial revisions and separate states; member action/account grants; document generated-invoice linkage and download/cancel fields; account-scoped invoice profiles; invoice business keys, predecessor/supersession, type and template version; original raw-mail storage linkage. Existing ledger tables, financial amounts, file IDs and source identities are not replaced.

Explicit operator functions in `convex/statementWorkspace.ts` support dry runs:

- `seedAccountMetadata`: create unverified canonical LMD account metadata only; moves no transactions/cards.
- `migrateAccess`: preserve existing legal membership and derive existing action access, with no inferred account grants.
- `configureAccess`: apply an explicitly supplied member grant set, operator and policy reason. This is necessary to bootstrap new legal/account access; a UI administrator cannot grant access they do not hold.
- `migrateWorkflow`: bounded transaction updates; preserve review history and unknown historical completion details.
- `migrateIdentity`: calculate scoped identities, detect collisions and refuse a conflicting page before changing it.
- `migrationManifest`: read-only paginated IDs, source/account/card, money, documents and proposed identities for full-dataset comparison. Aggregate proposed identities across **all** pages before applying the migration; a single page dry run is not a whole-dataset uniqueness proof.
- `configureNumberSequence`: explicitly approved issuer/type/year next number; never decrease/reuse a sequence.

No migration runs automatically on an existing database. None was executed against a remote deployment. Production migration requires a write freeze, verified backup and separately approved grants/mappings. There is no Wise-to-Revolut conversion.

## Verification and evidence

The browser harness uses real Worker handlers and an in-memory `convex-test` database with synthetic records, loopback HTTP and local headless Chromium. It does not load `.env.local`; its Vite server uses `envDir: false`. Network access is blocked outside loopback and in-memory storage. Test scheduling clears inherited Node transaction context and drains the real scheduled handlers. No production or shared development Convex deployment was used.

Executed checks are recorded in [the validation record](statement-restoration-validation.md). The final file inventory is in [the changed-file manifest](statement-restoration-files.txt).

Browser coverage includes nine tabs, account filtering, sortable URL state, desktop/tablet/mobile overflow, one-click generation, missing-data correction, full saved-data counts and exports, manual duplicate rows, multi-file CSV processing, byte-identical original PDFs after regeneration, design previews, contact evidence, reminders and Completed/Done reversals. Backend tests additionally exercise concurrency, financial precision, account/action isolation, cancellation, migrations, queues, rate limits, approval retention and template locking.

The before screenshots show baseline `6ae8496` rendered locally against synthetic data. They are not a repeat audit of the old production dashboard. PDF examples are synthetic and are not usable accounting documents. Artifacts remain under ignored `output/`; generation scripts and tests are committed.

## Configuration dependencies and remaining release checks

| Dependency | Current status / activation requirement |
| --- | --- |
| Public merchant research | Research uses the existing Worker `OPENROUTER_API_KEY` and saved dashboard model. No Brave or separate Exa credential is needed. See `statement-merchant-research.md`; the original restoration tests used mocked provider responses. |
| PDF/OCR and background generation | Local Chromium rendering passed. Hosted Cloudflare Browser binding and configured processing callback still need an isolated hosted smoke test. Convex requires `STATEMENT_PROCESSOR_URL` and a matching service token; localhost additionally requires `STATEMENT_ISOLATED=1`. Production Statements processing requires the explicit `STATEMENT_PRODUCTION_PROCESSING=approved` flag after release authorization. |
| Gmail/Outlook | Existing OAuth, incremental ingestion, token protection, original email/attachment preservation and queue implementations retained and regression-tested with fixtures. Requires provider client IDs/secrets, `MAILBOX_ENCRYPTION_KEY`, approved mailbox connection and registered callbacks. No real mailbox was connected or email sent. |
| Exact and receipt camera | Existing implementations retained with stronger Statements management checks. Credentials/device authorization and isolated live-service smoke tests are outstanding. No Finance/Receipt Camera visual changes. |
| Bank connections | Existing Finance bank integrations remain intact. Account/provider settings are separate in Statements, but no new direct Statements-to-bank synchronization has been activated. A verified binding between each Statements account and a supported bank connection, plus provider authorization, is still required; CSV/PDF intake works independently. Do not infer bank mappings from labels. |
| Legal/tax policy | Actual legal names/addresses, VAT identifiers, sales-invoice tax/date policy and numbering-policy approval must be supplied/verified by authorized users. Unknown information stays unresolved. |
| Historical data | Wise identity, LMD account ownership, pre-existing generated documents and old numbering must be checked against the complete migration manifest. Existing active historical documents block overlapping new generation until reviewed. Card 1003 remains unassigned. |
| Old automatic rules | The old rule implementation/precedence was not available as source evidence. Rules require a recorded verification before activation; no guessed precedence is enabled. |
| Branding | Existing brand assets are only used when authorized. Uploaded logos require an explicit authorization setting. Supplier logo suggestions never grant permission. |
| Scale/runtime | In-memory tests do not prove hosted Convex OCC, Cloudflare limits or deployment wiring. Run the same fixtures against a newly isolated hosted environment before production. Large contact/research registries use bounded per-company reads; monitor coverage before exceeding those bounds. |

There are no known failures in the executed local test suites after fixes. External integration activation, historical/account/legal approvals and hosted runtime verification are **not claimed complete**. Bank-specific account bindings are a release dependency, not an inferred migration.

## Safe deployment and rollback instructions

Do not execute these steps under the present local-only authorization.

1. Review the local commit and feature/permission matrix. Obtain separate authorization for publishing, production deployment and any live-data migration.
2. Create a genuinely isolated staging deployment with synthetic fixtures. Do not use production `famous-oyster-878`, nor assume `fabulous-elephant-597` is isolated. Verify Convex URL, Worker binding, processor URL, credentials and outbound integrations explicitly.
3. Configure only staging providers and run unit/integration/E2E tests plus hosted concurrency, file storage, PDF/OCR and queued-job tests. Verify no callback or email route targets production.
4. Before an authorized production migration, stop intake and background writes, export the database **including file storage**, and verify restore/record counts, currency totals, file hashes and IDs. For any database cutover, back up both environments and preserve file/document IDs as required by project policy.
5. Review the whole migration manifest for duplicate proposed identities, unresolved scopes, legacy generated-document classifications and numbering collisions. Record the approved access matrix, legal identities, account mappings and rule precedence. Run every migration in dry-run mode first, then bounded approved batches. Compare money/source/card/document manifests after each batch; do not continue on mismatch.
6. Release only through the existing `npm run deploy` workflow after approval. Its production destination must remain `prod:famous-oyster-878` / `https://famous-oyster-878.convex.cloud`. Never use `.env.local` to select production, `convex dev` as a release step, or development data as a production replacement. Coordinate the fail-closed permission migration and frontend/backend switch in a maintenance window.
7. Verify Convex and Cloudflare deployment results, correct Worker binding, authorized/unauthorized account access, read-only live counts and original-file access. Enable external processing/rules deliberately after the data and permission checks. Synthetic financial write tests belong in staging.
8. If validation fails, keep intake/automation stopped. Prefer a forward fix. A rollback must preserve additive schema, new workflow fields, account grants, immutable PDFs and audit rows; blindly deploying the old code can reintroduce ambiguous statuses and invoice defects. If a database restore is necessary, use the write-frozen verified snapshot and reconcile all writes since it. Never delete new document history or overwrite production with development.

The production deployment script was not run. The local commit was not pushed because publishing may trigger automation outside the authorized local scope.
