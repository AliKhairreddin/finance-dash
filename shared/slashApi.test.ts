import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchSlashActivityBatch,
  fetchSlashActivityForLegalEntity,
  fetchSlashTransactionForLegalEntity,
  parseSlashTransactionDateRange
} from "./slashApi";
import { bankProviderTransactionId } from "./providerIdentity";

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
          accountId: "underlying-debit",
          type: "debit",
          available: { amountCents: 125_000 },
          posted: { amountCents: 120_000 },
          timestamp: "2026-07-28T12:00:00.000Z"
        }]
      });
    }
    if (url.pathname === "/card/card-primary") {
      return Response.json({ id: "card-primary", last4: "8744" });
    }
    if (url.pathname === "/transaction" && !cursor) {
      return Response.json({
        items: [
          {
            id: "transaction-card",
            date: "2026-07-27T17:00:00.000Z",
            description: "CARD PURCHASE",
            amountCents: -12_345,
            accountId: "underlying-debit",
            accountSubtype: "cash",
            cardId: "card-primary",
            status: "posted",
            cashbackInfo: {
              amountCents: 185,
              rate: 1.5
            },
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
            accountId: "underlying-debit",
            accountSubtype: "cash",
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
        accountSubtype: "cash",
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
    id: "slash-underlying-debit-cash",
    name: "Operating Cash",
    source: "slash",
    slashAccountSubtype: "cash",
    balance: 1250,
    currency: "USD",
    updatedAt: "2026-07-28T12:00:00.000Z",
    status: "live"
  }]);
  assert.deepEqual(result.transactions, [
    {
      id: bankProviderTransactionId("slash", ["underlying-debit", "transaction-card"]),
      providerLegacyId: "slash-transaction-card",
      source: "slash",
      slashAccountSubtype: "cash",
      accountId: "slash-underlying-debit-cash",
      accountName: "Operating",
      date: "2026-07-27",
      description: "CARD PURCHASE",
      rawName: "Example Merchant",
      counterparty: "Example Merchant",
      cardId: "card-primary",
      cardLastFour: "8744",
      cardMetadataVersion: 1,
      amount: 123.45,
      currency: "USD",
      cashback: {
        amount: 1.85,
        rate: 1.5
      },
      direction: "out",
      status: "posted",
      category: "Slash"
    },
    {
      id: bankProviderTransactionId("slash", ["underlying-debit", "transaction-failed"]),
      providerLegacyId: "slash-transaction-failed",
      source: "slash",
      slashAccountSubtype: "cash",
      accountId: "slash-underlying-debit-cash",
      accountName: "Operating",
      date: "2026-07-27",
      description: "FAILED PAYMENT",
      rawName: "FAILED PAYMENT",
      counterparty: "FAILED PAYMENT",
      cardMetadataVersion: 1,
      amount: 10,
      currency: "USD",
      direction: "out",
      status: "voided",
      category: "Slash",
      classificationComplete: true
    },
    {
      id: bankProviderTransactionId("slash", ["underlying-debit", "transaction-credit"]),
      providerLegacyId: "slash-transaction-credit",
      source: "slash",
      slashAccountSubtype: "cash",
      accountId: "slash-underlying-debit-cash",
      accountName: "Operating",
      date: "2026-07-28",
      description: "CASHBACK",
      rawName: "CASHBACK",
      counterparty: "CASHBACK",
      cardMetadataVersion: 1,
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
  assert.equal(requests.some((request) => request.url.pathname === "/card/card-primary"), true);
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
            accountId: "underlying-platinum",
            type: "credit",
            available: { amountCents: 6_655_198 },
            posted: { amountCents: 7_066_898 },
            timestamp: "2026-07-28T22:31:42.052Z"
          },
          {
            accountId: "underlying-platinum",
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

  assert.deepEqual(result.accounts, [
    {
      id: "slash-underlying-platinum-cash",
      name: "Business Platinum Cash",
      source: "slash",
      slashAccountSubtype: "cash",
      balance: 0,
      currency: "USD",
      updatedAt: "2026-07-28T22:31:42.058Z",
      status: "live"
    },
    {
      id: "slash-underlying-platinum-credit",
      name: "Business Platinum Credit",
      source: "slash",
      slashAccountSubtype: "credit",
      balance: 66_551.98,
      currency: "USD",
      updatedAt: "2026-07-28T22:31:42.052Z",
      status: "live"
    }
  ]);
});

test("Slash rejects card transactions whose card identity cannot be resolved", async () => {
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
          available: { amountCents: 100_000 },
          posted: { amountCents: 100_000 },
          timestamp: "2026-07-28T12:00:00.000Z"
        }]
      });
    }
    if (url.pathname === "/card/card-missing") {
      return new Response("not found", { status: 404, statusText: "Not Found" });
    }
    assert.equal(url.pathname, "/transaction");
    return Response.json({
      items: [{
        id: "transaction-card",
        date: "2026-07-27T17:00:00.000Z",
        description: "CARD PURCHASE",
        amountCents: -100,
        accountId: "account-debit",
        accountSubtype: "cash",
        cardId: "card-missing",
        status: "posted"
      }],
      metadata: {}
    });
  };

  await assert.rejects(
    fetchSlashActivityForLegalEntity({
      baseUrl: "https://api.slash.test",
      apiKey: "slash-key",
      legalEntityId: "legal-entity-1",
      fetcher
    }),
    /404 Not Found/
  );
});

