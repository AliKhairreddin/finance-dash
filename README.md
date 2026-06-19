# Finance Dash

Operational dashboard for cash flow, open balances, receivables, payables, provider matching, and invoice creation.

The first version is seeded from the June 15, 2026 Google Sheet screenshot and runs with mock/API-ready data until real credentials are configured.

## Run

```bash
npm install
npm run dev
```

The frontend runs on `http://localhost:5173` and proxies API calls to the Express server on `http://localhost:8787`.

## Deploy

The production deployment runs on Cloudflare Workers with static assets and a Worker API.

```bash
npm run deploy
```

Production URL:

```text
https://finance.thatcanadian.dev
```

The Worker is configured in `wrangler.jsonc`. It uses Convex for provider aliases, revenue runs, and local invoice decisions, with Workers KV still configured as a fallback store.

## Convex Backend

Convex is configured as the durable dashboard state backend.

```text
Cloud URL: https://fabulous-elephant-597.convex.cloud
HTTP Actions URL: https://fabulous-elephant-597.convex.site
```

Push Convex schema/functions to the shared development deployment:

```bash
npm run convex:dev
```

The Cloudflare Worker uses `CONVEX_URL` to store provider aliases, revenue runs, and mock invoices in Convex. Workers KV remains configured as a fallback store.

## What It Does

- Shows cash in accounts, receivables, open balances, payables by supplier/month, profit, investments, total assets, cashback, and weekly growth checks.
- Pulls all the sheet concepts into a compact dashboard instead of manual spreadsheet editing.
- Includes separate Wise and Slash operating views.
- Splits Wise transactions into incoming and outgoing reconciliation tabs.
- Adds a sidebar with a separate Revenue page for partner API pulls.
- Seeds Kissterra as a TUNE/HasOffers revenue partner.
- Pulls last-week revenue using a Monday-to-Sunday period in the selected timezone, plus last-7-days, this-month, and custom filters.
- Sends TUNE `hour_offset` from the selected timezone against the partner network timezone.
- Runs a Cloudflare cron every Monday to pull the previous week and create a Merit invoice for positive live revenue.
- Supports optional Wise transaction team assignment with seeded `Cognitive Pixel` and `WGNR` teams, plus team filters and visible-team totals.
- Keeps Slash balances, card activity, and cashback tracking on its own page.
- Suggests provider matches from saved aliases.
- Lets you manually match a transaction to a provider and remembers that bank/card name for future auto-matching.
- Lets you add providers, suppliers, platforms, and customers.
- Pulls Merit invoices when Merit credentials are configured.
- Lets you create a Merit invoice from an unmatched Wise transaction. If Merit credentials are missing, the dashboard creates a local mock draft so the workflow can still be tested.
- Lets you approve or deny invoice matches inside the dashboard.
- Lets you mark an invoice paid locally in the finance dashboard without marking it paid in Merit. Merit payment status stays independent for the accountant.
- Persists provider aliases, revenue runs, and created invoices in `.local/finance-dashboard-store.json`.

## API Integrations

The server-side integration code is in `server/integrations.ts`.

- Wise: prepared for profiles, balance statements, and transaction activity using `WISE_API_TOKEN`, `WISE_PROFILE_ID`, and `WISE_BALANCE_IDS`.
- Slash: prepared for accounts, transactions, card/account activity, and legal-entity scoped requests using `SLASH_API_KEY` and optional `SLASH_LEGAL_ENTITY_ID`.
- Partner revenue: prepared for Kissterra through the TUNE Affiliate API using `KISSTERRA_TUNE_NETWORK_ID`, `KISSTERRA_TUNE_API_KEY`, and optional `KISSTERRA_TUNE_API_BASE_URL`.
- Merit: prepared to list sales invoices and create sales invoices using `MERIT_API_ID`, `MERIT_API_KEY`, and default tax/item settings. The dashboard intentionally does not send Merit payment updates.

Copy `.env.example` to `.env` and fill credentials when ready.

## Credentials Needed

```bash
WISE_API_TOKEN=
WISE_PROFILE_ID=
WISE_ENVIRONMENT=production
WISE_BALANCE_IDS=

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
```

## References

- Wise Platform docs: https://docs.wise.com/
- Slash API docs: https://docs.slash.com/
- Merit API authentication: https://api.merit.ee/connecting-robots/reference-manual/authentication/
- Merit sales invoice creation: https://api.merit.ee/connecting-robots/reference-manual/sales-invoices/create-sales-invoice/
- Merit sales invoice list: https://apidoc.passelimerit.fi/parts/sales-invoices/get-list-of-invoices/
- TUNE Affiliate API: https://developers.tune.com/affiliate
- TUNE Affiliate_Report getStats: https://developers.tune.com/affiliate/affiliate_report-getstats/
