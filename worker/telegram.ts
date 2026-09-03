const TELEGRAM_API_BODY_LIMIT_BYTES = 1024 * 1024;
const TELEGRAM_UPDATE_LIMIT = 100;

export interface TelegramAuthUser {
  username: string;
  normalizedUsername: string;
  chatId: string;
}

type TelegramEnv = Pick<
  WorkerEnv,
  | "TELEGRAM_AUTH_USERS_JSON"
  | "TELEGRAM_BOT_TOKEN"
  | "TELEGRAM_OTP_STATE"
> & {
  TELEGRAM_TRANSACTION_REVIEWER_USERS_JSON?: string;
};

interface TelegramApiEnvelope {
  ok: boolean;
  result?: unknown;
}

interface TelegramPrivateMessage {
  chatId: string;
  firstName: string;
  telegramUsername?: string;
}

interface TelegramUpdate {
  updateId: number;
  message: TelegramPrivateMessage | null;
}

interface TelegramPollingDependencies {
  getUpdates?: typeof getTelegramUpdates;
  sendMessage?: typeof sendTelegramMessage;
}

interface TelegramOtpMessagePayload {
  chat_id: string;
  text: string;
  entities: Array<{ type: "code"; offset: number; length: number }>;
  reply_markup: {
    inline_keyboard: Array<Array<{
      text: string;
      copy_text: { text: string };
    }>>;
  };
  protect_content: true;
}

export interface TelegramSignInAlertDetails {
  username: string;
  occurredAt: string;
  ipAddress: string;
  device: string;
}

interface TelegramSignInAlertPayload {
  chat_id: string;
  text: string;
  protect_content: true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeFinanceUsername(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/gu, " ");
}

export function parseTelegramAuthUsers(value: string | undefined): TelegramAuthUser[] | null {
  if (!value) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const users: TelegramAuthUser[] = [];
  const normalizedUsernames = new Set<string>();
  const chatIds = new Set<string>();
  for (const [username, chatIdValue] of Object.entries(parsed)) {
    const displayUsername = username.trim().replace(/\s+/gu, " ");
    const normalizedUsername = normalizeFinanceUsername(displayUsername);
    const chatId = typeof chatIdValue === "string" ? chatIdValue.trim() : "";
    if (
      !/^[a-z0-9][a-z0-9._ -]{0,63}$/u.test(normalizedUsername) ||
      !/^[1-9][0-9]{0,19}$/u.test(chatId) ||
      normalizedUsernames.has(normalizedUsername) ||
      chatIds.has(chatId)
    ) {
      return null;
    }
    normalizedUsernames.add(normalizedUsername);
    chatIds.add(chatId);
    users.push({ username: displayUsername, normalizedUsername, chatId });
  }
  return users.length > 0 ? users : null;
}

function telegramApiEnvelope(value: unknown): TelegramApiEnvelope | null {
  if (!isRecord(value) || typeof value.ok !== "boolean") return null;
  return { ok: value.ok, ...(Object.hasOwn(value, "result") ? { result: value.result } : {}) };
}

async function readBoundedResponseJson(response: Response): Promise<unknown> {
  const contentLengthHeader = response.headers.get("Content-Length");
  const contentLength = contentLengthHeader === null ? null : Number(contentLengthHeader);
  if (
    contentLength !== null &&
    (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > TELEGRAM_API_BODY_LIMIT_BYTES)
  ) {
    throw new Error("Telegram API response was invalid");
  }
  if (!response.body) throw new Error("Telegram API response was invalid");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > TELEGRAM_API_BODY_LIMIT_BYTES) {
        await reader.cancel();
        throw new Error("Telegram API response was invalid");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(body));
}

async function telegramApi(
  env: Pick<TelegramEnv, "TELEGRAM_BOT_TOKEN">,
  method: string,
  payload: Record<string, unknown>
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } catch {
    throw new Error(`Telegram ${method} request failed`);
  }

  let envelope: TelegramApiEnvelope | null = null;
  try {
    envelope = telegramApiEnvelope(await readBoundedResponseJson(response));
  } catch {
    // Every Bot API response is expected to use Telegram's bounded JSON envelope.
  }
  if (!response.ok || !envelope?.ok) {
    throw new Error(`Telegram ${method} request failed`);
  }
  return envelope.result;
}

export async function sendTelegramMessage(
  env: Pick<TelegramEnv, "TELEGRAM_BOT_TOKEN">,
  chatId: string,
  text: string,
  protectContent = false
): Promise<void> {
  await telegramApi(env, "sendMessage", {
    chat_id: chatId,
    text,
    ...(protectContent ? { protect_content: true } : {})
  });
}

export function buildTelegramOtpMessage(chatId: string, code: string): TelegramOtpMessagePayload {
  if (!/^[0-9]{6}$/u.test(code)) throw new Error("Telegram OTP was invalid");
  return {
    chat_id: chatId,
    text: `${code} — your Finance Dash sign-in code.\nExpires in 5 minutes. If you didn’t request it, ignore this message.`,
    entities: [{ type: "code", offset: 0, length: code.length }],
    reply_markup: {
      inline_keyboard: [[{
        text: "Copy code",
        copy_text: { text: code }
      }]]
    },
    protect_content: true
  };
}

export async function sendTelegramOtp(
  env: Pick<TelegramEnv, "TELEGRAM_BOT_TOKEN">,
  chatId: string,
  code: string
): Promise<void> {
  await telegramApi(env, "sendMessage", { ...buildTelegramOtpMessage(chatId, code) });
}

