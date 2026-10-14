import assert from "node:assert/strict";
import test from "node:test";
import { buildTelegramTransactionListItem, handleTelegramCommand } from "./handler";
import type { TelegramAuthUser } from "./telegram";
import { financeTelegramCommands } from "./telegramCommandCatalog";

const env = {
  TELEGRAM_COMMAND_ADMIN_USERS: "Ali,Ali M",
  TELEGRAM_COMMAND_READ_ONLY_USERS: "Amin,Sanjin,Sani,Ben,Beno"
} as never;

const ali: TelegramAuthUser = {
  username: "Ali",
  normalizedUsername: "ali",
  chatId: "5518715264"
};
const amin: TelegramAuthUser = {
  username: "Amin",
  normalizedUsername: "amin",
  chatId: "777888999"
};

test("Kraken and Trust commands accept both Alis, preserve message identity, and default to USDC out", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ path: string; args: Array<Record<string, unknown>> }> = [];
  globalThis.fetch = async (_input, init) => {
    calls.push(JSON.parse(String(init?.body)));
    return Response.json({ status: "success", value: { id: "transaction1", duplicate: false } });
  };
  try {
    const commandEnv = { ...(env as unknown as Record<string, unknown>), CONVEX_URL: "https://ledger-test.convex.cloud", CONVEX_SERVICE_TOKEN: "test", PUBLIC_APP_URL: "https://finance.example" } as never;
    const sentAt = Date.parse("2026-10-14T02:30:00Z") / 1000;
    for (const [text, user, source] of [["/Kraken Acme Ltd 1,250.50", ali, "kraken"], ["\\Trust Acme Ltd 500", { ...ali, username: "Ali M", normalizedUsername: "ali m" }, "trust"]] as const) {
      const reply = await handleTelegramCommand(commandEnv, user, "administrator", text, { updateId: 99, sentAt });
      assert.match(reply as string, /Recorded in/);
      const input = calls.at(-1)!;
      assert.equal(input.path, "manualBankTransactions:createFromTelegram");
      assert.equal(input.args[0].currency, "USDC");
      assert.equal(input.args[0].direction, "out");
      assert.equal(input.args[0].date, "2026-10-13");
      assert.equal(input.args[0].source, source);
      assert.equal(input.args[0].companyName, "Acme Ltd");
      assert.equal(input.args[0].intakeKey, `telegram:${ali.chatId}:99`);
    }
    assert.match(await handleTelegramCommand(commandEnv, amin, "read-only", "/kraken Acme 5", { updateId: 100, sentAt }) as string, /Access denied/);
    assert.match(await handleTelegramCommand(commandEnv, ali, "administrator", "/trust Acme 5", { updateId: 100 }) as string, /message date is missing/);
    assert.equal(calls.length, 2);
  } finally { globalThis.fetch = originalFetch; }
});

test("Telegram command handler reports the configured full-access identity", async () => {
  assert.equal(
    await handleTelegramCommand(env, ali, "administrator", "/whoami"),
    "👤 Finance Dash access\n\nUser: Ali\nRole: Full administrator"
  );
  const menu = await handleTelegramCommand(env, ali, "administrator", "/menu");
  assert.equal(typeof menu, "string");
  assert.match(menu as string, /Full administrator/u);
  assert.match(menu as string, /▶ TAP TO RUN/u);
  assert.match(menu as string, /⚙ TAP FOR DEFAULTS/u);
  assert.match(menu as string, /✍ TYPE DETAILS FIRST/u);
  assert.match(menu as string, /🔒 ADMIN ACTIONS/u);
  for (const { command, input } of financeTelegramCommands) {
    assert.match(menu as string, new RegExp(`${input === "required" ? "" : "/"}${command}\\b`, "u"));
  }
  assert.doesNotMatch(menu as string, /\/search\b/u);
});

test("Telegram command handler keeps CEO users read-only", async () => {
  assert.equal(
    await handleTelegramCommand(env, amin, "read-only", "/whoami"),
    "👤 Finance Dash access\n\nUser: Amin\nRole: CEO read-only"
  );
  assert.equal(
    await handleTelegramCommand(env, amin, "read-only", "/sync CONFIRM"),
    "⛔ Access denied\n\nThis is an administrator action command"
  );
  const menu = await handleTelegramCommand(env, amin, "read-only", "/menu");
  assert.equal(typeof menu, "string");
  assert.doesNotMatch(menu as string, /\/sync/u);
  for (const { command, access } of financeTelegramCommands) {
    if (access === "read") assert.match(menu as string, new RegExp(`${command}\\b`, "u"));
  }
});

test("Telegram command handler rejects a mismatched role and unknown commands", async () => {
  assert.equal(
    await handleTelegramCommand(env, ali, "read-only", "/overview"),
    "⛔ Access denied\n\nThis Telegram account does not have that Finance Dash role."
  );
  assert.equal(
    await handleTelegramCommand(env, ali, "administrator", "/not_a_command"),
    "❓ Unknown command\n\nUnknown command. Use /menu."
  );
});

test("required-detail commands explain their syntax instead of running empty", async () => {
  assert.equal(
    await handleTelegramCommand(env, ali, "administrator", "/search"),
    "✍️ /search needs details\n\nSyntax: /search <text>\nExample: /search Meta\n\nNothing was changed."
  );
  assert.equal(
    await handleTelegramCommand(env, ali, "administrator", "/help search"),
    "ℹ️ /search\nSearch this month's transactions\n\n✍ Type the required details after the command.\nSyntax: /search <text>\nExample: /search Meta"
  );
});

test("transaction list items stay readable and omit long backend IDs", () => {
  const item = buildTelegramTransactionListItem({
    id: "slash-v2-73615f32767a37766c753737677130746167675f74785f336f3865646133306b30756d31",
    date: "2026-09-03",
    direction: "out",
    amount: 808.47,
    currency: "USD",
    merchantName: "FACEBK *HSD7L5J5D4",
    counterparty: "Meta",
    accountName: "Business Platinum",
    slashVirtualAccountName: "Primary Account"
  } as never);

  assert.equal(item, "🔴 −$808.47 · FACEBK *HSD7L5J5D4\nSep 3, 2026 · Primary Account");
  assert.doesNotMatch(item, /slash-v2/u);
});

test("Telegram screenshot command renders an authenticated dashboard page", async () => {
  const calls: Array<{ name: string; options: Record<string, any> }> = [];
  const screenshotEnv = {
    ...(env as unknown as Record<string, unknown>),
    AUTH_SESSION_SECRET: "test-session-secret-that-is-long-enough",
    PUBLIC_APP_URL: "https://finance.example",
    BROWSER: {
      async quickAction(name: string, options: Record<string, any>) {
        calls.push({ name, options });
        return new Response(new Uint8Array([137, 80, 78, 71]), {
          headers: { "Content-Type": "image/png" }
        });
      }
    }
  } as never;
  const reply = await handleTelegramCommand(screenshotEnv, ali, "administrator", "/screenshot overview");

  assert.equal(typeof reply, "object");
  assert.equal((reply as { document: { contentType: string } }).document.contentType, "image/png");
  assert.equal(calls[0]?.name, "screenshot");
  assert.equal(calls[0]?.options.url, "https://finance.example/");
  assert.equal(calls[0]?.options.cookies[0].name, "__Host-finance_session");
  assert.notEqual(calls[0]?.options.cookies[0].value, "");
});
