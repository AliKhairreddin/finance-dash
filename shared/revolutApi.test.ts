import assert from "node:assert/strict";
import test from "node:test";
import {
  createRevolutClientAssertion,
  fetchRevolutActivity,
  fetchRevolutActivityBatch,
  parseRevolutTransactionDateRange,
  revolutReadConsentUrl
} from "./revolutApi";
import { bankProviderTransactionId } from "./providerIdentity";

function base64UrlBytes(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function rsaKeyMaterial(): Promise<{
  privateKeyPem: string;
  publicKey: CryptoKey;
}> {
  const keys = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256"
    },
    true,
    ["sign", "verify"]
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keys.privateKey));
  const base64 = Buffer.from(pkcs8).toString("base64").match(/.{1,64}/g)?.join("\n");
  return {
    privateKeyPem: `-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----`,
    publicKey: keys.publicKey
  };
}

test("Revolut client assertions use the registered issuer, client ID, and RS256 signature", async () => {
  const { privateKeyPem, publicKey } = await rsaKeyMaterial();
  const now = Date.UTC(2026, 6, 28, 18, 0, 0);
  const assertion = await createRevolutClientAssertion({
    clientId: "client-123",
    issuer: "finance.thatcanadian.dev",
    privateKeyPem,
    now
  });
  const [header, payload, signature] = assertion.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(base64UrlBytes(header)).toString("utf8")), {
    alg: "RS256",
    typ: "JWT"
  });
  assert.deepEqual(JSON.parse(Buffer.from(base64UrlBytes(payload)).toString("utf8")), {
    iss: "finance.thatcanadian.dev",
    sub: "client-123",
    aud: "https://revolut.com",
    exp: Math.floor(now / 1000) + 300
  });
  assert.equal(
    await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      publicKey,
      base64UrlBytes(signature),
      new TextEncoder().encode(`${header}.${payload}`)
    ),
    true
  );
});

test("Revolut consent URL requests read-only access", () => {
  const consentUrl = new URL(
    revolutReadConsentUrl({
      clientId: "client-123",
      redirectUri: "https://finance.thatcanadian.dev",
      environment: "production"
    })
  );
  assert.equal(consentUrl.origin, "https://business.revolut.com");
  assert.equal(consentUrl.pathname, "/app-confirm");
  assert.equal(consentUrl.searchParams.get("client_id"), "client-123");
  assert.equal(consentUrl.searchParams.get("redirect_uri"), "https://finance.thatcanadian.dev");
  assert.equal(consentUrl.searchParams.get("response_type"), "code");
  assert.equal(consentUrl.searchParams.get("scope"), "READ");
});

test("Revolut date ranges require two valid ordered ISO dates", () => {
  assert.equal(parseRevolutTransactionDateRange(undefined, undefined), undefined);
  assert.deepEqual(
    parseRevolutTransactionDateRange("2026-06-01", "2026-06-30"),
    { fromDate: "2026-06-01", toDate: "2026-06-30" }
  );
  assert.throws(
    () => parseRevolutTransactionDateRange("2026-06-01", undefined),
    /both a from date and a to date/
  );
  assert.throws(
    () => parseRevolutTransactionDateRange("2026-02-30", "2026-03-01"),
    /not a valid date/
  );
  assert.throws(
    () => parseRevolutTransactionDateRange("2026-07-01", "2026-06-30"),
    /on or before/
  );
});

