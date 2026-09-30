import assert from "node:assert/strict";
import test from "node:test";
import { fetchSlashRejectedCardActivity, type SlashCard, type SlashRejectedCardTransaction, type SlashVirtualAccountBalance } from "../shared/slashApi";
import { slashPreviousDayReportPeriod } from "./telegramSlashDailyPeriod";
import { buildTelegramSlashRejectedCardsReport } from "./telegramSlashRejectedCardsReport";
import { cashReportDelivered, cashReportDeliveryStateKey, cashReportRecipient, deliverCashReportParts,
  sendTelegramCashReportIfDue, splitCashReport, type CashReportDeliveryState, type CashReportKind } from "./telegramCashReport";
import worker, { getTelegramSlashRejectedCardsReport, handleTelegramCommand } from "./handler";

const asOf = Date.parse("2026-09-15T10:00:00Z");
const card: SlashCard = { id: "card", last4: "1234", name: "Meta ads" };
const account: SlashVirtualAccountBalance = { id: "va", accountId: "parent", name: "Primary", accountType: "primary", balance: 1000, currency: "USD" };
const rejection: SlashRejectedCardTransaction = {
  id: "rejection", date: "2026-09-14T12:00:00Z", description: "Card purchase", amountCents: -10000,
  accountId: "parent", accountSubtype: "credit", virtualAccountId: "va", cardId: "card", status: "failed",
  detailedStatus: "declined", declineReason: "Insufficient funds", merchantData: { description: "Meta" }
};
const env = {
  SLASH_BASE_URL: "https://api.slash.test", SLASH_API_KEY: "test-key", SLASH_LEGAL_ENTITY_ID: "test-entity",
  TELEGRAM_AUTH_USERS_JSON: JSON.stringify({ Ali: "111", "Ali M": "222", Amin: "333", Ben: "444" }),
  TELEGRAM_COMMAND_ADMIN_USERS: "Ali,Ali M", TELEGRAM_COMMAND_READ_ONLY_USERS: "Amin,Ben",
  TELEGRAM_CASH_REPORT_RECIPIENTS: "Ali,Ali M", TELEGRAM_SLASH_REPORT_RECIPIENTS: "Amin,Ali,Ali M",
  TELEGRAM_SLASH_CASHBACK_REPORT_RECIPIENTS: "Ali,Ali M", TELEGRAM_SLASH_REJECTED_CARDS_REPORT_RECIPIENTS: "Ali,Ali M"
};
const report = (transactions: SlashRejectedCardTransaction[], cards: SlashCard[] = [card]) =>
  buildTelegramSlashRejectedCardsReport({ transactions, cards, accounts: [account], asOf });

test("rejected cards show attempts, merchant, local time and reasons without counting duplicates as spend", () => {
  const result = report([
    rejection, rejection,
    { ...rejection, id: "second", amountCents: -5000, date: "2026-09-14T13:00:00Z", declineReason: "Card spending limit" },
    { ...rejection, id: "zero", cardId: "verification", amountCents: 0, declineReason: undefined }
  ], [card, { id: "verification", last4: "4321", name: "Verification" }]);
  assert.match(result, /2026-09-14 · Beirut/);
  assert.match(result, /3 rejected payments across 2 cards/);
  assert.match(result, /Attempted amount: \$150.00 \(not charged\)/);
  assert.match(result, /Meta ads · Card ••1234\nAccount: Primary\n2 rejected payments · Attempted \$150.00/);
  assert.match(result, /15:00 · Meta · \$100.00\n  Reason: Insufficient funds/);
  assert.match(result, /16:00 · Meta · \$50.00\n  Reason: Card spending limit/);
  assert.match(result, /Verification · Card ••4321/);
  assert.match(result, /Reason: Not provided by Slash/);
});

test("previous-day boundaries exclude adjacent dates and declined credits; zero-dollar declines stay visible", () => {
  const period = slashPreviousDayReportPeriod(asOf);
  assert.match(report([
    { ...rejection, date: new Date(period.fromTime - 1).toISOString() },
    { ...rejection, date: new Date(period.toTime).toISOString() },
    { ...rejection, amountCents: 1000 }
  ]), /No rejected Slash card payments/);
  const result = report([
    { ...rejection, date: new Date(period.fromTime).toISOString() },
    { ...rejection, id: "end", date: new Date(period.toTime - 1).toISOString(), amountCents: 0 }
  ]);
  assert.match(result, /2 rejected payments across 1 card/);
  assert.match(result, /00:00 · Meta/);
  assert.match(result, /23:59 · Meta · \$0.00/);
});

test("same last-four digits do not merge different cards and parent account IDs keep attempts separate", () => {
  const result = report([
    rejection, { ...rejection, id: "other", cardId: "other" },
    { ...rejection, accountId: "another-parent" }
  ], [card, { ...card, id: "other", name: "Other" }]);
  assert.match(result, /3 rejected payments across 3 cards/);
  assert.match(result, /Other · Card ••1234/);
});

