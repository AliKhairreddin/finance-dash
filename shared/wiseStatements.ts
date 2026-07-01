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

type CsvRow = Record<string, string>;

const monthNumbers: Record<string, string> = {
  january: "01",
  jan: "01",
  february: "02",
  feb: "02",
  march: "03",
  mar: "03",
  april: "04",
  apr: "04",
  may: "05",
  june: "06",
  jun: "06",
  july: "07",
  jul: "07",
  august: "08",
  aug: "08",
  september: "09",
  sep: "09",
  sept: "09",
  october: "10",
  oct: "10",
  november: "11",
  nov: "11",
  december: "12",
  dec: "12"
};

const columnAliases = {
  date: ["date", "transactiondate", "createddate", "completeddate", "postingdate", "posteddate", "time"],
  amount: ["amount", "signedamount", "transactionamount", "paymentamount", "value"],
  incoming: ["incoming", "paidin", "moneyin", "credit"],
  outgoing: ["outgoing", "paidout", "moneyout", "debit"],
  currency: ["currency", "amountcurrency", "balancecurrency"],
  description: ["description", "details", "transactiondetails", "paymentdescription"],
  reference: ["reference", "paymentreference", "transactionreference", "transferreference"],
  transactionId: ["transactionid", "wiseid", "transferwiseid", "transferid", "referenceid", "id"],
  counterparty: [
    "counterparty",
    "counterpartyname",
    "merchant",
    "merchantname",
    "recipientname",
    "payeename",
    "sendername",
    "payername",
    "name"
  ],
  category: ["type", "transactiontype", "category"],
  accountName: ["account", "accountname", "balancename"]
};

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

function normalizeHeader(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/^\uFEFF/, "")
    .replace(/[^a-z0-9]/g, "");
}

function canonicalHeader(value: string): string {
  const normalized = normalizeHeader(value);
  return /^amount[a-z]{3}$/.test(normalized) ? "amount" : normalized;
}

function parseCsvRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === "\"") {
      if (inQuotes && nextCharacter === "\"") {
        value += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === delimiter && !inQuotes) {
      row.push(value);
      value = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !inQuotes) {
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
      if (character === "\r" && nextCharacter === "\n") index += 1;
      continue;
    }

    value += character;
  }

  if (value || row.length > 0) {
    row.push(value);
    rows.push(row);
  }

  return rows.filter((fields) => fields.some((field) => field.trim()));
}

function hasColumn(headers: string[], aliases: string[]): boolean {
  return aliases.some((alias) => headers.includes(alias));
}

function findHeaderRow(rows: string[][]): { headers: string[]; rows: string[][] } | undefined {
  const headerIndex = rows.findIndex((fields) => {
    const headers = fields.map((header) => canonicalHeader(header));
    return hasColumn(headers, columnAliases.date) && (hasColumn(headers, columnAliases.amount) || hasColumn(headers, columnAliases.incoming));
  });
  if (headerIndex === -1) return undefined;
  return {
    headers: rows[headerIndex].map((header) => canonicalHeader(header)),
    rows: rows.slice(headerIndex + 1)
  };
}

function csvObjects(text: string): CsvRow[] {
  for (const delimiter of [",", ";", "\t"]) {
    const parsedRows = parseCsvRows(text, delimiter);
    if (parsedRows.length === 0) continue;

    const table = findHeaderRow(parsedRows);
    if (!table) continue;

    return table.rows.map((fields) => {
      const row: CsvRow = {};
      table.headers.forEach((header, index) => {
        if (header) row[header] = normalizeWhitespace(fields[index] ?? "");
      });
      return row;
    });
  }

  throw new Error("Wise CSV needs Date and Amount columns");
}

function cell(row: CsvRow, aliases: string[]): string | undefined {
  for (const alias of aliases) {
    const value = row[alias];
    if (value) return value;
  }
  return undefined;
}

function parseDate(value: string): string {
  const normalized = normalizeWhitespace(value);
  const iso = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const named = normalized.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (named) {
    const [, day, monthName, year] = named;
    const month = monthNumbers[monthName.toLowerCase()];
    if (!month) throw new Error(`Unsupported Wise CSV statement month: ${monthName}`);
    return `${year}-${month}-${day.padStart(2, "0")}`;
  }

  const numeric = normalized.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
  if (numeric) {
    const [, day, month, year] = numeric;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  throw new Error(`Unsupported Wise CSV statement date: ${value}`);
}

function parseAmount(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const amountText = value
    .replace(/[^\d.,()\-+]/g, "")
    .trim();
  const decimalComma = amountText.includes(",") && !amountText.includes(".") && /,\d{1,2}\)?$/.test(amountText);
  const normalized = decimalComma ? amountText.replace(/\./g, "").replace(",", ".") : amountText.replace(/,/g, "");
  if (!normalized) return undefined;

  const negative = normalized.startsWith("(") && normalized.endsWith(")");
  const amount = Number(normalized.replace(/[()]/g, ""));
  if (!Number.isFinite(amount)) return undefined;
  return negative ? -Math.abs(amount) : amount;
}

function signedAmountFromRow(row: CsvRow): number {
  const amount = parseAmount(cell(row, columnAliases.amount));
  if (amount !== undefined) return amount;

  const incoming = parseAmount(cell(row, columnAliases.incoming)) ?? 0;
  const outgoing = parseAmount(cell(row, columnAliases.outgoing)) ?? 0;
  if (incoming !== 0) return Math.abs(incoming);
  if (outgoing !== 0) return -Math.abs(outgoing);

  throw new Error("Wise CSV needs an Amount column, or Incoming/Outgoing columns");
}