test("Revolut activity signs a fresh assertion and retains terminal transactions as voided tombstones", async () => {
  const { privateKeyPem } = await rsaKeyMaterial();
  const requests: URL[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push(url);
    if (url.pathname.endsWith("/auth/token")) {
      const body = new URLSearchParams(String(init?.body));
      assert.equal(body.get("grant_type"), "refresh_token");
      assert.equal(body.get("refresh_token"), "refresh-123");
      assert.equal(body.get("client_assertion")?.split(".").length, 3);
      return Response.json({ access_token: "access-123", expires_in: 2399 });
    }
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer access-123");
    if (url.pathname.endsWith("/accounts")) {
      return Response.json([
        {
          id: "account-1",
          name: "Main GBP",
          balance: 125.5,
          currency: "GBP",
          state: "active",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-07-28T17:00:00.000Z"
        }
      ]);
    }
    assert.deepEqual(url.searchParams.getAll("state"), [
      "created",
      "pending",
      "completed",
      "declined",
      "failed",
      "reverted"
    ]);
    assert.equal(url.searchParams.get("from"), "2026-07-01T00:00:00.000Z");
    assert.equal(url.searchParams.get("to"), "2026-07-28T23:59:59.999Z");
    return Response.json([
      ...["completed", "declined", "failed", "reverted"].map((state, index) => ({
        id: `transaction-${index + 1}`,
        type: "card_payment",
        state,
        created_at: "2026-07-28T16:00:00.000Z",
        completed_at: "2026-07-28T16:01:00.000Z",
        merchant: { name: `Example Merchant ${index + 1}`, category_code: "5734" },
        card: { card_number: "**** **** **** 8744" },
        legs: [
          {
            leg_id: `leg-${index + 1}`,
            account_id: "account-1",
            amount: -24.5,
            currency: "GBP"
          }
        ]
      }))
    ]);
  };

  const result = await fetchRevolutActivity({
    environment: "production",
    clientId: "client-123",
    issuer: "finance.thatcanadian.dev",
    privateKeyPem,
    refreshToken: "refresh-123",
    dateRange: { fromDate: "2026-07-01", toDate: "2026-07-28" },
    fetcher,
    now: Date.UTC(2026, 6, 28, 18, 0, 0)
  });

  assert.equal(requests.length, 3);
  assert.deepEqual(result.accounts, [
    {
      id: "revolut-account-1",
      name: "Main GBP",
      source: "revolut",
      balance: 125.5,
      currency: "GBP",
      updatedAt: "2026-07-28T17:00:00.000Z",
      status: "live"
    }
  ]);
  assert.deepEqual(result.transactions.slice(0, 1), [
    {
      id: bankProviderTransactionId("revolut", ["transaction-1", "leg-1", "account-1"]),
      providerLegacyId: "revolut-transaction-1-leg-1-0",
      source: "revolut",
      accountId: "revolut-account-1",
      accountName: "Main GBP",
      date: "2026-07-28",
      description: "card_payment",
      rawName: "Example Merchant 1",
      counterparty: "Example Merchant 1",
      amount: 24.5,
      currency: "GBP",
      direction: "out",
      status: "posted",
      category: "Revolut",
      cardLastFour: "8744"
    }
  ]);
  assert.deepEqual(
    result.transactions.slice(1).map(({ id, status, classificationComplete }) => ({
      id,
      status,
      classificationComplete
    })),
    [
      {
        id: bankProviderTransactionId("revolut", ["transaction-2", "leg-2", "account-1"]),
        status: "voided",
        classificationComplete: true
      },
      {
        id: bankProviderTransactionId("revolut", ["transaction-3", "leg-3", "account-1"]),
        status: "voided",
        classificationComplete: true
      },
      {
        id: bankProviderTransactionId("revolut", ["transaction-4", "leg-4", "account-1"]),
        status: "voided",
        classificationComplete: true
      }
    ]
  );
});

test("Revolut activity remains empty until all four runtime credentials are configured", async () => {
  assert.deepEqual(
    await fetchRevolutActivity({
      clientId: "client-123",
      issuer: "finance.thatcanadian.dev",
      privateKeyPem: "",
      refreshToken: "refresh-123"
    }),
    { accounts: [], transactions: [] }
  );
});

