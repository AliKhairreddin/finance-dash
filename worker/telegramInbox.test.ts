import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === "cloudflare:workers") return { url: "data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }", shortCircuit: true };
  return next(specifier, context);
} });
const { TelegramInbox } = await import("./telegramInbox");
hooks.deregister();

test("the webhook inbox persists the bank totals button and retries the saved report without rereading balances", async () => {
  const values = new Map<string, unknown>();
  const storage: DurableObjectStorage = {
    async get<T>(key: string) { return structuredClone(values.get(key)) as T | undefined; },
    async put<T>(key: string, value: T) { values.set(key, structuredClone(value)); },
    async delete(key: string) { return values.delete(key); },
    async setAlarm() {}, async deleteAlarm() {},
    async list() { throw new Error("Unexpected storage list"); },
    async transaction() { throw new Error("Unexpected storage transaction"); }
  };
  const env = {
    TELEGRAM_BOT_TOKEN: "test", TELEGRAM_AUTH_USERS_JSON: JSON.stringify({ Ali: "111" }),
    TELEGRAM_COMMAND_ADMIN_USERS: "Ali", TELEGRAM_COMMAND_READ_ONLY_USERS: "Amin",
    CONVEX_URL: "https://cash-test.convex.cloud", CONVEX_SERVICE_TOKEN: "test",
    WISE_CONNECTION_ID: "primary", WISE_ENVIRONMENT: "production", REVOLUT_CONNECTION_ID: "primary", REVOLUT_ENVIRONMENT: "production",
    SLASH_BASE_URL: "https://api.slash.com", SLASH_API_KEY: "test", SLASH_LEGAL_ENTITY_ID: "test"
  } as WorkerEnv;
  const originalFetch = globalThis.fetch;
  let queries = 0;
  let rejectSend = true;
  const messages: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/query") {
      queries++;
      return Response.json({ status: "success", value: [
        { id: "lmd", source: "wise", wiseEntity: "lmd", name: "LMD", balance: 100, currency: "USD", status: "live" },
        { id: "dn", source: "wise", wiseEntity: "dn", name: "DN", balance: 200, currency: "USD", status: "live" },
        { id: "revolut", source: "revolut", name: "Main", balance: 300, currency: "USD", status: "live" }
      ] });
    }
    if (url.pathname === "/virtual-account") return Response.json({ items: [{ virtualAccount: { id: "primary", name: "Primary", accountId: "parent", accountType: "primary" }, balance: { amountCents: 40000 } }], metadata: { count: 1 } });
    if (url.pathname.endsWith("/sendChatAction")) return Response.json({ ok: true, result: true });
    if (url.pathname.endsWith("/sendMessage")) {
      if (rejectSend) throw new Error("Telegram unavailable");
      messages.push(JSON.parse(String(init?.body)));
      return Response.json({ ok: true, result: {} });
    }
    throw new Error(`Unexpected request: ${url.pathname}`);
  };
  try {
    const context = { storage };
    const inbox = new TelegramInbox(context, env);
    await inbox.receive({ update_id: 1, message: { message_id: 1, from: { id: 111, first_name: "Ali" }, chat: { id: 111, type: "private", first_name: "Ali" }, text: "/cash" } });
    await assert.rejects(inbox.alarm());
    assert.ok(values.has("reply:1"));
    rejectSend = false;
    await new TelegramInbox(context, env).alarm();
    assert.equal(queries, 1);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].protect_content, undefined);
    assert.deepEqual(messages[0].reply_markup, { inline_keyboard: [[{ text: "Copy bank totals", copy_text: { text: "Wise LMD ≈ USD 100.00\nWise DN ≈ USD 200.00\nRevolut ≈ USD 300.00\nSlash ≈ USD 400.00" } }]] });
    assert.equal(values.has("reply:1"), false);
  } finally { globalThis.fetch = originalFetch; }
});
