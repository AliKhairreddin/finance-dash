import assert from "node:assert/strict";
import test from "node:test";
import { fetchSlashCashbackActivity, type SlashCard, type SlashTransaction, type SlashVirtualAccountBalance } from "../shared/slashApi";
import { buildTelegramSlashCashbackReport, slashCashbackReportPeriod } from "./telegramSlashCashbackReport";
import { cashReportDelivered, cashReportDeliveryStateKey, cashReportRecipient, deliverCashReportParts,
  sendTelegramCashReportIfDue, splitCashReport, type CashReportDeliveryState, type CashReportKind } from "./telegramCashReport";
import worker, { getTelegramSlashCashbackReport, handleTelegramCommand } from "./handler";

const asOf = Date.parse("2026-09-15T10:00:00Z");
const card: SlashCard = { id: "card", last4: "1234", name: "Meta ads" };
const account: SlashVirtualAccountBalance = { id: "va", accountId: "parent", name: "Primary", accountType: "primary", balance: 1000, currency: "USD" };
const purchase: SlashTransaction = {
  id: "purchase", date: "2026-09-14T12:00:00Z", description: "Meta", amountCents: -10000,
  accountId: "parent", accountSubtype: "credit", virtualAccountId: "va", cardId: "card", status: "posted",
  cashbackInfo: { amountCents: 220, rate: 0.022 }
};
const env = {
  SLASH_BASE_URL: "https://api.slash.test", SLASH_API_KEY: "test-key", SLASH_LEGAL_ENTITY_ID: "test-entity",
  TELEGRAM_AUTH_USERS_JSON: JSON.stringify({ Ali: "111", "Ali M": "222", Amin: "333", Ben: "444" }),
  TELEGRAM_COMMAND_ADMIN_USERS: "Ali,Ali M", TELEGRAM_COMMAND_READ_ONLY_USERS: "Amin,Ben",
  TELEGRAM_CASH_REPORT_RECIPIENTS: "Ali,Ali M", TELEGRAM_SLASH_REPORT_RECIPIENTS: "Amin,Ali,Ali M",
  TELEGRAM_SLASH_CASHBACK_REPORT_RECIPIENTS: "Ali,Ali M"
};
const report = (transactions: SlashTransaction[], cards: SlashCard[] = [card]) =>
  buildTelegramSlashCashbackReport({ transactions, cards, accounts: [account], asOf });

test("cashback uses the previous Beirut calendar day, including midnight DST and year boundaries", () => {
  for (const [at, date, start, end] of [
    ["2026-09-15T10:00:00Z", "2026-09-14", "2026-09-13T21:00:00Z", "2026-09-14T21:00:00Z"],
    ["2026-01-01T11:00:00Z", "2025-12-31", "2025-12-30T22:00:00Z", "2025-12-31T22:00:00Z"],
    ["2026-03-30T10:00:00Z", "2026-03-29", "2026-03-28T22:00:00Z", "2026-03-29T21:00:00Z"],
    ["2026-10-25T11:00:00Z", "2026-10-24", "2026-10-23T21:00:00Z", "2026-10-24T22:00:00Z"]
  ]) {
    assert.deepEqual(slashCashbackReportPeriod(Date.parse(at)), { date, fromTime: Date.parse(start), toTime: Date.parse(end) });
    assert.deepEqual(slashCashbackReportPeriod(Date.parse(at) + 60_000), slashCashbackReportPeriod(Date.parse(at)));
  }
});

