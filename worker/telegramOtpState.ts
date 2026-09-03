import { DurableObject } from "cloudflare:workers";
import {
  configureTelegramBotCommands,
  deleteTelegramWebhook,
  pollTelegramUpdates
} from "./telegram";
import { handleTelegramCommand } from "./handler";
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
import {
  appendTelegramAlertHistory,
  confirmSlashVirtualAccountBalanceAlertTransition,
  defaultTelegramAlertSettings,
  pauseTelegramAlertRules,
  prepareSlashVirtualAccountBalanceAlertTransition,
  removeTelegramAlertRule,
  setTelegramDigestTime,
  upsertTelegramAlertRule,
  validateTelegramAlertSettings,
  type TelegramAlertDeliveryRecord,
  type TelegramAlertSettings,
  type SlashVirtualAccountBalanceAlertState,
  type SlashVirtualAccountBalanceNotification,
  type SlashVirtualAccountBalanceObservation
} from "./telegramAlerts";

const OTP_STATE_KEY = "otp-state";
const POLLING_CONFIGURATION_KEY = "polling-configuration";
const POLLING_OFFSET_KEY = "polling-offset";
const SLASH_VIRTUAL_ACCOUNT_BALANCE_ALERT_STATE_KEY = "slash-virtual-account-balance-alert-state";
const TELEGRAM_ALERT_SETTINGS_KEY = "telegram-alert-settings";
const TELEGRAM_ALERT_HISTORY_KEY = "telegram-alert-history";
const TELEGRAM_DIGEST_STATE_KEY = "telegram-digest-state";
const POLLING_CONFIGURATION_RECHECK_MS = 24 * 60 * 60 * 1000;
const textEncoder = new TextEncoder();

interface StoredPollingConfiguration {
  tokenFingerprint: string;
  commandFingerprint: string;
  configuredAt: number;
}

interface TelegramDigestState {
  lastDeliveredDate: string | null;
  pending?: { id: string; date: string };
}

function base64UrlEncode(value: Uint8Array<ArrayBuffer>): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
}

