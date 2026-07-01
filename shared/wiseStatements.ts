import type { Transaction } from "./types";

export interface WiseStatementMetadata {
  balanceId: string;
  currency: string;
  periodStart: string;
  periodEnd: string;
  fileName: string;
}

export interface ParsedWiseStatement {
  metadata: WiseStatementMetadata;
  transactions: Transaction[];
}

const monthNumbers: Record<string, string> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12"
};

interface PendingStatementRow {
  description: string;
  continuation: string[];
  signedAmount: number;
}

function parseStatementDate(value: string): string {
  const match = value.trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (!match) throw new Error(`Unsupported Wise statement date: ${value}`);
  const [, day, monthName, year] = match;
  const month = monthNumbers[monthName.toLowerCase()];
  if (!month) throw new Error(`Unsupported Wise statement month: ${monthName}`);
  return `${year}-${month}-${day.padStart(2, "0")}`;
}

function parseAmount(value: string): number {
  return Number(value.replace(/,/g, ""));
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function transactionCategory(reference: string | undefined, description: string): string {
  if (reference) return reference.split("-")[0] || "Wise";
  if (/^Cashback\b/i.test(description)) return "BALANCE_CASHBACK";
  if (/^Card transaction\b/i.test(description)) return "CARD";
  if (/^Received money\b|^Sent money\b|^Paid to\b/i.test(description)) return "TRANSFER";
  return "Wise";
}

function counterpartyFromDescription(description: string): string {
  const card = description.match(/^Card transaction .*? issued by (.+)$/i);
  if (card) return normalizeWhitespace(card[1]);

  const received = description.match(/^Received money from (.+?)(?: with reference\b|$)/i);
  if (received) return normalizeWhitespace(received[1]);

  const sent = description.match(/^Sent money to (.+?)(?:\s+Reference:|$)/i);
  if (sent) return normalizeWhitespace(sent[1]);

  const paid = description.match(/^Paid to (.+?)(?:\s+Reference:|$)/i);
  if (paid) return normalizeWhitespace(paid[1]);

  return normalizeWhitespace(description);
}

function metadataFromText(text: string, fileName: string): WiseStatementMetadata {
  const fileMatch = fileName.match(/statement_(\d+)_([A-Z]{3})_/);
  const currency = fileMatch?.[2] ?? text.match(/\b([A-Z]{3}) statement\b/)?.[1];
  const period = text.match(/(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s+\[GMT[^\]]+\]\s+-\s+(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s+\[GMT[^\]]+\]/);

  if (!currency) throw new Error("Could not find Wise statement currency");
  if (!period) throw new Error("Could not find Wise statement period");

  return {
    balanceId: fileMatch?.[1] ?? stableHash(`${fileName}-${currency}`),
    currency,
    periodStart: parseStatementDate(period[1]),
    periodEnd: parseStatementDate(period[2]),
    fileName
  };
}

function finalizeRow(metadata: WiseStatementMetadata, pending: PendingStatementRow, dateLine: string): Transaction {
  const dateMatch = dateLine.match(/^(\d{1,2}\s+[A-Za-z]+\s+\d{4})\s+(.*)$/);
  if (!dateMatch) throw new Error(`Could not parse Wise statement transaction date: ${dateLine}`);

  const date = parseStatementDate(dateMatch[1]);
  const details = normalizeWhitespace(dateMatch[2]);
  const reference = details.match(/Transaction:\s+([^\s]+)/)?.[1];
  const description = normalizeWhitespace([pending.description, ...pending.continuation].join(" "));
  const fallbackKey = `${metadata.balanceId}-${metadata.currency}-${date}-${description}-${pending.signedAmount}`;
  const idKey = reference ?? stableHash(fallbackKey);
  const counterparty = counterpartyFromDescription(description);

  return {
    id: `wise-pdf-${metadata.balanceId}-${idKey}`,
    source: "wise",
    accountName: `Wise ${metadata.currency}`,
    date,
    description,
    rawName: counterparty,
    counterparty,
    amount: Math.abs(pending.signedAmount),
    currency: metadata.currency,
    direction: pending.signedAmount >= 0 ? "in" : "out",
    status: "posted",
    category: transactionCategory(reference, description)
  };
}

function isNoiseLine(line: string): boolean {
  return (
    /^Wise Europe SA$/i.test(line) ||
    /^Rue du Trône/i.test(line) ||
    /^Brussels$/i.test(line) ||
    /^1050$/i.test(line) ||
    /^Belgium$/i.test(line) ||
    /^Generated on:/i.test(line) ||
    /^Account Holder\b/i.test(line) ||
    /^LOVEMEDO B\.V\./i.test(line) ||
    /^BRUGSTRAAT\b/i.test(line) ||
    /^ROERMOND$/i.test(line) ||
    /^6041 ER$/i.test(line) ||
    /^Netherlands$/i.test(line) ||
    /^Description Incoming Outgoing Amount$/i.test(line) ||
    /^Wise is the trading name/i.test(line) ||
    /^registered number/i.test(line) ||
    /^Need help\?/i.test(line) ||
    /^ref:[\w-]+\s+\d+\s+\/\s+\d+$/i.test(line) ||
    /^IBAN\b|^Swift\/BIC\b|^Account number\b|^Routing number\b|^UK sort code\b/i.test(line)
  );
}

export function parseWiseStatementText(text: string, fileName: string): ParsedWiseStatement {
  const metadata = metadataFromText(text, fileName);
  const lines = text
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
  const transactions: Transaction[] = [];
  let pending: PendingStatementRow | undefined;

  for (const line of lines) {
    if (isNoiseLine(line)) continue;
    if (new RegExp(`^${metadata.currency} statement$`, "i").test(line)) continue;
    if (new RegExp(`^${metadata.currency} on .* ${metadata.currency}$`, "i").test(line)) continue;
    if (/^\d{1,2}\s+[A-Za-z]+\s+\d{4}\s+\[GMT/.test(line)) continue;

    const amountLine = line.match(/^(.+?)\s+(-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})$/);
    if (amountLine) {
      pending = {
        description: amountLine[1],
        continuation: [],
        signedAmount: parseAmount(amountLine[2])
      };
      continue;
    }

    if (/^\d{1,2}\s+[A-Za-z]+\s+\d{4}\b/.test(line) && pending) {
      transactions.push(finalizeRow(metadata, pending, line));
      pending = undefined;
      continue;
    }

    if (pending) {
      pending.continuation.push(line);
    }
  }

  return { metadata, transactions };
}
