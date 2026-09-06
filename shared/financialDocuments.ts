import type { Transaction, WiseEntity } from "./types";
import { wiseEntityFromAccountName } from "./wiseEntities";

export const documentInbox = "receipts@finance.thatcanadian.dev";
export const documentMaximumBytes = 10 * 1024 * 1024;
export const documentContentTypes = ["application/pdf", "image/png", "image/jpeg", "image/webp"] as const;
export type FinancialDocumentKind = "expense" | "invoice" | "unknown";
export type FinancialDocumentStatus = "queued" | "processing" | "needs_review" | "unmatched" | "matched" | "failed";
export interface DocumentExtraction {
  kind: FinancialDocumentKind;
  entity: WiseEntity | null;
  counterparty: string;
  documentNumber: string;
  issueDate: string | null;
  dueDate: string | null;
  amount: number | null;
  currency: string | null;
  description: string;
  confidence: number;
  reviewReasons: string[];
}
export interface FinancialDocument {
  _id: string;
  fileName: string;
  contentType: string;
  size: number;
  source: "upload" | "email" | "telegram" | "archive";
  status: FinancialDocumentStatus;
  entity?: WiseEntity;
  month: string;
  kind: FinancialDocumentKind;
  extraction?: DocumentExtraction;
  expenseId?: string;
  invoiceId?: string;
  transactionId?: string;
  matchReason?: string;
  error?: string;
  createdAt: string;
  processedAt?: string;
  matchedAt?: string;
}

export function validDocumentDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function documentContentType(bytes: Uint8Array): string | null {
  const header = new TextDecoder("latin1").decode(bytes.slice(0, 12));
  if (header.startsWith("%PDF-")) return "application/pdf";
  if (bytes[0] === 137 && header.slice(1, 4) === "PNG" && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (header.startsWith("RIFF") && header.slice(8, 12) === "WEBP") return "image/webp";
  return null;
}

export function validateDocumentFile(contentType: string, bytes: Uint8Array): void {
  if (!documentContentTypes.includes(contentType as typeof documentContentTypes[number])) throw new Error("Choose a PDF, PNG, JPEG, or WebP file");
  if (bytes.byteLength < 8 || bytes.byteLength > documentMaximumBytes) throw new Error("Documents must be no larger than 10 MB");
  const prefix = new TextDecoder("latin1").decode(bytes.slice(0, 12));
  const valid = contentType === "application/pdf" ? prefix.startsWith("%PDF-")
    : contentType === "image/png" ? bytes[0] === 137 && prefix.slice(1, 4) === "PNG" && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10
    : contentType === "image/jpeg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
    : prefix.startsWith("RIFF") && prefix.slice(8, 12) === "WEBP";
  if (!valid) throw new Error("The file contents do not match its PDF or image type");
}

export function validateExtraction(value: unknown): DocumentExtraction {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Document extraction is invalid");
  const row = value as Record<string, unknown>;
  const text = (key: string, max: number) => typeof row[key] === "string" ? row[key].trim().slice(0, max) : "";
  const reasons = Array.isArray(row.reviewReasons) ? row.reviewReasons.filter((r): r is string => typeof r === "string").slice(0, 8).map(r => r.slice(0, 240)) : [];
  const kind = row.kind === "expense" || row.kind === "invoice" ? row.kind : "unknown";
  const entity = row.entity === "dn" || row.entity === "lmd" ? row.entity : null;
  const amount = typeof row.amount === "number" && Number.isFinite(row.amount) && row.amount > 0 && row.amount <= 1e9 ? Math.round(row.amount * 100) / 100 : null;
  const currency = /^[A-Z]{3}$/.test(text("currency", 12)) ? text("currency", 12) : null;
  const issueDate = validDocumentDate(row.issueDate) ? row.issueDate : null;
  const dueDate = validDocumentDate(row.dueDate) ? row.dueDate : null;
  const confidence = typeof row.confidence === "number" && Number.isFinite(row.confidence) ? Math.max(0, Math.min(1, row.confidence)) : 0;
  if (kind === "unknown") reasons.push("Choose expense or sales invoice");
  if (!entity) reasons.push("Choose Digital Nudge or Love Me Do");
  if (!amount || !currency) reasons.push("Check the total and currency");
  if (!issueDate) reasons.push("Check the document date");
  if (!text("counterparty", 200)) reasons.push("Check the supplier or customer");
  if (confidence < 0.9) reasons.push("Extraction needs review");
  return { kind, entity, amount, currency, issueDate, dueDate, confidence, counterparty: text("counterparty", 200), documentNumber: text("documentNumber", 100), description: text("description", 1200), reviewReasons: [...new Set(reasons)] };
}

function normalized(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
function companyWords(value: string): string[] {
  return normalized(value).split(" ").filter(word => word.length > 2 && !["ltd", "inc", "llc", "limited", "company", "payment", "transfer", "invoice", "the"].includes(word));
}

export function documentMatchCandidates(extraction: DocumentExtraction, transactions: Transaction[], requireIdentity = true): Transaction[] {
  if (!extraction.entity || !extraction.amount || !extraction.currency || !extraction.issueDate || extraction.kind === "unknown") return [];
  const issuedAt = Date.parse(extraction.issueDate);
  const words = companyWords(extraction.counterparty);
  const number = normalized(extraction.documentNumber);
  return transactions.filter(transaction => {
    if (transaction.direction !== (extraction.kind === "invoice" ? "in" : "out") || !["posted", "settled"].includes(transaction.status)) return false;
    if (transaction.currency.toUpperCase() !== extraction.currency || Math.abs(Math.abs(transaction.amount) - extraction.amount!) > 0.009) return false;
    const days = (Date.parse(transaction.date) - issuedAt) / 86400000;
    if (!Number.isFinite(days) || days < -7 || days > 90) return false;
    const entity = transaction.wiseEntity ?? wiseEntityFromAccountName(transaction.accountName);
    if (entity && entity !== extraction.entity) return false;
    if (!requireIdentity) return true;
    const text = normalized([transaction.counterparty, transaction.rawName, transaction.merchantName, transaction.description].filter(Boolean).join(" "));
    const reference = number.length >= 4 && ` ${text} `.includes(` ${number} `);
    const identity = words.length > 0 && words.every(word => text.split(" ").includes(word));
    // Without account ownership metadata, require both a reference and company evidence.
    return entity ? reference || identity : reference && identity;
  });
}

export function documentTransactionLink(transactionId: string): string {
  return `?page=banks&documentTransaction=${encodeURIComponent(transactionId)}`;
}
