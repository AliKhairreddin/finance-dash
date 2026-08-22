import assert from "node:assert/strict";
import test from "node:test";
import { buildTelegramOtpMessage, parseTelegramAuthUsers, pollTelegramUpdates } from "./telegram";

const baseEnv = {
  TELEGRAM_BOT_TOKEN: "123456:test-bot-token",
  TELEGRAM_AUTH_USERS_JSON: JSON.stringify({ Ali: "5518715264" })
} as never;

function telegramUpdate(updateId: number, chatId: number, firstName: string, username?: string) {
  return {
    update_id: updateId,
    message: {
      message_id: updateId + 1,
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

test("Telegram user mappings normalize login names, including internal spaces", () => {
  assert.deepEqual(parseTelegramAuthUsers(JSON.stringify({
    Ali: "5518715264",
    "  Ali   M  ": "6064572340"
  })), [
    { username: "Ali", normalizedUsername: "ali", chatId: "5518715264" },
    { username: "Ali M", normalizedUsername: "ali m", chatId: "6064572340" }
  ]);
  assert.equal(parseTelegramAuthUsers("not-json"), null);
  assert.equal(parseTelegramAuthUsers(JSON.stringify({ Ali: "5518715264", ali: "123456789" })), null);
  assert.equal(parseTelegramAuthUsers(JSON.stringify({ "Ali M": "5518715264", "ali  m": "123456789" })), null);
  assert.equal(parseTelegramAuthUsers(JSON.stringify({ Ali: "5518715264", Amin: "5518715264" })), null);
});

test("Telegram OTP messages lead with a formatted code and provide a native copy button", () => {
  assert.deepEqual(buildTelegramOtpMessage("6064572340", "123456"), {
    chat_id: "6064572340",
    text: "123456 — your Finance Dash sign-in code.\nExpires in 5 minutes. If you didn’t request it, ignore this message.",
    entities: [{ type: "code", offset: 0, length: 6 }],
    reply_markup: {
      inline_keyboard: [[{
        text: "Copy code",
        copy_text: { text: "123456" }
      }]]
    },
    protect_content: true
  });
  assert.throws(() => buildTelegramOtpMessage("6064572340", "12345"), /OTP was invalid/);
});

test("an unmapped coworker receives their chat ID after messaging the bot", async () => {
  const replies: Array<{ chatId: string; text: string }> = [];
  const offsets: number[] = [];
  const result = await pollTelegramUpdates(baseEnv, 40, {
    async getUpdates(_env, offset) {
      offsets.push(offset);
      return [telegramUpdate(40, 777888999, "Amin", "amin_dn")];
    },
    async sendMessage(_env, chatId, text) {
      replies.push({ chatId, text });
    }
  });

  assert.deepEqual(offsets, [40]);
  assert.deepEqual(result, { nextOffset: 41, processed: 1 });
  assert.deepEqual(replies, [{
    chatId: "777888999",
    text: "Hi Amin (@amin_dn). Your Finance Dash chat ID is 777888999. Send this chat ID to your dashboard administrator together with the username you want to use."
  }]);
});

test("a mapped user receives a connection confirmation", async () => {
  const replies: string[] = [];
  const result = await pollTelegramUpdates(baseEnv, 100, {
    async getUpdates() {
      return [telegramUpdate(100, 5518715264, "Ali")];
    },
    async sendMessage(_env, _chatId, text) {
      replies.push(text);
    }
  });

  assert.deepEqual(result, { nextOffset: 101, processed: 1 });
  assert.deepEqual(replies, [
    "Hi Ali. You are connected to Finance Dash as Ali. You can receive sign-in codes here."
  ]);
});

test("group messages are ignored while their update offset advances", async () => {
  let sent = false;
  const groupUpdate = telegramUpdate(72, 777888999, "Amin") as Record<string, any>;
  groupUpdate.message.chat.type = "group";
  const result = await pollTelegramUpdates(baseEnv, 72, {
    async getUpdates() { return [groupUpdate]; },
    async sendMessage() { sent = true; }
  });

  assert.deepEqual(result, { nextOffset: 73, processed: 1 });
  assert.equal(sent, false);
});

test("already-consumed updates are skipped without duplicate replies", async () => {
  let sends = 0;
  const result = await pollTelegramUpdates(baseEnv, 51, {
    async getUpdates() {
      return [telegramUpdate(50, 777888999, "Amin"), telegramUpdate(51, 777888999, "Amin")];
    },
    async sendMessage() { sends += 1; }
  });

  assert.deepEqual(result, { nextOffset: 52, processed: 1 });
  assert.equal(sends, 1);
});

test("invalid polling offsets, mappings, and update IDs fail closed", async () => {
  await assert.rejects(() => pollTelegramUpdates(baseEnv, -1), /offset was invalid/);
  await assert.rejects(
    () => pollTelegramUpdates(
      {
        ...(baseEnv as unknown as Record<string, unknown>),
        TELEGRAM_AUTH_USERS_JSON: "not-json"
      } as never,
      0,
      { async getUpdates() { return []; } }
    ),
    /mapping was invalid/
  );
  await assert.rejects(
    () => pollTelegramUpdates(baseEnv, 0, {
      async getUpdates() { return [{ update_id: "invalid" }]; }
    }),
    /update was invalid/
  );
});

test("a failed reply leaves the update available for the next polling run", async () => {
  await assert.rejects(
    () => pollTelegramUpdates(baseEnv, 90, {
      async getUpdates() { return [telegramUpdate(90, 777888999, "Amin")]; },
      async sendMessage() { throw new Error("Telegram send failed"); }
    }),
    /Telegram send failed/
  );
});
