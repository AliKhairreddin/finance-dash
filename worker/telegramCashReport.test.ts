import assert from "node:assert/strict";
import test from "node:test";
import type { FxRate } from "../shared/types";
import type { SlashVirtualAccountBalance } from "../shared/slashApi";
import {
  buildTelegramCashReport,
  cashReportDateIfDue,
  cashReportDelivered,
  cashReportDeliveryStateKey,
  deliverCashReportParts,
  sendTelegramCashReportIfDue,
  splitCashReport,
  type CashReportAccount,
  type CashReportDeliveryState
} from "./telegramCashReport";
import { getTelegramCashReport, handleTelegramCommand } from "./handler";

const now = "2026-09-07T04:00:00.000Z";
function account(overrides: Partial<CashReportAccount> = {}): CashReportAccount {
  return {
    id: "wise-usd", name: "Wise USD", source: "wise", wiseEntity: "dn",
    balance: 100, currency: "USD", status: "live", updatedAt: "2026-01-01T00:00:00Z",
    syncedAt: "2026-09-07T03:55:00.000Z", ...overrides
  };
}
function slash(overrides: Partial<SlashVirtualAccountBalance> = {}): SlashVirtualAccountBalance {
  return { id: "primary", name: "Primary Account", accountId: "parent", accountType: "primary", balance: 1000, currency: "USD", ...overrides };
}
const rates: FxRate[] = [
  { asset: "EUR", rateUsd: 1.2, asOf: now, provider: "coinbase", stale: false },
  { asset: "BTC", rateUsd: 80_000, asOf: now, provider: "coinbase", stale: false }
];

test("cash report counts every open Slash virtual account once and values exact Revolut Bitcoin", () => {
  const report = buildTelegramCashReport({
    asOf: now, rates,
    accounts: [
      account(),
      account({ id: "wise-eur1", currency: "EUR", balance: 50 }),
      account({ id: "wise-eur2", currency: "EUR", balance: 25 }),
      account({ id: "zero", currency: "GBP", balance: 0 }),
      account({ id: "btc", name: "Bitcoin", source: "revolut", currency: "BTC", balance: 0.12345678 }),
      account({ id: "parent-cash", name: "Parent Cash", source: "slash", slashAccountSubtype: "cash", balance: 1200 }),
      account({ id: "parent-credit", name: "Parent Credit", source: "slash", slashAccountSubtype: "credit", balance: 500 }),
      account({ id: "amex", name: "Amex", source: "amex", balance: 900 }),
      account({ id: "seed", name: "Seed", status: "seeded", balance: 500 })
    ],
    slashAccounts: [slash(), slash({ id: "wagner", name: "Wagner", accountType: "default", balance: 200 }),
      slash({ id: "reserve", name: "Reservation Account", balance: 0 }),
      slash({ id: "closed", name: "Closed", balance: 99_999, closedAt: now })]
  });
  assert.match(report, /Total ≈ USD 11,266\.54/u);
  assert.match(report, /BTC 0\.12345678 ≈ USD 9,876\.54/u);
  assert.match(report, /Wise · Digital Nudge\n• EUR 75\.00\n• USD 100\.00/u);
  assert.match(report, /Slash · Reservation Account\n• USD 0\.00/u);
  assert.match(report, /USD 1,300\.00/u);
  assert.match(report, /7:00|07:00/u);
  assert.doesNotMatch(report, /Parent Cash|Parent Credit|Amex|Seed|Closed|stale/u);
});

test("missing or stale quotes suppress the complete USD total and stale bank checks stay visible", () => {
  const report = buildTelegramCashReport({
    accounts: [account({ source: "revolut", name: "Bitcoin", currency: "BTC", balance: 9.69354104, syncedAt: "2026-09-05T01:00:00Z" })],
    slashAccounts: [slash()], rates: rates.map((rate) => ({ ...rate, stale: true })), asOf: now
  });
  assert.match(report, /BTC 9\.69354104 · USD value unavailable/u);
  assert.match(report, /USD total unavailable/u);
  assert.match(report, /⚠️ stale/u);
  assert.match(report, /No current USD quote: BTC/u);
  assert.doesNotMatch(report, /Total ≈/u);
});

test("duplicate Slash virtual accounts cannot inflate a cash report", () => {
  assert.throws(() => buildTelegramCashReport({ accounts: [], slashAccounts: [slash(), slash()], rates: [], asOf: now }), /duplicate virtual accounts/u);
});

