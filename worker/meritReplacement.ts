import type { ConvexHttpClient } from "convex/browser";
import type { Id } from "../convex/_generated/dataModel";
import { api } from "../convex/_generated/api";
import { runReplacement, type ReplacementJob } from "../shared/meritReplacement";
import { decodeMeritInvoicePdf } from "../shared/invoiceFiles";
import type { Invoice, MeritTax, Provider } from "../shared/types";

import type { MeritReplacementRequest } from "../shared/meritReplacementRequest";
export { replacementRequest } from "../shared/meritReplacementRequest";

export async function replaceMeritInvoice(convex: ConvexHttpClient, serviceToken: string, request: MeritReplacementRequest, before: Invoice, after?: Invoice, providers: Provider[] = [], taxes: MeritTax[] = []): Promise<Invoice> {
  const token = crypto.randomUUID();
  const record = await convex.mutation(api.meritReplacements.claim, { serviceToken, invoiceId: before.id, id: crypto.randomUUID(), token, ...(after ? { after, expectedUpdatedAt: before.updatedAt } : {}) });
  const auth = { serviceToken, id: record.id, token };
  const job: ReplacementJob = { id: record.id, invoiceId: before.id, phase: record.phase, before: JSON.parse(record.beforeJson), after: JSON.parse(record.afterJson), request: record.requestJson ? JSON.parse(record.requestJson) : undefined, externalId: record.externalId };
  async function upload(bytes: Uint8Array<ArrayBuffer>, type: string): Promise<Id<"_storage">> {
    if (bytes.length === 0 || bytes.length > 25 * 1024 * 1024) throw new Error("Invoice backup file is empty or exceeds 25 MB");
    const url = await convex.mutation(api.meritReplacements.uploadUrl, auth);
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": type }, body: bytes, signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error("Invoice backup could not be stored");
    const result = await response.json() as { storageId?: Id<"_storage"> };
    if (!result.storageId) throw new Error("Invoice backup storage ID missing");
    return result.storageId;
  }
  if (record.originalStorageId) {
    try {
      const files = await convex.query(api.meritReplacements.files, { serviceToken, invoiceId: before.id });
      if (!files.original) throw new Error("Original backup unavailable");
      const response = await fetch(files.original, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error("Original backup could not be read");
      job.original = (await response.json() as { merit: unknown }).merit;
    } catch (error) {
      await convex.mutation(api.meritReplacements.fail, { ...auth, message: "Original backup could not be read", abort: false });
      throw error;
    }
  }
  return runReplacement(job, {
    details: id => request("/v2/getinvoice", { Id: id, AddAttachment: true }),
    pdf: async id => decodeMeritInvoicePdf((await request("/v2/getsalesinvpdf", { Id: id, DelivNote: false }) as { FileContent: unknown }).FileContent),
    list: async invoiceNumber => {
      const value = await request("/v2/getinvoices2", { InvNo: invoiceNumber });
      if (!Array.isArray(value) || value.some(i => !i || typeof i.SIHId !== "string" || typeof i.InvoiceNo !== "string")) throw new Error("Merit returned an incomplete invoice list; replacement paused");
      return value;
    },
    backup: async (original, pdf, prepared, updated) => {
      const originalStorageId = await upload(new TextEncoder().encode(JSON.stringify({ invoice: job.before, merit: original, replacement: prepared, backedUpAt: new Date().toISOString() })), "application/json");
      const pdfStorageId = await upload(pdf, "application/pdf");
      await convex.mutation(api.meritReplacements.backup, { ...auth, originalStorageId, pdfStorageId, requestJson: JSON.stringify(prepared), after: updated });
    },
    phase: (expected, next, externalId) => convex.mutation(api.meritReplacements.phase, { ...auth, expected, next, ...(externalId ? { externalId } : {}) }).then(() => undefined),
    write: request,
    complete: async (invoice, pdf) => {
      const currentPdfStorageId = await upload(pdf, "application/pdf");
      return convex.mutation(api.meritReplacements.complete, { ...auth, invoice, currentPdfStorageId });
    },
    fail: (message, abort, retryAfterMs) => convex.mutation(api.meritReplacements.fail, { ...auth, message, abort, retryAfterMs }).then(() => undefined)
  }, taxes.find(t => t.id === job.after.taxId), providers.find(p => p.id === job.after.providerId));
}