test("report identifies underpaid and zero-cashback cards and separates absent cashback data", () => {
  const result = report([
    purchase, purchase,
    { ...purchase, id: "zero", cardId: "zero", cashbackInfo: { amountCents: 0, rate: 0 } },
    { ...purchase, id: "missing", cardId: "missing", cashbackInfo: undefined },
    { ...purchase, id: "good", cardId: "good", cashbackInfo: { amountCents: 230, rate: 0.023 } }
  ], [card, ...["zero", "missing", "good"].map((id, i) => ({ id, last4: String(5670 + i), name: id }))]);
  assert.match(result, /2026-09-14 · Beirut · Target 2.3%/);
  assert.match(result, /3 of 4 cards need review/);
  assert.match(result, /2 below target · 1 with missing cashback data/);
  assert.match(result, /Reported cashback shortfall: \$2.40/);
  assert.match(result, /Meta ads · Card ••1234\nAccount: Primary\nPosted spend: \$100.00 · 1 purchases/);
  assert.match(result, /Cashback: \$2.20 on \$100.00 · 2.20%/);
  assert.match(result, /Cashback not reported: 1 purchases \/ \$100.00 · Target \$2.30/);
  assert.doesNotMatch(result, /good · Card/);
});

test("a high reward on the same card cannot hide a low purchase, and missing data does not become zero", () => {
  const result = report([
    { ...purchase, cashbackInfo: { amountCents: 200, rate: 0.02 } },
    { ...purchase, id: "high", cashbackInfo: { amountCents: 400, rate: 0.04 } },
    { ...purchase, id: "missing", cashbackInfo: undefined }
  ]);
  assert.match(result, /Cashback: \$6.00 on \$200.00 · 3.00%/);
  assert.match(result, /Below target: 1 purchases · Shortfall \$0.30/);
  assert.match(result, /Cashback not reported: 1 purchases/);
  const unknown = report([{ ...purchase, cashbackInfo: undefined }]);
  assert.doesNotMatch(unknown, /Cashback:|0.00%|✅/);
});

test("normal cent rounding is accepted, while a wrong rate or underpaid amount is flagged", () => {
  assert.match(report([{ ...purchase, amountCents: -500, cashbackInfo: { amountCents: 11, rate: 0.023 } }]), /All 1 cards/);
  assert.match(report([{ ...purchase, amountCents: -500, cashbackInfo: { amountCents: 10, rate: 0.023 } }]), /Below target/);
  assert.match(report([{ ...purchase, amountCents: -500, cashbackInfo: { amountCents: 11, rate: 0.022 } }]), /Below target/);
  assert.match(report([{ ...purchase, cashbackInfo: { amountCents: 400, rate: 0.04 } }]), /All 1 cards/);
});

test("only posted card debits within the whole local day are counted, with unambiguous empty states", () => {
  const excluded: SlashTransaction[] = [
    { ...purchase, status: "pending" }, { ...purchase, status: "failed" },
    { ...purchase, amountCents: 10000 }, { ...purchase, amountCents: 0 }, { ...purchase, cardId: undefined },
    { ...purchase, date: "2026-09-13T20:59:59.999Z" }, { ...purchase, date: "2026-09-14T21:00:00Z" }
  ];
  assert.match(report(excluded), /No posted Slash card purchases/);
  const result = report([
    { ...purchase, date: "2026-09-13T21:00:00Z" },
    { ...purchase, id: "end", date: "2026-09-14T20:59:59.999Z" }, ...excluded
  ]);
  assert.match(result, /Posted spend: \$200.00 · 2 purchases/);
});

test("different card IDs sharing last four digits stay separate, and closed accounts keep their labels", () => {
  const result = buildTelegramSlashCashbackReport({
    transactions: [purchase, { ...purchase, id: "two", cardId: "two" }],
    cards: [card, { ...card, id: "two", name: "Other card" }],
    accounts: [{ ...account, closedAt: "2026-09-15T00:00:00Z" }], asOf
  });
  assert.match(result, /2 of 2 cards/);
  assert.match(result, /Other card · Card ••1234/);
  assert.match(result, /Account: Primary/);
});

