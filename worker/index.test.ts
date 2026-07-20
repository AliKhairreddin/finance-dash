import assert from "node:assert/strict";
import test from "node:test";
import type { Invoice } from "../shared/types";
import worker, { createMeritInvoice, deliverMeritInvoice, fetchCoinbaseUsdRates, mergeInvoices } from "./index";

test("dashboard API fails closed when Convex storage is not configured", async () => {
  let assetRequests = 0;
  const response = await worker.fetch(
    new Request("https://finance.example/api/dashboard"),
    {
      ASSETS: {
        async fetch() {
          assetRequests += 1;
          return new Response("asset");
        }
      }
    } as never
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { message: "Dashboard storage is not configured" });
  assert.equal(assetRequests, 0);
});

test("dashboard API fails closed when Convex authentication is not configured", async () => {
  const response = await worker.fetch(
    new Request("https://finance.example/api/dashboard"),
    {
      ASSETS: { fetch: async () => new Response("asset") },
      CONVEX_URL: "https://example.convex.cloud"
    } as never
  );

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { message: "Dashboard storage authentication is not configured" });
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
          { id: "tax-id", code: "VAT0", name: "Zero VAT", taxPct: 0 }
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
        description: "Verify selected tax payload"
      },
      { id: "tax-20", code: "VAT20", name: "VAT 20%", taxPct: 20 }
    );

    assert.equal(invoice.externalId, "invoice-123");
    const rows = requestBody?.InvoiceRow as Array<{ TaxId: string; Item: { Code: string } }>;
    const taxes = requestBody?.TaxAmount as Array<{ TaxId: string; Amount: number }>;
    assert.equal(rows[0]?.TaxId, "tax-20");
    assert.equal(rows[0]?.Item.Code, "SERVICES-VAT20");
    assert.deepEqual(taxes, [{ TaxId: "tax-20", Amount: 25.1 }]);
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
    assert.equal(new URL(requests[0].url).searchParams.get("ApiId"), "api-id");
    assert.deepEqual(requests[0].body, { Id: "sih-123", DelivNote: false });
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

test("Coinbase quote refresh converts EUR, GBP, and BTC from one USD-base response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("currency"), "USD");
    return Response.json({ data: { currency: "USD", rates: { EUR: "0.8", GBP: "0.5", BTC: "0.00001" } } });
  };

  try {
    const rates = await fetchCoinbaseUsdRates(
      { COINBASE_EXCHANGE_RATES_URL: "https://api.coinbase.com/v2/exchange-rates" } as never,
      ["EUR", "GBP", "BTC"]
    );
    assert.deepEqual(rates.map((rate) => [rate.asset, rate.rateUsd]), [["EUR", 1.25], ["GBP", 2], ["BTC", 100000]]);
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