test("Slash can load one transaction by ID without scanning the activity window", async () => {
  const requests: URL[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push(url);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("X-API-Key"), "slash-key");
    assert.equal(headers.get("x-legal-entity"), "legal-entity-1");

    if (url.pathname === "/transaction/transaction-old") {
      return Response.json({
        id: "transaction-old",
        date: "2025-01-15T09:30:00.000Z",
        description: "OLD CARD PURCHASE",
        amountCents: -12_345,
        accountId: "account-debit",
        accountSubtype: "cash",
        status: "posted",
        merchantData: { description: "Old Merchant" }
      });
    }
    assert.equal(url.pathname, "/account/account-debit");
    return Response.json({
      id: "account-debit",
      name: "Operating",
      status: "open",
      type: "debit",
      balances: ["debit"]
    });
  };

  const result = await fetchSlashTransactionForLegalEntity({
    baseUrl: "https://api.slash.test",
    apiKey: "slash-key",
    legalEntityId: "legal-entity-1",
    transactionId: "transaction-old",
    fetcher
  });

  assert.deepEqual(result, {
    id: bankProviderTransactionId("slash", ["account-debit", "transaction-old"]),
    providerLegacyId: "slash-transaction-old",
    source: "slash",
    slashAccountSubtype: "cash",
    accountId: "slash-account-debit-cash",
    accountName: "Operating",
    date: "2025-01-15",
    description: "OLD CARD PURCHASE",
    rawName: "Old Merchant",
    counterparty: "Old Merchant",
    cardMetadataVersion: 1,
    amount: 123.45,
    currency: "USD",
    direction: "out",
    status: "posted",
    category: "Slash"
  });
  assert.deepEqual(requests.map((url) => url.pathname), [
    "/transaction/transaction-old",
    "/account/account-debit"
  ]);
});

test("Slash single-transaction reads retain failed records as voided tombstones", async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/transaction/transaction-failed") {
      return Response.json({
        id: "transaction-failed",
        date: "2026-07-28T09:30:00.000Z",
        description: "FAILED PAYMENT",
        amountCents: -1_000,
        accountId: "account-debit",
        accountSubtype: "cash",
        status: "failed"
      });
    }
    assert.equal(url.pathname, "/account/account-debit");
    return Response.json({
      id: "account-debit",
      name: "Operating",
      status: "open",
      type: "debit",
      balances: ["debit"]
    });
  };

  const result = await fetchSlashTransactionForLegalEntity({
    baseUrl: "https://api.slash.test",
    apiKey: "slash-key",
    legalEntityId: "legal-entity-1",
    transactionId: "transaction-failed",
    fetcher
  });

  assert.equal(result.status, "voided");
  assert.equal(result.classificationComplete, true);
  assert.equal(
    result.id,
    bankProviderTransactionId("slash", ["account-debit", "transaction-failed"])
  );
});