test("Monday 07:00 Beirut follows winter, summer and both DST transitions", () => {
  for (const [before, due, date] of [
    ["2026-01-12T04:59:00Z", "2026-01-12T05:00:00Z", "2026-01-12"],
    ["2026-09-07T03:59:00Z", "2026-09-07T04:00:00Z", "2026-09-07"],
    ["2026-03-23T04:59:00Z", "2026-03-23T05:00:00Z", "2026-03-23"],
    ["2026-03-30T03:59:00Z", "2026-03-30T04:00:00Z", "2026-03-30"],
    ["2026-10-19T03:59:00Z", "2026-10-19T04:00:00Z", "2026-10-19"],
    ["2026-10-26T04:59:00Z", "2026-10-26T05:00:00Z", "2026-10-26"]
  ]) {
    assert.equal(cashReportDateIfDue(Date.parse(before)), null);
    assert.equal(cashReportDateIfDue(Date.parse(due)), date);
  }
});

test("cash report skips every other weekday and stops Monday retries at Beirut midnight", () => {
  for (let day = 8; day <= 13; day += 1) {
    assert.equal(cashReportDateIfDue(Date.parse(`2026-09-${String(day).padStart(2, "0")}T12:00:00Z`)), null);
  }
  assert.equal(cashReportDateIfDue(Date.parse("2026-09-06T21:00:00Z")), null);
  assert.equal(cashReportDateIfDue(Date.parse("2026-09-07T20:59:00Z")), "2026-09-07");
  assert.equal(cashReportDateIfDue(Date.parse("2026-09-07T21:00:00Z")), null);
});

function memoryStorage(): Pick<DurableObjectStorage, "get" | "put"> {
  const data = new Map<string, unknown>();
  return {
    async get<T>(key: string) { return structuredClone(data.get(key)) as T | undefined; },
    async put<T>(key: string, value: T) { data.set(key, structuredClone(value)); }
  };
}

test("long reports retain all lines and failed multipart deliveries resume without resending completed parts", async () => {
  const message = Array.from({ length: 100 }, (_, i) => `Account ${i}: USD ${i}.00 ${"x".repeat(70)}`).join("\n");
  const parts = splitCashReport(message);
  assert.ok(parts.length > 1);
  assert.ok(parts.every((part) => part.length <= 4096));
  for (let i = 0; i < 100; i += 1) assert.match(parts.join("\n"), new RegExp(`Account ${i}:`, "u"));
  const storage = memoryStorage();
  const sent: string[] = [];
  let calls = 0;
  await assert.rejects(deliverCashReportParts(storage, "2026-09-07", message, async (part) => {
    calls += 1;
    if (calls === 2) throw new Error("Telegram unavailable");
    sent.push(part);
  }), /Telegram unavailable/u);
  assert.equal(await deliverCashReportParts(storage, "2026-09-07", "changed report", async (part) => { sent.push(part); }), true);
  assert.deepEqual(sent, parts);
  assert.equal(await deliverCashReportParts(storage, "2026-09-07", message, async () => { throw new Error("duplicate"); }), false);
  assert.equal(await deliverCashReportParts(storage, "2026-09-05", message, async () => { throw new Error("old event"); }), false);
  assert.equal(await deliverCashReportParts(storage, "2026-09-08", "next day", async (part) => { sent.push(part); }), true);
  assert.equal(sent.at(-1), "next day");
});

test("Monday delivery retries only failed recipients and concurrent minute ticks do not duplicate reports", async () => {
  const storages = new Map<string, ReturnType<typeof memoryStorage>>();
  const queues = new Map<string, Promise<unknown>>();
  const delivered: string[] = [];
  let failAliM = true;
  const env = {
    TELEGRAM_CASH_REPORT_RECIPIENTS: "Ali,Ali M",
    TELEGRAM_AUTH_USERS_JSON: JSON.stringify({ Ali: "111", "Ali M": "222" }),
    TELEGRAM_OTP_STATE: {
      getByName(name: string) {
        const storage = storages.get(name) ?? memoryStorage();
        storages.set(name, storage);
        return {
          async isCashReportDelivered(date: string) {
            return cashReportDelivered(await storage.get<CashReportDeliveryState>(cashReportDeliveryStateKey), date);
          },
          deliverCashReport(date: string, username: string, message: string) {
            const pending = (queues.get(name) ?? Promise.resolve()).catch(() => {}).then(() =>
              deliverCashReportParts(storage, date, message, async () => {
                if (username === "Ali M" && failAliM) throw new Error("Telegram unavailable");
                delivered.push(username);
              })
            );
            queues.set(name, pending);
            return pending;
          }
        };
      }
    }
  };
  let builds = 0;
  const build = async () => { builds += 1; return "Cash report"; };
  assert.equal(await sendTelegramCashReportIfDue(env as never, Date.parse("2026-09-07T03:59:00Z"), build), 0);
  assert.equal(builds, 0);
  await assert.rejects(sendTelegramCashReportIfDue(env as never, Date.parse(now), build), /unfinished recipients will retry/u);
  assert.deepEqual(delivered, ["Ali"]);
  assert.equal(builds, 1);
  failAliM = false;
  await Promise.all([
    sendTelegramCashReportIfDue(env as never, Date.parse(now) + 60_000, build),
    sendTelegramCashReportIfDue(env as never, Date.parse(now) + 120_000, build)
  ]);
  assert.deepEqual(delivered, ["Ali", "Ali M"]);
  const completedBuilds = builds;
  assert.equal(await sendTelegramCashReportIfDue(env as never, Date.parse(now) + 180_000, build), 0);
  assert.equal(builds, completedBuilds);
});

