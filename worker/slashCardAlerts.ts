import { DurableObject } from "cloudflare:workers";
import { configureSlashCardWebhook, fetchSlashWebhook, fetchSlashCardAlertLabels, fetchSlashCardAlertTransaction, type SlashCardAlertTransaction, type SlashWebhook } from "../shared/slashApi";
import { parseSlashCardWebhookEvent, type SlashCardWebhookEvent } from "./slashCardWebhook";
import { buildSlashCardAlert, prepareSlashCardAlert, type SlashCardAlertState, type SlashCardNotification } from "./slashCardAlertState";
import { cashReportRecipient } from "./telegramCashReport";
import { parseTelegramCommandUsers } from "./telegramCommandCatalog";
import { sendTelegramMessage } from "./telegram";

interface EventJob { event: SlashCardWebhookEvent; attempts: number; completedAt?: number }
interface DeliveryJob { notification: SlashCardNotification; message?: string; recipients: { name: string; delivered: boolean }[] }
interface DeliveryScan { after?: string; blocked: string[]; failed: boolean }

/** Separate durable instances for webhook events, card incidents and configuration. */
export class SlashCardAlerts extends DurableObject<WorkerEnv> {
  private work: Promise<void> = Promise.resolve();
  private serialize<T>(run: () => Promise<T>): Promise<T> {
    const result = this.work.then(run, run);
    this.work = result.then(() => undefined, () => undefined);
    return result;
  }
  private options() {
    return { baseUrl: this.env.SLASH_BASE_URL, apiKey: this.env.SLASH_API_KEY, legalEntityId: this.env.SLASH_LEGAL_ENTITY_ID };
  }
  async configureWebhook() {
    return this.serialize(async () => {
      const webhook = await configureSlashCardWebhook({ ...this.options(), webhookUrl: String(new URL("/api/slash/card-events", this.env.PUBLIC_APP_URL)) });
      await this.ctx.storage.put("configuration", { webhook, verifiedAt: new Date().toISOString() });
      console.log(JSON.stringify({ event: "slash_card_webhook_configured", webhookId: webhook.id, status: webhook.status }));
      return webhook;
    });
  }
  async webhookStatus(): Promise<SlashWebhook | null> {
    const configuration = await this.ctx.storage.get<{ webhook: SlashWebhook }>("configuration");
    return configuration ? fetchSlashWebhook({ ...this.options(), webhookId: configuration.webhook.id }) : null;
  }
  async receive(value: SlashCardWebhookEvent): Promise<void> {
    const event = parseSlashCardWebhookEvent(value);
    await this.serialize(() => this.ctx.storage.transaction(async (storage) => {
      const current = await storage.get<EventJob>("event-job");
      if (current) {
        if (current.event.eventId !== event.eventId || current.event.entityId !== event.entityId) throw new Error("Slash webhook identity mismatch");
        return;
      }
      await storage.put("event-job", { event, attempts: 0 } satisfies EventJob);
      await storage.setAlarm(Date.now() + 1);
    }));
  }
  async observe(transaction: SlashCardAlertTransaction): Promise<void> {
    await this.serialize(() => this.ctx.storage.transaction(async (storage) => {
      const previous = await storage.get<SlashCardAlertState>("card-state");
      const seenKey = `decline:${transaction.id}`;
      const declineSeen = Boolean(await storage.get<boolean>(seenKey));
      const { state, notification } = prepareSlashCardAlert(previous, transaction, declineSeen);
      if (notification) {
        const names = parseTelegramCommandUsers(this.env.TELEGRAM_SLASH_REJECTED_CARDS_REPORT_RECIPIENTS, "TELEGRAM_SLASH_REJECTED_CARDS_REPORT_RECIPIENTS");
        const recipients = names.map((name) => ({ name: cashReportRecipient(this.env, name, "daily-slash-rejected-cards").username, delivered: false }));
        state.sequence += 1;
        if (!Number.isSafeInteger(state.sequence)) throw new Error("Slash alert sequence exceeded its limit");
        await storage.put(`pending:${String(state.sequence).padStart(16, "0")}`, { notification, recipients } satisfies DeliveryJob);
        await storage.setAlarm(Date.now() + 1);
        if (notification.kind === "declined") await storage.put(seenKey, true);
      }
      await storage.put("card-state", state);
    }));
  }
  async alarm(): Promise<void> {
    await this.serialize(async () => {
      // A persisted watchdog survives interruptions during provider reads or Telegram sends.
      await this.ctx.storage.setAlarm(Date.now() + 60_000);
      const event = await this.ctx.storage.get<EventJob>("event-job");
      if (event) {
        if (event.completedAt) { await this.ctx.storage.deleteAlarm(); return; }
        try {
          const transaction = await fetchSlashCardAlertTransaction({ ...this.options(), transactionId: event.event.entityId });
          if (transaction) await this.env.SLASH_CARD_ALERTS.getByName(`card:${JSON.stringify([this.env.SLASH_LEGAL_ENTITY_ID, transaction.cardId])}`).observe(transaction);
          await this.ctx.storage.put("event-job", { ...event, completedAt: Date.now() });
          await this.ctx.storage.deleteAlarm();
        } catch (error) {
          event.attempts += 1;
          await this.ctx.storage.put("event-job", event);
          await this.ctx.storage.setAlarm(Date.now() + Math.min(15 * 60_000, 5_000 * 2 ** Math.min(event.attempts, 8)));
          console.error(JSON.stringify({ event: "slash_card_event_retry", eventId: event.event.eventId, attempts: event.attempts, error: error instanceof Error ? error.message : "Card event failed" }));
        }
        return;
      }
      const scan = await this.ctx.storage.get<DeliveryScan>("delivery-scan") ?? { blocked: [], failed: false };
      const jobs = await this.ctx.storage.list<DeliveryJob>({ prefix: "pending:", limit: 25, startAfter: scan.after });
      let failed = scan.failed;
      const blockedRecipients = new Set(scan.blocked);
      for (const [key, job] of jobs) {
        if (job.recipients.every((recipient) => recipient.delivered || blockedRecipients.has(recipient.name))) continue;
        try {
          if (!job.message) {
            const labels = await fetchSlashCardAlertLabels({ ...this.options(), transaction: job.notification.transaction });
            job.message = buildSlashCardAlert(job.notification, labels, this.env.PUBLIC_APP_URL);
            await this.ctx.storage.put(key, job);
          }
          for (const recipient of job.recipients.filter((row) => !row.delivered)) {
            if (blockedRecipients.has(recipient.name)) continue;
            try {
              const user = cashReportRecipient(this.env, recipient.name, "daily-slash-rejected-cards");
              await sendTelegramMessage(this.env, user.chatId, job.message);
              recipient.delivered = true;
              await this.ctx.storage.put(key, job);
              console.log(JSON.stringify({ event: "slash_card_alert_sent", kind: job.notification.kind, transactionId: job.notification.transaction.id, recipient: user.username }));
            } catch (error) {
              failed = true;
              blockedRecipients.add(recipient.name);
              console.error(JSON.stringify({ event: "slash_card_alert_recipient_retry", recipient: recipient.name, error: error instanceof Error ? error.message : "Telegram delivery failed" }));
            }
          }
          if (job.recipients.every((recipient) => recipient.delivered)) await this.ctx.storage.delete(key);
        } catch (error) {
          failed = true;
          for (const recipient of job.recipients) blockedRecipients.add(recipient.name);
          console.error(JSON.stringify({ event: "slash_card_alert_retry", transactionId: job.notification.transaction.id, error: error instanceof Error ? error.message : "Card alert failed" }));
        }
        // Preserve each recipient's incident order without blocking the other user.
      }
      if (jobs.size === 25) {
        // Continue past failed deliveries so a healthy recipient can receive the whole backlog.
        await this.ctx.storage.put("delivery-scan", { after: [...jobs.keys()].at(-1), blocked: [...blockedRecipients], failed } satisfies DeliveryScan);
        await this.ctx.storage.setAlarm(Date.now() + 1);
      } else {
        await this.ctx.storage.delete("delivery-scan");
        if (failed) await this.ctx.storage.setAlarm(Date.now() + 15_000);
        else await this.ctx.storage.deleteAlarm();
      }
    });
  }
}