test("Revolut activity deduplicates every repeated ID at a multi-row page boundary", async () => {
  const { privateKeyPem } = await rsaKeyMaterial();
  const transactionRequests: URL[] = [];
  const boundaryTimestamp = "2026-07-20T12:00:00.000Z";
  const transaction = (id: string, createdAt: string) => ({
    id,
    type: "card_payment",
    state: "completed",
    created_at: createdAt,
    merchant: { name: `Merchant ${id}` },
    legs: [{
      leg_id: "leg-1",
      account_id: "account-1",
      amount: -1,
      currency: "USD"
    }]
  });
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/auth/token")) {
      return Response.json({ access_token: "access-123" });
    }
    if (url.pathname.endsWith("/accounts")) {
      return Response.json([{
        id: "account-1",
        name: "Operating USD",
        balance: 100,
        currency: "USD",
        state: "active",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-07-28T00:00:00.000Z"
      }]);
    }

    transactionRequests.push(url);
    if (transactionRequests.length === 1) {
      return Response.json(Array.from({ length: 1000 }, (_, index) =>
        transaction(
          `transaction-${index}`,
          index >= 998 ? boundaryTimestamp : "2026-07-28T12:00:00.000Z"
        )
      ));
    }
    assert.equal(url.searchParams.get("to"), boundaryTimestamp);
    return Response.json([
      transaction("transaction-999", boundaryTimestamp),
      transaction("transaction-998", boundaryTimestamp),
      transaction("transaction-1000", "2026-07-19T12:00:00.000Z")
    ]);
  };
  const callbackPages: string[][] = [];

  const result = await fetchRevolutActivity({
    clientId: "client-123",
    issuer: "finance.thatcanadian.dev",
    privateKeyPem,
    refreshToken: "refresh-123",
    dateRange: { fromDate: "2026-07-01", toDate: "2026-07-28" },
    fetcher,
    collectTransactions: false,
    onTransactionPage: async (transactions) => {
      await Promise.resolve();
      callbackPages.push(transactions.map((item) => item.id));
    }
  });

  assert.equal(transactionRequests.length, 2);
  assert.deepEqual(callbackPages.map((page) => page.length), [1000, 1]);
  assert.equal(Math.max(...callbackPages.map((page) => page.length)), 1000);
  assert.equal(new Set(callbackPages.flat()).size, 1001);
  assert.equal(
    callbackPages.flat().filter((id) => id === bankProviderTransactionId(
      "revolut",
      ["transaction-999", "leg-1", "account-1"]
    )).length,
    1
  );
  assert.equal(
    callbackPages.flat().filter((id) => id === bankProviderTransactionId(
      "revolut",
      ["transaction-998", "leg-1", "account-1"]
    )).length,
    1
  );
  assert.deepEqual(result.transactions, []);
  assert.equal(result.accounts.length, 1);
});

test("Revolut bounded pagination deduplicates an adjacent multi-row inclusive boundary", async () => {
  const { privateKeyPem } = await rsaKeyMaterial();
  const boundaryTimestamp = "2026-07-20T12:00:00.000Z";
  const callbackPages: string[][] = [];
  let transactionRequests = 0;
  const transaction = (id: string, createdAt: string) => ({
    id,
    type: "card_payment",
    state: "completed",
    created_at: createdAt,
    merchant: { name: `Merchant ${id}` },
    legs: [{
      leg_id: `leg-${id}`,
      account_id: "account-1",
      amount: -1,
      currency: "USD"
    }]
  });
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/auth/token")) return Response.json({ access_token: "access-123" });
    if (url.pathname.endsWith("/accounts")) {
      return Response.json([{
        id: "account-1",
        name: "Operating USD",
        balance: 100,
        currency: "USD",
        state: "active",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-07-28T00:00:00.000Z"
      }]);
    }
    transactionRequests += 1;
    if (transactionRequests === 1) {
      return Response.json(Array.from({ length: 200 }, (_, index) =>
        transaction(
          `transaction-${index}`,
          index >= 198 ? boundaryTimestamp : "2026-07-28T12:00:00.000Z"
        )
      ));
    }
    assert.equal(url.searchParams.get("to"), boundaryTimestamp);
    return Response.json([
      transaction("transaction-199", boundaryTimestamp),
      transaction("transaction-198", boundaryTimestamp),
      transaction("transaction-200", "2026-07-19T12:00:00.000Z")
    ]);
  };

  const result = await fetchRevolutActivityBatch({
    clientId: "client-123",
    issuer: "finance.thatcanadian.dev",
    privateKeyPem,
    refreshToken: "refresh-123",
    dateRange: { fromDate: "2026-07-01", toDate: "2026-07-28" },
    fetcher,
    pageBudget: 2,
    collectTransactions: false,
    onTransactionPage: (transactions) => {
      callbackPages.push(transactions.map((item) => item.rawName ?? ""));
    }
  });

  assert.equal(result.complete, true);
  assert.equal(result.providerTransactionsRead, 203);
  assert.deepEqual(callbackPages.map((page) => page.length), [200, 1]);
  assert.equal(callbackPages.flat().filter((name) => name === "Merchant transaction-199").length, 1);
  assert.equal(callbackPages.flat().filter((name) => name === "Merchant transaction-198").length, 1);
  assert.deepEqual(callbackPages[1], ["Merchant transaction-200"]);
});

