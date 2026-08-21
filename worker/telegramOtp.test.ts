import assert from "node:assert/strict";
import test from "node:test";
import {
  TELEGRAM_OTP_EXPIRY_MS,
  TELEGRAM_OTP_MAX_ATTEMPTS,
  TELEGRAM_OTP_RATE_WINDOW_MS,
  issueTelegramOtpTransition,
  telegramOtpAlarmTime,
  verifyTelegramOtpTransition,
  type TelegramOtpStoredState
} from "./telegramOtp";

test("OTP issuance creates an expiring five-attempt challenge", () => {
  const now = Date.parse("2026-08-21T20:00:00.000Z");
  const transition = issueTelegramOtpTransition(undefined, {
    challengeId: "challenge-1",
    codeHash: "hash-1",
    now
  });

  assert.deepEqual(transition.result, {
    status: "issued",
    challengeId: "challenge-1",
    expiresAt: now + TELEGRAM_OTP_EXPIRY_MS
  });
  assert.equal(transition.state.challenge?.attemptsRemaining, TELEGRAM_OTP_MAX_ATTEMPTS);
  assert.deepEqual(transition.state.requestTimes, [now]);
  assert.equal(telegramOtpAlarmTime(transition.state), now + TELEGRAM_OTP_EXPIRY_MS);
});

test("OTP requests reuse the active challenge during the resend cooldown", () => {
  const now = Date.parse("2026-08-21T20:00:00.000Z");
  const issued = issueTelegramOtpTransition(undefined, {
    challengeId: "challenge-1",
    codeHash: "hash-1",
    now
  });
  const cooldown = issueTelegramOtpTransition(issued.state, {
    challengeId: "challenge-2",
    codeHash: "hash-2",
    now: now + 10_000
  });

  assert.deepEqual(cooldown.result, {
    status: "cooldown",
    challengeId: "challenge-1",
    expiresAt: now + TELEGRAM_OTP_EXPIRY_MS,
    retryAfterSeconds: 50
  });
  assert.equal(cooldown.state.challenge?.codeHash, "hash-1");
  assert.deepEqual(cooldown.state.requestTimes, [now]);
});

test("OTP issuance is limited to five requests per rolling hour", () => {
  const now = Date.parse("2026-08-21T20:00:00.000Z");
  const requestTimes = [0, 1, 2, 3, 4].map((offset) => now - 5 * 60_000 + offset * 60_000);
  const state: TelegramOtpStoredState = { requestTimes };
  const result = issueTelegramOtpTransition(state, {
    challengeId: "challenge-6",
    codeHash: "hash-6",
    now
  });

  assert.equal(result.result.status, "rate_limited");
  if (result.result.status === "rate_limited") {
    assert.equal(result.result.retryAfterSeconds, 55 * 60);
  }
  assert.equal(result.state.challenge, undefined);
});

test("OTP verification succeeds once and consumes the challenge", async () => {
  const now = Date.parse("2026-08-21T20:00:00.000Z");
  const issued = issueTelegramOtpTransition(undefined, {
    challengeId: "challenge-1",
    codeHash: "expected-hash",
    now
  });
  const verified = await verifyTelegramOtpTransition(issued.state, {
    challengeId: "challenge-1",
    codeHash: "expected-hash",
    now: now + 1_000
  });
  assert.deepEqual(verified.result, { status: "verified" });
  assert.equal(verified.state.challenge, undefined);

  const replay = await verifyTelegramOtpTransition(verified.state, {
    challengeId: "challenge-1",
    codeHash: "expected-hash",
    now: now + 2_000
  });
  assert.deepEqual(replay.result, { status: "expired" });
});

test("wrong OTP hashes decrement attempts and lock the challenge", async () => {
  const now = Date.parse("2026-08-21T20:00:00.000Z");
  let state = issueTelegramOtpTransition(undefined, {
    challengeId: "challenge-1",
    codeHash: "expected-hash",
    now
  }).state;

  for (let attempt = 1; attempt <= TELEGRAM_OTP_MAX_ATTEMPTS; attempt += 1) {
    const transition = await verifyTelegramOtpTransition(state, {
      challengeId: "challenge-1",
      codeHash: `wrong-hash-${attempt}`,
      now: now + attempt * 1_000
    });
    state = transition.state;
    if (attempt < TELEGRAM_OTP_MAX_ATTEMPTS) {
      assert.deepEqual(transition.result, {
        status: "invalid",
        attemptsRemaining: TELEGRAM_OTP_MAX_ATTEMPTS - attempt
      });
    } else {
      assert.deepEqual(transition.result, { status: "expired" });
      assert.equal(transition.state.challenge, undefined);
    }
  }
});

test("expired challenges cannot be verified", async () => {
  const now = Date.parse("2026-08-21T20:00:00.000Z");
  const issued = issueTelegramOtpTransition(undefined, {
    challengeId: "challenge-1",
    codeHash: "expected-hash",
    now
  });
  const expired = await verifyTelegramOtpTransition(issued.state, {
    challengeId: "challenge-1",
    codeHash: "expected-hash",
    now: now + TELEGRAM_OTP_EXPIRY_MS
  });
  assert.deepEqual(expired.result, { status: "expired" });
  assert.deepEqual(expired.state.requestTimes, [now]);
  assert.equal(telegramOtpAlarmTime(expired.state), now + TELEGRAM_OTP_RATE_WINDOW_MS);
});
