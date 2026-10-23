import assert from "node:assert/strict";
import test from "node:test";
import { handleTopUpTelegram, handlePublicTopUps, sendTopUpNotification, topUpSetup } from "./topUps";
import { validatePaymentDetails } from "./topUpDrafts";
const id = "request-abc";
const env = { CONVEX_URL: "https://test.convex.cloud", CONVEX_SERVICE_TOKEN: "service", AUTH_SESSION_SECRET: "signature-test-secret", TELEGRAM_BOT_TOKEN: "test-token", TELEGRAM_AUTH_USERS_JSON: JSON.stringify({ Ali: "111", "Ali M": "222", Amin: "333", OtherAdmin: "444" }), TOPUP_TELEGRAM_CHAT_ID: "-5336756761", PUBLIC_APP_URL: "https://finance.test" } as unknown as WorkerEnv;
const pending = { _id: id, version: 1, telegramMessageId: 7, status: "pending", draftStatus: "awaiting_approval", number: 10, entity: "dn", priority: "Urgent", companyName: "Example", team: "Cognitive", member: "Member", amount: 100, currency: "USD", openBalance: -20, lastThreeDaysSpend: 10, expectedThreeDaysSpend: 20, paymentMethod: "Bank Transfer", commission: "3%", createdAt: "2026-10-22T12:00:00Z", contentType: "application/pdf", documentId: "document", fileName: "invoice.pdf" };
function callback(user: number, action = "approve", version = 1, chat = -5336756761) { return { callback_query: { id: "callback-1", data: `tu:${action}:${id}:${version}`, from: { id: user }, message: { message_id: 7, chat: { id: chat } } } }; }
async function mocked(run: (calls: { path: string; body: any }[]) => Promise<void>, record: any = pending, deletedSnapshot: any = null) {
  const original = globalThis.fetch; const calls: { path: string; body: any }[] = [];
  globalThis.fetch = async (input, init) => { const url = String(input), body = JSON.parse(String(init?.body)); const path = url.includes("api.telegram.org") ? url.split("/").at(-1)! : body.path; calls.push({ path, body });
    const args = Array.isArray(body.args) ? body.args[0] : body.args;
    const adjustment = record?.adjustUserId === args?.userId && record?.adjustPromptId === args?.promptId ? record : null;
    return url.includes("api.telegram.org") ? Response.json({ ok: true, result: path === "sendMessage" ? { message_id: 8 } : true }) : Response.json({ status: "success", value: path === "topUps:rateLimit" ? true : path === "topUps:get" ? record : path === "topUps:deletedNotification" ? deletedSnapshot : path === "topUps:findAdjustment" ? adjustment : path === "topUps:transition" ? { ...record, status: "approved" } : null }); };
  try { await run(calls); } finally { globalThis.fetch = original; }
}
test("Amin, Ali M and Ali can approve using their configured numeric identities", async () => {
  for (const [userId, username] of [[333, "Amin"], [222, "Ali M"], [111, "Ali"]] as const) {
    await mocked(async calls => {
      await handleTopUpTelegram(callback(userId), env);
      const transition = calls.find(c => c.path === "topUps:transition"); assert.ok(transition);
      assert.equal(calls.find(c => c.path === "answerCallbackQuery")!.body.show_alert, false);
      const args = transition.body.args[0]; assert.equal(args.actor, username); assert.equal(args.action, "approve");
    });
  }
});
test("other accounts, spoofed usernames and callbacks from other groups cannot approve or adjust", async () => {
  await mocked(async calls => {
    for (const action of ["approve", "adjust"]) {
      const spoofed = callback(444, action); Object.assign(spoofed.callback_query.from, { username: "Amin", first_name: "Ali" });
      await handleTopUpTelegram(spoofed, env);
      await handleTopUpTelegram(callback(999, action), env);
      for (const user of [111, 222, 333]) await handleTopUpTelegram(callback(user, action, 1, -123), env);
    }
    assert.equal(calls.filter(c => c.path === "topUps:transition" || c.path === "topUps:adjustmentPrompt" || c.path === "sendMessage").length, 0);
    assert.match(calls[0].body.text, /Only Amin, Ali M or Ali/); assert.match(calls[2].body.text, /Top-Up Request group/);
  });
});
test("only Ali M can confirm paid, and stale message versions cannot act", async () => {
  await mocked(async calls => { await handleTopUpTelegram(callback(333, "paid", 2), env); await handleTopUpTelegram(callback(111, "paid", 2), env); await handleTopUpTelegram(callback(222, "paid", 1), env); assert.equal(calls.filter(c => c.path === "topUps:transition").length, 0);
    await handleTopUpTelegram(callback(222, "paid", 2), env); assert.equal(calls.filter(c => c.path === "topUps:transition").length, 1);
  }, { ...pending, version: 2, status: "approved" });
});
test("each approver adjusts by replying to the original card with no extra group prompt", async () => {
  for (const [userId, username] of [[333, "Amin"], [222, "Ali M"], [111, "Ali"]] as const) {
    await mocked(async calls => {
      await handleTopUpTelegram(callback(userId, "adjust"), env);
      assert.equal(calls.filter(c => c.path === "sendMessage").length, 0);
      const toast = calls.find(c => c.path === "answerCallbackQuery")!.body;
      assert.match(toast.text, /Reply to this request/); assert.equal(toast.show_alert, false);
      assert.equal(calls.filter(c => c.path === "topUps:transition").length, 0);
      const args = calls.find(c => c.path === "topUps:adjustmentPrompt")!.body.args[0];
      assert.equal(args.userId, String(userId)); assert.equal(args.promptId, 7); assert.equal(args.version, 1);
    });
  }
});
function amountReply(userId: number, text = "120.50", chat = -5336756761) { return { message: { chat: { id: chat }, from: { id: userId }, text, reply_to_message: { message_id: 7 } } }; }
test("amount replies record the actual approver in the dashboard audit trail", async () => {
  for (const [userId, username] of [[333, "Amin"], [222, "Ali M"], [111, "Ali"]] as const) {
    await mocked(async calls => {
      await handleTopUpTelegram(amountReply(userId), env);
      const lookup = calls.find(c => c.path === "topUps:findAdjustment")!.body.args[0]; assert.equal(lookup.userId, String(userId)); assert.equal(lookup.promptId, 7);
      const args = calls.find(c => c.path === "topUps:transition")!.body.args[0];
      assert.equal(args.actor, username); assert.equal(args.action, "adjust"); assert.equal(args.amount, 120.50); assert.equal(args.version, 1);
    }, { ...pending, adjustUserId: String(userId), adjustPromptId: 7 });
  }
});
test("another approver cannot answer someone else's amount prompt", async () => {
  await mocked(async calls => {
    for (const userId of [111, 222, 444, 999]) await handleTopUpTelegram(amountReply(userId), env);
    await handleTopUpTelegram(amountReply(333, "120.50", -123), env);
    assert.equal(calls.filter(c => c.path === "topUps:transition").length, 0);
    await handleTopUpTelegram(amountReply(333), env);
    assert.equal(calls.filter(c => c.path === "topUps:transition").length, 1);
  }, { ...pending, adjustUserId: "333", adjustPromptId: 7 });
});
test("all approvers still reject stale request buttons", async () => {
  await mocked(async calls => {
    for (const userId of [111, 222, 333]) for (const action of ["approve", "adjust"]) await handleTopUpTelegram(callback(userId, action), env);
    assert.equal(calls.filter(c => c.path === "topUps:transition" || c.path === "topUps:adjustmentPrompt" || c.path === "sendMessage").length, 0);
    assert.ok(calls.filter(c => c.path === "answerCallbackQuery").every(c => c.body.text.includes("out of date")));
  }, { ...pending, version: 2 });
});
test("notifications use real ID mentions, expiring invoice links and stage-specific buttons", async () => {
  await mocked(async calls => { await sendTopUpNotification(env, id as never, 1); const sent = calls.find(c => c.path === "editMessageText")!.body;
    assert.equal(sent.chat_id, "-5336756761"); assert.match(sent.text, /tg:\/\/user\?id=333/); assert.match(sent.text, /expires=\d+&amp;token=[a-f0-9]{64}/); assert.match(sent.text, /View Invoice \(pdf link\)/);
    assert.deepEqual(sent.reply_markup.inline_keyboard[0].map((b: any) => b.text), ["Approve", "Adjust amount"]);
  });
  await mocked(async calls => { await sendTopUpNotification(env, id as never, 2); const sent = calls.find(c => c.path === "editMessageText")!.body; assert.match(sent.text, /tg:\/\/user\?id=222/); assert.equal(sent.reply_markup.inline_keyboard[0][0].text, "Paid"); }, { ...pending, version: 2, status: "approved" });
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

test("deleting a request silently removes buttons and rejects callback actions", async () => {
  const removed = { ...pending, deletedAt: "2026-10-22T14:00:00Z", deletedBy: "Ali <admin>", version: 2 };
  await mocked(async calls => {
    await sendTopUpNotification(env, id as never, 2);
    assert.equal(calls.filter(c => c.path === "sendMessage").length, 0);
    assert.deepEqual(calls.find(c => c.path === "editMessageReplyMarkup")!.body.reply_markup.inline_keyboard, []);
    for (const action of ["approve", "adjust", "paid"]) await handleTopUpTelegram(callback(action === "paid" ? 222 : 333, action, 2), env);
    assert.equal(calls.filter(c => c.path === "topUps:transition" || c.path === "topUps:adjustmentPrompt").length, 0);
  }, removed);
});
test("a rapid restore skips the old deletion job without messaging or removing restored buttons", async () => {
  await mocked(async calls => {
    await sendTopUpNotification(env, id as never, 2);
    assert.equal(calls.filter(c => c.path === "sendMessage").length, 0);
    assert.equal(calls.filter(c => c.path === "editMessageReplyMarkup").length, 0);
  }, { ...pending, version: 3 }, { ...pending, version: 2, deletedAt: "2026-10-22T14:00:00Z", deletedBy: "Ali" });
});

test("deletion revokes signed public invoice links before storage is read", async () => {
  let link = "";
  await mocked(async calls => {
    await sendTopUpNotification(env, id as never, 1);
    const html = calls.find(c => c.path === "editMessageText")!.body.text;
    link = /href="(https:\/\/finance.test\/api\/public\/top-ups\/[^"]+)"/.exec(html)![1].replaceAll("&amp;", "&");
  });
  await mocked(async calls => {
    const response = await handlePublicTopUps(new Request(link), env);
    assert.equal(response?.status, 404); assert.equal(calls.filter(c => c.path === "documents:get").length, 0);
  }, { ...pending, version: 2, deletedAt: "2026-10-22T14:00:00Z", deletedBy: "Ali" });
});

