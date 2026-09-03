import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTelegramOtpMessage,
  buildTelegramSignInAlertMessage,
  configureTelegramBotCommands,
  formatTelegramTimestamp,
  parseTelegramAuthUsers,
  pollTelegramUpdates,
  sendTelegramMessage
} from "./telegram";
import { financeTelegramCommands, readOnlyFinanceTelegramCommands } from "./telegramCommandCatalog";

const baseEnv = {
  TELEGRAM_BOT_TOKEN: "123456:test-bot-token",
  TELEGRAM_AUTH_USERS_JSON: JSON.stringify({ Ali: "5518715264" }),
  TELEGRAM_COMMAND_ADMIN_USERS: "Ali,Ali M",
  TELEGRAM_COMMAND_READ_ONLY_USERS: "Amin,Sanjin,Sani,Ben,Beno"
} as never;

function telegramUpdate(
  updateId: number,
  chatId: number,
  firstName: string,
  username?: string,
  text = "hello"
) {
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
      text
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

test("passwordless sign-in alerts include the security details and revocation instruction", () => {
  assert.deepEqual(buildTelegramSignInAlertMessage("6064572340", {
    username: "Ali M",
    occurredAt: "2026-08-22 20:15:00 UTC",
    ipAddress: "203.0.113.42",
    device: "Safari on iPhone"
  }), {
    chat_id: "6064572340",
    text: "🔐 Finance Dash sign-in detected\n\nAccount: Ali M\nTime: Aug 22, 2026 · 4:15 PM EDT\nIP address: 203.0.113.42\nDevice: Safari on iPhone\n\n⚠️ Not you? Contact your dashboard administrator immediately to revoke this session and re-enable OTP.",
    protect_content: true
  });
  assert.equal(formatTelegramTimestamp("2026-01-22T20:15:00.000Z"), "Jan 22, 2026 · 3:15 PM EST");
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
    text: "👋 Connect Finance Dash\n\nHi Amin (@amin_dn).\nChat ID: 777888999\n\nSend this chat ID and your requested Finance Dash username to a dashboard administrator."
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
    "✅ Finance Dash connected\n\nHi Ali. You’re connected as Ali.\nSign-in codes will arrive in this private chat."
  ]);
});

test("administrator and CEO users receive their assigned command roles while Meet is excluded", async () => {
  const env = {
    ...(baseEnv as unknown as Record<string, unknown>),
    TELEGRAM_AUTH_USERS_JSON: JSON.stringify({
      Ali: "5518715264",
      "Ali M": "6064572340",
      Amin: "777888999",
      Sani: "777888998",
      Ben: "777888997"
    }),
    TELEGRAM_TRANSACTION_REVIEWER_USERS_JSON: JSON.stringify({ Meet: "777888996" })
  } as never;
  const handled: Array<{ username: string; role: string; text: string }> = [];
  const replies: Array<{ chatId: string; text: string; protectContent: boolean | undefined }> = [];
  const updates = [
    telegramUpdate(200, 5518715264, "Ali", undefined, "/overview"),
    telegramUpdate(201, 6064572340, "Ali M", undefined, "/sync CONFIRM"),
    telegramUpdate(202, 777888999, "Amin", undefined, "/balances"),
    telegramUpdate(203, 777888998, "Sani", undefined, "/analytics this-month"),
    telegramUpdate(204, 777888997, "Ben", undefined, "/invoices"),
    telegramUpdate(205, 777888996, "Meet", undefined, "/overview")
  ];

  const result = await pollTelegramUpdates(env, 200, {
    async getUpdates() { return updates; },
    async handleCommand(_env, user, role, text) {
      handled.push({ username: user.username, role, text });
      return `${user.username}:${role}`;
    },
    async sendMessage(_env, chatId, text, protectContent) {
      replies.push({ chatId, text, protectContent });
    }
  });

  assert.deepEqual(result, { nextOffset: 206, processed: 6 });
  assert.deepEqual(handled, [
    { username: "Ali", role: "administrator", text: "/overview" },
    { username: "Ali M", role: "administrator", text: "/sync CONFIRM" },
    { username: "Amin", role: "read-only", text: "/balances" },
    { username: "Sani", role: "read-only", text: "/analytics this-month" },
    { username: "Ben", role: "read-only", text: "/invoices" }
  ]);
  assert.deepEqual(replies.slice(0, 5).map(({ text, protectContent }) => ({ text, protectContent })), [
    { text: "Ali:administrator", protectContent: true },
    { text: "Ali M:administrator", protectContent: true },
    { text: "Amin:read-only", protectContent: true },
    { text: "Sani:read-only", protectContent: true },
    { text: "Ben:read-only", protectContent: true }
  ]);
  assert.deepEqual(replies[5], {
    chatId: "777888996",
    text: "✅ Finance Dash connected\n\nHi Meet. You’re connected as Meet.\nSign-in codes will arrive in this private chat.",
    protectContent: false
  });
});

