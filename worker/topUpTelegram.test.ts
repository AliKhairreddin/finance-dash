import assert from "node:assert/strict";
import test from "node:test";
import { handleTopUpTelegram, handlePublicTopUps, sendTopUpNotification } from "./topUps";
import { validatePaymentDetails } from "./topUpDrafts";
const id = "request-abc";
const env = { CONVEX_URL: "https://test.convex.cloud", CONVEX_SERVICE_TOKEN: "service", AUTH_SESSION_SECRET: "signature-test-secret", TELEGRAM_BOT_TOKEN: "test-token", TELEGRAM_AUTH_USERS_JSON: JSON.stringify({ Ali: "111", "Ali M": "222", Amin: "333" }), TOPUP_TELEGRAM_CHAT_ID: "-5336756761", PUBLIC_APP_URL: "https://finance.test" } as unknown as WorkerEnv;
const pending = { _id: id, version: 1, telegramMessageId: 7, status: "pending", number: 10, entity: "dn", priority: "Urgent", companyName: "Example", team: "Cognitive", member: "Member", amount: 100, currency: "USD", openBalance: -20, lastThreeDaysSpend: 10, expectedThreeDaysSpend: 20, paymentMethod: "Bank Transfer", commission: "3%", createdAt: "2026-10-22T12:00:00Z", contentType: "application/pdf" };
function callback(user: number, action = "approve", version = 1, chat = -5336756761) { return { callback_query: { id: "callback-1", data: `tu:${action}:${id}:${version}`, from: { id: user }, message: { message_id: 7, chat: { id: chat } } } }; }
async function mocked(run: (calls: { path: string; body: any }[]) => Promise<void>, record: any = pending, deletedSnapshot: any = null) {
  const original = globalThis.fetch; const calls: { path: string; body: any }[] = [];
  globalThis.fetch = async (input, init) => { const url = String(input), body = JSON.parse(String(init?.body)); const path = url.includes("api.telegram.org") ? url.split("/").at(-1)! : body.path; calls.push({ path, body });
    return url.includes("api.telegram.org") ? Response.json({ ok: true, result: path === "sendMessage" ? { message_id: 8 } : true }) : Response.json({ status: "success", value: path === "topUps:get" ? record : path === "topUps:deletedNotification" ? deletedSnapshot : path === "topUps:findAdjustment" ? record : path === "topUps:transition" ? { ...record, status: "approved" } : null }); };
  try { await run(calls); } finally { globalThis.fetch = original; }
}
test("only Amin's numeric identity in the configured group can approve or adjust", async () => {
  await mocked(async calls => { await handleTopUpTelegram(callback(111), env); await handleTopUpTelegram(callback(333, "approve", 1, -123), env);
    assert.equal(calls.filter(c => c.path === "topUps:transition").length, 0); assert.match(calls[0].body.text, /Only Amin/); assert.match(calls[1].body.text, /Top-Up Request group/);
    await handleTopUpTelegram(callback(333), env); const transition = calls.find(c => c.path === "topUps:transition"); assert.ok(transition); const args = Array.isArray(transition.body.args) ? transition.body.args[0] : transition.body.args; assert.equal(args.actor, "Amin"); assert.equal(args.action, "approve");
  });
});
test("only Ali M can confirm paid, and stale message versions cannot act", async () => {
  await mocked(async calls => { await handleTopUpTelegram(callback(333, "paid", 2), env); await handleTopUpTelegram(callback(222, "paid", 1), env); assert.equal(calls.filter(c => c.path === "topUps:transition").length, 0);
    await handleTopUpTelegram(callback(222, "paid", 2), env); assert.equal(calls.filter(c => c.path === "topUps:transition").length, 1);
  }, { ...pending, version: 2, status: "approved" });
});
test("amount adjustment is a reply prompt and cannot silently approve", async () => {
  await mocked(async calls => { await handleTopUpTelegram(callback(333, "adjust"), env); assert.ok(calls.find(c => c.path === "sendMessage")?.body.reply_markup.force_reply); assert.equal(calls.filter(c => c.path === "topUps:transition").length, 0); assert.ok(calls.find(c => c.path === "topUps:adjustmentPrompt")); });
});
test("notifications use real ID mentions, expiring invoice links and stage-specific buttons", async () => {
  await mocked(async calls => { await sendTopUpNotification(env, id as never, 1); const sent = calls.find(c => c.path === "sendMessage")!.body;
    assert.equal(sent.chat_id, "-5336756761"); assert.match(sent.text, /tg:\/\/user\?id=333/); assert.match(sent.text, /expires=\d+&amp;token=[a-f0-9]{64}/); assert.match(sent.text, /View Invoice \(pdf link\)/);
    assert.deepEqual(sent.reply_markup.inline_keyboard[0].map((b: any) => b.text), ["Approve", "Adjust amount"]);
  });
  await mocked(async calls => { await sendTopUpNotification(env, id as never, 2); const sent = calls.find(c => c.path === "sendMessage")!.body; assert.match(sent.text, /tg:\/\/user\?id=222/); assert.equal(sent.reply_markup.inline_keyboard[0][0].text, "Paid"); }, { ...pending, version: 2, status: "approved" });
});
test("public submission rejects cross-origin writes and unsigned invoice access without touching storage", async () => {
  await mocked(async calls => { const cross = await handlePublicTopUps(new Request("https://finance.test/api/public/top-ups", { method: "POST", headers: { Origin: "https://evil.test" } }), env); assert.equal(cross?.status, 403);
    const unsigned = await handlePublicTopUps(new Request(`https://finance.test/api/public/top-ups/${id}/invoice`), env); assert.equal(unsigned?.status, 403); assert.equal(calls.length, 0);
  });
});
test("invoice payment extraction rejects missing or nonfinite fields and normalizes IBAN", () => {
  const details = { payerEntity: "dn", beneficiary: "Example", iban: "BE68 5390 0754 7034", bic: "", reference: "INV-1", amount: 100, currency: "USD", notes: "" };
  assert.equal(validatePaymentDetails(details).iban, "BE68539007547034"); assert.throws(() => validatePaymentDetails({ ...details, amount: Infinity })); assert.throws(() => validatePaymentDetails({ ...details, iban: null }));
});

