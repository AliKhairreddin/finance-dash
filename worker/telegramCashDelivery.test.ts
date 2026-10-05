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

test("all scheduled reports allow copying and cash has one button for individual bank totals", async () => {
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
      const bankTotals = "Wise LMD ≈ USD 100.00\nWise DN ≈ USD 200.00\nRevolut ≈ USD 300.00\nSlash ≈ USD 400.00";
      const report = kind === "weekly-cash" ? `Bank total ≈ USD 1,000.00\n${bankTotals}\nCrypto (separate)\n• BTC 1.00000000 ≈ USD 80,000.00` : "Daily report";
      assert.equal(await state.deliverCashReport("2026-10-05", "Ali", report, kind), true);
      assert.equal(payloads.at(-1)?.chat_id, "111");
      assert.equal(payloads.at(-1)?.protect_content, undefined);
      assert.deepEqual(payloads.at(-1)?.reply_markup, { inline_keyboard: [[{
        text: kind === "weekly-cash" ? "Copy bank totals" : "Copy text",
        copy_text: { text: kind === "weekly-cash" ? bankTotals : report }
      }]] });
      assert.equal(await state.deliverCashReport("2026-10-05", "Ali", "Bank balances", kind), false);
      assert.equal(payloads.length, before + 1);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("a scheduled cash retry copies the saved amounts even when the newly built report changes", async () => {
  const originalFetch = globalThis.fetch;
  const data = new Map<string, unknown>();
  const storage = {
    async get<T>(key: string) { return structuredClone(data.get(key)) as T | undefined; },
    async put<T>(key: string, value: T) { data.set(key, structuredClone(value)); }
  };
  const state = new TelegramOtpState({ storage } as DurableObjectState, {
    TELEGRAM_BOT_TOKEN: "test-token", TELEGRAM_AUTH_USERS_JSON: JSON.stringify({ Ali: "111" }), TELEGRAM_CASH_REPORT_RECIPIENTS: "Ali"
  } as WorkerEnv);
  let fail = true;
  const payloads: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    if (fail) throw new Error("Unavailable");
    payloads.push(JSON.parse(String(init?.body)));
    return Response.json({ ok: true, result: {} });
  };
  try {
    const report = "Wise LMD ≈ USD 100.00\n" + Array.from({ length: 80 }, (_, i) => `Currency line ${i}: ${"x".repeat(70)}`).join("\n") + "\nSlash ≈ USD 200.00";
    await assert.rejects(state.deliverCashReport("2026-10-05", "Ali", report, "weekly-cash"));
    fail = false;
    await state.deliverCashReport("2026-10-05", "Ali", "Wise LMD ≈ USD 999.00", "weekly-cash");
    assert.ok(payloads.length > 1);
    assert.deepEqual(payloads[0].reply_markup, { inline_keyboard: [[{ text: "Copy bank totals", copy_text: { text: "Wise LMD ≈ USD 100.00\nSlash ≈ USD 200.00" } }]] });
    assert.ok(payloads.slice(1).every((payload) => payload.reply_markup === undefined));
  } finally { globalThis.fetch = originalFetch; }
});