test("malformed values or incomplete cards never generate a misleading report", () => {
  assert.throws(() => report([purchase], []), /card details are incomplete/);
  assert.throws(() => report([{ ...purchase, date: "invalid" }]), /Invalid Slash purchase/);
  assert.throws(() => report([{ ...purchase, cashbackInfo: { amountCents: -1, rate: 0.023 } }]), /Invalid Slash cashback/);
  assert.throws(() => report([{ ...purchase, cashbackInfo: { amountCents: 1, rate: NaN } }]), /Invalid Slash cashback/);
  assert.throws(() => report([{ ...purchase, amountCents: -Number.MAX_SAFE_INTEGER }]), /calculation limit/);
});

test("all flagged cards survive Telegram message splitting", () => {
  const cards = Array.from({ length: 120 }, (_, i) => ({ id: `card-${i}`, last4: String(1000 + i), name: `Account ${i}` }));
  const text = report(cards.map((card) => ({ ...purchase, id: card.id, cardId: card.id })), cards);
  const parts = splitCashReport(text);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((part) => part.length < 4096));
  for (const card of cards) assert.ok(parts.join("\n").includes(`Card ••${card.last4}`));
});

function sourceFetcher(requests: string[]): typeof fetch {
  return async (input, init) => {
    const url = new URL(String(input));
    requests.push(url.pathname);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("X-API-Key"), "test-key");
    assert.equal(headers.get("x-legal-entity"), "test-entity");
    assert.ok(!init?.method || init.method === "GET");
    if (url.pathname === "/transaction") {
      const period = slashCashbackReportPeriod(asOf);
      assert.equal(url.searchParams.get("filter:from_date"), String(period.fromTime));
      assert.equal(url.searchParams.get("filter:to_date"), String(period.toTime - 1));
      assert.equal(url.searchParams.get("filter:status"), "posted");
      return Response.json(url.searchParams.has("cursor")
        ? { items: [purchase, { ...purchase, id: "missing", cashbackInfo: undefined }], metadata: {} }
        : { items: [purchase, { ...purchase, id: "pending", status: "pending" }], metadata: { nextCursor: "next" } });
    }
    if (url.pathname === "/card/card") return Response.json({ ...card, pan: "must never be retained" });
    if (url.pathname === "/virtual-account") return Response.json({
      items: [{ virtualAccount: account, balance: { amountCents: 100000 } }], metadata: {}
    });
    throw new Error(`Unexpected read: ${url.pathname}`);
  };
}

test("live report follows all transaction pages, de-duplicates, resolves card names and only performs reads", async () => {
  const original = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = sourceFetcher(requests);
  try {
    const result = await getTelegramSlashCashbackReport(env as never, asOf);
    assert.match(result, /Posted spend: \$200.00 · 2 purchases/);
    assert.match(result, /Meta ads · Card ••1234/);
    assert.match(result, /Cashback not reported: 1 purchases/);
    assert.deepEqual(requests.filter((path) => path === "/transaction"), ["/transaction", "/transaction"]);
    assert.equal(requests.filter((path) => path === "/card/card").length, 1);
    assert.doesNotMatch(result, /must never be retained/);
    globalThis.fetch = async () => Response.json({ error: "unavailable" }, { status: 403 });
    await assert.rejects(getTelegramSlashCashbackReport(env as never, asOf), /403/);
  } finally { globalThis.fetch = original; }
});

test("empty API pages are valid but repeated cursors and mismatched card identities stop the report", async () => {
  const options = { baseUrl: env.SLASH_BASE_URL, apiKey: env.SLASH_API_KEY, legalEntityId: env.SLASH_LEGAL_ENTITY_ID, ...slashCashbackReportPeriod(asOf) };
  const empty = await fetchSlashCashbackActivity({ ...options, fetcher: async () => Response.json({ items: [], metadata: {} }) });
  assert.deepEqual(empty, { transactions: [], cards: [], accounts: [] });
  await assert.rejects(fetchSlashCashbackActivity({ ...options, fetcher: async () => Response.json({ items: [purchase], metadata: { nextCursor: "again" } }) }), /repeated pagination/);
  const fetcher = sourceFetcher([]);
  await assert.rejects(fetchSlashCashbackActivity({ ...options, fetcher: async (input, init) =>
    String(input).includes("/card/") ? Response.json({ ...card, id: "wrong-card" }) : fetcher(input, init)
  }), /requested card/);
});

