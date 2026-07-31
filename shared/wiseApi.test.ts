import assert from "node:assert/strict";
import test from "node:test";
import {
  emptyWiseActivity,
  fetchWiseActivityBatch,
  fetchWiseActivityForAccessibleBusinesses,
  parseWiseTransactionDateRange,
  wiseStatementTransactionReference
} from "./wiseApi";
import { wiseTransactionId } from "./wiseTransactionIdentity";

test("Wise provider identities preserve punctuation, case, and balance scope", () => {
  assert.notEqual(wiseTransactionId(2201, "CARD-123"), wiseTransactionId(2201, "CARD123"));
  assert.notEqual(wiseTransactionId(2201, "Card-123"), wiseTransactionId(2201, "CARD-123"));
  assert.notEqual(wiseTransactionId(2201, "CARD-123"), wiseTransactionId(2202, "CARD-123"));
  assert.equal(wiseTransactionId(2201, "Café/東京"), wiseTransactionId("2201", "Café/東京"));
});

test("empty Wise activity records a balance failure separately from statement limitations", () => {
  assert.deepEqual(emptyWiseActivity("Wise balance sync failed"), {
    accounts: [],
    transactions: [],
    statementIssues: [],
    balanceIssue: "Wise balance sync failed"
  });
});

test("discovers and labels balances across selected accessible Wise business profiles", async () => {
  const requestedUrls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    requestedUrls.push(url);

    if (url.endsWith("/v2/profiles")) {
      return Response.json([
        { id: 11, type: "BUSINESS", businessName: "Lovemedo" },
        { id: 22, type: "BUSINESS", businessName: "Digital Nudge" },
        { id: 44, type: "BUSINESS", businessName: "Unrelated Business" },
        { id: 33, type: "PERSONAL" }
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
            referenceNumber: "ref-1",
            date: "2026-07-22T08:00:00Z",
            type: "CARD",
            details: { recipientName: "Acme", description: "Subscription" },
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
    profileIds: new Set([11, 22]),
    fetcher
  });

  assert.deepEqual(
    result.accounts.map(({ id, name, wiseEntity, balance, currency }) => ({
      id,
      name,
      wiseEntity,
      balance,
      currency
    })),
    [
      { id: "wise-11-1101", name: "Lovemedo · Wise USD", wiseEntity: "lmd", balance: 125, currency: "USD" },
      { id: "wise-22-2201", name: "Digital Nudge · Wise USD", wiseEntity: "dn", balance: 250, currency: "USD" },
      { id: "wise-22-2202", name: "Digital Nudge · Wise EUR", wiseEntity: "dn", balance: 50, currency: "EUR" }
    ]
  );
  assert.equal(result.transactions.length, 1);
  assert.equal(result.transactions[0].id, "wise-v2-2201-7265662d31");
  assert.equal(result.transactions[0].accountName, "Digital Nudge · Wise USD");
  assert.equal(result.transactions[0].wiseEntity, "dn");
  assert.equal(result.statementIssues.length, 1);
  assert.match(result.statementIssues[0], /denied live statement API access/);
  assert.equal(result.balanceIssue, undefined);
  assert.equal(requestedUrls.some((url) => url.includes("/profiles/33/balances")), false);
  assert.equal(requestedUrls.some((url) => url.includes("/profiles/44/balances")), false);
});

test("balance-only Wise sync never requests or returns statement transactions", async () => {
  const requestedUrls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    requestedUrls.push(url);
    if (url.endsWith("/v2/profiles")) {
      return Response.json([{ id: 11, type: "BUSINESS", businessName: "Lovemedo" }]);
    }
    if (url.includes("/v4/profiles/11/balances")) {
      return Response.json([
        {
          id: 1101,
          currency: "USD",
          amount: { value: 125, currency: "USD" },
          modificationTime: "2026-07-21T12:00:00Z"
        }
      ]);
    }
    throw new Error(`Unexpected Wise request: ${url}`);
  };

  const result = await fetchWiseActivityForAccessibleBusinesses({
    baseUrl: "https://api.wise.test",
    token: "test-token",
    profileIds: new Set([11]),
    includeTransactions: false,
    fetcher
  });

  assert.equal(result.accounts.length, 1);
  assert.deepEqual(result.transactions, []);
  assert.deepEqual(result.statementIssues, []);
  assert.equal(requestedUrls.some((url) => url.includes("balance-statements")), false);
});

