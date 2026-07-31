import assert from "node:assert/strict";
import test from "node:test";
import { ConvexError } from "convex/values";
import type { AutomationRun, Invoice, RevenueRun, Transaction } from "../shared/types";
import {
  disposeOrphanedLegacyTeamAssignments,
  finalizeInvoiceCreation,
  getWiseResetPreview,
  getState,
  migrateLegacyLedgerBatch,
  resetWiseImports,
  reserveIncomeAutomation,
  reserveInvoiceCreation,
  saveState
} from "../convex/dashboard";

type AsyncHandler<TArgs, TResult> = (ctx: unknown, args: TArgs) => Promise<TResult>;

function handlerOf<TArgs, TResult>(registered: object): AsyncHandler<TArgs, TResult> {
  const candidate: unknown = Reflect.get(registered, "_handler");
  if (typeof candidate !== "function") throw new Error("Convex handler is not registered");
  return async (ctx, args) => candidate(ctx, args);
}

const getStateHandler = handlerOf<{ serviceToken: string }, null>(getState);
const saveStateHandler = handlerOf<
  Record<string, unknown> & { serviceToken: string; expectedUpdatedAt: string | null },
  { updatedAt: string }
>(saveState);
const reserveIncomeAutomationHandler = handlerOf<
  { serviceToken: string; run: AutomationRun; staleBefore: string },
  { reserved: boolean; updatedAt: string }
>(reserveIncomeAutomation);
const reserveInvoiceCreationHandler = handlerOf<
  { serviceToken: string; invoiceId: string; reservedAt: string },
  { reserved: boolean; updatedAt: string }
>(reserveInvoiceCreation);
const finalizeInvoiceCreationHandler = handlerOf<
  { serviceToken: string; invoice: Invoice },
  { updatedAt: string }
>(finalizeInvoiceCreation);
const getWiseResetPreviewHandler = handlerOf<
  { serviceToken: string },
  { transactions: number; imports: number }
>(getWiseResetPreview);
const resetWiseImportsHandler = handlerOf<
  { serviceToken: string },
  { deletedTransactions: number; deletedImports: number; updatedAt: string }
>(resetWiseImports);
const migrateLegacyLedgerBatchHandler = handlerOf<
  { serviceToken: string; limit?: number },
  {
    processedTransactions: number;
    insertedTransactions: number;
    updatedTransactions: number;
    appliedTeamAssignments: number;
    orphanedTeamAssignments: number;
    remainingTransactions: number;
    remainingTeamAssignments: number;
    isDone: boolean;
    updatedAt: string;
  }
>(migrateLegacyLedgerBatch);
const disposeOrphanedLegacyTeamAssignmentsHandler = handlerOf<
  {
    serviceToken: string;
    disposition: "discard-orphaned-team-assignment";
    limit?: number;
  },
  { disposed: number; remainingAssignments: number; updatedAt: string | null }
>(disposeOrphanedLegacyTeamAssignments);
function convexErrorCode(error: unknown): string | undefined {
  return error instanceof ConvexError && typeof error.data === "object" && error.data !== null && "code" in error.data
    ? String(error.data.code)
    : undefined;
}

async function withServiceToken(run: () => Promise<void>): Promise<void> {
  const previousToken = process.env.CONVEX_SERVICE_TOKEN;
  process.env.CONVEX_SERVICE_TOKEN = "expected-token";
  try {
    await run();
  } finally {
    if (previousToken === undefined) delete process.env.CONVEX_SERVICE_TOKEN;
    else process.env.CONVEX_SERVICE_TOKEN = previousToken;
  }
}

test("dashboard state rejects an invalid Convex service token before reading data", async () => {
  await withServiceToken(async () => {
    await assert.rejects(() => getStateHandler({}, { serviceToken: "wrong-token" }), (error) => {
      assert.equal(convexErrorCode(error), "UNAUTHORIZED");
      return true;
    });
  });
});

