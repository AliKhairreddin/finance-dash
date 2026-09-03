import assert from "node:assert/strict";
import test from "node:test";
import type { AccountBalance } from "../shared/types";
import {
  buildSlashCashBalanceAlertMessage,
  confirmSlashCashBalanceAlertTransition,
  prepareSlashCashBalanceAlertTransition,
  sendSlashCashBalanceAlert,
  slashCashAlertThreshold,
  slashCashBalanceObservation,
  type SlashCashBalanceAlertState
} from "./telegramAlerts";

function account(overrides: Partial<AccountBalance> = {}): AccountBalance {
  return {
    id: "slash-primary-cash",
    name: "Slash Primary Cash",
    source: "slash",
    slashAccountSubtype: "cash",
    balance: 12_000,
    currency: "USD",
    updatedAt: "2026-09-03T12:00:00.000Z",
    status: "live",
    ...overrides
  };
}

test("Slash cash observations total only USD cash balances", () => {
  const observation = slashCashBalanceObservation([
    account({ id: "cash-b", name: "Reserve Cash", balance: 3_000 }),
    account({ id: "cash-a", name: "Primary Cash", balance: 6_500, updatedAt: "2026-09-03T12:01:00.000Z" }),
    account({ id: "credit", name: "Primary Credit", slashAccountSubtype: "credit", balance: -2_000 }),
    account({ id: "wise", name: "Wise USD", source: "wise", balance: 50_000 })
  ], 10_000, "2026-09-03T12:02:00.000Z");

  assert.deepEqual(observation, {
    balance: 9_500,
    threshold: 10_000,
    currency: "USD",
    observedAt: "2026-09-03T12:02:00.000Z",
    sourceUpdatedAt: "2026-09-03T12:01:00.000Z",
    accounts: [
      { name: "Primary Cash", balance: 6_500 },
      { name: "Reserve Cash", balance: 3_000 }
    ]
  });
});

test("Slash cash alerts fire once below threshold, retry until confirmed, and recover once", () => {
  const healthy = slashCashBalanceObservation(
    [account()],
    10_000,
    "2026-09-03T12:02:00.000Z"
  )!;
  let transition = prepareSlashCashBalanceAlertTransition(undefined, healthy, "initial");
  assert.equal(transition.notification, null);
  assert.equal(transition.state.lastDeliveredBand, "healthy");

  const low = slashCashBalanceObservation(
    [account({ balance: 9_500 })],
    10_000,
    "2026-09-03T12:07:00.000Z"
  )!;
  transition = prepareSlashCashBalanceAlertTransition(transition.state, low, "low-1");
  assert.equal(transition.notification?.kind, "low-balance");
  assert.equal(transition.notification?.id, "low-1");

  const lower = slashCashBalanceObservation(
    [account({ balance: 9_000 })],
    10_000,
    "2026-09-03T12:12:00.000Z"
  )!;
  transition = prepareSlashCashBalanceAlertTransition(transition.state, lower, "low-2");
  assert.equal(transition.notification?.id, "low-1");
  assert.equal(transition.notification?.balance, 9_000);

  const confirmedLow = confirmSlashCashBalanceAlertTransition(transition.state, "low-1")!;
  transition = prepareSlashCashBalanceAlertTransition(confirmedLow, lower, "low-3");
  assert.equal(transition.notification, null);

  const recovered = slashCashBalanceObservation(
    [account({ balance: 10_000 })],
    10_000,
    "2026-09-03T12:17:00.000Z"
  )!;
  transition = prepareSlashCashBalanceAlertTransition(transition.state, recovered, "recovered-1");
  assert.equal(transition.notification?.kind, "recovered");
  assert.equal(transition.notification?.id, "recovered-1");

  const confirmedRecovery = confirmSlashCashBalanceAlertTransition(transition.state, "recovered-1")!;
  transition = prepareSlashCashBalanceAlertTransition(confirmedRecovery, recovered, "recovered-2");
  assert.equal(transition.notification, null);
});

test("an undelivered low alert is cancelled if the balance recovers", () => {
  const low = slashCashBalanceObservation(
    [account({ balance: 9_500 })],
    10_000,
    "2026-09-03T12:02:00.000Z"
  )!;
  const pending = prepareSlashCashBalanceAlertTransition(undefined, low, "low-1").state;
  const recovered = slashCashBalanceObservation(
    [account({ balance: 10_500 })],
    10_000,
    "2026-09-03T12:07:00.000Z"
  )!;
  const transition = prepareSlashCashBalanceAlertTransition(pending, recovered, "recovered-1");
  assert.equal(transition.notification, null);
  assert.equal(transition.state.pendingNotification, undefined);
  assert.equal(transition.state.lastDeliveredBand, "healthy");
});

test("Slash cash alert messages state the available balance and threshold", () => {
  const observation = slashCashBalanceObservation(
    [account({ balance: 9_500 })],
    10_000,
    "2026-09-03T12:02:00.000Z"
  )!;
  const notification = prepareSlashCashBalanceAlertTransition(
    undefined,
    observation,
    "low-1"
  ).notification!;
  const message = buildSlashCashBalanceAlertMessage(notification);
  assert.match(message, /Slash cash is below the alert threshold/);
  assert.match(message, /Available: \$9,500\.00/);
  assert.match(message, /Threshold: \$10,000\.00/);
  assert.match(message, /Slash Primary Cash: \$9,500\.00/);
});

test("Slash cash alerts are protected and can only target an authorized mapped user", async () => {
  const observation = slashCashBalanceObservation(
    [account({ balance: 9_500 })],
    10_000,
    "2026-09-03T12:02:00.000Z"
  )!;
  const notification = prepareSlashCashBalanceAlertTransition(
    undefined,
    observation,
    "low-1"
  ).notification!;
  const originalFetch = globalThis.fetch;
  let payload: Record<string, unknown> | undefined;
  globalThis.fetch = async (_input, init) => {
    payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({ ok: true, result: {} });
  };
  try {
    const env = {
      TELEGRAM_BOT_TOKEN: "123456:test-token",
      TELEGRAM_AUTH_USERS_JSON: JSON.stringify({ Ali: "111111111", "Ali M": "222222222" })
    } as never;
    await sendSlashCashBalanceAlert(env, "Ali M", notification);
    assert.equal(payload?.chat_id, "222222222");
    assert.equal(payload?.protect_content, true);
    await assert.rejects(
      () => sendSlashCashBalanceAlert(env, "Someone Else", notification),
      /not an authorized Telegram user/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Slash cash alert configuration rejects invalid thresholds and observations", () => {
  assert.equal(slashCashAlertThreshold("10000"), 10_000);
  assert.throws(() => slashCashAlertThreshold("0"), /positive number/);
  assert.equal(slashCashBalanceObservation([], 10_000, "2026-09-03T12:00:00.000Z"), null);
  assert.throws(
    () => slashCashBalanceObservation(
      [account({ currency: "EUR" })],
      10_000,
      "2026-09-03T12:00:00.000Z"
    ),
    /requires USD/
  );
});

test("confirmation ignores stale notification IDs", () => {
  const observation = slashCashBalanceObservation(
    [account({ balance: 9_500 })],
    10_000,
    "2026-09-03T12:02:00.000Z"
  )!;
  const state = prepareSlashCashBalanceAlertTransition(undefined, observation, "low-1").state;
  assert.equal(
    confirmSlashCashBalanceAlertTransition(state, "stale") as SlashCashBalanceAlertState,
    state
  );
});
