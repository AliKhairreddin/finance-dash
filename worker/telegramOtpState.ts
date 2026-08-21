import { DurableObject } from "cloudflare:workers";
import {
  deleteTelegramWebhook,
  pollTelegramUpdates
} from "./telegram";
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
const POLLING_CONFIGURATION_KEY = "polling-configuration";
const POLLING_OFFSET_KEY = "polling-offset";
const POLLING_CONFIGURATION_RECHECK_MS = 24 * 60 * 60 * 1000;
const textEncoder = new TextEncoder();

interface StoredPollingConfiguration {
  fingerprint: string;
  configuredAt: number;
}

function base64UrlEncode(value: Uint8Array<ArrayBuffer>): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

async function configurationFingerprint(env: WorkerEnv): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(`finance-telegram-polling.v1\u0000${env.TELEGRAM_BOT_TOKEN}`)
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

  async pollOnboarding(): Promise<number> {
    return this.serialize(async () => {
      const now = Date.now();
      const fingerprint = await configurationFingerprint(this.env);
      const stored = await this.ctx.storage.get<StoredPollingConfiguration>(POLLING_CONFIGURATION_KEY);
      const tokenChanged = stored?.fingerprint !== fingerprint;
      const needsConfiguration = tokenChanged
        || !stored
        || stored.configuredAt <= now - POLLING_CONFIGURATION_RECHECK_MS;
      if (needsConfiguration) {
        await deleteTelegramWebhook(this.env);
        await this.ctx.storage.put(POLLING_CONFIGURATION_KEY, { fingerprint, configuredAt: now });
        if (tokenChanged) await this.ctx.storage.delete(POLLING_OFFSET_KEY);
      }

      const offset = await this.ctx.storage.get<number>(POLLING_OFFSET_KEY) ?? 0;
      let result: Awaited<ReturnType<typeof pollTelegramUpdates>>;
      try {
        result = await pollTelegramUpdates(this.env, offset);
      } catch (error) {
        if (needsConfiguration) throw error;
        await deleteTelegramWebhook(this.env);
        await this.ctx.storage.put(POLLING_CONFIGURATION_KEY, { fingerprint, configuredAt: now });
        result = await pollTelegramUpdates(this.env, offset);
      }
      if (result.nextOffset !== offset) {
        await this.ctx.storage.put(POLLING_OFFSET_KEY, result.nextOffset);
      }
      return result.processed;
    });
  }

  async alarm(): Promise<void> {
    await this.serialize(async () => {
      const stored = await this.ctx.storage.get<TelegramOtpStoredState>(OTP_STATE_KEY);
      await this.persistOtpState(pruneTelegramOtpState(stored, Date.now()));
    });
  }
}