test("Slash activity loads every page inside an exact inclusive date range", async () => {
  const transactionRequests: URL[] = [];
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
    transactionRequests.push(url);
    const page = Number(url.searchParams.get("cursor") ?? "1");
    return Response.json({
      items: Array.from({ length: 100 }, (_, index) => ({
        id: `transaction-${page}-${index}`,
        date: "2026-06-15T09:30:00.000Z",
        description: "CARD PURCHASE",
        amountCents: -100,
        accountId: "account-debit",
        accountSubtype: "cash",
        status: "posted"
      })),
      metadata: { nextCursor: page < 6 ? String(page + 1) : undefined }
    });
  };

  const result = await fetchSlashActivityForLegalEntity({
    baseUrl: "https://api.slash.test",
    apiKey: "slash-key",
    legalEntityId: "legal-entity-1",
    dateRange: { fromDate: "2026-06-01", toDate: "2026-06-30" },
    fetcher
  });

  assert.equal(result.transactions.length, 600);
  assert.equal(transactionRequests.length, 6);
  assert.equal(transactionRequests[0].searchParams.get("filter:from_date"), String(Date.parse("2026-06-01T00:00:00.000Z")));
  assert.equal(transactionRequests[0].searchParams.get("filter:to_date"), String(Date.parse("2026-06-30T23:59:59.999Z")));
  assert.equal(transactionRequests.at(-1)?.searchParams.get("cursor"), "6");
});

test("Slash date ranges require two valid ordered ISO dates", () => {
  assert.equal(parseSlashTransactionDateRange(undefined, undefined), undefined);
  assert.deepEqual(
    parseSlashTransactionDateRange("2026-06-01", "2026-06-30"),
    { fromDate: "2026-06-01", toDate: "2026-06-30" }
  );
  assert.throws(() => parseSlashTransactionDateRange("2026-06-01", undefined), /both a from date and a to date/);
  assert.throws(() => parseSlashTransactionDateRange("2026-02-30", "2026-03-01"), /not a valid date/);
  assert.throws(() => parseSlashTransactionDateRange("2026-07-01", "2026-06-30"), /on or before/);
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

test("Slash activity accepts bounded opaque provider cursors larger than 512 characters", async () => {
  const longCursor = "x".repeat(2_048);
  const transactionRequests: URL[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/account") {
      return Response.json({ items: [], metadata: {} });
    }
    transactionRequests.push(url);
    return Response.json({
      items: [],
      metadata: url.searchParams.has("cursor") ? {} : { nextCursor: longCursor }
    });
  };

  const result = await fetchSlashActivityForLegalEntity({
    baseUrl: "https://api.slash.test",
    apiKey: "slash-key",
    legalEntityId: "legal-entity-1",
    fetcher
  });

  assert.deepEqual(result.transactions, []);
  assert.equal(transactionRequests.length, 2);
  assert.equal(transactionRequests[1].searchParams.get("cursor"), longCursor);
});

test("Slash activity rejects provider cursors larger than its bounded checkpoint budget", async () => {
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname === "/account") {
      return Response.json({ items: [], metadata: {} });
    }
    return Response.json({ items: [], metadata: { nextCursor: "x".repeat(8 * 1024 + 1) } });
  };

  await assert.rejects(
    fetchSlashActivityForLegalEntity({
      baseUrl: "https://api.slash.test",
      apiKey: "slash-key",
      legalEntityId: "legal-entity-1",
      fetcher
    }),
    /nextCursor exceeds 8192 characters/
  );
});