test("dashboard state rejects stale whole-state writes", async () => {
  await withServiceToken(async () => {
    const ctx = {
      db: {
        query: () => ({ withIndex: () => ({ unique: async () => ({ updatedAt: "2026-07-09T00:00:00.000Z" }) }) })
      }
    };
    await assert.rejects(
      () => saveStateHandler(ctx, { serviceToken: "expected-token", expectedUpdatedAt: "2026-07-08T00:00:00.000Z" }),
      (error) => {
        assert.equal(convexErrorCode(error), "STATE_CONFLICT");
        return true;
      }
    );
  });
});

function legacyTransaction(id: string, source: Transaction["source"] = "wise"): Transaction {
  return {
    id,
    source,
    accountName: "Operating",
    date: "2026-07-31",
    description: "Merchant",
    rawName: "Merchant",
    counterparty: "Merchant",
    amount: 10,
    currency: "USD",
    direction: "out",
    status: "posted",
    category: "Review"
  };
}

function legacyMigrationContext(
  state: Record<string, unknown> & { _id: string; updatedAt: string },
  initialBankRows: Array<Transaction & { _id: string; _creationTime: number; syncedAt: string }> = []
) {
  const bankRows = new Map(initialBankRows.map((row) => [row.id, { ...row }]));
  const referenceDispositions = new Map<string, Record<string, unknown>>();
  let ledgerRevision: { _id: string; key: string; revision: number; updatedAt: string } | null = null;
  let inserted = 0;
  let dashboardPatches = 0;
  const applyPatch = (target: Record<string, unknown>, patch: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete target[key];
      else target[key] = value;
    }
  };
  const db = {
    query(table: string) {
      if (table === "dashboardState") {
        return {
          withIndex: (_index: string, applyRange: (range: { eq: (field: string, value: unknown) => unknown }) => unknown) => {
            const range = { eq: () => range };
            applyRange(range);
            return { unique: async () => state };
          }
        };
      }
      if (table === "bankTransactions") {
        return {
          withIndex: (_index: string, applyRange: (range: { eq: (field: string, value: unknown) => unknown }) => unknown) => {
            let transactionId = "";
            const range = {
              eq: (_field: string, value: unknown) => {
                transactionId = String(value);
                return range;
              }
            };
            applyRange(range);
            return { unique: async () => bankRows.get(transactionId) ?? null };
          }
        };
      }
      if (table === "bankLedgerRevision") {
        return {
          withIndex: (_index: string, applyRange: (range: { eq: (field: string, value: unknown) => unknown }) => unknown) => {
            const range = { eq: () => range };
            applyRange(range);
            return { unique: async () => ledgerRevision };
          }
        };
      }
      if (table === "bankLegacyReferenceDispositions") {
        return {
          withIndex: (_index: string, applyRange: (range: { eq: (field: string, value: unknown) => unknown }) => unknown) => {
            let key = "";
            const range = {
              eq: (_field: string, value: unknown) => {
                key = String(value);
                return range;
              }
            };
            applyRange(range);
            return { unique: async () => referenceDispositions.get(key) ?? null };
          }
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
    async insert(table: string, value: Record<string, unknown>) {
      if (table === "bankLedgerRevision") {
        ledgerRevision = { ...(value as Omit<NonNullable<typeof ledgerRevision>, "_id">), _id: "ledger-revision" };
        return "ledger-revision";
      }
      if (table === "bankLegacyReferenceDispositions") {
        referenceDispositions.set(String(value.key), { ...value, _id: `reference-${referenceDispositions.size + 1}` });
        return `reference-${referenceDispositions.size}`;
      }
      assert.equal(table, "bankTransactions");
      inserted += 1;
      const transaction = value as unknown as Transaction & { syncedAt: string };
      bankRows.set(transaction.id, {
        ...transaction,
        _id: `bank-row-${inserted}`,
        _creationTime: inserted
      });
      return `bank-row-${inserted}`;
    },
    async patch(id: string, patch: Record<string, unknown>) {
      if (id === state._id) {
        dashboardPatches += 1;
        applyPatch(state, patch);
        return;
      }
      if (ledgerRevision?._id === id) {
        applyPatch(ledgerRevision, patch);
        return;
      }
      const row = [...bankRows.values()].find((candidate) => candidate._id === id);
      if (!row) throw new Error(`Unknown bank row ${id}`);
      applyPatch(row, patch);
    }
  };
  return {
    ctx: { db },
    bankRows,
    referenceDispositions,
    dashboardPatchCount: () => dashboardPatches
  };
}

test("legacy ledger migration moves at most 100 rows atomically and finishes assignments separately", async () => {
  await withServiceToken(async () => {
    const state: Record<string, unknown> & { _id: string; updatedAt: string } = {
      _id: "dashboard-state",
      updatedAt: "2026-07-31T00:00:00.000Z",
      wiseStatementTransactions: Array.from({ length: 101 }, (_, index) => legacyTransaction(`legacy-${index}`)),
      transactionTeamAssignments: [
        { transactionId: "legacy-0", teamId: "team-wgnr", updatedAt: "2026-07-31T00:00:00.000Z" },
        { transactionId: "ledger-only", teamId: "team-wgnr", updatedAt: "2026-07-31T00:00:00.000Z" }
      ]
    };
    const existingLegacy = {
      ...legacyTransaction("legacy-0"),
      category: "Software",
      merchantName: "Existing merchant",
      classificationComplete: true,
      _id: "existing-legacy",
      _creationTime: 1,
      syncedAt: "2026-07-30T00:00:00.000Z"
    };
    const existingAssignmentOnly = {
      ...legacyTransaction("ledger-only", "revolut"),
      _id: "existing-assignment-only",
      _creationTime: 2,
      syncedAt: "2026-07-30T00:00:00.000Z"
    };
    const { ctx, bankRows, dashboardPatchCount } = legacyMigrationContext(
      state,
      [existingLegacy, existingAssignmentOnly]
    );

    const first = await migrateLegacyLedgerBatchHandler(ctx, {
      serviceToken: "expected-token",
      limit: 9_001
    });
    assert.deepEqual(
      {
        processedTransactions: first.processedTransactions,
        insertedTransactions: first.insertedTransactions,
        updatedTransactions: first.updatedTransactions,
        appliedTeamAssignments: first.appliedTeamAssignments,
        remainingTransactions: first.remainingTransactions,
        remainingTeamAssignments: first.remainingTeamAssignments,
        isDone: first.isDone
      },
      {
        processedTransactions: 100,
        insertedTransactions: 99,
        updatedTransactions: 1,
        appliedTeamAssignments: 1,
        remainingTransactions: 1,
        remainingTeamAssignments: 1,
        isDone: false
      }
    );
    assert.equal("transactions" in first, false);
    assert.equal((state.wiseStatementTransactions as Transaction[]).length, 1);
    assert.equal((state.transactionTeamAssignments as unknown[]).length, 1);
    assert.equal(bankRows.get("legacy-0")?.category, "Software");
    assert.equal(bankRows.get("legacy-0")?.merchantName, "Existing merchant");
    assert.equal(bankRows.get("legacy-0")?.teamId, "team-wagner");

    const second = await migrateLegacyLedgerBatchHandler(ctx, { serviceToken: "expected-token" });
    assert.equal(second.processedTransactions, 1);
    assert.equal(second.insertedTransactions, 1);
    assert.equal(second.remainingTransactions, 0);
    assert.equal(second.remainingTeamAssignments, 1);
    assert.equal(second.isDone, false);
    assert.equal("wiseStatementTransactions" in state, false);

    const third = await migrateLegacyLedgerBatchHandler(ctx, { serviceToken: "expected-token" });
    assert.equal(third.processedTransactions, 0);
    assert.equal(third.appliedTeamAssignments, 1);
    assert.equal(third.orphanedTeamAssignments, 0);
    assert.equal(third.isDone, true);
    assert.equal("transactionTeamAssignments" in state, false);
    assert.equal(bankRows.get("ledger-only")?.teamId, "team-wagner");

    const patchesBeforeNoop = dashboardPatchCount();
    const fourth = await migrateLegacyLedgerBatchHandler(ctx, { serviceToken: "expected-token" });
    assert.equal(fourth.isDone, true);
    assert.equal(fourth.updatedAt, third.updatedAt);
    assert.equal(dashboardPatchCount(), patchesBeforeNoop);
  });
});

test("legacy ledger migration aborts on orphaned assignments without deleting audit evidence", async () => {
  await withServiceToken(async () => {
    const state: Record<string, unknown> & { _id: string; updatedAt: string } = {
      _id: "dashboard-state",
      updatedAt: "2026-07-31T00:00:00.000Z",
      transactionTeamAssignments: [
        { transactionId: "missing", teamId: "team-wgnr", updatedAt: "2026-07-31T00:00:00.000Z" }
      ]
    };
    const { ctx } = legacyMigrationContext(state);
    await assert.rejects(
      () => migrateLegacyLedgerBatchHandler(ctx, { serviceToken: "expected-token", limit: 1 }),
      (error) => {
        assert.equal(convexErrorCode(error), "ORPHANED_LEGACY_TEAM_ASSIGNMENT");
        return true;
      }
    );
    assert.deepEqual(state.transactionTeamAssignments, [
      { transactionId: "missing", teamId: "team-wgnr", updatedAt: "2026-07-31T00:00:00.000Z" }
    ]);
  });
});

test("legacy orphan disposition is explicit, audited, and cannot run before transaction migration", async () => {
  await withServiceToken(async () => {
    const state: Record<string, unknown> & { _id: string; updatedAt: string } = {
      _id: "dashboard-state",
      updatedAt: "2026-07-31T00:00:00.000Z",
      wiseStatementTransactions: [legacyTransaction("not-migrated")],
      transactionTeamAssignments: [
        { transactionId: "existing", teamId: "team-wgnr", updatedAt: "2026-07-31T00:00:00.000Z" },
        { transactionId: "missing", teamId: "team-general", updatedAt: "2026-07-31T00:00:00.000Z" }
      ]
    };
    const existing = {
      ...legacyTransaction("existing"),
      _id: "existing",
      _creationTime: 1,
      syncedAt: "2026-07-30T00:00:00.000Z"
    };
    const { ctx, referenceDispositions } = legacyMigrationContext(state, [existing]);
    await assert.rejects(
      () => disposeOrphanedLegacyTeamAssignmentsHandler(ctx, {
        serviceToken: "expected-token",
        disposition: "discard-orphaned-team-assignment"
      }),
      (error) => {
        assert.equal(convexErrorCode(error), "LEGACY_TRANSACTIONS_NOT_MIGRATED");
        return true;
      }
    );

    delete state.wiseStatementTransactions;
    const result = await disposeOrphanedLegacyTeamAssignmentsHandler(ctx, {
      serviceToken: "expected-token",
      disposition: "discard-orphaned-team-assignment"
    });
    assert.equal(result.disposed, 1);
    assert.equal(result.remainingAssignments, 1);
    assert.deepEqual(state.transactionTeamAssignments, [
      { transactionId: "existing", teamId: "team-wgnr", updatedAt: "2026-07-31T00:00:00.000Z" }
    ]);
    assert.deepEqual(
      [...referenceDispositions.values()].map(({ transactionId, teamId, disposition }) => ({
        transactionId,
        teamId,
        disposition
      })),
      [{
        transactionId: "missing",
        teamId: "team-general",
        disposition: "discard-orphaned-team-assignment"
      }]
    );
  });
});

test("Wise dashboard reset clears import history after ledger rows are deleted in batches", async () => {
  await withServiceToken(async () => {
    const state = {
      _id: "dashboard-state",
      updatedAt: "2026-07-28T00:00:00.000Z",
      wiseStatementImports: [
        {
          id: "import-1",
          balanceId: "balance-1",
          currency: "USD",
          periodStart: "2026-07-01",
          periodEnd: "2026-07-28",
          fileName: "wise.csv",
          transactionCount: 1,
          importedAt: "2026-07-28T00:00:00.000Z"
        }
      ]
    };
    const ctx = {
      db: {
        query: () => ({ withIndex: () => ({ unique: async () => state }) }),
        patch: async (_id: string, patch: Partial<typeof state>) => Object.assign(state, patch)
      }
    };
    assert.deepEqual(
      await getWiseResetPreviewHandler(ctx, { serviceToken: "expected-token" }),
      { transactions: 0, imports: 1 }
    );
    const result = await resetWiseImportsHandler(ctx, { serviceToken: "expected-token" });
    assert.equal(result.deletedTransactions, 0);
    assert.equal(result.deletedImports, 1);
    assert.deepEqual(state.wiseStatementImports, []);
  });
});

test("income automation reservation retries failed and stale runs but not fresh or completed runs", async () => {
  await withServiceToken(async () => {
    const failed: AutomationRun = {
      id: "weekly-income-2026-07-13-2026-07-19",
      type: "weekly-income",
      periodStart: "2026-07-13",
      periodEnd: "2026-07-19",
      timezone: "Asia/Beirut",
      status: "failed",
      startedAt: "2026-07-20T06:00:00.000Z",
      completedAt: "2026-07-20T06:01:00.000Z",
      error: "TUNE unavailable"
    };
    const state = {
      _id: "dashboard-state",
      updatedAt: "2026-07-20T06:02:00.000Z",
      automationRuns: [failed]
    };
    const ctx = {
      db: {
        query: () => ({ withIndex: () => ({ unique: async () => state }) }),
        patch: async (_id: string, patch: Partial<typeof state>) => Object.assign(state, patch)
      }
    };
    const retry: AutomationRun = { ...failed, status: "running", startedAt: "2026-07-20T06:05:00.000Z", completedAt: undefined, error: undefined };
    assert.equal(
      (await reserveIncomeAutomationHandler(ctx, {
        serviceToken: "expected-token",
        run: retry,
        staleBefore: "2026-07-20T04:05:00.000Z"
      })).reserved,
      true
    );
    assert.equal(
      (await reserveIncomeAutomationHandler(ctx, {
        serviceToken: "expected-token",
        run: retry,
        staleBefore: "2026-07-20T04:05:00.000Z"
      })).reserved,
      false
    );

    state.automationRuns = [{ ...retry, startedAt: "2026-07-20T01:00:00.000Z" }];
    assert.equal(
      (await reserveIncomeAutomationHandler(ctx, {
        serviceToken: "expected-token",
        run: { ...retry, startedAt: "2026-07-20T08:00:00.000Z" },
        staleBefore: "2026-07-20T06:00:00.000Z"
      })).reserved,
      true
    );
    state.automationRuns = [{ ...retry, status: "completed", completedAt: "2026-07-20T08:01:00.000Z" }];
    assert.equal(
      (await reserveIncomeAutomationHandler(ctx, {
        serviceToken: "expected-token",
        run: retry,
        staleBefore: "2026-07-20T09:00:00.000Z"
      })).reserved,
      false
    );
  });
});

function draftInvoice(id = "invoice-1"): Invoice {
  return {
    id,
    providerId: "client",
    documentType: "sales_invoice",
    origin: "revenue",
    customerName: "Client",
    amount: 100,
    currency: "USD",
    status: "draft",
    meritDeliveryStatus: "not-sent",
    invoiceNumber: "FD-CLIENT-202607",
    issueDate: "2026-07-20",
    dueDate: "2026-07-27",
    source: "tune",
    description: "Partner revenue",
    revenueRunIds: ["run-1"],
    createdAt: "2026-07-20T06:00:00.000Z",
    updatedAt: "2026-07-20T06:00:00.000Z"
  };
}

test("invoice creation reservation prevents duplicate Merit creates and finalizes granularly", async () => {
  await withServiceToken(async () => {
    const revenueRun: RevenueRun = {
      id: "run-1",
      partnerId: "partner",
      partnerName: "Partner",
      source: "tune",
      periodStart: "2026-07-13",
      periodEnd: "2026-07-19",
      timezone: "Asia/Beirut",
      revenue: 100,
      currency: "USD",
      status: "drafted",
      invoiceId: "invoice-1",
      createdAt: "2026-07-20T06:00:00.000Z"
    };
    const state = {
      _id: "dashboard-state",
      updatedAt: "2026-07-20T06:00:00.000Z",
      invoices: [draftInvoice()],
      revenueRuns: [revenueRun]
    };
    const ctx = {
      db: {
        query: () => ({ withIndex: () => ({ unique: async () => state }) }),
        patch: async (_id: string, patch: Partial<typeof state>) => Object.assign(state, patch)
      }
    };

    assert.equal(
      (await reserveInvoiceCreationHandler(ctx, {
        serviceToken: "expected-token",
        invoiceId: "invoice-1",
        reservedAt: "2026-07-20T06:01:00.000Z"
      })).reserved,
      true
    );
    assert.equal(
      (await reserveInvoiceCreationHandler(ctx, {
        serviceToken: "expected-token",
        invoiceId: "invoice-1",
        reservedAt: "2026-07-20T06:01:01.000Z"
      })).reserved,
      false
    );

    const reserved = state.invoices[0];
    assert.equal(reserved.meritCreationReservedAt, "2026-07-20T06:01:00.000Z");
    const { meritCreationReservedAt: _reservation, ...cleanInvoice } = reserved;
    const saved: Invoice = {
      ...cleanInvoice,
      source: "merit",
      status: "open",
      meritStatus: "open",
      meritDeliveryStatus: "saved",
      externalId: "sih-123",
      updatedAt: "2026-07-20T06:02:00.000Z"
    };
    await finalizeInvoiceCreationHandler(ctx, { serviceToken: "expected-token", invoice: saved });
    assert.equal(state.invoices[0].externalId, "sih-123");
    assert.equal(state.invoices[0].meritCreationReservedAt, undefined);
    assert.equal(state.revenueRuns[0].status, "invoiced");
    assert.equal(
      (await reserveInvoiceCreationHandler(ctx, {
        serviceToken: "expected-token",
        invoiceId: "invoice-1",
        reservedAt: "2026-07-20T06:03:00.000Z"
      })).reserved,
      false
    );
  });
});

test("failed Merit creation requires an explicit draft edit before it can be reserved again", async () => {
  await withServiceToken(async () => {
    const state = {
      _id: "dashboard-state",
      updatedAt: "2026-07-20T06:00:00.000Z",
      invoices: [draftInvoice("invoice-retry")],
      revenueRuns: [] as RevenueRun[]
    };
    const ctx = {
      db: {
        query: () => ({ withIndex: () => ({ unique: async () => state }) }),
        patch: async (_id: string, patch: Partial<typeof state>) => Object.assign(state, patch)
      }
    };
    await reserveInvoiceCreationHandler(ctx, {
      serviceToken: "expected-token",
      invoiceId: "invoice-retry",
      reservedAt: "2026-07-20T06:01:00.000Z"
    });
    const { meritCreationReservedAt: _reservation, ...cleanInvoice } = state.invoices[0];
    await finalizeInvoiceCreationHandler(ctx, {
      serviceToken: "expected-token",
      invoice: { ...cleanInvoice, sendError: "Merit request outcome needs review", updatedAt: "2026-07-20T06:02:00.000Z" }
    });
    assert.equal(
      (await reserveInvoiceCreationHandler(ctx, {
        serviceToken: "expected-token",
        invoiceId: "invoice-retry",
        reservedAt: "2026-07-20T06:03:00.000Z"
      })).reserved,
      false
    );
    const { sendError: _sendError, ...edited } = state.invoices[0];
    state.invoices = [{ ...edited, description: "Reviewed and edited" }];
    assert.equal(
      (await reserveInvoiceCreationHandler(ctx, {
        serviceToken: "expected-token",
        invoiceId: "invoice-retry",
        reservedAt: "2026-07-20T06:04:00.000Z"
      })).reserved,
      true
    );
  });
});

test("only local draft invoices can reserve a Merit creation request", async () => {
  await withServiceToken(async () => {
    const state = {
      _id: "dashboard-state",
      updatedAt: "2026-07-20T06:00:00.000Z",
      invoices: [{ ...draftInvoice("invoice-open"), status: "open" as const }],
      revenueRuns: [] as RevenueRun[]
    };
    const ctx = {
      db: {
        query: () => ({ withIndex: () => ({ unique: async () => state }) }),
        patch: async (_id: string, patch: Partial<typeof state>) => Object.assign(state, patch)
      }
    };

    assert.equal(
      (await reserveInvoiceCreationHandler(ctx, {
        serviceToken: "expected-token",
        invoiceId: "invoice-open",
        reservedAt: "2026-07-20T06:01:00.000Z"
      })).reserved,
      false
    );
    assert.equal(state.invoices[0].meritCreationReservedAt, undefined);
  });
});
