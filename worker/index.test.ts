import assert from "node:assert/strict";
import test from "node:test";
import worker, { createMeritInvoice } from "./index";

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
            MERIT_DEFAULT_TAX_ID: "tax-id",
            MERIT_WRITES_ENABLED: "false"
          } as never,
          {
            documentType: "sales_invoice",
            customerName: "Safety test",
            amount: 100,
            currency: "USD",
            dueDate: "2026-07-31",
            description: "This request must never leave the Worker"
          }
        ),
      /disabled by the deployment safety switch/
    );
    assert.equal(meritRequests, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
