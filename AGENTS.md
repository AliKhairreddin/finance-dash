# Project Instructions

ALWAYS WORK ON `main` ONLY UNLESS THE USER EXPLICITLY REQUESTS ANOTHER BRANCH. DO NOT CREATE OR SWITCH TO ANOTHER BRANCH WITHOUT THAT EXPLICIT REQUEST.

DO NOT CREATE BACKWARDS COMPATIBILITY OR FALLBACK.

This dashboard is live. Preserve existing financial data and verify migrations before switching deployments.

## Production deployment

- The live site `finance.thatcanadian.dev` MUST use the Convex production deployment `famous-oyster-878` (`https://famous-oyster-878.convex.cloud`).
- `fabulous-elephant-597` is a development deployment. Never point the live Cloudflare Worker at it or use `convex dev` as a production release step.
- Use `npm run deploy` for releases. It explicitly selects production, verifies the production bank ledger, and deploys Cloudflare. Use `npm run verify:production` to check production separately.
- `.env.local` is for local development. Its deployment URL or service token must never choose the release destination or the database verified during a release.
- Before any future database cutover, back up both environments including file storage, stop source writes for the final snapshot, preserve document/file IDs, compare the restored data, and verify the live Worker binding. Do not replace production data with development data during routine releases.

Treat vertical and horizontal interface space as valuable. Do not add persistent explanatory or helper copy when the interface is understandable without it. Put nonessential explanations in an accessible `i` information control with a tooltip or popover, while keeping essential labels, values, validation, errors, and actionable state visible.

Whenever you create or modify a data-bearing table or columnar data list, make each meaningful data column sortable in both ascending and descending order. Use the shared accessible sort-header control, keep the active column and direction visibly indicated, and preserve sort state in the URL. New data columns must ship with their sort behavior; action-only columns are exempt.

When finishing any repo task with file changes, always verify the change, commit the code, push the branch, deploy Convex, and deploy Cloudflare before reporting completion. If a commit, push, or deploy cannot be completed, report the blocker clearly.

When multiple chats are working in this repository, they may coordinate so one
chat owns a combined release for changes produced by several chats. Coordination
does not waive or weaken the deployment requirement:

- A handoff or coordination message is not completion.
- There must always be one explicitly identified active release owner. If no
  other chat has explicitly accepted ownership, the current chat owns the
  release.
- The release owner must include every completed coordinated change, verify the
  combined result, commit it on `main`, push `main`, deploy Convex, and deploy
  Cloudflare.
- A contributing chat must not report its feature as complete while its changes
  are only local, uncommitted, unpushed, or undeployed. It must remain pending
  until the release owner confirms that the feature's commit is on
  `origin/main` and both deployments succeeded.
- If the release owner becomes blocked or stops, another active chat must
  explicitly take ownership and finish the release. Never silently leave
  completed feature changes local or undeployed.