test("Revolut bounded pagination rejects non-boundary repeats and cursor non-progress", async () => {
  const { privateKeyPem } = await rsaKeyMaterial();
  const boundaryTimestamp = "2026-07-20T12:00:00.000Z";
  const transaction = (id: string, createdAt: string) => ({
    id,
    type: "card_payment",
    state: "completed",
    created_at: createdAt,
    merchant: { name: `Merchant ${id}` },
    legs: [{
      leg_id: `leg-${id}`,
      account_id: "account-1",
      amount: -1,
      currency: "USD"
    }]
  });
  const start = (mode: "repeat" | "non-progress") => {
    let transactionRequests = 0;
    const callbackPages: number[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/auth/token")) return Response.json({ access_token: "access-123" });
      if (url.pathname.endsWith("/accounts")) {
        return Response.json([{
          id: "account-1",
          name: "Operating USD",
          balance: 100,
          currency: "USD",
          state: "active",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-07-28T00:00:00.000Z"
        }]);
      }
      transactionRequests += 1;
      if (transactionRequests === 1) {
        return Response.json(Array.from({ length: 200 }, (_, index) =>
          transaction(
            `transaction-${index}`,
            index >= 198 ? boundaryTimestamp : "2026-07-28T12:00:00.000Z"
          )
        ));
      }
      if (mode === "repeat") {
        return Response.json([
          transaction("transaction-199", boundaryTimestamp),
          transaction("transaction-198", boundaryTimestamp),
          transaction("transaction-50", "2026-07-19T12:00:00.000Z"),
          transaction("transaction-200", "2026-07-18T12:00:00.000Z")
        ]);
      }
      return Response.json([
        transaction("transaction-199", boundaryTimestamp),
        transaction("transaction-198", boundaryTimestamp),
        ...Array.from({ length: 198 }, (_, index) =>
          transaction(`next-transaction-${index}`, boundaryTimestamp)
        )
      ]);
    };
    const promise = fetchRevolutActivityBatch({
      clientId: "client-123",
      issuer: "finance.thatcanadian.dev",
      privateKeyPem,
      refreshToken: "refresh-123",
      dateRange: { fromDate: "2026-07-01", toDate: "2026-07-28" },
      fetcher,
      pageBudget: 2,
      collectTransactions: false,
      onTransactionPage: (transactions) => {
        callbackPages.push(transactions.length);
      }
    });
    return { promise, callbackPages };
  };

  const repeated = start("repeat");
  await assert.rejects(
    repeated.promise,
    /repeated transaction transaction-50 outside the inclusive cursor boundary/
  );
  assert.deepEqual(repeated.callbackPages, [200]);

  const nonProgress = start("non-progress");
  await assert.rejects(
    nonProgress.promise,
    /did not advance to an older created_at cursor/
  );
  assert.deepEqual(nonProgress.callbackPages, [200]);
});

