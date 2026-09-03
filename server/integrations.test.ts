import assert from "node:assert/strict";
import test from "node:test";
import type { Invoice } from "../shared/types";
import {
  createMeritInvoice,
  deliverMeritInvoice,
  fetchCoinbaseUsdRates,
  fetchMeritInvoicePdf,
  fetchMeritInvoices,
  getIntegrationStatus
} from "./integrations";

const invoice: Invoice = {
  id: "invoice-1",
  documentType: "sales_invoice",
  origin: "manual",
  customerName: "Client Co",
  amount: 1250,
  currency: "USD",
  status: "draft",
  meritDeliveryStatus: "not-sent",
  invoiceNumber: "2026/1304",
  issueDate: "2026-07-20",
  dueDate: "2026-08-03",
  source: "manual",
  description: "Consulting services",
  revenueRunIds: [],
  periodStart: "2026-07-01",
  periodEnd: "2026-07-31",
  createdAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z"
};

test("configured Wise reports automatic balance and transaction sync", () => {
  const previousToken = process.env.WISE_API_TOKEN;
  const previousProfileIds = process.env.WISE_PROFILE_IDS;
  try {
    process.env.WISE_API_TOKEN = "wise-token";
    process.env.WISE_PROFILE_IDS = "11,22";

    const wise = getIntegrationStatus().find((integration) => integration.id === "wise");

    assert.equal(wise?.configured, true);
    assert.equal(wise?.mode, "live");
    assert.equal(wise?.issue, undefined);
    assert.equal(
      wise?.message,
      "Balances and transactions are saved in Convex and refreshed incrementally every 5 minutes or on Sync."
    );
  } finally {
    if (previousToken === undefined) delete process.env.WISE_API_TOKEN;
    else process.env.WISE_API_TOKEN = previousToken;
    if (previousProfileIds === undefined) delete process.env.WISE_PROFILE_IDS;
    else process.env.WISE_PROFILE_IDS = previousProfileIds;
  }
});

test("Wise remains partial when the balance sync itself fails", () => {
  const previousToken = process.env.WISE_API_TOKEN;
  const previousProfileIds = process.env.WISE_PROFILE_IDS;
  try {
    process.env.WISE_API_TOKEN = "wise-token";
    process.env.WISE_PROFILE_IDS = "11,22";
    const balanceIssue = "Wise balance sync failed: upstream unavailable";

    const wise = getIntegrationStatus(balanceIssue).find((integration) => integration.id === "wise");

    assert.equal(wise?.mode, "partial");
    assert.equal(wise?.issue, balanceIssue);
    assert.equal(wise?.message, balanceIssue);
  } finally {
    if (previousToken === undefined) delete process.env.WISE_API_TOKEN;
    else process.env.WISE_API_TOKEN = previousToken;
    if (previousProfileIds === undefined) delete process.env.WISE_PROFILE_IDS;
    else process.env.WISE_PROFILE_IDS = previousProfileIds;
  }
});

test("Merit creation and delivery use distinct endpoints and payloads", async () => {
  const previousFetch = globalThis.fetch;
  const previousWriteSwitch = process.env.MERIT_WRITES_ENABLED;
  const previousApiId = process.env.MERIT_API_ID;
  const previousApiKey = process.env.MERIT_API_KEY;
  const requests: Array<{ path: string; body: Record<string, unknown>; apiId: string | null; legacyApiId: string | null }> = [];
  try {
    process.env.MERIT_WRITES_ENABLED = "true";
    process.env.MERIT_API_ID = "api-id";
    process.env.MERIT_API_KEY = "api-key";
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      const path = url.pathname;
      requests.push({
        path,
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        apiId: url.searchParams.get("apiId"),
        legacyApiId: url.searchParams.get("ApiId")
      });
      return path.endsWith("/v2/sendinvoice")
        ? Response.json({ InvoiceId: "merit-id", InvoiceNo: "M-100" })
        : Response.json({ ok: true });
    };

    const created = await createMeritInvoice(
      invoice,
      { id: "tax", code: "VAT0", name: "Zero", taxPct: 0 },
      {
        itemCode: "REV-USD",
        provider: {
          id: "provider-1",
          name: "Client Co",
          type: "client",
          tags: [],
          aliases: [],
          email: "billing@example.com",
          source: "manual",
          createdAt: "2026-07-01T00:00:00.000Z"
        }
      }
    );
    await deliverMeritInvoice(created.externalId);

    assert.equal(requests[0]?.path.endsWith("/v2/sendinvoice"), true);
    assert.equal(requests[0]?.apiId, "api-id");
    assert.equal(requests[0]?.legacyApiId, null);
    assert.equal(requests[0]?.body.InvoiceNo, invoice.invoiceNumber);
    assert.equal((requests[0]?.body.InvoiceRow as Array<{ Item: { Code: string } }>)[0]?.Item.Code, "REV-USD");
    assert.equal(
      (requests[0]?.body.InvoiceRow as Array<{ Item: { Description: string } }>)[0]?.Item.Description,
      "Consulting services (Period: 2026-07-01 - 2026-07-31)"
    );
    assert.equal((requests[0]?.body.Customer as { Email?: string }).Email, "billing@example.com");
    assert.equal(requests[1]?.path.endsWith("/v2/sendinvoicebyemail"), true);
    assert.equal(requests[1]?.apiId, "api-id");
    assert.equal(requests[1]?.legacyApiId, null);
    assert.deepEqual(requests[1]?.body, { Id: "merit-id", DelivNote: false });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWriteSwitch === undefined) delete process.env.MERIT_WRITES_ENABLED;
    else process.env.MERIT_WRITES_ENABLED = previousWriteSwitch;
    if (previousApiId === undefined) delete process.env.MERIT_API_ID;
    else process.env.MERIT_API_ID = previousApiId;
    if (previousApiKey === undefined) delete process.env.MERIT_API_KEY;
    else process.env.MERIT_API_KEY = previousApiKey;
  }
});

