import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPaymentState,
  buildRevenueDraft,
  calculateApproximateUsdTotals,
  calculateInvoicePredictions,
  currentMonthAccrualPeriod,
  currentWeekAccrualPeriod,
  isLebanonIncomeAutomationTime,
  previousCalendarMonth,
  previousCompletedWeek,
  pruneSupersededAccrualRun,
  reconcileExactInvoicePayments
} from "./income";
import type { Invoice, PaymentAllocation, Provider, RevenuePartner, RevenueRun, Transaction } from "./types";

const partner: RevenuePartner = {
  id: "revenue-client",
  providerId: "client",
  name: "Client Co",
  source: "tune",
  revenueCategory: "Partner network revenue",
  affiliateId: "42",
  currency: "USD",
  timezone: "Asia/Beirut",
  networkTimezone: "UTC",
  networkIdEnv: "CLIENT_NETWORK_ID",
  apiKeyEnv: "CLIENT_API_KEY",
  meritCustomerName: "Client Co LLC",
  invoiceDueDays: 14,
  billingCadence: "weekly",
  billingTimezone: "Asia/Beirut",
  autoDraft: true,
  defaultMeritTaxId: "tax-zero",
  enabled: true,
  createdAt: "2026-01-01T00:00:00.000Z"
};

const run: RevenueRun = {
  id: "run-1",
  partnerId: partner.id,
  providerId: partner.providerId,
  partnerName: partner.name,
  revenueCategory: partner.revenueCategory,
  source: "tune",
  periodStart: "2026-07-06",
  periodEnd: "2026-07-12",
  timezone: "Asia/Beirut",
  revenue: 1250,
  currency: "USD",
  status: "pulled",
  createdAt: "2026-07-13T06:00:00.000Z"
};

function openInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "invoice-1",
    providerId: "client",
    documentType: "sales_invoice",
    origin: "revenue",
    customerName: "Client Co",
    amount: 1000,
    currency: "USD",
    status: "open",
    meritDeliveryStatus: "saved",
    invoiceNumber: "FD-100",
    issueDate: "2026-07-01",
    dueDate: "2026-07-15",
    source: "merit",
    description: "Services",
    revenueRunIds: [],
    sentAt: "2026-07-01T12:00:00.000Z",
    createdAt: "2026-07-01T12:00:00.000Z",
    updatedAt: "2026-07-01T12:00:00.000Z",
    ...overrides
  };
}

test("Lebanon automation gate follows local summer and winter 09:00", () => {
  assert.equal(isLebanonIncomeAutomationTime(new Date("2026-07-20T06:00:00.000Z")), true);
  assert.equal(isLebanonIncomeAutomationTime(new Date("2026-12-07T07:00:00.000Z")), true);
  assert.equal(isLebanonIncomeAutomationTime(new Date("2026-07-20T07:00:00.000Z")), false);
  assert.equal(isLebanonIncomeAutomationTime(new Date("2026-07-21T06:00:00.000Z")), false);
});

test("billing period helpers close Monday-Sunday and calendar months", () => {
  assert.deepEqual(previousCompletedWeek(new Date("2026-07-20T06:00:00.000Z")), {
    periodStart: "2026-07-13",
    periodEnd: "2026-07-19"
  });
  assert.deepEqual(currentWeekAccrualPeriod(new Date("2026-07-20T06:00:00.000Z")), {
    periodStart: "2026-07-20",
    periodEnd: "2026-07-26",
    accruedThrough: "2026-07-20"
  });
  assert.deepEqual(currentMonthAccrualPeriod(new Date("2026-07-20T06:00:00.000Z")), {
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    accruedThrough: "2026-07-19"
  });
  assert.deepEqual(previousCalendarMonth(new Date("2026-03-02T07:00:00.000Z")), {
    periodStart: "2026-02-01",
    periodEnd: "2026-02-28"
  });
});

