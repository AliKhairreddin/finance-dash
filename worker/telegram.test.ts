import assert from "node:assert/strict";
import test from "node:test";
import { handleTelegramWebhook, parseTelegramAuthUsers } from "./telegram";

const baseEnv = {
  PUBLIC_APP_URL: "https://finance.example",
  TELEGRAM_BOT_TOKEN: "123456:test-bot-token",
  TELEGRAM_AUTH_USERS_JSON: JSON.stringify({ Ali: "5518715264" }),
  TELEGRAM_WEBHOOK_SECRET: "test-webhook-secret",
  TELEGRAM_OTP_STATE: {}
} as never;

function telegramUpdate(chatId: number, firstName: string, username?: string) {
  return {
    update_id: 1,
    message: {
      message_id: 2,
      from: {
        id: chatId,
        is_bot: false,
        first_name: firstName,
        ...(username ? { username } : {})
      },
      chat: { id: chatId, first_name: firstName, type: "private" },
      text: "hello"
    }
  };
}

function webhookRequest(update: unknown, secret = "test-webhook-secret"): Request {
  return new Request("https://finance.example/telegram/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": secret
    },
    body: JSON.stringify(update)
  });
}

test("Telegram user mappings normalize login names and reject ambiguous entries", () => {
  assert.deepEqual(parseTelegramAuthUsers(JSON.stringify({ Ali: "5518715264" })), [{
    username: "Ali",
    normalizedUsername: "ali",
    chatId: "5518715264"
  }]);
  assert.equal(parseTelegramAuthUsers("not-json"), null);
  assert.equal(parseTelegramAuthUsers(JSON.stringify({ "Ali Smith": "5518715264" })), null);
  assert.equal(parseTelegramAuthUsers(JSON.stringify({ Ali: "5518715264", ali: "123456789" })), null);
  assert.equal(parseTelegramAuthUsers(JSON.stringify({ Ali: "5518715264", Amin: "5518715264" })), null);
});

test("an unmapped coworker receives their chat ID by messaging the bot", async () => {
  const replies: Array<{ chatId: string; text: string }> = [];
  const response = await handleTelegramWebhook(
    webhookRequest(telegramUpdate(777888999, "Amin", "amin_dn")),
    baseEnv,
    {
      async sendMessage(_env, chatId, text) {
        replies.push({ chatId, text });
      }
    }
  );

  assert.equal(response?.status, 204);
  assert.deepEqual(replies, [{
    chatId: "777888999",
    text: "Hi Amin (@amin_dn). Your Finance Dash chat ID is 777888999. Send this chat ID to your dashboard administrator together with the username you want to use."
  }]);
});

test("a mapped user receives a connection confirmation", async () => {
  const replies: string[] = [];
  const response = await handleTelegramWebhook(
    webhookRequest(telegramUpdate(5518715264, "Ali")),
    baseEnv,
    {
      async sendMessage(_env, _chatId, text) {
        replies.push(text);
      }
    }
  );

  assert.equal(response?.status, 204);
  assert.deepEqual(replies, [
    "Hi Ali. You are connected to Finance Dash as Ali. You can receive sign-in codes here."
  ]);
});

test("webhook requests require Telegram's configured secret header", async () => {
  let sent = false;
  const response = await handleTelegramWebhook(
    webhookRequest(telegramUpdate(777888999, "Amin"), "wrong-secret"),
    baseEnv,
    { async sendMessage() { sent = true; } }
  );
  assert.equal(response?.status, 404);
  assert.equal(sent, false);
});

test("group messages and malformed updates are ignored", async () => {
  let sent = false;
  const groupUpdate = telegramUpdate(777888999, "Amin") as Record<string, any>;
  groupUpdate.message.chat.type = "group";
  const groupResponse = await handleTelegramWebhook(
    webhookRequest(groupUpdate),
    baseEnv,
    { async sendMessage() { sent = true; } }
  );
  assert.equal(groupResponse?.status, 204);
  assert.equal(sent, false);

  const malformedResponse = await handleTelegramWebhook(
    new Request("https://finance.example/telegram/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "X-Telegram-Bot-Api-Secret-Token": "test-webhook-secret"
      },
      body: "not-json"
    }),
    baseEnv
  );
  assert.equal(malformedResponse?.status, 400);
});
