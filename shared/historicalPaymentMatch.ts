/** Only for deliberate reconciliation of old Wise imports, never for generating IDs. */
export function historicalWiseTransferKey(id: string): string | undefined {
  const decode = (hex: string) => {
    if (!/^(?:[0-9a-f]{2})+$/.test(hex)) throw new Error("Invalid identity");
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(hex.match(/../g)!, byte => parseInt(byte, 16)));
  };
  try {
    const old = /^wise-v2-6c6567616379\.([0-9a-f]+)$/.exec(id);
    if (old) {
      const match = /^wise-csv-([A-Z]{3})-transfer(\d+)$/.exec(decode(old[1]));
      return match ? `${match[1]}:TRANSFER-${match[2]}` : undefined;
    }
    const current = /^wise-v2-\d+-([0-9a-f]+)$/.exec(id);
    if (!current) return undefined;
    const fields: unknown = JSON.parse(decode(current[1]));
    if (!Array.isArray(fields) || fields.length !== 5 || !/^TRANSFER-\d+$/.test(fields[0])
      || !/^[A-Z]{3}$/.test(fields[2]) || fields[3] !== "CREDIT" || fields[4] !== "DEPOSIT") return undefined;
    return `${fields[2]}:${fields[0]}`;
  } catch { return undefined; }
}