test("invalid amounts, timestamps or missing card/account details cannot create an all-clear report", () => {
  assert.throws(() => report([rejection], []), /card details are incomplete/);
  assert.throws(() => report([rejection], [{ ...card, last4: "abc" }]), /card details are incomplete/);
  assert.throws(() => report([{ ...rejection, date: "invalid" }]), /Invalid Slash card rejection/);
  assert.throws(() => report([{ ...rejection, amountCents: NaN }]), /Invalid Slash card rejection/);
  assert.throws(() => report([{ ...rejection, virtualAccountId: "unknown" }]), /virtual account details are incomplete/);
  assert.throws(() => report([{ ...rejection, amountCents: -Number.MAX_SAFE_INTEGER },
    { ...rejection, id: "overflow", amountCents: -1 }]), /calculation limit/);
});

test("large rejection reports retain every attempt through Telegram multipart splitting and bound provider text", () => {
  const cards = Array.from({ length: 80 }, (_, i) => ({ id: `card-${i}`, last4: String(1000 + i), name: `Card ${i}` }));
  const result = report(cards.map((card) => ({ ...rejection, id: card.id, cardId: card.id,
    declineReason: "x".repeat(1024), merchantData: { description: "Long\nmerchant ".repeat(80) } })), cards);
  const parts = splitCashReport(result);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((part) => part.length < 4096));
  for (const card of cards) assert.ok(parts.join("\n").includes(`Card ••${card.last4}`));
});

function sourceFetcher(requests: string[]): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    requests.push(url.pathname);
    assert.ok(!init?.method || init.method === "GET");
    assert.equal(new Headers(init?.headers).get("X-API-Key"), "test-key");
    assert.equal(new Headers(init?.headers).get("x-legal-entity"), "test-entity");
    if (url.pathname === "/transaction") {
      const period = slashPreviousDayReportPeriod(asOf);
      assert.equal(url.searchParams.get("filter:from_date"), String(period.fromTime));
      assert.equal(url.searchParams.get("filter:to_date"), String(period.toTime - 1));
      assert.equal(url.searchParams.get("filter:detailed_status"), "declined");
      assert.equal(url.searchParams.get("filter:category"), "card");
      // Even if the provider returns other failed card activity, it is not a rejection.
      return Response.json(url.searchParams.has("cursor")
        ? { items: [rejection, { ...rejection, id: "second", declineReason: undefined }], metadata: {} }
        : { items: [rejection,
          ...["pending", "settled", "canceled", "failed", "reversed", "refund"].map((detailedStatus) => ({ ...rejection, id: detailedStatus, detailedStatus })),
          { ...rejection, id: "tomorrow", date: new Date(period.toTime).toISOString() },
          { ...rejection, id: "yesterday", date: new Date(period.fromTime - 1).toISOString() },
          { ...rejection, id: "credit", amountCents: 1000 }
        ], metadata: { nextCursor: "next" } });
    }
    if (url.pathname === "/card/card") return Response.json({ ...card, pan: "must-never-retain", cvv: "secret-cvv" });
    if (url.pathname === "/virtual-account") return Response.json({
      items: [{ virtualAccount: account, balance: { amountCents: 100000 } }], metadata: {}
    });
    throw new Error(`Unexpected read: ${url.pathname}`);
  };
}

test("live rejected cards report reads every page, resolves labels once and excludes non-declines without exposing PAN/CVV", async () => {
  const original = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = sourceFetcher(requests);
  try {
    const result = await getTelegramSlashRejectedCardsReport(env as never, asOf);
    assert.match(result, /2 rejected payments across 1 card/);
    assert.match(result, /Meta ads · Card ••1234/);
    assert.match(result, /Reason: Insufficient funds/);
    assert.match(result, /Reason: Not provided by Slash/);
    assert.doesNotMatch(result, /must-never-retain|secret-cvv/);
    assert.equal(requests.filter((path) => path === "/transaction").length, 2);
    assert.equal(requests.filter((path) => path === "/card/card").length, 1);
    globalThis.fetch = async () => Response.json({ error: "unavailable" }, { status: 403 });
    await assert.rejects(getTelegramSlashRejectedCardsReport(env as never, asOf), /403/);
  } finally { globalThis.fetch = original; }
});

