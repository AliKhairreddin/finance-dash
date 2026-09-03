import {
  financeTelegramCommands,
  parseTelegramCommandUsers,
  readOnlyFinanceTelegramCommands,
  telegramCommandMenuDescription
} from "./telegramCommandCatalog";

const TELEGRAM_API_BODY_LIMIT_BYTES = 1024 * 1024;
const TELEGRAM_UPDATE_LIMIT = 100;
const TELEGRAM_DOCUMENT_LIMIT_BYTES = 10 * 1024 * 1024;
const TELEGRAM_MESSAGE_LIMIT_CHARACTERS = 4_096;

export interface TelegramAuthUser {
  username: string;
  normalizedUsername: string;
  chatId: string;
}

type TelegramEnv = Pick<
  WorkerEnv,
  | "TELEGRAM_AUTH_USERS_JSON"
  | "TELEGRAM_BOT_TOKEN"
  | "TELEGRAM_COMMAND_ADMIN_USERS"
  | "TELEGRAM_COMMAND_READ_ONLY_USERS"
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
  text?: string;
}

interface TelegramUpdate {
  updateId: number;
  message: TelegramPrivateMessage | null;
}

interface TelegramPollingDependencies {
  getUpdates?: typeof getTelegramUpdates;
  sendMessage?: typeof sendTelegramMessage;
  sendDocument?: typeof sendTelegramDocument;
  handleCommand?: TelegramCommandHandler;
}

export type TelegramCommandRole = "administrator" | "read-only";

export interface TelegramCommandDocument {
  bytes: ArrayBuffer;
  contentType: string;
  fileName: string;
  caption?: string;
}

export interface TelegramCommandDocumentReply {
  document: TelegramCommandDocument;
  text?: string;
}

export type TelegramCommandReply = string | TelegramCommandDocumentReply;

export type TelegramCommandHandler = (
  env: WorkerEnv,
  user: TelegramAuthUser,
  role: TelegramCommandRole,
  text: string
) => Promise<TelegramCommandReply>;

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
  if (!text || text.length > TELEGRAM_MESSAGE_LIMIT_CHARACTERS) {
    throw new Error("Telegram message was invalid");
  }
  await telegramApi(env, "sendMessage", {
    chat_id: chatId,
    text,
    link_preview_options: { is_disabled: true },
    ...(protectContent ? { protect_content: true } : {})
  });
}

export async function sendTelegramDocument(
  env: Pick<TelegramEnv, "TELEGRAM_BOT_TOKEN">,
  chatId: string,
  document: TelegramCommandDocument,
  protectContent = false
): Promise<void> {
  const fileName = document.fileName.trim();
  const contentType = document.contentType.trim().toLowerCase();
  if (
    !fileName
    || fileName.length > 255
    || /[\\/\u0000-\u001f]/u.test(fileName)
    || !contentType
    || contentType.length > 128
    || document.bytes.byteLength <= 0
    || document.bytes.byteLength > TELEGRAM_DOCUMENT_LIMIT_BYTES
    || (document.caption?.length ?? 0) > 1_024
  ) {
    throw new Error("Telegram document was invalid");
  }

  const form = new FormData();
  form.set("chat_id", chatId);
  form.set("document", new Blob([document.bytes], { type: contentType }), fileName);
  if (document.caption) form.set("caption", document.caption);
  if (protectContent) form.set("protect_content", "true");

  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`, {
      method: "POST",
      body: form
    });
  } catch {
    throw new Error("Telegram sendDocument request failed");
  }
  let envelope: TelegramApiEnvelope | null = null;
  try {
    envelope = telegramApiEnvelope(await readBoundedResponseJson(response));
  } catch {
    // Every Bot API response is expected to use Telegram's bounded JSON envelope.
  }
  if (!response.ok || !envelope?.ok) throw new Error("Telegram sendDocument request failed");
}

export function buildTelegramOtpMessage(chatId: string, code: string): TelegramOtpMessagePayload {
  if (!/^[0-9]{6}$/u.test(code)) throw new Error("Telegram OTP was invalid");
  const text = [
    "🔐 Finance Dash sign-in",
    "",
    code,
    "",
    "Expires in 5 minutes.",
    "If you didn’t request this, ignore the message."
  ].join("\n");
  return {
    chat_id: chatId,
    text,
    entities: [{ type: "code", offset: text.indexOf(code), length: code.length }],
    reply_markup: {
      inline_keyboard: [[{
        text: "Copy code",
        copy_text: { text: code }
      }]]
    },
    protect_content: true
  };
}

export function formatTelegramTimestamp(value: string | number): string {
  const normalizedValue = typeof value === "string"
    ? value.replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC$/u, "$1T$2Z")
    : value;
  const date = new Date(normalizedValue);
  if (!Number.isFinite(date.getTime())) throw new Error("Telegram timestamp was invalid");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Toronto",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short"
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("month")} ${part("day")}, ${part("year")} · ${part("hour")}:${part("minute")} ${part("dayPeriod").toUpperCase()} ${part("timeZoneName")}`;
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
    text: [
      "🔐 Finance Dash sign-in detected",
      "",
      `Account: ${details.username}`,
      `Time: ${formatTelegramTimestamp(details.occurredAt)}`,
      `IP address: ${details.ipAddress}`,
      `Device: ${details.device}`,
      "",
      "⚠️ Not you? Contact your dashboard administrator immediately to revoke this session and re-enable OTP."
    ].join("\n"),
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

export async function configureTelegramBotCommands(
  env: Pick<
    TelegramEnv,
    | "TELEGRAM_AUTH_USERS_JSON"
    | "TELEGRAM_BOT_TOKEN"
    | "TELEGRAM_COMMAND_ADMIN_USERS"
    | "TELEGRAM_COMMAND_READ_ONLY_USERS"
  > & { TELEGRAM_TRANSACTION_REVIEWER_USERS_JSON?: string }
): Promise<void> {
  const administratorUsers = parseTelegramAuthUsers(env.TELEGRAM_AUTH_USERS_JSON);
  const reviewerUsers = env.TELEGRAM_TRANSACTION_REVIEWER_USERS_JSON?.trim()
    ? parseTelegramAuthUsers(env.TELEGRAM_TRANSACTION_REVIEWER_USERS_JSON)
    : [];
  if (!administratorUsers || !reviewerUsers) throw new Error("Telegram user mapping was invalid");
  const users = [...administratorUsers, ...reviewerUsers];
  if (
    new Set(users.map((user) => user.normalizedUsername)).size !== users.length
    || new Set(users.map((user) => user.chatId)).size !== users.length
  ) {
    throw new Error("Telegram user mapping was invalid");
  }
  const administratorNames = new Set(
    parseTelegramCommandUsers(env.TELEGRAM_COMMAND_ADMIN_USERS, "TELEGRAM_COMMAND_ADMIN_USERS")
      .map(normalizeFinanceUsername)
  );
  const readOnlyNames = new Set(
    parseTelegramCommandUsers(env.TELEGRAM_COMMAND_READ_ONLY_USERS, "TELEGRAM_COMMAND_READ_ONLY_USERS")
      .map(normalizeFinanceUsername)
  );
  if ([...administratorNames].some((name) => readOnlyNames.has(name))) {
    throw new Error("Telegram command administrator and read-only users overlap");
  }

  await Promise.all(users.map(async (user) => {
    const commands = administratorNames.has(user.normalizedUsername)
      ? financeTelegramCommands
      : readOnlyNames.has(user.normalizedUsername)
        ? readOnlyFinanceTelegramCommands
        : [];
    if (commands.length === 0) {
      await telegramApi(env, "deleteMyCommands", {
        scope: { type: "chat", chat_id: user.chatId }
      });
      return;
    }
    await telegramApi(env, "setMyCommands", {
      commands: commands.map((command) => ({
        command: command.command,
        description: telegramCommandMenuDescription(command)
      })),
      scope: { type: "chat", chat_id: user.chatId }
    });
  }));
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
    ...(typeof message.text === "string" && message.text.length <= 4_096
      ? { text: message.text }
      : {}),
    ...(typeof message.from.username === "string"
      ? { telegramUsername: message.from.username.slice(0, 64) }
      : {})
  };
}

