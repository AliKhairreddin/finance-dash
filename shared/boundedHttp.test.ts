import assert from "node:assert/strict";
import test from "node:test";
import {
  bankProviderGetFetchPolicy,
  bankProviderOAuthFetchPolicy,
  fetchBankProvider,
  readBoundedResponseJson,
  readBoundedResponseText,
} from "./boundedHttp";

test("bounded provider responses reject oversized declared and streamed bodies", async () => {
  await assert.rejects(
    () => readBoundedResponseText(new Response("small", { headers: { "Content-Length": "11" } }), "Bank", 10),
    /exceeded 10 bytes/
  );
  await assert.rejects(
    () => readBoundedResponseText(new Response("12345678901"), "Bank", 10),
    /exceeded 10 bytes/
  );
});

test("bounded provider responses time out when a body stream never closes", async () => {
  let canceled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("partial"));
    },
    cancel() {
      canceled = true;
    },
  });

  await assert.rejects(
    () => readBoundedResponseText(new Response(body), "Bank", 100, 10),
    (error) => error instanceof DOMException
      && error.name === "TimeoutError"
      && /response body timed out after 10ms/.test(error.message)
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(canceled, true);
});

test("bounded provider JSON parsing accepts valid documents and rejects invalid JSON", async () => {
  assert.deepEqual(await readBoundedResponseJson(new Response('{"ok":true}'), "Bank", 100), { ok: true });
  await assert.rejects(() => readBoundedResponseJson(new Response("not-json"), "Bank", 100), /invalid JSON/);
});

test("provider fetch returns non-retryable responses unchanged", async () => {
  const unauthorized = new Response("no", { status: 401 });
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls += 1;
    return unauthorized;
  };

  const response = await fetchBankProvider(fetcher, "https://bank.test/accounts", undefined, {
    provider: "Bank",
    ...bankProviderGetFetchPolicy,
  });
  assert.equal(response, unauthorized);
  assert.equal(calls, 1);
});

test("provider GET policy retries retryable HTTP responses at most once", async () => {
  const responses = [
    new Response("busy", { status: 503, headers: { "Retry-After": "60" } }),
    new Response("ok"),
  ];
  let calls = 0;
  const fetcher: typeof fetch = async () => responses[calls++]!;

  const response = await fetchBankProvider(fetcher, "https://bank.test/transactions", undefined, {
    provider: "Bank",
    ...bankProviderGetFetchPolicy,
    maxRetryDelayMs: 1,
  });
  assert.equal(await response.text(), "ok");
  assert.equal(calls, 2);
});

test("provider fetch honors HTTP-date Retry-After while capping the wait", async () => {
  const retryAt = new Date(Date.now() + 60_000).toUTCString();
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls += 1;
    return calls === 1
      ? new Response("limited", { status: 429, headers: { "Retry-After": retryAt } })
      : new Response("ok");
  };

  const response = await fetchBankProvider(fetcher, "https://bank.test/transactions", undefined, {
    provider: "Bank",
    timeoutMs: 100,
    maxAttempts: 2,
    maxRetryDelayMs: 1,
  });
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
});

test("provider fetch retries network errors and per-attempt timeouts", async () => {
  let networkCalls = 0;
  const networkFetcher: typeof fetch = async () => {
    networkCalls += 1;
    if (networkCalls === 1) throw new TypeError("network unavailable");
    return new Response("ok");
  };
  assert.equal(
    (
      await fetchBankProvider(networkFetcher, "https://bank.test/accounts", undefined, {
        provider: "Bank",
        timeoutMs: 100,
        maxAttempts: 2,
        maxRetryDelayMs: 0,
      })
    ).status,
    200
  );
  assert.equal(networkCalls, 2);

  let timeoutCalls = 0;
  const timeoutFetcher: typeof fetch = async () => {
    timeoutCalls += 1;
    if (timeoutCalls === 1) return await new Promise<Response>(() => undefined);
    return new Response("ok");
  };
  assert.equal(
    (
      await fetchBankProvider(timeoutFetcher, "https://bank.test/accounts", undefined, {
        provider: "Bank",
        timeoutMs: 5,
        maxAttempts: 2,
        maxRetryDelayMs: 0,
      })
    ).status,
    200
  );
  assert.equal(timeoutCalls, 2);
});

test("provider fetch carries caller cancellation and does not retry it", async () => {
  const caller = new AbortController();
  const reason = new Error("caller canceled");
  let calls = 0;
  const fetcher: typeof fetch = async (_input, init) => {
    calls += 1;
    assert.notEqual(init?.signal, caller.signal);
    return await new Promise<Response>(() => undefined);
  };
  const request = new Request("https://bank.test/transactions", { signal: caller.signal });
  const pending = fetchBankProvider(fetcher, request, undefined, {
    provider: "Bank",
    timeoutMs: 100,
    maxAttempts: 3,
    maxRetryDelayMs: 1,
  });
  caller.abort(reason);

  await assert.rejects(pending, (error) => error === reason);
  assert.equal(calls, 1);
});

test("provider fetch does not retry arbitrary application errors", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls += 1;
    throw new Error("invalid provider payload");
  };
  await assert.rejects(
    () =>
      fetchBankProvider(fetcher, "https://bank.test/transactions", undefined, {
        provider: "Bank",
        timeoutMs: 100,
        maxAttempts: 3,
        maxRetryDelayMs: 0,
      }),
    /invalid provider payload/
  );
  assert.equal(calls, 1);
});

test("provider OAuth policy never retries and policy limits are validated", async () => {
  const unavailable = new Response("busy", { status: 503 });
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls += 1;
    return unavailable;
  };
  const response = await fetchBankProvider(fetcher, "https://bank.test/oauth/token", { method: "POST" }, {
    provider: "Bank",
    ...bankProviderOAuthFetchPolicy,
  });
  assert.equal(response, unavailable);
  assert.equal(calls, 1);

  await assert.rejects(
    () =>
      fetchBankProvider(fetcher, "https://bank.test/accounts", undefined, {
        provider: "Bank",
        maxAttempts: 4,
      }),
    /attempt limit is invalid/
  );
});
