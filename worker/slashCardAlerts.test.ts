import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import type { SlashCardAlertTransaction } from "../shared/slashApi";
import { handleSlashCardWebhook, parseSlashCardWebhookEvent, verifySlashWebhookSignature, type SlashCardWebhookEvent } from "./slashCardWebhook";
import worker from "./handler";

// Use the real durable job with explicit in-memory storage and mocked external APIs.
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === "cloudflare:workers") return { url: "data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }", shortCircuit: true };
  return next(specifier, context);
} });
const { SlashCardAlerts } = await import("./slashCardAlerts");
hooks.deregister();

const event: SlashCardWebhookEvent = { event: "aggregated_transaction.create", eventId: "event", entityId: "decline", eventTimestamp: "2026-09-30T12:00:00Z" };
const decline: SlashCardAlertTransaction = { id: "decline", cardId: "card", accountId: "underlying", accountSubtype: "credit",
  date: "2026-09-30T12:00:00Z", authorizedAt: "2026-09-30T11:59:00Z", amountCents: -12500,
  description: "Meta", status: "failed", detailedStatus: "declined", declineReason: "Spending limit" };
const approval: SlashCardAlertTransaction = { ...decline, id: "new-payment", authorizedAt: "2026-09-30T12:01:00Z", status: "pending", detailedStatus: "pending", declineReason: undefined };
const baseEnv = { SLASH_BASE_URL: "https://api.slash.test", SLASH_API_KEY: "test-key", SLASH_LEGAL_ENTITY_ID: "entity",
  PUBLIC_APP_URL: "https://finance.example", TELEGRAM_BOT_TOKEN: "test",
  TELEGRAM_AUTH_USERS_JSON: JSON.stringify({ Ali: "111", "Ali M": "222", Amin: "333" }),
  TELEGRAM_COMMAND_ADMIN_USERS: "Ali,Ali M", TELEGRAM_COMMAND_READ_ONLY_USERS: "Amin",
  TELEGRAM_SLASH_REJECTED_CARDS_REPORT_RECIPIENTS: "Ali,Ali M" };

function memoryStorage() {
  const values = new Map<string, unknown>();
  let alarm: number | Date | null = null;
  const storage: DurableObjectStorage = {
    async get<T>(key: string) { return structuredClone(values.get(key)) as T | undefined; },
    async put<T>(key: string, value: T) { values.set(key, structuredClone(value)); },
    async delete(key: string) { return values.delete(key); },
    async list<T>(options?: { prefix?: string; limit?: number; startAfter?: string }) { return new Map([...values].sort(([a], [b]) => a.localeCompare(b))
      .filter(([key]) => key.startsWith(options?.prefix ?? "") && (!options?.startAfter || key > options.startAfter)).slice(0, options?.limit).map(([key, value]) => [key, structuredClone(value) as T])); },
    async setAlarm(value) { alarm = value; }, async deleteAlarm() { alarm = null; },
    async transaction<T>(run: (state: DurableObjectTransaction) => Promise<T>): Promise<T> {
      const snapshot = structuredClone(values); const previousAlarm = alarm;
      try { return await run(storage); }
      catch (error) { values.clear(); for (const [key, value] of snapshot) values.set(key, value); alarm = previousAlarm; throw error; }
    }
  };
  return { storage, values, alarm: () => alarm };
}

test("RSA verification authenticates the exact raw bytes and accepts either trusted rotation key", async () => {
  const generate = () => crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const [old, next] = await Promise.all([generate(), generate()]);
  const pem = async (key: CryptoKey) => `-----BEGIN PUBLIC KEY-----\n${Buffer.from(await crypto.subtle.exportKey("spki", key)).toString("base64")}\n-----END PUBLIC KEY-----`;
  const keys = await Promise.all([pem(old.publicKey), pem(next.publicKey)]);
  const body = new TextEncoder().encode(JSON.stringify(event));
  for (const key of [old, next]) {
    const signature = Buffer.from(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key.privateKey, body)).toString("base64");
    assert.equal(await verifySlashWebhookSignature(body, signature, keys), true);
    assert.equal(await verifySlashWebhookSignature(new TextEncoder().encode(`${JSON.stringify(event)} `), signature, keys), false);
  }
  for (const signature of [null, "", "invalid!", "x".repeat(1025), "AA=="]) assert.equal(await verifySlashWebhookSignature(body, signature, keys), false);
});