test("Wise sync checkpoints traverse sorted balances in bounded daily statement pages", async () => {
  const statementRequests: URL[] = [];
  const callbackPages: string[][] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/v2/profiles")) {
      return Response.json([{ id: 22, type: "BUSINESS", businessName: "Digital Nudge" }]);
    }
    if (url.pathname.includes("/v4/profiles/22/balances")) {
      return Response.json([
        {
          id: 2202,
          currency: "EUR",
          amount: { value: 50, currency: "EUR" },
          modificationTime: "2026-07-28T12:00:00.000Z",
          visible: true
        },
        {
          id: 2201,
          currency: "USD",
          amount: { value: 250, currency: "USD" },
          modificationTime: "2026-07-28T12:00:00.000Z",
          visible: true
        }
      ]);
    }
    statementRequests.push(url);
    const balanceId = url.pathname.match(/balance-statements\/(\d+)/)?.[1];
    const intervalStart = url.searchParams.get("intervalStart")!;
    return Response.json({
      transactions: [{
        referenceNumber: `ref/${balanceId}/${intervalStart.slice(0, 10)}`,
        date: intervalStart,
        type: "DEBIT",
        details: { description: `Activity ${balanceId}` },
        amount: { value: -1, currency: url.searchParams.get("currency") }
      }]
    });
  };
  const common = {
    baseUrl: "https://api.wise.test",
    token: "test-token",
    profileIds: new Set([22]),
    fetcher,
    pageBudget: 2,
    collectTransactions: false,
    onTransactionPage: (transactions: import("./types").Transaction[]) => {
      callbackPages.push(transactions.map((transaction) => transaction.id));
    }
  };

  const first = await fetchWiseActivityBatch({
    ...common,
    dateRange: { fromDate: "2026-07-01", toDate: "2026-07-03" }
  });
  assert.equal(first.complete, false);
  assert.equal(first.pagesFetched, 2);
  assert.equal(first.providerTransactionsRead, 2);
  assert.deepEqual(first.transactions, []);
  assert.deepEqual(first.accounts.map((account) => account.id), ["wise-22-2201", "wise-22-2202"]);
  assert.ok(first.nextCheckpoint);
  assert.doesNotMatch(first.nextCheckpoint, /2201|2026|interval|balance/);

  const second = await fetchWiseActivityBatch({ ...common, checkpoint: first.nextCheckpoint });
  assert.equal(second.complete, false);
  assert.equal(second.pagesFetched, 2);
  assert.ok(second.nextCheckpoint);
  const third = await fetchWiseActivityBatch({ ...common, checkpoint: second.nextCheckpoint });
  assert.equal(third.complete, true);
  assert.equal(third.nextCheckpoint, null);
  assert.equal(third.pagesFetched, 2);

  assert.deepEqual(
    statementRequests.map((url) => ({
      balanceId: url.pathname.match(/balance-statements\/(\d+)/)?.[1],
      intervalStart: url.searchParams.get("intervalStart"),
      intervalEnd: url.searchParams.get("intervalEnd")
    })),
    [
      { balanceId: "2201", intervalStart: "2026-07-01T00:00:00.000Z", intervalEnd: "2026-07-01T23:59:59.999Z" },
      { balanceId: "2201", intervalStart: "2026-07-02T00:00:00.000Z", intervalEnd: "2026-07-02T23:59:59.999Z" },
      { balanceId: "2201", intervalStart: "2026-07-03T00:00:00.000Z", intervalEnd: "2026-07-03T23:59:59.999Z" },
      { balanceId: "2202", intervalStart: "2026-07-01T00:00:00.000Z", intervalEnd: "2026-07-01T23:59:59.999Z" },
      { balanceId: "2202", intervalStart: "2026-07-02T00:00:00.000Z", intervalEnd: "2026-07-02T23:59:59.999Z" },
      { balanceId: "2202", intervalStart: "2026-07-03T00:00:00.000Z", intervalEnd: "2026-07-03T23:59:59.999Z" }
    ]
  );
  assert.equal(callbackPages.length, 6);
  assert.equal(callbackPages.every((page) => page.length === 1), true);
  assert.equal(
    callbackPages[0][0],
    "wise-v2-2201-7265662f323230312f323032362d30372d3031"
  );
});

