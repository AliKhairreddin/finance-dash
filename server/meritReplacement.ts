import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { runReplacement, type ReplacementJob } from "../shared/meritReplacement";
import { decodeMeritInvoicePdf } from "../shared/invoiceFiles";
import type { Invoice, MeritTax, Provider } from "../shared/types";
import { requestMeritReplacement } from "./integrations";

const running = new Set<string>();
export const localReplacementRunning = () => running.size > 0;
function directory(id: string) {
  if (!/^[\da-f-]{36}$/i.test(id)) throw new Error("Invalid replacement ID");
  return resolve(process.cwd(), ".local", "invoice-replacements", id);
}
export async function localInvoiceBackup(id: string, json: boolean) {
  return readFile(resolve(directory(id), json ? "original.json" : "original.pdf"));
}
export async function replaceLocalMeritInvoice(before: Invoice, after: Invoice | undefined, providers: Provider[], taxes: MeritTax[], save: (invoice: Invoice) => Promise<void>) {
  if (running.has(before.id)) throw new Error("Invoice replacement is running; check again shortly");
  if (before.meritReplacementId && after) throw new Error("Invoice replacement pending; check its status first");
  running.add(before.id);
  try {
    const id = before.meritReplacementId ?? crypto.randomUUID();
    const dir = directory(id);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    let job: ReplacementJob = before.meritReplacementId ? JSON.parse(await readFile(resolve(dir, "job.json"), "utf8")) : { id, invoiceId: before.id, before, after: after!, phase: "preparing" };
    const store = async () => { await writeFile(resolve(dir, "job.tmp"), JSON.stringify(job), { mode: 0o600 }); await rename(resolve(dir, "job.tmp"), resolve(dir, "job.json")); };
    await store();
    await save({ ...before, meritReplacementId: id });
    return await runReplacement(job, {
      details: externalId => requestMeritReplacement("/v2/getinvoice", { Id: externalId, AddAttachment: true }),
      pdf: async externalId => decodeMeritInvoicePdf((await requestMeritReplacement("/v2/getsalesinvpdf", { Id: externalId, DelivNote: false }) as { FileContent: unknown }).FileContent),
      list: async invoiceNumber => {
        const value = await requestMeritReplacement("/v2/getinvoices2", { InvNo: invoiceNumber });
        if (!Array.isArray(value) || value.some(i => !i?.SIHId || !i?.InvoiceNo)) throw new Error("Merit invoice list incomplete");
        return value;
      },
      backup: async (original, pdf, request, updated) => {
        await writeFile(resolve(dir, "original.json"), JSON.stringify({ invoice: before, merit: original, replacement: request }), { flag: "wx", mode: 0o600 });
        await writeFile(resolve(dir, "original.pdf"), pdf, { flag: "wx", mode: 0o600 });
        job = { ...job, original, request, after: updated, phase: "backed_up" }; await store();
      },
      phase: async (expected, next, externalId) => {
        if (job.phase !== expected) throw new Error("Replacement state changed");
        job = { ...job, phase: next, ...(externalId ? { externalId } : {}) }; await store();
      },
      write: requestMeritReplacement,
      complete: async (invoice, pdf) => {
        await writeFile(resolve(dir, "current.pdf"), pdf, { mode: 0o600 });
        const { meritReplacementId: _pending, ...rest } = invoice;
        const completed = { ...rest, meritBackupId: id };
        await save(completed);
        job = { ...job, phase: "completed" }; await store();
        return completed;
      },
      fail: async (_message, abort) => {
        if (abort) { job = { ...job, phase: "aborted" }; await store(); await save(job.before); }
      }
    }, taxes.find(t => t.id === (after ?? job.after).taxId), providers.find(p => p.id === job.after.providerId));
  } finally { running.delete(before.id); }
}
