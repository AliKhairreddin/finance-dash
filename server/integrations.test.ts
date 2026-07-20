import assert from "node:assert/strict";
import test from "node:test";
import type { Invoice } from "../shared/types";
import {
  createMeritInvoice,
  deliverMeritInvoice,
  fetchMeritInvoices,
  fetchYahooUsdRates
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
  invoiceNumber: "FD-100",
  issueDate: "2026-07-20",
  dueDate: "2026-08-03",
  source: "manual",
  description: "Consulting services",
  revenueRunIds: [],
  createdAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z"
};

test("Merit creation and delivery use distinct endpoints and payloads", async () => {
  const previousFetch = globalThis.fetch;
  const previousWriteSwitch = process.env.MERIT_WRITES_ENABLED;
  const previousApiId = process.env.MERIT_API_ID;
  const previousApiKey = process.env.MERIT_API_KEY;
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  try {
    process.env.MERIT_WRITES_ENABLED = "true";
    process.env.MERIT_API_ID = "api-id";
    process.env.MERIT_API_KEY = "api-key";
    globalThis.fetch = async (input, init) => {
      const path = new URL(String(input)).pathname;
      requests.push({ path, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
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
    assert.equal(requests[0]?.body.InvoiceNo, invoice.invoiceNumber);
    assert.equal((requests[0]?.body.InvoiceRow as Array<{ Item: { Code: string } }>)[0]?.Item.Code, "REV-USD");
    assert.equal((requests[0]?.body.Customer as { Email?: string }).Email, "billing@example.com");
    assert.equal(requests[1]?.path.endsWith("/v2/sendinvoicebyemail"), true);
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

test("Yahoo USD adapter uses chart symbols and keeps partial successes", async () => {
  const previousFetch = globalThis.fetch;
  try {
    const requestedSymbols: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      const symbol = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
      requestedSymbols.push(symbol);
      assert.equal(url.origin, "https://query1.finance.yahoo.com");
      assert.equal(url.searchParams.get("interval"), "1d");
      assert.equal(url.searchParams.get("range"), "1d");
      assert.match(new Headers(init?.headers).get("User-Agent") ?? "", /Mozilla/);
      if (symbol === "ETH-USD") return new Response("unavailable", { status: 404, statusText: "Not Found" });
      const regularMarketPrice = symbol === "CADUSD=X" ? 0.74 : 120000;
      return Response.json({
        chart: {
          result: [{ meta: { regularMarketPrice, regularMarketTime: 1784505600 } }]
        }
      });
    };
    const rates = await fetchYahooUsdRates([
      { asset: "cad", assetType: "fiat" },
      { asset: "BTC", assetType: "crypto" },
      { asset: "ETH", assetType: "crypto" },
      { asset: "USD", assetType: "fiat" }
    ]);
    assert.deepEqual(requestedSymbols.sort(), ["BTC-USD", "CADUSD=X", "ETH-USD"]);
    assert.deepEqual(
      rates.map((rate) => [rate.asset, rate.rateUsd]),
      [
        ["CAD", 0.74],
        ["BTC", 120000]
      ]
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Yahoo USD adapter errors when every requested chart fails", async () => {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("rate limited", { status: 429, statusText: "Too Many Requests" });
    await assert.rejects(
      fetchYahooUsdRates([{ asset: "CAD", assetType: "fiat" }]),
      /did not return any requested USD rates/
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});
