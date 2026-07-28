import assert from "node:assert/strict";
import test from "node:test";
import { fetchSlashActivityForLegalEntity } from "./slashApi";

test("Slash activity uses the user-scoped entity header, paginates, and maps current response fields", async () => {
  const requests: Array<{ url: URL; headers: Headers }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, headers: new Headers(init?.headers) });
    const cursor = url.searchParams.get("cursor");

    if (url.pathname === "/account" && !cursor) {
      return Response.json({
        items: [{
          id: "account-debit",
          name: "Operating",
          status: "open",
          type: "debit",
          balances: [{
            accountId: "account-debit",
            type: "debit",
            available: { amountCents: 125_000 },
            posted: { amountCents: 120_000 },
            timestamp: "2026-07-28T12:00:00.000Z"
          }]
        }],
        metadata: { nextCursor: "accounts-next", count: 1 }
      });
    }
    if (url.pathname === "/account") {
      assert.equal(cursor, "accounts-next");
      return Response.json({
        items: [{
          id: "account-closed",
          name: "Old account",
          status: "closed",
          type: "debit",
          balances: [{
            accountId: "account-closed",
            type: "debit",
            available: { amountCents: 500 },
            posted: { amountCents: 500 },
            timestamp: "2026-07-01T12:00:00.000Z"
          }]
        }],
        metadata: { count: 1 }
      });
    }
    if (url.pathname === "/transaction" && !cursor) {
      return Response.json({
        items: [
          {
            id: "transaction-card",
            date: "2026-07-27T17:00:00.000Z",
            description: "CARD PURCHASE",
            amountCents: -12_345,
            accountId: "account-debit",
            status: "posted",
            merchantData: {
              description: "Example Merchant",
              categoryCode: "5734"
            }
          },
          {
            id: "transaction-failed",
            date: "2026-07-27T18:00:00.000Z",
            description: "FAILED PAYMENT",
            amountCents: -1_000,
            accountId: "account-debit",
            status: "failed"
          }
        ],
        metadata: { nextCursor: "transactions-next", count: 2 }
      });
    }

    assert.equal(url.pathname, "/transaction");
    assert.equal(cursor, "transactions-next");
    return Response.json({
      items: [{
        id: "transaction-credit",
        date: "2026-07-28T09:30:00.000Z",
        description: "CASHBACK",
        amountCents: 250,
        accountId: "account-debit",
        status: "pending"
      }],
      metadata: { count: 1 }
    });
  };

  const result = await fetchSlashActivityForLegalEntity({
    baseUrl: "https://api.slash.test",
    apiKey: "slash-key",
    legalEntityId: "legal-entity-1",
    fetcher,
    now: Date.parse("2026-07-28T12:00:00.000Z")
  });

  assert.deepEqual(result.accounts, [{
    id: "slash-account-debit",
    name: "Operating",
    source: "slash",
    balance: 1200,
    currency: "USD",
    updatedAt: "2026-07-28T12:00:00.000Z",
    status: "live"
  }]);
  assert.deepEqual(result.transactions, [
    {
      id: "slash-transaction-card",
      source: "slash",
      accountName: "Operating",
      date: "2026-07-27",
      description: "CARD PURCHASE",
      rawName: "Example Merchant",
      counterparty: "Example Merchant",
      amount: 123.45,
      currency: "USD",
      direction: "out",
      status: "posted",
      category: "5734"
    },
    {
      id: "slash-transaction-credit",
      source: "slash",
      accountName: "Operating",
      date: "2026-07-28",
      description: "CASHBACK",
      rawName: "CASHBACK",
      counterparty: "CASHBACK",
      amount: 2.5,
      currency: "USD",
      direction: "in",
      status: "pending",
      category: "Slash"
    }
  ]);
  assert.equal(
    requests.find((request) => request.url.pathname === "/transaction")?.url.searchParams.get("filter:from_date"),
    String(Date.parse("2026-06-13T12:00:00.000Z"))
  );
  assert.equal(requests.every((request) => request.headers.get("X-API-Key") === "slash-key"), true);
  assert.equal(requests.every((request) => request.headers.get("x-legal-entity") === "legal-entity-1"), true);
  assert.equal(requests.every((request) => request.headers.get("Accept") === "application/json"), true);
});

test("Slash activity rejects repeated pagination cursors", async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    return Response.json({
      items: [],
      metadata: { nextCursor: url.pathname === "/account" ? "same-account-cursor" : undefined }
    });
  };

  await assert.rejects(
    fetchSlashActivityForLegalEntity({
      baseUrl: "https://api.slash.test",
      apiKey: "slash-key",
      legalEntityId: "legal-entity-1",
      fetcher
    }),
    /repeated pagination cursor/
  );
});
