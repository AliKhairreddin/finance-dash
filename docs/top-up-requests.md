# Top-up requests

Public form: https://finance.thatcanadian.dev/top-up (also `/payments`). The dashboard stays authenticated at `/?page=top-ups`. The form preserves the source form's fields and required rules, adds required last-three-days and expected-next-three-days spend in USD, and permits negative open balances. Request amount/balance retain the original currency selector.

Requests, original invoices and processing state are saved in production Convex. Ordinary refreshes read saved data only. Public company search returns only IDs and names for up to 25 matching companies; aliases and legal names participate in matching. New company proposals are added as suppliers when approved. Anonymous submissions cannot directly modify the provider directory. Invoice uploads reuse Documents intake and its existing PDF viewer, extraction, retention and access rules. Request status never creates a bank transaction or marks an accounting invoice paid.

## Telegram

Group ID: `-5336756761`. Add the existing finance bot to this group with permission to send messages; add Amin and Ali M as group members yourself (Telegram bots cannot add arbitrary users). `npm run top-ups:configure` configures callback updates and verifies the bot's group access without posting test messages.

Pending messages mention Amin, with Approve and Adjust amount buttons. Adjustment uses a group reply prompt valid for ten minutes. Only the numeric Telegram ID mapped to Amin can approve/adjust. Approval posts a new message mentioning the ID mapped to Ali M, with a Paid button restricted to that ID. Previous message buttons are cleared and every action checks the current request version. Dashboard administrators can also act, with an audit trail. Alaa's role can read requests but cannot approve, adjust, mark paid or create drafts.

Invoice links in group messages are signed bearer links expiring after 30 days. Group members can view the invoice without dashboard sign-in; avoid sharing those links outside the group. Permanent dashboard file access requires authentication.

Notification delivery is durable, retried up to four times with backoff, with visible failure and manual retry. A lost Telegram response can cause a duplicate message, but version checks prevent duplicate approvals/payments. Interrupted jobs are recovered to a visible state.

## Alaa

Once Alaa's numeric Telegram chat ID is available, have him start the finance bot, then run `npm run auth:configure:top-ups`. The helper writes a dedicated restricted-user secret; it does not alter administrator accounts. Sign-in username: `Alaa`. The server permits only Top-up requests and Documents endpoints for this role. His account is not activated until the ID is supplied.

## Revolut drafts

Bank-transfer requests (including an unspecified payment method) queue draft preparation after approval. Other payment methods are marked Not applicable. Invoice payment details are extracted once and saved. Automatic drafting requires complete, unambiguous invoice details matching the approved amount/currency, an exact saved beneficiary IBAN/currency/name match, and a verified legal-entity funding-account binding. Unknown or ambiguous details stop in Needs review. Administrators can correct extracted details, select an active funding account and confirm the invoice before creating a draft.

The existing Revolut connection was set up with READ permission. Enable `READ,WRITE` with `npm run revolut:setup -- --drafts` and replace the refresh token as described in `docs/revolut-setup.md`. Never grant PAY for this feature. Account IDs for automatic preparation can be set as `TOPUP_REVOLUT_DN_ACCOUNT_ID` / `TOPUP_REVOLUT_LMD_ACCOUNT_ID` only after ownership is verified. Otherwise finance selects the funding account per request.

Only `POST /payment-drafts` is used for writes. Nothing submits a draft, sends money, schedules a payment, or creates a counterparty. Missing recipients must first be added/verified in Revolut. The draft API accepts no invoice attachment; originals and extracted notes remain in the dashboard and the invoice number/payment reference is copied into the draft. Finance reviews and sends the draft in Revolut → Transfers → Draft.

A lost response after draft creation is marked Uncertain and is never automatically retried. Use the dashboard reconciliation control to verify and link a matching Revolut draft ID, or explicitly confirm that no draft exists before retrying. Definitive API rejections, including missing WRITE permission, remain reviewable. No real draft is created as a deployment test.

## Limits and delivery

Public submissions allow 20 attempts per IP per hour; search allows 500. Only hashes of IPs are stored in expiring rate-limit windows; old windows are removed incrementally. Files are limited to 10 MB and checked by content. UUID submission keys deduplicate retries, and immutable original amounts/history preserve adjustments. Requests and documents use existing financial-record retention; rate-limit records expire after one hour. No automatic deletion of financial records is added.

Release through `npm run deploy`, which verifies production famous-oyster-878 and deploys Convex and Cloudflare, then configures/checks Telegram. Do not use the development deployment for the live Worker.