test("Wise sync retries replay the same statement chunk and never mark statement failures complete", async () => {
  const statementRequests: URL[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/v2/profiles")) {
      return Response.json([{ id: 11, type: "BUSINESS", businessName: "Lovemedo" }]);
    }
    if (url.pathname.includes("/v4/profiles/11/balances")) {
      return Response.json([{
        id: 1101,
        currency: "USD",
        amount: { value: 125, currency: "USD" },
        modificationTime: "2026-07-28T12:00:00.000Z"
      }]);
    }
    statementRequests.push(url);
    return new Response("not permitted", { status: 403, statusText: "Forbidden" });
  };

  const first = await fetchWiseActivityBatch({
    baseUrl: "https://api.wise.test",
    token: "test-token",
    profileIds: new Set([11]),
    dateRange: { fromDate: "2026-07-01", toDate: "2026-07-01" },
    fetcher,
    pageBudget: 10
  });
  assert.equal(first.complete, false);
  assert.ok(first.nextCheckpoint);
  assert.equal(first.pagesFetched, 1);
  assert.equal(first.providerTransactionsRead, 0);
  assert.equal(first.statementIssues.length, 1);

  const retry = await fetchWiseActivityBatch({
    baseUrl: "https://api.wise.test",
    token: "test-token",
    profileIds: new Set([11]),
    checkpoint: first.nextCheckpoint,
    fetcher,
    pageBudget: 10
  });
  assert.equal(retry.complete, false);
  assert.ok(retry.nextCheckpoint);
  assert.equal(statementRequests.length, 2);
  assert.equal(statementRequests[0].search, statementRequests[1].search);
});

test("Wise statement normalization requires a stable provider reference or ID", async () => {
  assert.equal(wiseStatementTransactionReference({ referenceNumber: "CARD-249281" }), "CARD-249281");
  assert.equal(wiseStatementTransactionReference({ id: 30000001 }), "30000001");
  assert.throws(
    () => wiseStatementTransactionReference({ details: { referenceNumber: "unstable-location" } }),
    /missing a stable provider reference or ID/
  );

  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/v2/profiles")) {
      return Response.json([{ id: 11, type: "BUSINESS", businessName: "Lovemedo" }]);
    }
    if (url.pathname.includes("/v4/profiles/11/balances")) {
      return Response.json([{
        id: 1101,
        currency: "USD",
        amount: { value: 125, currency: "USD" },
        modificationTime: "2026-07-28T12:00:00.000Z"
      }]);
    }
    return Response.json({
      transactions: [{
        date: "2026-07-01T12:00:00.000Z",
        type: "DEBIT",
        details: { description: "Missing provider reference" },
        amount: { value: -1, currency: "USD" }
      }]
    });
  };
  await assert.rejects(
    fetchWiseActivityBatch({
      baseUrl: "https://api.wise.test",
      token: "test-token",
      profileIds: new Set([11]),
      dateRange: { fromDate: "2026-07-01", toDate: "2026-07-01" },
      fetcher
    }),
    /missing a stable provider reference or ID/
  );
});

