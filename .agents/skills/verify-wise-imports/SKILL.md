---
name: verify-wise-imports
description: Check Wise CSV import identity, retries, and account labels after changes to statement parsing or the Convex bank ledger.
---

# Verify Wise statement imports

An overlapping export or a repeated submission must leave one posted debit. A refund with the same transfer ID must still post separately. Double-counting either entry changes the displayed balance movement.

## Run the checks

From the repository root, install dependencies with `npm ci`. Run the bounded model against the actual CSV parser, account validator, Convex mutations, and ledger query.

```sh
bash verification/local-convex.sh verification/wise-imports/check.ts banking
```

The launcher starts a loopback Convex backend with a temporary SQLite database. It loads the production schema and banking functions. It uses the pinned local backend release and synthetic data. Linux and macOS are supported.

Run both historical controls with a checkout that includes the repository's Git history.

```sh
bash verification/wise-imports/replay.sh
```

Before fix `115c00b`, importing a debit at 09:00, retrying it, and importing the same debit rendered at 16:00 left two debits. Before fix `13af554`, Convex rejected the entity label on a Wise bank account. The controls run the same checker against both Git revisions. Each control requires its original failure.

## Read the result

The model has two ledger entries, one debit and one refund. It uses a single transfer ID per scenario. The debit has two display times. The expected state is the set of distinct posted entries observed so far. Reading back the amounts and directions also detects a mistakenly merged refund.

The checker exhausts all 27 length-three sequences over those three submissions and checks the ledger after every prefix. Each submission commits in one Convex mutation. A separate scenario issues three writes from independent clients and checks the result after all acknowledge. This covers three concurrent submissions in the order chosen by Convex, in addition to the exhaustive serial orders. It also reads back accounts with and without an entity label before importing.

This bound covers one USD balance, one transfer, both directions, and repeated deliveries through three submissions. It excludes migration of legacy stored rows, writes after changing a transaction's amount, CSVs missing a provider ID, and import-history metadata. The backend's own serializability guarantees are an assumption.

## Maintain coverage

The baseline for the historical code trace is `63e73bae20a1f51cb53e6d960b72601776c71b39`. Recheck these entry points when changing the import.

- `scripts/import-wise-statements.ts` determines the parser, validation, normalization, and ledger write sequence.
- `shared/wiseStatements.ts` implements `parseWiseStatementCsv`, `prepareWiseStatementImport`, `validateWiseStatementImportPayload`, and `normalizeImportedWiseTransactions`.
- `shared/wiseEntities.ts` implements `verifyWiseStatementAccount`. `shared/wiseTransactionIdentity.ts` encodes the balance and the provider ledger identity.
- `convex/banking.ts` implements `upsertActivityBatch`, `getActivityMetadata`, and `getActivityPage`. `convex/schema.ts` stores the account and transaction rows.
- `verification/wise-imports/check.ts` defines the input alphabet, the independent expected ledger state, and the depth bound.

For a failure, replay the printed submissions in order. Inspect the ledger rows, then compare the changed parser and mutation with the coverage record. If the business meaning of a distinct entry changes, update the model and fixtures together. Keep the historical controls failing for their original reasons. Move the baseline forward only after confirming the model describes the new code and rerunning both commands.
