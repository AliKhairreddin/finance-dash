# Automatic merchant research

Merchant research uses the existing Cloudflare `OPENROUTER_API_KEY` and the OpenRouter model saved in dashboard Settings. The Worker calls OpenRouter's `openrouter:web_search` server tool with the Exa engine explicitly selected. Search is charged to the existing OpenRouter account. No Brave or separate Exa key is required, and there is no alternate-provider fallback.

## Production configuration

- Cloudflare Worker: existing `OPENROUTER_API_KEY`, `CONVEX_SERVICE_TOKEN`, and production `CONVEX_URL`.
- Convex: matching `CONVEX_SERVICE_TOKEN`, `STATEMENT_PROCESSOR_URL=https://statements.thatcanadian.dev/api/statements/process`, and `STATEMENT_PRODUCTION_PROCESSING=approved`.
- Saved dashboard AI settings: provider `openrouter` and an available model. Research uses this saved model rather than a second model environment variable.

The API key stays in the Worker. Convex calls a service-authenticated endpoint with only a merchant job ID and its current lease token. The Worker checks that lease against Convex and loads the merchant name and saved model itself. Only the merchant name is sent upstream; transaction amounts, cards, company ownership, account details, and financial documents are not sent for research.

The inference request requires ZDR and denies data collection. Search has its own provider retention policy; the inference ZDR flag does not promise zero retention for search. See [OpenRouter search documentation](https://openrouter.ai/docs/guides/features/server-tools/web-search) and [retention scope](https://openrouter.ai/blog/insights/zero-data-retention/).

## Queue and evidence

Imports and manual entry enqueue merchants. The existing Convex cron processes up to three profiles each minute. A request permits one search with at most five results, bounded response size and timeouts. Claims prevent concurrent processing. Retries honor rate limits and stop after five attempts. Saved suggestions refresh after 30 days; page loads read saved data.

Profile source URLs must match search-service citation metadata, independently of URLs the model writes in its JSON. Missing citations, unfinished output, invalid JSON, and unsupported facts are not promoted to approved data. Conflicts and uncertainty remain visible for review. User-approved details remain unchanged when research refreshes.

## Activation and verification

`POST /api/internal/statements/verify-research` with the existing service authorization researches the fixed public name `Cloudflare Inc.`. It performs no database writes and returns sourced suggestions. It cannot accept a custom prompt or financial data. Do not expose the service token in command-line arguments, output, or committed files.

To enqueue existing transactions after a successful integration check, use the bounded internal `statementIntelligence:enqueueExisting` mutation with `{paginationOpts:{cursor:null,numItems:100},dryRun:true}`, inspect the result, then use `dryRun:false` and follow the cursor. This adds merchant research profiles only; it does not edit transactions, invoices, documents, card mappings or permissions. Existing profiles and approved aliases are reused; trashed transactions are skipped. Observe the cron processing the queue without manually invoking the pump to verify automatic scheduling.

If a provider rejects the existing credential, lacks credit, or rejects the selected model/search policy, the saved profile records the error. Correct the configuration and use the existing research action to retry blocked profiles. Never bypass source validation to make a failed request look successful.