test("empty results are valid, while malformed declines and incomplete pagination stop delivery", async () => {
  const options = { baseUrl: env.SLASH_BASE_URL, apiKey: env.SLASH_API_KEY, legalEntityId: env.SLASH_LEGAL_ENTITY_ID, ...slashPreviousDayReportPeriod(asOf) };
  const empty = await fetchSlashRejectedCardActivity({ ...options, fetcher: async () => Response.json({ items: [], metadata: {} }) });
  assert.deepEqual(empty, { transactions: [], cards: [], accounts: [] });
  await assert.rejects(fetchSlashRejectedCardActivity({ ...options, fromTime: options.toTime, fetcher: sourceFetcher([]) }), /Invalid Slash rejected cards report window/);
  await assert.rejects(fetchSlashRejectedCardActivity({ ...options, fetcher: async () => Response.json({ items: [rejection], metadata: { nextCursor: "again" } }) }), /repeated pagination/);
  for (const row of [{ ...rejection, detailedStatus: undefined }, { ...rejection, cardId: undefined }, { ...rejection, amountCents: 0.5 }, { ...rejection, declineReason: {} }]) {
    await assert.rejects(fetchSlashRejectedCardActivity({ ...options, fetcher: async () => Response.json({ items: [row], metadata: {} }) }));
  }
  const fetcher = sourceFetcher([]);
  await assert.rejects(fetchSlashRejectedCardActivity({ ...options, fetcher: async (input, init) =>
    String(input).includes("/card/") ? Response.json({ ...card, id: "wrong" }) : fetcher(input, init)
  }), /requested card/);
});

test("only Ali and Ali M can request rejected cards; excluded readers are denied before reading Slash", async () => {
  assert.equal(cashReportRecipient(env, " ali m ", "daily-slash-rejected-cards").username, "Ali M");
  const original = globalThis.fetch;
  let reads = 0;
  globalThis.fetch = async () => { reads++; throw new Error("Must not fetch"); };
  try {
    for (const username of ["Amin", "Ben"]) {
      assert.throws(() => cashReportRecipient(env, username, "daily-slash-rejected-cards"), /not authorized/);
      const reply = await handleTelegramCommand(env as never, { username, normalizedUsername: username.toLowerCase(), chatId: "333" }, "read-only", "/rejected_cards");
      assert.match(String(reply), /Access denied/);
    }
    assert.equal(reads, 0);
  } finally { globalThis.fetch = original; }
});

test("Ali and Ali M can run the rejected cards command on demand", async () => {
  const original = globalThis.fetch;
  let reads = 0;
  globalThis.fetch = async (input) => {
    assert.equal(new URL(String(input)).pathname, "/transaction");
    reads++;
    return Response.json({ items: [], metadata: {} });
  };
  try {
    for (const username of ["Ali", "Ali M"]) {
      const reply = await handleTelegramCommand(env as never, { username, normalizedUsername: username.toLowerCase(), chatId: username === "Ali" ? "111" : "222" }, "administrator", "/rejected_cards");
      assert.match(String(reply), /No rejected Slash card payments/);
    }
    assert.equal(reads, 2);
  } finally { globalThis.fetch = original; }
});

function deliveryHarness() {
  const values = new Map<string, Map<string, unknown>>();
  const queues = new Map<string, Promise<unknown>>();
  const deliveries: { username: string; kind: CashReportKind; message: string }[] = [];
  let failAliM = false;
  const binding = { getByName(name: string) {
    const map = values.get(name) ?? new Map<string, unknown>();
    values.set(name, map);
    const storage = {
      async get<T>(key: string): Promise<T | undefined> { return structuredClone(map.get(key)) as T | undefined; },
      async put<T>(key: string, value: T) { map.set(key, structuredClone(value)); }
    };
    return {
      async isCashReportDelivered(date: string) { return cashReportDelivered(await storage.get<CashReportDeliveryState>(cashReportDeliveryStateKey), date); },
      deliverCashReport(date: string, username: string, message: string, kind: CashReportKind) {
        cashReportRecipient(env, username, kind);
        const next = (queues.get(name) ?? Promise.resolve()).catch(() => {}).then(() => deliverCashReportParts(storage, date, message, async (part) => {
          if (failAliM && username === "Ali M") throw new Error("Telegram unavailable");
          deliveries.push({ username, kind, message: part });
        }));
        queues.set(name, next);
        return next;
      },
      async pollOnboarding() { return 0; },
      async getTelegramAlertSettings() { return { rules: [], digestTimeUtc: null }; }
    };
  } };
  return { binding, values, deliveries, failSecondRecipient(value: boolean) { failAliM = value; } };
}

