import assert from "node:assert/strict";
import test from "node:test";
import { deliverPartnerImages, partnerRecipients, partnerSender } from "./partnerUpdateDelivery";
import { partnerReportHtml, renderPartnerReport } from "./partnerUpdateReports";
import { sendTelegramImageAlbum, TelegramDeliveryError, type TelegramCommandDocument } from "./telegram";
import type { PartnerReportData, PartnerUpdateStatus } from "../shared/partnerUpdates";

const env = { TELEGRAM_AUTH_USERS_JSON: JSON.stringify({ Amin: "1", Sanjin: "2", Beno: "3", Ali: "4", "Ali M": "5" }), TELEGRAM_COMMAND_ADMIN_USERS: "Ali,Ali M" };
const recipients = partnerRecipients(env);
const images: TelegramCommandDocument[] = ["cash-flow", "open-invoices"].map(name => ({ bytes: new Uint8Array([137, 80, 78, 71, 1, 2]).buffer, contentType: "image/png", fileName: `${name}.png`, caption: name }));
const status = (): PartnerUpdateStatus => ({ id: "job", createdAt: "2026-09-09", cashFlowDate: "2026-09-09", requestedBy: "Ali M", status: "sending", recipients: recipients.map(user => ({ name: user.username, status: "pending" })) });

test("recipient aliases resolve exactly once; missing or ambiguous users block the whole send", () => {
  assert.deepEqual(recipients.map(user => [user.username, user.chatId]), [["Amin", "1"], ["Sani", "2"], ["Ben", "3"], ["Ali", "4"], ["Ali M", "5"]]);
  assert.throws(() => partnerRecipients({ TELEGRAM_AUTH_USERS_JSON: JSON.stringify({ Ali: "4" }) }), /Amin/);
  assert.throws(() => partnerRecipients({ TELEGRAM_AUTH_USERS_JSON: JSON.stringify({ Amin: "1", Sanjin: "2", Sani: "6", Ben: "3", Ali: "4", "Ali M": "5" }) }), /exactly one.*Sani/);
  assert.equal(partnerSender(env, "Ali M").chatId, "5");
  assert.throws(() => partnerSender(env, "Amin"), /Ali and Ali M only/);
});

test("all five recipients receive the identical pair and successful recipients are never replayed", async () => {
  const state = status();
  const delivered: string[] = [];
  const save = async () => undefined;
  const send = async (chatId: string, reports: typeof images) => { assert.equal(reports, images); delivered.push(chatId); };
  await deliverPartnerImages(state, recipients, images, save, send);
  assert.equal(state.status, "complete");
  assert.deepEqual(delivered, ["1", "2", "3", "4", "5"]);
  await deliverPartnerImages(state, recipients, images, save, send);
  assert.equal(delivered.length, 5);
});

test("partial delivery preserves successes, continues to both Alis, and never replays an interrupted send", async () => {
  const state = status();
  state.recipients[0].status = "sending";
  const delivered: string[] = [];
  const transitions: PartnerUpdateStatus[] = [];
  await deliverPartnerImages(state, recipients, images, async value => { transitions.push(structuredClone(value)); }, async chatId => {
    if (chatId === "2") throw new TelegramDeliveryError("Blocked bot", false);
    delivered.push(chatId);
  });
  assert.deepEqual(delivered, ["3", "4", "5"]);
  assert.deepEqual(state.recipients.map(row => row.status), ["unconfirmed", "failed", "sent", "sent", "sent"]);
  assert.equal(state.status, "partial");
  assert.ok(transitions.some(row => row.recipients[2].status === "sending"));
  const retry = structuredClone(state);
  retry.recipients[1].status = "pending";
  await deliverPartnerImages(retry, recipients, images, async () => undefined, async chatId => { delivered.push(chatId); });
  assert.deepEqual(delivered, ["3", "4", "5", "2"]);
});

test("Telegram albums upload two uncompressed PNGs and distinguish rejection from uncertain delivery", async t => {
  let mode = "ok";
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    if (mode === "timeout") throw new Error("timeout");
    const body = init.body as FormData;
    assert.equal(body.get("chat_id"), "4");
    assert.equal(body.get("protect_content"), "true");
    const media = JSON.parse(body.get("media") as string);
    assert.deepEqual(media.map((item: { type: string }) => item.type), ["document", "document"]);
    for (let i = 0; i < 2; i++) assert.deepEqual(await (body.get(`report${i}`) as File).arrayBuffer(), images[i].bytes);
    return Response.json(mode === "ok" ? { ok: true, result: [{ message_id: 1 }, { message_id: 2 }] } : { ok: false }, { status: mode === "ok" ? 200 : 403 });
  });
  await sendTelegramImageAlbum({ TELEGRAM_BOT_TOKEN: "test" }, "4", images);
  mode = "rejected";
  await assert.rejects(sendTelegramImageAlbum({ TELEGRAM_BOT_TOKEN: "test" }, "4", images), error => error instanceof TelegramDeliveryError && !error.unconfirmed);
  mode = "timeout";
  await assert.rejects(sendTelegramImageAlbum({ TELEGRAM_BOT_TOKEN: "test" }, "4", images), error => error instanceof TelegramDeliveryError && error.unconfirmed);
});

test("report payload cannot inject scripts and render failure cannot send a blank or login screenshot", async () => {
  const data = { cashFlow: { asOfDate: "2026-09-09", notes: "</script><script>alert(1)</script>" } } as PartnerReportData;
  assert.equal(partnerReportHtml(data, "cash-flow").includes("<script>alert"), false);
  const renderEnv = { PUBLIC_APP_URL: "https://finance.example", ASSETS: { fetch: async (request: Request) => new Response("/* bundled */", { headers: { "content-type": request.url.endsWith(".js") ? "application/javascript" : "text/css" } }) },
    BROWSER: { quickAction: async (_name: string, options: { waitForSelector: { selector: string }; html: string; cacheTTL: number }) => {
      assert.equal(options.waitForSelector.selector, "#partner-report-ready");
      assert.equal(options.cacheTTL, 0);
      assert.ok(options.html.includes("partner-report-data"));
      return new Response("login page", { headers: { "content-type": "text/html" } });
    } }
  } as unknown as WorkerEnv;
  await assert.rejects(renderPartnerReport(renderEnv, data, "cash-flow"), /could not render/);
});
