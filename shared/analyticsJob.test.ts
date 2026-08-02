import assert from "node:assert/strict";
import test from "node:test";
import {
  assertBankAnalyticsSnapshotSize,
  bankAnalyticsJobPageBudget,
  bankAnalyticsSnapshotByteLimit,
  buildBankAnalyticsPageBudget,
  createBankAnalyticsJobIdentity
} from "./analyticsJob";
import type { Transaction } from "./types";

const directory = {
  fromDate: "2026-07-01",
  toDate: "2026-07-31",
  providers: [
    { id: "supplier-1", name: "Supplier One", type: "supplier" as const },
    { id: "client-1", name: "Client One", type: "client" as const }
  ],
  teams: [
    { id: "ops", name: "Operations" },
    { id: "growth", name: "Growth" }
  ]
};

function transaction(id: string): Transaction {
  return {
    id,
    source: "wise",
    accountName: "Operating",
    date: "2026-07-15",
    description: "Recurring subscription",
    rawName: "Recurring subscription",
    counterparty: "Recurring supplier",
    merchantName: "Recurring supplier",
    merchantKey: "recurring-supplier",
    amount: 10,
    currency: "USD",
    direction: "out",
    status: "posted",
    category: "Software"
  };
}

test("Analytics job identity includes only requested month revisions and the stable directory fingerprint", () => {
  const revisions = [{ month: "2026-07", revision: 17 }];
  const identity = createBankAnalyticsJobIdentity(revisions, directory);
  const reordered = createBankAnalyticsJobIdentity(revisions, {
    ...directory,
    providers: [...directory.providers].reverse(),
    teams: [...directory.teams].reverse()
  });
  const changedRevision = createBankAnalyticsJobIdentity([{ month: "2026-07", revision: 18 }], directory);
  const changedDirectory = createBankAnalyticsJobIdentity(revisions, {
    ...directory,
    teams: [{ id: "ops", name: "Finance Operations" }, directory.teams[1]!]
  });

  assert.equal(identity.version, reordered.version);
  assert.notEqual(identity.version, changedRevision.version);
  assert.notEqual(identity.version, changedDirectory.version);
  assert.match(identity.version, /^bank-analytics-v2:2026-07:17:fnv1a32-[a-f0-9]{8}$/);
  assert.throws(
    () => createBankAnalyticsJobIdentity([{ month: "2026-07", revision: -1 }], directory),
    /non-negative integer/
  );
  assert.throws(
    () => createBankAnalyticsJobIdentity([{ month: "2026-06", revision: 17 }], directory),
    /do not match the requested period/
  );
});

test("Analytics build processes at most ten pages and resumes from its opaque cursor", async () => {
  const identity = createBankAnalyticsJobIdentity([{ month: "2026-07", revision: 1 }], directory);
  const requestedCursors: Array<string | null> = [];
  const first = await buildBankAnalyticsPageBudget({
    ...directory,
    state: identity.initialState,
    cursor: null,
    async readPage(cursor) {
      requestedCursors.push(cursor);
      const pageNumber = requestedCursors.length;
      return {
        transactions: [transaction(`transaction-${pageNumber}`)],
        continueCursor: `cursor-${pageNumber}`,
        isDone: false
      };
    }
  });

  assert.equal(first.status, "building");
  assert.equal(first.pagesProcessed, bankAnalyticsJobPageBudget);
  assert.equal(requestedCursors.length, bankAnalyticsJobPageBudget);
  assert.deepEqual(requestedCursors, [
    null,
    "cursor-1",
    "cursor-2",
    "cursor-3",
    "cursor-4",
    "cursor-5",
    "cursor-6",
    "cursor-7",
    "cursor-8",
    "cursor-9"
  ]);
  if (first.status !== "building") return;
  assert.equal(first.cursor, "cursor-10");
  assert.equal(first.accumulator.transactionCount, 10);

  const resumedCursors: Array<string | null> = [];
  const resumed = await buildBankAnalyticsPageBudget({
    ...directory,
    state: first.accumulator,
    cursor: first.cursor,
    async readPage(cursor) {
      resumedCursors.push(cursor);
      return {
        transactions: [transaction("transaction-11")],
        continueCursor: null,
        isDone: true
      };
    }
  });

  assert.equal(resumed.status, "complete");
  assert.deepEqual(resumedCursors, ["cursor-10"]);
  if (resumed.status !== "complete") return;
  assert.equal(resumed.pagesProcessed, 1);
  assert.equal(resumed.snapshot.summary.transactionCount, 11);
  assert.deepEqual(resumed.snapshot.summary.moneyOut, { USD: 110 });
});

test("Analytics build rejects a non-terminal page that cannot advance", async () => {
  const identity = createBankAnalyticsJobIdentity([{ month: "2026-07", revision: 1 }], directory);
  await assert.rejects(
    buildBankAnalyticsPageBudget({
      ...directory,
      state: identity.initialState,
      cursor: null,
      async readPage() {
        return { transactions: [], continueCursor: null, isDone: false };
      }
    }),
    /must include a continuation cursor/
  );
});

test("Analytics build rejects a repeated opaque cursor", async () => {
  const identity = createBankAnalyticsJobIdentity([{ month: "2026-07", revision: 1 }], directory);
  await assert.rejects(
    buildBankAnalyticsPageBudget({
      ...directory,
      state: identity.initialState,
      cursor: "cursor-current",
      async readPage() {
        return { transactions: [], continueCursor: "cursor-current", isDone: false };
      }
    }),
    /repeated cursor/
  );
});

test("Analytics snapshots have a hard serialized byte ceiling before persistence", () => {
  assert.doesNotThrow(() => assertBankAnalyticsSnapshotSize({ version: 1, summary: {} }));
  assert.throws(
    () => assertBankAnalyticsSnapshotSize({ payload: "x".repeat(bankAnalyticsSnapshotByteLimit) }),
    /exceeds 250000 bytes/
  );
});
