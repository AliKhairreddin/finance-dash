import type { Transaction } from "./types";

type WiseClassificationInput = Pick<Transaction, "source" | "wiseEntity" | "description" | "direction" | "status">;

/** Classify the movement described by Wise, never the bank name or its amount. */
export function wiseMovementCategory(transaction: WiseClassificationInput): {
  category: "Currency conversion" | "Internal transfer" | "Intercompany transfer" | "Bank fees";
  reason: string;
  merchantName?: string;
} | undefined {
  if (transaction.source !== "wise" || transaction.status === "voided") return undefined;
  const description = transaction.description.trim().replace(/\s+/g, " ");
  if (transaction.direction === "out" && /^Wise Charges for:\s*\S/i.test(description)) {
    return { category: "Bank fees", reason: "Wise explicitly identifies this entry as a fee" };
  }
  const conversion = /^Converted [\d,.]+ ([A-Z]{3}) to [\d,.]+ ([A-Z]{3})(?: \(fee:[^)]*\))?$/i.exec(description);
  if (conversion && conversion[1].toUpperCase() !== conversion[2].toUpperCase()) {
    return { category: "Currency conversion", reason: "Currency exchange between own Wise balances; the exchanged principal is not a bank fee" };
  }
  if (/^Moved [\d,.]+ [A-Z]{3} (?:from|to) .+$/i.test(description)) {
    return { category: "Internal transfer", reason: "Money moved between own Wise balances or jars" };
  }
  const transfer = /^(?:Sent money to|Received money from) (.+?)(?: with reference(?: .*)?| \(fee:[^)]*\))?$/i.exec(description);
  if (transfer && transaction.wiseEntity) {
    const recipient = transfer[1].normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
    const entity = recipient === "digitalnudgeou" ? "dn" : recipient === "lovemedobv" ? "lmd" : undefined;
    if (entity === transaction.wiseEntity) {
      return { category: "Internal transfer", reason: "Transfer between bank accounts belonging to the same company" };
    }
    if (entity) {
      return {
        category: "Intercompany transfer",
        reason: "Operational funding between Digital Nudge and LOVEMEDO, as confirmed by the owner; not a supplier expense or loan classification",
        merchantName: entity === "dn" ? "Digital Nudge" : "LOVEMEDO"
      };
    }
  }
  return undefined;
}

export function wiseMovementClassification(transaction: WiseClassificationInput) {
  const movement = wiseMovementCategory(transaction);
  if (!movement) return undefined;
  return {
    category: movement.category,
    categorySource: "rule" as const,
    categoryConfidence: 1,
    categoryReason: movement.reason,
    merchantName: movement.merchantName ?? "Wise",
    merchantKey: (movement.merchantName ?? "Wise").toLowerCase().replace(/\s+/g, ""),
    classificationComplete: true
  };
}
