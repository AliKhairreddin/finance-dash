import { transactionBusinessCategory } from "./categories";
import type {
  ImportWiseStatementPayload,
  Transaction,
  WiseEntity,
  WiseStatementImport
} from "./types";
import {
  isScopedWiseTransactionId,
  scopeWiseCsvTransactionId,
  wiseUnscopedTransactionId
} from "./wiseTransactionIdentity";
import {
  requireWiseEntityFromAccountName,
  type VerifiedWiseStatementAccount
} from "./wiseEntities";

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

const maximumWiseCsvBytes = 5 * 1024 * 1024;
const maximumWiseCsvRows = 10_000;
const maximumWiseImportTransactions = 5_000;
const maximumWiseImportPayloadBytes = 2 * 1024 * 1024;
const maximumWiseImportIdLength = 2_048;
const maximumWiseProviderIdLength = 512;
const maximumWiseImportTextLength = 1_024;

function requiredBoundedText(value: unknown, field: string, maximumLength: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} must be a non-empty string`);
  }
  const normalized = normalizeWhitespace(value);
  if (value.length > maximumLength || normalized.length > maximumLength) {
    throw new Error(`${field} exceeds ${maximumLength} characters`);
  }
  return normalized;
}

function requiredCurrency(value: unknown, field: string): string {
  const currency = requiredBoundedText(value, field, 8).toUpperCase();
  if (!/^[A-Z0-9]{3,8}$/.test(currency)) {
    throw new Error(`${field} must be a 3-8 character currency code`);
  }
  return currency;
}

function requiredCalendarDate(value: unknown, field: string): string {
  const date = requiredBoundedText(value, field, 10);
  const timestamp = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? Date.parse(`${date}T00:00:00.000Z`)
    : Number.NaN;
  if (
    !Number.isFinite(timestamp)
    || new Date(timestamp).toISOString().slice(0, 10) !== date
  ) {
    throw new Error(`${field} must be a valid ISO calendar date`);
  }
  return date;
}

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

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
  dateTime: ["datetime", "transactiondatetime", "createddatetime", "completeddatetime", "timestamp"],
  transactionDetailsType: ["transactiondetailstype", "detailstype"],
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
  accountName: ["account", "accountname", "balancename"],
  cardHolderName: ["cardholderfullname", "cardholdername", "cardholder", "cardholderfull"],
  cardLastFour: ["cardlastfourdigits", "cardlastfour", "cardlast4", "lastfour", "last4", "carddigits"]
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
  if (new TextEncoder().encode(text).byteLength > maximumWiseCsvBytes) {
    throw new Error(`Wise CSV exceeds ${maximumWiseCsvBytes} bytes`);
  }
  for (const delimiter of [",", ";", "\t"]) {
    const parsedRows = parseCsvRows(text, delimiter);
    if (parsedRows.length === 0) continue;

    const table = findHeaderRow(parsedRows);
    if (!table) continue;

    if (table.rows.length > maximumWiseCsvRows) {
      throw new Error(`Wise CSV exceeds ${maximumWiseCsvRows} transaction rows`);
    }
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
  const iso = normalized.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[ T])/);
  if (iso) return requiredCalendarDate(`${iso[1]}-${iso[2]}-${iso[3]}`, "Wise CSV date");

  const named = normalized.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})(?:$|[ T])/);
  if (named) {
    const [, day, monthName, year] = named;
    const month = monthNumbers[monthName.toLowerCase()];
    if (!month) throw new Error(`Unsupported Wise CSV statement month: ${monthName}`);
    return requiredCalendarDate(
      `${year}-${month}-${day.padStart(2, "0")}`,
      "Wise CSV date"
    );
  }

  const numeric = normalized.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:$|[ T])/);
  if (numeric) {
    const [, day, month, year] = numeric;
    return requiredCalendarDate(
      `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`,
      "Wise CSV date"
    );
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

function wiseLedgerEntryIdentifier(
  row: CsvRow,
  providerIdentifier: string,
  signedAmount: number,
  currency: string
): string {
  const dateTime = cell(row, columnAliases.dateTime) ?? cell(row, columnAliases.date) ?? "";
  const transactionType = cell(row, columnAliases.category) ?? "";
  const transactionDetailsType = cell(row, columnAliases.transactionDetailsType) ?? "";
  return requiredBoundedText(
    JSON.stringify([
      providerIdentifier,
      dateTime,
      String(signedAmount),
      currency,
      transactionType,
      transactionDetailsType
    ]),
    "Wise CSV ledger entry identity",
    maximumWiseProviderIdLength
  );
}

function transactionFromRow(row: CsvRow, fallbackCurrency?: string): Transaction {
  const date = parseDate(cell(row, columnAliases.date) ?? "");
  const signedAmount = signedAmountFromRow(row);
  const currencyValue = cell(row, columnAliases.currency) ?? fallbackCurrency;
  if (!currencyValue) throw new Error("Wise CSV needs a Currency column or a currency in the file name");
  const currency = requiredCurrency(currencyValue, "Wise CSV currency");

  const reference = cell(row, columnAliases.reference);
  const description = requiredBoundedText(
    cell(row, columnAliases.description) ?? categoryFromRow(row, reference),
    "Wise CSV description",
    maximumWiseImportTextLength
  );
  const sourceId = cell(row, columnAliases.transactionId);
  const counterparty = requiredBoundedText(
    counterpartyFromRow(row, description, signedAmount),
    "Wise CSV counterparty",
    maximumWiseImportTextLength
  );
  const cardHolderName = cell(row, columnAliases.cardHolderName);
  const cardLastFourValue = cell(row, columnAliases.cardLastFour)?.replace(/\D/g, "");
  const cardLastFour = cardLastFourValue && cardLastFourValue.length >= 4
    ? cardLastFourValue.slice(-4)
    : undefined;
  if (!sourceId) {
    throw new Error("Wise CSV row is missing a stable provider transaction ID");
  }
  const stableSourceId = requiredBoundedText(
    sourceId,
    "Wise CSV provider transaction ID",
    maximumWiseProviderIdLength
  );
  const ledgerEntryIdentifier = wiseLedgerEntryIdentifier(
    row,
    stableSourceId,
    signedAmount,
    currency
  );
  const category = requiredBoundedText(
    categoryFromRow(row, reference, description),
    "Wise CSV category",
    256
  );
  const accountNameValue = cell(row, columnAliases.accountName);
  const accountName = requiredBoundedText(
    accountNameValue || `Wise ${currency}`,
    "Wise CSV account name",
    512
  );

  return {
    id: wiseUnscopedTransactionId(ledgerEntryIdentifier),
    source: "wise",
    accountName,
    date,
    description,
    rawName: counterparty,
    counterparty,
    amount: Math.abs(signedAmount),
    currency,
    direction: signedAmount >= 0 ? "in" : "out",
    status: "posted",
    category,
    ...(cardHolderName
      ? {
          cardHolderName: requiredBoundedText(
            cardHolderName,
            "Wise CSV card holder name",
            512
          )
        }
      : {}),
    ...(cardLastFour ? { cardLastFour } : {})
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
  requiredBoundedText(fileName, "Wise CSV file name", 512);
  const fileMetadata = metadataFromFileName(fileName);
  const fallbackCurrency = currencyFromFileName(fileName);
  const transactions = csvObjects(text)
    .map((row) => transactionFromRow(row, fallbackCurrency));

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

export function prepareWiseStatementImport(
  parsed: ParsedWiseStatement,
  verifiedAccount: VerifiedWiseStatementAccount
): ImportWiseStatementPayload {
  return {
    ...parsed.metadata,
    ...verifiedAccount,
    transactions: parsed.transactions.map((transaction) => {
      const providerLegacyId = transaction.providerLegacyId;
      return {
        ...transaction,
        id: scopeWiseCsvTransactionId(transaction.id, parsed.metadata.balanceId),
        ...(providerLegacyId
          ? {
              providerLegacyId: verifiedAccount.wiseEntity === "lmd"
                ? providerLegacyId.replace(/^wise-csv-/, "wise-csv-lmd-")
                : providerLegacyId
            }
          : {}),
        accountName: verifiedAccount.accountName,
        accountId: verifiedAccount.accountId,
        wiseEntity: verifiedAccount.wiseEntity
      };
    })
  };
}

function assertWiseImportTransaction(
  transaction: Transaction,
  index: number,
  payload: ImportWiseStatementPayload
): void {
  const field = `Wise import transaction[${index}]`;
  if (!transaction || typeof transaction !== "object" || Array.isArray(transaction)) {
    throw new Error(`${field} must be an object`);
  }
  requiredBoundedText(transaction.id, `${field}.id`, maximumWiseImportIdLength);
  if (!isScopedWiseTransactionId(transaction.id, payload.balanceId)) {
    throw new Error("Wise import transaction identity does not match the verified balance");
  }
  if (transaction.source !== "wise") throw new Error(`${field}.source must be wise`);
  if (transaction.wiseEntity !== payload.wiseEntity) {
    throw new Error(`${field}.wiseEntity does not match the import`);
  }
  if (transaction.accountName !== payload.accountName) {
    throw new Error(`${field}.accountName does not match the import`);
  }
  requiredCalendarDate(transaction.date, `${field}.date`);
  if (
    !Number.isFinite(transaction.amount)
    || transaction.amount < 0
    || transaction.amount > 1_000_000_000_000_000
  ) {
    throw new Error(`${field}.amount must be a finite non-negative number`);
  }
  const transactionCurrency = requiredCurrency(transaction.currency, `${field}.currency`);
  if (transactionCurrency !== payload.currency || transaction.currency !== transactionCurrency) {
    throw new Error(`${field}.currency does not match the import currency`);
  }
  if (transaction.direction !== "in" && transaction.direction !== "out") {
    throw new Error(`${field}.direction must be in or out`);
  }
  if (transaction.status !== "posted") throw new Error(`${field}.status must be posted`);
  requiredBoundedText(transaction.description, `${field}.description`, maximumWiseImportTextLength);
  requiredBoundedText(transaction.rawName, `${field}.rawName`, maximumWiseImportTextLength);
  requiredBoundedText(transaction.counterparty, `${field}.counterparty`, maximumWiseImportTextLength);
  requiredBoundedText(transaction.category, `${field}.category`, 256);
  if (transaction.providerLegacyId !== undefined) {
    requiredBoundedText(
      transaction.providerLegacyId,
      `${field}.providerLegacyId`,
      maximumWiseImportIdLength
    );
  }
  if (transaction.cardHolderName !== undefined) {
    requiredBoundedText(transaction.cardHolderName, `${field}.cardHolderName`, 512);
  }
  if (transaction.cardLastFour !== undefined && !/^\d{4}$/.test(transaction.cardLastFour)) {
    throw new Error(`${field}.cardLastFour must contain exactly four digits`);
  }
}

export function validateWiseStatementImportPayload(
  payload: ImportWiseStatementPayload,
  existingImports: readonly WiseStatementImport[]
): void {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Wise import payload must be an object");
  }
  if (!Array.isArray(payload.transactions)) {
    throw new Error("transactions must be an array");
  }
  if (payload.transactions.length > maximumWiseImportTransactions) {
    throw new Error(`Wise import exceeds ${maximumWiseImportTransactions} transactions`);
  }
  if (jsonBytes(payload) > maximumWiseImportPayloadBytes) {
    throw new Error(`Wise import payload exceeds ${maximumWiseImportPayloadBytes} bytes`);
  }
  if (
    !payload.balanceId
    || !payload.currency
    || !payload.periodStart
    || !payload.periodEnd
    || !payload.fileName
    || !payload.accountName
  ) {
    throw new Error(
      "balanceId, wiseEntity, accountName, currency, periodStart, periodEnd, and fileName are required"
    );
  }
  if (payload.wiseEntity !== "dn" && payload.wiseEntity !== "lmd") {
    throw new Error("wiseEntity must be dn or lmd");
  }
  requiredBoundedText(payload.balanceId, "balanceId", 512);
  const currency = requiredCurrency(payload.currency, "currency");
  if (currency !== payload.currency) throw new Error("currency must use an uppercase currency code");
  const periodStart = requiredCalendarDate(payload.periodStart, "periodStart");
  const periodEnd = requiredCalendarDate(payload.periodEnd, "periodEnd");
  if (periodStart > periodEnd) throw new Error("periodStart must be on or before periodEnd");
  requiredBoundedText(payload.fileName, "fileName", 512);
  requiredBoundedText(payload.accountName, "accountName", 512);
  payload.transactions.forEach((transaction, index) => {
    assertWiseImportTransaction(transaction, index, payload);
  });
  const transactionIds = payload.transactions.map((transaction) => transaction.id);
  if (new Set(transactionIds).size !== transactionIds.length) {
    throw new Error("Wise CSV contains duplicate transaction identities");
  }
  const legacyAliases = payload.transactions
    .map((transaction) => transaction.providerLegacyId)
    .filter((alias): alias is string => Boolean(alias));
  if (new Set(legacyAliases).size !== legacyAliases.length) {
    throw new Error("Wise CSV contains ambiguous legacy transaction identities");
  }
  if (requireWiseEntityFromAccountName(payload.accountName) !== payload.wiseEntity) {
    throw new Error(`${payload.accountName} does not match the selected Wise entity`);
  }

  const existingEntity = existingImports.find(
    (statementImport) => statementImport.balanceId === payload.balanceId && statementImport.wiseEntity
  )?.wiseEntity;
  if (existingEntity && existingEntity !== payload.wiseEntity) {
    throw new Error(
      `Wise balance ${payload.balanceId} was already assigned to ${existingEntity.toUpperCase()}`
    );
  }
}

export function normalizeImportedWiseTransactions(
  payload: ImportWiseStatementPayload
): Transaction[] {
  return payload.transactions.map((transaction, index) => {
    assertWiseImportTransaction(transaction, index, payload);
    return {
      id: transaction.id,
      source: "wise" as const,
      wiseEntity: payload.wiseEntity,
      accountId: payload.accountId,
      accountName: payload.accountName.trim(),
      date: transaction.date,
      description: transaction.description.trim(),
      rawName: transaction.rawName.trim(),
      counterparty: transaction.counterparty.trim(),
      amount: Math.abs(transaction.amount),
      currency: payload.currency,
      direction: transaction.direction,
      status: "posted" as const,
      category: transactionBusinessCategory(transaction.category),
      ...(transaction.providerLegacyId
        ? { providerLegacyId: transaction.providerLegacyId }
        : {}),
      ...(transaction.cardHolderName
        ? { cardHolderName: transaction.cardHolderName.trim() }
        : {}),
      ...(transaction.cardLastFour ? { cardLastFour: transaction.cardLastFour } : {})
    };
  });
}
