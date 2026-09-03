import assert from "node:assert/strict";
import test from "node:test";
import { handleTelegramCommand } from "./handler";
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

test("Telegram command handler reports the configured full-access identity", async () => {
  assert.equal(
    await handleTelegramCommand(env, ali, "administrator", "/whoami"),
    "Ali · full administrator commands"
  );
  const menu = await handleTelegramCommand(env, ali, "administrator", "/menu");
  assert.equal(typeof menu, "string");
  assert.match(menu as string, /full access/u);
  for (const { command } of financeTelegramCommands) assert.match(menu as string, new RegExp(`/${command}\\b`, "u"));
});

test("Telegram command handler keeps CEO users read-only", async () => {
  assert.equal(
    await handleTelegramCommand(env, amin, "read-only", "/whoami"),
    "Amin · CEO read-only commands"
  );
  assert.equal(
    await handleTelegramCommand(env, amin, "read-only", "/sync CONFIRM"),
    "⚠️ This is an administrator action command"
  );
  const menu = await handleTelegramCommand(env, amin, "read-only", "/menu");
  assert.equal(typeof menu, "string");
  assert.doesNotMatch(menu as string, /\/sync/u);
  for (const { command, access } of financeTelegramCommands) {
    if (access === "read") assert.match(menu as string, new RegExp(`/${command}\\b`, "u"));
  }
});

test("Telegram command handler rejects a mismatched role and unknown commands", async () => {
  assert.equal(
    await handleTelegramCommand(env, ali, "read-only", "/overview"),
    "⚠️ Telegram command access denied"
  );
  assert.equal(
    await handleTelegramCommand(env, ali, "administrator", "/not_a_command"),
    "⚠️ Unknown command. Use /menu."
  );
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
