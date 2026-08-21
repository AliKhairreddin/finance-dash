import { DurableObject } from "cloudflare:workers";
import { setTelegramWebhook } from "./telegram";
import {
  cancelTelegramOtpTransition,
  issueTelegramOtpTransition,
  pruneTelegramOtpState,
  telegramOtpAlarmTime,
  verifyTelegramOtpTransition,
  type TelegramOtpIssueResult,
  type TelegramOtpStoredState,
  type TelegramOtpVerifyResult
} from "./telegramOtp";

const OTP_STATE_KEY = "otp-state";
const WEBHOOK_CONFIGURATION_KEY = "webhook-configuration";
const WEBHOOK_RECHECK_MS = 24 * 60 * 60 * 1000;
const textEncoder = new TextEncoder();

interface StoredWebhookConfiguration {
  fingerprint: string;
  configuredAt: number;
}

function base64UrlEncode(value: Uint8Array<ArrayBuffer>): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

async function configurationFingerprint(env: WorkerEnv, url: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(`${env.TELEGRAM_BOT_TOKEN}\u0000${env.TELEGRAM_WEBHOOK_SECRET}\u0000${url}`)
  );
  return base64UrlEncode(new Uint8Array(digest));
}

export class TelegramOtpState extends DurableObject<WorkerEnv> {
  private operationQueue: Promise<void> = Promise.resolve();

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async persistOtpState(state: TelegramOtpStoredState): Promise<void> {
    if (!state.challenge && state.requestTimes.length === 0) {
      await this.ctx.storage.delete(OTP_STATE_KEY);
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.put(OTP_STATE_KEY, state);
    const alarmTime = telegramOtpAlarmTime(state);
    if (alarmTime !== null) await this.ctx.storage.setAlarm(alarmTime);
  }

  async issueOtp(
    challengeId: string,
    codeHash: string,
    now: number
  ): Promise<TelegramOtpIssueResult> {
    return this.serialize(async () => {
      const stored = await this.ctx.storage.get<TelegramOtpStoredState>(OTP_STATE_KEY);
      const transition = issueTelegramOtpTransition(stored, { challengeId, codeHash, now });
      await this.persistOtpState(transition.state);
      return transition.result;
    });
  }

  async verifyOtp(
    challengeId: string,
    codeHash: string,
    now: number
  ): Promise<TelegramOtpVerifyResult> {
    return this.serialize(async () => {
      const stored = await this.ctx.storage.get<TelegramOtpStoredState>(OTP_STATE_KEY);
      const transition = await verifyTelegramOtpTransition(stored, { challengeId, codeHash, now });
      await this.persistOtpState(transition.state);
      return transition.result;
    });
  }

  async cancelOtp(challengeId: string, now: number): Promise<void> {
    await this.serialize(async () => {
      const stored = await this.ctx.storage.get<TelegramOtpStoredState>(OTP_STATE_KEY);
      await this.persistOtpState(cancelTelegramOtpTransition(stored, challengeId, now));
    });
  }

  async ensureWebhook(url: string): Promise<boolean> {
    return this.serialize(async () => {
      const now = Date.now();
      const fingerprint = await configurationFingerprint(this.env, url);
      const stored = await this.ctx.storage.get<StoredWebhookConfiguration>(WEBHOOK_CONFIGURATION_KEY);
      if (
        stored?.fingerprint === fingerprint &&
        stored.configuredAt > now - WEBHOOK_RECHECK_MS
      ) {
        return false;
      }

      await setTelegramWebhook(this.env, url);
      await this.ctx.storage.put(WEBHOOK_CONFIGURATION_KEY, { fingerprint, configuredAt: now });
      return true;
    });
  }

  async alarm(): Promise<void> {
    await this.serialize(async () => {
      const stored = await this.ctx.storage.get<TelegramOtpStoredState>(OTP_STATE_KEY);
      await this.persistOtpState(pruneTelegramOtpState(stored, Date.now()));
    });
  }
}
