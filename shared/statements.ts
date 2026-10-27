export const statementCompanies = [
  { id: "amg-holding", name: "AMG Holding" }, { id: "artec", name: "Artec" },
  { id: "inch-engineering", name: "Inch Engineering" }, { id: "digital-nudge", name: "Digital Nudge" },
  { id: "inch-digital", name: "Inch Digital" }, { id: "mzs-bouw", name: "MZS Bouw" }
] as const;
export type StatementCompanyId = typeof statementCompanies[number]["id"];
export type StatementActor = "Ali" | "Ali M" | "Alaa";
export type StatementStatus = "pending" | "reconciled" | "completed";
export type StatementOrigin = "manual" | "file" | "email";
export const statementSortKeys = ["date", "companyId", "description", "counterparty", "reference", "source", "account", "cardLastFour", "amountMinor", "currency", "direction", "origin", "status"] as const;
export type StatementSortKey = typeof statementSortKeys[number];
export interface StatementTransactionInput {
  companyId?: StatementCompanyId; date: string; description: string; counterparty?: string; reference?: string;
  source: string; account?: string; providerId?: string; cardLastFour?: string; amount: string; currency: string;
  direction: "in" | "out"; notes?: string; fee?: string; balance?: string;
}
export interface StatementRow extends Omit<StatementTransactionInput, "amount" | "fee" | "balance"> {
  amountMinor: string; feeMinor?: string; balanceMinor?: string; reviewReasons: string[];
}
export interface StatementTransaction extends StatementRow {
  _id: string; origin: StatementOrigin; status: StatementStatus; documentIds: string[];
  revision: number; createdAt: string; updatedAt: string; createdBy: string; importId?: string;
  deletedAt?: string;
}
export interface StatementCard { _id: string; companyId: StatementCompanyId; lastFour: string; label: string; source?: string; account?: string; active: boolean }
export interface StatementEvidence { field: string; value: string; quote: string; page?: number }
export interface StatementDocument {
  _id: string; companyId?: StatementCompanyId; fileName: string; contentType: string; size: number; origin: "file" | "email";
  status: "queued" | "processing" | "needs_review" | "ready" | "failed";
  documentType: "unknown" | "invoice" | "receipt" | "bank_statement" | "supporting";
  sender?: string; subject?: string; messageId?: string; receivedAt?: string;
  sourceContext?: string; senderKnown?: boolean;
  evidence: StatementEvidence[]; reviewReasons: string[]; extracted?: string; error?: string; attempts: number;
  transactionIds: string[]; createdAt: string; updatedAt: string; importId?: string;
  quarantined: boolean; generationId?: string; costUsd?: number;
}
export interface StatementImport {
  _id: string; fileName: string; companyId?: StatementCompanyId; origin: "file" | "email";
  status: "ready" | "importing" | "imported" | "failed"; rows: StatementRow[]; documentId?: string;
  processed: number; inserted: number; duplicates: number; reviewReasons: string[]; error?: string; createdAt: string;
  createdBy: string; reviewed: boolean; csvText?: string; mappingJson?: string; errors: string[];
}
export type StatementImportSummary = Omit<StatementImport, "rows" | "csvText" | "mappingJson"> & { transactionCount: number };
export interface StatementList {
  transactions: StatementTransaction[]; total: number; hasMore: boolean; offset: number; truncated: boolean;
  totals: Array<{ currency: string; inMinor: string; outMinor: string }>;
}
export interface StatementBootstrap { companies: Array<{ id: StatementCompanyId; name: string }>; cards: StatementCard[]; actor: StatementActor; canManage: boolean; inbox: string }
export interface StatementAddress { _id: string; companyId: StatementCompanyId | "all"; name: string; email?: string; notes: string; addressLine1?: string; addressLine2?: string; city?: string; postalCode?: string; country?: string; invoiceName?: string; vat?: string; description?: string; aliases?: string[]; reviewNote?: string }
export interface StatementAudit { _id: string; entityType: string; entityId: string; actor: string; action: string; details: string; createdAt: string }
export interface StatementSender { _id: string; email: string; actor: StatementActor }
export interface StatementLink { _id: string; transactionId: string; documentId: string; amountMinor: string; currency: string; note: string; createdBy: string; createdAt: string }

