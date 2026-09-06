import assert from "node:assert/strict";
import test from "node:test";
import worker from "./handler";
import { prepareTelegramReply, telegramUpdate, telegramWebhookSecret } from "./telegram";
import { answerFinanceQuestion } from "./telegramAssistant";

const env = { TELEGRAM_AUTH_USERS_JSON: JSON.stringify({ Ali: "111", "Ali M": "222", Amin: "333" }), TELEGRAM_COMMAND_ADMIN_USERS: "Ali,Ali M", TELEGRAM_COMMAND_READ_ONLY_USERS: "Amin", TELEGRAM_BOT_TOKEN: "test-token", PUBLIC_APP_URL: "https://finance.example" } as unknown as WorkerEnv;
const photoUpdate = (chat = 111) => ({ update_id: 1, message: { message_id: 10, chat: { id: chat, type: "private", first_name: "Ali" }, from: { id: chat, first_name: "Ali" }, caption: "Digital Nudge", photo: [{ file_id: "small", file_unique_id: "small-unique", width: 100, height: 100 }, { file_id: "large", file_unique_id: "large-unique", width: 1000, height: 1000 }] } });

test("Telegram accepts private photos at full size and routes attachments by mapped identity", async () => {
  const parsed = telegramUpdate(photoUpdate()); assert.equal(parsed.message?.attachment?.fileId, "large");
  let uploads = 0;
  const deps = { handleCommand: async () => "unused", handleAttachment: async () => { uploads++; return "Saved"; } };
  assert.equal((await prepareTelegramReply(env, parsed, deps))?.reply, "Saved");
  assert.equal((await prepareTelegramReply(env, telegramUpdate(photoUpdate(222)), deps))?.reply, "Saved");
  assert.match(String((await prepareTelegramReply(env, telegramUpdate(photoUpdate(333)), deps))?.reply), /Ali and Ali M only/);
  await prepareTelegramReply(env, telegramUpdate(photoUpdate(444)), deps);
  assert.equal(uploads, 2, "A displayed Ali name cannot impersonate an authorized private chat");
});
test("the Telegram webhook checks its secret before durably accepting an update", async () => {
  let received = 0;
  const runtime = { ...env, TELEGRAM_INBOX: { getByName(name: string) { assert.equal(name, "chat:111"); return { async receive() { received++; } }; } } } as unknown as WorkerEnv;
  const url = "https://finance.example/api/telegram/webhook";
  const body = JSON.stringify(photoUpdate());
  assert.equal((await worker.fetch(new Request(url, { method: "POST", body }), runtime)).status, 401);
  const secret = await telegramWebhookSecret(runtime);
  assert.equal((await worker.fetch(new Request(url, { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": secret }, body }), runtime)).status, 200);
  assert.equal(received, 1);
});
test("plain Telegram questions are sent to the read-only assistant and preparation never sends a reply", async () => {
  const original = globalThis.fetch; const paths: string[] = []; let command = "";
  globalThis.fetch = async input => { paths.push(String(input)); return Response.json({ ok: true, result: true }); };
  try {
    const reply = await prepareTelegramReply(env, telegramUpdate({ update_id: 2, message: { from: { id: 111, first_name: "Ali" }, chat: { id: 111, type: "private", first_name: "Ali" }, text: "How much did we spend in August?" } }), { handleCommand: async (_env, _user, _role, text) => { command = text; return "Current dashboard answer"; }, handleAttachment: async () => "unused" });
    assert.equal(command, "/ask How much did we spend in August?"); assert.equal(reply?.reply, "Current dashboard answer");
    assert.ok(paths.every(url => url.endsWith("/sendChatAction")), "Reply delivery must happen only after the result is durably saved");
  } finally { globalThis.fetch = original; }
});
test("the assistant fetches dashboard data through read tools and never executes an unknown tool", async () => {
  const original = globalThis.fetch; const requests: any[] = []; let lookups = 0;
  globalThis.fetch = async (_input, init) => { requests.push(JSON.parse(String(init?.body))); return Response.json({ choices: [{ message: requests.length === 1 ? { role: "assistant", content: null, tool_calls: [{ id: "call-1", type: "function", function: { name: "mark_invoice_paid", arguments: '{}' } }] } : { role: "assistant", content: "Please confirm payment in the dashboard." } }] }); };
  try {
    const reply = await answerFinanceQuestion({ settings: { provider: "openrouter", model: "test-model", openRouterApiKey: "test-key" }, question: "Mark it paid", context: {}, history: [], referer: "https://finance.example", lookup: async () => { lookups++; return {}; } });
    assert.equal(lookups, 0); assert.match(reply, /dashboard/); assert.match(requests[1].messages.at(-1).content, /Unknown read tool/);
  } finally { globalThis.fetch = original; }
});