test("Telegram messages disable link previews and reject invalid message lengths", async () => {
  const originalFetch = globalThis.fetch;
  const payloads: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Response.json({ ok: true, result: {} });
  };
  try {
    await sendTelegramMessage(baseEnv, "5518715264", "🔗 Finance Dash\n\nhttps://finance.example", true);
    assert.deepEqual(payloads[0]?.link_preview_options, { is_disabled: true });
    assert.equal(payloads[0]?.protect_content, true);
    await assert.rejects(
      () => sendTelegramMessage(baseEnv, "5518715264", "x".repeat(4_097)),
      /message was invalid/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("command documents are delivered to the authorized chat with forwarding protection", async () => {
  const documents: Array<{ chatId: string; fileName: string; protectContent: boolean | undefined }> = [];
  let sentMessage = false;
  const result = await pollTelegramUpdates(baseEnv, 300, {
    async getUpdates() {
      return [telegramUpdate(300, 5518715264, "Ali", undefined, "/invoice_pdf 2026-001")];
    },
    async handleCommand() {
      return {
        document: {
          bytes: new Uint8Array([37, 80, 68, 70]).buffer,
          contentType: "application/pdf",
          fileName: "invoice-2026-001.pdf",
          caption: "Invoice 2026-001"
        }
      };
    },
    async sendMessage() { sentMessage = true; },
    async sendDocument(_env, chatId, document, protectContent) {
      documents.push({ chatId, fileName: document.fileName, protectContent });
    }
  });

  assert.deepEqual(result, { nextOffset: 301, processed: 1 });
  assert.equal(sentMessage, false);
  assert.deepEqual(documents, [{
    chatId: "5518715264",
    fileName: "invoice-2026-001.pdf",
    protectContent: true
  }]);
});

test("Telegram installs full and CEO menus per chat and removes Meet's menu", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ method: string; payload: Record<string, any> }> = [];
  globalThis.fetch = (async (input, init) => {
    requests.push({
      method: String(input).split("/").pop() ?? "",
      payload: JSON.parse(String(init?.body)) as Record<string, any>
    });
    return new Response(JSON.stringify({ ok: true, result: true }), {
      headers: { "Content-Type": "application/json" }
    });
  }) as typeof fetch;
  try {
    await configureTelegramBotCommands({
      TELEGRAM_BOT_TOKEN: "123456:test-bot-token",
      TELEGRAM_AUTH_USERS_JSON: JSON.stringify({ Ali: "5518715264", Amin: "777888999" }),
      TELEGRAM_TRANSACTION_REVIEWER_USERS_JSON: JSON.stringify({ Meet: "777888996" }),
      TELEGRAM_COMMAND_ADMIN_USERS: "Ali,Ali M",
      TELEGRAM_COMMAND_READ_ONLY_USERS: "Amin,Sanjin,Sani,Ben,Beno"
    } as never);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(requests.map(({ method, payload }) => ({
    method,
    chatId: payload.scope.chat_id,
    commandCount: Array.isArray(payload.commands) ? payload.commands.length : 0
  })), [
    { method: "setMyCommands", chatId: "5518715264", commandCount: financeTelegramCommands.length },
    { method: "setMyCommands", chatId: "777888999", commandCount: readOnlyFinanceTelegramCommands.length },
    { method: "deleteMyCommands", chatId: "777888996", commandCount: 0 }
  ]);
  const installed = requests[0]?.payload.commands as Array<{ command: string; description: string }>;
  assert.match(installed.find(({ command }) => command === "overview")?.description ?? "", /^▶ TAP · /u);
  assert.match(installed.find(({ command }) => command === "transactions")?.description ?? "", /^⚙ OPTIONAL · /u);
  assert.match(installed.find(({ command }) => command === "search")?.description ?? "", /^✍ TYPE DETAILS · /u);
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
