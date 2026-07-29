import assert from "node:assert/strict";
import test from "node:test";
import type { WorkerEnv } from "../worker-configuration";
import type { Invoice, Transaction } from "../shared/types";
import { createAuthSessionToken } from "./auth";
import worker, {
  createMeritInvoice,
  deliverMeritInvoice,
  fetchCoinbaseUsdRates,
  fetchMeritCustomers,
  fetchMeritInvoiceCopyDetails,
  fetchMeritInvoiceTaxSample,
  fetchMeritVendors,
  mergeInvoices,
  retainPersistedTransactions,
  retainCurrentSlashTransactions,
  transactionsForDashboardStorage
} from "./index";

const workerTestAuth = {
  AUTH_USERNAME: "finance-test",
  AUTH_PASSWORD_HASH:
    "pbkdf2-sha256$100000$MDEyMzQ1Njc4OWFiY2RlZg$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  AUTH_SESSION_SECRET: "worker-test-session-secret"
};

async function authenticatedRequest(url: string): Promise<Request> {
  const token = await createAuthSessionToken(workerTestAuth.AUTH_SESSION_SECRET);
  return new Request(url, {
    headers: { Cookie: `__Host-finance_session=${token}` }
  });
}

function authenticatedEnv(values: Record<string, unknown>): WorkerEnv {
  return { ...workerTestAuth, ...values } as never;
}

test("public app metadata reaches static assets without a session", async () => {
  const assetRequests: string[] = [];
  const env = authenticatedEnv({
    ASSETS: {
      async fetch(request: Request) {
        const pathname = new URL(request.url).pathname;
        assetRequests.push(pathname);
        return new Response(pathname, { headers: { "Content-Type": "application/octet-stream" } });
      }
    }
  });

  const manifestResponse = await worker.fetch(
    new Request("https://finance.example/site.webmanifest?v=20260729-2"),
    env
  );
  assert.equal(manifestResponse.status, 200);
  assert.equal(await manifestResponse.text(), "/site.webmanifest");

  const iconResponse = await worker.fetch(
    new Request("https://finance.example/apple-touch-icon.png?v=20260729-2"),
    env
  );
  assert.equal(iconResponse.status, 200);
  assert.equal(await iconResponse.text(), "/apple-touch-icon.png");

  const privateAssetResponse = await worker.fetch(
    new Request("https://finance.example/assets/dashboard.js"),
    env
  );
  assert.equal(privateAssetResponse.status, 303);
  assert.deepEqual(assetRequests, ["/site.webmanifest", "/apple-touch-icon.png"]);
});

test("dashboard API fails closed when Convex storage is not configured", async () => {
  let assetRequests = 0;
  const response = await worker.fetch(
    await authenticatedRequest("https://finance.example/api/dashboard"),
    authenticatedEnv({
      ASSETS: {
        async fetch() {
          assetRequests += 1;
          return new Response("asset");
        }
      }
    })
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { message: "Dashboard storage is not configured" });
  assert.equal(assetRequests, 0);
});

test("dashboard API fails closed when Convex authentication is not configured", async () => {
  const response = await worker.fetch(
    await authenticatedRequest("https://finance.example/api/dashboard"),
    authenticatedEnv({
      ASSETS: { fetch: async () => new Response("asset") },
      CONVEX_URL: "https://example.convex.cloud"
    })
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { message: "Dashboard storage authentication is not configured" });
});

test("dashboard API rejects incomplete Revolut date ranges before reading storage", async () => {
  const response = await worker.fetch(
    await authenticatedRequest("https://finance.example/api/dashboard?revolutFromDate=2026-06-01"),
    authenticatedEnv({ ASSETS: { fetch: async () => new Response("asset") } })
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    message: "Revolut transaction loading requires both a from date and a to date"
  });
});

test("management report API fails closed when Convex storage is not configured", async () => {
  const response = await worker.fetch(
    await authenticatedRequest("https://finance.example/api/management-report"),
    authenticatedEnv({ ASSETS: { fetch: async () => new Response("asset") } })
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { message: "Dashboard storage is not configured" });
});