test("webhook requests require signatures, bound the body, and save events before acknowledgment", async t => {
  const received: SlashCardWebhookEvent[] = [];
  let fail = false;
  const env = { SLASH_CARD_ALERTS: { getByName(name: string) {
    assert.equal(name, "event:event");
    return { async receive(value: SlashCardWebhookEvent) { if (fail) throw new Error("storage unavailable"); received.push(value); } };
  } } } as unknown as WorkerEnv;
  const request = (body = JSON.stringify(event), signature?: string) => new Request("https://finance.example/api/slash/card-events", {
    method: "POST", body, headers: signature ? { "slash-webhook-signature": signature } : {}
  });
  assert.equal((await handleSlashCardWebhook(request(), env)).status, 401);
  assert.equal((await handleSlashCardWebhook(request("x".repeat(8193)), env)).status, 413);
  assert.equal((await handleSlashCardWebhook(new Request("https://finance.example/api/slash/card-events"), env)).status, 405);
  assert.equal(received.length, 0);
  // Signature cryptography is tested above; isolate the routing and durable acknowledgment here.
  t.mock.method(crypto.subtle, "verify", async () => true);
  assert.equal((await handleSlashCardWebhook(request(JSON.stringify(event), "AA=="), env)).status, 202);
  assert.deepEqual(received, [event]);
  assert.equal((await handleSlashCardWebhook(request("{}", "AA=="), env)).status, 400);
  assert.equal((await handleSlashCardWebhook(request(JSON.stringify({ ...event, event: "card.create" }), "AA=="), env)).status, 200);
  assert.equal(received.length, 1);
  fail = true;
  assert.equal((await handleSlashCardWebhook(request(JSON.stringify(event), "AA=="), env)).status, 503);
  assert.throws(() => parseSlashCardWebhookEvent({ ...event, eventId: "x".repeat(501) }));
  assert.throws(() => parseSlashCardWebhookEvent({ ...event, eventTimestamp: "yesterday" }));
});

test("event jobs acknowledge durably, deduplicate concurrent webhook retries, and retry failed transaction reads", async t => {
  const store = memoryStorage();
  const observed: SlashCardAlertTransaction[] = [];
  const cardNames: string[] = [];
  const env = { ...baseEnv, SLASH_CARD_ALERTS: { getByName(name: string) {
    cardNames.push(name); return { async observe(tx: SlashCardAlertTransaction) { observed.push(tx); } };
  } } } as unknown as WorkerEnv;
  let reads = 0; let fail = true;
  t.mock.method(globalThis, "fetch", async (input: string) => {
    assert.equal(new URL(String(input)).pathname, "/transaction/decline");
    reads++;
    return fail ? Response.json({ error: "unavailable" }, { status: 403 }) : Response.json(decline);
  });
  const job = new SlashCardAlerts({ storage: store.storage }, env);
  await Promise.all([job.receive(event), job.receive(event)]);
  assert.equal(reads, 0); assert.ok(store.alarm());
  await job.alarm();
  assert.equal((store.values.get("event-job") as { attempts: number }).attempts, 1);
  assert.ok(store.alarm()); assert.equal(observed.length, 0);
  fail = false;
  await job.alarm();
  assert.deepEqual(observed, [decline]);
  assert.deepEqual(cardNames, ['card:["entity","card"]']);
  assert.equal(store.alarm(), null);
  await job.receive(event); await job.alarm();
  assert.equal(reads, 2); assert.equal(observed.length, 1);
});

