import assert from "node:assert/strict";
import test from "node:test";
import type { Invoice } from "../shared/types";
import {
  createMeritInvoice,
  deliverMeritInvoice,
  fetchCoinbaseUsdRates,
  fetchMeritInvoices
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

test("Coinbase USD adapter inverts one USD-base response for EUR, GBP, and crypto", async () => {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.origin, "https://api.coinbase.com");
      assert.equal(url.pathname, "/v2/exchange-rates");
      assert.equal(url.searchParams.get("currency"), "USD");
      assert.equal(new Headers(init?.headers).get("Accept"), "application/json");
      return Response.json({ data: { currency: "USD", rates: { EUR: "0.8", GBP: "0.5", BTC: "0.00001" } } });
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
