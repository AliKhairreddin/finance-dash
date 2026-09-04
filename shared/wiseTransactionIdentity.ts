const wiseScopedPrefix = "wise-v2-";
const wiseUnscopedPrefix = "wise-csv-v2-";

type WiseCsvLedgerEntryIdentity = readonly [
  providerIdentifier: string,
  signedAmount: string,
  currency: string,
  transactionType: string,
  transactionDetailsType: string
];

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

export function wiseCsvLedgerEntryIdentifier(
  providerIdentifier: string,
  signedAmount: string,
  currency: string,
  transactionType: string,
  transactionDetailsType: string
): string {
  return JSON.stringify([
    providerIdentifier,
    signedAmount,
    currency,
    transactionType,
    transactionDetailsType
  ] satisfies WiseCsvLedgerEntryIdentity);
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

/**
 * Normalizes CSV ledger identities created before timestamps were removed from
 * the identity. Wise renders CSV timestamps in the exporter's timezone, so the
 * same transaction must never be keyed by that display value.
 */
export function canonicalWiseCsvTransactionId(value: string): string | null {
  const match = /^wise-v2-(\d{1,32})-([0-9a-f]+)$/.exec(value);
  if (!match) return null;

  let decoded: unknown;
  try {
    decoded = JSON.parse(decodeExact(match[2])) as unknown;
  } catch {
    return null;
  }
  if (!Array.isArray(decoded) || (decoded.length !== 5 && decoded.length !== 6)) {
    return null;
  }
  const components = decoded.length === 6
    ? [decoded[0], decoded[2], decoded[3], decoded[4], decoded[5]]
    : decoded;
  if (!components.every((component) => typeof component === "string")) return null;
  const [providerIdentifier, signedAmount, currency, transactionType, transactionDetailsType] = components;
  return wiseTransactionId(
    match[1],
    wiseCsvLedgerEntryIdentifier(
      providerIdentifier,
      signedAmount,
      currency,
      transactionType,
      transactionDetailsType
    )
  );
}