test("card jobs keep per-recipient order, retry only unfinished sends, and survive object restarts", async t => {
  const store = memoryStorage();
  const env = baseEnv as unknown as WorkerEnv;
  let failAliM = true; let labelReads = 0;
  const sent: { chat: string; text: string }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    if (String(input).endsWith("sendMessage")) {
      const payload = JSON.parse(String(init.body));
      assert.equal(payload.protect_content, true);
      if (payload.chat_id === "222" && failAliM) return Response.json({ ok: false }, { status: 403 });
      sent.push({ chat: payload.chat_id, text: payload.text });
      return Response.json({ ok: true, result: { message_id: sent.length } });
    }
    assert.equal(new URL(String(input)).pathname, "/card/card"); labelReads++;
    return Response.json({ id: "card", last4: "1234", name: "Meta" });
  });
  let job = new SlashCardAlerts({ storage: store.storage }, env);
  await Promise.all([job.observe(decline), job.observe(decline)]);
  await job.observe(approval);
  await job.alarm();
  assert.deepEqual(sent.map((row) => row.chat), ["111", "111"]);
  assert.match(sent[0].text, /card declined/); assert.match(sent[1].text, /payment approved again/);
  assert.ok(store.alarm());
  // Construct a fresh instance to prove that messages, recipient progress and card state persist.
  job = new SlashCardAlerts({ storage: store.storage }, env); failAliM = false;
  await job.alarm();
  assert.deepEqual(sent.map((row) => row.chat), ["111", "111", "222", "222"]);
  assert.match(sent[2].text, /card declined/); assert.match(sent[3].text, /payment approved again/);
  assert.equal(labelReads, 2); assert.equal(store.alarm(), null);
  assert.equal((await store.storage.list({ prefix: "pending:" })).size, 0);
  await job.observe({ ...approval, detailedStatus: "settled", status: "posted" });
  await job.observe(decline); await job.alarm();
  assert.equal(sent.length, 4);
});

test("recipient configuration failures roll back incident state so the event can retry after repair", async () => {
  const store = memoryStorage();
  const env = { ...baseEnv, TELEGRAM_SLASH_REJECTED_CARDS_REPORT_RECIPIENTS: "Missing" } as unknown as WorkerEnv;
  const job = new SlashCardAlerts({ storage: store.storage }, env);
  await assert.rejects(job.observe(decline), /not authorized/);
  assert.equal(store.values.size, 0); assert.equal(store.alarm(), null);
  env.TELEGRAM_SLASH_REJECTED_CARDS_REPORT_RECIPIENTS = "Ali,Ali M";
  await job.observe(decline);
  assert.equal((await store.storage.list({ prefix: "pending:" })).size, 1);
  assert.ok(store.alarm());
});

test("only the production service token can configure or inspect webhook registration", async () => {
  let setups = 0; let reads = 0;
  const env = { CONVEX_SERVICE_TOKEN: "test-service-token", SLASH_CARD_ALERTS: { getByName(name: string) {
    assert.equal(name, "webhook-registration");
    return { async configureWebhook() { setups++; return { id: "hook", status: "active" }; }, async webhookStatus() { reads++; return { id: "hook", status: "active" }; } };
  } } } as unknown as WorkerEnv;
  const request = (method: string, token?: string) => new Request("https://finance.example/api/internal/slash/card-alerts", { method, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  assert.equal((await worker.fetch(request("POST"), env)).status, 401);
  assert.equal((await worker.fetch(request("GET", "wrong"), env)).status, 401);
  assert.equal(setups + reads, 0);
  assert.equal((await worker.fetch(request("POST", env.CONVEX_SERVICE_TOKEN), env)).status, 200);
  assert.equal((await worker.fetch(request("GET", env.CONVEX_SERVICE_TOKEN), env)).status, 200);
  assert.equal((await worker.fetch(request("DELETE", env.CONVEX_SERVICE_TOKEN), env)).status, 405);
  assert.equal(setups, 1); assert.equal(reads, 1);
});

test("a failed recipient cannot prevent the other recipient from receiving a multi-page alert backlog", async t => {
  const store = memoryStorage();
  const job = new SlashCardAlerts({ storage: store.storage }, baseEnv as unknown as WorkerEnv);
  const sent: string[] = [];
  let fail = true;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    if (!String(input).endsWith("sendMessage")) return Response.json({ id: "card", last4: "1234" });
    const { chat_id: chat } = JSON.parse(String(init.body));
    if (chat === "222" && fail) return Response.json({ ok: false }, { status: 403 });
    sent.push(chat); return Response.json({ ok: true, result: {} });
  });
  for (let i = 0; i < 28; i++) await job.observe({ ...decline, id: `decline-${i}`, authorizedAt: new Date(Date.parse(decline.authorizedAt) + i * 1000).toISOString() });
  await job.alarm(); await job.alarm();
  assert.equal(sent.filter((chat) => chat === "111").length, 28);
  assert.equal(sent.filter((chat) => chat === "222").length, 0);
  fail = false;
  await job.alarm(); await job.alarm();
  assert.equal(sent.filter((chat) => chat === "111").length, 28);
  assert.equal(sent.filter((chat) => chat === "222").length, 28);
  assert.equal((await store.storage.list({ prefix: "pending:" })).size, 0);
  assert.equal(store.alarm(), null);
});