test("deleted requests notify the group, remove buttons, escape actors and reject callback actions", async () => {
  const removed = { ...pending, deletedAt: "2026-10-22T14:00:00Z", deletedBy: "Ali <admin>", version: 2 };
  await mocked(async calls => {
    await sendTopUpNotification(env, id as never, 2);
    const sent = calls.find(c => c.path === "sendMessage")!.body;
    assert.match(sent.text, /Deleted Topup Request #10/); assert.match(sent.text, /Ali &lt;admin&gt;/); assert.match(sent.text, /100 USD/);
    assert.doesNotMatch(sent.text, /tg:\/\/user|View Invoice/); assert.deepEqual(sent.reply_markup.inline_keyboard, []);
    assert.deepEqual(calls.find(c => c.path === "editMessageReplyMarkup")!.body.reply_markup.inline_keyboard, []);
    for (const action of ["approve", "adjust", "paid"]) await handleTopUpTelegram(callback(action === "paid" ? 222 : 333, action, 2), env);
    assert.equal(calls.filter(c => c.path === "topUps:transition" || c.path === "topUps:adjustmentPrompt").length, 0);
  }, removed);
});
test("a rapid restore still delivers the saved deletion notice without removing restored buttons", async () => {
  await mocked(async calls => {
    await sendTopUpNotification(env, id as never, 2);
    assert.match(calls.find(c => c.path === "sendMessage")!.body.text, /Deleted Topup Request/);
    assert.equal(calls.filter(c => c.path === "editMessageReplyMarkup").length, 0);
  }, { ...pending, version: 3 }, { ...pending, version: 2, deletedAt: "2026-10-22T14:00:00Z", deletedBy: "Ali" });
});

test("deletion revokes signed public invoice links before storage is read", async () => {
  let link = "";
  await mocked(async calls => {
    await sendTopUpNotification(env, id as never, 1);
    const html = calls.find(c => c.path === "sendMessage")!.body.text;
    link = /href="(https:\/\/finance.test\/api\/public\/top-ups\/[^"]+)"/.exec(html)![1].replaceAll("&amp;", "&");
  });
  await mocked(async calls => {
    const response = await handlePublicTopUps(new Request(link), env);
    assert.equal(response?.status, 404); assert.equal(calls.filter(c => c.path === "documents:get").length, 0);
  }, { ...pending, version: 2, deletedAt: "2026-10-22T14:00:00Z", deletedBy: "Ali" });
});
