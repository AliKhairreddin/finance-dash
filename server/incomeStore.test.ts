import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Invoice } from "../shared/types";

test("deliver mode persists Merit creation and retries delivery without recreating", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "finance-dash-income-"));
  const previousDirectory = process.cwd();
  const previousFetch = globalThis.fetch;
  const previousWriteSwitch = process.env.MERIT_WRITES_ENABLED;
  const previousApiId = process.env.MERIT_API_ID;
  const previousApiKey = process.env.MERIT_API_KEY;
  let createCalls = 0;
  let deliveryCalls = 0;
  let deliveryShouldFail = true;
  let releaseCreation: (() => void) | undefined;
  let creationStartedResolve: (() => void) | undefined;
  const creationStarted = new Promise<void>((resolve) => {
    creationStartedResolve = resolve;
  });
  const creationGate = new Promise<void>((resolve) => {
    releaseCreation = resolve;
  });

  const invoice: Invoice = {
    id: "invoice-local-1",
    providerId: "provider-1",
    documentType: "sales_invoice",
    origin: "manual",
    customerName: "Client Co",
    amount: 1000,
    currency: "USD",
    status: "draft",
    meritDeliveryStatus: "not-sent",
    invoiceNumber: "FD-TEST-1",
    issueDate: "2026-07-20",
    dueDate: "2026-08-03",
    source: "manual",
    description: "Services",
    revenueRunIds: [],
    taxId: "tax-zero",
    createdAt: "2026-07-20T12:00:00.000Z",
    updatedAt: "2026-07-20T12:00:00.000Z"
  };

  try {
    process.chdir(temporaryDirectory);
    await mkdir(join(temporaryDirectory, ".local"), { recursive: true });
    await writeFile(
      join(temporaryDirectory, ".local", "finance-dashboard-store.json"),
      JSON.stringify({
        providers: [
          {
            id: "provider-1",
            name: "Client Co",
            type: "client",
            tags: [],
            aliases: [],
            source: "manual",
            createdAt: "2026-07-01T00:00:00.000Z"
          }
        ],
        invoices: [invoice],
        paymentAllocations: [],
        holdings: [],
        fxRates: [],
        automationRuns: [],
        teams: [],
        transactionCategoryRules: [],
        revenuePartners: [],
        transactionTeamAssignments: [],
        wiseCardHolderTeamAssignments: [],
        transactions: [],
        wiseStatementTransactions: [],
        wiseStatementImports: [],
        revenueRuns: [],
        revenueAccruals: [],
        profitDistributionAdjustments: []
      }),
      "utf8"
    );

    process.env.MERIT_WRITES_ENABLED = "true";
    process.env.MERIT_API_ID = "api-id";
    process.env.MERIT_API_KEY = "api-key";
    globalThis.fetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/v1/gettaxes")) {
        return Response.json([{ Id: "tax-zero", Code: "0", NameEN: "Zero", TaxPct: 0 }]);
      }
      if (path.endsWith("/v2/sendinvoicebyemail")) {
        deliveryCalls += 1;
        assert.deepEqual(JSON.parse(String(init?.body)), { Id: "merit-1", DelivNote: false });
        return deliveryShouldFail
          ? new Response("delivery unavailable", { status: 503, statusText: "Unavailable" })
          : Response.json({ ok: true });
      }
      if (path.endsWith("/v2/sendinvoice")) {
        createCalls += 1;
        creationStartedResolve?.();
        await creationGate;
        return Response.json({ InvoiceId: "merit-1", InvoiceNo: "M-100" });
      }
      throw new Error(`Unexpected request ${path}`);
    };

    const store = await import("./store");
    await store.initializeStore();
    const firstRequest = store.sendInvoices({
      invoiceIds: [invoice.id],
      mode: "deliver",
      confirmation: "SEND_TO_MERIT"
    });
    await creationStarted;
    const overlapping = await store.sendInvoices({
      invoiceIds: [invoice.id],
      mode: "save",
      confirmation: "SEND_TO_MERIT"
    });
    assert.equal(overlapping.outcomes[0]?.status, "failed");
    assert.match(overlapping.outcomes[0]?.message ?? "", /Review Merit/);
    releaseCreation?.();
    const first = await firstRequest;
    assert.equal(createCalls, 1);
    assert.equal(deliveryCalls, 1);
    assert.equal(first.outcomes[0]?.status, "failed");
    assert.equal(first.dashboard.invoices[0]?.status, "open");
    assert.equal(first.dashboard.invoices[0]?.externalId, "merit-1");
    assert.equal(first.dashboard.invoices[0]?.meritDeliveryStatus, "delivery-failed");
    assert.equal(first.dashboard.invoices[0]?.sentAt, undefined);

    deliveryShouldFail = false;
    const retried = await store.sendInvoices({
      invoiceIds: [invoice.id],
      mode: "deliver",
      confirmation: "SEND_TO_MERIT"
    });
    assert.equal(createCalls, 1);
    assert.equal(deliveryCalls, 2);
    assert.equal(retried.outcomes[0]?.status, "delivered");
    assert.equal(retried.dashboard.invoices[0]?.meritDeliveryStatus, "delivered");
    assert.ok(retried.dashboard.invoices[0]?.sentAt);
  } finally {
    process.chdir(previousDirectory);
    globalThis.fetch = previousFetch;
    if (previousWriteSwitch === undefined) delete process.env.MERIT_WRITES_ENABLED;
    else process.env.MERIT_WRITES_ENABLED = previousWriteSwitch;
    if (previousApiId === undefined) delete process.env.MERIT_API_ID;
    else process.env.MERIT_API_ID = previousApiId;
    if (previousApiKey === undefined) delete process.env.MERIT_API_KEY;
    else process.env.MERIT_API_KEY = previousApiKey;
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("revenue rules stay client-owned, survive normally, and do not resurrect after client deletion", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "finance-dash-rules-"));
  const previousDirectory = process.cwd();
  const createdAt = "2026-07-20T12:00:00.000Z";
  try {
    process.chdir(temporaryDirectory);
    await mkdir(join(temporaryDirectory, ".local"), { recursive: true });
    await writeFile(
      join(temporaryDirectory, ".local", "finance-dashboard-store.json"),
      JSON.stringify({
        providers: [
          { id: "client-1", name: "Acme", type: "client", tags: [], aliases: [], source: "manual", createdAt },
          { id: "supplier-1", name: "Supplier", type: "supplier", tags: [], aliases: [], source: "manual", createdAt }
        ],
        invoices: [{
          id: "invoice-open-1",
          providerId: "client-1",
          documentType: "sales_invoice",
          origin: "manual",
          customerName: "Acme",
          amount: 250,
          currency: "USD",
          status: "open",
          meritDeliveryStatus: "saved",
          invoiceNumber: "FD-ACME-1",
          issueDate: "2026-07-01",
          dueDate: "2026-07-31",
          source: "merit",
          externalId: "merit-acme-1",
          description: "Services",
          revenueRunIds: [],
          createdAt,
          updatedAt: createdAt
        }],
        paymentAllocations: [], holdings: [], fxRates: [], automationRuns: [], teams: [],
        transactionCategoryRules: [], revenuePartners: [], transactionTeamAssignments: [],
        wiseCardHolderTeamAssignments: [], wiseStatementTransactions: [], wiseStatementImports: [],
        transactions: [{
          id: "wise-acme-payment",
          source: "wise",
          accountName: "Wise USD",
          date: "2026-07-20",
          description: "ACME SETTLEMENT",
          rawName: "ACME TREASURY 7788",
          counterparty: "Acme Treasury",
          amount: 250,
          currency: "USD",
          direction: "in",
          status: "settled",
          category: "Revenue"
        }],
        revenueRuns: [], revenueAccruals: [], profitDistributionAdjustments: []
      }),
      "utf8"
    );

    const store = await import("./store");
    await store.initializeStore();
    const rulePayload = {
      name: "Acme weekly",
      providerId: "client-1",
      revenueCategory: "Partner network revenue",
      affiliateId: "42",
      currency: "USD",
      timezone: "Asia/Beirut",
      networkTimezone: "UTC",
      networkIdEnv: "ACME_TUNE_NETWORK_ID",
      apiKeyEnv: "ACME_TUNE_API_KEY",
      invoiceDueDays: 14,
      billingCadence: "weekly" as const,
      billingTimezone: "Asia/Beirut",
      autoDraft: true,
      enabled: true
    };
    const firstRule = await store.createRevenuePartner(rulePayload);
    const secondRule = await store.createRevenuePartner({ ...rulePayload, name: "Acme monthly", billingCadence: "monthly" });
    assert.notEqual(firstRule.id, secondRule.id);
    assert.equal(store.getSnapshot().revenuePartners.filter((rule) => rule.providerId === "client-1").length, 2);
    await assert.rejects(
      store.createRevenuePartner({ ...rulePayload, providerId: "supplier-1" }),
      /must be a client/
    );
    await assert.rejects(
      store.createRevenuePartner({ ...rulePayload, providerId: "missing-client" }),
      /must be a client/
    );
    await assert.rejects(
      store.createRevenuePartner({ ...rulePayload, networkIdEnv: "not-valid" }),
      /uppercase environment variable/
    );
    await assert.rejects(
      store.createRevenuePartner({ ...rulePayload, affiliateId: "   " }),
      /Affiliate ID is required/
    );

    await store.recordInvoicePayment("invoice-open-1", {
      amount: 250,
      paidAt: "2026-07-20",
      source: "wise",
      transactionId: "wise-acme-payment"
    });
    const learnedProvider = store.getSnapshot().providers.find((provider) => provider.id === "client-1");
    assert.equal(learnedProvider?.aliases.includes("ACME TREASURY 7788"), true);

    await store.deleteProvider("client-1");
    assert.equal(store.getSnapshot().revenuePartners.some((rule) => rule.providerId === "client-1"), false);
    assert.equal(store.getSnapshot().invoices.some((invoice) => invoice.id === "invoice-open-1"), true);
    await store.initializeStore();
    assert.equal(store.getSnapshot().providers.some((item) => item.id === "client-1"), false);
    assert.equal(store.getSnapshot().revenuePartners.some((rule) => rule.providerId === "client-1"), false);
  } finally {
    process.chdir(previousDirectory);
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("manual current-month pulls refresh a monthly accrual instead of accumulating snapshots", async (context) => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "finance-dash-accrual-"));
  const previousDirectory = process.cwd();
  const previousFetch = globalThis.fetch;
  const previousNetworkId = process.env.MONTHLY_TUNE_NETWORK_ID;
  const previousApiKey = process.env.MONTHLY_TUNE_API_KEY;
  const previousBaseUrl = process.env.MONTHLY_TUNE_API_BASE_URL;
  const createdAt = "2026-07-13T09:00:00.000Z";
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-07-20T12:00:00.000Z") });

  try {
    process.chdir(temporaryDirectory);
    await mkdir(join(temporaryDirectory, ".local"), { recursive: true });
    await writeFile(
      join(temporaryDirectory, ".local", "finance-dashboard-store.json"),
      JSON.stringify({
        providers: [{
          id: "client-monthly",
          name: "Monthly Client",
          type: "client",
          tags: [],
          aliases: [],
          source: "manual",
          createdAt
        }],
        invoices: [],
        paymentAllocations: [],
        holdings: [],
        fxRates: [],
        automationRuns: [],
        teams: [],
        transactionCategoryRules: [],
        revenuePartners: [{
          id: "rule-monthly",
          name: "Monthly Client",
          providerId: "client-monthly",
          revenueCategory: "Partner network revenue",
          source: "tune",
          affiliateId: "42",
          currency: "USD",
          timezone: "UTC",
          networkTimezone: "UTC",
          networkIdEnv: "MONTHLY_TUNE_NETWORK_ID",
          apiKeyEnv: "MONTHLY_TUNE_API_KEY",
          apiBaseUrlEnv: "MONTHLY_TUNE_API_BASE_URL",
          invoiceDueDays: 14,
          billingCadence: "monthly",
          billingTimezone: "UTC",
          autoDraft: true,
          enabled: true,
          createdAt
        }],
        transactionTeamAssignments: [],
        wiseCardHolderTeamAssignments: [],
        transactions: [],
        wiseStatementTransactions: [],
        wiseStatementImports: [],
        revenueRuns: [{
          id: "revenue-rule-monthly-2026-07-01-2026-07-12",
          partnerId: "rule-monthly",
          partnerName: "Monthly Client",
          providerId: "client-monthly",
          revenueCategory: "Partner network revenue",
          source: "tune",
          periodStart: "2026-07-01",
          periodEnd: "2026-07-12",
          timezone: "UTC",
          revenue: 500,
          currency: "USD",
          status: "pulled",
          createdAt
        }],
        revenueAccruals: [{
          id: "revenue-accrual-rule-monthly-2026-07-01-2026-07-31",
          partnerId: "rule-monthly",
          providerId: "client-monthly",
          partnerName: "Monthly Client",
          billingCadence: "monthly",
          periodStart: "2026-07-01",
          periodEnd: "2026-07-31",
          accruedThrough: "2026-07-12",
          amount: 500,
          currency: "USD",
          status: "accruing",
          revenueRunId: "revenue-rule-monthly-2026-07-01-2026-07-12",
          updatedAt: createdAt
        }],
        profitDistributionAdjustments: []
      }),
      "utf8"
    );

    process.env.MONTHLY_TUNE_NETWORK_ID = "monthly-network";
    process.env.MONTHLY_TUNE_API_KEY = "monthly-key";
    process.env.MONTHLY_TUNE_API_BASE_URL = "https://tune.example.test/Apiv3/json";
    let expectedPeriodEnd = "2026-07-19";
    let payout = "900";
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      assert.equal(url.origin, "https://tune.example.test");
      assert.equal(url.searchParams.get("data_start"), "2026-07-01");
      assert.equal(url.searchParams.get("data_end"), expectedPeriodEnd);
      assert.equal(url.searchParams.get("filters[Affiliate.id][conditional]"), "EQUAL_TO");
      assert.equal(url.searchParams.get("filters[Affiliate.id][values][0]"), "42");
      return Response.json({
        response: {
          status: 1,
          data: [{ Stat: { payout, clicks: "12", conversions: "4" } }]
        }
      });
    };

    const store = await import("./store");
    await store.initializeStore();
    const snapshot = await store.syncRevenue({
      partnerId: "rule-monthly",
      periodPreset: "custom",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-19",
      timezone: "UTC"
    });

    assert.deepEqual(
      snapshot.revenueRuns.map((run) => run.id),
      ["revenue-rule-monthly-2026-07-01-2026-07-19"]
    );
    assert.equal(snapshot.revenueRuns[0]?.revenue, 900);
    assert.equal(snapshot.revenueAccruals.length, 1);
    assert.equal(snapshot.revenueAccruals[0]?.periodEnd, "2026-07-31");
    assert.equal(snapshot.revenueAccruals[0]?.accruedThrough, "2026-07-19");
    assert.equal(snapshot.revenueAccruals[0]?.amount, 900);
    assert.equal(snapshot.revenueAccruals[0]?.revenueRunId, "revenue-rule-monthly-2026-07-01-2026-07-19");

    expectedPeriodEnd = "2026-07-18";
    payout = "800";
    const staleSnapshot = await store.syncRevenue({
      partnerId: "rule-monthly",
      periodPreset: "custom",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-18",
      timezone: "UTC"
    });
    assert.deepEqual(
      staleSnapshot.revenueRuns.map((run) => run.id),
      ["revenue-rule-monthly-2026-07-01-2026-07-19"]
    );
    assert.equal(staleSnapshot.revenueAccruals[0]?.amount, 900);
    assert.equal(staleSnapshot.revenueAccruals[0]?.accruedThrough, "2026-07-19");
  } finally {
    context.mock.timers.reset();
    process.chdir(previousDirectory);
    globalThis.fetch = previousFetch;
    if (previousNetworkId === undefined) delete process.env.MONTHLY_TUNE_NETWORK_ID;
    else process.env.MONTHLY_TUNE_NETWORK_ID = previousNetworkId;
    if (previousApiKey === undefined) delete process.env.MONTHLY_TUNE_API_KEY;
    else process.env.MONTHLY_TUNE_API_KEY = previousApiKey;
    if (previousBaseUrl === undefined) delete process.env.MONTHLY_TUNE_API_BASE_URL;
    else process.env.MONTHLY_TUNE_API_BASE_URL = previousBaseUrl;
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("current-week pulls refresh one weekly accrual and cannot draft before the week closes", async (context) => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "finance-dash-weekly-accrual-"));
  const previousDirectory = process.cwd();
  const previousFetch = globalThis.fetch;
  const previousNetworkId = process.env.WEEKLY_TUNE_NETWORK_ID;
  const previousApiKey = process.env.WEEKLY_TUNE_API_KEY;
  const previousBaseUrl = process.env.WEEKLY_TUNE_API_BASE_URL;
  const createdAt = "2026-07-22T09:00:00.000Z";
  context.mock.timers.enable({ apis: ["Date"], now: new Date("2026-07-23T12:00:00.000Z") });

  try {
    process.chdir(temporaryDirectory);
    await mkdir(join(temporaryDirectory, ".local"), { recursive: true });
    await writeFile(
      join(temporaryDirectory, ".local", "finance-dashboard-store.json"),
      JSON.stringify({
        providers: [{
          id: "client-weekly",
          name: "Weekly Client",
          type: "client",
          tags: [],
          aliases: [],
          source: "manual",
          createdAt
        }],
        invoices: [],
        paymentAllocations: [],
        holdings: [],
        fxRates: [],
        automationRuns: [],
        teams: [],
        transactionCategoryRules: [],
        revenuePartners: [{
          id: "rule-weekly",
          name: "Weekly Client",
          providerId: "client-weekly",
          source: "tune",
          affiliateId: "77",
          currency: "USD",
          timezone: "UTC",
          networkTimezone: "UTC",
          networkIdEnv: "WEEKLY_TUNE_NETWORK_ID",
          apiKeyEnv: "WEEKLY_TUNE_API_KEY",
          apiBaseUrlEnv: "WEEKLY_TUNE_API_BASE_URL",
          invoiceDueDays: 7,
          billingCadence: "weekly",
          billingTimezone: "UTC",
          autoDraft: true,
          enabled: true,
          createdAt
        }],
        transactionTeamAssignments: [],
        wiseCardHolderTeamAssignments: [],
        transactions: [],
        wiseStatementTransactions: [],
        wiseStatementImports: [],
        revenueRuns: [{
          id: "revenue-rule-weekly-2026-07-20-2026-07-22",
          partnerId: "rule-weekly",
          partnerName: "Weekly Client",
          providerId: "client-weekly",
          source: "tune",
          periodStart: "2026-07-20",
          periodEnd: "2026-07-22",
          timezone: "UTC",
          revenue: 300,
          currency: "USD",
          status: "pulled",
          createdAt
        }],
        revenueAccruals: [{
          id: "revenue-accrual-rule-weekly-2026-07-20-2026-07-26",
          partnerId: "rule-weekly",
          providerId: "client-weekly",
          partnerName: "Weekly Client",
          billingCadence: "weekly",
          periodStart: "2026-07-20",
          periodEnd: "2026-07-26",
          accruedThrough: "2026-07-22",
          amount: 300,
          currency: "USD",
          status: "accruing",
          revenueRunId: "revenue-rule-weekly-2026-07-20-2026-07-22",
          updatedAt: createdAt
        }],
        profitDistributionAdjustments: []
      }),
      "utf8"
    );

    process.env.WEEKLY_TUNE_NETWORK_ID = "weekly-network";
    process.env.WEEKLY_TUNE_API_KEY = "weekly-key";
    process.env.WEEKLY_TUNE_API_BASE_URL = "https://weekly-tune.example.test/Apiv3/json";
    let expectedPeriodEnd = "2026-07-23";
    let payout = "450";
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.get("data_start"), "2026-07-20");
      assert.equal(url.searchParams.get("data_end"), expectedPeriodEnd);
      assert.equal(url.searchParams.get("filters[Affiliate.id][values][0]"), "77");
      return Response.json({ response: { status: 1, data: [{ Stat: { payout } }] } });
    };

    const store = await import("./store");
    await store.initializeStore();
    const snapshot = await store.syncRevenue({ partnerId: "rule-weekly", periodPreset: "this-week" });
    assert.equal(snapshot.invoices.length, 0);
    assert.deepEqual(snapshot.revenueRuns.map((run) => run.id), ["revenue-rule-weekly-2026-07-20-2026-07-23"]);
    assert.equal(snapshot.revenueAccruals.length, 1);
    assert.equal(snapshot.revenueAccruals[0]?.periodEnd, "2026-07-26");
    assert.equal(snapshot.revenueAccruals[0]?.accruedThrough, "2026-07-23");
    assert.equal(snapshot.revenueAccruals[0]?.amount, 450);
    await assert.rejects(store.draftRevenueRun(snapshot.revenueRuns[0].id), /not a closed billing period/);

    expectedPeriodEnd = "2026-07-22";
    payout = "300";
    const staleSnapshot = await store.syncRevenue({
      partnerId: "rule-weekly",
      periodPreset: "custom",
      periodStart: "2026-07-20",
      periodEnd: "2026-07-22",
      timezone: "UTC"
    });
    assert.deepEqual(staleSnapshot.revenueRuns.map((run) => run.id), ["revenue-rule-weekly-2026-07-20-2026-07-23"]);
    assert.equal(staleSnapshot.revenueAccruals[0]?.amount, 450);
    assert.equal(staleSnapshot.revenueAccruals[0]?.accruedThrough, "2026-07-23");
  } finally {
    context.mock.timers.reset();
    process.chdir(previousDirectory);
    globalThis.fetch = previousFetch;
    if (previousNetworkId === undefined) delete process.env.WEEKLY_TUNE_NETWORK_ID;
    else process.env.WEEKLY_TUNE_NETWORK_ID = previousNetworkId;
    if (previousApiKey === undefined) delete process.env.WEEKLY_TUNE_API_KEY;
    else process.env.WEEKLY_TUNE_API_KEY = previousApiKey;
    if (previousBaseUrl === undefined) delete process.env.WEEKLY_TUNE_API_BASE_URL;
    else process.env.WEEKLY_TUNE_API_BASE_URL = previousBaseUrl;
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});
