import assert from "node:assert/strict";
import test from "node:test";
import type { SlashVirtualAccountBalance } from "../shared/slashApi";
import {
  appendTelegramAlertHistory,
  buildSlashVirtualAccountBalanceAlertMessage,
  confirmSlashVirtualAccountBalanceAlertTransition,
  defaultTelegramAlertSettings,
  pauseTelegramAlertRules,
  prepareSlashVirtualAccountBalanceAlertTransition,
  removeTelegramAlertRule,
  sendSlashVirtualAccountBalanceAlert,
  setTelegramDigestTime,
  slashVirtualAccountAlertNames,
  slashVirtualAccountAlertRecipients,
  slashVirtualAccountAlertThreshold,
  slashVirtualAccountBalanceObservations,
  upsertTelegramAlertRule,
  type SlashVirtualAccountBalanceAlertState,
  type TelegramAlertDeliveryRecord
} from "./telegramAlerts";

function account(overrides: Partial<SlashVirtualAccountBalance> = {}): SlashVirtualAccountBalance {
  return {
    id: "virtual-primary",
    name: "Primary Account",
    accountId: "slash-platinum",
    accountType: "primary",
    balance: 12_000,
    currency: "USD",
    ...overrides
  };
}

function observation(balance = 12_000) {
  return slashVirtualAccountBalanceObservations(
    [account({ balance })],
    ["Primary Account"],
    10_000,
    "2026-09-03T12:02:00.000Z"
  )[0];
}

test("Slash virtual-account observations select the configured live balances", () => {
  const observations = slashVirtualAccountBalanceObservations([
    account({ id: "virtual-reservation", name: "Reservation Account", accountType: "default", balance: 8_000 }),
    account({ id: "virtual-primary", name: "Primary Account", balance: 15_000 }),
    account({ id: "virtual-wagner", name: "Wagner", accountType: "default", balance: 9_500 }),
    account({ id: "virtual-closed", name: "Closed", closedAt: "2026-08-01T00:00:00.000Z" })
  ], ["Primary Account", "Wagner", "Reservation Account"], 10_000, "2026-09-03T12:02:00.000Z");

  assert.deepEqual(observations.map(({ accountId, accountName, balance }) => ({
    accountId,
    accountName,
    balance
  })), [
    { accountId: "virtual-primary", accountName: "Primary Account", balance: 15_000 },
    { accountId: "virtual-wagner", accountName: "Wagner", balance: 9_500 },
    { accountId: "virtual-reservation", accountName: "Reservation Account", balance: 8_000 }
  ]);
});

test("each virtual account alerts once below threshold, retries until confirmed, and recovers once", () => {
  const healthy = observation();
  let transition = prepareSlashVirtualAccountBalanceAlertTransition(undefined, healthy, "initial");
  assert.equal(transition.notification, null);
  assert.equal(transition.state.lastDeliveredBand, "healthy");

  const low = observation(9_500);
  transition = prepareSlashVirtualAccountBalanceAlertTransition(transition.state, low, "low-1");
  assert.equal(transition.notification?.kind, "low-balance");
  assert.equal(transition.notification?.id, "low-1");

  const lower = observation(9_000);
  transition = prepareSlashVirtualAccountBalanceAlertTransition(transition.state, lower, "low-2");
  assert.equal(transition.notification?.id, "low-1");
  assert.equal(transition.notification?.balance, 9_000);

  const confirmedLow = confirmSlashVirtualAccountBalanceAlertTransition(transition.state, "low-1")!;
  transition = prepareSlashVirtualAccountBalanceAlertTransition(confirmedLow, lower, "low-3");
  assert.equal(transition.notification, null);

  const recovered = observation(10_000);
  transition = prepareSlashVirtualAccountBalanceAlertTransition(transition.state, recovered, "recovered-1");
  assert.equal(transition.notification?.kind, "recovered");
  assert.equal(transition.notification?.id, "recovered-1");

  const confirmedRecovery = confirmSlashVirtualAccountBalanceAlertTransition(transition.state, "recovered-1")!;
  transition = prepareSlashVirtualAccountBalanceAlertTransition(confirmedRecovery, recovered, "recovered-2");
  assert.equal(transition.notification, null);
});

test("an undelivered low virtual-account alert is cancelled if the balance recovers", () => {
  const pending = prepareSlashVirtualAccountBalanceAlertTransition(undefined, observation(9_500), "low-1").state;
  const transition = prepareSlashVirtualAccountBalanceAlertTransition(pending, observation(10_500), "recovered-1");
  assert.equal(transition.notification, null);
  assert.equal(transition.state.pendingNotification, undefined);
  assert.equal(transition.state.lastDeliveredBand, "healthy");
});

test("virtual-account alert messages identify the account, balance, and threshold", () => {
  const notification = prepareSlashVirtualAccountBalanceAlertTransition(
    undefined,
    observation(9_500),
    "low-1"
  ).notification!;
  const message = buildSlashVirtualAccountBalanceAlertMessage(notification);
  assert.match(message, /Slash virtual account is below the alert threshold/);
  assert.match(message, /Account: Primary Account/);
  assert.match(message, /Balance: \$9,500\.00/);
  assert.match(message, /Threshold: \$10,000\.00/);
});

