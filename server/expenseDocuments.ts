import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

const allowedContentTypes = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp"
]);
export const maximumExpenseDocumentBytes = 10 * 1024 * 1024;

function documentDirectory(): string {
  return resolve(process.cwd(), ".local", "expense-documents");
}

function extensionFor(fileName: string, contentType: string): string {
  const extension = extname(fileName).toLowerCase();
  if (/^\.(pdf|jpe?g|png|webp)$/.test(extension)) return extension;
  if (contentType === "application/pdf") return ".pdf";
  if (contentType === "image/png") return ".png";
  if (contentType === "image/webp") return ".webp";
  return ".jpg";
}

export function validateExpenseDocument(contentType: string, byteLength: number): void {
  if (!allowedContentTypes.has(contentType)) {
    throw new Error("Expense documents must be PDF, JPEG, PNG, or WebP files");
  }
  if (byteLength <= 0 || byteLength > maximumExpenseDocumentBytes) {
    throw new Error("Expense documents must be between 1 byte and 10 MB");
  }
}

export async function saveLocalExpenseDocument(
  bytes: Uint8Array,
  fileName: string,
  contentType: string
): Promise<string> {
  validateExpenseDocument(contentType, bytes.byteLength);
  const storageId = `expense-document-${crypto.randomUUID()}${extensionFor(fileName, contentType)}`;
  await mkdir(documentDirectory(), { recursive: true });
  await writeFile(resolve(documentDirectory(), storageId), bytes);
  return storageId;
}

export async function readLocalExpenseDocument(storageId: string): Promise<Uint8Array> {
  if (!/^expense-document-[a-f0-9-]+\.(pdf|jpe?g|png|webp)$/i.test(storageId)) {
    throw new Error("Expense document not found");
  }
  return readFile(resolve(documentDirectory(), storageId));
}