test("Slash activity streams bounded deduplicated pages without collecting transaction objects", async () => {
  const transactionRequests: URL[] = [];
  const transaction = (id: string) => ({
    id,
    date: "2026-07-27T17:00:00.000Z",
    description: `CARD PURCHASE ${id}`,
    amountCents: -100,
    accountId: "account-debit",
    accountSubtype: "cash",
    status: "posted"
  });
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
          available: { amountCents: 100_000 },
          posted: { amountCents: 100_000 },
          timestamp: "2026-07-28T12:00:00.000Z"
        }]
      });
    }

    assert.equal(url.pathname, "/transaction");
    transactionRequests.push(url);
    const cursor = url.searchParams.get("cursor");
    if (!cursor) {
      return Response.json({
        items: [transaction("transaction-1"), transaction("transaction-2")],
        metadata: { nextCursor: "page-2" }
      });
    }
    if (cursor === "page-2") {
      return Response.json({
        items: [transaction("transaction-2"), transaction("transaction-3")],
        metadata: { nextCursor: "page-3" }
      });
    }
    assert.equal(cursor, "page-3");
    return Response.json({
      items: [transaction("transaction-3"), transaction("transaction-4")],
      metadata: {}
    });
  };
  const callbackPages: string[][] = [];

  const result = await fetchSlashActivityForLegalEntity({
    baseUrl: "https://api.slash.test",
    apiKey: "slash-key",
    legalEntityId: "legal-entity-1",
    fetcher,
    collectTransactions: false,
    onTransactionPage: async (transactions) => {
      await Promise.resolve();
      callbackPages.push(transactions.map((item) => item.id));
    }
  });

  assert.equal(transactionRequests.length, 3);
  assert.deepEqual(callbackPages.map((page) => page.length), [2, 1, 1]);
  assert.equal(Math.max(...callbackPages.map((page) => page.length)), 2);
  assert.deepEqual(callbackPages.flat(), [
    bankProviderTransactionId("slash", ["account-debit", "transaction-1"]),
    bankProviderTransactionId("slash", ["account-debit", "transaction-2"]),
    bankProviderTransactionId("slash", ["account-debit", "transaction-3"]),
    bankProviderTransactionId("slash", ["account-debit", "transaction-4"])
  ]);
  assert.equal(new Set(callbackPages.flat()).size, 4);
  assert.deepEqual(result.transactions, []);
  assert.equal(result.accounts.length, 1);
});

test("Slash sync checkpoints resume the provider cursor with a frozen bounded window", async () => {
  const transactionRequests: URL[] = [];
  const callbackPages: string[][] = [];
  const transaction = (id: string) => ({
    id,
    date: "2026-07-27T17:00:00.000Z",
    description: `CARD PURCHASE ${id}`,
    amountCents: -100,
    accountId: "account-debit",
    accountSubtype: "cash",
    status: "posted"
  });
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
          available: { amountCents: 100_000 },
          posted: { amountCents: 100_000 },
          timestamp: "2026-07-28T12:00:00.000Z"
        }]
      });
    }

    assert.equal(url.pathname, "/transaction");
    transactionRequests.push(url);
    if (!url.searchParams.get("cursor")) {
      return Response.json({
        items: [transaction("transaction-1"), transaction("transaction-2")],
        metadata: { nextCursor: "native-page-2" }
      });
    }
    assert.equal(url.searchParams.get("cursor"), "native-page-2");
    return Response.json({
      items: [transaction("transaction-3")],
      metadata: {}
    });
  };
  const common = {
    baseUrl: "https://api.slash.test",
    apiKey: "slash-key",
    legalEntityId: "legal-entity-1",
    fetcher,
    pageBudget: 1,
    collectTransactions: false,
    onTransactionPage: (transactions: import("./types").Transaction[]) => {
      callbackPages.push(transactions.map((item) => item.id));
    }
  };

  const first = await fetchSlashActivityBatch({
    ...common,
    now: Date.parse("2026-07-28T12:00:00.000Z")
  });
  assert.equal(first.complete, false);
  assert.equal(first.pagesFetched, 1);
  assert.equal(first.providerTransactionsRead, 2);
  assert.deepEqual(first.transactions, []);
  assert.ok(first.nextCheckpoint);
  assert.doesNotMatch(first.nextCheckpoint, /native|2026|cursor/);

  const second = await fetchSlashActivityBatch({
    ...common,
    checkpoint: first.nextCheckpoint,
    now: Date.parse("2027-01-01T00:00:00.000Z")
  });
  assert.equal(second.complete, true);
  assert.equal(second.nextCheckpoint, null);
  assert.equal(second.pagesFetched, 1);
  assert.equal(second.providerTransactionsRead, 1);
  assert.deepEqual(callbackPages, [
    [
      bankProviderTransactionId("slash", ["account-debit", "transaction-1"]),
      bankProviderTransactionId("slash", ["account-debit", "transaction-2"])
    ],
    [bankProviderTransactionId("slash", ["account-debit", "transaction-3"])]
  ]);
  assert.equal(
    transactionRequests[0].searchParams.get("filter:from_date"),
    String(Date.parse("2026-06-13T12:00:00.000Z"))
  );
  assert.equal(
    transactionRequests[1].searchParams.get("filter:from_date"),
    transactionRequests[0].searchParams.get("filter:from_date")
  );
  assert.equal(
    transactionRequests[1].searchParams.get("filter:to_date"),
    transactionRequests[0].searchParams.get("filter:to_date")
  );
});