async function configurationFingerprints(
  env: WorkerEnv & { TELEGRAM_TRANSACTION_REVIEWER_USERS_JSON?: string }
): Promise<{ tokenFingerprint: string; commandFingerprint: string }> {
  const [tokenDigest, commandDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", textEncoder.encode(env.TELEGRAM_BOT_TOKEN)),
    crypto.subtle.digest(
      "SHA-256",
      textEncoder.encode([
        "finance-telegram-commands.v1",
        env.TELEGRAM_AUTH_USERS_JSON,
        env.TELEGRAM_TRANSACTION_REVIEWER_USERS_JSON ?? "",
        env.TELEGRAM_COMMAND_ADMIN_USERS,
        env.TELEGRAM_COMMAND_READ_ONLY_USERS
      ].join("\u0000"))
    )
  ]);
  return {
    tokenFingerprint: base64UrlEncode(new Uint8Array(tokenDigest)),
    commandFingerprint: base64UrlEncode(new Uint8Array(commandDigest))
  };
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
      const fingerprints = await configurationFingerprints(this.env);
      const stored = await this.ctx.storage.get<StoredPollingConfiguration>(POLLING_CONFIGURATION_KEY);
      const tokenChanged = Boolean(
        stored?.tokenFingerprint
        && stored.tokenFingerprint !== fingerprints.tokenFingerprint
      );
      const needsConfiguration = stored?.commandFingerprint !== fingerprints.commandFingerprint
        || !stored
        || stored.configuredAt <= now - POLLING_CONFIGURATION_RECHECK_MS;
      if (needsConfiguration) {
        await deleteTelegramWebhook(this.env);
        await configureTelegramBotCommands(this.env);
        await this.ctx.storage.put(POLLING_CONFIGURATION_KEY, { ...fingerprints, configuredAt: now });
        if (tokenChanged) await this.ctx.storage.delete(POLLING_OFFSET_KEY);
      }

      const offset = await this.ctx.storage.get<number>(POLLING_OFFSET_KEY) ?? 0;
      let result: Awaited<ReturnType<typeof pollTelegramUpdates>>;
      try {
        result = await pollTelegramUpdates(this.env, offset, { handleCommand: handleTelegramCommand });
      } catch (error) {
        if (needsConfiguration) throw error;
        await deleteTelegramWebhook(this.env);
        await configureTelegramBotCommands(this.env);
        await this.ctx.storage.put(POLLING_CONFIGURATION_KEY, { ...fingerprints, configuredAt: now });
        result = await pollTelegramUpdates(this.env, offset, { handleCommand: handleTelegramCommand });
      }
      if (result.nextOffset !== offset) {
        await this.ctx.storage.put(POLLING_OFFSET_KEY, result.nextOffset);
      }
      return result.processed;
    });
  }

  async prepareSlashVirtualAccountBalanceAlert(
    observation: SlashVirtualAccountBalanceObservation,
    notificationId: string
  ): Promise<SlashVirtualAccountBalanceNotification | null> {
    return this.serialize(async () => {
      const stored = await this.ctx.storage.get<SlashVirtualAccountBalanceAlertState>(
        SLASH_VIRTUAL_ACCOUNT_BALANCE_ALERT_STATE_KEY
      );
      const transition = prepareSlashVirtualAccountBalanceAlertTransition(stored, observation, notificationId);
      await this.ctx.storage.put(SLASH_VIRTUAL_ACCOUNT_BALANCE_ALERT_STATE_KEY, transition.state);
      return transition.notification;
    });
  }

  private async currentTelegramAlertSettings(
    defaultAccountNames: string[],
    defaultThreshold: number,
    now: string
  ): Promise<TelegramAlertSettings> {
    const stored = await this.ctx.storage.get<TelegramAlertSettings>(TELEGRAM_ALERT_SETTINGS_KEY);
    if (stored) return validateTelegramAlertSettings(stored);
    const settings = defaultTelegramAlertSettings(defaultAccountNames, defaultThreshold, now);
    await this.ctx.storage.put(TELEGRAM_ALERT_SETTINGS_KEY, settings);
    return settings;
  }

  async getTelegramAlertSettings(
    defaultAccountNames: string[],
    defaultThreshold: number,
    now: string
  ): Promise<TelegramAlertSettings> {
    return this.serialize(() => this.currentTelegramAlertSettings(defaultAccountNames, defaultThreshold, now));
  }

  async upsertTelegramAlertRule(
    defaultAccountNames: string[],
    defaultThreshold: number,
    accountName: string,
    threshold: number,
    now: string
  ): Promise<TelegramAlertSettings> {
    return this.serialize(async () => {
      const current = await this.currentTelegramAlertSettings(defaultAccountNames, defaultThreshold, now);
      const settings = upsertTelegramAlertRule(current, accountName, threshold, now);
      await this.ctx.storage.put(TELEGRAM_ALERT_SETTINGS_KEY, settings);
      return settings;
    });
  }

  async removeTelegramAlertRule(
    defaultAccountNames: string[],
    defaultThreshold: number,
    accountName: string,
    now: string
  ): Promise<TelegramAlertSettings> {
    return this.serialize(async () => {
      const current = await this.currentTelegramAlertSettings(defaultAccountNames, defaultThreshold, now);
      const settings = removeTelegramAlertRule(current, accountName, now);
      await this.ctx.storage.put(TELEGRAM_ALERT_SETTINGS_KEY, settings);
      return settings;
    });
  }

  async pauseTelegramAlertRules(
    defaultAccountNames: string[],
    defaultThreshold: number,
    accountName: string,
    paused: boolean,
    now: string
  ): Promise<TelegramAlertSettings> {
    return this.serialize(async () => {
      const current = await this.currentTelegramAlertSettings(defaultAccountNames, defaultThreshold, now);
      const settings = pauseTelegramAlertRules(current, accountName, paused, now);
      await this.ctx.storage.put(TELEGRAM_ALERT_SETTINGS_KEY, settings);
      return settings;
    });
  }

  async setTelegramDigestTime(
    defaultAccountNames: string[],
    defaultThreshold: number,
    digestTimeUtc: string | null,
    now: string
  ): Promise<TelegramAlertSettings> {
    return this.serialize(async () => {
      const current = await this.currentTelegramAlertSettings(defaultAccountNames, defaultThreshold, now);
      const settings = setTelegramDigestTime(current, digestTimeUtc, now);
      await this.ctx.storage.put(TELEGRAM_ALERT_SETTINGS_KEY, settings);
      return settings;
    });
  }

  async recordTelegramAlertDelivery(record: TelegramAlertDeliveryRecord): Promise<void> {
    await this.serialize(async () => {
      const stored = await this.ctx.storage.get<TelegramAlertDeliveryRecord[]>(TELEGRAM_ALERT_HISTORY_KEY);
      await this.ctx.storage.put(TELEGRAM_ALERT_HISTORY_KEY, appendTelegramAlertHistory(stored, record));
    });
  }

  async getTelegramAlertHistory(): Promise<TelegramAlertDeliveryRecord[]> {
    return this.serialize(async () =>
      await this.ctx.storage.get<TelegramAlertDeliveryRecord[]>(TELEGRAM_ALERT_HISTORY_KEY) ?? []
    );
  }

  async prepareTelegramDigest(date: string, notificationId: string): Promise<string | null> {
    return this.serialize(async () => {
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || !notificationId.trim() || notificationId.length > 128) {
        throw new Error("Telegram digest notification was invalid");
      }
      const state = await this.ctx.storage.get<TelegramDigestState>(TELEGRAM_DIGEST_STATE_KEY) ?? {
        lastDeliveredDate: null
      };
      if (state.lastDeliveredDate === date) return null;
      const pending = state.pending?.date === date ? state.pending : { id: notificationId, date };
      await this.ctx.storage.put(TELEGRAM_DIGEST_STATE_KEY, { ...state, pending });
      return pending.id;
    });
  }

  async confirmTelegramDigest(notificationId: string): Promise<void> {
    await this.serialize(async () => {
      const state = await this.ctx.storage.get<TelegramDigestState>(TELEGRAM_DIGEST_STATE_KEY);
      if (!state?.pending || state.pending.id !== notificationId) return;
      await this.ctx.storage.put(TELEGRAM_DIGEST_STATE_KEY, {
        lastDeliveredDate: state.pending.date
      } satisfies TelegramDigestState);
    });
  }

  async confirmSlashVirtualAccountBalanceAlert(notificationId: string): Promise<void> {
    await this.serialize(async () => {
      const stored = await this.ctx.storage.get<SlashVirtualAccountBalanceAlertState>(
        SLASH_VIRTUAL_ACCOUNT_BALANCE_ALERT_STATE_KEY
      );
      const nextState = confirmSlashVirtualAccountBalanceAlertTransition(stored, notificationId);
      if (nextState && nextState !== stored) {
        await this.ctx.storage.put(SLASH_VIRTUAL_ACCOUNT_BALANCE_ALERT_STATE_KEY, nextState);
      }
    });
  }

  async alarm(): Promise<void> {
    await this.serialize(async () => {
      const stored = await this.ctx.storage.get<TelegramOtpStoredState>(OTP_STATE_KEY);
      await this.persistOtpState(pruneTelegramOtpState(stored, Date.now()));
    });
  }
}