export function normalizeStatementActor(value: string): StatementActor {
  const actor = value.trim().replace(/\s+/g, " ").toLowerCase();
  if (actor === "ali") return "Ali"; if (actor === "ali m") return "Ali M"; if (actor === "alaa") return "Alaa";
  throw new Error("This account cannot access statements");
}
export function isStatementCompany(value: unknown): value is StatementCompanyId { return statementCompanies.some(company => company.id === value); }
export function statementCurrencyScale(currency: string): number {
  const code = currency.toUpperCase();
  if (/^(BTC|ETH|USDC|USDT)$/.test(code)) return 8;
  if (/^(JPY|KRW|VND|CLP|XAF|XOF|XPF|RWF|UGX|BIF|DJF|GNF|KMF|PYG|VUV)$/.test(code)) return 0;
  if (/^(BHD|IQD|JOD|KWD|LYD|OMR|TND)$/.test(code)) return 3;
  if (!/^[A-Z]{3}$/.test(code)) throw new Error("Use a three-letter currency code or BTC, ETH, USDC, USDT");
  return 2;
}
export function statementAmountMinor(amount: string, currency: string, signed = false): string {
  if (typeof amount !== "string") throw new Error("Enter an amount as decimal text");
  const value = amount.trim(); const scale = statementCurrencyScale(currency);
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match || (!signed && match[1]) || (match[3]?.length ?? 0) > scale) throw new Error(`Enter an exact amount with at most ${scale} decimal places`);
  const integer = BigInt(match[2]) * 10n ** BigInt(scale) + BigInt((match[3] ?? "").padEnd(scale, "0") || "0");
  if (integer > 1_000_000_000_000n * 10n ** BigInt(scale)) throw new Error("Amount is too large");
  return (match[1] ? -integer : integer).toString();
}
export function statementAmountDecimal(minor: string, currency: string): string {
  const scale = statementCurrencyScale(currency), value = BigInt(minor), negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(scale + 1, "0");
  return `${negative ? "-" : ""}${scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits}`;
}
const bounded = (value: string | undefined, maximum: number, label: string): string | undefined => {
  if (value === undefined || !value.trim()) return undefined;
  const text = value.trim().replace(/\s+/g, " ");
  if (text.length > maximum || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) throw new Error(`${label} is invalid or too long`);
  return text;
};
export function validateStatementInput(input: StatementTransactionInput): StatementRow {
  if (input.companyId !== undefined && !isStatementCompany(input.companyId)) throw new Error("Choose an included company");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !Number.isFinite(Date.parse(input.date)) || new Date(input.date).toISOString().slice(0, 10) !== input.date) throw new Error("Enter a valid transaction date");
  const description = bounded(input.description, 1024, "Description"), source = bounded(input.source, 100, "Financial source");
  if (!description || !source) throw new Error("Description and financial source are required");
  const currency = typeof input.currency === "string" ? input.currency.trim().toUpperCase() : "", amountMinor = statementAmountMinor(input.amount, currency);
  if (BigInt(amountMinor) <= 0n) throw new Error("Amount must be greater than zero");
  if (input.direction !== "in" && input.direction !== "out") throw new Error("Choose money in or money out");
  if (input.cardLastFour && !/^\d{4}$/.test(input.cardLastFour)) throw new Error("Card digits must be exactly four digits");
  return { ...(input.companyId ? { companyId: input.companyId } : {}), date: input.date, description, source, currency, amountMinor, direction: input.direction,
    ...Object.fromEntries((["counterparty", "reference", "account", "providerId", "notes", "cardLastFour"] as const).flatMap(key => { const value = bounded(input[key], key === "notes" ? 2000 : 512, key); return value ? [[key, value]] : []; })),
    ...(input.fee ? { feeMinor: statementAmountMinor(input.fee, currency) } : {}), ...(input.balance ? { balanceMinor: statementAmountMinor(input.balance, currency, true) } : {}), reviewReasons: [] };
}
export function statementIdentity(row: StatementRow): string | undefined {
  return row.providerId && row.account ? JSON.stringify([row.source.toLowerCase(), row.account.toLowerCase(), row.providerId]) : undefined;
}
export function statementCandidateKey(row: StatementRow): string { return JSON.stringify([row.date, row.amountMinor, row.currency, row.direction, row.description.toLowerCase().replace(/[^a-z0-9]/g, "")]); }
export function matchStatementCompany(row: StatementRow, cards: readonly StatementCard[], context?: StatementCompanyId): StatementRow {
  const matches = row.cardLastFour ? cards.filter(card => card.active && card.lastFour === row.cardLastFour && (!card.source || card.source.toLowerCase() === row.source.toLowerCase()) && (!card.account || card.account.toLowerCase() === row.account?.toLowerCase())) : [];
  const companyIds = [...new Set(matches.map(card => card.companyId))];
  const evidence = [...new Set([row.companyId, context, ...companyIds].filter((id): id is StatementCompanyId => Boolean(id)))];
  if (evidence.length > 1) { const { companyId: _companyId, ...rest } = row; return { ...rest, reviewReasons: [...row.reviewReasons, "Conflicting company evidence; assign this transaction after review"] }; }
  return { ...row, ...(evidence[0] ? { companyId: evidence[0] } : {}), reviewReasons: [...row.reviewReasons, ...(!evidence.length ? ["Company is unassigned"] : [])] };
}
export type StatementCsvMapping = Partial<Record<keyof StatementTransactionInput, string>>;
export function statementCsvGrid(text: string): string[][] {
  if (new TextEncoder().encode(text).length > 5 * 1024 * 1024) throw new Error("CSV exceeds 5 MB");
  const first = text.replace(/^\uFEFF/, "").split(/\r?\n/)[0];
  const delimiter = [",", ";", "\t"].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows: string[][] = []; let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (c === '"') { if (quoted && text[i + 1] === '"') { field += '"'; i++; } else quoted = !quoted; }
    else if (c === delimiter && !quoted) { row.push(field.trim()); field = ""; }
    else if ((c === "\n" || c === "\r") && !quoted) { if (c === "\r" && text[i + 1] === "\n") i++; row.push(field.trim()); if (row.some(Boolean)) rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (quoted) throw new Error("CSV has an unclosed quoted field");
  row.push(field.trim()); if (row.some(Boolean)) rows.push(row);
  if (rows.length > 1001) throw new Error("Upload at most 1,000 CSV rows");
  if (rows[0]) rows[0][0] = rows[0][0].replace(/^\uFEFF/, "");
  return rows;
}
export function parseStatementCsv(text: string, defaults: Partial<StatementTransactionInput> = {}, mapping: StatementCsvMapping = {}): { headers: string[]; rows: StatementRow[]; errors: string[]; mapping: StatementCsvMapping } {
  const [headers = [], ...records] = statementCsvGrid(text), normalize = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (new Set(headers.map(normalize)).size !== headers.length) throw new Error("CSV contains duplicate headers");
  const aliases: Record<string, string[]> = { date: ["date", "transactiondate", "datum"], description: ["description", "omschrijving", "details"], amount: ["amount", "bedrag", "signedamount"], currency: ["currency", "valuta"], direction: ["direction"], source: ["source", "bank"], account: ["account", "accountname"], providerId: ["transactionid", "providerid", "id"], companyId: ["company", "companyid"], counterparty: ["counterparty", "merchant", "payee"], reference: ["reference", "memo"], cardLastFour: ["cardlastfour", "cardlast4"], fee: ["fee", "fees"], balance: ["balance"] };
  const resolved = { ...mapping };
  for (const [key, names] of Object.entries(aliases)) if (!(key in resolved)) { const h = headers.find(header => names.includes(normalize(header))); if (h) resolved[key as keyof StatementTransactionInput] = h; }
  const rows: StatementRow[] = [], errors: string[] = [];
  records.forEach((cells, index) => { try {
    if (cells.length !== headers.length) throw new Error("Column count does not match header");
    const values: Record<string, string> = {};
    for (const [key, header] of Object.entries(resolved)) { if (!header) continue; const at = headers.indexOf(header); if (at < 0) throw new Error(`Unknown mapped column ${header}`); if (cells[at]) values[key] = cells[at]; }
    const raw = { ...defaults, ...values } as StatementTransactionInput;
    if (raw.companyId && !isStatementCompany(raw.companyId)) { const company = statementCompanies.find(item => item.name.toLowerCase() === String(raw.companyId).toLowerCase()); if (!company) throw new Error("Company is not in this statement workspace"); raw.companyId = company.id; }
    if (raw.amount?.startsWith("-")) { if (raw.direction && raw.direction !== "out") throw new Error("Amount sign conflicts with direction"); raw.amount = raw.amount.slice(1); raw.direction = "out"; }
    else raw.direction ||= "in";
    rows.push(validateStatementInput(raw));
  } catch (error) { errors.push(`Row ${index + 2}: ${error instanceof Error ? error.message : "Invalid row"}`); } });
  if (!records.length) errors.push("CSV contains no transactions");
  return { headers, rows, errors, mapping: resolved };
}
