# QuinStreet QMP revenue

The dashboard pulls QuinStreet revenue from a saved QMP publisher report. The Auto/Home lead-delivery APIs are separate and are not used for revenue reporting.

## Required QMP setup

Create one saved QMP performance report for the lines of business. The report must:

- be available through **Download via API** in QMP;
- use **Date-Daily** so arbitrary requested date ranges stay exact;
- include the **Category** attribute;
- include **Total Net Earnings($)** (`total_earn`), Clicks (`clicks`), Gross Leads (`grs_leads`), Payable Leads (`payable_leads`), Click Net Earnings (`click_earn`), and Lead Net Earnings (`lead_earn`);
- return fewer than 15,000 rows for each requested period.

The production report is named **Finance Dash - Auto + Home Revenue**. Its report key is stored only as a Worker secret. The dashboard applies an exact category filter per revenue rule, so Auto and Home do not overlap.

## Local secrets

Add the following to `.env.local` without committing the file:

```dotenv
QUINSTREET_QMP_CLIENT_ID=
QUINSTREET_QMP_CLIENT_SECRET=
QUINSTREET_QMP_REPORT_KEY=
```

The QMP UI calls the first two values **API Key** and **Password**. They are used as HTTP Basic credentials to obtain an OAuth client-credentials token.

## Production secrets

Save the same values as encrypted Cloudflare Worker secrets:

```sh
npx wrangler secret put QUINSTREET_QMP_CLIENT_ID
npx wrangler secret put QUINSTREET_QMP_CLIENT_SECRET
npx wrangler secret put QUINSTREET_QMP_REPORT_KEY
```

Do not add credential values to `wrangler.jsonc` or any tracked source file.

## Dashboard rules

In **Settings → Companies**, open the QuinStreet client and add two revenue rules:

1. **QuinStreet Auto** using source **QuinStreet QMP**, category column `category`, and category value `Auto Insurance`.
2. **QuinStreet Home** using source **QuinStreet QMP**, category column `category`, and category value `Home Insurance`.

For both rules, use:

- the exact publisher name shown in QMP;
- `QUINSTREET_QMP_CLIENT_ID` for the client-ID environment name;
- `QUINSTREET_QMP_CLIENT_SECRET` for the client-secret environment name;
- `QUINSTREET_QMP_REPORT_KEY` for the saved-report environment name;
- `total_earn` for the revenue column;
- a blank API-base-URL environment name to use `https://reporting.qmp.ai`.

The Revenue page can then pull either rule for a selected period. A successful QuinStreet row shows clicks, gross and payable leads, average net earnings per click and payable lead, and separate Lead revenue and Click revenue dollar totals alongside Total revenue. The revenue totals use the report's net earnings columns directly. Both revenue columns support ascending and descending sorting, with the selection saved in the URL. Rates divide aggregate earnings by aggregate units; daily rounded rates are never averaged. Zero-unit rates appear as unavailable. Drafting and sending an invoice remain separate actions.

A locally created QuinStreet client can be used for pull-only reporting with automatic drafting disabled. Import the customer from Merit before enabling automatic drafts or sending an invoice.