test("Revolut sync checkpoints preserve a multi-row boundary across a bounded resume", async () => {
  const { privateKeyPem } = await rsaKeyMaterial();
  const transactionRequests: URL[] = [];
  const callbackPages: string[][] = [];
  const boundaryTimestamp = "2026-07-20T12:00:00.123456Z";
  const transaction = (id: string, createdAt: string) => ({
    id,
    type: "card_payment",
    state: "completed",
    created_at: createdAt,
    merchant: { name: `Merchant ${id}` },
    legs: [{
      leg_id: `leg-${id}`,
      account_id: "account-1",
      amount: -1,
      currency: "USD"
    }]
  });
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/auth/token")) return Response.json({ access_token: "access-123" });
    if (url.pathname.endsWith("/accounts")) {
      return Response.json([{
        id: "account-1",
        name: "Operating USD",
        balance: 100,
        currency: "USD",
        state: "active",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-07-28T00:00:00.000Z"
      }]);
    }
    transactionRequests.push(url);
    if (transactionRequests.length === 1) {
      assert.equal(url.searchParams.get("count"), "200");
      return Response.json(Array.from({ length: 200 }, (_, index) =>
        transaction(
          `transaction-${index}`,
          index >= 198 ? boundaryTimestamp : "2026-07-28T12:00:00.000Z"
        )
      ));
    }
    assert.equal(url.searchParams.get("from"), "2026-07-01T00:00:00.000Z");
    assert.equal(url.searchParams.get("to"), boundaryTimestamp);
    return Response.json([
      transaction("transaction-199", boundaryTimestamp),
      transaction("transaction-198", boundaryTimestamp),
      transaction("transaction-200", "2026-07-19T12:00:00.000Z")
    ]);
  };
  const common = {
    clientId: "client-123",
    issuer: "finance.thatcanadian.dev",
    privateKeyPem,
    refreshToken: "refresh-123",
    fetcher,
    collectTransactions: false,
    pageBudget: 1,
    onTransactionPage: (transactions: import("./types").Transaction[]) => {
      callbackPages.push(transactions.map((item) => item.id));
    }
  };

  const first = await fetchRevolutActivityBatch({
    ...common,
    dateRange: { fromDate: "2026-07-01", toDate: "2026-07-28" }
  });
  assert.equal(first.complete, false);
  assert.equal(first.pagesFetched, 1);
  assert.equal(first.providerTransactionsRead, 200);
  assert.deepEqual(first.transactions, []);
  assert.ok(first.nextCheckpoint);
  assert.doesNotMatch(first.nextCheckpoint, /2026|transaction|cursor/);

  const second = await fetchRevolutActivityBatch({
    ...common,
    checkpoint: first.nextCheckpoint
  });
  assert.equal(second.complete, true);
  assert.equal(second.nextCheckpoint, null);
  assert.equal(second.pagesFetched, 1);
  assert.equal(second.providerTransactionsRead, 3);
  assert.deepEqual(callbackPages.map((page) => page.length), [200, 1]);
  assert.equal(
    callbackPages[0][0],
    bankProviderTransactionId("revolut", ["transaction-0", "leg-transaction-0", "account-1"])
  );
});

test("Revolut normalization rejects transactions without stable provider leg IDs", async () => {
  const { privateKeyPem } = await rsaKeyMaterial();
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/auth/token")) return Response.json({ access_token: "access-123" });
    if (url.pathname.endsWith("/accounts")) {
      return Response.json([{
        id: "account-1",
        name: "Operating USD",
        balance: 100,
        currency: "USD",
        state: "active",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-07-28T00:00:00.000Z"
      }]);
    }
    return Response.json([{
      id: "transaction-1",
      type: "card_payment",
      state: "completed",
      created_at: "2026-07-20T12:00:00.000Z",
      legs: [{ account_id: "account-1", amount: -1, currency: "USD" }]
    }]);
  };

  await assert.rejects(
    fetchRevolutActivityBatch({
      clientId: "client-123",
      issuer: "finance.thatcanadian.dev",
      privateKeyPem,
      refreshToken: "refresh-123",
      fetcher
    }),
    /missing a stable leg ID/
  );
});

