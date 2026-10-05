import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import type { CashReportKind } from "./telegramCashReport";

const hooks = registerHooks({ resolve(specifier, context, next) {
  if (specifier === "cloudflare:workers") return { url: "data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }", shortCircuit: true };
  return next(specifier, context);
} });
const { TelegramOtpState } = await import("./telegramOtpState");
hooks.deregister();

test("scheduled cash delivery allows copying while daily Slash reports stay protected and retries stay deduplicated", async () => {
  const originalFetch = globalThis.fetch;
  const payloads: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    payloads.push(JSON.parse(String(init?.body)));
    return Response.json({ ok: true, result: {} });
  };
  try {
    const kinds: CashReportKind[] = ["weekly-cash", "daily-slash", "daily-slash-cashback", "daily-slash-rejected-cards"];
    for (const kind of kinds) {
      const data = new Map<string, unknown>();
      const storage = {
        async get<T>(key: string) { return structuredClone(data.get(key)) as T | undefined; },
        async put<T>(key: string, value: T) { data.set(key, structuredClone(value)); }
      };
      const state = new TelegramOtpState({ storage } as DurableObjectState, {
        TELEGRAM_BOT_TOKEN: "test-token", TELEGRAM_AUTH_USERS_JSON: JSON.stringify({ Ali: "111" }),
        TELEGRAM_CASH_REPORT_RECIPIENTS: "Ali", TELEGRAM_SLASH_REPORT_RECIPIENTS: "Ali",
        TELEGRAM_SLASH_CASHBACK_REPORT_RECIPIENTS: "Ali", TELEGRAM_SLASH_REJECTED_CARDS_REPORT_RECIPIENTS: "Ali"
      } as WorkerEnv);
      const before = payloads.length;
      assert.equal(await state.deliverCashReport("2026-10-05", "Ali", "Bank balances", kind), true);
      assert.equal(payloads.at(-1)?.chat_id, "111");
      assert.equal(payloads.at(-1)?.protect_content, kind === "weekly-cash" ? undefined : true);
      assert.equal(await state.deliverCashReport("2026-10-05", "Ali", "Bank balances", kind), false);
      assert.equal(payloads.length, before + 1);
    }
  } finally { globalThis.fetch = originalFetch; }
});
