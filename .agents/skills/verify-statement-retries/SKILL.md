---
name: verify-statement-retries
description: Check Statements OCR rate limits and expired processing attempts after changing the Worker, Convex callbacks, leases, or document retry scheduling.
---

# Verify Statements document retries

A rate-limited document stays queued until the provider permits a retry. A late failure from an earlier attempt must leave that retry available. Losing the retry leaves a saved original waiting for manual intervention. An early retry calls the OCR provider while the limit still applies.

## Run

Install the locked dependencies with `npm ci`. Run both commands from the repository root.

```sh
bash verification/local-convex.sh verification/statement-retries/check.ts --fixture statements statementProcessing
bash verification/statement-retries/replay.sh
```

The first command starts a disposable Convex backend, stores a synthetic file, and calls the real document-processing Worker. The test browser binding returns a 429 response with a two-hour delay. The check reads the original claim token, the database hold, and the scheduled retry time.

The second command runs the same checker against two archived code revisions. Before `45b1fb3`, the OCR worker shortened two hours to one. At `63e73ba`, an old callback marked a queued document failed after its hold elapsed and before its next claim. The replay passes only when each revision fails its expected assertion.

## Scope

The bounded model checks all six orders of a delayed watchdog failure, a worker claim, and a failure from the prior worker. It checks each intermediate database state before and after the deadline, then checks a stale completion. The checker rejects an old watchdog after the replacement lease expires. A failure from the current watchdog marks that expired claim failed. A separate case verifies that a transport failure for the current eligible retry also marks it failed.

The database commits one mutation at a time. The fixture moves the persisted deadline into the past to model time advancing. The test also checks the timestamp and arguments of the real scheduled retry. The model covers one document, two attempts and one provider deadline. It uses local file storage and a failed transport. It does not exercise wall-clock delivery, a live OCR browser, user sign-in, or contention across documents.

## Maintain the check

Review `worker/statements.ts` and `worker/statementOcr.ts` when changing the handoff from an upstream failure to a recorded attempt. Review `shared/statementProcessing.ts`, `convex/statementProcessing.ts` and the claim, fail, complete, retry and callback mutations in `convex/statements.ts` when changing scheduling.

The first verified revision is the commit that introduced this skill. Resolve it with `git log --diff-filter=A -1 --format=%H -- .agents/skills/verify-statement-retries/SKILL.md`. When the code changes, compare its mutation boundaries with the events in `verification/statement-retries/check.ts`. If a database assertion fails, inspect the stored token, deadline and pending job before changing the expectation. Record a newer verified revision here only after both commands pass.
