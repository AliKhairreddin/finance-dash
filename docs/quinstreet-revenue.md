# QuinStreet QMP revenue

The dashboard pulls QuinStreet revenue from a saved QMP publisher report. The Auto/Home lead-delivery APIs are separate and are not used for revenue reporting.

## Required QMP setup

Create one saved QMP report for each line of business. Each report must:

- be available through **Download via API** in QMP;
- include the date dimension used by QMP's `startDate` and `endDate` filters;
- include a numeric revenue column (the dashboard defaults to `total_commission`);
- return fewer than 15,000 rows for each requested period.

Use separate report keys for Auto and Home so the revenue rules do not overlap.

## Local secrets

Add the following to `.env.local` without committing the file:

```dotenv
QUINSTREET_QMP_CLIENT_ID=
QUINSTREET_QMP_CLIENT_SECRET=
QUINSTREET_QMP_AUTO_REPORT_KEY=
QUINSTREET_QMP_HOME_REPORT_KEY=
```

The QMP UI calls the first two values **API Key** and **Password**. They are used as HTTP Basic credentials to obtain an OAuth client-credentials token.

## Production secrets

Save the same values as encrypted Cloudflare Worker secrets:

```sh
npx wrangler secret put QUINSTREET_QMP_CLIENT_ID
npx wrangler secret put QUINSTREET_QMP_CLIENT_SECRET
npx wrangler secret put QUINSTREET_QMP_AUTO_REPORT_KEY
npx wrangler secret put QUINSTREET_QMP_HOME_REPORT_KEY
```

Do not add credential values to `wrangler.jsonc` or any tracked source file.

## Dashboard rules

In **Settings → Companies**, open the QuinStreet client and add two revenue rules:

1. **QuinStreet Auto** using source **QuinStreet QMP** and report-key environment name `QUINSTREET_QMP_AUTO_REPORT_KEY`.
2. **QuinStreet Home** using source **QuinStreet QMP** and report-key environment name `QUINSTREET_QMP_HOME_REPORT_KEY`.

For both rules, use:

- the exact publisher name shown in QMP;
- `QUINSTREET_QMP_CLIENT_ID` for the client-ID environment name;
- `QUINSTREET_QMP_CLIENT_SECRET` for the client-secret environment name;
- the exact saved-report revenue column, normally `total_commission`;
- a blank API-base-URL environment name to use `https://reporting.qmp.ai`.

The Revenue page can then pull either rule for a selected period. A successful QuinStreet row shows the number of report rows used in the calculation. Drafting and sending an invoice remain separate actions.