test("an unmapped recipient does not prevent delivery to the other authorized recipient", async () => {
  let sent = 0;
  const env = {
    TELEGRAM_CASH_REPORT_RECIPIENTS: "Ali,Ali M",
    TELEGRAM_AUTH_USERS_JSON: JSON.stringify({ Ali: "111" }),
    TELEGRAM_OTP_STATE: { getByName() { return {
      async isCashReportDelivered() { return false; },
      async deliverCashReport() { sent += 1; return true; }
    }; } }
  };
  await assert.rejects(sendTelegramCashReportIfDue(env as never, Date.parse(now), async () => "Cash report"));
  assert.equal(sent, 1);
});

test("/cash reads saved balances, all live Slash pages and fresh Bitcoin quotes without dashboard mutations", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  const env = {
    CONVEX_URL: "https://cash-test.convex.cloud", CONVEX_SERVICE_TOKEN: "test-service-token",
    WISE_CONNECTION_ID: "primary", WISE_ENVIRONMENT: "production",
    REVOLUT_CONNECTION_ID: "primary", REVOLUT_ENVIRONMENT: "production",
    SLASH_BASE_URL: "https://api.slash.com", SLASH_API_KEY: "test-slash-key", SLASH_LEGAL_ENTITY_ID: "test-entity",
    COINBASE_SPOT_PRICES_URL: "https://api.coinbase.com/v2/prices",
    TELEGRAM_COMMAND_ADMIN_USERS: "Ali,Ali M", TELEGRAM_COMMAND_READ_ONLY_USERS: "Amin"
  };
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push(url.pathname);
    if (url.pathname === "/api/query") {
      const body = JSON.parse(String(init?.body));
      assert.equal(body.path, "banking:getCashReportAccounts");
      return Response.json({ status: "success", value: [account(), account({ id: "btc", name: "Bitcoin", source: "revolut", currency: "BTC", balance: 2 })] });
    }
    if (url.pathname === "/virtual-account") {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("x-legal-entity-id") ?? headers.get("x-legal-entity"), "test-entity");
      const second = url.searchParams.has("cursor");
      return Response.json({ items: [{
        virtualAccount: { id: second ? "wagner" : "primary", name: second ? "Wagner" : "Primary Account", accountId: "parent", accountType: second ? "default" : "primary" },
        balance: { amountCents: second ? 20000 : 100000 }
      }], metadata: second ? { count: 1 } : { count: 1, nextCursor: "page2" } });
    }
    if (url.pathname === "/v2/prices/BTC-USD/spot") return Response.json({ data: { amount: "80000", currency: "USD", base: "BTC" } });
    throw new Error(`Unexpected request: ${url.pathname}`);
  };
  try {
    const reply = await handleTelegramCommand(env as never, { username: "Ali", normalizedUsername: "ali", chatId: "111" }, "administrator", "/cash");
    assert.equal(typeof reply, "string");
    assert.match(String(reply), /Total ≈ USD 161,300\.00/u);
    assert.match(String(reply), /BTC 2\.00000000 ≈ USD 160,000\.00/u);
    assert.match(String(reply), /Slash · Wagner/u);
    assert.equal(requests.filter((path) => path === "/virtual-account").length, 2);
    assert.equal(requests.includes("/api/mutation"), false);
    globalThis.fetch = async () => { throw new Error("Source unavailable"); };
    await assert.rejects(getTelegramCashReport(env as never));
  } finally { globalThis.fetch = originalFetch; }
});

test("daily Slash delivery uses a separate durable identity and runs after 17:00 Beirut", async () => {
 const names: string[] = [];
 let builds = 0;
 const env = {
   TELEGRAM_AUTH_USERS_JSON: JSON.stringify({ Ali: "5518715264" }),
   TELEGRAM_CASH_REPORT_RECIPIENTS: "Ali",
   TELEGRAM_OTP_STATE: { getByName(name: string) { names.push(name); return { async isCashReportDelivered() { return false; }, async deliverCashReport() { return true; } }; } }
 };
 const build = async () => { builds++; return "Daily report"; };
 assert.equal(await sendTelegramCashReportIfDue(env as never, Date.parse("2026-09-08T13:59:00Z"), build, "daily-slash"), 0);
 assert.equal(builds, 0);
 assert.equal(await sendTelegramCashReportIfDue(env as never, Date.parse("2026-09-08T14:00:00Z"), build, "daily-slash"), 1);
 assert.deepEqual(names, ["telegram-slash-report:ali"]);
 assert.equal(builds, 1);
});
