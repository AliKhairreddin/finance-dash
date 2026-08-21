import { timingSafeEqual } from "node:crypto";

const TELEGRAM_WEBHOOK_PATH = "/telegram/webhook";
const TELEGRAM_UPDATE_BODY_LIMIT_BYTES = 64 * 1024;
const textEncoder = new TextEncoder();

export interface TelegramAuthUser {
  username: string;
  normalizedUsername: string;
  chatId: string;
}

type TelegramEnv = Pick<
  WorkerEnv,
  | "PUBLIC_APP_URL"
  | "TELEGRAM_AUTH_USERS_JSON"
  | "TELEGRAM_BOT_TOKEN"
  | "TELEGRAM_OTP_STATE"
  | "TELEGRAM_WEBHOOK_SECRET"
>;

interface TelegramApiEnvelope {
  ok: boolean;
  result?: unknown;
}

interface TelegramPrivateMessage {
  chatId: string;
  firstName: string;
  telegramUsername?: string;
}

interface TelegramWebhookDependencies {
  sendMessage?: typeof sendTelegramMessage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeFinanceUsername(value: string): string {
  return value.trim().toLowerCase();
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
    const normalizedUsername = normalizeFinanceUsername(username);
    const chatId = typeof chatIdValue === "string" ? chatIdValue.trim() : "";
    if (
      !/^[a-z0-9][a-z0-9._-]{0,63}$/u.test(normalizedUsername) ||
      !/^[1-9][0-9]{0,19}$/u.test(chatId) ||
      normalizedUsernames.has(normalizedUsername) ||
      chatIds.has(chatId)
    ) {
      return null;
    }
    normalizedUsernames.add(normalizedUsername);
    chatIds.add(chatId);
    users.push({ username: username.trim(), normalizedUsername, chatId });
  }
  return users.length > 0 ? users : null;
}

async function timingSafeStringEqual(left: string, right: string): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", textEncoder.encode(left)),
    crypto.subtle.digest("SHA-256", textEncoder.encode(right))
  ]);
  return timingSafeEqual(new Uint8Array(leftDigest), new Uint8Array(rightDigest));
}

function telegramApiEnvelope(value: unknown): TelegramApiEnvelope | null {
  if (!isRecord(value) || typeof value.ok !== "boolean") return null;
  return { ok: value.ok, ...(Object.hasOwn(value, "result") ? { result: value.result } : {}) };
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
    envelope = telegramApiEnvelope(await response.json());
  } catch {
    // The API response is expected to be a small JSON envelope.
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

export async function setTelegramWebhook(
  env: Pick<TelegramEnv, "TELEGRAM_BOT_TOKEN" | "TELEGRAM_WEBHOOK_SECRET">,
  url: string
): Promise<void> {
  await telegramApi(env, "setWebhook", {
    url,
    secret_token: env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message"],
    drop_pending_updates: false
  });
}

function configuredWebhookUrl(env: Pick<TelegramEnv, "PUBLIC_APP_URL">): string | null {
  try {
    const appUrl = new URL(env.PUBLIC_APP_URL);
    if (appUrl.protocol !== "https:") return null;
    return new URL(TELEGRAM_WEBHOOK_PATH, appUrl.origin).toString();
  } catch {
    return null;
  }
}

export async function ensureTelegramWebhook(env: TelegramEnv): Promise<void> {
  const webhookUrl = configuredWebhookUrl(env);
  if (!webhookUrl || !env.TELEGRAM_OTP_STATE) {
    throw new Error("Telegram webhook configuration is unavailable");
  }
  await env.TELEGRAM_OTP_STATE.getByName("telegram-webhook").ensureWebhook(webhookUrl);
}

async function readBoundedJson(request: Request, maximumBytes: number): Promise<unknown> {
  const contentType = request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
  const contentLengthHeader = request.headers.get("Content-Length");
  const contentLength = contentLengthHeader === null ? null : Number(contentLengthHeader);
  if (
    contentType !== "application/json" ||
    (contentLength !== null && (!Number.isFinite(contentLength) || contentLength > maximumBytes)) ||
    !request.body
  ) {
    throw new Error("Invalid Telegram update");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new Error("Invalid Telegram update");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(body));
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

export async function handleTelegramWebhook(
  request: Request,
  env: TelegramEnv,
  dependencies: TelegramWebhookDependencies = {}
): Promise<Response | null> {
  const webhookUrl = configuredWebhookUrl(env);
  const requestUrl = new URL(request.url);
  if (!webhookUrl || requestUrl.origin !== new URL(webhookUrl).origin || requestUrl.pathname !== TELEGRAM_WEBHOOK_PATH) {
    return null;
  }
  if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });

  const providedSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
  if (
    !env.TELEGRAM_WEBHOOK_SECRET ||
    !(await timingSafeStringEqual(providedSecret, env.TELEGRAM_WEBHOOK_SECRET))
  ) {
    return new Response(null, { status: 404 });
  }

  let update: unknown;
  try {
    update = await readBoundedJson(request, TELEGRAM_UPDATE_BODY_LIMIT_BYTES);
  } catch {
    return new Response(null, { status: 400 });
  }

  const message = telegramPrivateMessage(update);
  if (!message) return new Response(null, { status: 204 });

  const users = parseTelegramAuthUsers(env.TELEGRAM_AUTH_USERS_JSON) ?? [];
  const configuredUser = users.find((user) => user.chatId === message.chatId);
  const telegramLabel = message.telegramUsername ? ` (@${message.telegramUsername})` : "";
  const reply = configuredUser
    ? `Hi ${message.firstName}. You are connected to Finance Dash as ${configuredUser.username}. You can receive sign-in codes here.`
    : `Hi ${message.firstName}${telegramLabel}. Your Finance Dash chat ID is ${message.chatId}. Send this chat ID to your dashboard administrator together with the username you want to use.`;

  try {
    await (dependencies.sendMessage ?? sendTelegramMessage)(env, message.chatId, reply);
  } catch {
    return new Response(null, { status: 502 });
  }
  return new Response(null, { status: 204 });
}