test("Telegram setup checks group membership for all three approvers", async () => {
  const original = globalThis.fetch; let aliLeft = false; const checked: number[] = [];
  globalThis.fetch = async (input, init) => {
    const path = String(input).split("/").at(-1), body = JSON.parse(String(init?.body));
    let result;
    if (path === "getMe") result = { id: 999, username: "test-bot" };
    else if (path === "getChat") result = { title: "Top-Up Request" };
    else if (path === "getChatMember") { checked.push(body.user_id); result = { status: body.user_id === 111 ? aliLeft ? "left" : "administrator" : "member" }; }
    else throw new Error(`Unexpected Telegram write: ${path}`);
    return Response.json({ ok: true, result });
  };
  try {
    const result = await topUpSetup(env) as { ready: boolean; recipients: string[] };
    assert.equal(result.ready, true); assert.deepEqual(result.recipients, ["Amin", "Ali M", "Ali"]);
    assert.deepEqual(checked.sort((a, b) => a - b), [111, 222, 333, 999]);
    aliLeft = true; assert.equal((await topUpSetup(env) as { ready: boolean }).ready, false);
  } finally { globalThis.fetch = original; }
});

test("public submissions enforce the expected-spend minimum before invoice intake", async () => {
  await mocked(async calls => {
    const form = new FormData();
    form.set("details", JSON.stringify({ ...pending, submissionId: "12345678-1234-1234-1234-123456789abc", wiseLink: "", notes: "", bmNames: [], accountNames: [], expectedThreeDaysSpend: 0 }));
    form.set("invoice", new File(["%PDF-1.4\n%%EOF"], "invoice.pdf", { type: "application/pdf" }));
    const response = await handlePublicTopUps(new Request("https://finance.test/api/public/top-ups", { method: "POST", headers: { Origin: "https://finance.test" }, body: form }), env);
    assert.equal(response?.status, 400); assert.match((await response!.json()).message, /at least 1,000 USD/);
    assert.deepEqual(calls.map(c => c.path), ["topUps:rateLimit"]);
  });
});


