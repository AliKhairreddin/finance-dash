import { timingSafeEqual } from "node:crypto";

export const TELEGRAM_OTP_EXPIRY_MS = 5 * 60 * 1000;
export const TELEGRAM_OTP_RESEND_COOLDOWN_MS = 60 * 1000;
export const TELEGRAM_OTP_RATE_WINDOW_MS = 60 * 60 * 1000;
export const TELEGRAM_OTP_MAX_REQUESTS_PER_WINDOW = 5;
export const TELEGRAM_OTP_MAX_ATTEMPTS = 5;

const textEncoder = new TextEncoder();

export interface TelegramOtpChallenge {
  challengeId: string;
  codeHash: string;
  issuedAt: number;
  expiresAt: number;
  attemptsRemaining: number;
}

export interface TelegramOtpStoredState {
  challenge?: TelegramOtpChallenge;
  requestTimes: number[];
}

export type TelegramOtpIssueResult =
  | { status: "issued"; challengeId: string; expiresAt: number }
  | { status: "cooldown"; challengeId: string; expiresAt: number; retryAfterSeconds: number }
  | { status: "rate_limited"; retryAfterSeconds: number };

export type TelegramOtpVerifyResult =
  | { status: "verified" }
  | { status: "invalid"; attemptsRemaining: number }
  | { status: "expired" };

function currentRequestTimes(state: TelegramOtpStoredState | undefined, now: number): number[] {
  return (state?.requestTimes ?? []).filter(
    (value) => Number.isSafeInteger(value) && value > now - TELEGRAM_OTP_RATE_WINDOW_MS && value <= now
  );
}

function activeChallenge(
  state: TelegramOtpStoredState | undefined,
  now: number
): TelegramOtpChallenge | undefined {
  const challenge = state?.challenge;
  if (
    !challenge ||
    challenge.expiresAt <= now ||
    challenge.issuedAt > now ||
    challenge.attemptsRemaining <= 0
  ) {
    return undefined;
  }
  return challenge;
}

export function issueTelegramOtpTransition(
  state: TelegramOtpStoredState | undefined,
  input: { challengeId: string; codeHash: string; now: number }
): { state: TelegramOtpStoredState; result: TelegramOtpIssueResult } {
  const requestTimes = currentRequestTimes(state, input.now);
  const challenge = activeChallenge(state, input.now);

  if (challenge && input.now < challenge.issuedAt + TELEGRAM_OTP_RESEND_COOLDOWN_MS) {
    return {
      state: { challenge, requestTimes },
      result: {
        status: "cooldown",
        challengeId: challenge.challengeId,
        expiresAt: challenge.expiresAt,
        retryAfterSeconds: Math.ceil(
          (challenge.issuedAt + TELEGRAM_OTP_RESEND_COOLDOWN_MS - input.now) / 1000
        )
      }
    };
  }

  if (requestTimes.length >= TELEGRAM_OTP_MAX_REQUESTS_PER_WINDOW) {
    return {
      state: { ...(challenge ? { challenge } : {}), requestTimes },
      result: {
        status: "rate_limited",
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((requestTimes[0] + TELEGRAM_OTP_RATE_WINDOW_MS - input.now) / 1000)
        )
      }
    };
  }

  const nextChallenge: TelegramOtpChallenge = {
    challengeId: input.challengeId,
    codeHash: input.codeHash,
    issuedAt: input.now,
    expiresAt: input.now + TELEGRAM_OTP_EXPIRY_MS,
    attemptsRemaining: TELEGRAM_OTP_MAX_ATTEMPTS
  };
  return {
    state: { challenge: nextChallenge, requestTimes: [...requestTimes, input.now] },
    result: {
      status: "issued",
      challengeId: nextChallenge.challengeId,
      expiresAt: nextChallenge.expiresAt
    }
  };
}

async function timingSafeStringEqual(left: string, right: string): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", textEncoder.encode(left)),
    crypto.subtle.digest("SHA-256", textEncoder.encode(right))
  ]);
  return timingSafeEqual(new Uint8Array(leftDigest), new Uint8Array(rightDigest));
}

export async function verifyTelegramOtpTransition(
  state: TelegramOtpStoredState | undefined,
  input: { challengeId: string; codeHash: string; now: number }
): Promise<{ state: TelegramOtpStoredState; result: TelegramOtpVerifyResult }> {
  const requestTimes = currentRequestTimes(state, input.now);
  const challenge = activeChallenge(state, input.now);
  if (!challenge || challenge.challengeId !== input.challengeId) {
    return { state: { requestTimes }, result: { status: "expired" } };
  }

  if (await timingSafeStringEqual(challenge.codeHash, input.codeHash)) {
    return { state: { requestTimes }, result: { status: "verified" } };
  }

  const attemptsRemaining = challenge.attemptsRemaining - 1;
  if (attemptsRemaining <= 0) {
    return { state: { requestTimes }, result: { status: "expired" } };
  }

  return {
    state: { challenge: { ...challenge, attemptsRemaining }, requestTimes },
    result: { status: "invalid", attemptsRemaining }
  };
}

export function cancelTelegramOtpTransition(
  state: TelegramOtpStoredState | undefined,
  challengeId: string,
  now: number
): TelegramOtpStoredState {
  const requestTimes = currentRequestTimes(state, now);
  const challenge = state?.challenge;
  if (!challenge || challenge.challengeId !== challengeId) {
    return { ...(activeChallenge(state, now) ? { challenge: state?.challenge } : {}), requestTimes };
  }
  return {
    requestTimes: requestTimes.filter((requestTime) => requestTime !== challenge.issuedAt)
  };
}

export function pruneTelegramOtpState(
  state: TelegramOtpStoredState | undefined,
  now: number
): TelegramOtpStoredState {
  const requestTimes = currentRequestTimes(state, now);
  const challenge = activeChallenge(state, now);
  return { ...(challenge ? { challenge } : {}), requestTimes };
}

export function telegramOtpAlarmTime(state: TelegramOtpStoredState): number | null {
  const candidates: number[] = [];
  if (state.challenge) candidates.push(state.challenge.expiresAt);
  if (state.requestTimes.length > 0) {
    candidates.push(state.requestTimes[0] + TELEGRAM_OTP_RATE_WINDOW_MS);
  }
  return candidates.length > 0 ? Math.min(...candidates) : null;
}