export function buildTelegramSignInAlertMessage(
  chatId: string,
  details: TelegramSignInAlertDetails
): TelegramSignInAlertPayload {
  return {
    chat_id: chatId,
    text: `Finance Dash sign-in detected for ${details.username}.\n\nTime: ${details.occurredAt}\nIP address: ${details.ipAddress}\nDevice: ${details.device}\n\nIf this wasn’t you, contact your dashboard administrator immediately to re-enable OTP and revoke this passwordless session.`,
    protect_content: true
  };
}

export async function sendTelegramSignInAlert(
  env: Pick<TelegramEnv, "TELEGRAM_BOT_TOKEN">,
  chatId: string,
  details: TelegramSignInAlertDetails
): Promise<void> {
  await telegramApi(env, "sendMessage", { ...buildTelegramSignInAlertMessage(chatId, details) });
}

export async function deleteTelegramWebhook(
  env: Pick<TelegramEnv, "TELEGRAM_BOT_TOKEN">
): Promise<void> {
  await telegramApi(env, "deleteWebhook", { drop_pending_updates: false });
}

async function getTelegramUpdates(
  env: Pick<TelegramEnv, "TELEGRAM_BOT_TOKEN">,
  offset: number
): Promise<unknown[]> {
  const result = await telegramApi(env, "getUpdates", {
    offset,
    limit: TELEGRAM_UPDATE_LIMIT,
    timeout: 0,
    allowed_updates: ["message"]
  });
  if (!Array.isArray(result) || result.length > TELEGRAM_UPDATE_LIMIT) {
    throw new Error("Telegram getUpdates response was invalid");
  }
  return result;
}

function telegramPrivateMessage(value: unknown): TelegramPrivateMessage | null {
  if (!isRecord(value) || !isRecord(value.message)) return null;
  const message = value.message;
  if (!isRecord(message.chat) || message.chat.type !== "private" || !isRecord(message.from)) return null;
  if (message.from.is_bot === true || typeof message.from.first_name !== "string") return null;
  const chatIdValue = message.chat.id;
  if (typeof chatIdValue !== "number" || !Number.isSafeInteger(chatIdValue) || chatIdValue <= 0) return null;
  return {
    chatId: String(chatIdValue),
    firstName: message.from.first_name.slice(0, 128),
    ...(typeof message.from.username === "string"
      ? { telegramUsername: message.from.username.slice(0, 64) }
      : {})
  };
}

function telegramUpdate(value: unknown): TelegramUpdate {
  if (!isRecord(value) || typeof value.update_id !== "number" || !Number.isSafeInteger(value.update_id)) {
    throw new Error("Telegram update was invalid");
  }
  if (value.update_id < 0 || value.update_id >= Number.MAX_SAFE_INTEGER) {
    throw new Error("Telegram update ID was invalid");
  }
  return { updateId: value.update_id, message: telegramPrivateMessage(value) };
}

function onboardingReply(message: TelegramPrivateMessage, users: TelegramAuthUser[]): string {
  const configuredUser = users.find((user) => user.chatId === message.chatId);
  const telegramLabel = message.telegramUsername ? ` (@${message.telegramUsername})` : "";
  return configuredUser
    ? `Hi ${message.firstName}. You are connected to Finance Dash as ${configuredUser.username}. You can receive sign-in codes here.`
    : `Hi ${message.firstName}${telegramLabel}. Your Finance Dash chat ID is ${message.chatId}. Send this chat ID to your dashboard administrator together with the username you want to use.`;
}

export async function pollTelegramUpdates(
  env: Pick<TelegramEnv, "TELEGRAM_AUTH_USERS_JSON" | "TELEGRAM_BOT_TOKEN" | "TELEGRAM_TRANSACTION_REVIEWER_USERS_JSON">,
  offset: number,
  dependencies: TelegramPollingDependencies = {}
): Promise<{ nextOffset: number; processed: number }> {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Telegram update offset was invalid");
  const administratorUsers = parseTelegramAuthUsers(env.TELEGRAM_AUTH_USERS_JSON);
  const transactionReviewerUsers = env.TELEGRAM_TRANSACTION_REVIEWER_USERS_JSON?.trim()
    ? parseTelegramAuthUsers(env.TELEGRAM_TRANSACTION_REVIEWER_USERS_JSON)
    : [];
  if (!administratorUsers || !transactionReviewerUsers) throw new Error("Telegram user mapping was invalid");
  const users = [...administratorUsers, ...transactionReviewerUsers];
  if (
    new Set(users.map((user) => user.normalizedUsername)).size !== users.length
    || new Set(users.map((user) => user.chatId)).size !== users.length
  ) {
    throw new Error("Telegram user mapping was invalid");
  }
  const values = await (dependencies.getUpdates ?? getTelegramUpdates)(env, offset);
  let nextOffset = offset;
  let processed = 0;

  for (const value of values) {
    const update = telegramUpdate(value);
    if (update.updateId < nextOffset) continue;
    if (update.message) {
      await (dependencies.sendMessage ?? sendTelegramMessage)(
        env,
        update.message.chatId,
        onboardingReply(update.message, users)
      );
    }
    nextOffset = update.updateId + 1;
    processed += 1;
  }
  return { nextOffset, processed };
}

export async function pollTelegramOnboarding(env: TelegramEnv): Promise<number> {
  if (!env.TELEGRAM_OTP_STATE) throw new Error("Telegram polling state is unavailable");
  return env.TELEGRAM_OTP_STATE.getByName("telegram-onboarding").pollOnboarding();
}
