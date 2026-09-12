# Wise transaction feeds through Zoho Books

Digital Nudge uses EU organization `20119414037`; LOVEMEDO uses `20119414066`
under the same Zoho login. Both are connected to Wise through Token. The explicit
14-account mapping lives in `shared/zohoWise.ts`; never match accounts by currency
alone, since both businesses have additional balances/jars.

Cloudflare secrets: `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`.
The EU OAuth grant has read-only banking/settings access. Refresh access tokens
in memory through `accounts.zoho.eu`; API calls use `www.zohoapis.eu/books/v3`.
Never put these values in dashboard state, frontend environment variables, logs,
or the repository. Trial API access was tested for both organizations before payment.

## Import and identity

The five-minute Worker job still refreshes balances directly from Wise. Once
every 24 hours (or a requested transaction-range sync), it reads Zoho's raw
`/bankaccounts/{id}/statements` pages for both organizations. The categorized
`/bankaccounts/{id}/transactions` endpoint does not return the unreviewed feeds.
The sync validates all pages/accounts before writing any transactions. Bank
consent errors, unmapped accounts, invalid rows and feeds older than 72 hours fail
the sync visibly. Coverage ends before the earliest bank-feed refresh date;
transactions already available on the refresh day are still imported.

All source history is reread to catch late arrivals/corrections, but normal
ledger writes start **2026-09-04**. CSV imports on September 4 covered through
September 3. Exact IDs are `wiseTransactionId(balanceId, zoho:organization:statement)`;
retries update the same row and retain existing manual classifications, company,
invoice and team assignments through the shared Convex ingestion path. CSV
imports overlapping the automatic period are rejected.

Two audited exceptions are explicit, never inferred from amount alone:

- DN's August CSV was imported August 31 at 04:35 UTC. Six later August 31 USD
  feed rows were missing: two USD 50,000 payments plus USD 1.13 fees, a USD
  2,347.97 receipt, and a USD 50,000 transfer to LMD. Existing CSV IDs and adjacent
  days were checked; LMD already contains the receiving side of the latter.
  The exact six statement IDs are included as a repair, net **-147,654.29 USD**.
- LMD Wise `TRANSFER-2350596140` is already a September 3 CSV receipt of
  **91,297.61 EUR**. Zoho dates its **91,300 EUR** receipt and **2.39 EUR** fee
  September 4. Both Zoho statement IDs are excluded, leaving the CSV row intact.

## Source differences

Zoho statement debit means deposit; credit means withdrawal. Amounts are used
unchanged. Wise fee rows remain separate expenses; a fee mentioned in the parent
description must not be added again. Dates, currencies, descriptions, payees and
available references are preserved. Card merchants can be extracted from the
description. Cardholder/last-four fields are absent, and some references are
masked upstream; those details cannot be restored from this feed and are not
invented. System-deleted/excluded rows become voided. Zoho's statement running
balance and accounting balance are not used for bank balances.

## Verification and operation

Focused adapter tests cover fee conservation, directions, identity, complete
pagination, cutover exclusions, the historical repair, stale feeds, mapping
failures and secret-safe errors. Worker tests cover daily transaction throttling,
five-minute balances and no transaction/coverage write on a partial fetch.

The initial audited batch has **90 rows**: DN 56 after cutover plus 6 repaired
rows; LMD 28 after excluding the already-imported receipt and fee. A live replay
must insert zero rows. Reconcile counts and signed totals by entity/currency,
and verify every pre-existing CSV row remains unchanged before declaring success.

Zoho and bank-feed access need to remain enabled after the trial. No subscription
was purchased during setup. Token's consent screen displayed December 10, 2026;
renew through Zoho when requested. An OAuth refresh token does not renew bank
consent. New Wise balances require connecting them in Zoho and updating the
explicit mapping before automatic transaction sync can complete.
