import { strFromU8, unzipSync } from "fflate";
import { documentContentType, documentMaximumBytes, validateDocumentFile } from "./financialDocuments";
import type { Provider } from "./types";

export const contractsInbox = "contracts@finance.thatcanadian.dev";
export const contractAccept = ".pdf,.docx,.txt,.png,.jpg,.jpeg,.webp";
export const docxType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export type ContractParty = { name: string; email: string; registrationNumber: string; taxId: string };
export type ContractExtraction = { parties: ContractParty[]; confidence: number; reason: string };
export type CompanyDocument = {
  _id: string; fileName: string; contentType: string; size: number; source: "upload" | "email";
  providerId?: string; sender?: string; sourceContext: string; status: "queued" | "processing" | "assigned" | "needs_review";
  matchReason?: string; error?: string; createdAt: string; updatedAt: string;
};

export function contractText(bytes: Uint8Array, type: string): string | null {
  if (type === "text/plain") return new TextDecoder("utf-8", { fatal: true }).decode(bytes).slice(0, 60000);
  if (type !== docxType) return null;
  const files = unzipSync(bytes, { filter: file => {
    if (!["word/document.xml", "[Content_Types].xml"].includes(file.name)) return false;
    if (file.originalSize > 2 * 1024 * 1024) throw new Error("Word document text exceeds 2 MB");
    return true;
  } });
  if (!files["word/document.xml"] || !files["[Content_Types].xml"]) throw new Error("Choose a valid Word .docx document");
  return strFromU8(files["word/document.xml"]).replace(/<\/w:p>/g, "\n").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').slice(0, 60000);
}
export function contractFileType(bytes: Uint8Array, name: string): string {
  if (!bytes.length || bytes.length > documentMaximumBytes) throw new Error("Choose a document up to 10 MB");
  const imageOrPdf = documentContentType(bytes);
  if (imageOrPdf) { validateDocumentFile(imageOrPdf, bytes); return imageOrPdf; }
  const type = /\.docx$/i.test(name) ? docxType : /\.txt$/i.test(name) ? "text/plain" : null;
  if (!type) throw new Error("Choose a PDF, Word (.docx), text file, PNG, JPEG, or WebP");
  if (!contractText(bytes, type)?.trim()) throw new Error("The document has no readable text");
  return type;
}
export function validateContractExtraction(input: unknown): ContractExtraction {
  if (!input || typeof input !== "object") throw new Error("Invalid company recognition response");
  const row = input as ContractExtraction;
  if (!Array.isArray(row.parties) || row.parties.length > 20 || !Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 1 || typeof row.reason !== "string" || row.reason.length > 1000) throw new Error("Invalid company recognition response");
  for (const party of row.parties) {
    if (!party || [party.name, party.email, party.registrationNumber, party.taxId].some(v => typeof v !== "string" || v.length > 300)) throw new Error("Invalid company identity");
  }
  return row;
}
const normalized = (value: string) => value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const legalName = (value: string) => normalized(value).replace(/\b(incorporated|inc|llc|ltd|limited|corp|corporation|ou|b v|bv)\b/g, "").replace(/\s+/g, " ").trim();
const ownCompanies = new Set(["digital nudge", "love me do", "lovemedo", "mojo labs"]);

// Exact identities only: fuzzy or conflicting evidence always goes to human review.
export function matchContractCompany(extraction: ContractExtraction, providers: Pick<Provider, "id" | "name" | "legalName" | "aliases" | "email" | "taxId" | "meritDetails">[]): { providerId?: string; reason: string } {
  if (extraction.confidence < 0.9) return { reason: "Company identity is uncertain. Choose a company." };
  const matches = providers.filter(provider => {
    const names = [provider.name, provider.legalName ?? "", ...provider.aliases].map(legalName).filter(name => name.length >= 3 && !ownCompanies.has(name));
    if (!names.length) return false;
    return extraction.parties.some(party => {
      if (ownCompanies.has(legalName(party.name))) return false;
      const email = party.email.trim().toLowerCase();
      return names.includes(legalName(party.name))
        || Boolean(email && (provider.email ?? "").toLowerCase().split(/[\s,;]+/).includes(email))
        || Boolean(normalized(party.taxId).length >= 4 && normalized(party.taxId) === normalized(provider.taxId ?? ""))
        || Boolean(normalized(party.registrationNumber).length >= 4 && normalized(party.registrationNumber) === normalized(provider.meritDetails?.registrationNumber ?? ""));
    });
  });
  if (matches.length === 1) return { providerId: matches[0].id, reason: `Recognized ${matches[0].name} from the document or forwarded email.` };
  return { reason: matches.length > 1 ? "More than one saved company matches. Choose a company." : "No saved company could be identified. Choose a company." };
}
