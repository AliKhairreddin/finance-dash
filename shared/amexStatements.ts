import type { Transaction } from "./types";
import { bankProviderTransactionId } from "./providerIdentity";
import { assertBankTransactionInput } from "./bankRecordValidation";

export const amexStatementMaximumBytes = 10 * 1024 * 1024;
export const amexStatementMaximumRows = 1000;
export interface AmexStatementOptions { currency: string; dateFormat: "dmy" | "mdy"; cardLastFour?: string }
export interface AmexStatementRow {
  date: string; description: string; amount: number; cardLastFour?: string; cardHolderName?: string;
}
export interface AmexStatementData {
  currency: string; cardLastFour: string; rows: AmexStatementRow[]; reviewReasons: string[];
  chargesTotal?: number; creditsTotal?: number;
}
export interface AmexStatementRecord {
  _id: string; fileName: string; source: "upload" | "telegram"; createdAt: string;
  status: "ready" | "importing" | "imported" | "failed";
  currency: string; cardLastFour: string; transactionCount: number; processed: number;
  inserted: number; duplicates: number; reviewReasons: string[]; error?: string;
  periodStart: string; periodEnd: string; chargesTotal: number; creditsTotal: number;
}
export interface AmexStatementDetail { record: AmexStatementRecord; rows: AmexStatementRow[] }

export function amexStatementOptions(value: Partial<AmexStatementOptions>): AmexStatementOptions {
  const currency = value.currency?.trim().toUpperCase() || "EUR";
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Choose a three-letter billing currency, such as EUR");
  const dateFormat = value.dateFormat ?? "dmy";
  if (dateFormat !== "dmy" && dateFormat !== "mdy") throw new Error("Choose day/month/year or month/day/year dates");
  const cardLastFour = value.cardLastFour?.trim() || undefined;
  if (cardLastFour && !/^\d{4}$/.test(cardLastFour)) throw new Error("Enter only the last four digits of the primary Amex card");
  return { currency, dateFormat, ...(cardLastFour ? { cardLastFour } : {}) };
}

function calendarDate(value: string): string {
  const ms = /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(`${value}T00:00:00Z`) : NaN;
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) throw new Error(`Invalid transaction date: ${value}`);
  return value;
}

export function amexStatementDate(value: string, format: "dmy" | "mdy"): string {
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return calendarDate(text);
  const numeric = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(text);
  if (numeric) return calendarDate(`${numeric[3]}-${(format === "dmy" ? numeric[2] : numeric[1]).padStart(2, "0")}-${(format === "dmy" ? numeric[1] : numeric[2]).padStart(2, "0")}`);
  const named = /^(\d{1,2})[\s-]+([a-z]+)\.?[\s-]+(\d{4})$/i.exec(text);
  if (named) {
    const names = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    const month = named[2].toLowerCase().replace(/^maart$/, "mar").replace(/^mei$/, "may").replace(/^okt/, "oct");
    const index = names.indexOf(month.slice(0, 3));
    if (index >= 0) return calendarDate(`${named[3]}-${String(index + 1).padStart(2, "0")}-${named[1].padStart(2, "0")}`);
  }
  throw new Error(`Unrecognized date “${text}”; use dates with a four-digit year and the correct date format`);
}

export function amexStatementAmount(value: string): number {
  let text = value.trim().replace(/\s|\u00a0/g, "").replace(/^(?:EUR|USD|GBP|CAD|€|\$|£)/i, "");
  const credit = /CR$/i.test(text) || /^\(.*\)$/.test(text) || /-$/.test(text);
  text = text.replace(/CR$/i, "").replace(/^\((.*)\)$/, "$1").replace(/-$/, "");
  // Separators must be valid decimal/thousands groups; never parse a numeric prefix.
  if (/^[+-]?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}$/.test(text)) text = text.replaceAll(".", "").replace(",", ".");
  else if (/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/.test(text)) text = text.replaceAll(",", "");
  else throw new Error(`Invalid amount: ${value}`);
  const amount = Number(text) * (credit ? -1 : 1);
  if (!Number.isFinite(amount) || Math.abs(amount) > 1e12 || (credit && Number(text) < 0)) throw new Error(`Invalid amount: ${value}`);
  return amount;
}

function csvRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = "", quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (char === '"') { quoted = false; closed = true; }
      else cell += char;
    } else if (char === '"') {
      if (cell || closed) throw new Error("Malformed CSV quoting");
      quoted = true;
    } else if (char === delimiter || char === "\n" || char === "\r") {
      row.push(cell.trim()); cell = ""; closed = false;
      if (char !== delimiter) {
        if (row.some(Boolean)) rows.push(row);
        row = [];
        if (char === "\r" && text[i + 1] === "\n") i++;
      }
    } else {
      if (closed && char.trim()) throw new Error("Malformed CSV after quoted field");
      if (!closed) cell += char;
    }
    if (rows.length > amexStatementMaximumRows + 30) throw new Error("Export a shorter period (up to 1,000 transactions per file)");
  }
  if (quoted) throw new Error("The CSV ends inside a quoted field");
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  return rows;
}
const key = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
const dateHeaders = ["date", "transactiondate", "datum", "transactiedatum"];
const descriptionHeaders = ["description", "omschrijving", "beschrijving", "merchant", "transactieomschrijving"];
const amountHeaders = ["amount", "bedrag", "transactionamount", "transactiebedrag"];
const lastFour = (value: string) => { const digits = value.replace(/\D/g, ""); return digits.length >= 4 ? digits.slice(-4) : undefined; };

export function parseAmexStatementCsv(text: string, options: AmexStatementOptions): AmexStatementData {
  options = amexStatementOptions(options);
  if (new TextEncoder().encode(text).length > amexStatementMaximumBytes) throw new Error("Send a statement up to 10 MB");
  text = text.replace(/^\uFEFF/, "");
  if (text.includes("\u0000") || text.includes("\uFFFD")) throw new Error("Save the CSV as UTF-8 before uploading");
  const candidate = [",", ";", "\t"].map(delimiter => {
    try { const rows = csvRows(text, delimiter); const index = rows.findIndex(row => { const headers = row.map(key); return dateHeaders.some(h => headers.includes(h)) && descriptionHeaders.some(h => headers.includes(h)) && amountHeaders.some(h => headers.includes(h)); }); return { rows, index }; }
    catch { return { rows: [] as string[][], index: -1 }; }
  }).find(candidate => candidate.index >= 0);
  if (!candidate) throw new Error("Choose an Amex CSV with Date/Datum, Description/Omschrijving, and Amount/Bedrag columns");
  const headers = candidate.rows[candidate.index].map(key);
  if (new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length) throw new Error("The CSV has duplicate column names");
  const indexOf = (names: string[]) => headers.findIndex(h => names.includes(h));
  const date = indexOf(dateHeaders), description = indexOf(descriptionHeaders), amount = indexOf(amountHeaders);
  const card = indexOf(["account", "accountnumber", "cardnumber", "cardlastfour", "kaartnummer", "rekeningnummer", "kaart", "accountnummer"]);
  const holder = indexOf(["cardmember", "cardholder", "cardmembername", "kaartlid", "kaarthouder", "naamkaarthouder"]);
  const currency = indexOf(["currency", "valuta", "billingcurrency", "muntsoort"]);
  const rows = candidate.rows.slice(candidate.index + 1).map((row, index): AmexStatementRow => {
    const line = candidate.index + index + 2;
    if (row.length !== headers.length) throw new Error(`CSV row ${line} has ${row.length} fields; expected ${headers.length}`);
    if (currency >= 0 && row[currency].toUpperCase() !== options.currency) throw new Error(`CSV row ${line} has a different currency; select the statement billing currency`);
    try {
      const cardLastFour = card >= 0 ? lastFour(row[card]) : undefined;
      return { date: amexStatementDate(row[date], options.dateFormat), description: row[description], amount: amexStatementAmount(row[amount]), ...(cardLastFour ? { cardLastFour } : {}), ...(holder >= 0 && row[holder] ? { cardHolderName: row[holder] } : {}) };
    } catch (error) { throw new Error(`CSV row ${line}: ${error instanceof Error ? error.message : "Invalid transaction"}`); }
  });
  const cards = [...new Set(rows.flatMap(row => row.cardLastFour ? [row.cardLastFour] : []))];
  const primaryCard = options.cardLastFour ?? (cards.length === 1 ? cards[0] : undefined);
  if (!primaryCard) throw new Error("Enter the primary card’s last four digits (Telegram caption: /amex EUR 1234). Use the same primary card for every upload.");
  return validateAmexStatement({ currency: options.currency, cardLastFour: primaryCard, rows, reviewReasons: [] });
}

