import { Zip, ZipPassThrough } from "fflate";
import { documentMaximumBytes, validateDocumentFile, type FinancialDocument } from "./financialDocuments";

function safeName(value: string): string {
  return value.normalize("NFC").replace(/[\x00-\x1f\x7f/\\:*?"<>|]/g, "_").replace(/^\.+|[. ]+$/g, "").trim();
}

export function documentArchivePaths(documents: FinancialDocument[]): string[] {
  const used = new Set<string>();
  return documents.map(document => {
    const kind = document.kind === "expense" ? "Expenses" : document.kind === "invoice" ? "Invoices" : "Unclassified";
    const company = document.entity === "dn" ? "Digital Nudge" : document.entity === "lmd" ? "Love Me Do" : "Unassigned";
    const extension = document.contentType === "application/pdf" ? ".pdf" : document.contentType === "image/png" ? ".png" : document.contentType === "image/webp" ? ".webp" : ".jpg";
    let name = safeName(document.fileName) || "document";
    if (!/\.(pdf|png|jpe?g|webp)$/i.test(name)) name += extension;
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(name)) name = `_${name}`;
    const dot = name.lastIndexOf(".");
    const directory = `${kind}/${company}/${safeName(document.month) || "Undated"}`;
    let path = `${directory}/${name}`, suffix = 2;
    while (used.has(path.toLowerCase())) path = `${directory}/${name.slice(0, dot)} (${suffix++})${name.slice(dot)}`;
    used.add(path.toLowerCase());
    return path;
  });
}

/** Read one original at a time and retain ZIP output as immutable Blob chunks. */
export async function buildDocumentZip(documents: FinancialDocument[], options: {
  apiBase: string;
  signal: AbortSignal;
  onProgress: (completed: number) => void;
}): Promise<Blob> {
  if (!documents.length) throw new Error("Select at least one document");
  // ZIP32 offsets and the entry count must fit the archive format.
  if (documents.length >= 65_535 || documents.reduce((total, document) => total + document.size + 2048, 0) >= 0xffffffff) {
    throw new Error("This ZIP would exceed 4 GB. Select fewer documents or download one month at a time.");
  }
  const chunks: Blob[] = [];
  const zip = new Zip((error, data) => {
    if (error) throw error;
    chunks.push(new Blob([new Uint8Array(data)]));
  });
  const paths = documentArchivePaths(documents);
  try {
    for (const [index, document] of documents.entries()) {
      options.signal.throwIfAborted();
      const signal = AbortSignal.any([options.signal, AbortSignal.timeout(45_000)]);
      const response = await fetch(`${options.apiBase}/documents/${encodeURIComponent(document._id)}/file`, { signal });
      if (!response.ok || !response.body) throw new Error(`Could not download ${document.fileName}. Please retry.`);
      const reader = response.body.getReader();
      const parts: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > documentMaximumBytes) throw new Error(`${document.fileName} exceeds the file size limit`);
          parts.push(value);
        }
      } finally { await reader.cancel(); reader.releaseLock(); }
      if (size !== document.size) throw new Error(`${document.fileName} was incomplete. Please retry.`);
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const part of parts) { bytes.set(part, offset); offset += part.length; }
      validateDocumentFile(document.contentType, bytes);
      options.signal.throwIfAborted();
      const file = new ZipPassThrough(paths[index]);
      zip.add(file);
      file.push(bytes, true);
      options.onProgress(index + 1);
    }
    zip.end();
    return new Blob(chunks, { type: "application/zip" });
  } catch (error) {
    zip.terminate();
    throw error;
  }
}