test("closed revenue run creates an idempotent local draft", () => {
  assert.throws(
    () => buildRevenueDraft(partner, run, new Date("2026-07-12T18:00:00.000Z")),
    /not a closed billing period/
  );
  const draft = buildRevenueDraft(partner, run, new Date("2026-07-13T06:00:00.000Z"));
  assert.equal(draft.id, "invoice-revenue-revenue-client-2026-07-06-2026-07-12");
  assert.equal(draft.status, "draft");
  assert.equal(draft.dueDate, "2026-07-27");
  assert.equal(draft.taxId, "tax-zero");
  assert.deepEqual(draft.revenueRunIds, [run.id]);
});

test("exact invoice reconciliation requires amount, currency, and company evidence", () => {
  const invoice = openInvoice();
  const provider: Provider = {
    id: "client",
    name: "Client Co",
    type: "client",
    tags: [],
    aliases: ["CLIENTCO PAYMENTS"],
    source: "manual",
    createdAt: "2026-01-01T00:00:00.000Z"
  };
  const transaction: Transaction = {
    id: "wise-payment-1",
    source: "wise",
    accountName: "Wise USD",
    date: "2026-07-10",
    description: "CLIENTCO PAYMENTS FD-100",
    rawName: "CLIENTCO PAYMENTS",
    counterparty: "ClientCo Payments",
    amount: 1000,
    currency: "USD",
    direction: "in",
    status: "settled",
    category: "Partner network revenue"
  };
  const result = reconcileExactInvoicePayments({
    invoices: [invoice],
    transactions: [transaction],
    allocations: [],
    providers: [provider],
    now: new Date("2026-07-10T12:00:00.000Z")
  });
  assert.equal(result.matched, 1);
  assert.equal(result.invoices[0].status, "paid");
  assert.equal(result.allocations[0].source, "wise");
  assert.equal(result.transactions[0].matchedInvoiceId, invoice.id);

  const wrongCurrency = reconcileExactInvoicePayments({
    invoices: [invoice],
    transactions: [{ ...transaction, id: "wise-payment-2", currency: "CAD" }],
    allocations: [],
    providers: [provider]
  });
  assert.equal(wrongCurrency.matched, 0);

  const supplierBill = reconcileExactInvoicePayments({
    invoices: [{ ...invoice, id: "supplier-bill", documentType: "supplier_bill" }],
    transactions: [{ ...transaction, id: "wise-supplier-payment" }],
    allocations: [],
    providers: [provider]
  });
  assert.equal(supplierBill.matched, 0);

  const lowConfidenceProvider = reconcileExactInvoicePayments({
    invoices: [invoice],
    transactions: [{
      ...transaction,
      id: "wise-low-confidence",
      counterparty: "Unrelated sender",
      rawName: "Unrelated sender",
      description: "Bank transfer",
      matchedProviderId: provider.id,
      confidence: 0.99
    }],
    allocations: [],
    providers: [provider]
  });
  assert.equal(lowConfidenceProvider.matched, 0);

  const shortNameProvider = { ...provider, name: "X", legalName: undefined, aliases: [] };
  const shortNameInvoice = { ...invoice, customerName: "X" };
  const substringOnly = reconcileExactInvoicePayments({
    invoices: [shortNameInvoice],
    transactions: [{
      ...transaction,
      id: "wise-substring-only",
      counterparty: "Tax authority",
      rawName: "Tax authority",
      description: "Tax payment"
    }],
    allocations: [],
    providers: [shortNameProvider]
  });
  assert.equal(substringOnly.matched, 0);

  const standaloneShortName = reconcileExactInvoicePayments({
    invoices: [{ ...shortNameInvoice, customerName: "A" }],
    transactions: [{
      ...transaction,
      id: "wise-standalone-short-name",
      counterparty: "A",
      rawName: "A",
      description: "A"
    }],
    allocations: [],
    providers: [{ ...shortNameProvider, name: "A" }]
  });
  assert.equal(standaloneShortName.matched, 0);
});

test("partial allocations keep an invoice open until fully covered", () => {
  const invoice = openInvoice();
  const first: PaymentAllocation = {
    id: "payment-1",
    invoiceId: invoice.id,
    amount: 400,
    currency: "USD",
    source: "wise",
    mode: "manual",
    paidAt: "2026-07-10",
    createdAt: "2026-07-10T12:00:00.000Z"
  };
  assert.equal(applyPaymentState([invoice], [first])[0].status, "open");
  assert.equal(
    applyPaymentState(
      [invoice],
      [first, { ...first, id: "payment-2", amount: 600, paidAt: "2026-07-12" }]
    )[0].status,
    "paid"
  );
});

