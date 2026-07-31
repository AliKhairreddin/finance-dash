import type { BankTransactionSource } from "./types";

export interface BankConnectionIdentityEnvironment {
  WISE_ENVIRONMENT?: string;
  WISE_CONNECTION_ID?: string;
  REVOLUT_ENVIRONMENT?: string;
  REVOLUT_CONNECTION_ID?: string;
  SLASH_BASE_URL?: string;
  SLASH_CONNECTION_ID?: string;
  AMEX_API_BASE_URL?: string;
  AMEX_CONNECTION_ID?: string;
}

function bankConnectionIdentityMaterial(
  environment: BankConnectionIdentityEnvironment,
  source: BankTransactionSource
): unknown | null {
  if (source === "wise") {
    const connectionId = environment.WISE_CONNECTION_ID?.trim();
    if (!connectionId) return null;
    return [
      environment.WISE_ENVIRONMENT?.trim() || "production",
      connectionId
    ];
  }
  if (source === "revolut") {
    const connectionId = environment.REVOLUT_CONNECTION_ID?.trim();
    if (!connectionId) return null;
    return [
      environment.REVOLUT_ENVIRONMENT?.trim() || "production",
      connectionId
    ];
  }
  if (source === "slash") {
    const baseUrl = environment.SLASH_BASE_URL?.trim().replace(/\/+$/, "");
    const connectionId = environment.SLASH_CONNECTION_ID?.trim();
    if (!baseUrl || !connectionId) return null;
    return [
      baseUrl,
      connectionId
    ];
  }
  const baseUrl = environment.AMEX_API_BASE_URL?.trim().replace(/\/+$/, "");
  const connectionId = environment.AMEX_CONNECTION_ID?.trim();
  if (!baseUrl || !connectionId) return null;
  return [
    baseUrl,
    connectionId
  ];
}

export async function bankConnectionKey(
  environment: BankConnectionIdentityEnvironment,
  source: BankTransactionSource
): Promise<string | null> {
  const identityMaterial = bankConnectionIdentityMaterial(environment, source);
  if (identityMaterial === null) return null;
  const material = new TextEncoder().encode(JSON.stringify([
    source,
    identityMaterial
  ]));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", material));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function requireBankConnectionKey(
  environment: BankConnectionIdentityEnvironment,
  source: BankTransactionSource
): Promise<string> {
  const connectionKey = await bankConnectionKey(environment, source);
  if (!connectionKey) throw new Error(`${source} connection identity is not configured`);
  return connectionKey;
}
