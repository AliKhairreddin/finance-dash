import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { ConvexHttpClient } from "convex/browser";
import { getFunctionName } from "convex/server";
import worker, { handleTelegramCommand } from "./handler";
import { createAuthSessionToken } from "./auth";
import type { PartnerReportData, PartnerUpdateStatus } from "../shared/partnerUpdates";

// Exercise the production job class in the existing Node test runner. Only the
// Cloudflare base class is replaced; storage, rendering and Telegram are explicit fakes.
const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === "cloudflare:workers") return { url: "data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }", shortCircuit: true };
  return next(specifier, context);
} });
const { PartnerUpdates } = await import("./partnerUpdates");
hooks.deregister();

const users = { Amin: "1", Sani: "2", Ben: "3", Ali: "4", "Ali M": "5" };
const baseEnv = { TELEGRAM_AUTH_USERS_JSON: JSON.stringify(users), TELEGRAM_COMMAND_ADMIN_USERS: "Ali,Ali M", TELEGRAM_COMMAND_READ_ONLY_USERS: "Amin,Sani,Ben", TELEGRAM_BOT_TOKEN: "test", AUTH_SESSION_SECRET: "a-test-secret-with-at-least-32-characters", PUBLIC_APP_URL: "https://finance.example", TELEGRAM_OTP_STATE: { getByName: () => ({ pollOnboarding: async () => 0 }) } };
const data: PartnerReportData = { capturedAt: "2026-09-09T12:00:00Z", cashFlow: { id: "cash", asOfDate: "2026-09-09", updatedAt: "2026-09-09", createdAt: "2026-09-09", cashAccounts: [], receivables: [], openBalances: [], payables: [], investments: [] }, history: [], rates: [], invoices: [] };
const id = "11111111-1111-4111-8111-111111111111";

test("durable job freezes reports once, deduplicates starts, and retries only rejected recipients", async t => {
  const stored = new Map<string, unknown>();
  let alarm: number | Date | null = null;
  const storage = { get: async <T>(key: string) => structuredClone(stored.get(key)) as T | undefined,
    put: async <T>(key: string, value: T) => { stored.set(key, structuredClone(value)); }, delete: async (key: string) => stored.delete(key),
    setAlarm: async (value: number | Date) => { alarm = value; }, deleteAlarm: async () => { alarm = null; } };
  let renders = 0;
  const sent: string[] = [];
  let rejectSani = true;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    if (url.endsWith("sendMessage")) return Response.json({ ok: true, result: {} });
    const chat = (init.body as FormData).get("chat_id") as string;
    if (chat === "2" && rejectSani) return Response.json({ ok: false }, { status: 403 });
    sent.push(chat);
    return Response.json({ ok: true, result: [{ message_id: 1 }, { message_id: 2 }] });
  });
  const env = { ...baseEnv,
    ASSETS: { fetch: async (request: Request) => new Response("/* bundle */", { headers: { "content-type": request.url.endsWith("js") ? "application/javascript" : "text/css" } }) },
    BROWSER: { quickAction: async () => { renders++; return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), { headers: { "content-type": "image/png" } }); } }
  } as unknown as WorkerEnv;
  const job = new PartnerUpdates({ storage }, env);
  await Promise.all([job.start(id, "Ali M", data), job.start(id, "Ali M", data)]);
  assert.ok(alarm);
  await job.alarm();
  assert.equal(renders, 2);
  assert.deepEqual(sent, ["1", "3", "4", "5"]);
  assert.equal((await job.status())?.status, "partial");
  assert.equal(alarm, null);
  rejectSani = false;
  await job.retry("Ali");
  await job.alarm();
  assert.equal(renders, 2);
  assert.deepEqual(sent, ["1", "3", "4", "5", "2"]);
  assert.equal((await job.status())?.status, "complete");
  await job.start(id, "Ali", data); await job.alarm();
  assert.equal(sent.length, 5);
});

async function request(path: string, username: string, method = "GET", origin?: string) {
  const token = await createAuthSessionToken(baseEnv.AUTH_SESSION_SECRET, "finance.example", username);
  return new Request(`https://finance.example${path}`, { method, headers: { Cookie: `__Host-finance_session=${token}`, ...(origin ? { Origin: origin } : {}) } });
}

test("website sharing denies partner sessions and cross-origin requests, and repeated request IDs return the existing job", async () => {
  const existing = { id, status: "complete" } as PartnerUpdateStatus;
  const env = { ...baseEnv, PARTNER_UPDATES: { getByName: () => ({ status: async () => existing, start: async () => { throw new Error("Must not create again"); } }) } } as unknown as WorkerEnv;
  assert.equal((await worker.fetch(await request(`/api/partner-updates/${id}`, "amin", "POST", "https://finance.example"), env)).status, 403);
  assert.equal((await worker.fetch(await request(`/api/partner-updates/${id}`, "ali", "POST", "https://evil.example"), env)).status, 403);
  const response = await worker.fetch(await request(`/api/partner-updates/${id}`, "ali m", "POST", "https://finance.example"), env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), existing);
  assert.deepEqual(await (await worker.fetch(await request("/api/partner-updates", "ali"), env)).json(), { recipients: ["Amin", "Sani", "Ben", "Ali", "Ali M"] });
});

test("Telegram and website create the same frozen report payload; readers cannot broadcast", async t => {
  const starts: Array<{ username: string; data: PartnerReportData }> = [];
  const env = { ...baseEnv, CONVEX_URL: "https://example.convex.cloud", CONVEX_SERVICE_TOKEN: "test",
    PARTNER_UPDATES: { getByName: () => ({ status: async () => null, start: async (_id: string, username: string, data: PartnerReportData) => { starts.push({ username, data }); return { id, status: "queued" }; } }) }
  } as unknown as WorkerEnv;
  t.mock.method(ConvexHttpClient.prototype, "query", async (fn: Parameters<ConvexHttpClient["query"]>[0]) => {
    const name = getFunctionName(fn);
    if (name === "dashboard:getState") return { cashFlowSnapshots: [data.cashFlow] };
    if (name === "banking:getActivityMetadata") return { accounts: [], syncStates: [], syncHealth: [] };
    if (name === "banking:getClassificationBacklog") return { transactions: [], totalCount: 0 };
    throw new Error(`Unexpected query: ${name}`);
  });
  t.mock.method(ConvexHttpClient.prototype, "mutation", async () => null);
  const ali = { username: "Ali", normalizedUsername: "ali", chatId: "4" };
  const reply = await handleTelegramCommand(env, ali, "administrator", "/share_updates");
  assert.match(String(reply), /Preparing cash-flow/);
  const response = await worker.fetch(await request(`/api/partner-updates/${id}`, "ali", "POST", "https://finance.example"), env);
  assert.equal(response.status, 202);
  assert.equal(starts.length, 2);
  assert.deepEqual(starts[0].data.cashFlow, starts[1].data.cashFlow);
  assert.deepEqual(starts[0].data.invoices, starts[1].data.invoices);
  assert.match(String(await handleTelegramCommand(env, { username: "Amin", normalizedUsername: "amin", chatId: "1" }, "read-only", "/share_updates")), /Access denied/);
  assert.equal(starts.length, 2);
});
