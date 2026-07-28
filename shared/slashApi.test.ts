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
          balances: ["debit"]
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
          balances: ["debit"]
        }],
        metadata: { count: 1 }
      });
    }
    if (url.pathname === "/account/account-debit/balance") {
      return Response.json({
        balances: [{
          accountId: "account-debit",
          type: "debit",
          available: { amountCents: 125_000 },
          posted: { amountCents: 120_000 },
          timestamp: "2026-07-28T12:00:00.000Z"
        }]
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
    balance: 1250,
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
  assert.equal(
    requests.every((request) => request.headers.get("User-Agent") === "finance-dash/1.0 (+https://finance.thatcanadian.dev)"),
    true
  );
  assert.equal(requests.some((request) => request.url.pathname === "/account/account-debit/balance"), true);
  assert.equal(requests.some((request) => request.url.pathname === "/account/account-closed/balance"), false);
});

test("Slash charge-card accounts use the available credit balance", async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/account") {
      return Response.json({
        items: [{
          id: "account-platinum",
          name: "Business Platinum",
          status: "open",
          type: "charge_card",
          balances: ["cash", "credit"]
        }],
        metadata: {}
      });
    }
    if (url.pathname === "/account/account-platinum/balance") {
      return Response.json({
        balances: [
          {
            accountId: "account-platinum",
            type: "credit",
            available: { amountCents: 6_655_198 },
            posted: { amountCents: 7_066_898 },
            timestamp: "2026-07-28T22:31:42.052Z"
          },
          {
            accountId: "account-platinum",
            type: "cash",
            available: { amountCents: 0 },
            posted: { amountCents: 0 },
            timestamp: "2026-07-28T22:31:42.058Z"
          }
        ]
      });
    }

    assert.equal(url.pathname, "/transaction");
    return Response.json({ items: [], metadata: {} });
  };

  const result = await fetchSlashActivityForLegalEntity({
    baseUrl: "https://api.slash.test",
    apiKey: "slash-key",
    legalEntityId: "legal-entity-1",
    fetcher
  });

  assert.deepEqual(result.accounts, [{
    id: "slash-account-platinum",
    name: "Business Platinum",
    source: "slash",
    balance: 66_551.98,
    currency: "USD",
    updatedAt: "2026-07-28T22:31:42.052Z",
    status: "live"
  }]);
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

test("Slash activity stops after the latest 500 transactions", async () => {
  let transactionRequests = 0;
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/account") {
      return Response.json({
        items: [{
          id: "account-debit",
          name: "Operating",
          status: "open",
          type: "debit",
          balances: ["debit"]
        }],
        metadata: {}
      });
    }
    if (url.pathname === "/account/account-debit/balance") {
      return Response.json({
        balances: [{
          accountId: "account-debit",
          type: "debit",
          available: { amountCents: 125_000 },
          posted: { amountCents: 120_000 },
          timestamp: "2026-07-28T12:00:00.000Z"
        }]
      });
    }

    assert.equal(url.pathname, "/transaction");
    transactionRequests += 1;
    const page = Number(url.searchParams.get("cursor") ?? "1");
    return Response.json({
      items: Array.from({ length: 100 }, (_, index) => ({
        id: `transaction-${page}-${index}`,
        date: "2026-07-28T09:30:00.000Z",
        description: "CARD PURCHASE",
        amountCents: -100,
        accountId: "account-debit",
        status: "posted"
      })),
      metadata: { nextCursor: String(page + 1) }
    });
  };

  const result = await fetchSlashActivityForLegalEntity({
    baseUrl: "https://api.slash.test",
    apiKey: "slash-key",
    legalEntityId: "legal-entity-1",
    fetcher
  });

  assert.equal(result.transactions.length, 500);
  assert.equal(transactionRequests, 5);
  assert.equal(result.transactions.at(-1)?.id, "slash-transaction-5-99");
});