test("daily rejection delivery retries unfinished recipients, handles DST, and stays separate from cashback", async () => {
  const harness = deliveryHarness();
  const deliveryEnv = { ...env, TELEGRAM_OTP_STATE: harness.binding };
  let builds = 0;
  const build = async () => { builds++; return "Rejection report"; };
  assert.equal(await sendTelegramCashReportIfDue(deliveryEnv as never, asOf - 1, build, "daily-slash-rejected-cards"), 0);
  assert.equal(builds, 0);
  await sendTelegramCashReportIfDue(deliveryEnv as never, asOf, async () => "Cashback report", "daily-slash-cashback");
  harness.failSecondRecipient(true);
  await assert.rejects(sendTelegramCashReportIfDue(deliveryEnv as never, asOf, build, "daily-slash-rejected-cards"));
  harness.failSecondRecipient(false);
  await Promise.all([1, 2].map((minute) => sendTelegramCashReportIfDue(deliveryEnv as never, asOf + minute * 60_000, build, "daily-slash-rejected-cards")));
  assert.deepEqual(harness.deliveries.filter((row) => row.kind === "daily-slash-rejected-cards").map((row) => row.username), ["Ali", "Ali M"]);
  assert.ok(harness.values.has("telegram-slash-rejected-cards-report:ali"));
  assert.equal(harness.values.has("telegram-slash-rejected-cards-report:amin"), false);
  const completedBuilds = builds;
  assert.equal(await sendTelegramCashReportIfDue(deliveryEnv as never, asOf + 3 * 60_000, build, "daily-slash-rejected-cards"), 0);
  assert.equal(builds, completedBuilds);
  const winter = Date.parse("2026-12-01T11:00:00Z");
  assert.equal(await sendTelegramCashReportIfDue(deliveryEnv as never, winter - 1, build, "daily-slash-rejected-cards"), 0);
  assert.equal(await sendTelegramCashReportIfDue(deliveryEnv as never, winter, build, "daily-slash-rejected-cards"), 2);
});

test("a failed Slash read does not mark either recipient delivered and can retry", async () => {
  const harness = deliveryHarness();
  const deliveryEnv = { ...env, TELEGRAM_OTP_STATE: harness.binding };
  await assert.rejects(sendTelegramCashReportIfDue(deliveryEnv as never, asOf, async () => { throw new Error("Slash unavailable"); }, "daily-slash-rejected-cards"));
  assert.equal(harness.deliveries.length, 0);
  assert.equal(await sendTelegramCashReportIfDue(deliveryEnv as never, asOf + 60_000, async () => "Rejection report", "daily-slash-rejected-cards"), 2);
});

test("multipart rejection delivery resumes with the failed part without repeating earlier parts", async () => {
  const values = new Map<string, unknown>();
  const storage = {
    async get<T>(key: string) { return structuredClone(values.get(key)) as T | undefined; },
    async put<T>(key: string, value: T) { values.set(key, structuredClone(value)); }
  };
  const message = report(Array.from({ length: 80 }, (_, i) => ({ ...rejection, id: `rejection-${i}` })));
  const parts = splitCashReport(message);
  assert.ok(parts.length > 1);
  const sent: string[] = [];
  await assert.rejects(deliverCashReportParts(storage, "2026-09-15", message, async (part) => {
    if (sent.length === 1) throw new Error("Telegram unavailable");
    sent.push(part);
  }));
  assert.equal(cashReportDelivered(await storage.get<CashReportDeliveryState>(cashReportDeliveryStateKey), "2026-09-15"), false);
  await deliverCashReportParts(storage, "2026-09-15", "Rebuilt report should not replace persisted parts", async (part) => { sent.push(part); });
  assert.deepEqual(sent, parts);
  assert.equal(cashReportDelivered(await storage.get<CashReportDeliveryState>(cashReportDeliveryStateKey), "2026-09-15"), true);
});

test("minute cron dispatches rejected cards to Ali and Ali M once independently of other report kinds", async () => {
  const harness = deliveryHarness();
  const original = globalThis.fetch;
  const requests: string[] = [];
  const deliveryEnv = { ...env, TELEGRAM_OTP_STATE: {
    getByName(name: string) {
      const stub = harness.binding.getByName(name);
      return name.startsWith("telegram-slash-report:") || name.startsWith("telegram-slash-cashback-report:")
        ? { ...stub, async isCashReportDelivered() { return true; } } : stub;
    }
  }, SLASH_VIRTUAL_ACCOUNT_ALERT_NAMES: "Primary", SLASH_VIRTUAL_ACCOUNT_ALERT_THRESHOLD_USD: "10000", SLASH_VIRTUAL_ACCOUNT_ALERT_RECIPIENTS: "Ali,Ali M" };
  globalThis.fetch = sourceFetcher(requests);
  try {
    for (const time of [asOf, asOf + 60_000]) await worker.scheduled({ scheduledTime: time, cron: "* * * * *", noRetry() {} }, deliveryEnv as never);
    assert.deepEqual(harness.deliveries.map((row) => row.username), ["Ali", "Ali M"]);
    assert.ok(harness.deliveries.every((row) => row.kind === "daily-slash-rejected-cards" && row.message.includes("2026-09-14")));
    assert.equal(requests.filter((path) => path === "/transaction").length, 2);
  } finally { globalThis.fetch = original; }
});