test("Slash rejects malformed transaction IDs, cents, dates, statuses, and bounded text", async () => {
  const baseTransaction = {
    id: "transaction-1",
    date: "2026-07-27T17:00:00.000Z",
    description: "CARD PURCHASE",
    amountCents: -100,
    accountId: "account-debit",
    accountSubtype: "cash",
    status: "posted"
  };
  const cases: Array<{ transaction: Record<string, unknown>; expected: RegExp }> = [
    { transaction: { ...baseTransaction, id: undefined }, expected: /missing transaction\.id/ },
    {
      transaction: { ...baseTransaction, amountCents: undefined },
      expected: /missing transaction\.amountCents/
    },
    {
      transaction: { ...baseTransaction, amountCents: 1.5 },
      expected: /must be a safe integer number of cents/
    },
    {
      transaction: { ...baseTransaction, date: "2026-02-30T17:00:00.000Z" },
      expected: /date is not a valid ISO timestamp/
    },
    { transaction: { ...baseTransaction, status: "unknown" }, expected: /unsupported transaction\.status/ },
    {
      transaction: { ...baseTransaction, description: "x".repeat(1_025) },
      expected: /description exceeds 1024 characters/
    }
  ];

  for (const { transaction, expected } of cases) {
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/transaction/transaction-1") return Response.json(transaction);
      throw new Error(`Unexpected Slash request: ${url}`);
    };
    await assert.rejects(
      fetchSlashTransactionForLegalEntity({
        baseUrl: "https://api.slash.test",
        apiKey: "slash-key",
        legalEntityId: "legal-entity-1",
        transactionId: "transaction-1",
        fetcher
      }),
      expected
    );
  }
});

test("Slash rejects malformed balance cents and timestamps instead of fabricating account values", async () => {
  const baseBalance = {
    accountId: "account-debit",
    type: "debit",
    available: { amountCents: 100_000 },
    posted: { amountCents: 100_000 },
    timestamp: "2026-07-28T12:00:00.000Z"
  };
  const cases: Array<{ balance: Record<string, unknown>; expected: RegExp }> = [
    {
      balance: { ...baseBalance, available: {} },
      expected: /missing account\.balances\[0\]\.available\.amountCents/
    },
    {
      balance: { ...baseBalance, posted: { amountCents: 1.5 } },
      expected: /must be a safe integer number of cents/
    },
    {
      balance: { ...baseBalance, timestamp: "2026-02-30T12:00:00.000Z" },
      expected: /timestamp is not a valid ISO timestamp/
    }
  ];

  for (const { balance, expected } of cases) {
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
        return Response.json({ balances: [balance] });
      }
      throw new Error(`Unexpected Slash request: ${url}`);
    };
    await assert.rejects(
      fetchSlashActivityForLegalEntity({
        baseUrl: "https://api.slash.test",
        apiKey: "slash-key",
        legalEntityId: "legal-entity-1",
        fetcher
      }),
      expected
    );
  }
});
