# Wise historical reconciliation — September 11, 2026

The displayed coverage ranges tracked successful API syncs, not whether CSV
transactions existed. They did not establish missing transactions. The UI no
longer warns merely because those API ranges do not cover the selected period.
Actual integration and request failures remain visible.

## Sources and scope

- Read the live Wise ledger: 2,066 stored rows, spanning January 1–September 11.
- Compared the complete paginated Zoho responses for all 14 mapped Wise accounts,
  captured earlier on September 11 Eastern Time during the Zoho connection audit.
  These contained 1,030 statement rows; the earliest was June 15.
- Checked all non-excluded payments dated before September 4, with separate
  verification of their associated fee rows.
- This is a reconciliation against that API snapshot, not a claim that Zoho
  exposes all history before June 15 or that no later adjustments can occur.

## Method and result

Matched account/entity, currency, signed amount, description, provider references
where available, and adjacent posting dates. Compared CSV net amounts with Zoho's
separate payment and fee components. Masked references retained their visible
suffix checks. A one-to-one assignment prevented reusing a single CSV movement
to cover multiple API payments.

Card authorizations and partial refunds sharing the exact CSV card identifier
were reconciled together. For example, one EUR 12.12 payment was already recorded
as EUR 20 out and EUR 7.88 back in. Importing its API row would duplicate the
expense. The previously documented September 3 CSV receipt that Zoho posts on
September 4 was also accounted for.

- 672 historical payments checked.
- 264 associated fee rows checked.
- No unmatched payments in the available pre–September 4 API history.
- All 35 September 1–3 CSV rows represented, including the posting-date boundary.
- No new rows imported and no existing rows modified during this reconciliation.

## Separate existing duplicate finding

The ledger contains 259 exact pairs of an old CSV migration identifier and a
newer scoped CSV identifier with the same provider reference, entity, currency,
direction, amount, date and description. These pairs existed before this audit.
They were treated as one movement for source reconciliation only. Their live
records remain unchanged; merging them and preserving all categorization and
document/owner links is a separate correction to historical totals.

## Sync timing

The dashboard's automatic transaction sync has a 24-hour interval. It fetches
all available statement pages and imports eligible entries, including entries
dated today. Its full-day coverage marker stops before the feed refresh date;
that marker is not a cutoff on which transaction dates are imported. Balances
refresh separately from this transaction cadence.
