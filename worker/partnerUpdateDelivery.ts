import { canSharePartnerUpdates, partnerUpdateRecipients, type PartnerUpdateStatus } from "../shared/partnerUpdates";
import { normalizeFinanceUsername, parseTelegramAuthUsers, TelegramDeliveryError, type TelegramAuthUser, type TelegramCommandDocument } from "./telegram";

export function partnerRecipients(env: Pick<WorkerEnv, "TELEGRAM_AUTH_USERS_JSON">): TelegramAuthUser[] {
  const users = parseTelegramAuthUsers(env.TELEGRAM_AUTH_USERS_JSON);
  if (!users) throw new Error("Telegram recipients are not configured.");
  // These are the existing Finance Dash names for the same people, not additional recipients.
  const aliases: Record<string, string[]> = { Sani: ["sani", "sanjin"], Ben: ["ben", "beno"] };
  return partnerUpdateRecipients.map(name => {
    const matches = users.filter(user => (aliases[name] ?? [normalizeFinanceUsername(name)]).includes(user.normalizedUsername));
    if (matches.length !== 1) throw new Error(`Configure exactly one Telegram account for ${name} before sharing.`);
    return { ...matches[0], username: name };
  });
}

export function partnerSender(env: Pick<WorkerEnv, "TELEGRAM_AUTH_USERS_JSON" | "TELEGRAM_COMMAND_ADMIN_USERS">, username: string): TelegramAuthUser {
  const normalized = normalizeFinanceUsername(username);
  const user = parseTelegramAuthUsers(env.TELEGRAM_AUTH_USERS_JSON)?.find(user => user.normalizedUsername === normalized);
  if (!canSharePartnerUpdates(username) || !user || !env.TELEGRAM_COMMAND_ADMIN_USERS.split(",").map(normalizeFinanceUsername).includes(normalized)) {
    throw new Error("Partner sharing is available to Ali and Ali M only.");
  }
  return user;
}

export async function deliverPartnerImages(
  status: PartnerUpdateStatus,
  recipients: TelegramAuthUser[],
  images: TelegramCommandDocument[],
  persist: (status: PartnerUpdateStatus) => Promise<void>,
  send: (chatId: string, images: TelegramCommandDocument[]) => Promise<void>
): Promise<void> {
  for (const recipient of status.recipients) {
    // An interrupted HTTP send has an unknown outcome. Never automatically duplicate it.
    if (recipient.status === "sending") { recipient.status = "unconfirmed"; await persist(status); }
    if (recipient.status !== "pending") continue;
    const target = recipients.find(user => user.username === recipient.name);
    if (!target) throw new Error("A partner recipient is no longer configured.");
    recipient.status = "sending";
    await persist(status);
    try {
      await send(target.chatId, images);
      recipient.status = "sent";
      delete recipient.error;
    } catch (error) {
      recipient.status = error instanceof TelegramDeliveryError && !error.unconfirmed ? "failed" : "unconfirmed";
      recipient.error = error instanceof Error ? error.message : "Delivery was not confirmed.";
    }
    await persist(status);
  }
  status.status = status.recipients.every(recipient => recipient.status === "sent") ? "complete" : "partial";
  await persist(status);
}
