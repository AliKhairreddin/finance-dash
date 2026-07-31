function exactHex(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 512 || /[\u0000-\u001f\u007f-\u009f]/u.test(normalized)) {
    throw new Error(`${field} must be a non-empty provider identifier of at most 512 characters`);
  }
  return Array.from(
    new TextEncoder().encode(normalized),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");
}

function decodeExactHex(value: string): string | null {
  if (!value || value.length % 2 !== 0 || !/^[0-9a-f]+$/.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return decoded
      && decoded.length <= 512
      && decoded.trim() === decoded
      && !/[\u0000-\u001f\u007f-\u009f]/u.test(decoded)
      ? decoded
      : null;
  } catch {
    return null;
  }
}

/** Builds an injective, versioned ID from exact provider identity components. */
export function bankProviderTransactionId(
  namespace: "wise" | "revolut" | "slash" | "amex",
  components: readonly string[]
): string {
  if (components.length === 0 || components.length > 4) {
    throw new Error(`${namespace} transaction identity has an invalid component count`);
  }
  return `${namespace}-v2-${components.map((value, index) =>
    exactHex(value, `${namespace} transaction identity component ${index + 1}`)
  ).join(".")}`;
}

/** Verifies the exact versioned grammar emitted by each connector or the migration surrogate. */
export function isCurrentBankTransactionId(
  namespace: "wise" | "revolut" | "slash" | "amex",
  value: string
): boolean {
  const prefix = `${namespace}-v2-`;
  if (!value.startsWith(prefix)) return false;
  const payload = value.slice(prefix.length);

  if (namespace === "wise") {
    const scoped = /^(\d{1,32})-([0-9a-f]+)$/.exec(payload);
    if (scoped) return decodeExactHex(scoped[2]) !== null;
  }

  const components = payload.split(".");
  const decoded = components.map(decodeExactHex);
  if (decoded.some((component) => component === null)) return false;
  if (components.length === 2 && decoded[0] === "legacy") return true;
  const expectedComponents = namespace === "revolut" ? 3 : namespace === "wise" ? 0 : 2;
  return components.length === expectedComponents;
}

export function isLegacySurrogateBankTransactionId(
  namespace: "wise" | "revolut" | "slash" | "amex",
  value: string
): boolean {
  const prefix = `${namespace}-v2-`;
  if (!value.startsWith(prefix)) return false;
  const components = value.slice(prefix.length).split(".");
  return components.length === 2 && decodeExactHex(components[0]) === "legacy" && decodeExactHex(components[1]) !== null;
}