function currencyFromFileName(fileName: string): string | undefined {
  return fileName.match(/(?:^|[_\-\s])([A-Z]{3})(?:[_\-\s.]|$)/)?.[1];
}

function balanceIdFromFileName(fileName: string, currency: string): string | undefined {
  return fileName.match(new RegExp(`statement_(\\d+)_${currency}_`, "i"))?.[1];
}

function metadataFromFileName(fileName: string): WiseStatementMetadata | undefined {
  const match = fileName.match(/statement_(\d+)_([A-Z]{3})_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})/i);
  if (!match) return undefined;

  return {
    balanceId: match[1],
    currency: match[2].toUpperCase(),
    periodStart: match[3],
    periodEnd: match[4],
    fileName
  };
}

function transactionIdKey(value: string | undefined, fallback: string): string {
  return value ? normalizeHeader(value) || stableHash(value) : stableHash(fallback);
}

function counterpartyFromRow(row: CsvRow, description: string, signedAmount: number): string {
  const explicitCounterparty = cell(row, ["counterparty", "counterpartyname"]);
  if (explicitCounterparty) return explicitCounterparty;

  const merchant = cell(row, ["merchant", "merchantname"]);
  if (merchant) return merchant;

  const payer = cell(row, ["payername", "sendername"]);
  const payee = cell(row, ["payeename", "recipientname"]);
  const transferCounterparty = signedAmount >= 0 ? payer ?? payee : payee ?? payer;
  if (transferCounterparty) return transferCounterparty;

  const card = description.match(/^Card transaction .*? issued by (.+)$/i);
  if (card) return normalizeWhitespace(card[1]);

  const received = description.match(/^Received money from (.+?)(?: with reference\b|$)/i);
  if (received) return normalizeWhitespace(received[1]);

  const sent = description.match(/^Sent money to (.+?)(?:\s+Reference:|$)/i);
  if (sent) return normalizeWhitespace(sent[1]);

  const paid = description.match(/^Paid to (.+?)(?:\s+Reference:|$)/i);
  if (paid) return normalizeWhitespace(paid[1]);

  return description;
}

function categoryFromRow(row: CsvRow, reference?: string, description = ""): string {
  const category = cell(row, columnAliases.category);
  if (category) return category;
  if (reference) return reference.split("-")[0] || "Wise";
  if (/^Cashback\b/i.test(description)) return "BALANCE_CASHBACK";
  if (/^Card transaction\b/i.test(description)) return "CARD";
  if (/^Received money\b|^Sent money\b|^Paid to\b/i.test(description)) return "TRANSFER";
  return "Wise";
}

function transactionFromRow(row: CsvRow, fileName: string, fallbackCurrency?: string): Transaction {
  const date = parseDate(cell(row, columnAliases.date) ?? "");
  const signedAmount = signedAmountFromRow(row);
  const currency = (cell(row, columnAliases.currency) ?? fallbackCurrency)?.toUpperCase();
  if (!currency) throw new Error("Wise CSV needs a Currency column or a currency in the file name");

  const reference = cell(row, columnAliases.reference);
  const description = cell(row, columnAliases.description) ?? categoryFromRow(row, reference);
  const sourceId = cell(row, columnAliases.transactionId) ?? reference;
  const counterparty = counterpartyFromRow(row, description, signedAmount);
  const fallbackId = `${date}-${counterparty}-${description}-${signedAmount}-${currency}`;
  const idKey = transactionIdKey(sourceId, fallbackId);
  const category = categoryFromRow(row, reference, description);

  return {
    id: `wise-csv-${currency}-${idKey}`,
    source: "wise",
    accountName: cell(row, columnAliases.accountName) || `Wise ${currency}`,
    date,
    description,
    rawName: counterparty,
    counterparty,
    amount: Math.abs(signedAmount),
    currency,
    direction: signedAmount >= 0 ? "in" : "out",
    status: "posted",
    category
  };
}

function metadataForTransactions(transactions: Transaction[], fileName: string): WiseStatementMetadata {
  const currency = transactions[0]?.currency;
  if (!currency) throw new Error(`Wise CSV ${fileName} did not contain transaction rows`);

  const fileMetadata = metadataFromFileName(fileName);
  if (fileMetadata?.currency === currency) return fileMetadata;

  const dates = transactions.map((transaction) => transaction.date).sort((left, right) => left.localeCompare(right));
  const balanceId = balanceIdFromFileName(fileName, currency) ?? stableHash(`${fileName}-${currency}`);

  return {
    balanceId,
    currency,
    periodStart: dates[0],
    periodEnd: dates[dates.length - 1],
    fileName
  };
}

export function parseWiseStatementCsv(text: string, fileName: string): ParsedWiseStatement[] {
  const fileMetadata = metadataFromFileName(fileName);
  const fallbackCurrency = currencyFromFileName(fileName);
  const transactions = csvObjects(text)
    .map((row) => transactionFromRow(row, fileName, fallbackCurrency))
    .filter((transaction) => transaction.amount > 0);

  if (transactions.length === 0) {
    if (fileMetadata) return [{ metadata: fileMetadata, transactions: [] }];
    throw new Error(`Wise CSV ${fileName} did not contain transaction rows`);
  }

  const byCurrency = new Map<string, Transaction[]>();
  for (const transaction of transactions) {
    byCurrency.set(transaction.currency, [...(byCurrency.get(transaction.currency) ?? []), transaction]);
  }

  return [...byCurrency.values()].map((currencyTransactions) => ({
    metadata: metadataForTransactions(currencyTransactions, fileName),
    transactions: currencyTransactions
  }));
}