test("cashback recipients are Ali and Ali M only; other readers are denied before any source fetch", async () => {
  assert.equal(cashReportRecipient(env, " ali m ", "daily-slash-cashback").username, "Ali M");
  for (const username of ["Amin", "Ben"]) assert.throws(() => cashReportRecipient(env, username, "daily-slash-cashback"), /not authorized/);
  const original = globalThis.fetch;
  let reads = 0;
  globalThis.fetch = async () => { reads++; throw new Error("Must not fetch"); };
  try {
    for (const username of ["Amin", "Ben"]) {
      const reply = await handleTelegramCommand(env as never, { username, normalizedUsername: username.toLowerCase(), chatId: "333" }, "read-only", "/cashback_report");
      assert.match(String(reply), /Access denied/);
    }
    assert.equal(reads, 0);
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

test("daily delivery retries only unfinished recipients and stays isolated from funding reports", async () => {
  const harness = deliveryHarness();
  const deliveryEnv = { ...env, TELEGRAM_OTP_STATE: harness.binding };
  let builds = 0;
  const build = async () => { builds++; return "Cashback report"; };
  assert.equal(await sendTelegramCashReportIfDue(deliveryEnv as never, asOf - 1, build, "daily-slash-cashback"), 0);
  assert.equal(builds, 0);
  await sendTelegramCashReportIfDue(deliveryEnv as never, asOf, async () => "Funding report", "daily-slash");
  harness.failSecondRecipient(true);
  await assert.rejects(sendTelegramCashReportIfDue(deliveryEnv as never, asOf, build, "daily-slash-cashback"));
  harness.failSecondRecipient(false);
  await Promise.all([1, 2].map((minute) => sendTelegramCashReportIfDue(deliveryEnv as never, asOf + minute * 60_000, build, "daily-slash-cashback")));
  const sent = harness.deliveries.filter((row) => row.kind === "daily-slash-cashback");
  assert.deepEqual(sent.map((row) => row.username), ["Ali", "Ali M"]);
  assert.ok(harness.values.has("telegram-slash-cashback-report:ali"));
  assert.equal(harness.values.has("telegram-slash-cashback-report:amin"), false);
  const completedBuilds = builds;
  assert.equal(await sendTelegramCashReportIfDue(deliveryEnv as never, asOf + 3 * 60_000, build, "daily-slash-cashback"), 0);
  assert.equal(builds, completedBuilds);
});

test("minute cron dispatches the cashback report and repeats neither recipient on its next tick", async () => {
  const harness = deliveryHarness();
  const original = globalThis.fetch;
  const requests: string[] = [];
  const deliveryEnv = { ...env, TELEGRAM_OTP_STATE: {
    getByName(name: string) {
      const stub = harness.binding.getByName(name);
      return name.startsWith("telegram-slash-report:") ? { ...stub, async isCashReportDelivered() { return true; } } : stub;
    }
  }, SLASH_VIRTUAL_ACCOUNT_ALERT_NAMES: "Primary", SLASH_VIRTUAL_ACCOUNT_ALERT_THRESHOLD_USD: "10000", SLASH_VIRTUAL_ACCOUNT_ALERT_RECIPIENTS: "Ali,Ali M" };
  globalThis.fetch = sourceFetcher(requests);
  try {
    for (const time of [asOf, asOf + 60_000]) await worker.scheduled({ scheduledTime: time, cron: "* * * * *", noRetry() {} }, deliveryEnv as never);
    assert.deepEqual(harness.deliveries.map((row) => row.username), ["Ali", "Ali M"]);
    assert.ok(harness.deliveries.every((row) => row.kind === "daily-slash-cashback" && row.message.includes("2026-09-14")));
    assert.equal(requests.filter((path) => path === "/transaction").length, 2);
  } finally { globalThis.fetch = original; }
});
