import assert from "node:assert/strict";
import test from "node:test";
import { ConvexError } from "convex/values";
import type { Invoice, RevenueRun } from "../shared/types";
import { finalizeRevenueInvoice, getState, reserveRevenueInvoice, saveState } from "../convex/dashboard";

type RegisteredHandler<TArgs, TResult> = {
  _handler: (ctx: unknown, args: TArgs) => Promise<TResult>;
};

const getStateHandler = (getState as unknown as RegisteredHandler<{ serviceToken: string }, null>)._handler;
const saveStateHandler = (
  saveState as unknown as RegisteredHandler<Record<string, unknown> & { serviceToken: string; expectedUpdatedAt: string | null }, unknown>
)._handler;
const reserveRevenueInvoiceHandler = (
  reserveRevenueInvoice as unknown as RegisteredHandler<{ serviceToken: string; run: RevenueRun }, { reserved: boolean; updatedAt: string }>
)._handler;
const finalizeRevenueInvoiceHandler = (
  finalizeRevenueInvoice as unknown as RegisteredHandler<{ serviceToken: string; run: RevenueRun; invoice?: Invoice }, { updatedAt: string }>
)._handler;

function convexErrorCode(error: unknown): string | undefined {
  return error instanceof ConvexError && typeof error.data === "object" && error.data !== null && "code" in error.data
    ? String(error.data.code)
    : undefined;
}

test("dashboard state rejects an invalid Convex service token before reading data", async () => {
  const previousToken = process.env.CONVEX_SERVICE_TOKEN;
  process.env.CONVEX_SERVICE_TOKEN = "expected-token";
  try {
    await assert.rejects(() => getStateHandler({}, { serviceToken: "wrong-token" }), (error) => {
      assert.equal(convexErrorCode(error), "UNAUTHORIZED");
      return true;
    });
  } finally {
    if (previousToken === undefined) delete process.env.CONVEX_SERVICE_TOKEN;
    else process.env.CONVEX_SERVICE_TOKEN = previousToken;
  }
});

test("dashboard state rejects stale whole-state writes", async () => {
  const previousToken = process.env.CONVEX_SERVICE_TOKEN;
  process.env.CONVEX_SERVICE_TOKEN = "expected-token";
  const ctx = {
    db: {
      query: () => ({
        withIndex: () => ({ unique: async () => ({ updatedAt: "2026-07-09T00:00:00.000Z" }) })
      })
    }
  };

  try {
    await assert.rejects(
      () =>
        saveStateHandler(ctx, {
          serviceToken: "expected-token",
          expectedUpdatedAt: "2026-07-08T00:00:00.000Z"
        }),
      (error) => {
        assert.equal(convexErrorCode(error), "STATE_CONFLICT");
        return true;
      }
    );
  } finally {
    if (previousToken === undefined) delete process.env.CONVEX_SERVICE_TOKEN;
    else process.env.CONVEX_SERVICE_TOKEN = previousToken;
  }
});

test("revenue invoice reservation is atomic and finalization is granular", async () => {
  const previousToken = process.env.CONVEX_SERVICE_TOKEN;
  process.env.CONVEX_SERVICE_TOKEN = "expected-token";
  const state: {
    _id: string;
    updatedAt: string;
    revenueRuns: RevenueRun[];
    invoices: Invoice[];
  } = {
    _id: "dashboard-state",
    updatedAt: "2026-07-09T00:00:00.000Z",
    revenueRuns: [],
    invoices: []
  };
  const ctx = {
    db: {
      query: () => ({ withIndex: () => ({ unique: async () => state }) }),
      patch: async (_id: string, patch: Partial<typeof state>) => Object.assign(state, patch)
    }
  };
  const reservation: RevenueRun = {
    id: "revenue-partner-2026-07-01-2026-07-07",
    partnerId: "partner",
    partnerName: "Partner",
    source: "tune",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-07",
    timezone: "UTC",
    revenue: 100,
    currency: "USD",
    status: "invoicing",
    createdAt: "2026-07-08T00:00:00.000Z"
  };

  try {
    assert.equal(
      (await reserveRevenueInvoiceHandler(ctx, { serviceToken: "expected-token", run: reservation })).reserved,
      true
    );
    assert.equal(
      (await reserveRevenueInvoiceHandler(ctx, { serviceToken: "expected-token", run: reservation })).reserved,
      false
    );
    assert.equal(state.revenueRuns.length, 1);

    const invoice: Invoice = {
      id: "merit-1",
      documentType: "sales_invoice",
      customerName: "Partner",
      amount: 100,
      currency: "USD",
      status: "created",
      dueDate: "2026-07-14",
      source: "merit",
      description: "Partner revenue",
      createdAt: "2026-07-08T00:01:00.000Z"
    };
    await finalizeRevenueInvoiceHandler(ctx, {
      serviceToken: "expected-token",
      run: { ...reservation, status: "invoiced", invoiceId: invoice.id },
      invoice
    });
    assert.equal(state.revenueRuns[0]?.status, "invoiced");
    assert.equal(state.invoices[0]?.id, invoice.id);
  } finally {
    if (previousToken === undefined) delete process.env.CONVEX_SERVICE_TOKEN;
    else process.env.CONVEX_SERVICE_TOKEN = previousToken;
  }
});