export function validateAmexStatement(value: unknown): AmexStatementData {
  if (!value || typeof value !== "object") throw new Error("Statement details are missing");
  const data = value as AmexStatementData;
  if (typeof data.currency !== "string" || typeof data.cardLastFour !== "string" || !/^[A-Z]{3}$/.test(data.currency) || !/^\d{4}$/.test(data.cardLastFour)) throw new Error("The statement needs a billing currency and primary card last four digits");
  if (!Array.isArray(data.rows) || !data.rows.length || data.rows.length > amexStatementMaximumRows) throw new Error("The statement must contain 1–1,000 transactions; export a shorter period if needed");
  if (!Array.isArray(data.reviewReasons) || data.reviewReasons.length > 20 || data.reviewReasons.some(reason => typeof reason !== "string" || reason.length > 500)) throw new Error("Invalid statement review notes");
  const rows = data.rows.map((row, i) => {
    if (!row || typeof row.date !== "string" || typeof row.description !== "string" || !row.description.trim() || row.description.length > 1024 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(row.description)) throw new Error(`Transaction ${i + 1} has invalid details`);
    calendarDate(row.date);
    if (typeof row.amount !== "number" || !Number.isFinite(row.amount) || Math.abs(row.amount) > 1e12 || Math.abs(row.amount * 100 - Math.round(row.amount * 100)) > 0.001) throw new Error(`Transaction ${i + 1} has an invalid amount`);
    if (row.cardLastFour !== undefined && !/^\d{4}$/.test(row.cardLastFour)) throw new Error(`Transaction ${i + 1} has invalid card digits`);
    if (row.cardHolderName !== undefined && (typeof row.cardHolderName !== "string" || row.cardHolderName.length > 512)) throw new Error(`Transaction ${i + 1} has an invalid cardholder`);
    return { date: row.date, description: row.description.replace(/\s+/g, " ").trim(), amount: row.amount, ...(row.cardLastFour ? { cardLastFour: row.cardLastFour } : {}), ...(row.cardHolderName?.trim() ? { cardHolderName: row.cardHolderName.trim() } : {}) };
  });
  for (const field of ["chargesTotal", "creditsTotal"] as const) {
    const total = data[field];
    if (total === undefined) continue;
    if (typeof total !== "number" || !Number.isFinite(total) || total < 0) throw new Error(`Invalid ${field}`);
    const actual = rows.reduce((sum, row) => sum + (field === "chargesTotal" ? Math.max(0, Math.round(row.amount * 100)) : Math.max(0, -Math.round(row.amount * 100))), 0);
    if (Math.abs(actual - Math.round(total * 100)) > 1) throw new Error("The extracted transactions do not match the printed statement totals. Upload the CSV or a complete, clearer PDF.");
  }
  return { currency: data.currency, cardLastFour: data.cardLastFour, rows, reviewReasons: [...data.reviewReasons], ...(data.chargesTotal !== undefined ? { chargesTotal: data.chargesTotal } : {}), ...(data.creditsTotal !== undefined ? { creditsTotal: data.creditsTotal } : {}) };
}

export async function amexStatementTransactions(input: AmexStatementData): Promise<Transaction[]> {
  const data = validateAmexStatement(input);
  const accountId = `amex-statement-${data.currency}-${data.cardLastFour}`;
  const occurrences = new Map<string, number>();
  return Promise.all(data.rows.map(async row => {
    const card = row.cardLastFour ?? data.cardLastFour;
    const identity = JSON.stringify([accountId, card, row.date, Math.round(row.amount * 100), key(row.description)]);
    const occurrence = (occurrences.get(identity) ?? 0) + 1; occurrences.set(identity, occurrence);
    const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity)))].map(b => b.toString(16).padStart(2, "0")).join("");
    return amexTransactionFromStatementRow(data, row, bankProviderTransactionId("amex", [accountId, `${digest}:${occurrence}`]));
  }));
}

export function amexTransactionFromStatementRow(data: Pick<AmexStatementData, "currency" | "cardLastFour">, row: AmexStatementRow, id: string): Transaction {
  const accountId = `amex-statement-${data.currency}-${data.cardLastFour}`;
  const payment = /\b(payment received|payment thank you|payment received thank you|betaling ontvangen|uw betaling|incasso|automatische incasso|direct debit|sepa betaling)\b/i.test(row.description);
  const transaction: Transaction = {
      id, source: "amex", accountId,
      accountName: `Amex •${data.cardLastFour}`, date: row.date, description: row.description,
      rawName: row.description, counterparty: row.description, cardLastFour: row.cardLastFour ?? data.cardLastFour,
      ...(row.cardHolderName ? { cardHolderName: row.cardHolderName } : {}),
      amount: Math.abs(row.amount), currency: data.currency, direction: row.amount < 0 ? "in" : "out", status: "posted",
      category: payment ? "Internal transfer" : "Uncategorized", ...(payment ? { categorySource: "rule", categoryConfidence: 1, categoryReason: "Amex card repayment", classificationComplete: true } as const : {})
    };
  assertBankTransactionInput(transaction); return transaction;
}