test("virtual-account alerts are protected and can target either authorized user", async () => {
  const notification = prepareSlashVirtualAccountBalanceAlertTransition(
    undefined,
    observation(9_500),
    "low-1"
  ).notification!;
  const originalFetch = globalThis.fetch;
  const payloads: Array<Record<string, unknown>> = [];
  globalThis.fetch = async (_input, init) => {
    payloads.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Response.json({ ok: true, result: {} });
  };
  try {
    const env = {
      TELEGRAM_BOT_TOKEN: "123456:test-token",
      TELEGRAM_AUTH_USERS_JSON: JSON.stringify({ Ali: "111111111", "Ali M": "222222222" })
    } as never;
    await sendSlashVirtualAccountBalanceAlert(env, "Ali", notification);
    await sendSlashVirtualAccountBalanceAlert(env, "Ali M", notification);
    assert.deepEqual(payloads.map((payload) => payload.chat_id), ["111111111", "222222222"]);
    assert.equal(payloads.every((payload) => payload.protect_content === true), true);
    await assert.rejects(
      () => sendSlashVirtualAccountBalanceAlert(env, "Someone Else", notification),
      /is not an authorized Telegram user/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("virtual-account alert configuration rejects invalid values and missing accounts", () => {
  assert.equal(slashVirtualAccountAlertThreshold("10000"), 10_000);
  assert.deepEqual(
    slashVirtualAccountAlertNames("Primary Account,Wagner,Reservation Account"),
    ["Primary Account", "Wagner", "Reservation Account"]
  );
  assert.deepEqual(slashVirtualAccountAlertRecipients("Ali,Ali M"), ["Ali", "Ali M"]);
  assert.throws(() => slashVirtualAccountAlertThreshold("0"), /positive number/);
  assert.throws(() => slashVirtualAccountAlertNames("Wagner,wagner"), /duplicate values/);
  assert.throws(
    () => slashVirtualAccountBalanceObservations(
      [account()],
      ["Primary Account", "Wagner"],
      10_000,
      "2026-09-03T12:00:00.000Z"
    ),
    /Wagner is unavailable/
  );
});

test("virtual-account alert state rejects reuse for another account and stale confirmations", () => {
  const state = prepareSlashVirtualAccountBalanceAlertTransition(undefined, observation(9_500), "low-1").state;
  assert.equal(
    confirmSlashVirtualAccountBalanceAlertTransition(state, "stale") as SlashVirtualAccountBalanceAlertState,
    state
  );
  assert.throws(
    () => prepareSlashVirtualAccountBalanceAlertTransition(
      state,
      { ...observation(9_500), accountId: "virtual-wagner", accountName: "Wagner" },
      "low-2"
    ),
    /belongs to another account/
  );
});

test("persistent Telegram alert settings can add, edit, pause, remove, and schedule rules", () => {
  const initial = defaultTelegramAlertSettings(
    ["Primary Account", "Wagner", "Reservation Account"],
    10_000,
    "2026-09-03T12:00:00.000Z"
  );
  const edited = upsertTelegramAlertRule(
    initial,
    "Wagner",
    15_000,
    "2026-09-03T12:01:00.000Z"
  );
  assert.equal(edited.rules.find((rule) => rule.accountName === "Wagner")?.threshold, 15_000);
  const paused = pauseTelegramAlertRules(
    edited,
    "all",
    true,
    "2026-09-03T12:02:00.000Z"
  );
  assert.equal(paused.rules.every((rule) => rule.paused), true);
  const removed = removeTelegramAlertRule(
    paused,
    "Reservation Account",
    "2026-09-03T12:03:00.000Z"
  );
  assert.deepEqual(removed.rules.map((rule) => rule.accountName), ["Primary Account", "Wagner"]);
  const digested = setTelegramDigestTime(removed, "14:30", "2026-09-03T12:04:00.000Z");
  assert.equal(digested.digestTimeUtc, "14:30");
  assert.equal(setTelegramDigestTime(digested, null, "2026-09-03T12:05:00.000Z").digestTimeUtc, null);
  assert.throws(
    () => removeTelegramAlertRule(removed, "Unknown", "2026-09-03T12:06:00.000Z"),
    /No alert rule exists/
  );
});

test("Telegram alert history is deduplicated and remains bounded", () => {
  let history: TelegramAlertDeliveryRecord[] = [];
  for (let index = 0; index < 105; index += 1) {
    history = appendTelegramAlertHistory(history, {
      id: `notification-${index}`,
      kind: "low-balance",
      accountName: "Primary Account",
      balance: 9_000,
      threshold: 10_000,
      currency: "USD",
      recipient: "Ali",
      deliveredAt: `2026-09-03T12:${String(index % 60).padStart(2, "0")}:00.000Z`
    });
  }
  assert.equal(history.length, 100);
  assert.equal(history[0]?.id, "notification-104");
  assert.equal(history.at(-1)?.id, "notification-5");
});