function telegramCommandRole(
  user: TelegramAuthUser,
  administratorNames: ReadonlySet<string>,
  readOnlyNames: ReadonlySet<string>
): TelegramCommandRole | null {
  if (administratorNames.has(user.normalizedUsername)) return "administrator";
  if (readOnlyNames.has(user.normalizedUsername)) return "read-only";
  return null;
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
    ? [
        "✅ Finance Dash connected",
        "",
        `Hi ${message.firstName}. You’re connected as ${configuredUser.username}.`,
        "Sign-in codes will arrive in this private chat."
      ].join("\n")
    : [
        "👋 Connect Finance Dash",
        "",
        `Hi ${message.firstName}${telegramLabel}.`,
        `Chat ID: ${message.chatId}`,
        "",
        "Send this chat ID and your requested Finance Dash username to a dashboard administrator."
      ].join("\n");
}

export async function pollTelegramUpdates(
  env: WorkerEnv & { TELEGRAM_TRANSACTION_REVIEWER_USERS_JSON?: string },
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
  const commandAdministratorNames = new Set(
    parseTelegramCommandUsers(env.TELEGRAM_COMMAND_ADMIN_USERS, "TELEGRAM_COMMAND_ADMIN_USERS")
      .map(normalizeFinanceUsername)
  );
  const commandReadOnlyNames = new Set(
    parseTelegramCommandUsers(env.TELEGRAM_COMMAND_READ_ONLY_USERS, "TELEGRAM_COMMAND_READ_ONLY_USERS")
      .map(normalizeFinanceUsername)
  );
  if ([...commandAdministratorNames].some((name) => commandReadOnlyNames.has(name))) {
    throw new Error("Telegram command administrator and read-only users overlap");
  }
  const values = await (dependencies.getUpdates ?? getTelegramUpdates)(env, offset);
  let nextOffset = offset;
  let processed = 0;

  for (const value of values) {
    const update = telegramUpdate(value);
    if (update.updateId < nextOffset) continue;
    if (update.message) {
      const configuredUser = administratorUsers.find((user) => user.chatId === update.message?.chatId);
      const role = configuredUser
        ? telegramCommandRole(configuredUser, commandAdministratorNames, commandReadOnlyNames)
        : null;
      const text = update.message.text?.trim() ?? "";
      const reply: TelegramCommandReply = configuredUser && role && text.startsWith("/") && dependencies.handleCommand
        ? await dependencies.handleCommand(env, configuredUser, role, text)
        : configuredUser && !role && text.startsWith("/")
          ? "You do not have Telegram command access for Finance Dash."
          : onboardingReply(update.message, users);
      const protectContent = Boolean(configuredUser && role);
      if (typeof reply === "string") {
        await (dependencies.sendMessage ?? sendTelegramMessage)(env, update.message.chatId, reply, protectContent);
      } else {
        if (reply.text) {
          await (dependencies.sendMessage ?? sendTelegramMessage)(
            env,
            update.message.chatId,
            reply.text,
            protectContent
          );
        }
        await (dependencies.sendDocument ?? sendTelegramDocument)(
          env,
          update.message.chatId,
          reply.document,
          protectContent
        );
      }
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
