import test from "node:test";
import assert from "node:assert/strict";
import { deliverTrackerNotifications, extractTrackerReport, trackerEligibleUsers, trackerTelegramCommand, trackerTelegramIntake } from "./receivablesTracker";
import { prepareTelegramReply, telegramUpdate } from "./telegram";
const env = { CONVEX_URL: "https://tracker-test.convex.cloud", CONVEX_SERVICE_TOKEN: "test", TELEGRAM_BOT_TOKEN: "test", TELEGRAM_AUTH_USERS_JSON: JSON.stringify({ Ali: "111", "Ali M": "222", Removed: "333" }), TELEGRAM_COMMAND_ADMIN_USERS: "Ali,Ali M", TELEGRAM_COMMAND_READ_ONLY_USERS: "Amin", PUBLIC_APP_URL: "https://finance.example", OPENROUTER_API_KEY: "test", DOCUMENT_AI_MODEL: "test" } as unknown as WorkerEnv;
const ali = { username: "Ali", normalizedUsername: "ali", chatId: "111" };
test("receipt notifications use only the selected authorized private chats and keep failures independent", async () => {
  const original = globalThis.fetch, sent: string[] = [], completions: Record<string, unknown>[] = [];
  const rows = ["ali", "ali m", "removed"].map(recipient => ({ key: recipient, event: "received:item:receipt", recipient, text: "LeadPier paid · USD 1,000.00", state: "sending", lease: recipient, attempts: 1, nextAt: 0, createdAt: "now" }));
  globalThis.fetch = async (input, init) => {
    const url = String(input), body = JSON.parse(String(init?.body));
    if (url.includes("convex.cloud")) {
      if (body.path === "receivables:deliveryClaim") return Response.json({ status: "success", value: rows });
      if (body.path === "receivables:list") return Response.json({ status: "success", value: { enabledAt: "2026-11-01", recipients: ["ali", "ali m"] } });
      if (body.path === "receivables:deliveryComplete") { completions.push(body.args[0]); return Response.json({ status: "success", value: null }); }
      throw new Error(`Unexpected DB request ${body.path}`);
    }
    assert.equal(url, "https://api.telegram.org/bottest/sendMessage"); sent.push(body.chat_id); assert.match(body.text, /finance.example/);
    return body.chat_id === "111" ? Response.json({ ok: true, result: { message_id: 1 } }) : Response.json({ ok: false, error_code: 429, parameters: { retry_after: 90 } }, { status: 429 });
  };
  try { assert.deepEqual(trackerEligibleUsers(env).map(u => u.chatId), ["111", "222"]); await deliverTrackerNotifications(env); assert.deepEqual(sent, ["111", "222"]); assert.deepEqual(completions.map(c => c.outcome), ["sent", "retry", "disabled"]); assert.equal(completions[1].retryAfter, 90); } finally { globalThis.fetch = original; }
});
test("unknown Telegram delivery response becomes uncertain, never assumed successful", async () => {
  const original = globalThis.fetch; let result: unknown;
  globalThis.fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body));
    if (String(input).includes("api.telegram.org")) throw new Error("socket interrupted");
    if (body.path === "receivables:deliveryClaim") return Response.json({ status: "success", value: [{ key: "one", event: "received:a", recipient: "ali", text: "Paid", lease: "lease" }] });
    if (body.path === "receivables:list") return Response.json({ status: "success", value: { enabledAt: "2026-11-01", recipients: ["ali", "ali m"] } });
    result = body.args[0].outcome; return Response.json({ status: "success", value: null });
  };
  try { await deliverTrackerNotifications(env); assert.equal(result, "uncertain"); } finally { globalThis.fetch = original; }
});
test("weekly source extraction treats green amount cells as report evidence and never mutates finance", async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (input, init) => { calls++; assert.equal(String(input), "https://openrouter.ai/api/v1/chat/completions"); const body = JSON.parse(String(init?.body)); assert.match(body.messages[0].content, /GREEN IN THE AMOUNT CELL/); assert.match(body.messages[0].content, /untrusted data/); assert.equal(body.provider.zdr, true); return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ csv: "payer,amount,currency,paid\nExample,100,USD,1\nUnclear,20,,", summary: 20 }) } }] }); };
  try { const result = await extractTrackerReport(env, { text: "source", images: [{ bytes: new Uint8Array([1, 2]), contentType: "image/png" }], week: "2026-11-09" }); assert.equal(calls, 1); assert.equal(result.rows[0].paid, true); assert.ok(result.rows[1].issue); } finally { globalThis.fetch = original; }
});
test("weekly intake requires administrator role while existing questions and generic attachments keep their route", async () => {
  const original = globalThis.fetch; globalThis.fetch = async () => Response.json({ ok: true, result: true });
  try {
    await assert.rejects(trackerTelegramCommand(env, ali, "read-only", "weekly_update"), /administrator/);
    assert.equal(await trackerTelegramCommand({} as never, ali, "administrator", "cash"), null);
    let attachmentCalls = 0, commandCalls = 0;
    const update = telegramUpdate({ update_id: 1, message: { chat: { id: 111, type: "private" }, from: { first_name: "Ali" }, media_group_id: "album-1", photo: [{ file_id: "a", file_unique_id: "b" }] } });
    assert.equal(update.message?.mediaGroupId, "album-1");
    await prepareTelegramReply(env, update, { handleReceivables: async () => null, handleCommand: async () => { commandCalls++; return "cash"; }, handleAttachment: async () => { attachmentCalls++; return "generic document"; } }); assert.equal(attachmentCalls, 1);
    await prepareTelegramReply(env, { ...update, message: { ...update.message!, attachment: undefined, text: "/cash" } }, { handleReceivables: async () => null, handleCommand: async () => { commandCalls++; return "cash"; }, handleAttachment: async () => "unused" }); assert.equal(commandCalls, 1);
    const response = await prepareTelegramReply(env, update, { handleReceivables: async () => "Weekly draft", handleCommand: async () => "unused", handleAttachment: async () => { attachmentCalls++; return "unexpected"; } }); assert.equal(response?.reply, "Weekly draft"); assert.equal(attachmentCalls, 1);
  } finally { globalThis.fetch = original; }
});
test("an active weekly album does not consume another album or an unrelated document", async () => {
  const original = globalThis.fetch; const paths: string[] = [];
  globalThis.fetch = async (_input, init) => { const body = JSON.parse(String(init?.body)); paths.push(body.path); assert.equal(body.path, "receivables:intake"); return Response.json({ status: "success", value: body.args[0].cancel ? null : { week: "2026-11-09", mediaGroupId: "first-album" } }); };
  try { const result = await trackerTelegramIntake(env, ali, "administrator", { chatId: "111", firstName: "Ali", attachment: { fileId: "a", uniqueId: "b", fileName: "amex.csv", contentType: "text/csv" } }); assert.equal(result, null); assert.equal(paths.length, 2); } finally { globalThis.fetch = original; }
});
