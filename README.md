# Finance Dash

Operational dashboard for cash flow, open balances, receivables, payables, provider matching, and invoice creation.

The dashboard shows live integration data and saved user-managed records only. Missing integrations render empty sections instead of invented balances.

## Run

```bash
npm install
npm run dev
```

The frontend runs on `http://localhost:5173` and proxies API calls to the Express server on `http://localhost:8787`.

## Deploy

The current showcase deployment runs on Cloudflare Workers with static assets and a Worker API.

```bash
npm run deploy
```

Showcase URL:

```text
https://finance.thatcanadian.dev
```

The Worker is configured in `wrangler.jsonc`. While the dashboard is still in development/showcase mode, it points at the shared development Convex deployment so uploaded Wise statement rows, provider aliases, revenue runs, and local invoice decisions are visible after refreshes. Switch `CONVEX_URL` to the production Convex deployment only when the app is ready for full production data.

## Convex Backend

Convex is configured as the durable dashboard state backend.

```text
Development Cloud URL: https://fabulous-elephant-597.convex.cloud
Development HTTP Actions URL: https://fabulous-elephant-597.convex.site
Production Cloud URL: https://famous-oyster-878.convex.cloud
```

Push Convex schema/functions to the shared development deployment:

```bash
npm run convex:dev
```

The Cloudflare Worker currently uses the development `CONVEX_URL` in `wrangler.jsonc`. The production Convex deployment is `https://famous-oyster-878.convex.cloud`, but it should stay unused until the dashboard is ready for production data.

## What It Does

- Shows cash in accounts, receivables, open balances, payables, profit, and total assets when live or saved data exists.
- Keeps the overview focused on the six summary cards.
- Includes separate Wise, Revolut, and Slash operating views.
- Splits Wise transactions into incoming and outgoing reconciliation tabs.
- Imports manually downloaded Wise statement CSVs in the Wise tab and stores rows for reconciliation.
- Adds a sidebar with a separate Revenue page for partner API pulls.
- Treats each TUNE/HasOffers revenue stream as an earning team plus paying partner, so Cognitive Pixel and Wagner can both earn from Kissterra or Lead Economy without mixing the chart/filter logic.
- Lets saved TUNE/HasOffers revenue streams store the affiliate ID used by the network.
- Pulls last-week revenue using a Monday-to-Sunday period in the selected timezone, plus last-7-days, this-month, and custom filters.
- Sends TUNE `hour_offset` from the selected timezone against the partner network timezone.
- Runs a Cloudflare cron every Monday to pull the previous week and create a Merit invoice for positive live revenue.
- Supports optional Wise transaction team assignment with saved teams, plus team filters and visible-team totals.
- Keeps money-in categories separate from money-out categories. Spend charts use cost buckets, while revenue charts split incoming money by earning team and partner when those matches exist.
- Keeps Slash balances, card activity, and cashback tracking on its own page.
- Suggests company matches from saved aliases.
- Lets you manually confirm a transaction company and remembers that bank/card name for future auto-matching.
- Lets you categorize transactions from the Wise table and remembers category aliases for future auto-categorization.
- Lets you add companies, suppliers, platforms, customers, and invoice-ready company details.
- Pulls Merit invoices when Merit credentials are configured.
- Lets you create local sales invoice drafts for money-in Wise transactions and local supplier bill drafts for money-out Wise transactions.
- Lets you approve or deny invoice matches inside the dashboard.
- Lets you mark an invoice paid locally in the finance dashboard without marking it paid in Merit. Merit payment status stays independent for the accountant.
- Persists provider aliases, revenue partners, revenue runs, AI settings, created invoices, and uploaded Wise statement rows in Convex on the deployed Worker; local Express development persists the same dashboard state in `.local/finance-dashboard-store.json`.

## API Integrations

The server-side integration code is in `server/integrations.ts`.

