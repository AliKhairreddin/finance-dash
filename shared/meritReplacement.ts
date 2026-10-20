import type { Invoice, MeritTax, PaymentAllocation, Provider } from "./types";
import { meritInvoiceLineDescription } from "./merit";
import { MeritRequestRejected } from "./meritReplacementRequest";

export type ReplacementPhase = "preparing" | "backed_up" | "deleting" | "deleted" | "creating" | "created" | "completed" | "aborted";
export interface ReplacementJob {
  id: string;
  invoiceId: string;
  phase: ReplacementPhase;
  before: Invoice;
  after: Invoice;
  request?: Record<string, unknown>;
  original?: unknown;
  externalId?: string;
}
type RecordValue = Record<string, any>;
function record(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Merit returned incomplete invoice details; nothing was deleted");
  return value as RecordValue;
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const presentId = (value: unknown) => typeof value === "string" && Boolean(value.trim()) && value !== "00000000-0000-0000-0000-000000000000";
function date(value: unknown): string {
  const text = String(value ?? "");
  const day = /^\d{8}$/.test(text) ? `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6)}` : text.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day)) || new Date(day).toISOString().slice(0, 10) !== day) throw new Error("A valid invoice date is required");
  return day;
}
export function assertUnpaidInvoice(invoice: Invoice, allocations: PaymentAllocation[]) {
  if (invoice.documentType !== "sales_invoice" || invoice.status !== "open" || invoice.meritStatus === "paid" || invoice.paidAt || !invoice.externalId
    || allocations.some(a => a.invoiceId === invoice.id && (a.amount !== 0 || a.settlementAdjustment))) {
    throw new Error("Only unpaid sales invoices without recorded payments can be replaced in Merit");
  }
}
export function prepareReplacement(before: Invoice, after: Invoice, detail: unknown, tax: MeritTax | undefined, provider?: Provider) {
  const original = record(detail), h = record(original.Header);
  if (h.SIHId !== before.externalId || h.InvoiceNo !== before.invoiceNumber || !presentId(h.CustomerId)) throw new Error("Merit invoice identity changed; refresh before editing");
  if (h.Paid !== false || !Number.isFinite(h.PaidAmount) || h.PaidAmount !== 0 || !Array.isArray(original.Payments) || original.Payments.length !== 0) throw new Error("Merit reports a payment or an unverified payment status. Only completely unpaid invoices can be replaced");
  if (!Array.isArray(original.Lines) || original.Lines.length !== 1) throw new Error("Edit invoices with multiple lines directly in Merit");
  const line = record(original.Lines[0]);
  // These links and stock movements cannot be recreated by this single-service-line editor.
  if ((h.AccountingDock ?? h.AccountingDoc) !== 1 || h.PriceInclVat || h.ProjectCode || h.Dimensions?.length || presentId(h.OfferId) || presentId(h.PerSHId)
    || h.EInvSent || h.EInvOperator || line.LocationCode || line.FixAsset || line.DimAllocation?.length || line.BatchNo || line.ItemCostAmount
    || Number(line.Quantity) !== 1 || Number(line.DiscountPct ?? 0) !== 0 || Number(line.DiscountAmount ?? 0) !== 0) {
    throw new Error("This invoice has accounting, delivery, stock, discount, or allocation details that must be edited directly in Merit");
  }
  if (!line.ArticleCode || !line.AccountCode || !Number.isFinite(h.TotalAmount) || !Number.isFinite(h.TotalSum)
    || !Number.isFinite(h.TaxAmount) || !Number.isFinite(h.CurrencyRate) || h.CurrencyRate <= 0 || !Number.isFinite(h.RoundingAmount) || !Number.isFinite(line.AmountExclVat)
    || money(line.AmountExclVat) !== money(h.TotalAmount) || money(h.TotalAmount + h.TaxAmount + h.RoundingAmount) !== money(h.TotalSum)) {
    throw new Error("Merit invoice totals or accounting details are incomplete; nothing was deleted");
  }
  if (!tax || !Number.isFinite(tax.taxPct) || tax.taxPct < 0 || tax.id !== after.taxId) throw new Error("Choose an available Merit tax before saving");
  if (!after.description?.trim() || !after.customerName?.trim() || !Number.isFinite(after.amount) || after.amount <= 0 || !/^[A-Z]{3}$/.test(after.currency)) throw new Error("Valid description, customer, currency and positive amount are required");
  if (date(after.dueDate) < date(after.issueDate)) throw new Error("Due date cannot be before issue date");
  if (Boolean(after.periodStart) !== Boolean(after.periodEnd) || (after.periodStart && after.periodEnd && date(after.periodEnd) < date(after.periodStart))) throw new Error("A valid service period start and end are required together");
  const customerId = provider?.meritCustomerId ?? (after.providerId === before.providerId ? h.CustomerId : undefined);
  if (!customerId) throw new Error("Choose a customer imported from Merit before replacing this invoice");
  if (customerId === h.CustomerId && after.customerName !== before.customerName && !provider?.meritCustomerId) throw new Error("Change the customer through a company linked to Merit");
  const amount = money(after.amount), taxAmount = money(amount * tax.taxPct / 100);
  const request: Record<string, unknown> = {
    Customer: { Id: customerId }, AccountingDoc: 1, InvoiceNo: before.invoiceNumber,
    DocDate: date(after.issueDate).replaceAll("-", ""), DueDate: date(after.dueDate).replaceAll("-", ""),
    TransactionDate: (date(h.TransactionDate) === date(h.DocumentDate) ? date(after.issueDate) : date(h.TransactionDate)).replaceAll("-", ""), CurrencyCode: after.currency,
    ...(after.currency === h.CurrencyCode && date(after.issueDate) === date(h.DocumentDate) ? { CurrencyRate: h.CurrencyRate } : {}),
    DepartmentCode: h.DepartmentCode || "", RefNo: h.ReferenceNo || "", Hcomment: h.HComment || "", Fcomment: h.FComment || "", ContractNo: h.ContractNo || "",
    InvoiceRow: [{ Item: { Code: line.ArticleCode, Description: meritInvoiceLineDescription(after.description, after.periodStart, after.periodEnd), ...(line.UOMName ? { UOMName: line.UOMName } : {}) },
      Quantity: 1, Price: amount, TaxId: tax.id, GLAccountCode: line.AccountCode, DepartmentCode: line.DepartmentCode || "" }],
    TaxAmount: [{ TaxId: tax.id, Amount: taxAmount }], RoundingAmount: h.RoundingAmount, TotalAmount: amount,
    ...(original.Attachment?.FileContent ? { PDF: original.Attachment.FileContent, FileName: original.Attachment.Filename } : {})
  };
  if (h.FileExists && !original.Attachment?.FileContent) throw new Error("The original attachment could not be backed up; nothing was deleted");
  return { request, after: { ...after, amount: money(amount + taxAmount + h.RoundingAmount), invoiceNumber: before.invoiceNumber } };
}
export function verifyReplacement(detail: unknown, request: Record<string, any>): string {
  const value = record(detail), h = record(value.Header), line = value.Lines?.[0], expected = request.InvoiceRow[0];
  if (!presentId(h.SIHId) || h.InvoiceNo !== request.InvoiceNo || h.CustomerId !== request.Customer.Id || h.CurrencyCode !== request.CurrencyCode
    || date(h.DocumentDate) !== date(request.DocDate) || date(h.DueDate) !== date(request.DueDate) || money(h.TotalAmount) !== request.TotalAmount
    || money(h.TotalSum) !== money(request.TotalAmount + request.TaxAmount[0].Amount + request.RoundingAmount)
    || money(h.TaxAmount) !== request.TaxAmount[0].Amount || money(h.RoundingAmount) !== request.RoundingAmount
    || date(h.TransactionDate) !== date(request.TransactionDate) || (h.DepartmentCode || "") !== request.DepartmentCode
    || (h.HComment || "") !== request.Hcomment || (h.FComment || "") !== request.Fcomment || (h.ContractNo || "") !== request.ContractNo
    || (request.RefNo && h.ReferenceNo !== request.RefNo)
    || value.Lines?.length !== 1 || line.TaxId !== expected.TaxId || line.Description !== expected.Item.Description || line.ArticleCode !== expected.Item.Code
    || line.AccountCode !== expected.GLAccountCode || Number(line.Quantity) !== 1 || money(line.AmountExclVat) !== request.TotalAmount) {
    throw new Error("Merit replacement does not match the saved edit. Original backup retained; review Merit before continuing");
  }
  return h.SIHId;
}
export interface ReplacementPort {
  details(id: string): Promise<unknown>;
  pdf(id: string): Promise<Uint8Array<ArrayBuffer>>;
  list(invoiceNumber: string): Promise<Array<{ SIHId: string; InvoiceNo: string }>>;
  backup(original: unknown, pdf: Uint8Array<ArrayBuffer>, request: Record<string, unknown>, after: Invoice): Promise<void>;
  phase(expected: ReplacementPhase, next: ReplacementPhase, externalId?: string): Promise<void>;
  write(path: string, payload: unknown): Promise<unknown>;
  complete(invoice: Invoice, pdf: Uint8Array<ArrayBuffer>): Promise<Invoice>;
  fail(message: string, abort: boolean, retryAfterMs?: number): Promise<void>;
}
/** Write intent is durable BEFORE dispatch. Ambiguous create calls are only reconciled, never replayed. */
export async function runReplacement(job: ReplacementJob, port: ReplacementPort, tax?: MeritTax, provider?: Provider): Promise<Invoice> {
  const advance = async (next: ReplacementPhase, externalId?: string) => { await port.phase(job.phase, next, externalId); job.phase = next; if (externalId) job.externalId = externalId; };
  try {
    if (job.phase === "preparing") {
      const original = await port.details(job.before.externalId!);
      const prepared = prepareReplacement(job.before, job.after, original, tax, provider);
      const pdf = await port.pdf(job.before.externalId!);
      await port.backup(original, pdf, prepared.request, prepared.after);
      job.original = original; job.request = prepared.request; job.after = prepared.after; job.phase = "backed_up";
    }
    if (job.phase === "backed_up") {
      const fresh = await port.details(job.before.externalId!);
      if (canonical(fresh) !== canonical(job.original)) throw new Error("The original changed in Merit during backup; nothing was deleted. Open the editor again");
      await advance("deleting");
      try { await port.write(`/v2/deleteinvoice/${encodeURIComponent(job.before.externalId!)}`, {}); }
      catch (error) {
        if (error instanceof MeritRequestRejected) await advance("backed_up");
        throw error;
      }
    }
    if (job.phase === "deleting") {
      const remaining = await port.list(job.before.invoiceNumber);
      if (remaining.some(i => i.SIHId === job.before.externalId)) throw new Error("Merit still has the original invoice. Replacement paused; check Merit and retry recovery");
      await advance("deleted");
    }
    if (job.phase === "deleted") {
      const existing = await port.list(job.before.invoiceNumber);
      if (existing.some(i => i.InvoiceNo === job.before.invoiceNumber)) throw new Error("That invoice number already exists in Merit; review it before continuing");
      await advance("creating");
      let created: RecordValue;
      try { created = record(await port.write("/v2/sendinvoice", job.request)); }
      catch (error) {
        if (error instanceof MeritRequestRejected) await advance("deleted");
        throw error;
      }
      const id = created.SIHId ?? created.InvoiceId ?? created.Id;
      if (!presentId(id)) throw new Error("Merit did not return the replacement ID. Check replacement status before retrying");
      await advance("created", id);
    }
    if (job.phase === "creating") {
      const candidates = (await port.list(job.before.invoiceNumber)).filter(i => i.InvoiceNo === job.before.invoiceNumber && i.SIHId !== job.before.externalId);
      if (candidates.length !== 1) throw new Error("The create request has an uncertain outcome. No second invoice was sent. Review Merit, then check replacement status; the original backup is retained");
      const id = verifyReplacement(await port.details(candidates[0].SIHId), job.request!);
      await advance("created", id);
    }
    if (job.phase !== "created" || !job.externalId) throw new Error("Invalid invoice replacement state");
    const detail = await port.details(job.externalId);
    verifyReplacement(detail, job.request!);
    const h = record(record(detail).Header);
    // A payment added after creation must not be hidden by finalization.
    if (h.Paid !== false || h.PaidAmount !== 0 || record(detail).Payments?.length) throw new Error("The replacement received a payment in Merit. Review it before completing the edit");
    const pdf = await port.pdf(job.externalId);
    return await port.complete({ ...job.after, externalId: job.externalId, meritStatus: "open", meritDeliveryStatus: "saved", sentAt: undefined, meritDeliveryError: undefined, sendError: undefined, updatedAt: new Date().toISOString() }, pdf);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invoice replacement failed";
    await port.fail(message, job.phase === "preparing" || job.phase === "backed_up", error instanceof MeritRequestRejected && error.status === 429 ? error.retryAfterMs : undefined);
    throw new Error(message, { cause: error });
  }
}
