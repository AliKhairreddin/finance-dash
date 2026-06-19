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

The Worker is configured in `wrangler.jsonc` and persists lightweight dashboard state in Workers KV through the `FINANCE_KV` binding.

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

The Cloudflare Worker uses `CONVEX_URL` to store provider aliases and mock invoices in Convex. Workers KV remains configured as a fallback store.

## What It Does

- Shows cash in accounts, receivables, open balances, payables by supplier/month, profit, investments, total assets, cashback, and weekly growth checks.
- Pulls all the sheet concepts into a compact dashboard instead of manual spreadsheet editing.
- Includes a reconciliation queue for Wise/Slash transactions.
- Suggests provider matches from saved aliases.
- Lets you manually match a transaction to a provider and remembers that bank/card name for future auto-matching.
- Lets you add providers, suppliers, platforms, and customers.
- Lets you create an invoice/record from an unmatched transaction. This calls QuickBooks when credentials are configured; otherwise it creates a local mock draft.
- Persists provider aliases and created invoices in `.local/finance-dashboard-store.json`.

## API Integrations

The server-side integration code is in `server/integrations.ts`.

- Wise: prepared for profiles, balance statements, and transaction activity using `WISE_API_TOKEN`, `WISE_PROFILE_ID`, and `WISE_BALANCE_IDS`.
- Slash: prepared for accounts, transactions, card/account activity, and legal-entity scoped requests using `SLASH_API_KEY` and optional `SLASH_LEGAL_ENTITY_ID`.
- QuickBooks: prepared for OAuth refresh-token or temporary access-token based invoice creation using `QUICKBOOKS_*` variables.
- Merit: left as an optional generic connector because the exact "Merit" product/API is ambiguous.

Copy `.env.example` to `.env` and fill credentials when ready.

## Credentials Needed

```bash
WISE_API_TOKEN=
WISE_PROFILE_ID=
WISE_BALANCE_IDS=

SLASH_API_KEY=
SLASH_LEGAL_ENTITY_ID=

QUICKBOOKS_CLIENT_ID=
QUICKBOOKS_CLIENT_SECRET=
QUICKBOOKS_REFRESH_TOKEN=
QUICKBOOKS_REALM_ID=
QUICKBOOKS_INCOME_ITEM_ID=
QUICKBOOKS_INCOME_ITEM_NAME=
```

Optional:

```bash
MERIT_API_BASE_URL=
MERIT_API_KEY=
```

## References

- Wise Platform docs: https://docs.wise.com/
- Slash API docs: https://docs.slash.com/
- QuickBooks Online Accounting API docs: https://developer.intuit.com/app/developer/qbo/docs/develop