test("Merit invoice creation never calls the API while writes are disabled", async () => {
  const originalFetch = globalThis.fetch;
  let meritRequests = 0;
  globalThis.fetch = async () => {
    meritRequests += 1;
    return new Response("unexpected");
  };

  try {
    await assert.rejects(
      () =>
        createMeritInvoice(
          {
            MERIT_API_ID: "api-id",
            MERIT_API_KEY: "api-key",
            MERIT_WRITES_ENABLED: "false"
          } as never,
          {
            documentType: "sales_invoice",
            customerName: "Safety test",
            amount: 100,
            currency: "USD",
            dueDate: "2026-07-31",
            description: "This request must never leave the Worker"
          },
          { id: "tax-id", code: "VAT0", name: "Zero VAT", taxPct: 0 },
          "2026/1304"
        ),
      /disabled by the deployment safety switch/
    );
    assert.equal(meritRequests, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Merit invoice creation uses the explicitly selected tax", async () => {
  const originalFetch = globalThis.fetch;
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({ InvoiceId: "invoice-123" });
  };

  try {
    const invoice = await createMeritInvoice(
      {
        MERIT_API_ID: "api-id",
        MERIT_API_KEY: "api-key",
        MERIT_WRITES_ENABLED: "true"
      } as never,
      {
        documentType: "sales_invoice",
        customerName: "Tax test",
        amount: 125.5,
        currency: "USD",
        dueDate: "2026-07-31",
        description: "Verify selected tax payload",
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31"
      },
      { id: "tax-20", code: "VAT20", name: "VAT 20%", taxPct: 20 },
      "2026/1304"
    );

    assert.equal(invoice.externalId, "invoice-123");
    assert.equal(requestBody?.InvoiceNo, "2026/1304");
    const rows = requestBody?.InvoiceRow as Array<{ TaxId: string; Item: { Code: string; Description: string } }>;
    const taxes = requestBody?.TaxAmount as Array<{ TaxId: string; Amount: number }>;
    assert.equal(rows[0]?.TaxId, "tax-20");
    assert.equal(rows[0]?.Item.Code, "SERVICES-VAT20");
    assert.equal(
      rows[0]?.Item.Description,
      "Verify selected tax payload (Period: 2026-07-01 - 2026-07-31)"
    );
    assert.deepEqual(taxes, [{ TaxId: "tax-20", Amount: 25.1 }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Merit invoice creation rejects dashboard-only invoice number formats", async () => {
  const originalFetch = globalThis.fetch;
  let meritRequests = 0;
  globalThis.fetch = async () => {
    meritRequests += 1;
    return Response.json({ InvoiceId: "unexpected" });
  };

  try {
    await assert.rejects(
      createMeritInvoice(
        { MERIT_API_ID: "api-id", MERIT_API_KEY: "api-key", MERIT_WRITES_ENABLED: "true" } as never,
        {
          documentType: "sales_invoice",
          customerName: "Number test",
          amount: 100,
          currency: "USD",
          issueDate: "2026-07-22",
          dueDate: "2026-07-31",
          description: "Invalid invoice number must not reach Merit"
        },
        { id: "tax-zero", code: "VAT0", name: "Zero", taxPct: 0 },
        "FD-OLD"
      ),
      /2026\/sequence format/
    );
    assert.equal(meritRequests, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Merit delivery uses the distinct email endpoint and never recreates the invoice", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), body: JSON.parse(String(init?.body)) as unknown });
    return Response.json({ Success: true });
  };

  try {
    await deliverMeritInvoice(
      {
        MERIT_API_ID: "api-id",
        MERIT_API_KEY: "api-key",
        MERIT_WRITES_ENABLED: "true",
        MERIT_API_BASE_URL: "https://merit.example/api",
        MERIT_DELIVER_INVOICE_PATH: "/v2/sendinvoicebyemail"
      } as never,
      "sih-123"
    );
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /\/v2\/sendinvoicebyemail\?/);
    const searchParams = new URL(requests[0].url).searchParams;
    assert.equal(searchParams.get("apiId"), "api-id");
    assert.equal(searchParams.get("ApiId"), null);
    assert.deepEqual(requests[0].body, { Id: "sih-123", DelivNote: false });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Merit company sync uses only the read-only customer and vendor list endpoints", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ path: string; body: unknown; apiId: string | null }> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({
      path: url.pathname,
      body: JSON.parse(String(init?.body)) as unknown,
      apiId: url.searchParams.get("apiId")
    });
    return url.pathname.endsWith("/v1/getcustomers")
      ? Response.json([{ CustomerId: "customer-1", Name: "Client OÜ", PaymentDeadLine: 14 }])
      : Response.json([{ VendorId: "vendor-1", Name: "Supplier OÜ", VendorType: 2 }]);
  };

  try {
    const env = {
      MERIT_API_ID: "api-id",
      MERIT_API_KEY: "api-key",
      MERIT_API_BASE_URL: "https://merit.example/api"
    } as never;
    const customers = await fetchMeritCustomers(env);
    const vendors = await fetchMeritVendors(env);

    assert.deepEqual(requests.map((request) => request.path), [
      "/api/v1/getcustomers",
      "/api/v1/getvendors"
    ]);
    assert.deepEqual(requests.map((request) => request.body), [
      { WithComments: true },
      { WithComments: true }
    ]);
    assert.deepEqual(requests.map((request) => request.apiId), ["api-id", "api-id"]);
    assert.equal(customers[0]?.meritCustomerId, "customer-1");
    assert.equal(customers[0]?.paymentTermsDays, 14);
    assert.equal(vendors[0]?.meritSupplierId, "vendor-1");
    assert.equal(vendors[0]?.meritDetails?.vendorType, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Merit tax learning reads line tax IDs from invoice details", async () => {
  const originalFetch = globalThis.fetch;
  let request: { path: string; body: unknown } | undefined;
  globalThis.fetch = async (input, init) => {
    request = {
      path: new URL(String(input)).pathname,
      body: JSON.parse(String(init?.body)) as unknown
    };
    return Response.json({ Lines: [{ TaxId: "tax-zero" }, { TaxId: "tax-zero" }] });
  };

  try {
    const invoice: Invoice = {
      id: "merit-sih-123",
      documentType: "sales_invoice",
      origin: "merit",
      customerName: "Client",
      amount: 100,
      currency: "USD",
      status: "open",
      meritDeliveryStatus: "saved",
      invoiceNumber: "2026/123",
      issueDate: "2026-07-01",
      dueDate: "2026-07-31",
      source: "merit",
      externalId: "sih-123",
      description: "Merit invoice 2026/123",
      revenueRunIds: [],
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z"
    };
    const sample = await fetchMeritInvoiceTaxSample({
      MERIT_API_ID: "api-id",
      MERIT_API_KEY: "api-key",
      MERIT_API_BASE_URL: "https://merit.example/api"
    } as never, invoice);

    assert.deepEqual(request, {
      path: "/api/v2/getinvoice",
      body: { Id: "sih-123", AddAttachment: false }
    });
    assert.deepEqual(sample.taxIds, ["tax-zero", "tax-zero"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Merit invoice duplication reads the exact single-line template without creating anything", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ path: string; body: unknown }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({
      path: new URL(String(input)).pathname,
      body: JSON.parse(String(init?.body)) as unknown
    });
    return Response.json({
      Lines: [{
        Description: "Monthly services (Period: 2026-06-01 - 2026-06-30)",
        AmountExclVat: 900,
        TaxId: "tax-zero"
      }]
    });
  };

  try {
    const details = await fetchMeritInvoiceCopyDetails(
      {
        MERIT_API_ID: "api-id",
        MERIT_API_KEY: "api-key",
        MERIT_API_BASE_URL: "https://merit.example/api"
      } as never,
      {
        id: "merit-sih-duplicate",
        documentType: "sales_invoice",
        origin: "merit",
        customerName: "Client",
        amount: 1000,
        currency: "USD",
        status: "open",
        meritDeliveryStatus: "saved",
        invoiceNumber: "2026/1304",
        issueDate: "2026-07-01",
        dueDate: "2026-07-31",
        source: "merit",
        externalId: "sih-duplicate",
        description: "Merit invoice 2026/1304",
        revenueRunIds: [],
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z"
      }
    );

    assert.deepEqual(details, {
      amount: 900,
      description: "Monthly services",
      taxId: "tax-zero",
      periodStart: "2026-06-01",
      periodEnd: "2026-06-30"
    });
    assert.deepEqual(requests, [{
      path: "/api/v2/getinvoice",
      body: { Id: "sih-duplicate", AddAttachment: false }
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Merit invoice creation sends saved provider delivery details", async () => {
  const originalFetch = globalThis.fetch;
  let customer: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { Customer?: Record<string, unknown> };
    customer = body.Customer;
    return Response.json({ SIHId: "sih-456", InvoiceNo: "FD-MANUAL" });
  };

  try {
    const created = await createMeritInvoice(
      { MERIT_API_ID: "api-id", MERIT_API_KEY: "api-key", MERIT_WRITES_ENABLED: "true" } as never,
      {
        documentType: "sales_invoice",
        customerName: "Client LLC",
        amount: 100,
        currency: "USD",
        dueDate: "2026-07-31",
        description: "Services"
      },
      { id: "tax-zero", code: "VAT0", name: "Zero", taxPct: 0 },
      "2026/1304",
      undefined,
      {
        id: "client",
        name: "Client",
        legalName: "Client LLC",
        email: "billing@client.example",
        address: "1 Main Street",
        country: "LB",
        type: "client",
        tags: [],
        aliases: [],
        source: "manual",
        createdAt: "2026-01-01T00:00:00.000Z"
      }
    );
    assert.equal(created.externalId, "sih-456");
    assert.deepEqual(customer, {
      Name: "Client LLC",
      NotTDCustomer: true,
      CountryCode: "LB",
      Email: "billing@client.example",
      Address: "1 Main Street"
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("live Merit refresh only updates the read-only Merit status for a persisted invoice", () => {
  const persisted: Invoice = {
    id: "local-invoice",
    documentType: "sales_invoice",
    origin: "manual",
    customerName: "Client LLC",
    amount: 100,
    currency: "USD",
    status: "paid",
    meritStatus: "open",
    meritDeliveryStatus: "delivery-failed",
    meritDeliveryError: "Mailbox rejected",
    invoiceNumber: "INV-100",
    issueDate: "2026-07-01",
    dueDate: "2026-07-31",
    source: "manual",
    externalId: "sih-100",
    description: "Services",
    revenueRunIds: [],
    paidAt: "2026-07-18",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z"
  };
  const live: Invoice = {
    ...persisted,
    id: "merit-sih-100",
    status: "open",
    meritStatus: "paid",
    meritDeliveryStatus: "saved",
    meritDeliveryError: undefined,
    paidAt: undefined,
    updatedAt: "2026-07-20T00:00:00.000Z"
  };

  assert.deepEqual(mergeInvoices([live], [persisted]), [{ ...persisted, meritStatus: "paid" }]);
});

test("successful Slash sync drops transactions outside the current live window", () => {
  const transaction = (id: string, source: Transaction["source"]): Transaction => ({
    id,
    source,
    accountName: "Operating",
    date: "2026-07-28",
    description: "CARD PURCHASE",
    rawName: "Example Merchant",
    counterparty: "Example Merchant",
    amount: 10,
    currency: "USD",
    direction: "out",
    status: "posted",
    category: "Card"
  });
  const wise = transaction("wise-current", "wise");
  const slashCurrent = transaction("slash-current", "slash");
  const slashStale = transaction("slash-stale", "slash");

  assert.deepEqual(
    retainCurrentSlashTransactions(
      [wise, slashCurrent, slashStale],
      [transaction("slash-current", "slash")],
      true
    ),
    [wise, slashCurrent]
  );
  assert.deepEqual(
    retainCurrentSlashTransactions([wise, slashCurrent, slashStale], [], false),
    [wise, slashCurrent, slashStale]
  );
});

test("live sync returns fresh rows without adding them to persisted dashboard state", () => {
  const transaction = (id: string, source: Transaction["source"], category = "Card"): Transaction => ({
    id,
    source,
    accountName: "Operating",
    date: "2026-07-28",
    description: "CARD PURCHASE",
    rawName: "Example Merchant",
    counterparty: "Example Merchant",
    amount: 10,
    currency: "USD",
    direction: "out",
    status: "posted",
    category
  });
  const importedWise = transaction("wise-imported", "wise", "Software");
  const editedSlash = transaction("slash-edited", "slash", "Media buying");
  const reconciled = [
    transaction("slash-fresh-1", "slash"),
    { ...editedSlash, matchedProviderId: "provider-1" },
    importedWise,
    transaction("slash-fresh-2", "slash")
  ];

  assert.deepEqual(
    retainPersistedTransactions([importedWise, editedSlash], reconciled),
    [{ ...editedSlash, matchedProviderId: "provider-1" }, importedWise]
  );
});

test("dashboard singleton persistence contains only imported Wise rows", () => {
  const transaction = (id: string, source: Transaction["source"]): Transaction => ({
    id,
    source,
    accountName: "Operating",
    date: "2026-07-28",
    description: "CARD PURCHASE",
    rawName: "Example Merchant",
    counterparty: "Example Merchant",
    amount: 10,
    currency: "USD",
    direction: "out",
    status: "posted",
    category: "Card"
  });

  assert.deepEqual(
    transactionsForDashboardStorage([
      transaction("slash-live", "slash"),
      transaction("wise-imported", "wise"),
      transaction("revolut-edited", "revolut")
    ]),
    [transaction("wise-imported", "wise")]
  );
});

test("Coinbase quote refresh loads direct USD spot prices for every tracked asset", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    const asset = url.pathname.split("/").at(-2)?.replace("-USD", "");
    assert.equal(url.pathname, `/v2/prices/${asset}-USD/spot`);
    const prices: Record<string, string> = { EUR: "1.25", GBP: "2", BTC: "100000" };
    return Response.json({ data: { amount: prices[asset ?? ""], base: asset, currency: "USD" } });
  };

  try {
    const rates = await fetchCoinbaseUsdRates(
      { COINBASE_SPOT_PRICES_URL: "https://api.coinbase.com/v2/prices" } as never,
      ["EUR", "GBP", "BTC"]
    );
    assert.deepEqual(rates.map((rate) => [rate.asset, rate.rateUsd]), [["EUR", 1.25], ["GBP", 2], ["BTC", 100000]]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Coinbase quote refresh keeps successful spot prices when one asset is unavailable", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    return url.pathname.includes("/BTC-USD/")
      ? new Response("unavailable", { status: 503, statusText: "Unavailable" })
      : Response.json({ data: { amount: "1.25", base: "EUR", currency: "USD" } });
  };

  try {
    const rates = await fetchCoinbaseUsdRates(
      { COINBASE_SPOT_PRICES_URL: "https://api.coinbase.com/v2/prices" } as never,
      ["EUR", "BTC"]
    );
    assert.deepEqual(rates.map((rate) => [rate.asset, rate.rateUsd]), [["EUR", 1.25]]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scheduled handler ignores the non-09:00 Lebanon cron occurrence", async () => {
  await worker.scheduled?.(
    { scheduledTime: Date.parse("2026-07-20T07:00:00.000Z"), cron: "0 6,7 * * 1", noRetry() {} },
    { ASSETS: { fetch: async () => new Response("asset") } } as never
  );
});

test("hourly scheduled handler retries missed income automation after the Monday release time", async () => {
  const originalConsoleError = console.error;
  const events: string[] = [];
  console.error = (message?: unknown) => {
    events.push(String(message));
  };

  try {
    await assert.rejects(
      worker.scheduled(
        {
          cron: "17 * * * *",
          scheduledTime: new Date("2026-07-28T00:17:00.000Z").getTime(),
          noRetry() {}
        },
        {} as never
      ),
      /Dashboard storage is not configured/
    );
    assert.equal(events.some((event) => event.includes("\"event\":\"fx_rate_refresh_failed\"")), true);
    assert.equal(events.some((event) => event.includes("\"event\":\"income_automation_failed\"")), true);
  } finally {
    console.error = originalConsoleError;
  }
});