test("only the first notification sends a message; all later states edit the same card", async () => {
  await mocked(async calls => {
    await sendTopUpNotification(env, id as never, 1);
    assert.equal(calls.filter(c => c.path === "sendMessage").length, 1);
    assert.equal(calls.filter(c => c.path === "editMessageText").length, 0);
    assert.equal(calls.find(c => c.path === "topUps:saveMessage")!.body.args[0].messageId, 8);
  }, { ...pending, telegramMessageId: undefined });
  for (const status of ["pending", "approved", "paid"]) await mocked(async calls => {
    await sendTopUpNotification(env, id as never, 2);
    assert.equal(calls.filter(c => c.path === "sendMessage").length, 0);
    const edit = calls.find(c => c.path === "editMessageText")!.body;
    assert.equal(edit.message_id, 7); assert.match(edit.text, new RegExp(`Status: ${status[0].toUpperCase() + status.slice(1)}`));
    assert.equal(calls.find(c => c.path === "topUps:saveMessage")!.body.args[0].messageId, 7);
    if (status === "paid") assert.deepEqual(edit.reply_markup.inline_keyboard, []);
  }, { ...pending, status, version: 2, draftStatus: "created" });
});
test("amount instructions and input errors edit the request instead of posting group messages", async () => {
  const record = { ...pending, adjustUserId: "333", adjustPromptId: 7, adjustExpiresAt: Date.now() + 600_000, adjustError: "Enter a positive amount" };
  await mocked(async calls => {
    await sendTopUpNotification(env, id as never, 1);
    assert.match(calls.find(c => c.path === "editMessageText")!.body.text, /reply to this request.*Enter a positive amount/s);
    await handleTopUpTelegram(amountReply(333, "invalid"), env);
    assert.match(calls.find(c => c.path === "topUps:adjustmentPrompt")!.body.args[0].error, /positive amount/);
    assert.equal(calls.filter(c => c.path === "sendMessage" || c.path === "topUps:transition").length, 0);
  }, record);
});
test("draft failures are visible on the same approved card", async () => {
  await mocked(async calls => {
    await sendTopUpNotification(env, id as never, 2);
    const edit = calls.find(c => c.path === "editMessageText")!.body;
    assert.match(edit.text, /Revolut draft: Needs review/); assert.match(edit.text, /Verify the saved recipient/);
    assert.equal(calls.filter(c => c.path === "sendMessage").length, 0);
  }, { ...pending, version: 2, status: "approved", draftStatus: "needs_review", draftError: "Verify the saved recipient" });
});
test("Telegram edit failures never send a replacement group message", async () => {
  const original = globalThis.fetch; const methods: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (!url.includes("api.telegram.org")) return Response.json({ status: "success", value: pending });
    methods.push(url.split("/").at(-1)!);
    return Response.json({ ok: false, error_code: 400, description: "Bad Request: message to edit not found" }, { status: 400 });
  };
  try { await assert.rejects(sendTopUpNotification(env, id as never, 1), /editMessageText request failed/); assert.deepEqual(methods, ["editMessageText"]); }
  finally { globalThis.fetch = original; }
});

test("a Telegram unchanged-message response is successful and never triggers a new message", async () => {
  const original = globalThis.fetch; const methods: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (!url.includes("api.telegram.org")) {
      const body = JSON.parse(String(init?.body));
      return Response.json({ status: "success", value: body.path === "topUps:get" ? pending : null });
    }
    methods.push(url.split("/").at(-1)!);
    return Response.json({ ok: false, error_code: 400, description: "Bad Request: message is not modified: specified new message content and reply markup are exactly the same" }, { status: 400 });
  };
  try { await sendTopUpNotification(env, id as never, 1); assert.deepEqual(methods, ["editMessageText"]); }
  finally { globalThis.fetch = original; }
});