test("Revolut rejects malformed account money, currency, IDs, and timestamps", async () => {
  const { privateKeyPem } = await rsaKeyMaterial();
  const baseAccount = {
    id: "account-1",
    name: "Operating USD",
    balance: 100,
    currency: "USD",
    state: "active",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-07-28T00:00:00.000Z"
  };
  const cases: Array<{ account: Record<string, unknown>; expected: RegExp }> = [
    { account: { ...baseAccount, id: "" }, expected: /missing account\.id/ },
    { account: { ...baseAccount, balance: undefined }, expected: /account\.balance must be a finite number/ },
    { account: { ...baseAccount, currency: "usd" }, expected: /currency is not a supported currency code/ },
    {
      account: { ...baseAccount, updated_at: "2026-02-30T00:00:00.000Z" },
      expected: /updated_at is not a valid ISO timestamp/
    }
  ];

  for (const { account, expected } of cases) {
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/auth/token")) return Response.json({ access_token: "access-123" });
      if (url.pathname.endsWith("/accounts")) return Response.json([account]);
      throw new Error(`Unexpected Revolut request: ${url}`);
    };
    await assert.rejects(
      fetchRevolutActivityBatch({
        clientId: "client-123",
        issuer: "finance.thatcanadian.dev",
        privateKeyPem,
        refreshToken: "refresh-123",
        fetcher
      }),
      expected
    );
  }
});

test("Revolut rejects transaction rows with invented-prone money, date, status, currency, or text", async () => {
  const { privateKeyPem } = await rsaKeyMaterial();
  const account = {
    id: "account-1",
    name: "Operating USD",
    balance: 100,
    currency: "USD",
    state: "active",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-07-28T00:00:00.000Z"
  };
  const baseTransaction = {
    id: "transaction-1",
    type: "card_payment",
    state: "completed",
    created_at: "2026-07-20T12:00:00.000Z",
    reference: "Invoice 1",
    legs: [{
      leg_id: "leg-1",
      account_id: "account-1",
      amount: -1,
      currency: "USD"
    }]
  };
  const cases: Array<{ transaction: Record<string, unknown>; expected: RegExp }> = [
    { transaction: { ...baseTransaction, id: undefined }, expected: /missing transaction\.id/ },
    { transaction: { ...baseTransaction, created_at: undefined }, expected: /missing .*created_at/ },
    {
      transaction: { ...baseTransaction, created_at: "2026-02-30T12:00:00.000Z" },
      expected: /created_at is not a valid ISO timestamp/
    },
    { transaction: { ...baseTransaction, state: "unknown" }, expected: /unsupported state unknown/ },
    {
      transaction: {
        ...baseTransaction,
        legs: [{ ...baseTransaction.legs[0], amount: undefined }]
      },
      expected: /legs\[0\]\.amount must be a finite number/
    },
    {
      transaction: {
        ...baseTransaction,
        legs: [{ ...baseTransaction.legs[0], currency: "usd" }]
      },
      expected: /currency is not a supported currency code/
    },
    {
      transaction: { ...baseTransaction, reference: "x".repeat(1_025) },
      expected: /reference exceeds 1024 characters/
    }
  ];

  for (const { transaction, expected } of cases) {
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/auth/token")) return Response.json({ access_token: "access-123" });
      if (url.pathname.endsWith("/accounts")) return Response.json([account]);
      return Response.json([transaction]);
    };
    await assert.rejects(
      fetchRevolutActivityBatch({
        clientId: "client-123",
        issuer: "finance.thatcanadian.dev",
        privateKeyPem,
        refreshToken: "refresh-123",
        fetcher
      }),
      expected
    );
  }
});