test("Merit paid state is exposed read-only and never marks a local invoice paid", async () => {
  const previousFetch = globalThis.fetch;
  const previousApiId = process.env.MERIT_API_ID;
  const previousApiKey = process.env.MERIT_API_KEY;
  try {
    process.env.MERIT_API_ID = "api-id";
    process.env.MERIT_API_KEY = "api-key";
    globalThis.fetch = async () =>
      Response.json([
        {
          SIHId: "merit-paid",
          InvoiceNo: "M-PAID",
          CustomerName: "Client Co",
          DocumentDate: "20260701",
          DueDate: "20260715",
          CurrencyCode: "USD",
          TotalAmount: 100,
          Paid: true
        }
      ]);
    const rows = await fetchMeritInvoices();
    assert.equal(rows[0]?.status, "open");
    assert.equal(rows[0]?.meritStatus, "paid");
    assert.equal(rows[0]?.issueDate, "2026-07-01");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousApiId === undefined) delete process.env.MERIT_API_ID;
    else process.env.MERIT_API_ID = previousApiId;
    if (previousApiKey === undefined) delete process.env.MERIT_API_KEY;
    else process.env.MERIT_API_KEY = previousApiKey;
  }
});

test("Merit invoice PDF download uses the dedicated PDF endpoint", async () => {
  const previousFetch = globalThis.fetch;
  const previousApiId = process.env.MERIT_API_ID;
  const previousApiKey = process.env.MERIT_API_KEY;
  let request: { path: string; body: unknown } | undefined;
  try {
    process.env.MERIT_API_ID = "api-id";
    process.env.MERIT_API_KEY = "api-key";
    globalThis.fetch = async (input, init) => {
      request = {
        path: new URL(String(input)).pathname,
        body: JSON.parse(String(init?.body)) as unknown
      };
      return Response.json({
        FileName: "original.pdf",
        FileContent: Buffer.from("%PDF-1.7\ninvoice", "utf8").toString("base64")
      });
    };

    const bytes = await fetchMeritInvoicePdf("merit-invoice-id");

    assert.equal(new TextDecoder().decode(bytes), "%PDF-1.7\ninvoice");
    assert.deepEqual(request, {
      path: "/api/v2/getsalesinvpdf",
      body: { Id: "merit-invoice-id", DelivNote: false }
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousApiId === undefined) delete process.env.MERIT_API_ID;
    else process.env.MERIT_API_ID = previousApiId;
    if (previousApiKey === undefined) delete process.env.MERIT_API_KEY;
    else process.env.MERIT_API_KEY = previousApiKey;
  }
});

test("Coinbase USD adapter loads direct spot prices for fiat and crypto", async () => {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.origin, "https://api.coinbase.com");
      const asset = url.pathname.split("/").at(-2)?.replace("-USD", "");
      assert.equal(url.pathname, `/v2/prices/${asset}-USD/spot`);
      assert.equal(new Headers(init?.headers).get("Accept"), "application/json");
      const prices: Record<string, string> = { EUR: "1.25", GBP: "2", BTC: "100000" };
      return asset === "ETH"
        ? new Response("unsupported", { status: 404, statusText: "Not Found" })
        : Response.json({ data: { amount: prices[asset ?? ""], base: asset, currency: "USD" } });
    };
    const rates = await fetchCoinbaseUsdRates(["eur", "GBP", "BTC", "ETH", "USD"]);
    assert.deepEqual(
      rates.map((rate) => [rate.asset, rate.rateUsd]),
      [["EUR", 1.25], ["GBP", 2], ["BTC", 100000]]
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Coinbase USD adapter errors when the feed request fails", async () => {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("rate limited", { status: 429, statusText: "Too Many Requests" });
    await assert.rejects(
      fetchCoinbaseUsdRates(["EUR"]),
      /429 Too Many Requests/
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});
