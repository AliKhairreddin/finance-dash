# Finance Operations Dashboard

Finance Operations Dashboard is a full-stack cash-flow and reconciliation workspace for a media-buying business. It replaces a spreadsheet-driven process with durable transaction imports, counterparty/category learning, team-attributed revenue, invoice drafting and collection, profit distribution, holdings, and currency-aware operating views.

**Showcase:** [finance.thatcanadian.dev](https://finance.thatcanadian.dev)

> **Status:** Development deployment. The Cloudflare deployment is protected by whole-site authentication and currently points at development Convex state. Do not treat the development data store as the final production environment.

## Problem and Approach

The original workflow required manually combining bank activity, partner revenue, providers, clients, categories, invoices, and partner distributions in a shared spreadsheet. The dashboard models those records directly and preserves the operator's decisions so recurring transactions become easier to reconcile over time.

The system follows three rules:

1. Never invent balances when an integration is unavailable.
2. Keep exact native-currency totals visible and label converted USD totals as approximate.
3. Keep external accounting state separate from local review decisions.

## Core Workflows

- Import Wise statement CSVs and deduplicate overlapping uploads by transaction ID.
- Separate incoming and outgoing reconciliation queues.
- Suggest companies and categories from saved aliases, while requiring an explicit review before learning a new mapping.
- Assign transactions and cardholders to teams for filtered operating views.
- Pull recurring client revenue through configured APIs, keep invoice preparation on the Revenue page, and reserve transaction-row invoice drafting for exceptional incoming payments.
- Record outgoing bank payments as paid expenses, or enter unpaid supplier bills first and match the later bank payment by exact amount and currency.
- Preserve supplier-issued receipts and invoices as protected source documents; when an original cannot be obtained, generate a clearly labelled internal missing-document declaration PDF linked to the bank payment.
- Capture Estonia/EU-oriented supplier identity, registry and VAT numbers, economic content, business purpose, supply and due dates, native currency, and VAT treatment, including 24%, 13%, 9%, zero-rated, exempt, and reverse-charge cases.
- Keep local paid/review state independent from Merit accounting status.
- Store clients, suppliers, platforms, tags, invoice-ready details, and provider aliases.
- Preview partner-level or team-attributed revenue through TUNE/HasOffers-compatible integrations without persisting manual searches.
- Run income automation every Monday at 09:00 in `Asia/Beirut`, with DST-aware scheduling, idempotent local drafts, and hourly catch-up retries after the weekly release time.
- Track weekly and monthly current-period revenue as accruing future invoices without double-counting after drafts are created.
- Create a Merit invoice only through a separately confirmed action, with distinct “Save in Merit” and “Save & deliver” choices.
- Match exact incoming bank payments to open invoices and predict collection dates from the latest five confirmed matches.
- Record partial or combined payments with source and notes while keeping dashboard paid state independent from Merit.
- Record cash, exchange, and wallet holdings, including fiat and crypto assets.
- Show a clearly labeled approximate USD total from keyless Coinbase rates while retaining exact native balances.
- Track profit-share, salary, payable, paid, waived, deferred, and manually adjusted distribution amounts.
- Import the legacy Management Report workbook into a dedicated Management workspace with summary, business-unit, platform, offer, ledger, and ownership views.
- Display Wise, Revolut, Slash, Amex-ready, revenue, receivable, payable, company, and distribution workflows without fabricating unavailable data.

## Architecture

```mermaid
flowchart LR
    U["React operations UI"] --> API["Express locally / Cloudflare Worker"]
    API <--> C["Convex durable state"]
    API --> W["Wise CSV and API adapters"]
    API --> R["Revolut / Slash / Amex adapters"]
    API --> T["TUNE partner revenue"]
    API --> M["Merit invoice adapter"]
    API --> D["Protected expense source documents"]
    CRON["Cloudflare scheduled event"] --> API
    SHEET["Management Report workbook"] --> IMPORT["Validated manual import"]
    IMPORT --> C
    C --> U
```

### Runtime Modes

- **Local:** Vite frontend plus an Express server; local state is written under `.local/` when Convex is not configured.
- **Cloudflare:** Static assets and API routes run from one Worker.
- **Convex:** Stores the durable dashboard snapshot and rejects unauthenticated or stale whole-state writes.

## Reliability and Data Integrity

### Exact and Approximate Currency Views

Derived cash, revenue, payable, distribution, and profit metrics stay grouped by native currency. Headline cards and panel totals convert those buckets into one USD amount using timestamped, keyless Coinbase rates; the exact native-currency split remains visible underneath or in the underlying rows. Rates refresh hourly and with Sync, retain last-known values during a feed interruption, and disclose stale or unsupported currencies instead of presenting an incomplete amount as a total.

### Learned Matching Without Silent Mutation

Counterparty and category aliases are created from reviewed matches. Revenue rules are persisted child records under client companies: deleting a client removes its future pull rules and clears company references without deleting the underlying invoice, revenue-run, or transaction history.

### Stale-Write Protection

Convex state includes revision-aware write protection so an older browser snapshot cannot silently overwrite newer decisions.

### Expense Source Documents

The Expenses workspace separates accounting records from bank movements. Supplier bills can be recorded before payment and become payables; a later outgoing transaction can be matched only when its currency and gross amount agree. Paid card or bank expenses can be recorded directly from the transaction row.

The preferred evidence is always the supplier-issued receipt or invoice, stored privately and linked to the expense record. If the supplier document is unavailable, an operator can generate an internal source-document declaration from the outgoing bank transaction and entered business details. That PDF is visibly marked as not being a supplier receipt or VAT invoice, and the workflow records no deductible input VAT for it.

### Explicit Merit Writes and Delivery

Manual revenue pulls are temporary previews. Preparing a draft re-fetches the selected period server-side and persists the revenue run and editable local invoice together; scheduled jobs continue to maintain accruals and configured automatic drafts. Neither path calls Merit. A confirmed operator action can either save an invoice in Merit or save and deliver it by email. The invoice becomes open immediately after Merit creation, before delivery is attempted, so retrying delivery cannot duplicate the accounting document. `MERIT_WRITES_ENABLED` is the hard deployment gate for both actions.

### Authoritative Merit Reads

Successful read-only Merit syncs import customers and vendors into Companies with their identity, contact, tax, address, currency, payment-term, bank, group, comment, and dimension data. Merit-linked invoices, customers, and vendors that no longer exist in a complete successful Merit response are removed locally. A failed or incomplete endpoint response never triggers deletion, and the sync does not write anything to Merit.

### Local Payment State

Invoices follow the dashboard lifecycle `draft → open → paid`. Merit payment status is read-only metadata and never controls or receives a local paid action. Payment allocations record source, date, amount, reference, and notes; allocations can cover part of an invoice or combine several payments.

### Secret Boundaries

Bank, partner, accounting, and OpenRouter credentials stay in the server/Worker environment. Merit API ID/key and `OPENROUTER_API_KEY` are never stored in Convex or returned to the browser. Calls into Convex require a matching `CONVEX_SERVICE_TOKEN`.

### Whole-Site Authentication

The Cloudflare Worker authenticates every page, API request, and application asset before serving it. Only the non-sensitive favicon, home-screen icons, and web app manifest are public so browsers can identify the app on the login screen. A successful login creates a signed, `HttpOnly`, `Secure`, `SameSite=Strict` cookie that expires after 12 hours. The password is stored only as a salted PBKDF2-SHA-256 verifier, while the username, verifier, and independent session-signing key are encrypted Cloudflare Worker secrets.

Configure or rotate the production credentials from an interactive terminal:

```bash
npm run auth:configure
```

The password prompt is hidden. The setup command sends the derived verifier and generated signing key directly to Cloudflare without printing them or writing them to disk. Missing or malformed authentication secrets lock the site and API closed.

Configure or rotate the additional credential accepted only by `slash.thatcanadian.dev`:

```bash
npm run auth:configure:slash
```

Sessions are signed for the hostname that issued them, so a Slash session cannot be replayed against `finance.thatcanadian.dev`.

Create the transaction-review-only Telegram login from an interactive terminal:

```bash
npm run auth:configure:transaction-reviewer
```

The reviewer signs in with the configured username and the one-time code delivered directly to their Telegram chat. Reviewers receive only the transaction-review bootstrap data and may read bank transactions or override a transaction's category, company, and owner. Every other API route is denied at the Worker boundary. Ask the reviewer to message the Finance Dash bot first; the bot replies with the Telegram chat ID needed by the setup command. Never ask the reviewer to share a sign-in code.

The five-minute bank sync also monitors the aggregate live USD balance of every Slash cash subaccount. A protected Telegram alert is sent to the authorized user named by `SLASH_CASH_ALERT_RECIPIENT` when that total first falls below `SLASH_CASH_ALERT_THRESHOLD_USD`, and one recovery message is sent when it returns to or above the threshold. The default deployment threshold is USD 10,000 and the recipient is Ali M. Credit balances are excluded, failed messages retry on a later healthy Slash sync, and repeated checks in the same balance band do not produce duplicate alerts.

### Regression Coverage

The current test suite covers currency math, empty-state behavior, service-token enforcement, stale writes, atomic invoice reservations, company deletion, secret scrubbing, and API fail-closed behavior.

## Technology

| Layer | Technologies |
| --- | --- |
| Frontend | React, TypeScript, Vite, Tailwind CSS, shadcn/ui |
| Local API | Express 5, TypeScript |
| Cloud API | Cloudflare Workers |
| State | Convex |
| Integrations | Wise, Revolut, Slash, Amex, TUNE/HasOffers, Merit |
| Quality | Node test runner, TypeScript project references |

## Repository Layout

```text
src/                    React dashboard and UI components
server/                 Local API, calculations, matching, persistence, integrations
worker/                 Cloudflare Worker API and scheduled handler
shared/                 Currency, revenue, distribution, category, and provider logic
convex/                 Durable dashboard state and schema
.env.example            Supported runtime configuration
wrangler.jsonc          Worker routes, vars, and scheduled triggers
```

## Local Development

```bash
npm install
cp .env.example .env
npm run dev
```

The frontend runs on `http://localhost:5173` and proxies `/api` requests to the Express server on `http://localhost:8787`.

## Configuration

Use [`.env.example`](.env.example) as the configuration reference. Integration groups include:

- Convex URL/deployment and `CONVEX_SERVICE_TOKEN`;
- Wise API token and selected business profile IDs (their visible balances are discovered automatically);
- Revolut Business client ID, refresh token, and certificate private key (see [`docs/revolut-setup.md`](docs/revolut-setup.md));
- Slash API credentials;
- Amex OAuth, account IDs, and approved API paths;
- Merit invoice creation and email-delivery settings;
- TUNE network and revenue-stream credentials;
- Coinbase exchange-rate endpoint for approximate USD conversion;
- server-only OpenRouter configuration.

Missing credentials should produce unavailable/empty integration states rather than seeded financial numbers.

## Management Report Imports

The Management workspace keeps the legacy workbook in this dashboard while preserving a clear boundary between a closed manual report snapshot and live operating data. The importer reads every workbook tab for source lineage, normalizes the ten current reporting tabs, records data-quality checks, and exposes only sanitized reporting data through the public API. The authoritative `VB - Consolidated` tab drives headline and monthly P&L totals, while unit, platform, ownership, offer, and bank tabs remain available for drill-down. Hidden supporting rows and sensitive transaction references are never returned by `/api/management-report`.

Prepare a local snapshot:

```bash
npm run import:management-report -- "https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit"
```

Upload the same content-addressed snapshot to Convex after configuring `CONVEX_URL` and the server-only `MANAGEMENT_REPORT_IMPORT_TOKEN`:

```bash
npm run import:management-report -- "https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit" --convex
```

A local `.xlsx` path is also accepted. Imports are idempotent by workbook content hash. The Summary view keeps its selected YTD or monthly period, table sorting, and unit filters in the URL. Future bank, advertising, revenue, invoice, and FX APIs should write normalized ledger and metric records behind the same reporting model instead of recreating spreadsheet formulas.

## Wise Statement Imports

Wise balances and transactions are synchronized automatically every five minutes across the configured business profiles. The sync resumes from durable checkpoints, rereads a short overlap window for late provider changes, and deduplicates transactions by their Wise balance-scoped provider reference. CSV import remains available for historical recovery:

- export one statement per currency balance;
- keep Wise's original `statement_<balanceId>_<currency>_...csv` filename so the dashboard can verify the balance against the live Digital Nudge or Love Me Do profile;
- use **All** to auto-route verified files from both entities, or open **DN**/**LMD** to reject files from the other profile before upload;
- upload monthly, weekly, or daily depending on the desired cadence;
- overlapping date ranges are safe because transaction IDs are deduplicated within each Wise entity;
- review unmatched companies/categories and save aliases for future imports.

## Slash Transaction Loading

The Slash view loads the most recent 45 calendar days by default. Use the From and To controls to load an exact inclusive UTC date range, or use **Show 45 earlier days** below the table to extend the current window. Every selected range follows Slash cursor pagination through all available transactions; it is not capped at a fixed row count.

Eligible Slash card purchases retain the API's native cashback amount and rate. The Slash summary separates cashback earned on purchases from cashback credits posted to the account, and each eligible transaction displays its earned amount and effective rate.

## Integration Status

| Integration | Current role |
| --- | --- |
| Wise | Selected multi-business balance and transaction sync with durable checkpoints; CSV statement import for historical recovery |
| Revolut | Read-only Business API adapter with runtime RS256 client assertions; requires certificate authorization |
| Slash | Account/transaction adapter prepared; requires API access |
| Amex | OAuth and account/transaction adapter prepared; requires approved API access |
| TUNE-compatible networks | Partner-level and team-attributed revenue pulls |
| Merit | Authoritative read-only invoice, customer, vendor, and tax sync; explicit save or save-and-email actions guarded by stored tax rules, confirmation, and a deployment switch |
| Coinbase rates | Keyless approximate fiat and crypto USD rates; native balances remain authoritative |

Prepared adapters are not presented as active integrations until the required provider access and credentials exist.

## Verification

```bash
npm run check
```

The gate runs TypeScript validation, regression tests, and the production frontend build.

## Deployment

```bash
CONVEX_SERVICE_TOKEN="$(npx convex env get CONVEX_SERVICE_TOKEN)" npm run deploy
```

This command builds the app, deploys Convex functions using `.env.local`, verifies that the normalized bank ledger has completed its guarded cutover, and only then publishes the Cloudflare Worker. It fails closed before the Worker deployment when the ledger is not ready. The current showcase route is `finance.thatcanadian.dev`.

The first normalized-ledger rollout requires this order: verified Convex backup, `npm run deploy:convex`, `npm run ledger:cutover` with the configured stable connection IDs and any explicit audited legacy dispositions, `npm run ledger:verify`, then `npm run deploy:cloudflare`.

Before moving from showcase to production:

1. point the Worker at the production Convex deployment;
2. configure integration secrets in Cloudflare and Convex rather than local files;
3. validate each live banking/accounting integration with non-destructive tests;
4. establish audit, backup, and incident procedures for financial data.

## External Documentation

- [Wise Platform](https://docs.wise.com/)
- [Revolut Business API](https://developer.revolut.com/docs/business/business-api)
- [Slash API](https://docs.slash.com/)
- [American Express APIs](https://developer.americanexpress.com/)
- [Merit API](https://api.merit.ee/connecting-robots/reference-manual/authentication/)
- [TUNE Affiliate API](https://developers.tune.com/affiliate)
