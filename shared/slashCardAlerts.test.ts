import assert from "node:assert/strict";
import test from "node:test";
import { configureSlashCardWebhook, fetchSlashCardAlertLabels, fetchSlashCardAlertTransaction, slashCardWebhookEvents } from "./slashApi";

const options = { baseUrl: "https://api.slash.test", apiKey: "test-key", legalEntityId: "entity" };
const transaction = { id: "tx", cardId: "card", accountId: "underlying", accountSubtype: "credit", virtualAccountId: "va",
  date: "2026-09-30T12:00:00Z", authorizedAt: "2026-09-30T11:59:00Z", amountCents: -12500, description: "Card purchase",
  status: "failed", detailedStatus: "declined", declineReason: "Spending limit", originalCurrency: { code: "CAD", amountCents: -17500, conversionRate: 1.4 } };

test("webhook transactions read authoritative details once and omit non-card, canceled and refund activity", async () => {
  const reads: string[] = [];
  const read = (value: unknown, transactionId = "tx") => fetchSlashCardAlertTransaction({ ...options, transactionId, fetcher: async (input, init) => {
    reads.push(new URL(String(input)).pathname);
    assert.equal(new Headers(init?.headers).get("x-legal-entity"), "entity");
    return Response.json(value);
  } });
  const result = await read({ ...transaction, pan: "must-never-retain", cvv: "must-never-retain" });
  assert.equal(result?.authorizedAt, transaction.authorizedAt);
  assert.deepEqual(result?.originalCurrency, { code: "CAD", amountCents: -17500 });
  assert.equal(result?.declineReason, "Spending limit");
  assert.doesNotMatch(JSON.stringify(result), /must-never-retain/);
  for (const value of [{ ...transaction, cardId: null }, { ...transaction, detailedStatus: "canceled" },
    { ...transaction, detailedStatus: "reversed" }, { ...transaction, amountCents: 100 }]) assert.equal(await read(value), null);
  for (const value of [{ ...transaction, authorizedAt: undefined }, { ...transaction, detailedStatus: undefined },
    { ...transaction, amountCents: 1.5 }]) await assert.rejects(read(value));
  await assert.rejects(read(transaction, "wrong"), /different transaction/);
  assert.ok(reads.every((path) => path.startsWith("/transaction/")));
});

test("instant alert labels resolve the card and virtual account without confusing parent and underlying account IDs", async () => {
  const tx = await fetchSlashCardAlertTransaction({ ...options, transactionId: "tx", fetcher: async () => Response.json(transaction) });
  assert.ok(tx);
  let wrong = false;
  const fetcher: typeof fetch = async (input) => {
    const path = new URL(String(input)).pathname;
    if (path === "/card/card") return Response.json({ id: "card", name: "Ads", last4: "1234", pan: "secret" });
    assert.equal(path, "/virtual-account/va");
    return Response.json({ virtualAccount: { id: wrong ? "another" : "va", accountId: "parent", accountType: "primary", name: "Primary" }, balance: { amountCents: -1000 } });
  };
  const labels = await fetchSlashCardAlertLabels({ ...options, transaction: tx, fetcher });
  assert.deepEqual(labels.card, { id: "card", name: "Ads", last4: "1234" });
  assert.equal(labels.account?.balance, -10);
  wrong = true;
  await assert.rejects(fetchSlashCardAlertLabels({ ...options, transaction: tx, fetcher }), /different virtual account/);
});

test("webhook setup paginates before deciding to create and only updates the matching finance endpoint", async () => {
  const webhookUrl = "https://finance.example/api/slash/card-events";
  const requests: string[] = [];
  let enabledEvents: string[] = ["card.create"];
  let status = "backing-off";
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    requests.push(`${method} ${url.pathname}`);
    assert.equal(new Headers(init?.headers).get("x-legal-entity"), "entity");
    if (method === "GET") {
      assert.equal(url.searchParams.get("filter:legalEntityId"), "entity");
      if (!url.searchParams.get("cursor")) return Response.json({ items: [{ id: "other", url: "https://other.example", status: "active" }], metadata: { nextCursor: "next" } });
      assert.equal(url.searchParams.get("cursor"), "next");
      return Response.json({ items: [{ id: "ours", url: webhookUrl, status, enabledEvents }], metadata: {} });
    }
    assert.equal(method, "PATCH"); assert.equal(url.pathname, "/webhook/ours");
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body, { status: "active", enabledEvents: slashCardWebhookEvents });
    status = body.status; enabledEvents = [...body.enabledEvents];
    return Response.json({ id: "ours", url: webhookUrl, status, enabledEvents });
  };
  await configureSlashCardWebhook({ ...options, webhookUrl, fetcher });
  await configureSlashCardWebhook({ ...options, webhookUrl, fetcher });
  assert.deepEqual(requests, ["GET /webhook", "GET /webhook", "PATCH /webhook/ours", "GET /webhook", "GET /webhook"]);
});

test("webhook creation selects the legal entity, then restricts transaction events; ambiguous writes are not retried", async () => {
  const webhookUrl = "https://finance.example/api/slash/card-events";
  const requests: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const method = init?.method ?? "GET";
    requests.push(method);
    if (method === "GET") return Response.json({ items: [], metadata: {} });
    if (method === "POST") {
      assert.deepEqual(JSON.parse(String(init?.body)), { legalEntityId: "entity", url: webhookUrl, name: "Finance Dash instant card alerts" });
      return Response.json({ id: "new", url: webhookUrl, status: "active" }, { status: 201 });
    }
    assert.equal(new URL(String(input)).pathname, "/webhook/new");
    return Response.json({ id: "new", url: webhookUrl, status: "active", enabledEvents: slashCardWebhookEvents });
  };
  await configureSlashCardWebhook({ ...options, webhookUrl, fetcher });
  assert.deepEqual(requests, ["GET", "POST", "PATCH"]);
  let writes = 0;
  await assert.rejects(configureSlashCardWebhook({ ...options, webhookUrl, fetcher: async (_input, init) => {
    if (!init?.method) return Response.json({ items: [], metadata: {} });
    writes++; return Response.json({ message: "unavailable" }, { status: 503 });
  } }), /503/);
  assert.equal(writes, 1);
  await assert.rejects(configureSlashCardWebhook({ ...options, webhookUrl, fetcher: async () => Response.json({
    items: ["one", "two"].map((id) => ({ id, url: webhookUrl, status: "active" })), metadata: {}
  }) }), /Multiple/);
});
