import type { Invoice } from "./types";

interface MeritInvoiceNumber {
  year: string;
  sequence: number;
  width: number;
}

function parseMeritInvoiceNumber(value: string): MeritInvoiceNumber | undefined {
  const match = /^(\d{4})\/(\d+)$/.exec(value.trim());
  if (!match) return undefined;
  const sequence = Number(match[2]);
  if (!Number.isSafeInteger(sequence) || sequence < 0) return undefined;
  return { year: match[1], sequence, width: match[2].length };
}

function invoiceYear(issueDate: string): string {
  const match = /^(\d{4})-\d{2}-\d{2}$/.exec(issueDate);
  if (!match) throw new Error("Invoice issue date must use YYYY-MM-DD before assigning a Merit invoice number");
  return match[1];
}

export function nextMeritInvoiceNumber(invoices: Invoice[], issueDate: string): string {
  const year = invoiceYear(issueDate);
  const series = invoices
    .map((invoice) => parseMeritInvoiceNumber(invoice.invoiceNumber))
    .filter((number): number is MeritInvoiceNumber => number?.year === year);

  if (series.length === 0) {
    throw new Error(`No ${year} Merit invoice numbering series is available. Sync Merit before creating this draft.`);
  }

  const nextSequence = Math.max(...series.map((number) => number.sequence)) + 1;
  const width = Math.max(...series.map((number) => number.width));
  return `${year}/${String(nextSequence).padStart(width, "0")}`;
}

function isLocalSalesDraft(invoice: Invoice): boolean {
  return invoice.documentType === "sales_invoice" && invoice.status === "draft" && !invoice.externalId;
}

export function assignMeritStyleDraftNumbers(invoices: Invoice[], liveMeritInvoices: Invoice[] = []): Invoice[] {
  const drafts = invoices
    .filter(isLocalSalesDraft)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  const reserved = [
    ...liveMeritInvoices,
    ...invoices.filter((invoice) => !isLocalSalesDraft(invoice))
  ];
  const replacements = new Map<string, Invoice>();

  for (const draft of drafts) {
    const current = parseMeritInvoiceNumber(draft.invoiceNumber);
    const year = invoiceYear(draft.issueDate);
    const used = new Set(reserved.map((invoice) => invoice.invoiceNumber));
    const invoiceNumber = current?.year === year && !used.has(draft.invoiceNumber)
      ? draft.invoiceNumber
      : nextMeritInvoiceNumber(reserved, draft.issueDate);
    const numbered = invoiceNumber === draft.invoiceNumber ? draft : { ...draft, invoiceNumber };
    replacements.set(draft.id, numbered);
    reserved.push(numbered);
  }

  return invoices.map((invoice) => replacements.get(invoice.id) ?? invoice);
}
