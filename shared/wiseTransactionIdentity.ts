const wiseScopedPrefix = "wise-v2-";
const wiseUnscopedPrefix = "wise-csv-v2-";

function requiredProviderIdentifier(value: string, field: string): string {
  const identifier = value.trim();
  if (!identifier || identifier.length > 512 || /[\u0000-\u001f\u007f-\u009f]/u.test(identifier)) {
    throw new Error(`${field} must be a non-empty provider identifier of at most 512 characters`);
  }
  return identifier;
}

function requiredBalanceId(value: string | number): string {
  const balanceId = String(value).trim();
  if (!/^\d{1,32}$/.test(balanceId)) {
    throw new Error("Wise balance ID must be a positive numeric provider identifier");
  }
  return balanceId;
}

function encodeExact(value: string): string {
  return Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function decodeExact(value: string): string {
  if (!value || value.length % 2 !== 0 || !/^[0-9a-f]+$/.test(value)) {
    throw new Error("Wise transaction identifier is malformed");
  }
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/**
 * Creates an injective provider identity. Punctuation, case, and Unicode are
 * intentionally preserved so two different Wise references can never collapse.
 */
export function wiseTransactionId(
  balanceId: string | number,
  providerIdentifier: string
): string {
  return `${wiseScopedPrefix}${requiredBalanceId(balanceId)}-${encodeExact(
    requiredProviderIdentifier(providerIdentifier, "Wise transaction identifier")
  )}`;
}

/** Creates the temporary exact ID used while parsing a CSV before its balance is verified. */
export function wiseUnscopedTransactionId(providerIdentifier: string): string {
  return `${wiseUnscopedPrefix}${encodeExact(
    requiredProviderIdentifier(providerIdentifier, "Wise CSV transaction identifier")
  )}`;
}

/** Scopes a parsed CSV transaction to its verified Wise balance. */
export function scopeWiseCsvTransactionId(
  unscopedTransactionId: string,
  balanceId: string
): string {
  if (!unscopedTransactionId.startsWith(wiseUnscopedPrefix)) {
    throw new Error("Wise CSV transaction is missing its exact provider identity");
  }
  const identifier = decodeExact(unscopedTransactionId.slice(wiseUnscopedPrefix.length));
  return wiseTransactionId(balanceId, identifier);
}

export function isScopedWiseTransactionId(value: string, balanceId: string): boolean {
  return value.startsWith(`${wiseScopedPrefix}${requiredBalanceId(balanceId)}-`);
}