test("payment prediction waits for five confirmed transaction matches and uses their median", () => {
  const historyInvoices = [5, 7, 9, 20, 6].map((delay, index) =>
    openInvoice({
      id: `paid-${index}`,
      status: "paid",
      issueDate: `2026-0${index + 1}-01`,
      sentAt: `2026-0${index + 1}-04T00:00:00.000Z`,
      paidAt: `2026-0${index + 1}-${String(1 + delay).padStart(2, "0")}T00:00:00.000Z`
    })
  );
  const allocations = historyInvoices.map((invoice, index): PaymentAllocation => ({
    id: `allocation-${index}`,
    invoiceId: invoice.id,
    transactionId: `transaction-${index}`,
    amount: invoice.amount,
    currency: invoice.currency,
    source: "wise",
    mode: "automatic",
    paidAt: invoice.paidAt as string,
    createdAt: invoice.paidAt as string
  }));
  const prediction = calculateInvoicePredictions([...historyInvoices, openInvoice()], allocations).at(-1);
  assert.equal(prediction?.sampleSize, 5);
  assert.equal(prediction?.medianDays, 7);
  assert.equal(prediction?.predictedDate, "2026-07-08");
});

test("a newer monthly accrual removes only its superseded cumulative pull", () => {
  const earlierRun = {
    ...run,
    id: "run-month-through-12",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-12",
    revenue: 500
  };
  const latestRun = {
    ...run,
    id: "run-month-through-19",
    periodStart: "2026-07-01",
    periodEnd: "2026-07-19",
    revenue: 900
  };
  const previousAccrual = {
    id: "accrual-july",
    partnerId: partner.id,
    providerId: partner.providerId,
    partnerName: partner.name,
    billingCadence: "monthly" as const,
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    accruedThrough: "2026-07-12",
    amount: 500,
    currency: "USD",
    status: "accruing" as const,
    revenueRunId: earlierRun.id,
    updatedAt: "2026-07-13T06:00:00.000Z"
  };

  assert.deepEqual(
    pruneSupersededAccrualRun([latestRun, earlierRun], previousAccrual, latestRun.id).map((item) => item.id),
    [latestRun.id]
  );
  assert.equal(
    pruneSupersededAccrualRun(
      [latestRun, { ...earlierRun, status: "drafted", invoiceId: "invoice-july" }],
      previousAccrual,
      latestRun.id
    ).length,
    2
  );
});

test("approximate USD totals retain missing-quote disclosure", () => {
  const totals = calculateApproximateUsdTotals(
    [
      { id: "usd", name: "USD", source: "wise", balance: 100, currency: "USD", updatedAt: "2026-07-20", status: "live" },
      { id: "cad", name: "CAD", source: "wise", balance: 100, currency: "CAD", updatedAt: "2026-07-20", status: "live" },
      { id: "amex", name: "Amex", source: "amex", balance: -500, currency: "EUR", updatedAt: "2026-07-20", status: "live" }
    ],
    [
      { id: "btc", name: "Trust", kind: "wallet", assetType: "crypto", asset: "BTC", balance: 0.01, updatedAt: "2026-07-20" },
      { id: "eth", name: "Kraken", kind: "exchange", assetType: "crypto", asset: "ETH", balance: 1, updatedAt: "2026-07-20" }
    ],
    [
      { asset: "CAD", rateUsd: 0.75, provider: "yahoo", asOf: "2026-07-20T00:00:00.000Z" },
      { asset: "BTC", rateUsd: 120000, provider: "yahoo", asOf: "2026-07-20T00:00:00.000Z" }
    ]
  );
  assert.equal(totals.accountsUsd, 175);
  assert.equal(totals.holdingsUsd, 1200);
  assert.equal(totals.totalUsd, 1375);
  assert.deepEqual(totals.excludedAssets, ["ETH"]);
});