- Wise: pulls live balances with `WISE_API_TOKEN`, `WISE_PROFILE_ID`, and `WISE_BALANCE_IDS`; transaction rows can be imported from Wise statement CSVs when live balance statements are blocked by Wise.
- Revolut: prepared for Business API accounts and transaction activity using `REVOLUT_REFRESH_TOKEN`, `REVOLUT_CLIENT_ASSERTION_JWT`, and `REVOLUT_ENVIRONMENT`.
- Slash: prepared for accounts, transactions, card/account activity, and legal-entity scoped requests using `SLASH_API_KEY` and optional `SLASH_LEGAL_ENTITY_ID`.
- Partner revenue: prepared for team-attributed TUNE Affiliate API streams. The default enabled stream is Cognitive Pixel / Kissterra using `KISSTERRA_TUNE_NETWORK_ID`, `KISSTERRA_TUNE_API_KEY`, and optional `KISSTERRA_TUNE_API_BASE_URL`. Additional disabled stream templates exist for Wagner / Kissterra, Cognitive Pixel / Lead Economy, and Wagner / Lead Economy.
- Merit: prepared to list sales invoices and create sales invoices using `MERIT_API_ID`, `MERIT_API_KEY`, and default tax/item settings. The dashboard intentionally does not send Merit payment updates.

Copy `.env.example` to `.env` and fill credentials when ready.

## Wise Statement Imports

Wise confirmed that live balance statement retrieval is not supported for the current Netherlands Wise Business profile. Use Wise statement CSVs instead:

- Preferred cadence: upload one monthly statement CSV per currency balance after month end.
- Faster cadence: upload custom weekly or daily statement CSVs when reconciliation needs to be fresher than month end.
- Overlapping periods are safe because rows are deduplicated by Wise transaction id.
- Upload the CSVs from the Wise page in the dashboard with the **CSV** button.

## Credentials Needed

```bash
WISE_API_TOKEN=
WISE_PROFILE_ID=
WISE_ENVIRONMENT=production
WISE_BALANCE_IDS=

REVOLUT_ENVIRONMENT=production
REVOLUT_REFRESH_TOKEN=
REVOLUT_CLIENT_ASSERTION_JWT=

SLASH_API_KEY=
SLASH_LEGAL_ENTITY_ID=
SLASH_BASE_URL=https://api.slash.com

MERIT_API_BASE_URL=https://aktiva.merit.ee/api
MERIT_GET_INVOICES_PATH=/v1/getinvoices
MERIT_CREATE_INVOICE_PATH=/v2/sendinvoice
MERIT_API_ID=
MERIT_API_KEY=
MERIT_DEFAULT_TAX_ID=
MERIT_DEFAULT_ITEM_CODE=SERVICES
MERIT_DEFAULT_COUNTRY_CODE=CA

REVENUE_TIMEZONE=UTC
KISSTERRA_TUNE_NETWORK_ID=
KISSTERRA_TUNE_API_KEY=
KISSTERRA_TUNE_API_BASE_URL=

KISSTERRA_WAGNER_TUNE_NETWORK_ID=
KISSTERRA_WAGNER_TUNE_API_KEY=
KISSTERRA_WAGNER_TUNE_API_BASE_URL=

LEAD_ECONOMY_COGNITIVE_TUNE_NETWORK_ID=
LEAD_ECONOMY_COGNITIVE_TUNE_API_KEY=
LEAD_ECONOMY_COGNITIVE_TUNE_API_BASE_URL=

LEAD_ECONOMY_WAGNER_TUNE_NETWORK_ID=
LEAD_ECONOMY_WAGNER_TUNE_API_KEY=
LEAD_ECONOMY_WAGNER_TUNE_API_BASE_URL=
```

## References

- Wise Platform docs: https://docs.wise.com/
- Revolut Business API docs: https://developer.revolut.com/docs/business/business-api
- Revolut Business API accounts: https://developer.revolut.com/docs/business/get-accounts
- Revolut Business API transactions: https://developer.revolut.com/docs/business/get-transactions
- Slash API docs: https://docs.slash.com/
- Merit API authentication: https://api.merit.ee/connecting-robots/reference-manual/authentication/
- Merit sales invoice creation: https://api.merit.ee/connecting-robots/reference-manual/sales-invoices/create-sales-invoice/
- Merit sales invoice list: https://apidoc.passelimerit.fi/parts/sales-invoices/get-list-of-invoices/
- TUNE Affiliate API: https://developers.tune.com/affiliate
- TUNE Affiliate_Report getStats: https://developers.tune.com/affiliate/affiliate_report-getstats/
