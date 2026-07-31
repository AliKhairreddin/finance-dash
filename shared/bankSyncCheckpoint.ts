export type BankSyncProvider = "revolut" | "slash" | "wise" | "amex";

export type BankSyncCheckpoint = string;

export interface DecodedBankSyncCheckpoint {
  provider: BankSyncProvider;
  windowStart: string;
  windowEnd: string;
  cursor: string;
}

const checkpointVersion = 1;
const maximumCheckpointLength = 512 * 1024;
const maximumCursorLength = 256 * 1024;

function base64UrlEncode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Bank sync checkpoint is invalid");
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("Bank sync checkpoint is invalid");
  }
}

function canonicalTimestamp(value: unknown, field: string): string {
  if (
    typeof value !== "string"
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)
  ) {
    throw new Error(`Bank sync checkpoint ${field} is invalid`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 19) !== value.slice(0, 19)) {
    throw new Error(`Bank sync checkpoint ${field} is invalid`);
  }
  return value;
}

export function encodeBankSyncCheckpoint(checkpoint: DecodedBankSyncCheckpoint): BankSyncCheckpoint {
  const windowStart = canonicalTimestamp(checkpoint.windowStart, "windowStart");
  const windowEnd = canonicalTimestamp(checkpoint.windowEnd, "windowEnd");
  if (Date.parse(windowStart) >= Date.parse(windowEnd)) throw new Error("Bank sync checkpoint window is invalid");
  if (!checkpoint.cursor || checkpoint.cursor.length > maximumCursorLength) {
    throw new Error("Bank sync checkpoint cursor is invalid");
  }
  return base64UrlEncode(JSON.stringify({
    v: checkpointVersion,
    provider: checkpoint.provider,
    windowStart,
    windowEnd,
    cursor: checkpoint.cursor
  }));
}

export function decodeBankSyncCheckpoint(
  checkpoint: BankSyncCheckpoint,
  expectedProvider: BankSyncProvider
): DecodedBankSyncCheckpoint {
  if (!checkpoint || checkpoint.length > maximumCheckpointLength) {
    throw new Error("Bank sync checkpoint is invalid");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(base64UrlDecode(checkpoint)) as unknown;
  } catch (error) {
    if (error instanceof Error && error.message === "Bank sync checkpoint is invalid") throw error;
    throw new Error("Bank sync checkpoint is invalid");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Bank sync checkpoint is invalid");
  }
  const record = payload as Record<string, unknown>;
  if (record.v !== checkpointVersion || record.provider !== expectedProvider) {
    throw new Error("Bank sync checkpoint does not match this connector");
  }
  const windowStart = canonicalTimestamp(record.windowStart, "windowStart");
  const windowEnd = canonicalTimestamp(record.windowEnd, "windowEnd");
  if (Date.parse(windowStart) >= Date.parse(windowEnd)) throw new Error("Bank sync checkpoint window is invalid");
  if (typeof record.cursor !== "string" || !record.cursor || record.cursor.length > maximumCursorLength) {
    throw new Error("Bank sync checkpoint cursor is invalid");
  }
  return {
    provider: expectedProvider,
    windowStart,
    windowEnd,
    cursor: record.cursor
  };
}
