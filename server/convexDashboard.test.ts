import assert from "node:assert/strict";
import test from "node:test";
import { ConvexError } from "convex/values";
import type { AutomationRun, Invoice, RevenueRun } from "../shared/types";
import {
  finalizeInvoiceCreation,
  getState,
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
