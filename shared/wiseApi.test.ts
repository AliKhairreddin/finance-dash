import assert from "node:assert/strict";
import test from "node:test";
import { fetchWiseActivityForAccessibleBusinesses } from "./wiseApi";

test("discovers and labels balances across every accessible Wise business profile", async () => {
  const requestedUrls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    requestedUrls.push(url);

    if (url.endsWith("/v2/profiles")) {
      return Response.json([
        { id: 11, type: "BUSINESS", details: { name: "Lovemedo" } },
        { id: 22, type: "BUSINESS", details: { name: "Digital Nudge" } },
        { id: 33, type: "PERSONAL", details: {} }
      ]);
    }
    if (url.includes("/v4/profiles/11/balances")) {
      return Response.json([
        { id: 1101, currency: "USD", amount: { value: 125, currency: "USD" }, modificationTime: "2026-07-21T12:00:00Z" }
      ]);
    }
    if (url.includes("/v4/profiles/22/balances")) {
      return Response.json([
        { id: 2201, currency: "USD", amount: { value: 250, currency: "USD" }, modificationTime: "2026-07-22T12:00:00Z" },
        { id: 2202, currency: "EUR", amount: { value: 50, currency: "EUR" }, modificationTime: "2026-07-22T12:00:00Z" }
      ]);
    }
    if (url.includes("/v1/profiles/11/balance-statements/1101/")) {
      return new Response("not permitted", { status: 403, statusText: "Forbidden" });
    }
    if (url.includes("/v1/profiles/22/balance-statements/2201/")) {
      return Response.json({
        transactions: [
          {
            date: "2026-07-22T08:00:00Z",
            type: "CARD",
            details: { recipientName: "Acme", description: "Subscription", referenceNumber: "ref-1" },
            amount: { value: -20, currency: "USD" }
          }
        ]
      });
    }
    if (url.includes("/v1/profiles/22/balance-statements/2202/")) {
      return Response.json({ transactions: [] });
    }
    return new Response("not found", { status: 404, statusText: "Not Found" });
  };

  const result = await fetchWiseActivityForAccessibleBusinesses({
    baseUrl: "https://api.wise.test",
    token: "test-token",
    fetcher
  });

  assert.deepEqual(
    result.accounts.map(({ id, name, balance, currency }) => ({ id, name, balance, currency })),
    [
      { id: "wise-11-1101", name: "Lovemedo · Wise USD", balance: 125, currency: "USD" },
      { id: "wise-22-2201", name: "Digital Nudge · Wise USD", balance: 250, currency: "USD" },
      { id: "wise-22-2202", name: "Digital Nudge · Wise EUR", balance: 50, currency: "EUR" }
    ]
  );
  assert.equal(result.transactions.length, 1);
  assert.equal(result.transactions[0].id, "wise-22-2201-ref-1");
  assert.equal(result.transactions[0].accountName, "Digital Nudge · Wise USD");
  assert.equal(result.statementIssues.length, 1);
  assert.match(result.statementIssues[0], /denied live statement API access/);
  assert.equal(requestedUrls.some((url) => url.includes("/profiles/33/balances")), false);
});