test("Wise rejects missing or malformed balance money instead of fabricating an account balance", async () => {
  const baseBalance = {
    id: 1101,
    currency: "USD",
    amount: { value: 125, currency: "USD" },
    modificationTime: "2026-07-28T12:00:00.000Z"
  };
  const cases: Array<{ balance: Record<string, unknown>; expected: RegExp }> = [
    { balance: { ...baseBalance, amount: undefined }, expected: /balance 1101\.amount/ },
    {
      balance: { ...baseBalance, amount: { currency: "USD" } },
      expected: /amount\.value must be a finite number/
    },
    {
      balance: { ...baseBalance, currency: "usd" },
      expected: /currency is not a supported currency code/
    },
    {
      balance: { ...baseBalance, modificationTime: "2026-02-30T12:00:00.000Z" },
      expected: /modificationTime is not a valid ISO date/
    }
  ];

  for (const { balance, expected } of cases) {
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/v2/profiles")) {
        return Response.json([{ id: 11, type: "BUSINESS", businessName: "Lovemedo" }]);
      }
      if (url.pathname.includes("/v4/profiles/11/balances")) return Response.json([balance]);
      throw new Error(`Unexpected Wise request: ${url}`);
    };
    await assert.rejects(
      fetchWiseActivityBatch({
        baseUrl: "https://api.wise.test",
        token: "test-token",
        profileIds: new Set([11]),
        fetcher
      }),
      expected
    );
  }
});

test("Wise rejects statement rows with invented-prone amount, date, currency, or type fields", async () => {
  const baseActivity = {
    referenceNumber: "wise-reference-1",
    date: "2026-07-01T12:00:00.000Z",
    type: "DEBIT",
    details: { description: "Provider transaction" },
    amount: { value: -1, currency: "USD" }
  };
  const cases: Array<{ activity: Record<string, unknown>; expected: RegExp }> = [
    { activity: { ...baseActivity, amount: undefined }, expected: /transaction amount is invalid/ },
    {
      activity: { ...baseActivity, amount: { currency: "USD" } },
      expected: /amount\.value must be a finite number/
    },
    { activity: { ...baseActivity, date: undefined }, expected: /transaction date is missing or invalid/ },
    {
      activity: { ...baseActivity, date: "2026-02-30T12:00:00.000Z" },
      expected: /date is not a valid ISO date/
    },
    {
      activity: { ...baseActivity, amount: { value: -1 } },
      expected: /amount\.currency is missing or invalid/
    },
    { activity: { ...baseActivity, type: "" }, expected: /transaction type is missing or invalid/ }
  ];

  for (const { activity, expected } of cases) {
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/v2/profiles")) {
        return Response.json([{ id: 11, type: "BUSINESS", businessName: "Lovemedo" }]);
      }
      if (url.pathname.includes("/v4/profiles/11/balances")) {
        return Response.json([{
          id: 1101,
          currency: "USD",
          amount: { value: 125, currency: "USD" },
          modificationTime: "2026-07-28T12:00:00.000Z"
        }]);
      }
      return Response.json({ transactions: [activity] });
    };
    await assert.rejects(
      fetchWiseActivityBatch({
        baseUrl: "https://api.wise.test",
        token: "test-token",
        profileIds: new Set([11]),
        dateRange: { fromDate: "2026-07-01", toDate: "2026-07-01" },
        fetcher
      }),
      expected
    );
  }
});

test("Wise date ranges and statement budgets are validated before API access", async () => {
  assert.equal(parseWiseTransactionDateRange(undefined, undefined), undefined);
  assert.deepEqual(parseWiseTransactionDateRange("2026-07-01", "2026-07-03"), {
    fromDate: "2026-07-01",
    toDate: "2026-07-03"
  });
  assert.throws(() => parseWiseTransactionDateRange("2026-02-30", "2026-03-01"), /not a valid date/);
  assert.throws(() => parseWiseTransactionDateRange("2026-07-04", "2026-07-03"), /on or before/);
  await assert.rejects(
    fetchWiseActivityBatch({
      baseUrl: "https://api.wise.test",
      token: "test-token",
      profileIds: new Set([11]),
      pageBudget: 11,
      fetcher: async () => {
        throw new Error("Fetcher must not be called");
      }
    }),
    /page budget must be an integer from 1 to 10/
  );
});
